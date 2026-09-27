/**
 * Package D — Progress tab. Golden vectors from the web's own shared/progress (the same
 * definitions the server's /api/progress SQL follows) for core/…/ProgressParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  dailyProgress, dayCards, utcDate, windowStart, formatStudyTime, formatStreakTime,
  studyStreak, masteryProgress, masteryLevel,
  type ProgressEvent, type ProgressCardInfo,
} from '../../../shared/progress';

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

const TYPES = ['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi'];
const ZONES = ['UTC', 'Pacific/Auckland', 'America/Los_Angeles', 'Asia/Shanghai', 'Europe/London', 'Pacific/Chatham'];

function offsetIso(ms: number, offsetMin: number): string {
  // An ISO string with an explicit offset (a shape Date.parse and SQLite both accept).
  const local = new Date(ms + offsetMin * 60000).toISOString().slice(0, 23);
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  return `${local}${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

const cases = [];
for (let c = 0; c < 60; c++) {
  const r = rng(1000 + c);
  // Around DST changes and year ends too.
  const nowMs = Date.parse('2025-12-31T12:00:00.000Z') + Math.floor(r() * 400 * 86_400_000);
  const cards: ProgressCardInfo[] = [];
  const cardCount = 1 + Math.floor(r() * 12);
  for (let i = 0; i < cardCount; i++) {
    cards.push({ card_id: `c${i}`, card_type: TYPES[i % 3], note_id: `n${Math.floor(i / 3)}`, hanzi: `字${i}`, pinyin: `zì${i}`, english: `word ${i}` });
  }
  const events: ProgressEvent[] = [];
  const n = c === 0 ? 0 : Math.floor(r() * 250);
  const span = 1 + Math.floor(r() * 45);
  for (let k = 0; k < n; k++) {
    const at = nowMs - Math.floor(r() * span * 86_400_000) + (r() < 0.05 ? 3_600_000 : 0);
    const card = r() < 0.05 ? 'deleted-card' : cards[Math.floor(r() * cards.length)].card_id;
    events.push({
      card_id: card,
      rating: Math.floor(r() * 4),
      reviewed_at: r() < 0.05 ? offsetIso(at, [720, -300, 345][k % 3]) : new Date(at).toISOString(),
      time_spent_ms: r() < 0.1 ? null : Math.floor(r() * 60_000),
      user_answer: r() < 0.2 ? '字' : r() < 0.3 ? '' : null,
    });
  }
  const dates = [...new Set(events.map((e) => utcDate(e.reviewed_at)))].sort().slice(-6);
  const streaks = ZONES.map((zone) => {
    process.env.TZ = zone;
    const s = studyStreak(events, new Date(nowMs));
    return { zone, ...s };
  });
  process.env.TZ = 'UTC';
  const masteryCards = Array.from({ length: Math.floor(r() * 40) }, (_, i) => ({
    card_type: r() < 0.05 ? 'weird' : TYPES[i % 3],
    queue: Math.floor(r() * 4),
    stability: [0, 7, 21, 7.000001, 21.5, r() * 60][Math.floor(r() * 6)],
  }));
  cases.push({
    now_ms: nowMs,
    window_start: windowStart(nowMs),
    events,
    cards,
    daily: dailyProgress(events, nowMs),
    days: dates.map((d) => dayCards(events, cards, d)),
    streaks,
    mastery_cards: masteryCards,
    mastery: masteryProgress(masteryCards),
    levels: masteryCards.map((m) => masteryLevel(m.queue, m.stability)),
  });
}

const times = [0, -5, 1, 59_999, 60_000, 89_999, 90_000, 119_999, 3_599_999, 3_600_000, 3_630_000, 3_660_000, 7_199_999, 86_400_000, 123_456_789];
writeFileSync(join(OUT, 'progress.json'), JSON.stringify({
  cases,
  times: times.map((ms) => ({ ms, study: formatStudyTime(ms), streak: formatStreakTime(ms) })),
}));
