/**
 * Claude threads on a device (shared/claude/threadCache.ts + titleFor / previewOf in
 * shared/claude/context.ts): message order, the streamed-text merge, a response over the cached rows,
 * live claude_turn frames, the thread-list merge and the title / preview of a thread started offline.
 * Writes claude-thread-cache.json; checked by core/…/claude/ClaudeThreadCacheParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { previewOf, titleFor, type StoredClaudeContext } from '../../../shared/claude/context';
import {
  applyTurnFrame, mergeMessage, mergeThreadList, mergeThreadMessages, sortMessages,
  type CachedMessageFields, type CachedThreadFields,
} from '../../../shared/claude/threadCache';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: claude-thread-cache <out-dir>');
mkdirSync(OUT, { recursive: true });

// mulberry32
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261117);
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
const chance = (p: number) => rand() < p;

// ---------- Titles / previews ----------

type FlatCtx = { kind: string; label?: string; scenario?: string };
const CTXS: FlatCtx[] = [
  { kind: 'general' }, { kind: 'general', label: 'x' },
  { kind: 'card' }, { kind: 'card', label: '银行' }, { kind: 'card', label: '' },
  { kind: 'practice' }, { kind: 'practice', scenario: '点菜' }, { kind: 'practice', scenario: '' , label: '服务员' },
  { kind: 'chat_message' }, { kind: 'chat_message', label: '明天见！' },
  { kind: 'reader' }, { kind: 'reader', label: '小明在巴黎' }, { kind: 'reader', label: '' },
  { kind: 'exercise' }, { kind: 'exercise', label: 'Translate' },
];
function stored(c: FlatCtx): StoredClaudeContext {
  const snap = { ...(c.label !== undefined ? { label: c.label } : {}) };
  switch (c.kind) {
    case 'card': return { kind: 'card', note_id: 'n1', ...snap };
    case 'practice': return { kind: 'practice', ...(c.scenario !== undefined ? { scenario: c.scenario } : {}), ...snap };
    case 'chat_message': return { kind: 'chat_message', message_id: 'm1', ...snap };
    case 'reader': return { kind: 'reader', reader_id: 'r1', ...snap };
    case 'exercise': return { kind: 'exercise', lesson_id: 'l1', exercise_key: 's0e1', ...snap };
    default: return { kind: 'general', ...snap };
  }
}
const LONG = '我昨天去了商店买东西，'.repeat(13);
const TEXTS = [
  '', '   ', '\n\t', '　', '  ', '我昨天去了商店', '  How do  I\nsay   hello?  ', '你好　世界', 'a b c﻿d',
  LONG, LONG.slice(0, 120), LONG.slice(0, 119), LONG.slice(0, 121), `${'x'.repeat(118)}😀😀`, `   ${'好'.repeat(125)}   `,
];
const titles = CTXS.flatMap((ctx) => TEXTS.map((text) => ({ ctx, text, out: titleFor(stored(ctx), text) })));
const previews = TEXTS.map((text) => ({ text, out: previewOf(text) }));

// ---------- Messages ----------

type Msg = CachedMessageFields;
const TIMES = ['2026-11-03T10:00:00.000Z', '2026-11-03T10:00:00.500Z', '2026-11-03T10:00:01.000Z', '2026-11-03T09:59:59.999Z', '2026-11-03T10:05:00.000Z'];
const TEXTS_ZH = ['', '你', '你好', '你好，我', '你好，我们', '您好', '这是一个好问题。', '这是一个好问题。我用'];
let next = 0;
function randomMsg(over: Partial<Msg> = {}): Msg {
  const id = over.id ?? `m${next++}`;
  const m: Msg = {
    id,
    client_id: chance(0.4) ? `c${int(0, 6)}` : null,
    role: pick(['user', 'assistant'] as const),
    created_at: pick(TIMES),
    status: pick([null, null, 'pending', 'failed'] as const),
    content: pick(TEXTS_ZH),
    streaming: chance(0.3),
    error: chance(0.2) ? 'Claude is busy' : null,
    ...(chance(0.3) ? { queued: true } : {}),
    ...(chance(0.4) ? { _seq: int(0, 6) } : {}),
    ...over,
  };
  return m;
}

const sorts = Array.from({ length: 60 }, () => {
  const rows = Array.from({ length: int(0, 8) }, () => randomMsg());
  return { rows, out: sortMessages(rows).map((m) => m.id) };
});

const merges = Array.from({ length: 200 }, () => {
  const local = chance(0.15) ? undefined : randomMsg({ id: 'a' });
  const server = randomMsg({ id: 'a', ...(chance(0.7) ? { _seq: undefined } : {}) });
  if (server._seq === undefined) delete server._seq;
  return { local: local ?? null, server, out: mergeMessage(local, server) };
});

const threadMerges = Array.from({ length: 200 }, () => {
  const prev = Array.from({ length: int(0, 6) }, () => randomMsg({ id: chance(0.4) ? `c${int(0, 6)}` : `s${int(0, 6)}` }));
  // Distinct ids within one side (a thread never holds two rows with one id).
  const dedupe = (rows: Msg[]) => rows.filter((m, i) => rows.findIndex((r) => r.id === m.id) === i);
  const server = dedupe(Array.from({ length: int(0, 5) }, () => {
    const m = randomMsg({ id: `s${int(0, 6)}` });
    delete m._seq;
    delete m.queued;
    return m;
  }));
  const p = dedupe(prev);
  const full = chance(0.5);
  const out = mergeThreadMessages(p, server, { full });
  return { prev: p, server, full, out: { messages: out.messages, removed: out.removed } };
});

const frames = Array.from({ length: 200 }, () => {
  const row = randomMsg({ id: 'a' });
  const frame = {
    seq: int(0, 7),
    status: pick(['thinking', 'tool', 'streaming', 'done', 'failed']),
    ...(chance(0.7) ? { text: pick(TEXTS_ZH) } : {}),
    ...(chance(0.4) ? { error: 'Overloaded' } : {}),
  };
  return { row, frame, out: applyTurnFrame(row, frame) };
});

// ---------- Thread list ----------

type Thread = CachedThreadFields & { title: string; cursor?: string };
function randomThread(): Thread {
  const local = chance(0.25);
  const id = local ? `c${int(0, 5)}` : `t${int(0, 5)}`;
  return {
    id,
    client_id: local ? id : chance(0.5) ? `c${int(0, 5)}` : chance(0.2) ? id : null,
    title: pick(['银行', 'Hello', '点菜', '']),
    ...(local ? { local: true } : chance(0.3) ? { local: false } : {}),
    ...(chance(0.4) ? { cursor: `k${int(0, 9)}` } : {}),
  };
}
const lists = Array.from({ length: 200 }, () => {
  const dedupe = (rows: Thread[]) => rows.filter((t, i) => rows.findIndex((r) => r.id === t.id) === i);
  const prev = dedupe(Array.from({ length: int(0, 6) }, randomThread));
  const rows = dedupe(Array.from({ length: int(0, 5) }, () => {
    const t = randomThread();
    if (t.local) return { id: `t${int(0, 5)}`, client_id: t.id, title: t.title };
    const { cursor: _c, local: _l, ...row } = t;
    return row;
  }));
  const deleted = Array.from({ length: int(0, 2) }, () => pick(['t0', 't1', 't2', 'c0', 'c1', 'zz']));
  return { prev, rows, deleted, out: mergeThreadList<Thread>(prev, rows, deleted) };
});

writeFileSync(
  join(OUT, 'claude-thread-cache.json'),
  JSON.stringify({ titles, previews, sorts, merges, threadMerges, frames, lists, titleMax: 120 }, null, 1),
);
