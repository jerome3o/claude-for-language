/**
 * Golden vectors for chat round 2 (docs/CHAT.md "Round 2"): the long-press message menu
 * (shared/chats/messageMenu.ts — messageMenu / menuText) and the Signal-like bubble layout
 * (shared/chats/bubbles.ts — layoutBubbles / tickFor / localDay / firstLink).
 * Writes chat-round2.json; checked by core/…/ChatRound2ParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { messageMenu, menuText, type MenuMessage } from '../../../shared/chats/messageMenu';
import { queueLabel, loadDraft, saveDraft } from '../../../frontend/src/services/chatDrafts';
import { sayBetterState, sayBetterLabel, autoCheckSettingShown } from '../../../shared/chats/autoCheck';
import { layoutBubbles, tickFor, localDay, firstLink, GROUP_GAP_MS, type BubbleMessage } from '../../../shared/chats/bubbles';

const OUT = process.argv[2];
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
const rand = rng(20261003);
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];

// ---- messageMenu ----
const contents = ['你好，今天怎么样？', 'See you tomorrow', '  ', '', 'ok 好的', '〇'];
const attachments: MenuMessage['attachment'][] = [
  null,
  { kind: 'image' },
  { kind: 'voice', transcript: '我很好', translation: null },
  { kind: 'voice', transcript: '我很好', translation: "I'm fine" },
  { kind: 'voice', transcript: '  ', translation: '' },
  { kind: 'voice', transcript: null },
  { kind: 'voice', transcript: 'thanks', translation: 'thanks' },
  // Round 2 PR 3: files and video clips (caption tools work on the content; Edit, not "Edit caption").
  { kind: 'file' },
  { kind: 'video' },
];
const menus: unknown[] = [];
for (const content of contents)
  for (const attachment of attachments)
    for (const mine of [true, false])
      for (const role of ['student', 'tutor'] as const)
        for (const ai of [false, true])
          for (const variant of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
            const msg: MenuMessage = { sender_id: mine ? 'me' : 'them', content, attachment };
            // Spread the other fields over the variants (every field is covered at least once per combination of the above).
            if (variant === 1) msg.deleted_at = '2026-10-01T10:00:00.000Z';
            if (variant === 2) msg.pending = true;
            if (variant === 3) { msg.correction = { text: '你好！' }; msg.translation = 'Hi, how are you today?'; }
            if (variant === 4) { msg.check_status = 'needs_improvement'; msg.has_discussion = true; msg.pinned_at = '2026-10-02T09:00:00.000Z'; }
            if (variant === 5) { msg.check_status = 'correct'; msg.deleted_at = ''; msg.pinned_at = ''; msg.translation = ''; }
            if (variant === 6) { msg.correction = { text: '' }; msg.check_status = null; }
            if (variant === 7) { msg.pending = false; msg.translation = 'Translated'; msg.has_discussion = false; }
            // Auto-check (shared/chats/autoCheck.ts): improvable / ok on the current text, stale after an edit, with a correction.
            if (variant === 8) msg.auto_check = { status: 'improvable', text: content };
            if (variant === 9) { msg.auto_check = { status: 'ok', text: content }; msg.check_status = 'needs_improvement'; }
            if (variant === 10) msg.auto_check = { status: 'improvable', text: content + '了' };
            if (variant === 11) { msg.auto_check = { status: 'improvable', text: content }; msg.correction = { text: '你好！' }; }
            for (const state of [{ pinyinOn: false, translateOn: false }, { pinyinOn: true, translateOn: false }, { pinyinOn: false, translateOn: true }, { pinyinOn: true, translateOn: true }]) {
              // Every toggle state only for the plain variants (keeps the file small).
              if (variant > 3 && (state.pinyinOn || state.translateOn)) continue;
              menus.push({ message: msg, role, ai, state, text: menuText(msg), result: messageMenu(msg, role, ai, 'me', state) });
            }
          }

// ---- layoutBubbles / tickFor / localDay ----
const MIN = 60_000;
const HOUR = 60 * MIN;
const offsets = [0, 60, -300, 480, 330, -720, 840, 345];
const layouts: unknown[] = [];
for (let s = 0; s < 120; s++) {
  // Start close to a local midnight so day boundaries are crossed at every offset.
  let t = Date.UTC(2026, int(0, 11), int(1, 28), int(0, 23), int(0, 59), int(0, 59)) + int(0, 999);
  const n = int(1, 18);
  const msgs: BubbleMessage[] = [];
  const senders = pick([['me', 'them'], ['me'], ['them'], ['me', 'them', 'claude']]);
  let sender = pick(senders);
  for (let i = 0; i < n; i++) {
    // Gaps around the 3-minute threshold, an hour, a day, sometimes out of order.
    const gap = pick([0, 1, 1000, 30_000, GROUP_GAP_MS - 1, GROUP_GAP_MS, GROUP_GAP_MS + 1, 2 * MIN, 10 * MIN, HOUR, 5 * HOUR, 24 * HOUR, -MIN]);
    t += gap;
    if (rand() < 0.35) sender = pick(senders);
    const m: BubbleMessage = { id: `m${s}-${i}`, sender_id: sender, created_at: new Date(t).toISOString() };
    const r = rand();
    if (r < 0.06) m.deleted_at = new Date(t + MIN).toISOString();
    else if (r < 0.1) m.pending = 'sending';
    else if (r < 0.13) m.pending = 'failed';
    else if (r < 0.15) m.created_at = pick(['not a date', '', '2026-10-01 10:00:00', '2026-10-01', `${new Date(t).toISOString().slice(0, 19)}+08:00`]);
    msgs.push(m);
  }
  const readAt = pick([null, undefined, '', msgs[int(0, msgs.length - 1)].created_at, new Date(t + HOUR).toISOString(), new Date(t - 10 * MIN).toISOString()]);
  const offset = pick(offsets);
  layouts.push({ messages: msgs, viewer: 'me', readAt: readAt ?? null, offset, result: layoutBubbles(msgs, 'me', readAt, offset) });
}

const ticks: unknown[] = [];
for (const sender of ['me', 'them'])
  for (const deleted of [null, '', '2026-10-01T10:05:00.000Z'])
    for (const pending of [null, 'sending', 'failed'] as const)
      for (const readAt of [null, '', '2026-10-01T09:59:59.999Z', '2026-10-01T10:00:00.000Z', '2026-10-01T10:00:00.001Z', '2026-10-02T00:00:00Z']) {
        const m: BubbleMessage = { id: 'x', sender_id: sender, created_at: '2026-10-01T10:00:00.000Z', deleted_at: deleted, pending };
        ticks.push({ message: m, readAt, tick: tickFor(m, 'me', readAt) });
      }

const days: unknown[] = [];
const isoSamples = [
  '2026-10-01T00:00:00.000Z', '2026-10-01T23:59:59.999Z', '2026-12-31T23:30:00Z', '2026-01-01T00:15:00.000Z', '2024-02-29T22:00:00Z',
  '2026-10-01T10:00:00+08:00', '2026-10-01T02:00:00-05:00', '2026-10-01 10:00:00', '2026-10-01', 'garbage', '', '2026-03-29T01:30:00.000Z',
];
for (const iso of isoSamples) for (const offset of [...offsets, -600, 600]) days.push({ iso, offset, day: localDay(iso, offset) });

// ---- firstLink ----
const linkTexts = [
  '', 'no link here', 'see https://example.com', 'https://example.com.', 'go to https://example.com/a?b=1&c=2, then',
  '看这个：https://zh.wikipedia.org/wiki/汉字。', '链接https://example.com，很好', 'https://en.wikipedia.org/wiki/Python_(programming_language)',
  'https://en.wikipedia.org/wiki/Python_(programming_language))', '(see https://example.com/page)', 'HTTPS://EXAMPLE.COM/UPPER',
  'Http://Mixed.Case/Path!', 'http://localhost:8080/path', 'https://localhost', 'https://a.b', 'https://.', 'https://example.', 'http://x.y/',
  'two https://first.com and https://second.com', 'ftp://example.com', 'https:// example.com', '"https://quoted.com"',
  "'https://single.com'", '<https://angled.com>', 'https://example.com/）后面', 'https://example.com」', 'https://example.com』x',
  'https://example.com》', 'https://example.com、', 'https://example.com？', 'https://example.com！！', 'https://example.com...',
  'https://example.com/path;', 'https://example.com/path:', 'https://example.com/a]', 'https://example.com/a}', 'https://例子.测试/路径',
  'https://example.com　全角空格', 'https://example.com nbsp', 'https://example.com\ttab', 'https://example.com\nnext line',
  'httpss://example.com', 'xhttps://example.com', 'https://example.com/(a)(b)', 'https://example.com/a)(', 'https://example.com/((a)',
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s', 'Look: https://bit.ly/3abc 😀', 'https://example.com/😀/x', 'https://example.com/a#frag.',
  'https://example.com sep', 'https://example.com﻿bom', 'http://1.2.3.4/x', 'https://user:pass@host.com/', 'https://host.com:443',
];
const links = linkTexts.map((text) => ({ text, link: firstLink(text) }));

// ---- Round 2 PR 3: queueLabel + drafts per conversation (frontend/src/services/chatDrafts.ts) ----
const queueLabels: unknown[] = [];
for (const waiting of [-1, 0, 1, 2, 3, 10, 51]) for (const online of [false, true]) queueLabels.push({ waiting, online, label: queueLabel(waiting, online) });

// A Map-backed localStorage so the web's own draft functions run here.
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};
// A sequence of saves (ids reused, blanks clearing, more than 50 conversations, equal times) and the
// loads after each one; the Kotlin replays the same sequence.
const draftOps: unknown[] = [];
const blanks = ['   ', '', '\n\t'];
const texts = ['我明天', 'hello', '你好 ', ' 早上好', 'x', '明天见！\n好的'];
let now = 1_700_000_000_000;
for (let i = 0; i < 400; i++) {
  const conv = rand() < 0.05 ? '' : `c${int(0, 90)}`;
  const text = rand() < 0.12 ? pick(blanks) : pick(texts);
  now += pick([0, 0, 1, 1000]);
  saveDraft(conv || undefined, text, now);
  const probes = [conv, `c${int(0, 90)}`, `c${int(0, 90)}`];
  draftOps.push({ conv, text, now, loads: probes.map((c) => ({ conv: c, text: loadDraft(c || undefined) })) });
}
const finalDrafts = Array.from({ length: 91 }, (_, i) => ({ conv: `c${i}`, text: loadDraft(`c${i}`) }));

// ---- auto-check: sayBetterState / sayBetterLabel / autoCheckSettingShown ----
const sayBetter: unknown[] = [];
for (const sender of ['me', 'them'])
  for (const content of ['我昨天去了商店买东西了', '你好', ''])
    for (const deleted of [null, '', '2026-10-01T10:00:00.000Z'])
      for (const kind of [null, '', 'image', 'voice'])
        for (const correction of [null, { text: '' }, { text: '我昨天去商店买东西了' }])
          for (const auto of [null, { status: 'ok' as const, text: content }, { status: 'improvable' as const, text: content }, { status: 'improvable' as const, text: content + '。' }]) {
            const msg = { sender_id: sender, content, deleted_at: deleted, attachment: kind === null ? null : { kind }, correction, auto_check: auto };
            sayBetter.push({ message: msg, result: sayBetterState({ ...msg, attachment: kind ? msg.attachment : null }, 'me') });
          }
const sayBetterLabels = (['corrected', 'improvable', null] as const).flatMap((state) =>
  [null, '', 'Minghui', 'Minghui Li', ' lead'].map((name) => ({ state, name, label: sayBetterLabel(state, name) })));
const settingShown = [true, false, null].flatMap((setting) =>
  ['tutor', 'student', null, ''].map((role) => ({ setting, role, shown: autoCheckSettingShown(setting, role) })));

writeFileSync(join(OUT, 'chat-round2.json'), JSON.stringify({ menus, layouts, ticks, days, links, groupGapMs: GROUP_GAP_MS, queueLabels, draftOps, finalDrafts, sayBetter, sayBetterLabels, settingShown }));
