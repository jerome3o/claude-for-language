/**
 * Golden vectors for chat system messages (docs/CHAT.md "System messages", shared/chats/system.ts):
 * systemMessageView / systemMessageText over every kind × both sides × names × odd data (numbers as
 * strings, floats, negatives, raw JSON strings, unknown kinds), installHowToSteps, and how the other
 * chat rules treat a system message — layoutBubbles (own row, no group, no tick), messageMenu (Copy
 * only), listeningCandidate (never hidden), chatRowPreview / applyIncomingMessage (from my side).
 * Writes chat-system.json; checked by core/…/ChatSystemParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { installHowToSteps, systemMessageText, systemMessageView, SYSTEM_KINDS } from '../../../shared/chats/system';
import { layoutBubbles, type BubbleMessage } from '../../../shared/chats/bubbles';
import { messageMenu } from '../../../shared/chats/messageMenu';
import { listeningCandidate } from '../../../shared/chats/listening';
import { applyIncomingMessage, chatRowPreview, type ChatListRow } from '../../../shared/chats/inbox';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

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
const rand = rng(20261021);
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];

const names = ['Minghui Wang', 'Jerome', '  明慧  老师 ', '', null, 'émile', 'ß', '　Li　Ming'];
const rels = ['rel-1', 'rel 2/x', '', null];
const dataByKind: Record<string, unknown[]> = {
  study_budget: [
    { new_cards_per_day: 2, secondary_cards_per_day: 5, is_default: false },
    { new_cards_per_day: 3, secondary_cards_per_day: 6, is_default: true },
    { new_cards_per_day: 12, secondary_cards_per_day: 0 },
    { new_cards_per_day: 2.7, secondary_cards_per_day: -1 },
    { new_cards_per_day: '5', secondary_cards_per_day: 2 },
    { new_cards_per_day: 0, secondary_cards_per_day: 0.4, is_default: 'true' },
    { new_cards_per_day: 1e21, secondary_cards_per_day: true },
    '{"new_cards_per_day":4,"secondary_cards_per_day":1}',
    'not json',
    null,
    {},
  ],
  call_started: [
    { call_id: 'c1' },
    { call_id: 'c 1/é' },
    { call_id: '' },
    { call_id: 'c1', ended: true },
    { call_id: 'c1', ended: true, missed: true },
    { call_id: 'c1', ended: true, missed: false },
    { call_id: 'c1', ended: 'true', missed: true },
    { ended: true, missed: true },
    null,
  ],
  card_flag: [
    { flag_id: 'f1', note_id: 'n1', hanzi: '银行', pinyin: 'yínháng', english: 'bank', message: '我总是和很行搞混' },
    { hanzi: ' 长大 ', message: '  ' },
    { hanzi: '', message: 'x' },
    { hanzi: '你好', note_id: 'n/2', message: 'Is it 您好?' },
    { hanzi: 5, message: 'x' },
    '{"hanzi":"银行","message":"?","note_id":"n9"}',
  ],
  flag_reply: [
    { flag_id: 'f1', note_id: 'n1', hanzi: '银行', reply: '银是金属' },
    { hanzi: '银行', reply: '' },
    { hanzi: '', reply: 'x' },
    { hanzi: '去', note_id: 'n3', reply: '“quoted” reply\nline 2' },
  ],
  install_howto: [{ app_url: 'https://app.test' }, { app_url: '  ' }, {}, null, { app_url: 3 }],
  group_class: [
    { group_name: '周三班', session_id: 's1' },
    { group_name: 'Wed group', session_id: '' },
    { group_name: '', session_id: 's1' },
    { group_name: ' A ', session_id: 's 2' },
  ],
  homework_v9: [{ anything: 1 }, null],
  '  ': [null],
};

const views: unknown[] = [];
for (const kind of [...SYSTEM_KINDS, 'homework_v9', '  ', ' study_budget ']) {
  for (const data of dataByKind[kind.trim()] ?? dataByKind[kind] ?? [null]) {
    for (const viewerIsSender of [true, false]) {
      for (let i = 0; i < 3; i++) {
        const otherName = pick(names);
        const relationshipId = pick(rels);
        const content = pick(['', 'Fallback text', '  📚 Minghui set your new cards to 2 a day  ']);
        const msg = { system_kind: kind, system_data: data, content };
        const ctx = { viewerIsSender, otherName, relationshipId };
        views.push({ msg, ctx, view: systemMessageView(msg, ctx), text: systemMessageText(msg, ctx) });
      }
    }
  }
}

const steps = [null, '', '  ', 'https://app.test', ' https://x.y/z '].map((url) => ({ url, text: installHowToSteps(url) }));

// layoutBubbles with system messages in the thread.
const at = (ms: number) => new Date(Date.UTC(2026, 9, 21, 9) + ms).toISOString();
const layouts: unknown[] = [];
for (let s = 0; s < 120; s++) {
  const msgs: BubbleMessage[] = [];
  let t = 0;
  const n = 2 + Math.floor(rand() * 10);
  for (let i = 0; i < n; i++) {
    t += pick([0, 1000, 60_000, 4 * 60_000, 24 * 3600_000]);
    const m: BubbleMessage = { id: `m${s}-${i}`, sender_id: pick(['me', 'them']), created_at: at(t), content: pick(['你好', '', 'ok']) };
    const r = rand();
    if (r < 0.35) m.system_kind = pick(['study_budget', 'call_started', 'card_flag', 'x']);
    else if (r < 0.45) m.attachment_kind = 'image';
    if (rand() < 0.08) {
      m.deleted_at = at(t + 1);
      m.content = '';
    }
    if (rand() < 0.08 && !m.system_kind) m.pending = pick(['sending', 'failed']);
    msgs.push(m);
  }
  const readAt = pick([null, at(t), at(0)]);
  const offset = pick([0, 480, -300]);
  layouts.push({ messages: msgs, readAt, offset, result: layoutBubbles(msgs, 'me', readAt, offset) });
}

const menus = (['tutor', 'student'] as const).flatMap((role) =>
  [true, false].flatMap((mine) =>
    [false, true].map((deleted) => {
      const message = { sender_id: mine ? 'me' : 'them', content: '🚩 Jerome flagged 银行 for you', system_kind: 'card_flag', deleted_at: deleted ? at(1) : null };
      return { message, role, result: messageMenu(message, role, false, 'me') };
    }),
  ),
);

const candidates = ['card_flag', '', null].flatMap((system_kind) =>
  ['them', 'me'].map((sender_id) => {
    const msg = { id: 'x', sender_id, content: '🚩 Jerome flagged 银行 for you', created_at: at(0), system_kind };
    return { msg, result: listeningCandidate(msg, 'me') };
  }),
);

const baseRow = (over: Partial<ChatListRow>): ChatListRow => ({
  conversation_id: 'c',
  relationship_id: 'rel-1',
  title: null,
  is_ai: false,
  other_user: { id: 'u', name: 'Minghui Wang', picture_url: null },
  other_role: 'tutor',
  last_message: null,
  unread: 0,
  last_activity_at: at(0),
  ...over,
});
const previews: unknown[] = [];
for (const sender of ['me', 'u'])
  for (const name of ['Minghui Wang', null, ' '])
    for (const [kind, data] of [
      ['study_budget', { new_cards_per_day: 2, secondary_cards_per_day: 5 }],
      ['call_started', { call_id: 'k', ended: true, missed: true }],
      ['card_flag', { hanzi: '银行', message: 'two\n  lines' }],
      ['install_howto', { app_url: 'https://a' }],
      ['mystery', null],
      [null, null],
    ] as const) {
      const row = baseRow({
        other_user: { id: 'u', name, picture_url: null },
        last_message: { id: '1', sender_id: sender, preview: 'stored  fallback', created_at: at(0), ...(kind ? { system_kind: kind, system_data: data } : {}) },
      });
      previews.push({ row, result: chatRowPreview(row, 'me') });
    }

const incoming: unknown[] = [];
const rows = [baseRow({ last_message: { id: '1', sender_id: 'u', preview: 'hi', created_at: at(0) } })];
for (const msg of [
  { id: '2', conversation_id: 'c', sender_id: 'u', preview: 'p', created_at: at(5), system_kind: 'study_budget', system_data: { new_cards_per_day: 1, secondary_cards_per_day: 1 } },
  { id: '1', conversation_id: 'c', sender_id: 'u', preview: 'edited', created_at: at(0), system_kind: 'call_started', system_data: { call_id: 'c', ended: true } },
  { id: '3', conversation_id: 'c', sender_id: 'me', preview: 'p', created_at: at(9) },
  { id: '4', conversation_id: 'c', sender_id: 'me', preview: 'p', created_at: at(9), system_kind: 'card_flag' },
]) {
  const result = applyIncomingMessage(rows, msg, 'me');
  incoming.push({ rows, msg, result, previews: result?.map((r) => chatRowPreview(r, 'me')) ?? null });
}

writeFileSync(join(OUT, 'chat-system.json'), JSON.stringify({ kinds: SYSTEM_KINDS, views, steps, layouts, menus, candidates, previews, incoming }));
