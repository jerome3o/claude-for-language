import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import { CARD_STANDARD, CARD_STANDARD_SHORT } from '../../shared/cards/standard';
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
import { STUDY_APP_HTML } from "./app-html.js";
import { appServer } from "./tools/apps.js";

import type { Env, Props } from './types.js';
import { ApiClient, ApiError } from './api.js';
import { errorResult, guard, textResult, type ToolContext } from './tools/context.js';
import { registerStudentTools } from './tools/students.js';
import { registerContentTools } from './tools/content.js';
import { registerTutorApps } from './tools/apps.js';

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
  new_cards_per_day?: number;
  secondary_cards_per_day?: number;
  interval_modifier: number;
  request_retention: number;
  easy_interval: number;
  maximum_interval: number;
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
  sentence_clue: string | null;
  sentence_clue_pinyin: string | null;
  sentence_clue_translation: string | null;
  sentence_clue_audio_url: string | null;
  created_at: string;
  updated_at: string;
}

// Utility function to generate IDs
function generateId(): string {
  return crypto.randomUUID();
}

/** The daily new-card budgets a freshly created deck gets (shared/decks defaults, applied by the API). */
const NEW_DECK_DEFAULTS = { new_cards_per_day: 3, secondary_cards_per_day: 6 } as const;

/** Deck scheduling fields `update_deck` accepts; each goes to PUT /api/decks/:id/settings. */
const DECK_SETTING_FIELDS = ['new_cards_per_day', 'secondary_cards_per_day', 'interval_modifier', 'request_retention', 'easy_interval', 'maximum_interval'] as const;

/** Fields `update_note` may change through PUT /api/notes/:id. */
const NOTE_PATCH_FIELDS = ['hanzi', 'pinyin', 'english', 'fun_facts', 'sentence_clue', 'sentence_clue_pinyin', 'sentence_clue_translation'] as const;

/** Only the keys whose value was given, so an omitted field is left alone by the API. */
function definedFields<T extends Record<string, unknown>>(input: T, keys: readonly (keyof T)[]): Partial<T> {
  const out: Partial<T> = {};
  for (const key of keys) {
    if (input[key] !== undefined) out[key] = input[key];
  }
  return out;
}

/** The `problems` list of a 400 from the content service, one per line, or ''. */
function problemLines(err: ApiError): string {
  const body = err.body as { problems?: unknown } | null;
  if (!body || typeof body !== 'object' || !Array.isArray(body.problems)) return '';
  return '\n- ' + body.problems
    .map((p: unknown) => (typeof p === 'string' ? p : p && typeof p === 'object' && 'message' in p ? `${'field' in p ? `${(p as { field: string }).field}: ` : ''}${(p as { message: string }).message}` : JSON.stringify(p)))
    .join('\n- ');
}

// Legacy class (non-SQLite) - kept for migration compatibility
export class ChineseLearningMCP extends McpAgent<Env, Record<string, never>, Props> {
  server = new McpServer({ name: "Legacy", version: "1.0.0" });
  async init() {}
}

// MCP Server with tools (v2 uses SQLite-backed Durable Object)
export class ChineseLearningMCPv2 extends McpAgent<Env, Record<string, never>, Props> {
  server = new McpServer(
    { name: "Chinese Learning App", version: "1.0.0" },
    {
      // Every Claude that makes cards through this server sees the house style
      // (shared/cards/standard.ts); the API enforces the HARD rules.
      instructions: `This server manages a Chinese learner's flashcards, homework decks, readers and lessons.\n\n${CARD_STANDARD}`,
    }
  );

  async init() {
    const userId = this.props!.userId;

    // Every write to decks / notes / cards goes through the main API as this
    // user (the worker's content service owns card generation, tombstones,
    // TTS and the sentence-set queue). The legacy tools below and the tutor
    // tool modules at the end share this one context.
    const ctx: ToolContext = {
      server: this.server,
      env: this.env,
      userId,
      userName: this.props!.userName,
      userEmail: this.props!.userEmail,
      api: new ApiClient(this.env, userId),
    };
    const api = ctx.api;

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
        fields: z.array(z.enum(['hanzi', 'pinyin', 'english', 'audio_url', 'fun_facts', 'sentence_clue', 'sentence_clue_pinyin', 'sentence_clue_translation', 'sentence_clue_audio_url', 'created_at', 'updated_at', 'context']))
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
      `Create a new vocabulary deck. New decks default to ${NEW_DECK_DEFAULTS.new_cards_per_day} new cards + ${NEW_DECK_DEFAULTS.secondary_cards_per_day} secondary cards a day (change them with update_deck).`,
      {
        name: z.string().describe("Name of the deck"),
        description: z.string().optional().describe("Description of the deck"),
      },
      async ({ name, description }) => guard(async () => {
        const deck = await api.post<Deck>('/api/decks', { name, description });
        return textResult(`Created deck: ${JSON.stringify(deck, null, 2)}`);
      })
    );

    this.server.tool(
      "update_deck",
      "Update a deck's name, description, or SRS scheduling parameters",
      {
        deck_id: z.string().describe("The deck ID"),
        name: z.string().optional().describe("New name for the deck"),
        description: z.string().optional().describe("New description for the deck"),
        new_cards_per_day: z.number().int().min(0).optional().describe(`Maximum number of new cards introduced per day (new decks start at ${NEW_DECK_DEFAULTS.new_cards_per_day})`),
        secondary_cards_per_day: z.number().int().min(0).optional().describe(`Daily quota for secondary new cards — new cards whose note already has a reviewed card. Additive to new_cards_per_day (new decks start at ${NEW_DECK_DEFAULTS.secondary_cards_per_day})`),
        interval_modifier: z.number().optional().describe("Multiplier for review intervals as percentage (e.g., 100 = default, 110 = 10% longer)"),
        request_retention: z.number().optional().describe("Target retention rate (e.g., 0.85 = 85%). Range: 0.7 to 0.97"),
        easy_interval: z.number().optional().describe("Interval in days for cards rated easy"),
        maximum_interval: z.number().optional().describe("Maximum review interval in days"),
      },
      async ({ deck_id, ...fields }) => guard(async () => {
        const details = definedFields(fields, ['name', 'description']);
        const settings = definedFields(fields, DECK_SETTING_FIELDS);
        if (Object.keys(details).length === 0 && Object.keys(settings).length === 0) {
          return errorResult("No updates provided");
        }

        let deck: Deck | null = null;
        if (Object.keys(details).length > 0) {
          deck = await api.put<Deck>(`/api/decks/${encodeURIComponent(deck_id)}`, details);
        }
        if (Object.keys(settings).length > 0) {
          try {
            deck = await api.put<Deck>(`/api/decks/${encodeURIComponent(deck_id)}/settings`, settings);
          } catch (err) {
            if (err instanceof ApiError && deck) {
              // Name/description already landed; say so rather than hiding it.
              return errorResult(`Deck name/description updated, but the settings were rejected: ${err.message} (HTTP ${err.status})${problemLines(err)}`);
            }
            if (err instanceof ApiError && err.status === 400) {
              return errorResult(`Settings rejected: ${err.message}${problemLines(err)}`);
            }
            throw err;
          }
        }

        return textResult(`Updated deck: ${JSON.stringify(deck, null, 2)}`);
      })
    );

    this.server.tool(
      "delete_deck",
      "Delete a deck and all its notes/cards",
      { deck_id: z.string().describe("The deck ID to delete") },
      async ({ deck_id }) => guard(async () => {
        // Read-only pre-check: the API's delete is a silent no-op for a deck
        // that isn't the caller's, and the name makes a better confirmation.
        const deck = await this.env.DB
          .prepare('SELECT id, name FROM decks WHERE id = ? AND user_id = ?')
          .bind(deck_id, userId)
          .first<Pick<Deck, 'id' | 'name'>>();

        if (!deck) {
          return errorResult(`Deck not found: ${deck_id}`);
        }

        // The API writes the tombstones (deck + notes) and cleans up audio.
        await api.delete(`/api/decks/${encodeURIComponent(deck_id)}`);

        return textResult(`Deleted deck: "${deck.name}" (${deck_id})`);
      })
    );

    // ============ Lesson Notes (external tutor homework) ============

    this.server.tool(
      "add_lesson_note",
      "Record raw lesson notes from the user's tutor (vocab lists, sentences, etc). The text is stored verbatim and used as context when generating grammar practice and roleplay sessions. Do NOT reformat or parse — paste exactly what the tutor sent. Safe to call from a scheduled/recurring job: if a note with identical text already exists for this user, no duplicate is created — the existing note's id is returned instead.",
      {
        raw_text: z.string().describe("The tutor's notes verbatim — any format"),
        given_at: z.string().optional().describe("Free-form date/label, e.g. 'Tue lesson' or '2026-04-28'"),
      },
      async ({ raw_text, given_at }) => {
        const trimmed = raw_text.trim();
        const existing = await this.env.DB.prepare(
          `SELECT id, given_at FROM lesson_notes WHERE user_id = ? AND raw_text = ? LIMIT 1`
        ).bind(userId, trimmed).first<{ id: string; given_at: string | null }>();
        if (existing) {
          return {
            content: [{
              type: "text" as const,
              text: `Skipped — identical lesson note already exists${existing.given_at ? ` for ${existing.given_at}` : ''}. id=${existing.id}`,
            }],
          };
        }
        const id = crypto.randomUUID();
        await this.env.DB.prepare(
          `INSERT INTO lesson_notes (id, user_id, raw_text, given_at) VALUES (?, ?, ?, ?)`
        ).bind(id, userId, trimmed, given_at?.trim() || null).run();
        return {
          content: [{
            type: "text" as const,
            text: `Saved lesson note (${trimmed.length} chars)${given_at ? ` for ${given_at}` : ''}. id=${id}`,
          }],
        };
      }
    );

    this.server.tool(
      "list_lesson_notes",
      "List recent lesson notes (most recent first).",
      { limit: z.number().optional().describe("How many to return (default 5)") },
      async ({ limit }) => {
        const r = await this.env.DB.prepare(
          `SELECT id, raw_text, given_at, created_at FROM lesson_notes WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`
        ).bind(userId, limit ?? 5).all();
        return {
          content: [{
            type: "text" as const,
            text: r.results.length === 0
              ? "No lesson notes yet."
              : r.results
                  .map((n: any) => `[${n.given_at || n.created_at}] (id=${n.id})\n${n.raw_text}`)
                  .join("\n\n---\n\n"),
          }],
        };
      }
    );

    // ============ Custom Mini Lessons ============

    this.server.tool(
      "create_custom_lesson",
      `Create a custom mini lesson that appears in the user's next study session (fully offline). A lesson is ordered sections, each holding any number of exercises of any type in any order. Exercise objects (each needs a "type"):
- {type:"note", title?, body?, sentences?:[{hanzi,pinyin?,english?}]} — teaching text with example sentences (sentences get TTS). Not scored.
- {type:"scramble", english, tiles:[...], correct_order:[...], alt_orders?} — arrange tiles into the sentence; tiles must be exactly a permutation of correct_order.
- {type:"choice", question, options:[{hanzi,pinyin?,english?}], correct:<index>, explanation?} — multiple choice (2-5 options).
- {type:"translate", english, reference_hanzi, reference_pinyin?, note?} — translate EN→ZH, self-assessed against the reference.
- {type:"match", pairs:[{hanzi,pinyin?,english}]} — connect hanzi with meanings (2-8 pairs, no duplicate hanzi/english).
- {type:"describe_image", image_prompt, task?, reference_hanzi, reference_pinyin?, reference_english?} — an illustration is generated in the background from image_prompt (write it in English, detailed, no text in the image); the learner describes it aloud and self-assesses.
- {type:"speak", prompt, example?:{hanzi,pinyin?,english?}} — say your own sentence out loud, self-assessed.
- {type:"listen_choice", audio:{hanzi,pinyin?,english?}, question?, options:[{hanzi,pinyin?,english?}], correct:<index>, explanation?} — LISTENING: the audio hanzi is played via TTS (never shown until answered); the learner picks the option matching what they heard. Ideal for tone/minimal-pair discrimination (e.g. hear 我又去了 and choose 又 vs 有).
- {type:"listen_translate", audio:{hanzi,pinyin?,english}, note?} — LISTENING: the audio hanzi is played (hidden); the learner translates what they heard, self-assessed against audio.english (required).
Keep lessons short and focused (1-3 sections, ~4-10 exercises). Always use tone-marked pinyin (nǐ hǎo), never tone numbers. Invalid specs are rejected with a list of problems — fix them and retry.`,
      {
        title: z.string().describe("Short lesson title, e.g. 'Ordering at a café'"),
        icon: z.string().optional().describe("One emoji for the lesson (default 🎓)"),
        description: z.string().optional().describe("One sentence on what the lesson covers"),
        sections: z.array(z.object({
          title: z.string().optional().describe("Optional section heading"),
          exercises: z.array(z.record(z.unknown())).describe("Exercise objects as documented in the tool description"),
        })).describe("Ordered sections of exercises"),
      },
      async ({ title, icon, description, sections }) => guard(async () => {
        // The main API is the single write path: it validates the spec and
        // queues illustration generation for describe_image exercises.
        let data: { id?: string; image_jobs?: number };
        try {
          data = await api.post<{ id?: string; image_jobs?: number }>('/api/custom-lessons', { spec: { title, icon, description, sections } });
        } catch (err) {
          if (err instanceof ApiError) return errorResult(`Lesson rejected: ${err.message}${problemLines(err)}`);
          throw err;
        }
        return textResult(`Created custom lesson "${title}" (id=${data.id}). It will appear in the user's next study session.${data.image_jobs ? ` ${data.image_jobs} illustration(s) generating in the background.` : ''}`);
      })
    );

    this.server.tool(
      "list_custom_lessons",
      "List the user's custom mini lessons: pending ones waiting in the study queue and completed ones.",
      {
        status: z.enum(["active", "done", "all"]).optional().describe("Filter (default: all)"),
      },
      async ({ status }) => {
        const filter = status && status !== 'all' ? `AND status = '${status === 'active' ? 'active' : 'done'}'` : '';
        const r = await this.env.DB.prepare(
          `SELECT id, title, description, icon, source, status, created_at FROM custom_lessons WHERE user_id = ? ${filter} ORDER BY created_at DESC LIMIT 50`
        ).bind(userId).all();
        return {
          content: [{
            type: "text" as const,
            text: r.results.length === 0
              ? "No custom lessons yet."
              : r.results
                  .map((l: any) => `${l.icon || '🎓'} ${l.title} — ${l.status} (source: ${l.source}, id: ${l.id})${l.description ? `\n   ${l.description}` : ''}`)
                  .join("\n"),
          }],
        };
      }
    );

    this.server.tool(
      "delete_custom_lesson",
      "Delete a custom mini lesson (e.g. one created by mistake). Completed lessons can also be deleted.",
      { lesson_id: z.string().describe("The lesson id") },
      async ({ lesson_id }) => {
        const r = await this.env.DB.prepare(
          `DELETE FROM custom_lessons WHERE id = ? AND user_id = ?`
        ).bind(lesson_id, userId).run();
        const deleted = (r.meta?.changes ?? 0) > 0;
        return {
          content: [{
            type: "text" as const,
            text: deleted ? `Deleted lesson ${lesson_id}.` : `Lesson not found: ${lesson_id}`,
          }],
          ...(deleted ? {} : { isError: true }),
        };
      }
    );

    this.server.tool(
      "get_custom_lesson",
      "Get one custom mini lesson with its FULL spec (title, icon, description, sections of exercises). Use this before update_custom_lesson so you can edit the existing content rather than rewriting from memory.",
      { lesson_id: z.string().describe("The lesson id (from list_custom_lessons)") },
      async ({ lesson_id }) => {
        const row = await this.env.DB.prepare(
          `SELECT id, title, description, icon, source, status, created_at, updated_at, spec FROM custom_lessons WHERE id = ? AND user_id = ?`
        ).bind(lesson_id, userId).first<any>();
        if (!row) {
          return { content: [{ type: "text" as const, text: `Lesson not found: ${lesson_id}` }], isError: true };
        }
        const { spec, ...meta } = row;
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ ...meta, spec: JSON.parse(spec) }, null, 2),
          }],
        };
      }
    );

    this.server.tool(
      "update_custom_lesson",
      `Replace an existing custom mini lesson's content in place. The lesson keeps its id, so the user's completion history and FSRS schedule carry over — use this to fix a bad question, add exercises, or reword explanations without resetting progress. Send the FULL updated spec (title, icon, description, sections) — it replaces the old one entirely; fetch the current spec with get_custom_lesson first and edit it. Exercise types and rules are the same as create_custom_lesson. Illustrations already generated for describe_image exercises are kept when the image_prompt is unchanged.`,
      {
        lesson_id: z.string().describe("The lesson id (from list_custom_lessons / get_custom_lesson)"),
        title: z.string().describe("Lesson title"),
        icon: z.string().optional().describe("One emoji for the lesson"),
        description: z.string().optional().describe("One sentence on what the lesson covers"),
        sections: z.array(z.object({
          title: z.string().optional().describe("Optional section heading"),
          exercises: z.array(z.record(z.unknown())).describe("Exercise objects as documented in create_custom_lesson"),
        })).describe("The complete, updated list of sections"),
      },
      async ({ lesson_id, title, icon, description, sections }) => guard(async () => {
        // Same single write path as create: the main API validates the spec,
        // preserves generated illustrations, and queues any new ones.
        let data: { id?: string; image_jobs?: number };
        try {
          data = await api.put<{ id?: string; image_jobs?: number }>(`/api/custom-lessons/${encodeURIComponent(lesson_id)}`, { spec: { title, icon, description, sections } });
        } catch (err) {
          if (err instanceof ApiError) return errorResult(`Update rejected: ${err.message}${problemLines(err)}`);
          throw err;
        }
        return textResult(`Updated custom lesson "${title}" (id=${lesson_id}). The user's device picks up the new content on its next sync; completion history and scheduling are unchanged.${data.image_jobs ? ` ${data.image_jobs} new illustration(s) generating in the background.` : ''}`);
      })
    );

    // ============ Note Tools ============

    this.server.tool(
      "add_note",
      `Add a vocabulary note to a deck (creates 3 cards automatically). TTS audio for the word and its example sentence is generated in the background — the note is usable at once and audio_url fills in shortly after. ${CARD_STANDARD_SHORT}`,
      {
        deck_id: z.string().describe("The deck ID"),
        hanzi: z.string().describe("Chinese characters (simplified)"),
        pinyin: z.string().describe("Pinyin with tone marks (e.g., nǐ hǎo)"),
        english: z.string().describe("English translation"),
        fun_facts: z.string().optional().describe("Substantive learning note: grammar patterns, cultural context, common mistakes, or disambiguation from similar words. Focus on what helps the learner understand and remember correctly."),
        sentence_clue: z.string().optional().describe("A contextual example sentence (in Chinese) that helps disambiguate this word from similar-sounding words"),
        sentence_clue_pinyin: z.string().optional().describe("Pinyin for the sentence clue"),
        sentence_clue_translation: z.string().optional().describe("English translation of the sentence clue"),
      },
      async ({ deck_id, hanzi, pinyin, english, fun_facts, sentence_clue, sentence_clue_pinyin, sentence_clue_translation }) => guard(async () => {
        // Read-only pre-check across every deck the user owns; the API itself
        // only rejects duplicates within a deck.
        const existing = await this.env.DB
          .prepare('SELECT n.id FROM notes n JOIN decks d ON n.deck_id = d.id WHERE d.user_id = ? AND n.hanzi = ?')
          .bind(userId, hanzi)
          .first();

        if (existing) {
          return errorResult(`Duplicate hanzi: "${hanzi}" already exists in your decks. Skipping to avoid duplicates.`);
        }

        // The API creates the note + 3 cards, validates the pinyin, starts
        // TTS for the word and the sentence, and queues the sentence set.
        const note = await api.post<Note>(`/api/decks/${encodeURIComponent(deck_id)}/notes`, {
          hanzi,
          pinyin,
          english,
          fun_facts,
          sentence_clue,
          sentence_clue_pinyin,
          sentence_clue_translation,
        });

        return textResult(`Added note: ${note.hanzi} (${note.pinyin}) - ${note.english} (id=${note.id}). Audio is being generated in the background.`);
      })
    );

    this.server.tool(
      "batch_add_notes",
      `Add multiple vocabulary notes to a deck at once (more efficient than calling add_note repeatedly; up to 500 per call). Each note gets 3 cards; TTS audio is queued server-side and fills in shortly after, so the call returns without waiting. Hanzi already in any of your decks (or repeated in the request) are skipped; a note the API rejects (missing field, tone-number pinyin, symbols on the card) is listed under failed while the rest are created. ${CARD_STANDARD_SHORT}`,
      {
        deck_id: z.string().describe("The deck ID"),
        notes: z.array(z.object({
          hanzi: z.string().describe("Chinese characters (simplified)"),
          pinyin: z.string().describe("Pinyin with tone marks (e.g., nǐ hǎo)"),
          english: z.string().describe("English translation"),
          fun_facts: z.string().optional().describe("Substantive learning note: grammar patterns, cultural context, common mistakes, or disambiguation from similar words. Focus on what helps the learner understand and remember correctly."),
          sentence_clue: z.string().optional().describe("A contextual example sentence (in Chinese) that helps disambiguate this word from similar-sounding words"),
          sentence_clue_pinyin: z.string().optional().describe("Pinyin for the sentence clue"),
          sentence_clue_translation: z.string().optional().describe("English translation of the sentence clue"),
        })).min(1).max(500).describe("Array of notes to add (max 500)"),
      },
      async ({ deck_id, notes }) => guard(async () => {
        // Read-only pre-check: which hanzi already exist across all the user's decks.
        const incomingHanzi = notes.map(n => n.hanzi);
        const placeholders = incomingHanzi.map(() => '?').join(', ');
        const existingRows = await this.env.DB
          .prepare(`SELECT n.hanzi FROM notes n JOIN decks d ON n.deck_id = d.id WHERE d.user_id = ? AND n.hanzi IN (${placeholders})`)
          .bind(userId, ...incomingHanzi)
          .all<{ hanzi: string }>();
        const duplicateHanziSet = new Set((existingRows.results || []).map(r => r.hanzi));

        // Repeated hanzi within THIS call are also skipped (the pre-check only
        // sees what was in the DB before the call).
        const seenInBatch = new Set<string>();
        const skipped: { hanzi: string; pinyin: string }[] = [];
        const toCreate: typeof notes = [];
        for (const note of notes) {
          if (duplicateHanziSet.has(note.hanzi) || seenInBatch.has(note.hanzi)) {
            skipped.push({ hanzi: note.hanzi, pinyin: note.pinyin });
            continue;
          }
          seenInBatch.add(note.hanzi);
          toCreate.push(note);
        }

        // One request: the API creates each note with its cards, records
        // per-row failures, and queues TTS + sentence sets in the background.
        let created: Note[] = [];
        let failed: { index: number; hanzi: string; error: string }[] = [];
        if (toCreate.length > 0) {
          const result = await api.post<{ created: Note[]; failed: { index: number; hanzi: string; error: string }[] }>(
            `/api/decks/${encodeURIComponent(deck_id)}/notes/batch`,
            { notes: toCreate },
          );
          created = result.created ?? [];
          failed = result.failed ?? [];
        }

        let summary = `Added ${created.length}/${notes.length} notes:\n${created.map(n => `  - ${n.hanzi} (${n.pinyin})`).join('\n')}`;
        if (created.length > 0) {
          summary += `\n\nAudio is being generated in the background and will be available shortly.`;
        }
        if (failed.length > 0) {
          summary += `\n\nFailed ${failed.length} (not saved):\n${failed.map(f => `  - ${f.hanzi}: ${f.error}`).join('\n')}`;
        }
        if (skipped.length > 0) {
          summary += `\n\nSkipped ${skipped.length} duplicate(s) (hanzi already exists in your decks or appeared more than once in this request):\n${skipped.map(r => `  - ${r.hanzi} (${r.pinyin})`).join('\n')}`;
        }

        return textResult(summary);
      })
    );

    this.server.tool(
      "update_note",
      `Update an existing note. Only the fields given change. A changed hanzi gets a new word clip and a changed sentence_clue a new sentence clip, both generated in the background. ${CARD_STANDARD_SHORT}`,
      {
        note_id: z.string().describe("The note ID"),
        hanzi: z.string().optional().describe("New Chinese characters"),
        pinyin: z.string().optional().describe("New pinyin"),
        english: z.string().optional().describe("New English translation"),
        fun_facts: z.string().optional().describe("Substantive learning note: grammar patterns, cultural context, common mistakes, or disambiguation from similar words"),
        sentence_clue: z.string().optional().describe("A contextual example sentence (in Chinese) that helps disambiguate this word from similar-sounding words"),
        sentence_clue_pinyin: z.string().optional().describe("Pinyin for the sentence clue"),
        sentence_clue_translation: z.string().optional().describe("English translation of the sentence clue"),
      },
      async ({ note_id, ...fields }) => guard(async () => {
        const patch = definedFields(fields, NOTE_PATCH_FIELDS);
        if (Object.keys(patch).length === 0) {
          return errorResult("No updates provided");
        }

        // Ownership is checked by the API (404 when the note isn't the user's).
        const updatedNote = await api.put<Note>(`/api/notes/${encodeURIComponent(note_id)}`, patch);

        return textResult(`Updated note: ${JSON.stringify(updatedNote, null, 2)}`);
      })
    );

    this.server.tool(
      "delete_note",
      "Delete a note and its cards",
      { note_id: z.string().describe("The note ID to delete") },
      async ({ note_id }) => guard(async () => {
        // Read-only pre-check so the confirmation can name the word.
        const note = await this.env.DB
          .prepare(`
            SELECT n.id, n.hanzi, n.pinyin FROM notes n
            JOIN decks d ON n.deck_id = d.id
            WHERE n.id = ? AND d.user_id = ?
          `)
          .bind(note_id, userId)
          .first<Pick<Note, 'id' | 'hanzi' | 'pinyin'>>();

        if (!note) {
          return errorResult(`Note not found: ${note_id}`);
        }

        // The API writes the tombstone and bumps the deck for sync.
        await api.delete(`/api/notes/${encodeURIComponent(note_id)}`);

        return textResult(`Deleted note: ${note.hanzi} (${note.pinyin})`);
      })
    );

    this.server.tool(
      "search_notes",
      "Search notes by hanzi, pinyin, or english across all decks (or one deck). Use this before adding a note to check whether the word is already covered anywhere, instead of fetching entire decks.",
      {
        query: z.string().describe("Text to search for (matched against hanzi, pinyin, and english with substring matching)"),
        deck_id: z.string().optional().describe("Restrict the search to a single deck ID. If omitted, searches across all of the user's decks."),
        limit: z.number().optional().describe("Maximum number of results (default 50)"),
      },
      async ({ query, deck_id, limit }) => {
        const like = `%${query}%`;
        const cap = limit && limit > 0 ? limit : 50;

        const sql = deck_id
          ? `SELECT n.*, d.name as deck_name FROM notes n
             JOIN decks d ON n.deck_id = d.id
             WHERE d.user_id = ? AND n.deck_id = ?
               AND (n.hanzi LIKE ? OR n.pinyin LIKE ? OR n.english LIKE ?)
             ORDER BY n.created_at DESC LIMIT ?`
          : `SELECT n.*, d.name as deck_name FROM notes n
             JOIN decks d ON n.deck_id = d.id
             WHERE d.user_id = ?
               AND (n.hanzi LIKE ? OR n.pinyin LIKE ? OR n.english LIKE ?)
             ORDER BY n.created_at DESC LIMIT ?`;

        const params = deck_id
          ? [userId, deck_id, like, like, like, cap]
          : [userId, like, like, like, cap];

        const results = await this.env.DB
          .prepare(sql)
          .bind(...params)
          .all<Note & { deck_name: string }>();

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ query, count: results.results.length, notes: results.results }, null, 2),
          }],
        };
      }
    );

    this.server.tool(
      "batch_search_notes",
      "Check many candidate words against existing notes in a single call. Use this instead of calling search_notes once per word when deduplicating a whole homework list before adding notes — one round trip per candidate adds up fast on a 30-50 word list. Matches hanzi, pinyin, and english with substring matching, across all decks (or one deck).",
      {
        queries: z.array(z.string()).min(1).max(100).describe("Words/phrases to check, one per candidate vocabulary item"),
        deck_id: z.string().optional().describe("Restrict the search to a single deck ID. If omitted, searches across all of the user's decks."),
        limit_per_query: z.number().optional().describe("Maximum matches returned per query (default 5) — kept small since this tool is for existence-checking, not full search"),
      },
      async ({ queries, deck_id, limit_per_query }) => {
        const cap = limit_per_query && limit_per_query > 0 ? limit_per_query : 5;

        const sql = deck_id
          ? `SELECT n.id, n.hanzi, n.pinyin, n.english, d.name as deck_name FROM notes n
             JOIN decks d ON n.deck_id = d.id
             WHERE d.user_id = ? AND n.deck_id = ?
               AND (n.hanzi LIKE ? OR n.pinyin LIKE ? OR n.english LIKE ?)
             ORDER BY n.created_at DESC LIMIT ?`
          : `SELECT n.id, n.hanzi, n.pinyin, n.english, d.name as deck_name FROM notes n
             JOIN decks d ON n.deck_id = d.id
             WHERE d.user_id = ?
               AND (n.hanzi LIKE ? OR n.pinyin LIKE ? OR n.english LIKE ?)
             ORDER BY n.created_at DESC LIMIT ?`;

        const results = await Promise.all(queries.map(async (query) => {
          const like = `%${query}%`;
          const params = deck_id
            ? [userId, deck_id, like, like, like, cap]
            : [userId, like, like, like, cap];

          const res = await this.env.DB
            .prepare(sql)
            .bind(...params)
            .all<Pick<Note, 'id' | 'hanzi' | 'pinyin' | 'english'> & { deck_name: string }>();

          return { query, count: res.results.length, matches: res.results };
        }));

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ results }, null, 2),
          }],
        };
      }
    );

    this.server.tool(
      "move_notes",
      "Move one or more notes to a different deck. Cards keep all their SRS state, review history, and scheduling. Useful for reorganizing decks.",
      {
        note_ids: z.array(z.string()).min(1).describe("Array of note IDs to move"),
        target_deck_id: z.string().describe("The destination deck ID"),
      },
      async ({ note_ids, target_deck_id }) => guard(async () => {
        // Read-only pre-check so the summary can name the deck; the API 404s
        // when the target deck isn't the caller's.
        const targetDeck = await this.env.DB
          .prepare('SELECT id, name FROM decks WHERE id = ? AND user_id = ?')
          .bind(target_deck_id, userId)
          .first<{ id: string; name: string }>();

        if (!targetDeck) {
          return errorResult(`Target deck not found: ${target_deck_id}`);
        }

        // The API moves only notes the caller owns and bumps every affected
        // deck's timestamp so sync picks the move up.
        const result = await api.post<{ moved: number; note_ids: string[]; deck_id: string }>('/api/notes/move', {
          note_ids,
          deck_id: target_deck_id,
        });
        const movedIds = new Set(result.note_ids ?? []);
        const notMoved = note_ids.filter(id => !movedIds.has(id));

        const lines = [
          `Moved ${result.moved}/${note_ids.length} notes to "${targetDeck.name}" (${target_deck_id}).`,
          ...(notMoved.length > 0 ? [`Not moved ${notMoved.length} (not found, not yours, or already in the target deck): ${notMoved.join(', ')}`] : []),
        ];

        return textResult(lines.join('\n'));
      })
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
                sentence_clue: note.sentence_clue,
                sentence_clue_pinyin: note.sentence_clue_pinyin,
                sentence_clue_translation: note.sentence_clue_translation,
                sentence_clue_audio_url: note.sentence_clue_audio_url,
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
              note: { hanzi: note.hanzi, pinyin: note.pinyin, english: note.english, sentence_clue: note.sentence_clue, sentence_clue_pinyin: note.sentence_clue_pinyin, sentence_clue_translation: note.sentence_clue_translation, sentence_clue_audio_url: note.sentence_clue_audio_url },
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
      appServer(this.server),
      "study",
      {
        title: "Study Flashcards",
        description: "Open an interactive flashcard study session for a deck. Use list_decks first to get deck IDs.",
        inputSchema: {
          deck_id: z.string().describe("The deck ID to study"),
        },
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
      appServer(this.server),
      "submit_review",
      {
        title: "Submit Review",
        description: "Submit a card review rating (called by study UI)",
        inputSchema: {
          card_id: z.string().describe("The card ID"),
          rating: z.number().min(0).max(3).describe("Rating: 0=again, 1=hard, 2=good, 3=easy"),
          time_spent_ms: z.number().optional().describe("Time spent in milliseconds"),
          user_answer: z.string().optional().describe("User's typed answer"),
        },
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

    // ============ Feature Request Tools (Admin) ============

    // Helper to check admin status
    const isAdmin = async (): Promise<boolean> => {
      const user = await this.env.DB
        .prepare('SELECT is_admin FROM users WHERE id = ?')
        .bind(userId)
        .first<{ is_admin: number }>();
      return user?.is_admin === 1;
    };

    this.server.tool(
      "list_feature_requests",
      "List feature requests submitted by users. Admins see all requests; non-admins see only their own. IMPORTANT: Only act on requests where approval_status is 'approved'. Requests with 'pending' approval_status have not been reviewed by the admin yet and should not be worked on. To find work that still needs doing, pass unimplemented_only=true — it returns only requests that are approved, not done/declined, and not already claimed by another agent (agent_session_url IS NULL), so you won't duplicate another agent's effort. Before starting work, call claim_feature_request to atomically claim it. NOTE: the large console_logs field is omitted from this list to keep responses small — use get_feature_request to fetch a single request's full detail.",
      {
        status: z.enum(['new', 'in_progress', 'agent_working', 'done', 'declined']).optional()
          .describe("Filter by status"),
        approval_status: z.enum(['pending', 'approved', 'declined']).optional()
          .describe("Filter by approval status"),
        unimplemented_only: z.boolean().optional()
          .describe("If true, return only requests still needing work: approved, status not in (done, declined), and not yet claimed by an agent. Shortcut to avoid wading through completed requests and to prevent double-claiming."),
      },
      async ({ status, approval_status, unimplemented_only }) => {
        const admin = await isAdmin();

        // Explicit column list (omits the large console_logs blob — fetch it via
        // get_feature_request when actually debugging a single request).
        const cols = `
          fr.id, fr.user_id, fr.content, fr.page_context, fr.status,
          fr.approval_status, fr.screenshot_url, fr.ccr_session_url,
          fr.agent_session_url, fr.created_at, fr.updated_at,
          (SELECT COUNT(*) FROM feature_request_comments WHERE request_id = fr.id) as comment_count
        `;

        const params: (string | number)[] = [];
        const conditions: string[] = [];

        let query: string;
        if (admin) {
          query = `
            SELECT ${cols}, u.name as user_name, u.email as user_email
            FROM feature_requests fr
            LEFT JOIN users u ON fr.user_id = u.id
          `;
        } else {
          query = `
            SELECT ${cols}
            FROM feature_requests fr
          `;
          conditions.push('fr.user_id = ?');
          params.push(userId);
        }

        if (unimplemented_only) {
          conditions.push("fr.approval_status = 'approved'");
          conditions.push("fr.status NOT IN ('done', 'declined')");
          conditions.push('fr.agent_session_url IS NULL');
        } else {
          if (approval_status) { conditions.push('fr.approval_status = ?'); params.push(approval_status); }
        }
        if (status) { conditions.push('fr.status = ?'); params.push(status); }

        if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
        query += ' ORDER BY fr.created_at DESC';

        const stmt = this.env.DB.prepare(query);
        const results = params.length > 0
          ? await stmt.bind(...params).all()
          : await stmt.all();

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(results.results, null, 2),
          }],
        };
      }
    );

    this.server.tool(
      "get_feature_request",
      "Get a feature request with its comments. Admins can view any request; non-admins can only view their own.",
      {
        request_id: z.string().describe("The feature request ID"),
      },
      async ({ request_id }) => {
        const admin = await isAdmin();

        const request = await this.env.DB
          .prepare(`
            SELECT fr.*, u.name as user_name, u.email as user_email
            FROM feature_requests fr
            LEFT JOIN users u ON fr.user_id = u.id
            WHERE fr.id = ?
          `)
          .bind(request_id)
          .first();

        if (!request) {
          return { content: [{ type: "text" as const, text: "Feature request not found" }] };
        }

        if (!admin && (request as { user_id: string }).user_id !== userId) {
          return { content: [{ type: "text" as const, text: "Access denied" }] };
        }

        const comments = await this.env.DB
          .prepare('SELECT * FROM feature_request_comments WHERE request_id = ? ORDER BY created_at ASC')
          .bind(request_id)
          .all();

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ request, comments: comments.results }, null, 2),
          }],
        };
      }
    );

    this.server.tool(
      "update_feature_request_status",
      "Update the status of a feature request. Admin only. Use 'agent_working' when you are about to start implementing a feature request — this signals to other agents that it is already being handled and prevents duplicate work. Set to 'done' when implementation is complete.",
      {
        request_id: z.string().describe("The feature request ID"),
        status: z.enum(['new', 'in_progress', 'agent_working', 'done', 'declined']).describe("The new status. Use 'agent_working' to claim a request before implementing it."),
      },
      async ({ request_id, status }) => {
        if (!await isAdmin()) {
          return { content: [{ type: "text" as const, text: "Admin access required" }] };
        }

        await this.env.DB
          .prepare("UPDATE feature_requests SET status = ?, updated_at = datetime('now') WHERE id = ?")
          .bind(status, request_id)
          .run();

        return {
          content: [{
            type: "text" as const,
            text: `Feature request ${request_id} status updated to "${status}"`,
          }],
        };
      }
    );

    this.server.tool(
      "claim_feature_request",
      "Claim a feature request to signal that an agent is working on it. Call this BEFORE starting implementation to prevent other agents from working on the same request. Sets agent_session_url and changes status to 'in_progress'. Returns an error if already claimed by a different agent session.",
      {
        request_id: z.string().describe("The feature request ID to claim"),
        session_url: z.string().describe("The Claude Code session URL of the agent claiming this request (e.g. https://claude.ai/code/session_...)"),
      },
      async ({ request_id, session_url }) => {
        if (!await isAdmin()) {
          return { content: [{ type: "text" as const, text: "Admin access required" }] };
        }

        // Atomic claim: only succeeds if the request is currently unclaimed, or
        // already claimed by THIS same session (idempotent re-claim). Doing the
        // check and the write in a single conditional UPDATE closes the
        // race window where two agents could both read "unclaimed" and then
        // both write — i.e. it prevents double-claiming.
        const claim = await this.env.DB
          .prepare(`
            UPDATE feature_requests
            SET agent_session_url = ?, status = 'in_progress', updated_at = datetime('now')
            WHERE id = ? AND (agent_session_url IS NULL OR agent_session_url = ?)
          `)
          .bind(session_url, request_id, session_url)
          .run();

        if ((claim.meta?.changes ?? 0) > 0) {
          return {
            content: [{
              type: "text" as const,
              text: `Feature request ${request_id} claimed by session ${session_url} and status set to 'in_progress'.`,
            }],
          };
        }

        // Claim didn't take — determine why so the agent gets a clear message.
        const existing = await this.env.DB
          .prepare('SELECT id, agent_session_url FROM feature_requests WHERE id = ?')
          .bind(request_id)
          .first<{ id: string; agent_session_url: string | null }>();

        if (!existing) {
          return { content: [{ type: "text" as const, text: "Feature request not found" }] };
        }

        return {
          content: [{
            type: "text" as const,
            text: `Feature request already claimed by another agent session: ${existing.agent_session_url}. Choose a different feature request.`,
          }],
        };
      }
    );

    this.server.tool(
      "add_feature_request_comment",
      "Add a comment to a feature request. Admin only — users comment through the app UI.",
      {
        request_id: z.string().describe("The feature request ID"),
        content: z.string().describe("The comment text"),
        author_name: z.string().optional().describe("Author name (defaults to user's name)"),
      },
      async ({ request_id, content, author_name }) => {
        if (!await isAdmin()) {
          return { content: [{ type: "text" as const, text: "Admin access required" }] };
        }

        // Verify the request exists
        const request = await this.env.DB
          .prepare('SELECT id FROM feature_requests WHERE id = ?')
          .bind(request_id)
          .first();

        if (!request) {
          return { content: [{ type: "text" as const, text: "Feature request not found" }] };
        }

        const commentId = generateId();
        const name = author_name || this.props!.userName || 'Admin';

        await this.env.DB
          .prepare(`
            INSERT INTO feature_request_comments (id, request_id, author_name, author_type, content)
            VALUES (?, ?, ?, 'admin', ?)
          `)
          .bind(commentId, request_id, name, content)
          .run();

        return {
          content: [{
            type: "text" as const,
            text: `Comment added to feature request ${request_id}`,
          }],
        };
      }
    );

    // Register the study app HTML resource
    registerAppResource(
      appServer(this.server),
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

    // ============ Tutor tooling (src/tools/) ============
    // Students, their activity and what they find hard; readers, lessons and
    // decks for students; and the interactive tutor apps. All of it calls the
    // main API as this user, so ownership and tutor checks stay in one place.
    registerStudentTools(ctx);
    registerContentTools(ctx);
    registerTutorApps(ctx);
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
  // Hono's fetch signature is narrower than ExportedHandler's; same contract at runtime.
  defaultHandler: app as unknown as ExportedHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});
