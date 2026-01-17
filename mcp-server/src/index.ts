import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import OAuthProvider, {
  type AuthRequest,
  type OAuthHelpers,
} from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";

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
      "Get a deck with all its notes",
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

        const notes = await this.env.DB
          .prepare('SELECT * FROM notes WHERE deck_id = ? ORDER BY created_at DESC')
          .bind(deck_id)
          .all<Note>();

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ ...deck, notes: notes.results }, null, 2),
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
            SELECT cr.id, cr.rating, cr.time_spent_ms, cr.user_answer, cr.recording_url, cr.reviewed_at, c.card_type
            FROM card_reviews cr
            JOIN cards c ON cr.card_id = c.id
            WHERE c.note_id = ?
            ORDER BY cr.reviewed_at DESC
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
            SELECT COUNT(*) as count FROM card_reviews cr
            JOIN study_sessions ss ON cr.session_id = ss.id
            WHERE ss.user_id = ? AND date(cr.reviewed_at) = date('now')
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
