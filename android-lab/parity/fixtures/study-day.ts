/**
 * Golden vectors for "When does a new day start" (shared/study/studyDay.ts): the study day of
 * instants in several zones for every rollover hour 0–6 — random instants plus every 15 minutes
 * across the London / Los Angeles spring-forward and fall-back nights —, the fixed-offset day,
 * the cutoff and the SQL shift; and what the day decides: introduced-today
 * (shared/decks/study-queue.ts) and the daily reader's "read today" (shared/study/daily-reader.ts)
 * with the study day's start.
 * Writes study-day.json; core StudyDayParityTest asserts StudyDay.kt (+ StudyQueue / DailyReader) match.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  DAY_ROLLOVER_CHOICES,
  DEFAULT_DAY_ROLLOVER_HOUR,
  dayRolloverHour,
  dayRolloverLabel,
  shiftedDayKey,
  studyCutoffMs,
  studyDayAt,
  studyDayAtOffset,
  studyDayKey,
  studyDayShiftMinutes,
} from '../../../shared/study/studyDay';
import { introducedToday } from '../../../shared/decks/study-queue';
import { pickTodaysReader, shouldGenerateDailyReader } from '../../../shared/study/daily-reader';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: study-day <out-dir>');
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
const rand = rng(20261111);
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

const ZONES = ['Europe/London', 'America/Los_Angeles', 'Asia/Shanghai', 'UTC', 'Australia/Lord_Howe', 'Asia/Kolkata', 'Pacific/Chatham', 'America/Sao_Paulo'];
const H = 3_600_000;

const days: unknown[] = [];
const push = (ms: number, zone: string, rollover: number) => {
  const d = studyDayAt(ms, rollover, zone);
  if (studyDayKey(ms, rollover, zone) !== d.key) throw new Error('key mismatch');
  days.push({ ms, zone, rollover, key: d.key, start: d.startMs, end: d.endMs, cutoff: studyCutoffMs(ms, d) });
};
// DST nights: every 15 minutes, every rollover.
const nights: Array<[string, number]> = [
  ['Europe/London', Date.UTC(2026, 2, 28, 20)], // spring forward 29 Mar
  ['Europe/London', Date.UTC(2026, 9, 24, 20)], // fall back 25 Oct
  ['America/Los_Angeles', Date.UTC(2026, 2, 8, 4)], // spring forward 8 Mar
  ['America/Los_Angeles', Date.UTC(2026, 10, 1, 4)], // fall back 1 Nov
  ['Australia/Lord_Howe', Date.UTC(2026, 3, 4, 10)], // half-hour DST
];
for (const [zone, from] of nights) {
  for (let ms = from; ms < from + 14 * H; ms += 15 * 60_000) {
    for (const r of DAY_ROLLOVER_CHOICES) push(ms, zone, r);
  }
}
// Random instants over two years.
for (let i = 0; i < 1500; i++) {
  const ms = Date.UTC(2025, 0, 1) + Math.floor(rand() * 730 * 24 * H);
  push(ms, ZONES[i % ZONES.length], i % 7);
}

const offsets: unknown[] = [];
for (let i = 0; i < 600; i++) {
  const ms = Date.UTC(2026, 0, 1) + Math.floor(rand() * 365 * 24 * H);
  const offset = [-600, -480, -300, 0, 60, 330, 345, 480, 780][i % 9];
  const r = i % 7;
  const d = studyDayAtOffset(ms, r, offset);
  const shift = studyDayShiftMinutes(offset, r);
  offsets.push({ ms, offset, rollover: r, key: d.key, start: d.startMs, end: d.endMs, shift, shifted_key: shiftedDayKey(ms, shift) });
}

// Introduced today with the study day's start: cards first reviewed around midnight.
const introduced: unknown[] = [];
for (let i = 0; i < 200; i++) {
  const zone = ZONES[i % 4];
  const r = i % 7;
  const now = Date.UTC(2026, int(0, 11), int(1, 27), int(0, 23), int(0, 59));
  const dayStart = studyDayAt(now, r, zone).startMs;
  const cards = Array.from({ length: int(1, 10) }, (_, k) => ({ id: `c${k}`, note_id: `n${int(0, 4)}`, deck_id: `d${int(0, 2)}` }));
  const first: Record<string, number> = {};
  for (const c of cards) if (rand() < 0.8) first[c.id] = now - int(0, 30) * H - int(0, 59) * 60_000;
  const got = introducedToday(cards, new Map(Object.entries(first)), dayStart);
  introduced.push({ now, zone, rollover: r, cards, first, day_start: dayStart, introduced: Object.fromEntries([...got].sort()) });
}

// The daily reader: a story read at `read_at`, the session at `now` — read today?
const readers: unknown[] = [];
for (let i = 0; i < 200; i++) {
  const zone = ZONES[i % 4];
  const r = i % 7;
  const now = Date.UTC(2026, int(0, 11), int(1, 27), int(0, 6), int(0, 59));
  const readAt = now - int(0, 600) * 60_000;
  const day = studyDayAt(now, r, zone);
  const readToday = readAt >= day.startMs && readAt < day.endMs;
  const hasUnread = rand() < 0.5;
  const list = hasUnread ? [{ id: 'next', created_at: new Date(readAt).toISOString(), studyable: true, read: false }] : [];
  const lastAttempt = rand() < 0.3 ? day.key : rand() < 0.5 ? null : '2026-01-01';
  readers.push({
    now, zone, rollover: r, read_at: readAt, today: day.key, last_attempt: lastAttempt, has_unread: hasUnread,
    read_today: readToday,
    offered: pickTodaysReader(list, readToday)?.id ?? null,
    generate: shouldGenerateDailyReader({ readToday, hasUnread, lastAttemptDate: lastAttempt, today: day.key }),
  });
}

writeFileSync(join(OUT, 'study-day.json'), JSON.stringify({
  default_hour: DEFAULT_DAY_ROLLOVER_HOUR,
  choices: DAY_ROLLOVER_CHOICES,
  labels: DAY_ROLLOVER_CHOICES.map(dayRolloverLabel),
  normalised: [null, -1, 0, 3, 6, 7, 2.5].map((v) => ({ v, hour: dayRolloverHour(v) })),
  days,
  offsets,
  introduced,
  readers,
}));
