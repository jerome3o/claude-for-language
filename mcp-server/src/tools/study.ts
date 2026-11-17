/**
 * The `study` MCP App and the card-state tools — ONE scheduler.
 *
 * Card state is derived from review events by FSRS (shared/scheduler; CLAUDE.md "Event-Sourcing
 * Architecture"). This module never writes `cards` or `review_events` itself:
 *
 * - `submit_review` (app-only, called by the study UI) POSTs the review EVENT to `/api/reviews` — the
 *   endpoint both apps upload their reviews to — as the signed-in user; the API stores it and recomputes the
 *   card's state from all its events (forgets included).
 * - `study` shows each card's FSRS interval previews (`getIntervalPreviews` over the card's replayed
 *   events), the same numbers the web's rating buttons show.
 * - `set_card_familiarity` / `batch_set_familiarity`: only "new" can be said honestly in an event-sourced
 *   model — it is a forget event (`POST /api/me/card-forgets`, Undo-able in the apps). Any other level
 *   ("seen", "familiar", "well_known", "mastered") used to overwrite the cached state, which the next replay
 *   silently undid; it is now refused with what to use instead. (`update_card_settings` is gone for the
 *   same reason.)
 */
import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import {
  computeCardState,
  getIntervalPreviews,
  withForgetEvents,
  DEFAULT_DECK_SETTINGS,
  type CardForget,
  type ReviewEvent,
  type Rating,
} from '../../../shared/scheduler';
import { STUDY_APP_HTML } from '../app-html.js';
import { apiBaseUrl } from '../types.js';
import { appServer } from './apps.js';
import { errorResult, guard, textResult, type ToolContext } from './context.js';

export const STUDY_RESOURCE_URI = 'ui://study/mcp-app.html';

export const CARD_TYPES = ['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi'] as const;
export const FAMILIARITY_LEVELS = ['new', 'seen', 'familiar', 'well_known', 'mastered'] as const;
export type Familiarity = (typeof FAMILIARITY_LEVELS)[number];

/** What a refused familiarity level says (the honest answer in an event-sourced model). */
export const FAMILIARITY_REFUSAL =
  "Card state comes from the learner's reviews (FSRS replays them), so it can't be set to a level: a written " +
  'state would be undone by the next replay. What you can do instead: familiarity "new" forgets the cards (back to ' +
  'New, Undo-able in the app); bump_cards puts words first in today\'s study; suspend_cards takes cards out of study; ' +
  'or the learner reviews the card (the study tool) and rates it Easy.';

/** One rating button's preview, as the study UI shows it. */
export interface StudyPreview {
  intervalText: string;
  queue: number;
}

/** A card's FSRS previews for Again / Hard / Good / Easy, from its replayed events. Pure. */
export function previewsFor(
  events: readonly ReviewEvent[],
  forgets: readonly CardForget[],
  now: Date = new Date(),
): { queue: number; previews: Record<Rating, StudyPreview> } {
  const state = computeCardState(withForgetEvents(events, forgets), DEFAULT_DECK_SETTINGS);
  const previews = {} as Record<Rating, StudyPreview>;
  for (const p of getIntervalPreviews(state, DEFAULT_DECK_SETTINGS, now)) {
    previews[p.rating] = { intervalText: p.intervalText, queue: p.nextState };
  }
  return { queue: state.queue, previews };
}

/** The clip's absolute URL (R2 key → the API's public `/api/audio/*`), or null. Pure. */
export function audioUrl(apiBase: string, key: string | null | undefined): string | null {
  if (!key) return null;
  if (/^https?:\/\//.test(key)) return key;
  const k = key.replace(/^\/+/, '').replace(/^api\/audio\//, '');
  return `${apiBase}/api/audio/${k}`;
}

/** `ids` in chunks small enough for one D1 `IN (…)`. */
function chunks<T>(ids: T[], size = 90): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/** GET /api/me/study-queue (worker services/study-queue.ts — the shared queue, what Home shows). */
export interface ApiStudyQueue {
  day_key: string;
  /** reviews_due + today's new cards (the budget's): Home's Study button. */
  due_today: number;
  /** learning + review cards due today — no new cards. */
  reviews_due: number;
  new_today: number;
  counts: { new: number; extra_new: number; learning: number; review: number };
  new_cards_paused: boolean;
  decks?: Array<{ deck_id: string; due_today: number; reviews_due: number; new_today: number; counts: ApiStudyQueue['counts'] }>;
  cards?: Array<{ id: string; note_id: string; deck_id: string; card_type: string; queue: number }>;
}

/** The study UI's three numbers: new (blue + purple), learning, review. Pure. */
export function studyCounts(q: Pick<ApiStudyQueue, 'counts'>): { new: number; learning: number; review: number } {
  return { new: q.counts.new + q.counts.extra_new, learning: q.counts.learning, review: q.counts.review };
}

export function registerStudyTools(ctx: ToolContext): void {
  const { env, userId, api } = ctx;
  const server = appServer(ctx.server);
  const apiBase = apiBaseUrl(env);

  /** Each card's review events + live forgets (read only). */
  const historyOf = async (cardIds: string[]) => {
    const events = new Map<string, ReviewEvent[]>();
    const forgets = new Map<string, CardForget[]>();
    for (const chunk of chunks(cardIds)) {
      const marks = chunk.map(() => '?').join(',');
      const [ev, fg] = await Promise.all([
        env.DB.prepare(`SELECT id, card_id, rating, reviewed_at FROM review_events WHERE user_id = ? AND card_id IN (${marks}) ORDER BY reviewed_at ASC`)
          .bind(userId, ...chunk).all<ReviewEvent>(),
        env.DB.prepare(`SELECT id, card_id, forgotten_at FROM card_forgets WHERE user_id = ? AND undone_at IS NULL AND card_id IN (${marks})`)
          .bind(userId, ...chunk).all<CardForget>()
          .catch(() => ({ results: [] as CardForget[] })),
      ]);
      for (const e of ev.results ?? []) events.set(e.card_id, [...(events.get(e.card_id) ?? []), e]);
      for (const f of fg.results ?? []) forgets.set(f.card_id, [...(forgets.get(f.card_id) ?? []), f]);
    }
    return { events, forgets };
  };

  /** This deck's session today, as the API's study queue sees it (the first `limit` cards in session order). */
  const deckQueue = (deckId: string, limit = 0) => api.get<ApiStudyQueue>('/api/me/study-queue', { deck_id: deckId, limit: limit || undefined });

  // Study tool — opens the interactive flashcard UI.
  registerAppTool(
    server,
    'study',
    {
      title: 'Study Flashcards',
      description: 'Open an interactive flashcard study session for a deck. Use list_decks first to get deck IDs.',
      inputSchema: { deck_id: z.string().describe('The deck ID to study') },
      _meta: { ui: { resourceUri: STUDY_RESOURCE_URI } },
    },
    async ({ deck_id }): Promise<CallToolResult> => {
      const deck = await env.DB
        .prepare('SELECT id, name FROM decks WHERE id = ? AND user_id = ?')
        .bind(deck_id, userId)
        .first<{ id: string; name: string }>();
      if (!deck) return errorResult(`Deck not found: ${deck_id}`);

      // The deck's session today = the shared study queue (reviews due + the budget's new cards), in order.
      const queue = await deckQueue(deck_id, 50);
      const ids = (queue.cards ?? []).map((c) => c.id);
      const rows = ids.length
        ? await env.DB
          .prepare(`
            SELECT c.id, c.card_type, n.id as note_id, n.hanzi, n.pinyin, n.english, n.audio_url, n.fun_facts
            FROM cards c
            JOIN notes n ON c.note_id = n.id
            WHERE n.deck_id = ? AND c.id IN (${ids.map(() => '?').join(',')})
          `)
          .bind(deck_id, ...ids)
          .all<{ id: string; card_type: string; note_id: string; hanzi: string; pinyin: string; english: string; audio_url: string | null; fun_facts: string | null }>()
        : { results: [] };
      const at = new Map(ids.map((id, i) => [id, i]));
      const list = [...(rows.results ?? [])].sort((a, b) => (at.get(a.id) ?? 0) - (at.get(b.id) ?? 0));
      const { events, forgets } = await historyOf(list.map((r) => r.id));
      const now = new Date();
      const cards = list.map((r) => {
        const { queue, previews } = previewsFor(events.get(r.id) ?? [], forgets.get(r.id) ?? [], now);
        return {
          id: r.id,
          card_type: r.card_type,
          queue,
          previews,
          note: {
            id: r.note_id,
            hanzi: r.hanzi,
            pinyin: r.pinyin,
            english: r.english,
            audio_url: audioUrl(apiBase, r.audio_url),
            fun_facts: r.fun_facts,
          },
        };
      });

      return textResult(`Opening study session for "${deck.name}" with ${cards.length} cards due.`, {
        deck: { id: deck.id, name: deck.name },
        cards,
        counts: studyCounts(queue),
      });
    },
  );

  // Submit a review — called by the study UI only (hidden from the model). The review is an EVENT for
  // the API, which recomputes the card's state from its events; nothing here writes cards / review_events.
  registerAppTool(
    server,
    'submit_review',
    {
      title: 'Submit Review',
      description: 'Submit a card review rating (called by study UI)',
      inputSchema: {
        card_id: z.string().describe('The card ID'),
        rating: z.number().int().min(0).max(3).describe('Rating: 0=again, 1=hard, 2=good, 3=easy'),
        time_spent_ms: z.number().optional().describe('Time spent in milliseconds'),
        user_answer: z.string().optional().describe("User's typed answer"),
      },
      _meta: { ui: { resourceUri: STUDY_RESOURCE_URI, visibility: ['app'] } },
    },
    async ({ card_id, rating, time_spent_ms, user_answer }): Promise<CallToolResult> => guard(async () => {
      const id = crypto.randomUUID();
      const res = await api.post<{ created: number; skipped: number; orphan_event_ids?: string[] }>('/api/reviews', {
        events: [{
          id,
          card_id,
          rating,
          reviewed_at: new Date().toISOString(),
          time_spent_ms: time_spent_ms !== undefined ? Math.max(0, Math.round(time_spent_ms)) : undefined,
          user_answer: user_answer || undefined,
        }],
      });
      if (res.orphan_event_ids?.includes(id)) return errorResult(`Card not found: ${card_id}`);

      const card = await env.DB
        .prepare('SELECT n.deck_id FROM cards c JOIN notes n ON c.note_id = n.id JOIN decks d ON n.deck_id = d.id WHERE c.id = ? AND d.user_id = ?')
        .bind(card_id, userId)
        .first<{ deck_id: string }>();
      const counts = card ? studyCounts(await deckQueue(card.deck_id)) : undefined;
      return textResult('Review recorded', counts ? { counts } : {});
    }),
  );

  registerAppResource(
    server,
    STUDY_RESOURCE_URI,
    STUDY_RESOURCE_URI,
    {
      mimeType: RESOURCE_MIME_TYPE,
      // The cards' word clips come from the API's public /api/audio/* route.
      _meta: { ui: { csp: { resourceDomains: [new URL(apiBase).origin], connectDomains: [new URL(apiBase).origin] } } },
    },
    async () => ({ contents: [{ uri: STUDY_RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: STUDY_APP_HTML }] }),
  );

  // ---- Familiarity: "new" = a forget event; every other level is refused ----

  const forget = async (body: { note_ids: string[]; card_types?: readonly string[] }) =>
    api.post<{ added: string[]; already: string[]; not_found: string[] }>('/api/me/card-forgets', { ...body, source: 'mcp' });

  ctx.server.tool(
    'set_card_familiarity',
    'Reset a note\'s cards to New ("forget" them: they come back as new cards, their history is kept, Undo-able in the app). Only familiarity "new" is possible: card state comes from the learner\'s reviews (FSRS), so "seen" / "familiar" / "well_known" / "mastered" cannot be set and are refused — use bump_cards to study words today, suspend_cards to take cards out of study.',
    {
      note_id: z.string().describe('The note ID'),
      familiarity: z.enum(FAMILIARITY_LEVELS).describe('Only "new" (forget the cards) is applied; the other levels are refused with an explanation.'),
      card_types: z.array(z.enum(CARD_TYPES)).optional().describe('Which card types to reset (default: all 3).'),
    },
    async ({ note_id, familiarity, card_types }) => guard(async () => {
      if (familiarity !== 'new') return errorResult(FAMILIARITY_REFUSAL);
      const r = await forget({ note_ids: [note_id], card_types });
      return textResult(`Reset ${r.added.length} card(s) to New${r.already.length ? ` (${r.already.length} already new since their last forget)` : ''}. The learner can Undo it in the app.`);
    }),
  );

  ctx.server.tool(
    'batch_set_familiarity',
    'Reset many notes\' cards to New ("forget" them; history kept, Undo-able in the app). Only familiarity "new" is possible — card state comes from reviews (FSRS); other levels are refused. To mark words as known, the learner reviews them; to keep them out of study use suspend_cards.',
    {
      note_ids: z.array(z.string()).min(1).max(300).describe('Note IDs whose cards to reset'),
      familiarity: z.enum(FAMILIARITY_LEVELS).describe('Only "new" is applied; the other levels are refused with an explanation.'),
    },
    async ({ note_ids, familiarity }) => guard(async () => {
      if (familiarity !== 'new') return errorResult(FAMILIARITY_REFUSAL);
      // The API takes ≤ 200 cards a request: 60 notes (3 cards each) at a time.
      let added = 0;
      let missing = 0;
      for (const part of chunks(note_ids, 60)) {
        try {
          const r = await forget({ note_ids: part });
          added += r.added.length;
        } catch (err) {
          if ((err as { status?: number }).status !== 404) throw err;
          missing += part.length;
        }
      }
      return textResult(`Reset ${added} card(s) of ${note_ids.length} note(s) to New${missing ? `; ${missing} note(s) not found` : ''}. The learner can Undo it in the app.`);
    }),
  );
}
