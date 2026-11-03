/**
 * The memory tools (tools/registry.ts, kind `read`): Claude looks up the learner's EARLIER chats with it
 * on demand instead of carrying them in every prompt (memory.ts). Both read the caller's OWN live
 * threads only (`ctx.userId`) and stay under hard token caps, so a lookup can't blow up the context:
 *
 *   search_my_chats { query, limit ≤ 5 }                     ≤ SEARCH_MAX_TOKENS (1.5k)
 *   read_chat { thread_id, around?, max_messages ≤ 20 }      ≤ READ_MAX_TOKENS (3k), each message ≤ 400 chars
 */
import { badgeText, estimateTokens, memoryMessageText, oneLine } from '../memory';
import * as store from '../store';
import type { ToolContext } from '../types';

export const SEARCH_MAX_RESULTS = 5;
export const SEARCH_MAX_TOKENS = 1500;
export const SEARCH_EXCERPT_CHARS = 200;
export const READ_MAX_MESSAGES = 20;
export const READ_DEFAULT_MESSAGES = 12;
export const READ_MAX_TOKENS = 3000;
export const READ_MESSAGE_MAX_CHARS = 400;

const dayOf = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '');

/** The search terms: words / hanzi runs of the query (≤ 4, each ≥ 1 Han character or ≥ 2 letters). */
export function searchTerms(query: string): string[] {
  const terms = query
    .split(/[\s,，、。;；!！?？"“”'‘’「」()（）]+/)
    .map((t) => t.trim())
    .filter((t) => /[一-鿿]/.test(t) || t.length >= 2);
  return Array.from(new Set(terms.map((t) => t.toLowerCase()))).slice(0, 4);
}

/** ~`max` characters of `text` around the first term it contains, on one line. */
export function excerptAround(text: string, terms: readonly string[], max = SEARCH_EXCERPT_CHARS): string {
  const line = text.replace(/\s+/g, ' ').trim();
  if (line.length <= max) return line;
  const lower = line.toLowerCase();
  const at = terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const from = Math.max(0, Math.min(at - Math.floor(max / 3), line.length - max));
  return `${from > 0 ? '…' : ''}${line.slice(from, from + max).trim()}${from + max < line.length ? '…' : ''}`;
}

/** Drops items from the end until the JSON is within `maxTokens`. */
function capList<T>(build: (items: T[]) => Record<string, unknown>, items: T[], maxTokens: number): Record<string, unknown> {
  let kept = items.slice();
  let out = build(kept);
  while (kept.length > 0 && estimateTokens(JSON.stringify(out)) > maxTokens) {
    kept = kept.slice(0, -1);
    out = build(kept);
  }
  return out;
}

export async function executeSearchMyChats(input: Record<string, unknown>, ctx: ToolContext): Promise<Record<string, unknown>> {
  const query = typeof input.query === 'string' ? input.query.slice(0, 200) : '';
  const limit = Math.max(1, Math.min(SEARCH_MAX_RESULTS, Math.floor(Number(input.limit) || SEARCH_MAX_RESULTS)));
  const terms = searchTerms(query);
  // A few more candidates than asked: the ranking below prefers chats matching more of the terms.
  const rows = await store.searchThreadsForMemory(ctx.db, ctx.userId, terms, terms.length > 1 ? limit * 3 : limit, ctx.threadId);
  const messages = await store.matchingMessages(ctx.db, rows.map((r) => r.id), terms, 60);
  const byThread = new Map<string, typeof messages>();
  for (const m of messages) {
    const list = byThread.get(m.conversation_id) ?? [];
    list.push(m);
    byThread.set(m.conversation_id, list);
  }
  const score = (r: store.MemoryThreadRow) => {
    const hay = [r.title, r.summary ?? '', ...(byThread.get(r.id) ?? []).map((m) => m.content)].join('\n').toLowerCase();
    return terms.filter((t) => hay.includes(t)).length;
  };
  const ranked = rows
    .map((r, i) => ({ r, i, s: score(r) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map(({ r }) => ({
      thread_id: r.id,
      title: oneLine(r.title || 'Chat with Claude', 80),
      badge: badgeText(r),
      date: dayOf(r.last_message_at ?? r.created_at),
      summary: r.summary ? oneLine(r.summary, 300) : r.preview ? `Last message: ${oneLine(r.preview, 120)}` : '',
      excerpts: (byThread.get(r.id) ?? []).slice(0, 2).map((m) => ({ from: m.role === 'user' ? 'learner' : 'claude', text: excerptAround(m.content, terms) })),
    }));
  return capList(
    (hits) => ({
      query,
      results: hits,
      count: hits.length,
      ...(hits.length === 0 ? { message: terms.length ? 'No earlier chat matches — try other words (hanzi or English).' : 'No earlier chats yet.' } : { next: 'read_chat with a thread_id for more.' }),
    }),
    ranked,
    SEARCH_MAX_TOKENS,
  );
}

export async function executeReadChat(input: Record<string, unknown>, ctx: ToolContext): Promise<Record<string, unknown>> {
  const ref = typeof input.thread_id === 'string' ? input.thread_id.trim() : '';
  if (!ref) return { error: 'Give a thread_id (from search_my_chats or the recent chats list).' };
  const thread = await store.findOwnThreadForMemory(ctx.db, ctx.userId, ref);
  if (!thread) return { error: 'No chat of this learner with that id.' };
  const max = Math.max(1, Math.min(READ_MAX_MESSAGES, Math.floor(Number(input.max_messages) || READ_DEFAULT_MESSAGES)));
  const all = await store.messagesForMemory(ctx.db, thread.id);
  const around = typeof input.around === 'string' ? input.around.trim().toLowerCase().slice(0, 100) : '';

  // The window: centred on the last message mentioning `around` (or that message id), else the latest.
  let centre = all.length - 1;
  let found = !around;
  if (around) {
    for (let i = all.length - 1; i >= 0; i--) {
      if (all[i].id === around || all[i].content.toLowerCase().includes(around)) {
        centre = i;
        found = true;
        break;
      }
    }
  }
  let from = around && found ? Math.max(0, centre - Math.floor(max / 2)) : Math.max(0, all.length - max);
  let to = Math.min(all.length, from + max);
  from = Math.max(0, to - max);

  const render = (lo: number, hi: number) => ({
    thread_id: thread.id,
    title: oneLine(thread.title || 'Chat with Claude', 120),
    badge: badgeText(thread),
    date: dayOf(thread.last_message_at ?? thread.created_at),
    ...(thread.summary ? { summary: oneLine(thread.summary, 400) } : {}),
    total_messages: all.length,
    showing: all.length ? `messages ${lo + 1}–${hi} of ${all.length}` : 'no messages',
    ...(around && !found ? { note: `“${around}” isn't in this chat; showing the latest messages.` } : {}),
    messages: all.slice(lo, hi).map((m) => ({
      from: m.role === 'user' ? 'learner' : 'claude',
      at: dayOf(m.created_at),
      text: around && found && m.content.toLowerCase().includes(around) && m.content_type === 'text'
        ? excerptAround(m.content, [around], READ_MESSAGE_MAX_CHARS)
        : memoryMessageText(m, READ_MESSAGE_MAX_CHARS),
    })),
  });
  let out = render(from, to);
  // Over the cap: drop the message farthest from the centre, one at a time.
  while (to - from > 1 && estimateTokens(JSON.stringify(out)) > READ_MAX_TOKENS) {
    if (centre - from > to - 1 - centre) from++;
    else to--;
    out = render(from, to);
  }
  return out;
}
