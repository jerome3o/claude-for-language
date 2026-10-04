/**
 * "⚡ Study it today" — the bump pocket (shared/decks/bumps.ts, worker
 * routes/study-bumps.ts). Words the user ALREADY has go to the front of today's
 * study instead of being added again: their cards come first in the session,
 * new cards even past the daily new-card limit; a bump finishes once each bumped
 * card has been reviewed, unfinished ones carry over to the next day.
 *
 * Tools: bump_cards, list_bumped_cards, clear_bumped_card, bump_student_cards
 * (the tutor's variant — the student sees "⚡ from <tutor>"). Everything goes
 * through the main API as the signed-in user.
 */
import { z } from 'zod';
import type { ToolContext } from './context.js';
import { errorResult, guard, jsonResult } from './context.js';
import { bumpedMessage } from '../../../shared/decks/bumps';

interface ApiBump {
  id: string;
  note_id: string;
  created_at: string;
  source: string;
  bumped_by_name: string | null;
  hanzi: string;
  pinyin: string;
  english: string;
  deck_id: string;
  deck_name: string;
}

interface BumpResult {
  bumps: ApiBump[];
  added: Array<{ note_id: string; hanzi: string }>;
  already: Array<{ note_id: string; hanzi: string }>;
  not_found: string[];
}

/** The pocket as a chat needs it. Pure. */
export function shapePocket(bumps: ApiBump[]) {
  return bumps.map((b) => ({
    note_id: b.note_id,
    hanzi: b.hanzi,
    pinyin: b.pinyin,
    english: b.english,
    deck: b.deck_name,
    bumped_at: b.created_at,
    ...(b.bumped_by_name ? { bumped_by: b.bumped_by_name } : {}),
  }));
}

/** The reply after a bump. Pure. */
export function shapeBumpResult(r: BumpResult) {
  return {
    message: r.added.length || r.already.length
      ? bumpedMessage(r.added.map((a) => a.hanzi), r.already.length)
      : 'None of those words are in the decks — add them as new notes instead.',
    bumped: r.added.map((a) => a.hanzi),
    already_bumped: r.already.map((a) => a.hanzi),
    not_found: r.not_found,
    pocket: shapePocket(r.bumps),
  };
}

const IDS = {
  note_ids: z.array(z.string()).max(50).optional().describe('Note ids (from search_notes / batch_search_notes / get_deck).'),
  hanzi: z.array(z.string()).max(50).optional().describe('Or words to look up among the notes by exact hanzi (punctuation and spaces ignored). Every note with that hanzi is bumped.'),
};

export function registerBumpTools(ctx: ToolContext): void {
  const { server, api } = ctx;

  server.tool(
    'bump_cards',
    "\"⚡ Study it today\": push words the user ALREADY HAS to the front of today's study queue. Their cards come first in today's session — new cards even past the daily new-card limit (it doesn't use up the budget), and cards not due yet get one early review. A bump finishes once each bumped card has been reviewed; unfinished ones carry over to tomorrow. Use this whenever the user wants to add or study a word that search_notes / batch_search_notes shows they already have — never add a duplicate. Give note_ids or hanzi. Returns the whole pocket.",
    IDS,
    async ({ note_ids, hanzi }) => guard(async () => {
      if (!note_ids?.length && !hanzi?.length) return errorResult('Give note_ids or hanzi');
      try {
        const r = await api.post<BumpResult>('/api/me/bumps', { note_ids, hanzi, source: 'mcp' });
        return jsonResult(shapeBumpResult(r));
      } catch (err) {
        const body = (err as { body?: BumpResult }).body;
        if (body?.not_found) return jsonResult(shapeBumpResult(body));
        throw err;
      }
    }),
  );

  server.tool(
    'list_bumped_cards',
    "The user's \"⚡ Study it today\" pocket: the words bumped to the front of today's study that still have cards to review (finished bumps drop out on their own). Each with note_id, hanzi, pinyin, english, deck, when it was bumped and — when their tutor bumped it — by whom.",
    {},
    async () => guard(async () => {
      const r = await api.get<{ bumps: ApiBump[] }>('/api/me/bumps');
      const pocket = shapePocket(r.bumps ?? []);
      return jsonResult({ count: pocket.length, pocket });
    }),
  );

  server.tool(
    'clear_bumped_card',
    "Take a word out of the \"⚡ Study it today\" pocket (its cards go back to their normal schedule; nothing else changes). Give note_id, or hanzi to find it in the pocket.",
    { note_id: z.string().optional().describe('The bumped note id (from list_bumped_cards).'), hanzi: z.string().optional().describe('Or the word as it appears in the pocket.') },
    async ({ note_id, hanzi }) => guard(async () => {
      let id = note_id;
      if (!id && hanzi) {
        const r = await api.get<{ bumps: ApiBump[] }>('/api/me/bumps');
        const key = hanzi.replace(/\s/g, '');
        id = (r.bumps ?? []).find((b) => b.hanzi.replace(/\s/g, '') === key)?.note_id;
        if (!id) return errorResult(`${hanzi} is not in today's pocket`);
      }
      if (!id) return errorResult('Give note_id or hanzi');
      const r = await api.delete<{ cleared: number; bumps: ApiBump[] }>(`/api/me/bumps/${encodeURIComponent(id)}`);
      return jsonResult({
        message: r.cleared ? 'Taken out of today’s pocket.' : 'It was not in today’s pocket.',
        cleared: r.cleared,
        pocket: shapePocket(r.bumps ?? []),
      });
    }),
  );

  server.tool(
    'bump_student_cards',
    "Tutor only: bump words a STUDENT already has to the front of their study today (\"⚡ Study it today\" — the student sees \"⚡ from <you>\" on those cards). Nothing is created or sent; only the order of the student's own cards changes. relationship_id from list_students; note_ids from the student's decks, or hanzi looked up in the student's notes.",
    { relationship_id: z.string().describe('The tutor relationship (from list_students).'), ...IDS },
    async ({ relationship_id, note_ids, hanzi }) => guard(async () => {
      if (!note_ids?.length && !hanzi?.length) return errorResult('Give note_ids or hanzi');
      try {
        const r = await api.post<BumpResult>(`/api/relationships/${encodeURIComponent(relationship_id)}/student-bumps`, { note_ids, hanzi });
        return jsonResult({ ...shapeBumpResult(r), pocket: undefined, student_pocket_size: r.bumps.length });
      } catch (err) {
        const body = (err as { body?: BumpResult }).body;
        if (body?.not_found) return jsonResult({ ...shapeBumpResult(body), pocket: undefined });
        throw err;
      }
    }),
  );
}
