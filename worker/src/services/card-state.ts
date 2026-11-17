/**
 * The server's cached card state = the replay of the card's review events (+ live forgets).
 *
 * Review events are the single source of truth (CLAUDE.md "Event-Sourcing Architecture"); the
 * scheduling columns of `cards` (queue, stability, difficulty, lapses, ease_factor, interval,
 * repetitions, next_review_at, due_timestamp, learning_step) are only a cache of
 * `computeCardState(events)`. Since Nov 2026 the server's study queue (services/study-queue.ts) is
 * read from that cache, so it has to be right:
 *
 *   - `recomputeCards` is the ONE function every server write of a review / forget / undo goes
 *     through (POST /api/reviews, DELETE /api/reviews/:id, the card-forgets routes, the legacy
 *     /api/study/review + /api/study/sessions/:id/reviews). Its UPDATE only lands while the card's
 *     event + forget counts are still the ones it replayed, so a slower concurrent recompute can
 *     never overwrite a newer one.
 *   - `repairUserCardStates` replays EVERY card of a user (a card with no events is NEW) and
 *     rewrites only the rows that differ — the server twin of the web's `repairCardStatesIfDue`.
 *     Before it, cards of the first (Anki-imported) deck still carried the import's state
 *     ("review, due Feb 2026") with no event behind them: nothing ever reset a card without
 *     events, and a retried upload whose events were already stored skipped the recompute.
 *   - `ensureCardStatesRepaired` runs that repair once per user per `CARD_STATE_REPAIR_VERSION`,
 *     lazily on the first server queue read (blocking — the queue must not read a stale cache),
 *     resumable through `users.card_state_repair_cursor`; `checkCardStatesIfDue` re-checks daily
 *     from /api/sync/changes in the background (drift = a bug: logged with the count).
 */
import {
  computeCardState,
  DEFAULT_DECK_SETTINGS,
  withForgetEvents,
  type CardForget,
  type ComputedCardState,
  type Rating,
  type ReviewEvent,
} from '../../../shared/scheduler';

/** Bump to replay every user's cards again (once each, on their next queue read). */
export const CARD_STATE_REPAIR_VERSION = 1;
/** The background re-check from /api/sync/changes: at most this often per user. */
export const CARD_STATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Cards replayed per page (one events + one forgets + one cards SELECT each). */
const PAGE_CARDS = 1000;

/** Server / SQLite times are ISO or 'YYYY-MM-DD HH:MM:SS' (UTC). */
function instant(at: string): number {
  const ms = Date.parse(at.includes('T') ? at : at.replace(' ', 'T') + 'Z');
  return Number.isFinite(ms) ? ms : 0;
}

/** An event time as ISO (the replay compares strings; stored rows may be in SQLite's format). */
function isoTime(at: string): string {
  if (at.includes('T')) return at;
  const ms = instant(at);
  return ms ? new Date(ms).toISOString() : at;
}

/**
 * One card's state from its reviews + live forgets, in time order whatever format the times were
 * stored in (a forget after the reviews of the same instant). No events = a NEW card.
 */
export function replayCardState(events: readonly ReviewEvent[], forgets: readonly CardForget[]): ComputedCardState {
  const reviews = events.map((e) => ({ ...e, reviewed_at: isoTime(e.reviewed_at) }));
  const merged = withForgetEvents(reviews, forgets.map((f) => ({ ...f, forgotten_at: isoTime(f.forgotten_at) })));
  merged.sort((a, b) => {
    const d = instant(a.reviewed_at) - instant(b.reviewed_at);
    if (d !== 0) return d;
    const fa = a.kind === 'forget' ? 1 : 0;
    const fb = b.kind === 'forget' ? 1 : 0;
    return fa - fb || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
  return computeCardState(merged, DEFAULT_DECK_SETTINGS);
}

/** The cache columns of a card row. */
export interface CachedCardState {
  id: string;
  queue: number | null;
  stability: number | null;
  difficulty: number | null;
  lapses: number | null;
  ease_factor: number | null;
  interval: number | null;
  repetitions: number | null;
  next_review_at: string | null;
  due_timestamp: number | null;
  learning_step: number | null;
}

const CACHE_COLUMNS = 'c.id, c.queue, c.stability, c.difficulty, c.lapses, c.ease_factor, c.interval, c.repetitions, c.next_review_at, c.due_timestamp, c.learning_step';

function sameNumber(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return (a ?? null) === (b ?? null);
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

function sameTime(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return instant(a) === instant(b);
}

/** Does the cached row already hold this state? (Floats compared with a tolerance, times as instants.) */
export function cacheMatches(row: CachedCardState, s: ComputedCardState): boolean {
  if (s.queue === 0) {
    // A NEW card: a never-reviewed row keeps its column defaults (ease_factor 2.5, NULLs) —
    // the same NEW card for everything that reads it; only a scheduled leftover is a difference.
    const zero = (v: number | null) => v === null || v === 0;
    return row.queue === 0 && row.next_review_at === null && row.due_timestamp === null &&
      zero(row.stability) && zero(row.difficulty) && zero(row.lapses) && zero(row.interval) && zero(row.repetitions);
  }
  return (
    row.queue === s.queue &&
    sameNumber(row.stability, s.stability) &&
    sameNumber(row.difficulty, s.difficulty) &&
    sameNumber(row.lapses, s.lapses) &&
    sameNumber(row.ease_factor, s.ease_factor) &&
    sameNumber(row.interval, s.interval) &&
    sameNumber(row.repetitions, s.repetitions) &&
    sameTime(row.next_review_at, s.next_review_at) &&
    sameNumber(row.due_timestamp, s.due_timestamp) &&
    (row.learning_step ?? 0) === (s.learning_step ?? 0)
  );
}

/**
 * The guarded write: lands only while the card still has the events + live forgets it was replayed
 * from (a concurrent upload that added one writes its own, newer state; this one is then skipped).
 */
function writeStatement(db: D1Database, userId: string, cardId: string, s: ComputedCardState, eventCount: number, forgetCount: number): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE cards SET queue = ?, stability = ?, difficulty = ?, lapses = ?, ease_factor = ?, interval = ?,
         repetitions = ?, next_review_at = ?, due_timestamp = ?, learning_step = ?, updated_at = datetime('now')
       WHERE id = ?
         AND (SELECT COUNT(*) FROM review_events WHERE card_id = ? AND user_id = ?) = ?
         AND (SELECT COUNT(*) FROM card_forgets WHERE card_id = ? AND undone_at IS NULL) = ?`,
    )
    .bind(
      s.queue, s.stability, s.difficulty, s.lapses, s.ease_factor, s.interval, s.repetitions, s.next_review_at, s.due_timestamp, s.learning_step ?? 0,
      cardId, cardId, userId, eventCount, cardId, forgetCount,
    );
}

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

type EventRow = { id: string; card_id: string; rating: number; reviewed_at: string };
type ForgetRow = { id: string; card_id: string; forgotten_at: string };

function groupEvents(rows: EventRow[], into: Map<string, ReviewEvent[]>): void {
  for (const e of rows) {
    const list = into.get(e.card_id);
    const ev: ReviewEvent = { id: e.id, card_id: e.card_id, rating: e.rating as Rating, reviewed_at: e.reviewed_at };
    if (list) list.push(ev);
    else into.set(e.card_id, [ev]);
  }
}

function groupForgets(rows: ForgetRow[], into: Map<string, CardForget[]>): void {
  for (const f of rows) {
    const list = into.get(f.card_id);
    if (list) list.push(f);
    else into.set(f.card_id, [f]);
  }
}

async function runBatches(db: D1Database, statements: D1PreparedStatement[]): Promise<number> {
  let written = 0;
  for (const part of chunks(statements, 100)) {
    const results = await db.batch(part);
    for (const r of results) written += r.meta?.changes ? 1 : 0;
  }
  return written;
}

/**
 * Recompute the cached state of these cards (the user's) from their review events + live forgets —
 * a card with neither becomes NEW. THE write path for every review / forget / undo on the server.
 * Returns how many rows were written.
 */
export async function recomputeCards(db: D1Database, userId: string, cardIds: string[]): Promise<number> {
  const ids = [...new Set(cardIds)];
  if (ids.length === 0) return 0;
  const events = new Map<string, ReviewEvent[]>();
  const forgets = new Map<string, CardForget[]>();
  for (const chunk of chunks(ids, 90)) {
    const marks = chunk.map(() => '?').join(',');
    const [ev, fg] = await db.batch([
      db.prepare(`SELECT id, card_id, rating, reviewed_at FROM review_events WHERE user_id = ? AND card_id IN (${marks})`).bind(userId, ...chunk),
      db.prepare(`SELECT id, card_id, forgotten_at FROM card_forgets WHERE user_id = ? AND undone_at IS NULL AND card_id IN (${marks})`).bind(userId, ...chunk),
    ]);
    groupEvents((ev.results ?? []) as EventRow[], events);
    groupForgets((fg.results ?? []) as ForgetRow[], forgets);
  }
  const statements = ids.map((id) => {
    const ev = events.get(id) ?? [];
    const fg = forgets.get(id) ?? [];
    return writeStatement(db, userId, id, replayCardState(ev, fg), ev.length, fg.length);
  });
  return runBatches(db, statements);
}

export interface CardStateRepairResult {
  /** Cards replayed in this run. */
  scanned: number;
  /** Of those, cached rows that differed from the replay. */
  differing: number;
  /** Rows rewritten (0 on a dry run; a row whose events changed meanwhile is skipped). */
  written: number;
  /** Differing cards by what the cache said → what the replay says. */
  transitions: Record<string, number>;
  /** Of the differing cards, those with no review event at all (legacy / imported state). */
  without_events: number;
  /** A few differing cards, for a reader. */
  samples: Array<{ card_id: string; events: number; cached: { queue: number | null; next_review_at: string | null }; replayed: { queue: number; next_review_at: string | null } }>;
  /** Every card done (false = stopped at `cursor` for the next run). */
  done: boolean;
  /** The last card id replayed ('' = start). */
  cursor: string;
}

const QUEUE_NAME = ['new', 'learning', 'review', 'relearning'];

/**
 * Replay the user's cards from `cursor` (card id order), at most `maxCards`, and rewrite the rows
 * whose cache differs (unless `dryRun`). Reads only; writes only cache columns, never events.
 */
export async function repairUserCardStates(
  db: D1Database,
  userId: string,
  opts: { cursor?: string; maxCards?: number; dryRun?: boolean } = {},
): Promise<CardStateRepairResult> {
  const out: CardStateRepairResult = { scanned: 0, differing: 0, written: 0, transitions: {}, without_events: 0, samples: [], done: false, cursor: opts.cursor ?? '' };
  const maxCards = opts.maxCards ?? Number.POSITIVE_INFINITY;
  while (out.scanned < maxCards) {
    const limit = Math.min(PAGE_CARDS, maxCards - out.scanned);
    const rows = (await db
      .prepare(`SELECT ${CACHE_COLUMNS} FROM cards c JOIN notes n ON n.id = c.note_id JOIN decks d ON d.id = n.deck_id
                WHERE d.user_id = ? AND c.id > ? ORDER BY c.id LIMIT ?`)
      .bind(userId, out.cursor, limit)
      .all<CachedCardState>()).results ?? [];
    if (rows.length === 0) {
      out.done = true;
      break;
    }
    const first = rows[0].id;
    const last = rows[rows.length - 1].id;
    const [ev, fg] = await db.batch([
      db.prepare('SELECT id, card_id, rating, reviewed_at FROM review_events WHERE user_id = ? AND card_id >= ? AND card_id <= ?').bind(userId, first, last),
      db.prepare('SELECT id, card_id, forgotten_at FROM card_forgets WHERE user_id = ? AND undone_at IS NULL AND card_id >= ? AND card_id <= ?').bind(userId, first, last),
    ]);
    const events = new Map<string, ReviewEvent[]>();
    const forgets = new Map<string, CardForget[]>();
    groupEvents((ev.results ?? []) as EventRow[], events);
    groupForgets((fg.results ?? []) as ForgetRow[], forgets);

    const statements: D1PreparedStatement[] = [];
    for (const row of rows) {
      const e = events.get(row.id) ?? [];
      const f = forgets.get(row.id) ?? [];
      const state = replayCardState(e, f);
      if (cacheMatches(row, state)) continue;
      out.differing++;
      if (e.length === 0) out.without_events++;
      const key = `${QUEUE_NAME[row.queue ?? 0] ?? row.queue} → ${QUEUE_NAME[state.queue] ?? state.queue}`;
      out.transitions[key] = (out.transitions[key] ?? 0) + 1;
      if (out.samples.length < 10) {
        out.samples.push({
          card_id: row.id,
          events: e.length,
          cached: { queue: row.queue, next_review_at: row.next_review_at },
          replayed: { queue: state.queue, next_review_at: state.next_review_at },
        });
      }
      if (!opts.dryRun) statements.push(writeStatement(db, userId, row.id, state, e.length, f.length));
    }
    if (statements.length) out.written += await runBatches(db, statements);
    out.scanned += rows.length;
    out.cursor = last;
    if (rows.length < limit) {
      out.done = true;
      break;
    }
  }
  return out;
}

/** The per-user repair bookkeeping on `users` (migration 0152). */
export interface CardStateRepairStatus {
  version: number | null;
  cursor: string | null;
  repaired_at: string | null;
  checked_at: string | null;
  last_fixed: number | null;
  current_version: number;
}

export async function cardStateRepairStatus(db: D1Database, userId: string): Promise<CardStateRepairStatus | null> {
  const row = await db
    .prepare('SELECT card_state_version, card_state_cursor, card_state_repaired_at, card_state_checked_at, card_state_last_fixed FROM users WHERE id = ?')
    .bind(userId)
    .first<{ card_state_version: number | null; card_state_cursor: string | null; card_state_repaired_at: string | null; card_state_checked_at: string | null; card_state_last_fixed: number | null }>();
  if (!row) return null;
  return {
    version: row.card_state_version,
    cursor: row.card_state_cursor,
    repaired_at: row.card_state_repaired_at,
    checked_at: row.card_state_checked_at,
    last_fixed: row.card_state_last_fixed,
    current_version: CARD_STATE_REPAIR_VERSION,
  };
}

/**
 * Replay the user's cards from the saved cursor to the end (or `maxCards`), saving the cursor as it
 * goes, and record the version once every card is done. Safe to run twice at once (both write the
 * same replay, guarded per row).
 */
export async function runCardStateRepair(
  db: D1Database,
  userId: string,
  opts: { restart?: boolean; maxCards?: number } = {},
): Promise<CardStateRepairResult> {
  const status = await cardStateRepairStatus(db, userId);
  let cursor = opts.restart ? '' : status?.cursor ?? '';
  const total: CardStateRepairResult = { scanned: 0, differing: 0, written: 0, transitions: {}, without_events: 0, samples: [], done: false, cursor };
  const maxCards = opts.maxCards ?? Number.POSITIVE_INFINITY;
  const step = 4 * PAGE_CARDS;
  while (!total.done && total.scanned < maxCards) {
    const r = await repairUserCardStates(db, userId, { cursor, maxCards: Math.min(step, maxCards - total.scanned) });
    total.scanned += r.scanned;
    total.differing += r.differing;
    total.written += r.written;
    total.without_events += r.without_events;
    for (const [k, v] of Object.entries(r.transitions)) total.transitions[k] = (total.transitions[k] ?? 0) + v;
    for (const s of r.samples) if (total.samples.length < 10) total.samples.push(s);
    cursor = r.cursor;
    total.cursor = cursor;
    total.done = r.done;
    if (r.done) {
      await db
        .prepare(`UPDATE users SET card_state_version = ?, card_state_cursor = NULL, card_state_repaired_at = datetime('now'),
                    card_state_checked_at = datetime('now'), card_state_last_fixed = ? WHERE id = ?`)
        .bind(CARD_STATE_REPAIR_VERSION, total.written, userId)
        .run();
    } else {
      await db.prepare('UPDATE users SET card_state_cursor = ? WHERE id = ?').bind(cursor, userId).run();
    }
  }
  if (total.differing > 0) {
    console.warn(`[card-state] user ${userId}: ${total.differing} cached card states differed from their events (${total.without_events} without events), ${total.written} rewritten`, JSON.stringify(total.transitions));
  }
  return total;
}

/**
 * Before the server reads its card cache for a queue: replay every card once per repair version
 * (blocking; ~1–2 s for 14k cards / 42k events, once). A failure is logged and the queue reads the
 * cache as it is — the next read resumes from the saved cursor.
 */
export async function ensureCardStatesRepaired(db: D1Database, userId: string): Promise<void> {
  try {
    const row = await db.prepare('SELECT card_state_version FROM users WHERE id = ?').bind(userId).first<{ card_state_version: number | null }>();
    if (!row || (row.card_state_version ?? 0) >= CARD_STATE_REPAIR_VERSION) return;
    await runCardStateRepair(db, userId);
  } catch (err) {
    console.error(`[card-state] repair failed for ${userId}:`, err);
  }
}

/**
 * The daily re-check (from /api/sync/changes, in the background): replay every card again when the
 * last check is older than a day. Finding a difference means a write path skipped the replay — it is
 * fixed and logged.
 */
export async function checkCardStatesIfDue(db: D1Database, userId: string, nowMs = Date.now()): Promise<CardStateRepairResult | null> {
  try {
    const status = await cardStateRepairStatus(db, userId);
    if (!status) return null;
    const behind = (status.version ?? 0) < CARD_STATE_REPAIR_VERSION;
    const checked = status.checked_at ? instant(status.checked_at) : 0;
    if (!behind && nowMs - checked < CARD_STATE_CHECK_INTERVAL_MS) return null;
    // Claim the check first, so syncs from several devices don't all run it.
    await db.prepare("UPDATE users SET card_state_checked_at = datetime('now') WHERE id = ?").bind(userId).run();
    return await runCardStateRepair(db, userId, { restart: !behind });
  } catch (err) {
    console.error(`[card-state] daily check failed for ${userId}:`, err);
    return null;
  }
}
