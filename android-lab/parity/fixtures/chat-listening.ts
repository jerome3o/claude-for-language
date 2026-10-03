/**
 * Golden vectors for chat listening mode (shared/chats/listening.ts): candidates, the hide rule
 * over settings × read markers × revealed ids, thresholds, "turned on" since, revealed ids (cap),
 * inbox previews, prefetch selection, speech estimates, durations and the placeholder bars
 * (uint32 FNV-1a + LCG + sin envelope, rounded to 0.01) — plus the inbox's live update carrying
 * `attachment_kind`. Writes chat-listening.json; checked by core/…/chat/ChatListeningParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  HIDE_ALL_SINCE,
  LISTENING_PREFETCH_COUNT,
  LISTENING_PREVIEW,
  REVEALED_MAX,
  addRevealed,
  effectiveListening,
  estimateSpeechSeconds,
  formatListeningDuration,
  hasHan,
  listeningBars,
  listeningCandidate,
  listeningPreview,
  listeningThreshold,
  prefetchSelection,
  shouldHideMessage,
  sinceWhenTurnedOn,
  type ListeningMessage,
  type ListeningSetting,
} from '../../../shared/chats/listening';
import { applyIncomingMessage, type ChatListRow } from '../../../shared/chats/inbox';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

// A small seeded PRNG so the cases are stable.
let seed = 20261003;
function rnd(): number {
  seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
  return seed / 0x100000000;
}
function pick<T>(xs: readonly T[]): T {
  return xs[Math.floor(rnd() * xs.length)];
}

const ME = 'me';
const THEM = 'them';
const texts = [
  '你今天去哪儿了？', 'see you at 5', 'ok 好的', '', '   ', '㐀', '𠀀𠀁', '鿿', '一', 'ABC 中文 123',
  '我们 meet at 5 好吗', 'hello　world', 'a b c', '你好，\n明天见！', '😀😀', 'ｆｕｌｌ ｗｉｄｔｈ', '1 2 3 4 5 6', '中文中文中文中文中文中文中文中文中文中文',
];
const kinds = [null, null, null, '', 'image', 'voice', 'file', 'video'];
const times = [
  '2026-10-03T10:00:00.000Z', '2026-10-03T10:01:00.000Z', '2026-10-03T10:02:00.000Z', '2026-10-03T10:02:00.001Z',
  '2026-10-03T10:03:00Z', '2026-10-02T23:59:59.999Z', '1970-01-01T00:00:00.000Z', '', '2026-10-03',
];
const deleteds = [null, null, null, '', '2026-10-03T11:00:00Z'];
const senders = [THEM, THEM, THEM, ME, 'claude'];

const messages: ListeningMessage[] = [];
for (let i = 0; i < 160; i++) {
  messages.push({
    id: `m${i}`,
    sender_id: pick(senders),
    content: pick(texts),
    created_at: pick(times),
    deleted_at: pick(deleteds),
    attachment_kind: pick(kinds),
  });
}

const settings: ListeningSetting[] = [
  { on: true, since: null },
  { on: false, since: null },
  { on: true, since: HIDE_ALL_SINCE },
  { on: true, since: '2026-10-03T10:01:00.000Z' },
  { on: false, since: '2026-10-03T10:01:00.000Z' },
  { on: true, since: '2026-10-03T10:02:00.000Z' },
  { on: true, since: '' },
];
const markers: (string | null | undefined)[] = [null, undefined, '2026-10-03T10:01:00.000Z', '2026-10-03T10:02:00.000Z', '', HIDE_ALL_SINCE];
const revealedSets: string[][] = [[], ['m1', 'm3', 'm5'], messages.filter((_, i) => i % 4 === 0).map((m) => m.id)];

const candidates = messages.map((m) => ({ msg: m, viewer: ME, result: listeningCandidate(m, ME) }));
const candidatesThem = messages.slice(0, 40).map((m) => ({ msg: m, viewer: THEM, result: listeningCandidate(m, THEM) }));

const hides: { msg: number; setting: number; marker: number; revealed: number; result: boolean }[] = [];
for (let mi = 0; mi < messages.length; mi += 3) {
  for (let si = 0; si < settings.length; si++) {
    for (let ki = 0; ki < markers.length; ki++) {
      for (let ri = 0; ri < revealedSets.length; ri++) {
        hides.push({ msg: mi, setting: si, marker: ki, revealed: ri, result: shouldHideMessage(messages[mi], { viewerId: ME, setting: settings[si], readMarkerAtOpen: markers[ki], revealed: revealedSets[ri] }) });
      }
    }
  }
}

const effective = [
  { row: null, def: true }, { row: null, def: false }, { row: { on: false, since: null }, def: true },
  { row: { on: true, since: '2026-10-03T10:00:00.000Z' }, def: false }, { row: { on: true, since: '' }, def: false },
].map((c) => ({ ...c, result: effectiveListening(c.row, c.def) }));

const thresholds: { setting: number; marker: number; result: string }[] = [];
settings.forEach((s, si) => markers.forEach((k, ki) => thresholds.push({ setting: si, marker: ki, result: listeningThreshold(s, k) })));

const sinceCases = [
  { times: [], now: '2026-10-03T12:00:00.000Z' },
  { times: ['2026-10-03T10:01:00.000Z', '2026-10-03T10:03:00.000Z', '2026-10-03T10:02:00.000Z'], now: 'NOW' },
  { times: ['', ''], now: 'NOW' },
  { times: ['2026-10-03', '2026-10-03T00:00:00Z'], now: 'NOW' },
  { times: ['b', 'a', 'B', 'é'], now: 'NOW' },
].map((c) => ({ ...c, result: sinceWhenTurnedOn(c.times.map((t) => ({ created_at: t })), c.now) }));

const revealedCases = [
  { list: [], id: 'a', max: REVEALED_MAX },
  { list: ['a', 'b'], id: 'a', max: REVEALED_MAX },
  { list: ['a', 'b', 'c'], id: 'd', max: 3 },
  { list: ['a', 'b', 'c'], id: 'b', max: 2 },
  { list: ['a', 'a', 'b'], id: 'a', max: 5 },
  { list: ['a', 'b', 'c'], id: 'z', max: 1 },
  { list: Array.from({ length: 505 }, (_, i) => `r${i}`), id: 'r3', max: REVEALED_MAX },
  { list: Array.from({ length: 500 }, (_, i) => `r${i}`), id: 'new', max: REVEALED_MAX },
].map((c) => ({ ...c, result: addRevealed(c.list, c.id, c.max) }));

type Last = { id: string; sender_id: string; created_at: string; preview: string; attachment_kind?: string | null; deleted?: boolean };
const lasts: (Last | null)[] = [null];
for (let i = 0; i < 40; i++) {
  lasts.push({
    id: `l${i}`, sender_id: pick(senders), created_at: pick(times), preview: pick(texts),
    attachment_kind: pick(kinds), deleted: pick([false, false, true, undefined]) as boolean | undefined,
  });
}
const previews: { last: number; setting: number; marker: number; revealed: string[]; result: string | null }[] = [];
lasts.forEach((last, li) => settings.forEach((s, si) => markers.forEach((k, ki) => {
  const revealed = li % 5 === 0 && last ? [last.id] : [];
  previews.push({ last: li, setting: si, marker: ki, revealed, result: listeningPreview(last, { viewerId: ME, setting: s, readMarker: k, revealed }) });
})));

const prefetch = [0, 1, 2, 5, 20, LISTENING_PREFETCH_COUNT, 200].map((limit) => ({ limit, result: prefetchSelection(messages, ME, limit).map((m) => m.id) }));
const prefetchDefault = prefetchSelection(messages.slice(0, 30), THEM).map((m) => m.id);

const speechTexts = [...texts, '好', '你今天去哪儿了？', 'a', 'x y z', 'one, two; three!', ' spaced out　中', '﻿word', 'tab\tsep\nline', '数字123和abc', '🀄中', 'é à', '—', '中'.repeat(100), 'word '.repeat(40)];
const speech = speechTexts.map((text) => ({ text, result: estimateSpeechSeconds(text) }));
const han = speechTexts.map((text) => ({ text, result: hasHan(text) }));

const durations = [0, 0.4, 0.5, 1.5, 2.5, 4, 59.5, 59.4, 60, 75.4, 119.6, 600, 3599.5, 3600, -1, -0.5, 7.49999, 125.5].map((s) => ({ s, result: formatListeningDuration(s) }));

const barIds = ['msg-1', 'msg-2', '', 'a', '9f1c7b1e-2f55-4c8e-9d8f-3a3b7c1d0e11', '中文消息', '😀', 'x'.repeat(200)];
for (let i = 0; i < 60; i++) barIds.push(`m-${Math.floor(rnd() * 1e9).toString(36)}-${i}`);
const bars = barIds.map((id) => ({ id, result: listeningBars(id) }));
const barsCounts = [0, 1, 7, 24, 48].map((count) => ({ id: 'msg-count', count, result: listeningBars('msg-count', count) }));

// The inbox's live update keeps the new message's attachment kind (listening previews need it).
const row: ChatListRow = {
  conversation_id: 'c1', relationship_id: 'r1', title: null, is_ai: false,
  other_user: { id: THEM, name: 'Minghui', picture_url: null }, other_role: 'tutor',
  last_message: { id: 'old', sender_id: THEM, preview: '你好', created_at: '2026-10-03T09:00:00.000Z' },
  unread: 0, my_read_at: '2026-10-03T09:00:00.000Z', last_activity_at: '2026-10-03T09:00:00.000Z',
};
const live = [
  { id: 'n1', conversation_id: 'c1', sender_id: THEM, preview: '📷 Photo', created_at: '2026-10-03T10:00:00.000Z', attachment_kind: 'image' },
  { id: 'n2', conversation_id: 'c1', sender_id: THEM, preview: '晚上见', created_at: '2026-10-03T10:00:00.000Z' },
  { id: 'n3', conversation_id: 'c1', sender_id: THEM, preview: '晚上见', created_at: '2026-10-03T10:00:00.000Z', attachment_kind: null },
].map((msg) => ({ msg, result: applyIncomingMessage([row], msg, ME) }));

writeFileSync(
  join(OUT, 'chat-listening.json'),
  JSON.stringify({
    constants: { LISTENING_PREVIEW, HIDE_ALL_SINCE, LISTENING_PREFETCH_COUNT, REVEALED_MAX },
    messages, settings, markers: markers.map((m) => (m === undefined ? null : m)), revealedSets,
    candidates, candidatesThem, hides, effective, thresholds, sinceCases, revealedCases,
    lasts, previews, prefetch, prefetchDefault, speech, han, durations, bars, barsCounts, row, live,
  }),
);
