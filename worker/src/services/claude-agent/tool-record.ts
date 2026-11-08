/**
 * What Claude's tools DID, told back to Claude on the next turns (docs/CHAT.md "Claude threads" →
 * "Claude remembers what its tools did").
 *
 * A reply's tool calls never reach the stored conversation: the reply keeps its TEXT (`content`) and
 * the applied results (`tool_results`, the JSON the apps draw "✓ Added 1 card: …" from), and the next
 * turn used to replay the text only. So Claude could not see its own create_flashcards call one turn
 * later and told the learner it had added nothing (Jerome, Nov 2026: "✓ Added 1 card: 这次机会很难得，
 * 你要好好把握。" under the reply, then "I didn't actually create anything yet").
 *
 * Now every earlier assistant turn is replayed as its text + `⟦app record … ⟧`, built from the SAME
 * stored `tool_results` the apps' lines are built from — so the chip and what Claude knows can't
 * disagree. The record is deterministic per stored message (tool_results never change after the reply
 * finished), so the replayed history is byte-stable turn after turn and the prompt cache's tail
 * breakpoint keeps working. Claude is told what the record is (persona.ts `TOOL_RECORD_RULE`) and
 * never to write one; `stripToolRecords` takes out any it writes anyway before the answer is stored.
 */
import { parseCardToolResults, type CardToolResult } from '@shared/claude/cardTools';

/** How a record opens and closes (brackets that never appear in a card or an answer). */
export const TOOL_RECORD_OPEN = '⟦app record';
export const TOOL_RECORD_CLOSE = '⟧';

const RECORD_PATTERN = /\n*[ \t]*⟦app record[\s\S]*?⟧/g;

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim()) : [];
}

/** The hanzi of the cards in a result: `created` (a card turn), `notes` (the Coach's), `flashcards` (a proposal). */
function cardHanzi(data: Record<string, unknown> | undefined): string[] {
  for (const key of ['created', 'notes', 'flashcards']) {
    const list = data?.[key];
    if (!Array.isArray(list)) continue;
    return list.map((c) => (c && typeof c === 'object' ? str((c as Record<string, unknown>).hanzi) : null)).filter((h): h is string => !!h);
  }
  return [];
}

function cardCount(data: Record<string, unknown> | undefined): number {
  const n = data?.count;
  if (typeof n === 'number' && Number.isFinite(n) && n >= 0) return Math.floor(n);
  return cardHanzi(data).length;
}

const cards = (n: number) => `${n} card${n === 1 ? '' : 's'}`;

function clip(s: string, max = 80): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/** One line per result: what happened, in plain words. */
export function toolRecordLine(r: CardToolResult): string {
  if (!r.success) {
    const what = r.tool === 'create_flashcards' ? 'no card was added' : 'nothing was changed';
    return `${r.tool}: FAILED${r.error ? ` (${clip(r.error, 160)})` : ''} — ${what}.`;
  }
  const data = r.data;
  switch (r.tool) {
    case 'create_flashcards': {
      const n = cardCount(data);
      if (n === 0) return 'create_flashcards: ran, but no card was added.';
      const deck = str(data?.deck_name);
      const hanzi = cardHanzi(data);
      return `create_flashcards: added ${cards(n)} to ${deck ? `the deck “${deck}”` : "the learner's decks"}${hanzi.length ? `: ${hanzi.join('、')}` : ''}.`;
    }
    case 'propose_flashcards': {
      const hanzi = cardHanzi(data);
      return `create_flashcards: proposed ${cards(hanzi.length)}${hanzi.length ? ` (${hanzi.join('、')})` : ''} for the learner to review — nothing is saved unless they save them.`;
    }
    case 'edit_current_card': {
      const changes = data?.changes && typeof data.changes === 'object' ? (data.changes as Record<string, unknown>) : {};
      const parts = Object.entries(changes)
        .filter(([, v]) => typeof v === 'string')
        .map(([k, v]) => `${k} → “${clip(v as string, k === 'fun_facts' ? 60 : 80)}”`);
      return `edit_current_card: edited this card${parts.length ? ` (${parts.join('; ')})` : ''}.`;
    }
    case 'delete_current_card':
      return 'delete_current_card: deleted this card.';
    case 'create_custom_lesson': {
      const title = str(data?.title);
      return `create_custom_lesson: made the mini lesson${title ? ` “${title}”` : ''} (on their Mini Lessons page).`;
    }
    case 'bump_cards': {
      const parts: string[] = [];
      const bumped = strings(data?.bumped);
      const already = strings(data?.already_bumped);
      const missing = strings(data?.not_found);
      if (bumped.length) parts.push(`put first in today's study: ${bumped.join('、')}`);
      if (already.length) parts.push(`already first in today's study: ${already.join('、')}`);
      if (missing.length) parts.push(`not in their decks: ${missing.join('、')}`);
      return `bump_cards: ${parts.length ? parts.join('; ') : 'nothing to bump'}.`;
    }
    default:
      return `${r.tool}: done.`;
  }
}

/** The record of one stored reply ('' when its tools did nothing — or it called none). */
export function toolRecord(toolResults: string | null | undefined): string {
  const results = parseCardToolResults(toolResults);
  if (results.length === 0) return '';
  const lines = results.map((r) => `- ${toolRecordLine(r)}`);
  return `${TOOL_RECORD_OPEN} — what your tools actually did in the reply above, applied when it finished (written by the app; the learner saw it as a line under that reply):\n${lines.join('\n')}${TOOL_RECORD_CLOSE}`;
}

/** An earlier assistant turn as replayed to Claude: its text, then the record of its tools (if any). */
export function withToolRecord(content: string, toolResults: string | null | undefined): string {
  const record = toolRecord(toolResults);
  return record ? `${content}\n\n${record}` : content;
}

/** A reply as stored: any record Claude wrote itself (copying the history's) taken out. */
export function stripToolRecords(text: string): string {
  if (!text.includes(TOOL_RECORD_OPEN)) return text;
  return text.replace(RECORD_PATTERN, '').replace(/\n{3,}/g, '\n\n').trim();
}
