/**
 * The server's cached card state = the replay of the card's review events (+ live forgets)
 * (services/card-state.ts), against real SQLite with every migration and the real routes:
 * single / batch / out-of-order / retried uploads, a forget and its undo, an Undo of a review, a
 * time stored in SQLite's format, and legacy (Anki-import) state on cards with no events — Jerome's
 * 199 "reviews due" (Nov 2026) on cards every device showed as NEW. After every step each `cards`
 * row equals `computeCardState(events)` and the server's due count equals the shared queue over the
 * replayed states.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import reviewEvents from '../../routes/review-events';
import cardForgets from '../../routes/card-forgets';
import {
  CARD_STATE_REPAIR_VERSION,
  cacheMatches,
  checkCardStatesIfDue,
  recomputeCards,
  repairUserCardStates,
  type CachedCardState,
} from '../card-state';
import { computeStudyQueue, loadStudyQueueInputs, queueCardFromRow, serverStudyQueue } from '../study-queue';
import { computeCardState, withForgetEvents, type ComputedCardState, type ReviewEvent } from '../../../../shared/scheduler';
import type { Env } from '../../types';

const ME = 'u1';
const NOW = Date.parse('2026-11-17T12:00:00.000Z');
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const TYPES = ['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi'] as const;

let db: SqliteD1;
let api: (method: string, path: string, body?: unknown) => Promise<{ status: number; json: any }>;
const d1 = () => db as unknown as D1Database;

function note(deck: string, id: string) {
  db.raw.run('INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES (?, ?, ?, ?, ?)', [id, deck, `字${id}`, 'zì', id]);
  for (const t of TYPES) db.raw.run('INSERT INTO cards (id, note_id, card_type, queue) VALUES (?, ?, ?, 0)', [`${id}-${t}`, id, t]);
}

/** The truth: every card's state replayed from the events + live forgets in the database. */
function replayedFromDb(): Map<string, ComputedCardState> {
  const cards = db.rows<{ id: string }>('SELECT id FROM cards');
  const events = db.rows<ReviewEvent>('SELECT id, card_id, rating, reviewed_at FROM review_events');
  const forgets = db.rows<{ id: string; card_id: string; forgotten_at: string }>('SELECT id, card_id, forgotten_at FROM card_forgets WHERE undone_at IS NULL');
  const out = new Map<string, ComputedCardState>();
  const t = (at: string) => Date.parse(at.includes('T') ? at : at.replace(' ', 'T') + 'Z');
  for (const { id } of cards) {
    const ev = events.filter((e) => e.card_id === id).map((e) => ({ ...e, reviewed_at: new Date(t(e.reviewed_at)).toISOString() }));
    ev.sort((a, b) => t(a.reviewed_at) - t(b.reviewed_at));
    out.set(id, computeCardState(withForgetEvents(ev, forgets.filter((f) => f.card_id === id)) as ReviewEvent[]));
  }
  return out;
}

function expectCacheEqualsReplay() {
  const truth = replayedFromDb();
  const rows = db.rows<CachedCardState>('SELECT id, queue, stability, difficulty, lapses, ease_factor, interval, repetitions, next_review_at, due_timestamp, learning_step FROM cards');
  const wrong = rows.filter((r) => !cacheMatches(r, truth.get(r.id)!)).map((r) => r.id);
  expect(wrong).toEqual([]);
}

/** The server's due count vs the shared queue over the REPLAYED states (not the cache). */
async function expectQueueFromReplay() {
  const server = await serverStudyQueue(d1(), ME, { nowMs: NOW });
  const inputs = await loadStudyQueueInputs(d1(), ME, { nowMs: NOW });
  const truth = replayedFromDb();
  const cardRows = db.rows<{ id: string; note_id: string; deck_id: string; card_type: string }>('SELECT c.id, c.note_id, n.deck_id, c.card_type FROM cards c JOIN notes n ON n.id = c.note_id');
  const replayedCards = cardRows.map((r) => {
    const s = truth.get(r.id)!;
    return queueCardFromRow({ ...r, queue: s.queue, due_timestamp: s.due_timestamp, next_review_at: s.next_review_at, stability: s.stability });
  });
  const fromReplay = computeStudyQueue({ ...inputs, cards: replayedCards });
  expect({ reviews_due: server.reviews_due, due_today: server.due_today }).toEqual({ reviews_due: fromReplay.reviews_due, due_today: fromReplay.due_today });
  return server;
}

const ev = (id: string, card: string, rating: number, at: number) => ({ id, card_id: card, rating, reviewed_at: iso(at) });

beforeEach(async () => {
  db = await createSqliteD1();
  db.raw.run("INSERT INTO users (id, email, name, role, time_zone) VALUES (?, 'me@x.test', 'Jerome', 'student', 'Europe/London')", [ME]);
  db.raw.run("INSERT INTO decks (id, user_id, name, new_cards_per_day, secondary_cards_per_day, study_priority, created_at) VALUES ('dA', ?, 'Anki import', 3, 6, 2, '2026-01-01T00:00:00Z')", [ME]);
  for (const n of ['n1', 'n2', 'n3', 'n4']) note('dA', n);
  // Legacy state from the Anki import: "review, due in February", no review event behind it.
  for (const id of ['n3-hanzi_to_meaning', 'n3-audio_to_hanzi', 'n4-meaning_to_hanzi']) {
    db.raw.run("UPDATE cards SET queue = 2, stability = 37, interval = 37, repetitions = 3, ease_factor = 2.5, next_review_at = '2026-02-24T11:02:24.142Z' WHERE id = ?", [id]);
  }
  const app = new Hono<{ Bindings: Env }>();
  app.use('/api/*', async (c, next) => {
    c.set('user', { id: ME } as never);
    await next();
  });
  app.route('/api', reviewEvents);
  app.route('/api', cardForgets);
  const env = { DB: db } as unknown as Env;
  api = async (method, path, body) => {
    const res = await app.request(`/api${path}`, body === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env);
    return { status: res.status, json: (await res.json()) as any };
  };
});

describe('cached card state = replay of the events', () => {
  it('legacy state on cards with no events: the first queue read replays every card (once per version)', async () => {
    const before = (await repairUserCardStates(d1(), ME, { dryRun: true }));
    expect(before).toMatchObject({ scanned: 12, differing: 3, without_events: 3, written: 0, done: true, transitions: { 'review → new': 3 } });
    const q = await expectQueueFromReplay();
    expect(q.reviews_due).toBe(0); // was 3 overdue "reviews" from February
    expectCacheEqualsReplay();
    expect(db.rows<{ card_state_version: number; card_state_cursor: string | null; card_state_last_fixed: number }>('SELECT card_state_version, card_state_cursor, card_state_last_fixed FROM users WHERE id = ?', [ME])[0])
      .toEqual({ card_state_version: CARD_STATE_REPAIR_VERSION, card_state_cursor: null, card_state_last_fixed: 3 });
    // Done: a second read doesn't replay again (a wrong row stays until the daily check finds it).
    db.raw.run("UPDATE cards SET queue = 2, next_review_at = '2026-02-01T00:00:00.000Z' WHERE id = 'n4-audio_to_hanzi'");
    await serverStudyQueue(d1(), ME, { nowMs: NOW });
    expect(db.rows<{ queue: number }>("SELECT queue FROM cards WHERE id = 'n4-audio_to_hanzi'")[0].queue).toBe(2);
    // The daily check: not again within a day, then it finds and fixes it.
    expect(await checkCardStatesIfDue(d1(), ME, Date.now())).toBeNull();
    db.raw.run("UPDATE users SET card_state_checked_at = '2026-01-01 00:00:00' WHERE id = ?", [ME]);
    expect(await checkCardStatesIfDue(d1(), ME, Date.now())).toMatchObject({ differing: 1, written: 1 });
    expectCacheEqualsReplay();
  });

  it("never writes another account's card", async () => {
    db.raw.run("INSERT INTO users (id, email, name) VALUES ('u2', 'o@x.test', 'Other')");
    db.raw.run("INSERT INTO decks (id, user_id, name) VALUES ('dX', 'u2', 'Theirs')");
    note('dX', 'nx');
    db.raw.run("UPDATE cards SET queue = 2, stability = 9, next_review_at = '2026-12-01T00:00:00.000Z' WHERE id = 'nx-hanzi_to_meaning'");
    expect(await recomputeCards(d1(), ME, ['nx-hanzi_to_meaning'])).toBe(0);
    expect(db.rows<{ queue: number }>("SELECT queue FROM cards WHERE id = 'nx-hanzi_to_meaning'")[0].queue).toBe(2);
  });

  it('a run stopped part-way resumes from its cursor', async () => {
    const first = await repairUserCardStates(d1(), ME, { maxCards: 5 });
    expect(first).toMatchObject({ scanned: 5, done: false });
    const rest = await repairUserCardStates(d1(), ME, { cursor: first.cursor });
    expect(rest.scanned).toBe(7);
    expect(rest.done).toBe(true);
    expectCacheEqualsReplay();
  });

  it('uploads: single, batch, out of order, retried, a SQLite-format time — every row is the replay, the due count is the shared queue', async () => {
    await serverStudyQueue(d1(), ME, { nowMs: NOW }); // the one-time replay

    expect((await api('POST', '/reviews', { events: [ev('e1', 'n1-hanzi_to_meaning', 2, NOW - 30 * DAY)] })).status).toBe(200);
    expectCacheEqualsReplay();

    // A batch over several cards, including an event OLDER than one already stored (out of order).
    await api('POST', '/reviews', {
      events: [
        ev('e3', 'n1-hanzi_to_meaning', 2, NOW - 10 * DAY),
        ev('e2', 'n1-hanzi_to_meaning', 3, NOW - 31 * DAY),
        ev('e4', 'n2-meaning_to_hanzi', 0, NOW - 2 * DAY),
        ev('e5', 'n2-meaning_to_hanzi', 2, NOW - 2 * DAY + 600_000),
        ev('e6', 'n3-hanzi_to_meaning', 3, NOW - 5 * DAY),
        ev('x1', 'not-my-card', 2, NOW),
      ],
    });
    expectCacheEqualsReplay();

    // A time in SQLite's format (older rows), AFTER e4 / e5 in time but before them as a string
    // (' ' < 'T'): ordered as an instant.
    db.raw.run("INSERT INTO review_events (id, card_id, user_id, rating, reviewed_at) VALUES ('e7', 'n2-meaning_to_hanzi', ?, 2, '2026-11-15 13:00:00')", [ME]);
    await recomputeCards(d1(), ME, ['n2-meaning_to_hanzi']);
    expectCacheEqualsReplay();

    // A retried upload whose events are all stored already still recomputes (the first attempt's
    // recompute never ran — here: the row was left stale).
    db.raw.run("UPDATE cards SET queue = 0, stability = 0, next_review_at = NULL WHERE id = 'n3-hanzi_to_meaning'");
    const retry = await api('POST', '/reviews', { events: [ev('e6', 'n3-hanzi_to_meaning', 3, NOW - 5 * DAY)] });
    expect(retry.json).toMatchObject({ created: 0, skipped: 1 });
    expectCacheEqualsReplay();

    await expectQueueFromReplay();
  });

  it('forget, undo of the forget, Undo of a review: the replay each time', async () => {
    await serverStudyQueue(d1(), ME, { nowMs: NOW }); // the one-time replay
    await api('POST', '/reviews', {
      events: [ev('e1', 'n1-hanzi_to_meaning', 2, NOW - 20 * DAY), ev('e2', 'n1-hanzi_to_meaning', 2, NOW - 19 * DAY), ev('e3', 'n1-hanzi_to_meaning', 2, NOW - 3 * DAY)],
    });
    expectCacheEqualsReplay();
    await api('POST', '/me/card-forgets', { items: [{ id: 'f1', card_id: 'n1-hanzi_to_meaning', forgotten_at: iso(NOW - 2 * DAY) }] });
    expect(db.rows<{ queue: number }>("SELECT queue FROM cards WHERE id = 'n1-hanzi_to_meaning'")[0].queue).toBe(0);
    expectCacheEqualsReplay();
    // A review after the forget replays from NEW.
    await api('POST', '/reviews', { events: [ev('e4', 'n1-hanzi_to_meaning', 3, NOW - DAY)] });
    expectCacheEqualsReplay();
    await api('POST', '/me/card-forgets/undo', { ids: ['f1'] });
    expectCacheEqualsReplay();
    expect((await api('DELETE', '/reviews/e4')).json).toEqual({ deleted: true });
    expectCacheEqualsReplay();
    await expectQueueFromReplay();
  });

  it('a slower concurrent recompute never overwrites a newer one', async () => {
    await serverStudyQueue(d1(), ME, { nowMs: NOW }); // the one-time replay
    await api('POST', '/reviews', { events: [ev('e1', 'n1-hanzi_to_meaning', 2, NOW - 20 * DAY)] });
    // Upload A replayed {e1}; before its write lands, upload B stores e2 and writes {e1, e2}.
    const realBatch = d1().batch.bind(d1());
    let injected = false;
    (db as unknown as { batch: typeof realBatch }).batch = async (stmts) => {
      // recomputeCards reads in pairs (events + forgets) and writes one UPDATE per card: the first
      // one-statement batch is A's write — upload B lands just before it.
      if (!injected && stmts.length === 1) {
        injected = true;
        db.raw.run("INSERT INTO review_events (id, card_id, user_id, rating, reviewed_at) VALUES ('e2', 'n1-hanzi_to_meaning', ?, 0, ?)", [ME, iso(NOW - DAY)]);
        expect(await recomputeCardsVia(realBatch, ['n1-hanzi_to_meaning'])).toBe(1);
      }
      return realBatch(stmts);
    };
    const staleWritten = await recomputeCards(d1(), ME, ['n1-hanzi_to_meaning']);
    expect(staleWritten).toBe(0); // its events changed: skipped
    (db as unknown as { batch: typeof realBatch }).batch = realBatch;
    expectCacheEqualsReplay();
    expect(db.rows<{ lapses: number }>("SELECT lapses FROM cards WHERE id = 'n1-hanzi_to_meaning'")[0].lapses).toBe(computeCardState(
      [ev('e1', 'n1-hanzi_to_meaning', 2, NOW - 20 * DAY), ev('e2', 'n1-hanzi_to_meaning', 0, NOW - DAY)] as ReviewEvent[],
    ).lapses);
  });
});

/** recomputeCards on the same database but through the unpatched batch (the "other" upload). */
async function recomputeCardsVia(batch: D1Database['batch'], ids: string[]): Promise<number> {
  const plain = { prepare: d1().prepare.bind(d1()), batch } as unknown as D1Database;
  return recomputeCards(plain, ME, ids);
}
