/**
 * The server's "today" of study in SQL (shared/study/studyDay.ts `studyDaySql`, services/study-day.ts):
 * the user's zone + "New day starts at", never `date('now')` / `date('now', '+1 day', 'start of day')`.
 * Run against real SQLite (every migration) with the clock pinned at 00:44 in London on 17 Nov 2026
 * (Jerome's screenshot night): last evening's reviews are today's, a snooze ending on the 17th still
 * holds, a card due at 02:00 is due today — and at 04:01 a new day starts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import { getDueCards, getOverviewStats } from '../../db/queries';
import { accountStudyDay, studyDaySql } from '../../../../shared/study/studyDay';
import { CARD_STATE_REPAIR_VERSION } from '../card-state';

const T = (iso: string) => Date.parse(iso);

async function seed(db: SqliteD1) {
  const run = (sql: string, ...p: (string | number | null)[]) => db.raw.run(sql, p);
  // Hand-written cached states (no events): the one-time replay (services/card-state.ts) is marked done.
  run("INSERT INTO users (id, email, name, role, time_zone, card_state_version) VALUES ('u1', 'u1@example.com', 'Learner', 'student', 'Europe/London', ?)", CARD_STATE_REPAIR_VERSION);
  run("INSERT INTO decks (id, user_id, name) VALUES ('d1', 'u1', 'Words')");
  const cards: Array<[string, string | null]> = [
    ['r1', '2026-11-21T10:00:00.000Z'],
    ['r2', '2026-11-21T10:00:00.000Z'],
    ['due-tonight', '2026-11-17T02:00:00.000Z'], // due at 02:00: today's (the study day ends at 04:00)
    ['due-morning', '2026-11-17T09:00:00.000Z'], // tomorrow's
    ['snoozed', '2026-11-16T09:00:00.000Z'], // due, but snoozed until the 17th
  ];
  for (const [id, next] of cards) {
    run('INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES (?, ?, ?, ?, ?)', `n-${id}`, 'd1', `字${id}`, 'zì', id);
    run("INSERT INTO cards (id, note_id, card_type, queue, next_review_at) VALUES (?, ?, 'hanzi_to_meaning', 2, ?)", id, `n-${id}`, next);
  }
  run("INSERT INTO card_holds (id, user_id, card_id, kind, until, created_at) VALUES ('h1', 'u1', 'snoozed', 'snooze', '2026-11-17', '2026-11-16T10:00:00.000Z')");
  const ev = (id: string, card: string, at: string) =>
    run('INSERT INTO review_events (id, card_id, user_id, rating, reviewed_at) VALUES (?, ?, ?, 2, ?)', id, card, 'u1', at);
  ev('e1', 'r1', '2026-11-16T18:00:00.000Z'); // 18:00 yesterday evening: today
  ev('e2', 'r1', '2026-11-16T23:30:00.000Z');
  ev('e3', 'r2', '2026-11-17T00:40:00.000Z');
  ev('e4', 'r2', '2026-11-16 18:30:00'); // SQLite text: still today
  ev('e5', 'r2', '2026-11-16T03:59:00.000Z'); // before 04:00 on the 16th: the day before
}

describe("the server's study day in SQL", () => {
  let db: SqliteD1;
  beforeEach(async () => {
    db = await createSqliteD1();
    await seed(db);
    vi.useFakeTimers({ toFake: ['Date'] });
  });
  afterEach(() => vi.useRealTimers());

  it('studyDaySql: edges, floor and cutoff as SQLite datetime text', () => {
    const now = T('2026-11-17T00:44:00Z');
    const t = studyDaySql(accountStudyDay({ time_zone: 'Europe/London', day_rollover_hour: null }, now), now);
    expect(t).toEqual({
      key: '2026-11-16',
      startSql: '2026-11-16 04:00:00',
      endSql: '2026-11-17 04:00:00',
      floor: '2026-11-15',
      cutoffSql: '2026-11-17 03:59:59',
    });
    // No zone: the fixed offset (UTC by default); the rollover still applies.
    expect(studyDaySql(accountStudyDay(null, now), now).key).toBe('2026-11-16');
    expect(studyDaySql(accountStudyDay({ day_rollover_hour: 0 }, now), now).key).toBe('2026-11-17');
    // Shanghai (UTC+8): 08:44 local, a new study day.
    expect(studyDaySql(accountStudyDay({ time_zone: 'Asia/Shanghai' }, now), now).key).toBe('2026-11-17');
  });

  it('00:44: reviews since 04:00 yesterday, due by 03:59:59, the snooze until the 17th still on', async () => {
    vi.setSystemTime(T('2026-11-17T00:44:00Z'));
    const stats = await getOverviewStats(db, 'u1');
    expect(stats.cards_studied_today).toBe(4);
    expect(stats.cards_due_today).toBe(1); // due-tonight (the snoozed card is held, due-morning is tomorrow's)
    const due = await getDueCards(db, 'u1');
    expect(due.map((c) => c.id)).toEqual(['due-tonight']);
  });

  it('04:01: a new day — nothing reviewed today, the snooze is over, the morning card is due', async () => {
    vi.setSystemTime(T('2026-11-17T04:01:00Z'));
    const stats = await getOverviewStats(db, 'u1');
    expect(stats.cards_studied_today).toBe(0);
    const due = await getDueCards(db, 'u1');
    expect(due.map((c) => c.id).sort()).toEqual(['due-morning', 'due-tonight', 'snoozed']);
  });
});
