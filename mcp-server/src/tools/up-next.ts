/**
 * "Up next" — the account's ORDERED list of chosen notes (shared/decks/up-next.ts,
 * worker routes/up-next.ts). Inside the daily new-card budget the list's words are
 * introduced FIRST, in list order, from any deck (deck caps don't hold them back): one
 * new (blue) card per unstarted word, the started words' remaining cards from the
 * purple budget. A word leaves the list by itself once every card of it has been
 * studied; taking it off by hand never deletes anything.
 *
 * Tools: get_up_next (the list + today's ⚡ pocket), add_to_up_next, move_in_up_next,
 * remove_from_up_next, and the tutor's get_student_up_next / add_to_student_up_next /
 * move_in_student_up_next / remove_from_student_up_next (only the order of the student's
 * own cards changes — nothing is created or sent). Everything goes through the main API
 * as the signed-in user.
 */
import { z } from 'zod';
import type { ToolContext } from './context.js';
import { errorResult, guard, jsonResult } from './context.js';
import { upNextAddedMessage, insertIntoOrder, upNextIndex, upNextStatusLabel } from '../../../shared/decks/up-next';

export interface ApiUpNext {
  id: string;
  note_id: string;
  position: number;
  created_at: string;
  source: string;
  added_by_name: string | null;
  hanzi: string;
  pinyin: string;
  english: string;
  deck_id: string;
  deck_name: string;
  status: 'new' | 'started';
  new_cards: number;
  total_cards: number;
}

interface ApiBump {
  note_id: string;
  created_at: string;
  bumped_by_name: string | null;
  hanzi: string;
  pinyin: string;
  english: string;
  deck_name: string;
}

interface AddResult {
  up_next: ApiUpNext[];
  added: Array<{ note_id: string; hanzi: string }>;
  already: Array<{ note_id: string; hanzi: string }>;
  moved: Array<{ note_id: string; hanzi: string }>;
  no_new_cards: Array<{ note_id: string; hanzi: string }>;
  not_found: string[];
  over_limit: string[];
}

/** The list as a chat needs it. Pure. */
export function shapeUpNext(list: ApiUpNext[]) {
  return list.map((e, i) => ({
    position: i + 1,
    note_id: e.note_id,
    hanzi: e.hanzi,
    pinyin: e.pinyin,
    english: e.english,
    deck: e.deck_name,
    status: upNextStatusLabel(e.status, e.new_cards),
    new_cards_left: e.new_cards,
    ...(e.added_by_name ? { added_by: e.added_by_name } : {}),
  }));
}

/** The reply after an add. Pure. */
export function shapeAddResult(r: AddResult) {
  const nothing = !r.added.length && !r.already.length && !r.moved.length && !r.no_new_cards.length;
  return {
    message: nothing
      ? 'None of those words are in the decks — add them as new notes first.'
      : r.moved.length && !r.added.length
        ? `Moved ${r.moved.map((m) => m.hanzi).join(', ')}`
        : upNextAddedMessage(r.added.map((a) => a.hanzi), r.already.length, r.no_new_cards.length),
    added: r.added.map((a) => a.hanzi),
    moved: r.moved.map((a) => a.hanzi),
    already_up_next: r.already.map((a) => a.hanzi),
    ...(r.no_new_cards.length
      ? { already_studied: r.no_new_cards.map((a) => a.hanzi), hint: 'Every card of these is already studied — bump_cards ("⚡ Study it today") reviews them today instead.' }
      : {}),
    not_found: r.not_found,
    ...(r.over_limit.length ? { over_limit: r.over_limit } : {}),
    up_next: shapeUpNext(r.up_next ?? []),
  };
}

const POSITION = z
  .union([z.enum(['top', 'bottom']), z.number().int().min(1)])
  .optional()
  .describe("Where the words go: 'top', 'bottom' (default) or a 1-based place (1 = first). A word already on the list MOVES there.");

const IDS = {
  note_ids: z.array(z.string()).max(100).optional().describe('Note ids (from search_notes / batch_search_notes / get_deck).'),
  hanzi: z.array(z.string()).max(100).optional().describe('Or words to look up among the notes by exact hanzi (punctuation and spaces ignored). Every note with that hanzi is added.'),
};

/** 1-based place → the API's 0-based index ('top' / 'bottom' pass through). */
const apiPosition = (p: 'top' | 'bottom' | number | undefined) => (typeof p === 'number' ? p - 1 : p);

const notFoundBody = (err: unknown) => {
  const body = (err as { body?: AddResult }).body;
  return body && Array.isArray(body.not_found) ? body : null;
};

export function registerUpNextTools(ctx: ToolContext): void {
  const { server, api } = ctx;

  /** Find a note on the list by id or hanzi. */
  const find = (list: ApiUpNext[], noteId?: string, hanzi?: string) => {
    if (noteId) return list.find((e) => e.note_id === noteId);
    const key = (hanzi ?? '').replace(/\s/g, '');
    return key ? list.find((e) => e.hanzi.replace(/\s/g, '') === key) : undefined;
  };

  /** The shared move: fetch the list, place the word, PUT the whole order. */
  const move = async (base: string, noteId: string | undefined, hanzi: string | undefined, to: 'top' | 'bottom' | 'up' | 'down' | number) => {
    const { up_next: list = [] } = await api.get<{ up_next: ApiUpNext[] }>(base);
    const entry = find(list, noteId, hanzi);
    if (!entry) return errorResult(`${noteId ?? hanzi} is not on the Up next list`);
    const ids = list.map((e) => e.note_id);
    const i = ids.indexOf(entry.note_id);
    const index = to === 'up' ? i - 1 : to === 'down' ? i + 1 : typeof to === 'number' ? to - 1 : upNextIndex(to, ids.length);
    const order = insertIntoOrder(ids, [entry.note_id], Math.max(0, index));
    const r = await api.put<{ up_next: ApiUpNext[] }>(`${base}/order`, { note_ids: order });
    const at = r.up_next.findIndex((e) => e.note_id === entry.note_id);
    return jsonResult({ message: `${entry.hanzi} is now #${at + 1} of ${r.up_next.length}`, up_next: shapeUpNext(r.up_next) });
  };

  const remove = async (base: string, noteId: string | undefined, hanzi: string | undefined) => {
    let id = noteId;
    if (!id && hanzi) {
      const { up_next: list = [] } = await api.get<{ up_next: ApiUpNext[] }>(base);
      id = find(list, undefined, hanzi)?.note_id;
      if (!id) return errorResult(`${hanzi} is not on the Up next list`);
    }
    if (!id) return errorResult('Give note_id or hanzi');
    const r = await api.delete<{ removed: number; up_next: ApiUpNext[] }>(`${base}/${encodeURIComponent(id)}`);
    return jsonResult({
      message: r.removed ? 'Taken off Up next (the card is kept, back in its deck’s normal order).' : 'It was not on the Up next list.',
      removed: r.removed,
      up_next: shapeUpNext(r.up_next ?? []),
    });
  };

  const MOVE_TO = z
    .union([z.enum(['top', 'bottom', 'up', 'down']), z.number().int().min(1)])
    .describe("'top', 'bottom', 'up' / 'down' one place, or a 1-based place (1 = first).");
  const WHICH = {
    note_id: z.string().optional().describe('The note id (from get_up_next).'),
    hanzi: z.string().optional().describe('Or the word as it appears on the list.'),
  };

  server.tool(
    'get_up_next',
    "The user's \"Up next\" list — words they (or their tutor) chose to be introduced next, in order — plus today's \"⚡ Study it today\" pocket. Within the daily new-card budget the Up next words come FIRST, in list order, from any deck; a word drops off by itself once every card of it has been studied. Each entry: position, note_id, hanzi, pinyin, english, deck, status (new word / started with N new cards left) and who added it when it was the tutor.",
    {},
    async () => guard(async () => {
      const [list, bumps] = await Promise.all([
        api.get<{ up_next: ApiUpNext[] }>('/api/me/up-next'),
        api.get<{ bumps: ApiBump[] }>('/api/me/bumps').catch(() => ({ bumps: [] as ApiBump[] })),
      ]);
      const upNext = shapeUpNext(list.up_next ?? []);
      return jsonResult({
        up_next_count: upNext.length,
        up_next: upNext,
        today_pocket: (bumps.bumps ?? []).map((b) => ({
          note_id: b.note_id, hanzi: b.hanzi, pinyin: b.pinyin, english: b.english, deck: b.deck_name, bumped_at: b.created_at,
          ...(b.bumped_by_name ? { bumped_by: b.bumped_by_name } : {}),
        })),
      });
    }),
  );

  server.tool(
    'add_to_up_next',
    "Put words the user ALREADY HAS on their \"Up next\" list so they are introduced next — first within the daily new-card budget, in list order, ahead of the deck queue (it does not raise the daily budget; for today-only, over-the-budget study use bump_cards). Use it when the user wants particular words learned soon / next. Give note_ids or hanzi (an explicit list the user named) and optionally a position. Words with every card already studied are refused (use bump_cards to review them today). Returns the whole list.",
    { ...IDS, position: POSITION },
    async ({ note_ids, hanzi, position }) => guard(async () => {
      if (!note_ids?.length && !hanzi?.length) return errorResult('Give note_ids or hanzi');
      try {
        const r = await api.post<AddResult>('/api/me/up-next', { note_ids, hanzi, position: apiPosition(position), source: 'mcp' });
        return jsonResult(shapeAddResult(r));
      } catch (err) {
        const body = notFoundBody(err);
        if (body) return jsonResult(shapeAddResult(body));
        throw err;
      }
    }),
  );

  server.tool(
    'move_in_up_next',
    'Move one word within the user\'s "Up next" list (to the top / bottom, one place up / down, or a 1-based place). Returns the list.',
    { ...WHICH, to: MOVE_TO },
    async ({ note_id, hanzi, to }) => guard(async () => {
      if (!note_id && !hanzi) return errorResult('Give note_id or hanzi');
      return move('/api/me/up-next', note_id, hanzi, to);
    }),
  );

  server.tool(
    'remove_from_up_next',
    'Take a word off the user\'s "Up next" list. Nothing is deleted: the card stays in its deck and goes back to the normal new-card order.',
    WHICH,
    async ({ note_id, hanzi }) => guard(async () => remove('/api/me/up-next', note_id, hanzi)),
  );

  // ---- the tutor, on a student's list (only when the tutor asked) ----

  const studentBase = (relId: string) => `/api/relationships/${encodeURIComponent(relId)}/student-up-next`;
  const REL = { relationship_id: z.string().describe('The tutor relationship (from list_students).') };

  server.tool(
    'get_student_up_next',
    "Tutor only: a student's \"Up next\" list — the words introduced first within their daily new-card budget, in order (status, deck, who added each).",
    REL,
    async ({ relationship_id }) => guard(async () => {
      const r = await api.get<{ up_next: ApiUpNext[] }>(studentBase(relationship_id));
      const list = shapeUpNext(r.up_next ?? []);
      return jsonResult({ count: list.length, up_next: list });
    }),
  );

  server.tool(
    'add_to_student_up_next',
    "Tutor only, and only when the tutor asked: put words a STUDENT already has on their \"Up next\" list (introduced first within their daily budget, in order; the student sees \"added by <you>\"). Nothing is created or sent — only the order of the student's own new cards changes. note_ids from the student's decks, or hanzi looked up in the student's notes; optional position.",
    { ...REL, ...IDS, position: POSITION },
    async ({ relationship_id, note_ids, hanzi, position }) => guard(async () => {
      if (!note_ids?.length && !hanzi?.length) return errorResult('Give note_ids or hanzi');
      try {
        const r = await api.post<AddResult>(studentBase(relationship_id), { note_ids, hanzi, position: apiPosition(position) });
        return jsonResult(shapeAddResult(r));
      } catch (err) {
        const body = notFoundBody(err);
        if (body) return jsonResult(shapeAddResult(body));
        throw err;
      }
    }),
  );

  server.tool(
    'move_in_student_up_next',
    'Tutor only, when the tutor asked: move one word within a student\'s "Up next" list.',
    { ...REL, ...WHICH, to: MOVE_TO },
    async ({ relationship_id, note_id, hanzi, to }) => guard(async () => {
      if (!note_id && !hanzi) return errorResult('Give note_id or hanzi');
      return move(studentBase(relationship_id), note_id, hanzi, to);
    }),
  );

  server.tool(
    'remove_from_student_up_next',
    'Tutor only, when the tutor asked: take a word off a student\'s "Up next" list (the card is kept in their deck).',
    { ...REL, ...WHICH },
    async ({ relationship_id, note_id, hanzi }) => guard(async () => remove(studentBase(relationship_id), note_id, hanzi)),
  );
}
