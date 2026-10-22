/**
 * Suspend & snooze (shared/decks/holds.ts, worker routes/card-holds.ts) for the signed-in user's
 * OWN cards: a suspended card leaves all study until it is unsuspended — its history and schedule
 * are kept exactly as they are (no review is written). Snoozes ("not today") are made in the apps;
 * they show in the list and Unsuspend wakes them too.
 *
 * Tools: suspend_cards, unsuspend_cards, list_suspended_cards. No tutor variant: these never
 * touch a student's account.
 */
import { z } from 'zod';
import type { ToolContext } from './context.js';
import { errorResult, guard, jsonResult } from './context.js';
import { cardTypeLabel, holdMessage, releaseMessage } from '../../../shared/decks/holds';

export interface ApiHold {
  id: string;
  card_id: string;
  kind: 'suspend' | 'snooze';
  until: string | null;
  created_at: string;
  note_id: string;
  card_type: string;
  hanzi: string;
  pinyin: string;
  english: string;
  deck_name: string;
}

/** The held cards as a chat needs them. Pure. */
export function shapeHolds(holds: ApiHold[]) {
  return holds.map((h) => ({
    card_id: h.card_id,
    note_id: h.note_id,
    hanzi: h.hanzi,
    pinyin: h.pinyin,
    english: h.english,
    card: cardTypeLabel(h.card_type),
    deck: h.deck_name,
    status: h.kind === 'suspend' ? 'suspended' : `snoozed until ${h.until}`,
    since: h.created_at,
  }));
}

const TARGETS = {
  note_ids: z.array(z.string()).max(50).optional().describe('Note ids (from search_notes / batch_search_notes / get_deck) — every card of each word.'),
  hanzi: z.array(z.string()).max(50).optional().describe('Or words looked up among the notes by exact hanzi (punctuation and spaces ignored).'),
  card_ids: z.array(z.string()).max(150).optional().describe('Or exact card ids (from get_note_cards / list_suspended_cards).'),
  card_types: z
    .array(z.enum(['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi']))
    .optional()
    .describe('With note_ids / hanzi: only these card types of the word (default: all of them).'),
};

export function registerCardHoldTools(ctx: ToolContext): void {
  const { server, api } = ctx;

  server.tool(
    'suspend_cards',
    "Suspend the signed-in user's OWN cards: they leave all study (reviews, new-card slots, ⚡ bumps, Up next, counts) until unsuspended. Their review history and schedule are kept exactly as they are — no review is written; unsuspended, a card carries on where it was. Only when the user asked to suspend / stop seeing those cards. Give note_ids or hanzi (every card type of the word, or only card_types), or card_ids.",
    TARGETS,
    async ({ note_ids, hanzi, card_ids, card_types }) => guard(async () => {
      if (!note_ids?.length && !hanzi?.length && !card_ids?.length) return errorResult('Give note_ids, hanzi or card_ids');
      try {
        const r = await api.post<{ holds: ApiHold[]; added: string[]; already: string[]; not_found: string[] }>('/api/me/card-holds', {
          note_ids, hanzi, card_ids, card_types, kind: 'suspend', source: 'mcp',
        });
        return jsonResult({
          message: r.added.length ? holdMessage('suspend', r.added.length) : 'Nothing new was suspended.',
          suspended: r.added.length,
          not_found: r.not_found,
          held: shapeHolds(r.holds ?? []),
        });
      } catch (err) {
        const body = (err as { body?: { not_found?: string[] } }).body;
        if (body?.not_found) return jsonResult({ message: 'None of those are in the decks.', suspended: 0, not_found: body.not_found });
        throw err;
      }
    }),
  );

  server.tool(
    'unsuspend_cards',
    "Bring the signed-in user's suspended (or snoozed) cards back into study — each carries on with its schedule as it was (an overdue review is simply due). Give note_ids, hanzi or card_ids (from list_suspended_cards).",
    { note_ids: TARGETS.note_ids, hanzi: TARGETS.hanzi, card_ids: TARGETS.card_ids },
    async ({ note_ids, hanzi, card_ids }) => guard(async () => {
      if (!note_ids?.length && !hanzi?.length && !card_ids?.length) return errorResult('Give note_ids, hanzi or card_ids');
      const r = await api.post<{ cleared: number; holds: ApiHold[] }>('/api/me/card-holds/clear', { note_ids, hanzi, card_ids, source: 'mcp' });
      return jsonResult({
        message: r.cleared ? releaseMessage(r.cleared) : 'None of those cards were suspended or snoozed.',
        released: r.cleared,
        held: shapeHolds(r.holds ?? []),
      });
    }),
  );

  server.tool(
    'list_suspended_cards',
    "The signed-in user's cards held out of study: suspended (until unsuspended) and snoozed (\"not today\", until a date), each with card_id, note_id, hanzi, pinyin, english, card type, deck and since when.",
    {},
    async () => guard(async () => {
      const r = await api.get<{ holds: ApiHold[] }>('/api/me/card-holds');
      const held = shapeHolds(r.holds ?? []);
      return jsonResult({ count: held.length, suspended: held.filter((h) => h.status === 'suspended').length, held });
    }),
  );
}
