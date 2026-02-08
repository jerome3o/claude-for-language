import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import OAuthProvider, {
  type AuthRequest,
  type OAuthHelpers,
} from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { STUDY_APP_HTML } from "./study-app-html.js";

// Types
interface Env {
  DB: D1Database;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  COOKIE_ENCRYPTION_KEY: string;
  ENVIRONMENT: string;
  OAUTH_KV: KVNamespace;
}

interface User {
  id: string;
  email: string | null;
  google_id: string | null;
  name: string | null;
  picture_url: string | null;
}

interface Deck {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

interface Note {
  id: string;
  deck_id: string;
  hanzi: string;
  pinyin: string;
  english: string;
  audio_url: string | null;
  fun_facts: string | null;
  created_at: string;
  updated_at: string;
}

// Props passed to MCP server after authentication
type Props = {
  userId: string;
  userEmail: string | null;
  userName: string | null;
};

// Utility function to generate IDs
function generateId(): string {
  return crypto.randomUUID();
}

const CARD_TYPES = ['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi'] as const;

// Legacy class (non-SQLite) - kept for migration compatibility
export class ChineseLearningMCP extends McpAgent<Env, Record<string, never>, Props> {
  server = new McpServer({ name: "Legacy", version: "1.0.0" });
  async init() {}
}

// MCP Server with tools (v2 uses SQLite-backed Durable Object)
export class ChineseLearningMCPv2 extends McpAgent<Env, Record<string, never>, Props> {
  server = new McpServer({
    name: "Chinese Learning App",
    version: "1.0.0",
  });

  async init() {
    const userId = this.props!.userId;

    // ============ Deck Tools ============

    this.server.tool(
      "list_decks",
      "List all vocabulary decks with their stats",
      {},
      async () => {
        const decks = await this.env.DB
          .prepare('SELECT * FROM decks WHERE user_id = ? ORDER BY updated_at DESC')
          .bind(userId)
          .all<Deck>();

        const decksWithStats = await Promise.all(
          decks.results.map(async (deck) => {
            const [noteCount, cardsDue, cardsMastered] = await Promise.all([
              this.env.DB.prepare('SELECT COUNT(*) as count FROM notes WHERE deck_id = ?')
                .bind(deck.id).first<{ count: number }>(),
              this.env.DB.prepare(
                `SELECT COUNT(*) as count FROM cards c
                 JOIN notes n ON c.note_id = n.id
                 WHERE n.deck_id = ? AND (c.next_review_at IS NULL OR c.next_review_at <= datetime('now'))`
              ).bind(deck.id).first<{ count: number }>(),
              this.env.DB.prepare(
                `SELECT COUNT(*) as count FROM cards c
                 JOIN notes n ON c.note_id = n.id
                 WHERE n.deck_id = ? AND c.interval > 21`
              ).bind(deck.id).first<{ count: number }>(),
            ]);
            return {
              ...deck,
              note_count: noteCount?.count || 0,
              cards_due: cardsDue?.count || 0,
              cards_mastered: cardsMastered?.count || 0,
            };
          })
        );

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(decksWithStats, null, 2),
          }],
        };
      }
    );

    this.server.tool(
      "get_deck",
      "Get a deck with all its notes. Use the 'fields' parameter to request only specific note fields (e.g. ['hanzi', 'english']) to reduce response size for large decks.",
      {
        deck_id: z.string().describe("The deck ID"),
        fields: z.array(z.enum(['hanzi', 'pinyin', 'english', 'audio_url', 'fun_facts', 'created_at', 'updated_at', 'context']))
          .optional()
          .describe("Which note fields to include in the response. If not specified, all fields are returned. The note 'id' and 'deck_id' are always included."),
      },
      async ({ deck_id, fields }) => {
        const deck = await this.env.DB
          .prepare('SELECT * FROM decks WHERE id = ? AND user_id = ?')
          .bind(deck_id, userId)
          .first<Deck>();

        if (!deck) {
          return {
            content: [{ type: "text" as const, text: `Deck not found: ${deck_id}` }],
            isError: true,
          };
        }

        const notes = await this.env.DB
          .prepare('SELECT * FROM notes WHERE deck_id = ? ORDER BY created_at DESC')
          .bind(deck_id)
          .all<Note>();

        let filteredNotes = notes.results;
        if (fields && fields.length > 0) {
          const alwaysInclude = ['id', 'deck_id'];
          const allowedKeys = new Set([...alwaysInclude, ...fields]);
          filteredNotes = notes.results.map(note => {
            const filtered: Record<string, unknown> = {};
            for (const key of allowedKeys) {
              if (key in note) {
                filtered[key] = (note as unknown as Record<string, unknown>)[key];
              }
            }
            return filtered as unknown as Note;
          });
        }

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ ...deck, notes: filteredNotes }, null, 2),
          }],
        };
      }
    );

    this.server.tool(
      "get_deck_progress",
      "Get detailed study progress for a deck including card-level stats",
      { deck_id: z.string().describe("The deck ID") },
      async ({ deck_id }) => {
        const deck = await this.env.DB
          .prepare('SELECT * FROM decks WHERE id = ? AND user_id = ?')
          .bind(deck_id, userId)
          .first<Deck>();

        if (!deck) {
          return {
            content: [{ type: "text" as const, text: `Deck not found: ${deck_id}` }],
            isError: true,
          };
        }

        const cards = await this.env.DB
          .prepare(`
            SELECT c.*, n.hanzi, n.pinyin, n.english
            FROM cards c
            JOIN notes n ON c.note_id = n.id
            WHERE n.deck_id = ?
            ORDER BY n.hanzi
          `)
          .bind(deck_id)
          .all();

        const stats = {
          total_cards: cards.results.length,
          new_cards: cards.results.filter((c: any) => c.next_review_at === null).length,
          learning: cards.results.filter((c: any) => c.next_review_at !== null && c.interval <= 1).length,
          reviewing: cards.results.filter((c: any) => c.interval > 1 && c.interval <= 21).length,
          mastered: cards.results.filter((c: any) => c.interval > 21).length,
          due_now: cards.results.filter((c: any) =>
            c.next_review_at === null || new Date(c.next_review_at) <= new Date()
          ).length,
        };

        const noteProgress: Record<string, any> = {};
        for (const card of cards.results as any[]) {
          if (!noteProgress[card.note_id]) {
            noteProgress[card.note_id] = {
              hanzi: card.hanzi,
              pinyin: card.pinyin,
              english: card.english,
              cards: [],
            };
          }
          noteProgress[card.note_id].cards.push({
            card_type: card.card_type,
            ease_factor: card.ease_factor,
            interval: card.interval,
            repetitions: card.repetitions,
            next_review_at: card.next_review_at,
          });
        }

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              deck: { id: deck.id, name: deck.name },
              stats,
              notes: Object.values(noteProgress),
            }, null, 2),
          }],
        };
      }
    );

    this.server.tool(
      "create_deck",
      "Create a new vocabulary deck",
      {
        name: z.string().describe("Name of the deck"),
        description: z.string().optional().describe("Description of the deck"),
      },
      async ({ name, description }) => {
        const id = generateId();
        await this.env.DB
          .prepare('INSERT INTO decks (id, user_id, name, description) VALUES (?, ?, ?, ?)')
          .bind(id, userId, name, description || null)
          .run();

        const deck = await this.env.DB
          .prepare('SELECT * FROM decks WHERE id = ?')
          .bind(id)
          .first<Deck>();

        return {
          content: [{
            type: "text" as const,
            text: `Created deck: ${JSON.stringify(deck, null, 2)}`,
          }],
        };
      }
    );

    this.server.tool(
      "update_deck",
      "Update a deck's name or description",
      {
        deck_id: z.string().describe("The deck ID"),
        name: z.string().optional().describe("New name for the deck"),
        description: z.string().optional().describe("New description for the deck"),
      },
      async ({ deck_id, name, description }) => {
        const existing = await this.env.DB
          .prepare('SELECT * FROM decks WHERE id = ? AND user_id = ?')
          .bind(deck_id, userId)
          .first<Deck>();

        if (!existing) {
          return {
            content: [{ type: "text" as const, text: `Deck not found: ${deck_id}` }],
            isError: true,
          };
        }

        const updates: string[] = [];
        const values: (string | null)[] = [];

        if (name !== undefined) {
          updates.push('name = ?');
          values.push(name);
        }
        if (description !== undefined) {
          updates.push('description = ?');
          values.push(description);
        }

        if (updates.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No updates provided" }],
            isError: true,
          };
        }

        updates.push("updated_at = datetime('now')");
        values.push(deck_id);

        await this.env.DB
          .prepare(`UPDATE decks SET ${updates.join(', ')} WHERE id = ?`)
          .bind(...values)
          .run();

        const deck = await this.env.DB
          .prepare('SELECT * FROM decks WHERE id = ?')
          .bind(deck_id)
          .first<Deck>();

        return {
          content: [{
            type: "text" as const,
            text: `Updated deck: ${JSON.stringify(deck, null, 2)}`,
          }],
        };
      }
    );

    this.server.tool(
      "delete_deck",
      "Delete a deck and all its notes/cards",
      { deck_id: z.string().describe("The deck ID to delete") },
      async ({ deck_id }) => {
        const deck = await this.env.DB
          .prepare('SELECT * FROM decks WHERE id = ? AND user_id = ?')
          .bind(deck_id, userId)
          .first<Deck>();

        if (!deck) {
          return {
            content: [{ type: "text" as const, text: `Deck not found: ${deck_id}` }],
            isError: true,
          };
        }

        await this.env.DB
          .prepare('DELETE FROM decks WHERE id = ?')
          .bind(deck_id)
          .run();

        return {
          content: [{
            type: "text" as const,
            text: `Deleted deck: "${deck.name}" (${deck_id})`,
          }],
        };
      }
    );

    // ============ Note Tools ============

    this.server.tool(
      "add_note",
      "Add a vocabulary note to a deck (creates 3 cards automatically)",
      {
        deck_id: z.string().describe("The deck ID"),
        hanzi: z.string().describe("Chinese characters (simplified)"),
        pinyin: z.string().describe("Pinyin with tone marks (e.g., nǐ hǎo)"),
        english: z.string().describe("English translation"),
        fun_facts: z.string().optional().describe("Cultural notes, memory aids, etc."),
      },
      async ({ deck_id, hanzi, pinyin, english, fun_facts }) => {
        const deck = await this.env.DB
          .prepare('SELECT id FROM decks WHERE id = ? AND user_id = ?')
          .bind(deck_id, userId)
          .first();

        if (!deck) {
          return {
            content: [{ type: "text" as const, text: `Deck not found: ${deck_id}` }],
            isError: true,
          };
        }

        const noteId = generateId();

        await this.env.DB
          .prepare(
            'INSERT INTO notes (id, deck_id, hanzi, pinyin, english, fun_facts) VALUES (?, ?, ?, ?, ?, ?)'
          )
          .bind(noteId, deck_id, hanzi, pinyin, english, fun_facts || null)
          .run();

        for (const cardType of CARD_TYPES) {
          const cardId = generateId();
          await this.env.DB
            .prepare('INSERT INTO cards (id, note_id, card_type) VALUES (?, ?, ?)')
            .bind(cardId, noteId, cardType)
            .run();
        }

        await this.env.DB
          .prepare("UPDATE decks SET updated_at = datetime('now') WHERE id = ?")
          .bind(deck_id)
          .run();

        // Generate TTS audio via main API
        let audioGenerated = false;
        try {
          const apiUrl = this.env.ENVIRONMENT === 'production'
            ? 'https://chinese-learning-api.jeromeswannack.workers.dev'
            : 'http://localhost:8787';
          const audioResponse = await fetch(`${apiUrl}/api/notes/${noteId}/generate-audio`, {
            method: 'POST',
          });
          audioGenerated = audioResponse.ok;
        } catch (e) {
          console.error('Failed to generate audio:', e);
        }

        return {
          content: [{
            type: "text" as const,
            text: `Added note: ${hanzi} (${pinyin}) - ${english}${audioGenerated ? ' (with audio)' : ' (audio generation pending)'}`,
          }],
        };
      }
    );

    this.server.tool(
      "batch_add_notes",
      "Add multiple vocabulary notes to a deck at once (more efficient than calling add_note repeatedly)",
      {
        deck_id: z.string().describe("The deck ID"),
        notes: z.array(z.object({
          hanzi: z.string().describe("Chinese characters (simplified)"),
          pinyin: z.string().describe("Pinyin with tone marks (e.g., nǐ hǎo)"),
          english: z.string().describe("English translation"),
          fun_facts: z.string().optional().describe("Cultural notes, memory aids, etc."),
        })).describe("Array of notes to add"),
      },
      async ({ deck_id, notes }) => {
        const deck = await this.env.DB
          .prepare('SELECT id FROM decks WHERE id = ? AND user_id = ?')
          .bind(deck_id, userId)
          .first();

        if (!deck) {
          return {
            content: [{ type: "text" as const, text: `Deck not found: ${deck_id}` }],
            isError: true,
          };
        }

        const results: { hanzi: string; pinyin: string; success: boolean; audioGenerated: boolean }[] = [];
        const noteIds: string[] = [];

        // Insert all notes and cards
        for (const note of notes) {
          try {
            const noteId = generateId();
            noteIds.push(noteId);

            await this.env.DB
              .prepare(
                'INSERT INTO notes (id, deck_id, hanzi, pinyin, english, fun_facts) VALUES (?, ?, ?, ?, ?, ?)'
              )
              .bind(noteId, deck_id, note.hanzi, note.pinyin, note.english, note.fun_facts || null)
              .run();

            for (const cardType of CARD_TYPES) {
              const cardId = generateId();
              await this.env.DB
                .prepare('INSERT INTO cards (id, note_id, card_type) VALUES (?, ?, ?)')
                .bind(cardId, noteId, cardType)
                .run();
            }

            results.push({ hanzi: note.hanzi, pinyin: note.pinyin, success: true, audioGenerated: false });
          } catch (e) {
            console.error(`Failed to add note ${note.hanzi}:`, e);
            results.push({ hanzi: note.hanzi, pinyin: note.pinyin, success: false, audioGenerated: false });
          }
        }

        // Update deck timestamp
        await this.env.DB
          .prepare("UPDATE decks SET updated_at = datetime('now') WHERE id = ?")
          .bind(deck_id)
          .run();

        // Generate TTS audio for all notes (in parallel)
        const apiUrl = this.env.ENVIRONMENT === 'production'
          ? 'https://chinese-learning-api.jeromeswannack.workers.dev'
          : 'http://localhost:8787';

        const audioPromises = noteIds.map(async (noteId, index) => {
          try {
            const response = await fetch(`${apiUrl}/api/notes/${noteId}/generate-audio`, {
              method: 'POST',
            });
            if (response.ok) {
              results[index].audioGenerated = true;
            }
          } catch (e) {
            console.error(`Failed to generate audio for note ${noteId}:`, e);
          }
        });

        await Promise.all(audioPromises);

        const successful = results.filter(r => r.success);
        const withAudio = results.filter(r => r.audioGenerated);

        return {
          content: [{
            type: "text" as const,
            text: `Added ${successful.length}/${notes.length} notes (${withAudio.length} with audio):\n${successful.map(r => `  - ${r.hanzi} (${r.pinyin})${r.audioGenerated ? ' 🔊' : ''}`).join('\n')}`,
          }],
        };
      }
    );

    this.server.tool(
      "update_note",
      "Update an existing note",
      {
        note_id: z.string().describe("The note ID"),
        hanzi: z.string().optional().describe("New Chinese characters"),
        pinyin: z.string().optional().describe("New pinyin"),
        english: z.string().optional().describe("New English translation"),
        fun_facts: z.string().optional().describe("New fun facts/notes"),
      },
      async ({ note_id, hanzi, pinyin, english, fun_facts }) => {
        const note = await this.env.DB
          .prepare(`
            SELECT n.* FROM notes n
            JOIN decks d ON n.deck_id = d.id
            WHERE n.id = ? AND d.user_id = ?
          `)
          .bind(note_id, userId)
          .first<Note>();

        if (!note) {
          return {
            content: [{ type: "text" as const, text: `Note not found: ${note_id}` }],
            isError: true,
          };
        }

        const updates: string[] = [];
        const values: (string | null)[] = [];

        if (hanzi !== undefined) {
          updates.push('hanzi = ?');
          values.push(hanzi);
        }
        if (pinyin !== undefined) {
          updates.push('pinyin = ?');
          values.push(pinyin);
        }
        if (english !== undefined) {
          updates.push('english = ?');
          values.push(english);
        }
        if (fun_facts !== undefined) {
          updates.push('fun_facts = ?');
          values.push(fun_facts);
        }

        if (updates.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No updates provided" }],
            isError: true,
          };
        }

        updates.push("updated_at = datetime('now')");
        values.push(note_id);

        await this.env.DB
          .prepare(`UPDATE notes SET ${updates.join(', ')} WHERE id = ?`)
          .bind(...values)
          .run();

        await this.env.DB
          .prepare("UPDATE decks SET updated_at = datetime('now') WHERE id = ?")
          .bind(note.deck_id)
          .run();

        const updatedNote = await this.env.DB
          .prepare('SELECT * FROM notes WHERE id = ?')
          .bind(note_id)
          .first<Note>();

        return {
          content: [{
            type: "text" as const,
            text: `Updated note: ${JSON.stringify(updatedNote, null, 2)}`,
          }],
        };
      }
    );

    this.server.tool(
      "delete_note",
      "Delete a note and its cards",
      { note_id: z.string().describe("The note ID to delete") },
      async ({ note_id }) => {
        const note = await this.env.DB
          .prepare(`
            SELECT n.* FROM notes n
            JOIN decks d ON n.deck_id = d.id
            WHERE n.id = ? AND d.user_id = ?
          `)
          .bind(note_id, userId)
          .first<Note>();

        if (!note) {
          return {
            content: [{ type: "text" as const, text: `Note not found: ${note_id}` }],
            isError: true,
          };
        }

        await this.env.DB
          .prepare('DELETE FROM notes WHERE id = ?')
          .bind(note_id)
          .run();

        await this.env.DB
          .prepare("UPDATE decks SET updated_at = datetime('now') WHERE id = ?")
          .bind(note.deck_id)
          .run();

        return {
          content: [{
            type: "text" as const,
            text: `Deleted note: ${note.hanzi} (${note.pinyin})`,
          }],
        };
      }
    );

    // ============ Card Configuration Tools ============

    this.server.tool(
      "get_note_cards",
      "Get all cards for a note with their current SRS state (ease factor, interval, queue, etc.)",
      { note_id: z.string().describe("The note ID") },
      async ({ note_id }) => {
        const note = await this.env.DB
          .prepare(`
            SELECT n.*, d.name as deck_name FROM notes n
            JOIN decks d ON n.deck_id = d.id
            WHERE n.id = ? AND d.user_id = ?
          `)
          .bind(note_id, userId)
          .first<Note & { deck_name: string }>();

        if (!note) {
          return {
            content: [{ type: "text" as const, text: `Note not found: ${note_id}` }],
            isError: true,
          };
        }

        const cards = await this.env.DB
          .prepare(`
            SELECT id, card_type, ease_factor, interval, repetitions, queue, learning_step, next_review_at, due_timestamp
            FROM cards WHERE note_id = ?
          `)
          .bind(note_id)
          .all();

        const queueNames: Record<number, string> = {
          0: 'new',
          1: 'learning',
          2: 'review',
          3: 'relearning',
        };

        const cardsWithLabels = cards.results.map((card: any) => ({
          ...card,
          queue_name: queueNames[card.queue] || 'unknown',
        }));

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              note: {
                id: note.id,
                hanzi: note.hanzi,
                pinyin: note.pinyin,
                english: note.english,
                deck_name: note.deck_name,
              },
              cards: cardsWithLabels,
            }, null, 2),
          }],
        };
      }
    );

    this.server.tool(
      "set_card_familiarity",
      "Set how familiar the user is with a note's cards. Use this to skip learning steps for cards the user already knows.",
      {
        note_id: z.string().describe("The note ID"),
        familiarity: z.enum(['new', 'seen', 'familiar', 'well_known', 'mastered']).describe(
          "Familiarity level: 'new' (start from scratch), 'seen' (1 day interval), 'familiar' (7 day interval), 'well_known' (30 day interval), 'mastered' (90 day interval)"
        ),
        card_types: z.array(z.enum(['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi'])).optional().describe(
          "Which card types to update. If not specified, updates all 3 card types."
        ),
      },
      async ({ note_id, familiarity, card_types }) => {
        const note = await this.env.DB
          .prepare(`
            SELECT n.* FROM notes n
            JOIN decks d ON n.deck_id = d.id
            WHERE n.id = ? AND d.user_id = ?
          `)
          .bind(note_id, userId)
          .first<Note>();

        if (!note) {
          return {
            content: [{ type: "text" as const, text: `Note not found: ${note_id}` }],
            isError: true,
          };
        }

        // Define familiarity presets
        const presets: Record<string, { queue: number; interval: number; ease_factor: number; repetitions: number }> = {
          new: { queue: 0, interval: 0, ease_factor: 2.5, repetitions: 0 },
          seen: { queue: 2, interval: 1, ease_factor: 2.5, repetitions: 1 },
          familiar: { queue: 2, interval: 7, ease_factor: 2.5, repetitions: 2 },
          well_known: { queue: 2, interval: 30, ease_factor: 2.6, repetitions: 4 },
          mastered: { queue: 2, interval: 90, ease_factor: 2.7, repetitions: 6 },
        };

        const preset = presets[familiarity];
        const typesToUpdate = card_types || ['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi'];

        // Calculate next review date
        const nextReview = preset.interval > 0 ? new Date() : null;
        if (nextReview) {
          nextReview.setDate(nextReview.getDate() + preset.interval);
        }

        for (const cardType of typesToUpdate) {
          await this.env.DB
            .prepare(`
              UPDATE cards SET
                queue = ?,
                interval = ?,
                ease_factor = ?,
                repetitions = ?,
                learning_step = 0,
                next_review_at = ?,
                due_timestamp = NULL
              WHERE note_id = ? AND card_type = ?
            `)
            .bind(
              preset.queue,
              preset.interval,
              preset.ease_factor,
              preset.repetitions,
              nextReview?.toISOString() || null,
              note_id,
              cardType
            )
            .run();
        }

        return {
          content: [{
            type: "text" as const,
            text: `Set "${note.hanzi}" (${note.pinyin}) to ${familiarity} for ${typesToUpdate.length} card type(s). ${preset.interval > 0 ? `Next review in ${preset.interval} day(s).` : 'Will appear as new card.'}`,
          }],
        };
      }
    );

    this.server.tool(
      "update_card_settings",
      "Update specific SRS settings for a card. Use for fine-grained control over scheduling.",
      {
        note_id: z.string().describe("The note ID"),
        card_type: z.enum(['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi']).describe("Which card type to update"),
        ease_factor: z.number().optional().describe("Ease factor (e.g., 2.5). Higher = longer intervals."),
        interval: z.number().optional().describe("Current interval in days"),
        queue: z.enum(['new', 'learning', 'review', 'relearning']).optional().describe("Card queue/state"),
        next_review_days: z.number().optional().describe("Days until next review (sets next_review_at)"),
      },
      async ({ note_id, card_type, ease_factor, interval, queue, next_review_days }) => {
        const note = await this.env.DB
          .prepare(`
            SELECT n.* FROM notes n
            JOIN decks d ON n.deck_id = d.id
            WHERE n.id = ? AND d.user_id = ?
          `)
          .bind(note_id, userId)
          .first<Note>();

        if (!note) {
          return {
            content: [{ type: "text" as const, text: `Note not found: ${note_id}` }],
            isError: true,
          };
        }

        const updates: string[] = [];
        const values: (string | number | null)[] = [];

        if (ease_factor !== undefined) {
          updates.push('ease_factor = ?');
          values.push(ease_factor);
        }
        if (interval !== undefined) {
          updates.push('interval = ?');
          values.push(interval);
        }
        if (queue !== undefined) {
          const queueMap: Record<string, number> = { new: 0, learning: 1, review: 2, relearning: 3 };
          updates.push('queue = ?');
          values.push(queueMap[queue]);
          if (queue === 'new') {
            updates.push('learning_step = 0');
            updates.push('next_review_at = NULL');
            updates.push('due_timestamp = NULL');
          }
        }
        if (next_review_days !== undefined) {
          const nextReview = new Date();
          nextReview.setDate(nextReview.getDate() + next_review_days);
          updates.push('next_review_at = ?');
          values.push(nextReview.toISOString());
          updates.push('due_timestamp = NULL');
        }

        if (updates.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No updates provided" }],
            isError: true,
          };
        }

        values.push(note_id);
        values.push(card_type);

        await this.env.DB
          .prepare(`UPDATE cards SET ${updates.join(', ')} WHERE note_id = ? AND card_type = ?`)
          .bind(...values)
          .run();

        // Fetch updated card
        const card = await this.env.DB
          .prepare('SELECT * FROM cards WHERE note_id = ? AND card_type = ?')
          .bind(note_id, card_type)
          .first();

        return {
          content: [{
            type: "text" as const,
            text: `Updated ${card_type} card for "${note.hanzi}": ${JSON.stringify(card, null, 2)}`,
          }],
        };
      }
    );

    this.server.tool(
      "batch_set_familiarity",
      "Set familiarity for multiple notes at once. Useful for marking a whole deck or set of words as already known.",
      {
        note_ids: z.array(z.string()).describe("Array of note IDs to update"),
        familiarity: z.enum(['new', 'seen', 'familiar', 'well_known', 'mastered']).describe(
          "Familiarity level to set for all notes"
        ),
      },
      async ({ note_ids, familiarity }) => {
        const presets: Record<string, { queue: number; interval: number; ease_factor: number; repetitions: number }> = {
          new: { queue: 0, interval: 0, ease_factor: 2.5, repetitions: 0 },
          seen: { queue: 2, interval: 1, ease_factor: 2.5, repetitions: 1 },
          familiar: { queue: 2, interval: 7, ease_factor: 2.5, repetitions: 2 },
          well_known: { queue: 2, interval: 30, ease_factor: 2.6, repetitions: 4 },
          mastered: { queue: 2, interval: 90, ease_factor: 2.7, repetitions: 6 },
        };

        const preset = presets[familiarity];
        let updatedCount = 0;
        const errors: string[] = [];

        for (const noteId of note_ids) {
          // Verify note belongs to user
          const note = await this.env.DB
            .prepare(`
              SELECT n.id FROM notes n
              JOIN decks d ON n.deck_id = d.id
              WHERE n.id = ? AND d.user_id = ?
            `)
            .bind(noteId, userId)
            .first();

          if (!note) {
            errors.push(noteId);
            continue;
          }

          const nextReview = preset.interval > 0 ? new Date() : null;
          if (nextReview) {
            nextReview.setDate(nextReview.getDate() + preset.interval);
          }

          await this.env.DB
            .prepare(`
              UPDATE cards SET
                queue = ?,
                interval = ?,
                ease_factor = ?,
                repetitions = ?,
                learning_step = 0,
                next_review_at = ?,
                due_timestamp = NULL
              WHERE note_id = ?
            `)
            .bind(
              preset.queue,
              preset.interval,
              preset.ease_factor,
              preset.repetitions,
              nextReview?.toISOString() || null,
              noteId
            )
            .run();

          updatedCount++;
        }

        return {
          content: [{
            type: "text" as const,
            text: `Set ${updatedCount} note(s) to "${familiarity}"${errors.length > 0 ? `. ${errors.length} note(s) not found.` : '.'}`,
          }],
        };
      }
    );

    // ============ History Tools ============

    this.server.tool(
      "get_note_history",
      "Get review history for a note including all card types, ratings, and recordings",
      { note_id: z.string().describe("The note ID") },
      async ({ note_id }) => {
        const note = await this.env.DB
          .prepare(`
            SELECT n.* FROM notes n
            JOIN decks d ON n.deck_id = d.id
            WHERE n.id = ? AND d.user_id = ?
          `)
          .bind(note_id, userId)
          .first<Note>();

        if (!note) {
          return {
            content: [{ type: "text" as const, text: `Note not found: ${note_id}` }],
            isError: true,
          };
        }

        const reviews = await this.env.DB
          .prepare(`
            SELECT re.id, re.rating, re.time_spent_ms, re.user_answer, re.recording_url, re.reviewed_at, c.card_type
            FROM review_events re
            JOIN cards c ON re.card_id = c.id
            WHERE c.note_id = ?
            ORDER BY re.reviewed_at DESC
          `)
          .bind(note_id)
          .all<{
            id: string;
            rating: number;
            time_spent_ms: number | null;
            user_answer: string | null;
            recording_url: string | null;
            reviewed_at: string;
            card_type: string;
          }>();

        const ratingLabels = ['Again', 'Hard', 'Good', 'Easy'];
        const byCardType: Record<string, any[]> = {};

        for (const review of reviews.results) {
          if (!byCardType[review.card_type]) {
            byCardType[review.card_type] = [];
          }
          byCardType[review.card_type].push({
            reviewed_at: review.reviewed_at,
            rating: ratingLabels[review.rating] || review.rating,
            time_spent_ms: review.time_spent_ms,
            user_answer: review.user_answer,
            has_recording: !!review.recording_url,
          });
        }

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              note: { hanzi: note.hanzi, pinyin: note.pinyin, english: note.english },
              total_reviews: reviews.results.length,
              history_by_card_type: byCardType,
            }, null, 2),
          }],
        };
      }
    );

    // ============ Study Tools ============

    this.server.tool(
      "get_due_cards",
      "Get cards that are due for review",
      {
        deck_id: z.string().optional().describe("Filter by deck ID (optional)"),
        limit: z.number().optional().describe("Maximum number of cards (default 20)"),
      },
      async ({ deck_id, limit = 20 }) => {
        let query = `
          SELECT c.*, n.hanzi, n.pinyin, n.english, n.fun_facts, n.deck_id
          FROM cards c
          JOIN notes n ON c.note_id = n.id
          JOIN decks d ON n.deck_id = d.id
          WHERE d.user_id = ? AND (c.next_review_at IS NULL OR c.next_review_at <= datetime('now'))
        `;

        const params: (string | number)[] = [userId];

        if (deck_id) {
          query += ' AND n.deck_id = ?';
          params.push(deck_id);
        }

        query += ' ORDER BY c.next_review_at ASC NULLS LAST LIMIT ?';
        params.push(limit);

        const result = await this.env.DB
          .prepare(query)
          .bind(...params)
          .all();

        const cards = result.results.map((row: any) => ({
          card_id: row.id,
          card_type: row.card_type,
          hanzi: row.hanzi,
          pinyin: row.pinyin,
          english: row.english,
          fun_facts: row.fun_facts,
          ease_factor: row.ease_factor,
          interval: row.interval,
          repetitions: row.repetitions,
          next_review_at: row.next_review_at,
        }));

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              count: cards.length,
              cards,
            }, null, 2),
          }],
        };
      }
    );

    this.server.tool(
      "get_overall_stats",
      "Get overall study statistics",
      {},
      async () => {
        const [totalCards, cardsDue, studiedToday, totalDecks] = await Promise.all([
          this.env.DB.prepare(`
            SELECT COUNT(*) as count FROM cards c
            JOIN notes n ON c.note_id = n.id
            JOIN decks d ON n.deck_id = d.id
            WHERE d.user_id = ?
          `).bind(userId).first<{ count: number }>(),
          this.env.DB.prepare(`
            SELECT COUNT(*) as count FROM cards c
            JOIN notes n ON c.note_id = n.id
            JOIN decks d ON n.deck_id = d.id
            WHERE d.user_id = ? AND (c.next_review_at IS NULL OR c.next_review_at <= datetime('now'))
          `).bind(userId).first<{ count: number }>(),
          this.env.DB.prepare(`
            SELECT COUNT(*) as count FROM review_events
            WHERE user_id = ? AND date(reviewed_at) = date('now')
          `).bind(userId).first<{ count: number }>(),
          this.env.DB.prepare('SELECT COUNT(*) as count FROM decks WHERE user_id = ?')
            .bind(userId).first<{ count: number }>(),
        ]);

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              total_decks: totalDecks?.count || 0,
              total_cards: totalCards?.count || 0,
              cards_due_today: cardsDue?.count || 0,
              cards_studied_today: studiedToday?.count || 0,
            }, null, 2),
          }],
        };
      }
    );

    // ============ Study MCP App Tools ============

    const studyResourceUri = "ui://study/mcp-app.html";

    // Helper to compute interval previews for rating buttons
    const computeIntervalPreviews = (card: {
      queue: number;
      ease_factor: number;
      interval: number;
      learning_step: number;
    }) => {
      // Simplified SM-2 previews
      const formatInterval = (days: number): string => {
        if (days < 1) {
          const mins = Math.round(days * 24 * 60);
          return mins < 60 ? `${mins}m` : `${Math.round(mins / 60)}h`;
        }
        return days < 30 ? `${Math.round(days)}d` : `${Math.round(days / 30)}mo`;
      };

      const isNew = card.queue === 0;
      const isLearning = card.queue === 1 || card.queue === 3;

      if (isNew || isLearning) {
        return {
          0: { intervalText: '1m', queue: 1 },
          1: { intervalText: '6m', queue: 1 },
          2: { intervalText: '10m', queue: 1 },
          3: { intervalText: '4d', queue: 2 },
        };
      }

      // Review card
      const ease = card.ease_factor;
      const interval = card.interval || 1;
      return {
        0: { intervalText: '10m', queue: 3 },
        1: { intervalText: formatInterval(interval * 1.2), queue: 2 },
        2: { intervalText: formatInterval(interval * ease), queue: 2 },
        3: { intervalText: formatInterval(interval * ease * 1.3), queue: 2 },
      };
    };

    // Study tool - opens interactive flashcard UI
    registerAppTool(
      this.server,
      "study",
      {
        title: "Study Flashcards",
        description: "Open an interactive flashcard study session for a deck. Use list_decks first to get deck IDs.",
        inputSchema: z.object({
          deck_id: z.string().describe("The deck ID to study"),
        }),
        _meta: {
          ui: { resourceUri: studyResourceUri },
        },
      },
      async ({ deck_id }) => {
        // Verify deck exists and belongs to user
        const deck = await this.env.DB
          .prepare('SELECT id, name, description FROM decks WHERE id = ? AND user_id = ?')
          .bind(deck_id, userId)
          .first<{ id: string; name: string; description: string | null }>();

        if (!deck) {
          return {
            content: [{ type: "text" as const, text: `Deck not found: ${deck_id}` }],
            isError: true,
          };
        }

        // Get due cards with note data
        const cardsResult = await this.env.DB
          .prepare(`
            SELECT
              c.id, c.card_type, c.queue, c.ease_factor, c.interval, c.learning_step,
              n.id as note_id, n.hanzi, n.pinyin, n.english, n.audio_url, n.fun_facts
            FROM cards c
            JOIN notes n ON c.note_id = n.id
            WHERE n.deck_id = ?
              AND (c.next_review_at IS NULL OR c.next_review_at <= datetime('now'))
            ORDER BY
              CASE WHEN c.queue IN (1, 3) THEN 0 ELSE 1 END,
              c.due_timestamp ASC NULLS LAST,
              c.next_review_at ASC NULLS LAST
            LIMIT 50
          `)
          .bind(deck_id)
          .all();

        const cards = cardsResult.results.map((row: Record<string, unknown>) => ({
          id: row.id as string,
          card_type: row.card_type as string,
          queue: row.queue as number,
          ease_factor: row.ease_factor as number,
          interval: row.interval as number,
          learning_step: row.learning_step as number,
          note: {
            id: row.note_id as string,
            hanzi: row.hanzi as string,
            pinyin: row.pinyin as string,
            english: row.english as string,
            audio_url: row.audio_url as string | null,
            fun_facts: row.fun_facts as string | null,
          },
        }));

        // Get queue counts
        const countsResult = await this.env.DB
          .prepare(`
            SELECT
              SUM(CASE WHEN c.queue = 0 AND (c.next_review_at IS NULL OR c.next_review_at <= datetime('now')) THEN 1 ELSE 0 END) as new_count,
              SUM(CASE WHEN c.queue IN (1, 3) AND (c.next_review_at IS NULL OR c.next_review_at <= datetime('now')) THEN 1 ELSE 0 END) as learning_count,
              SUM(CASE WHEN c.queue = 2 AND c.next_review_at <= datetime('now') THEN 1 ELSE 0 END) as review_count
            FROM cards c
            JOIN notes n ON c.note_id = n.id
            WHERE n.deck_id = ?
          `)
          .bind(deck_id)
          .first<{ new_count: number; learning_count: number; review_count: number }>();

        const counts = {
          new: countsResult?.new_count || 0,
          learning: countsResult?.learning_count || 0,
          review: countsResult?.review_count || 0,
        };

        // Compute interval previews for first card
        const intervalPreviews = cards.length > 0
          ? computeIntervalPreviews(cards[0])
          : { 0: { intervalText: '', queue: 0 }, 1: { intervalText: '', queue: 0 }, 2: { intervalText: '', queue: 0 }, 3: { intervalText: '', queue: 0 } };

        const result = {
          deck: { id: deck.id, name: deck.name },
          cards,
          counts,
          intervalPreviews,
        };

        return {
          content: [{
            type: "text" as const,
            text: `Opening study session for "${deck.name}" with ${cards.length} cards due.`,
          }],
          structuredContent: result,
        };
      }
    );

    // Submit review tool - called by the UI to record reviews
    // Hidden from model (app-only visibility)
    registerAppTool(
      this.server,
      "submit_review",
      {
        title: "Submit Review",
        description: "Submit a card review rating (called by study UI)",
        inputSchema: z.object({
          card_id: z.string().describe("The card ID"),
          rating: z.number().min(0).max(3).describe("Rating: 0=again, 1=hard, 2=good, 3=easy"),
          time_spent_ms: z.number().optional().describe("Time spent in milliseconds"),
          user_answer: z.string().optional().describe("User's typed answer"),
        }),
        _meta: {
          ui: {
            resourceUri: studyResourceUri,
            visibility: ["app"], // Only callable by the UI, not the model
          },
        },
      },
      async ({ card_id, rating, time_spent_ms, user_answer }) => {
        // Get card with note to verify ownership
        const card = await this.env.DB
          .prepare(`
            SELECT c.*, n.deck_id, d.user_id
            FROM cards c
            JOIN notes n ON c.note_id = n.id
            JOIN decks d ON n.deck_id = d.id
            WHERE c.id = ? AND d.user_id = ?
          `)
          .bind(card_id, userId)
          .first<{
            id: string;
            note_id: string;
            deck_id: string;
            queue: number;
            ease_factor: number;
            interval: number;
            repetitions: number;
            learning_step: number;
          }>();

        if (!card) {
          return {
            content: [{ type: "text" as const, text: `Card not found: ${card_id}` }],
            isError: true,
          };
        }

        // Simple SM-2 implementation
        let newQueue = card.queue;
        let newEase = card.ease_factor;
        let newInterval = card.interval;
        let newReps = card.repetitions;
        let newLearningStep = card.learning_step;
        let nextReviewAt: Date;

        const isNew = card.queue === 0;
        const isLearning = card.queue === 1 || card.queue === 3;

        if (isNew || isLearning) {
          // Learning/new card logic
          if (rating === 0) {
            // Again - restart learning
            newQueue = 1;
            newLearningStep = 0;
            nextReviewAt = new Date(Date.now() + 60 * 1000); // 1 min
          } else if (rating === 3) {
            // Easy - graduate immediately
            newQueue = 2;
            newInterval = 4;
            newReps = 1;
            nextReviewAt = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);
          } else {
            // Hard/Good - advance learning step
            newLearningStep = Math.min(newLearningStep + 1, 2);
            if (newLearningStep >= 2) {
              // Graduate to review
              newQueue = 2;
              newInterval = 1;
              newReps = 1;
              nextReviewAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
            } else {
              newQueue = 1;
              const stepMinutes = [1, 10][newLearningStep] || 10;
              nextReviewAt = new Date(Date.now() + stepMinutes * 60 * 1000);
            }
          }
        } else {
          // Review card logic
          if (rating === 0) {
            // Again - relearn
            newQueue = 3;
            newLearningStep = 0;
            newEase = Math.max(1.3, newEase - 0.2);
            nextReviewAt = new Date(Date.now() + 10 * 60 * 1000);
          } else {
            // Hard/Good/Easy
            const multipliers = { 1: 1.2, 2: newEase, 3: newEase * 1.3 };
            const easeAdjust = { 1: -0.15, 2: 0, 3: 0.15 };

            newInterval = Math.max(1, Math.round(newInterval * multipliers[rating as 1 | 2 | 3]));
            newEase = Math.max(1.3, Math.min(3.0, newEase + easeAdjust[rating as 1 | 2 | 3]));
            newReps++;
            newQueue = 2;
            nextReviewAt = new Date(Date.now() + newInterval * 24 * 60 * 60 * 1000);
          }
        }

        // Update card
        await this.env.DB
          .prepare(`
            UPDATE cards SET
              queue = ?,
              ease_factor = ?,
              interval = ?,
              repetitions = ?,
              learning_step = ?,
              next_review_at = ?,
              due_timestamp = NULL
            WHERE id = ?
          `)
          .bind(
            newQueue,
            newEase,
            newInterval,
            newReps,
            newLearningStep,
            nextReviewAt.toISOString(),
            card_id
          )
          .run();

        // Record review event
        const reviewId = generateId();
        await this.env.DB
          .prepare(`
            INSERT INTO review_events (id, card_id, user_id, rating, time_spent_ms, user_answer, reviewed_at)
            VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
          `)
          .bind(reviewId, card_id, userId, rating, time_spent_ms || null, user_answer || null)
          .run();

        // Get updated queue counts
        const countsResult = await this.env.DB
          .prepare(`
            SELECT
              SUM(CASE WHEN c.queue = 0 AND (c.next_review_at IS NULL OR c.next_review_at <= datetime('now')) THEN 1 ELSE 0 END) as new_count,
              SUM(CASE WHEN c.queue IN (1, 3) AND (c.next_review_at IS NULL OR c.next_review_at <= datetime('now')) THEN 1 ELSE 0 END) as learning_count,
              SUM(CASE WHEN c.queue = 2 AND c.next_review_at <= datetime('now') THEN 1 ELSE 0 END) as review_count
            FROM cards c
            JOIN notes n ON c.note_id = n.id
            WHERE n.deck_id = ?
          `)
          .bind(card.deck_id)
          .first<{ new_count: number; learning_count: number; review_count: number }>();

        const counts = {
          new: countsResult?.new_count || 0,
          learning: countsResult?.learning_count || 0,
          review: countsResult?.review_count || 0,
        };

        // Compute interval previews for next potential card (using updated state pattern)
        const intervalPreviews = computeIntervalPreviews({
          queue: newQueue,
          ease_factor: newEase,
          interval: newInterval,
          learning_step: newLearningStep,
        });

        return {
          content: [{
            type: "text" as const,
            text: `Review recorded`,
          }],
          structuredContent: { counts, intervalPreviews },
        };
      }
    );

    // Register the study app HTML resource
    registerAppResource(
      this.server,
      studyResourceUri,
      studyResourceUri,
      { mimeType: RESOURCE_MIME_TYPE },
      async () => ({
        contents: [{
          uri: studyResourceUri,
          mimeType: RESOURCE_MIME_TYPE,
          text: STUDY_APP_HTML,
        }],
      })
    );
  }
}

// Create the Hono app for handling OAuth and other routes
const app = new Hono<{ Bindings: Env & { OAUTH_PROVIDER: OAuthHelpers } }>();

// Health check
app.get("/", (c) => {
  return c.json({
    status: "ok",
    name: "Chinese Learning MCP Server",
    version: "1.0.0",
    transport: "Streamable HTTP with OAuth 2.1",
    endpoint: "/mcp",
  });
});

app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

// OAuth Authorization endpoint - handles the initial authorization request
app.get("/authorize", async (c) => {
  const oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
  if (!oauthReqInfo.clientId) {
    return c.text("Invalid request - missing client_id", 400);
  }

  // Store the OAuth request info and redirect to Google
  const stateId = generateId();
  await c.env.OAUTH_KV.put(`oauth_state:${stateId}`, JSON.stringify(oauthReqInfo), {
    expirationTtl: 600, // 10 minutes
  });

  const redirectUri = new URL("/callback", c.req.url).href;
  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: stateId,
    access_type: "offline",
    prompt: "consent",
  });

  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

// OAuth Callback - handles the callback from Google
app.get("/callback", async (c) => {
  const code = c.req.query("code");
  const stateId = c.req.query("state");
  const error = c.req.query("error");

  if (error || !code || !stateId) {
    return c.text(`OAuth failed: ${error || "missing params"}`, 400);
  }

  // Retrieve the original OAuth request info
  const storedState = await c.env.OAUTH_KV.get(`oauth_state:${stateId}`);
  if (!storedState) {
    return c.text("Invalid or expired state", 400);
  }

  const oauthReqInfo: AuthRequest = JSON.parse(storedState);

  // Clean up the state
  await c.env.OAUTH_KV.delete(`oauth_state:${stateId}`);

  // Exchange code for tokens with Google
  const redirectUri = new URL("/callback", c.req.url).href;
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenResponse.ok) {
    const err = await tokenResponse.text();
    return c.text(`Token exchange failed: ${err}`, 500);
  }

  const tokens = await tokenResponse.json() as { access_token: string };

  // Get user info from Google
  const userInfoResponse = await fetch(
    "https://www.googleapis.com/oauth2/v2/userinfo",
    { headers: { Authorization: `Bearer ${tokens.access_token}` } }
  );

  if (!userInfoResponse.ok) {
    return c.text("Failed to get user info from Google", 500);
  }

  const googleUser = await userInfoResponse.json() as {
    id: string;
    email: string;
    name: string;
    picture: string;
  };

  // Get or create user in database
  let user = await c.env.DB
    .prepare("SELECT * FROM users WHERE google_id = ?")
    .bind(googleUser.id)
    .first<User>();

  if (!user) {
    // Check by email
    user = await c.env.DB
      .prepare("SELECT * FROM users WHERE email = ?")
      .bind(googleUser.email)
      .first<User>();

    if (user) {
      // Link Google account
      await c.env.DB
        .prepare(`
          UPDATE users SET
            google_id = ?,
            name = ?,
            picture_url = ?,
            last_login_at = datetime('now')
          WHERE id = ?
        `)
        .bind(googleUser.id, googleUser.name, googleUser.picture, user.id)
        .run();
    } else {
      // Create new user
      const newUserId = generateId();
      await c.env.DB
        .prepare(`
          INSERT INTO users (id, email, google_id, name, picture_url, role, is_admin, last_login_at)
          VALUES (?, ?, ?, ?, ?, 'student', 0, datetime('now'))
        `)
        .bind(newUserId, googleUser.email, googleUser.id, googleUser.name, googleUser.picture)
        .run();

      user = await c.env.DB
        .prepare("SELECT * FROM users WHERE id = ?")
        .bind(newUserId)
        .first<User>();
    }
  } else {
    // Update last login
    await c.env.DB
      .prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?")
      .bind(user.id)
      .run();
  }

  if (!user) {
    return c.text("Failed to create or get user", 500);
  }

  // Complete the OAuth flow - this issues tokens to the MCP client
  const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthReqInfo,
    userId: user.id,
    metadata: {
      label: user.name || user.email || "User",
    },
    scope: oauthReqInfo.scope,
    props: {
      userId: user.id,
      userEmail: user.email,
      userName: user.name,
    } as Props,
  });

  return c.redirect(redirectTo);
});

// Export the OAuthProvider wrapper
export default new OAuthProvider({
  apiHandlers: {
    "/mcp": ChineseLearningMCPv2.serve("/mcp"),
  },
  defaultHandler: app,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});
