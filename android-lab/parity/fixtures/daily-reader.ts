/**
 * Golden vectors for graded readers read ONCE (shared/study/daily-reader.ts):
 * pickTodaysReader / nextUnreadReader over seeded reader lists (read / unread,
 * studyable or not, created_at ties), shouldGenerateDailyReader over every
 * combination, storyNextPage and storyPageGapMs ("▶ Play whole story"), and the reader
 * queue ("Up next", shared/reader/queue.ts): order with / without priorities, moves,
 * bottom priority, merged reorders.
 * Writes daily-reader.json; core DailyReaderParityTest asserts DailyReader.kt matches.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  bottomQueuePriority,
  mergeReaderOrder,
  moveReaderInQueue,
  queuePriorities,
  sortReadersForQueue,
} from '../../../shared/reader/queue';
import {
  nextUnreadReader,
  pickTodaysReader,
  unreadReaderQueue,
  shouldGenerateDailyReader,
  storyNextPage,
  storyPageGapMs,
  READERS_PER_DAY,
  STORY_PAGE_GAP_MS,
  type ReaderOfferRow,
} from '../../../shared/study/daily-reader';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: daily-reader <out-dir>');
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
const rand = rng(20261007);
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

const T0 = Date.UTC(2026, 9, 7, 9, 0, 0);
const DAY = 86_400_000;

const picks: unknown[] = [];
for (let i = 0; i < 400; i++) {
  const n = int(0, 8);
  const readers: ReaderOfferRow[] = Array.from({ length: n }, (_, k) => ({
    id: `r${int(0, 30)}-${k}`,
    created_at: rand() < 0.2 ? '2026-10-02T08:31:39.000Z' : new Date(T0 - int(0, 60) * DAY - int(0, 3600) * 1000).toISOString(),
    studyable: rand() < 0.85,
    read: rand() < 0.5,
    // Half the lists were never reordered (all NULL = the old rule); the rest mix placed / unplaced.
    queue_priority: i % 2 === 0 || rand() < 0.3 ? null : int(-3, 6),
  }));
  const readToday = rand() < 0.25;
  picks.push({
    readers,
    read_today: readToday,
    picked: pickTodaysReader(readers, readToday)?.id ?? null,
    next: nextUnreadReader(readers)?.id ?? null,
    queue: unreadReaderQueue(readers).map(r => r.id),
    sorted: sortReadersForQueue(readers).map(r => r.id),
  });
}

const MOVES = ['top', 'up', 'down', 'bottom'] as const;
const queue: unknown[] = [];
for (let i = 0; i < 200; i++) {
  const n = int(0, 7);
  const ids = Array.from({ length: n }, (_, k) => `q${k}`);
  const order = [...ids].sort(() => rand() - 0.5);
  const id = rand() < 0.1 ? 'missing' : order[int(0, Math.max(0, n - 1))] ?? 'missing';
  const to = rand() < 0.3 ? int(-1, n + 2) : MOVES[int(0, 3)];
  const requested = Array.from({ length: int(0, 4) }, () => (rand() < 0.2 ? 'zz' : order[int(0, Math.max(0, n - 1))] ?? 'zz'));
  const priorities = Array.from({ length: int(0, 5) }, () => (rand() < 0.3 ? null : int(-6, 8)));
  queue.push({
    order,
    id,
    to,
    moved: moveReaderInQueue(order, id, to),
    requested,
    merged: mergeReaderOrder(order, requested),
    priorities,
    bottom: bottomQueuePriority(priorities),
    written: queuePriorities(order).map(p => p.queue_priority),
  });
}

const generate: unknown[] = [];
for (const readToday of [false, true]) {
  for (const hasUnread of [false, true]) {
    for (const lastAttemptDate of [null, '2026-10-06', '2026-10-07']) {
      generate.push({ readToday, hasUnread, lastAttemptDate, today: '2026-10-07', want: shouldGenerateDailyReader({ readToday, hasUnread, lastAttemptDate, today: '2026-10-07' }) });
    }
  }
}

const pages: unknown[] = [];
for (const count of [0, 1, 2, 3, 7]) {
  for (let idx = -1; idx <= 8; idx++) pages.push({ index: idx, count, next: storyNextPage(idx, count) });
}
const gaps = [0, -1, 0.5, 0.75, 1, 1.25, 2, 0.33, 0.1].map(speed => ({ speed, gap: storyPageGapMs(speed) }));

writeFileSync(join(OUT, 'daily-reader.json'), JSON.stringify({
  readers_per_day: READERS_PER_DAY,
  story_page_gap_ms: STORY_PAGE_GAP_MS,
  picks,
  generate,
  pages,
  gaps,
  queue,
}));
console.log(`daily-reader: ${picks.length} picks, ${generate.length} generate, ${pages.length} pages`);
