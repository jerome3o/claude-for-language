/**
 * Characters & words known (Progress tab). Golden vectors from the web's own
 * shared/progress/known.ts (and shared/scheduler's computeCardTimeline) for
 * core/…/KnownParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  knownProgress, historyPoints, hanCharacters, noteKind, noteKey, knownCountsFromTiers,
  type KnownEventInput,
} from '../../../shared/progress/known';
import { computeCardTimeline, type ReviewEvent } from '../../../shared/scheduler/compute-state';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HANZI = [
  '你好', '好吃', '一', '黑咖啡', '高高兴兴', 'T恤衫', '(一)点(儿)', '鱼 → 余', '一两年以后',
  '你好！', '我很好。', '不是，他是王老师的儿子。', '好吗?', '里斯本离你很近', 'OK', '3。', '',
  '𠮷野家', '卡拉OK', ' 你好 ', '中华人民共和国', '“智慧”的“慧”', '我喜欢看书、看电影。', '吃饭',
  '饭吃完了吗？', '喝咖啡', '咖啡', '学中文', '中文', '老师您好', 'ひらがな', '〇々', '豈更',
];

const DAY = 86_400_000;
const cases = [];
for (let c = 0; c < 50; c++) {
  const r = rng(7000 + c);
  const nowMs = Date.parse('2026-01-01T09:30:00.000Z') + Math.floor(r() * 300 * DAY);
  const notes = Array.from({ length: c === 0 ? 0 : 1 + Math.floor(r() * 14) }, (_, i) => ({
    id: `n${i}`,
    hanzi: HANZI[Math.floor(r() * HANZI.length)],
  }));
  const cards = notes.flatMap((n) =>
    Array.from({ length: 1 + Math.floor(r() * 3) }, (_, k) => ({ id: `${n.id}c${k}`, note_id: n.id })));
  if (r() < 0.2) cards.push({ id: 'orphan', note_id: 'missing-note' });
  const span = 5 + Math.floor(r() * 200);
  const events: KnownEventInput[] = [];
  const count = cards.length === 0 ? 0 : Math.floor(r() * 120);
  for (let k = 0; k < count; k++) {
    const card = r() < 0.05 ? 'gone' : cards[Math.floor(r() * cards.length)].id;
    // Mostly Good / Easy so cards mature; some Again for lapses.
    const x = r();
    const rating = x < 0.12 ? 0 : x < 0.2 ? 1 : x < 0.75 ? 2 : 3;
    const ms = nowMs - Math.floor(r() * span * DAY) + (r() < 0.05 ? 2 * DAY : 0); // a few in the future
    const reviewed_at = r() < 0.03 ? 'nonsense' : new Date(ms).toISOString();
    events.push({ id: r() < 0.1 ? undefined : `e${String(Math.floor(r() * 1000)).padStart(3, '0')}`, card_id: card, rating, reviewed_at });
  }
  if (events.length > 2 && r() < 0.3) events.push({ ...events[1], id: 'same-time' }); // identical timestamps
  const maxPoints = [60, 2, 10, 30][c % 4];
  const points = historyPoints(events, nowMs, maxPoints);
  cases.push({
    now_ms: nowMs,
    max_points: maxPoints,
    notes,
    cards,
    events: events.map((e) => ({ ...e, id: e.id ?? null })),
    points,
    recent_limit: [12, 3, 0][c % 3],
    result: knownProgress(notes, cards, events, points, [12, 3, 0][c % 3]),
  });
}

// computeCardTimeline: the per-event replay the history is built from.
const timelines = [];
for (let c = 0; c < 30; c++) {
  const r = rng(9100 + c);
  let ms = Date.parse('2025-11-02T08:00:00.000Z') + Math.floor(r() * 60 * DAY);
  const events: ReviewEvent[] = [];
  const n = 1 + Math.floor(r() * 15);
  for (let k = 0; k < n; k++) {
    ms += Math.floor(r() * (r() < 0.3 ? 600_000 : 20 * DAY));
    events.push({ id: `t${k}`, card_id: 'c', rating: Math.floor(r() * 4) as 0 | 1 | 2 | 3, reviewed_at: new Date(ms).toISOString() });
  }
  timelines.push({ events, timeline: computeCardTimeline(events) });
}

const texts = HANZI.concat(['A跟B不一样', '一起写我们的结局', '我们可以用汉字打字!因为', '123', 'abc def', '你…好', '你；好', '你：好']);
writeFileSync(join(OUT, 'known.json'), JSON.stringify({
  cases,
  timelines,
  texts: texts.map((t) => ({ text: t, chars: hanCharacters(t), kind: noteKind(t), key: noteKey(t) })),
  tiers: Array.from({ length: 20 }, (_, c) => {
    const r = rng(500 + c);
    const notes = Array.from({ length: Math.floor(r() * 20) }, () => ({
      hanzi: HANZI[Math.floor(r() * HANZI.length)], tier: Math.floor(r() * 3),
    }));
    return { notes, result: knownCountsFromTiers(notes) };
  }),
}));
