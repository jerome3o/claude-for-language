/**
 * Study-state debug report (shared/debug/report.ts) built from IndexedDB with
 * the SAME functions the home screen and the study queue use — getRawQueueCounts
 * + allocateQueueCounts (HomePage), getStudyQueue (useStudySession), getDueReaders,
 * readBonus, readStudyBudget, getStudyCutoff — and uploaded to
 * POST /api/debug/reports so it can be diffed against the Lab app's
 * (GET /api/debug/compare, MCP compare_debug_reports).
 *
 * Uploaded automatically after a sync at most every 30 minutes, and on demand
 * from Settings → Advanced → "Send debug report". Never throws into sync.
 */

import {
  DEBUG_CARD_COLUMNS,
  DEBUG_REPORT_VERSION,
  eventIdHash,
  type DebugCardRow,
  type DebugDeckRow,
  type DebugQueueCounts,
  type DebugReport,
} from '@shared/debug';
import {
  db,
  getRawQueueCounts,
  allocateQueueCounts,
  sumQueueCounts,
  getStudyQueue,
  getStudyCutoff,
  introducedTodayFromEvents,
  type DeckQueueCounts,
  type LocalCard,
} from '../db/database';
import { API_BASE, getAuthHeaders } from '../api/client';
import { readBonus, bonusKey } from '../utils/bonusNewCards';
import { readStudyBudget } from './studyBudget';
import { readNewCardOrder } from './newCardOrder';
import { getDueReaders } from './reader-study';
import { loadHomeworkItems, sortHomeworkItems } from './homework';
import { detectInstallKind } from './clientState';
import { BUILD_TIME } from '../utils/appUpdates';
import { CardQueue } from '../types';

const AUTO_INTERVAL_MS = 30 * 60 * 1000;
const LAST_UPLOAD_KEY = 'debugReportLastUpload';

function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function counts(c: DeckQueueCounts): DebugQueueCounts {
  return { new: c.new, secondaryNew: c.secondaryNew, learning: c.learning, review: c.review, hasMoreNew: c.hasMoreNew };
}

/** The due time the study queue compares with the cutoff (learning: due_timestamp; review: next_review_at). */
function dueMs(card: LocalCard): number | null {
  if (card.queue === CardQueue.NEW) return null;
  if (card.queue === CardQueue.REVIEW) return card.next_review_at ? Date.parse(card.next_review_at) : null;
  return card.due_timestamp ?? (card.next_review_at ? Date.parse(card.next_review_at) : null);
}

export async function buildDebugReport(): Promise<DebugReport> {
  const now = new Date();
  const cutoff = getStudyCutoff();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const budget = readStudyBudget();

  const [decks, cards, noteRows, rawByDeck, eventIds, eventKeys, unsynced, pendingDeletions, syncMeta, eventSyncMeta, fromEvents, dueReaders] =
    await Promise.all([
      db.decks.toArray(),
      db.cards.toArray(),
      db.notes.toArray().then(ns => ns.map(n => n.deck_id)),
      getRawQueueCounts(),
      db.reviewEvents.toCollection().primaryKeys() as Promise<string[]>,
      db.reviewEvents.orderBy('[card_id+reviewed_at]').keys() as Promise<unknown[]>,
      db.reviewEvents.where('_synced').equals(0).count(),
      db.pendingReviewDeletions.count(),
      db.syncMeta.toArray(),
      db.eventSyncMeta.toArray(),
      introducedTodayFromEvents(),
      getDueReaders(),
    ]);
  // The Home screen's homework card (HomeworkHomeCard → useHomeworkItems): same functions.
  const homeworkItems = await loadHomeworkItems().then(sortHomeworkItems).catch(() => null);

  const bonusAll = readBonus(undefined);
  const byDeckBonus: Record<string, number> = {};
  for (const d of decks) {
    const b = readBonus(d.id);
    if (b) byDeckBonus[d.id] = b;
  }

  // ---- Home: exactly HomePage's numbers (per-deck rows use bonus 0; the total uses the "all" bonus + due readers) ----
  const perDeck = allocateQueueCounts(rawByDeck, 0, budget);
  const allocatedAll = allocateQueueCounts(rawByDeck, bonusAll, budget);
  const cardTotals = sumQueueCounts(allocatedAll.values());
  const shown = { ...cardTotals };
  for (const reader of dueReaders) {
    if (reader.queue === CardQueue.NEW) shown.new++;
    else if (reader.queue === CardQueue.LEARNING || reader.queue === CardQueue.RELEARNING) shown.learning++;
    else shown.review++;
  }
  const homeTotal = shown.new + shown.secondaryNew + shown.learning + shown.review;

  // ---- The study queue a session would start with (all decks, today's bonus) ----
  const queue = await getStudyQueue(undefined, bonusAll);
  const inQueue = new Set(queue.dueCards.map(c => c.id));
  const fromDue: DebugQueueCounts = { new: 0, secondaryNew: 0, learning: 0, review: 0 };
  for (const c of queue.dueCards) {
    if (c.queue === CardQueue.NEW) {
      if (queue.reviewedNoteIds.has(c.note_id)) fromDue.secondaryNew++;
      else fromDue.new++;
    } else if (c.queue === CardQueue.REVIEW) fromDue.review++;
    else fromDue.learning++;
  }

  // ---- Events per card (compound index keys: [card_id, reviewed_at], sorted) ----
  const eventCount = new Map<string, number>();
  const firstReview = new Map<string, number>();
  let earliest: string | null = null;
  let latest: string | null = null;
  for (const key of eventKeys) {
    const [cardId, reviewedAt] = key as [string, string];
    const n = eventCount.get(cardId) ?? 0;
    if (n === 0) firstReview.set(cardId, Date.parse(reviewedAt));
    eventCount.set(cardId, n + 1);
    if (!earliest || reviewedAt < earliest) earliest = reviewedAt;
    if (!latest || reviewedAt > latest) latest = reviewedAt;
  }
  const cardIds = new Set(cards.map(c => c.id));
  let orphanEvents = 0;
  for (const [id, n] of eventCount) if (!cardIds.has(id)) orphanEvents += n;

  const cardRows: DebugCardRow[] = cards.map(c => [
    c.id,
    c.note_id,
    c.deck_id,
    c.card_type,
    c.queue,
    dueMs(c),
    c.repetitions ?? 0,
    c.lapses ?? 0,
    eventCount.get(c.id) ?? 0,
    inQueue.has(c.id) ? 1 : 0,
    firstReview.get(c.id) ?? null,
  ]);

  const noteCount = new Map<string, number>();
  for (const deckId of noteRows) noteCount.set(deckId, (noteCount.get(deckId) ?? 0) + 1);
  const cardCount = new Map<string, number>();
  for (const c of cards) cardCount.set(c.deck_id, (cardCount.get(c.deck_id) ?? 0) + 1);

  const deckRows: DebugDeckRow[] = decks.map(d => {
    const raw = rawByDeck.get(d.id);
    const all = allocatedAll.get(d.id);
    const ev = fromEvents.get(d.id) ?? { primary: 0, secondary: 0 };
    return {
      id: d.id,
      name: d.name,
      priority: d.study_priority ?? 0,
      created_at: d.created_at,
      caps: { primary: raw?.newCardsPerDay ?? d.new_cards_per_day, secondary: raw?.secondaryCardsPerDay ?? 0 },
      introduced_today: { primary: raw?.studiedToday ?? 0, secondary: raw?.secondaryStudiedToday ?? 0 },
      introduced_today_from_events: { primary: ev.primary, secondary: ev.secondary },
      pools: {
        totalNew: raw?.totalNew ?? 0,
        totalSecondaryNew: raw?.totalSecondaryNew ?? 0,
        learning: raw?.learning ?? 0,
        review: raw?.review ?? 0,
      },
      allocation: { primary: all?.new ?? 0, secondary: all?.secondaryNew ?? 0 },
      counts: counts(perDeck.get(d.id) ?? { new: 0, secondaryNew: 0, learning: 0, review: 0, hasMoreNew: false }),
      note_count: noteCount.get(d.id) ?? 0,
      card_count: cardCount.get(d.id) ?? 0,
    };
  });

  return {
    version: DEBUG_REPORT_VERSION,
    client: 'web',
    app_version: BUILD_TIME,
    generated_at: now.toISOString(),
    timezone: {
      iana: Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown',
      offset_minutes: -now.getTimezoneOffset(),
    },
    now_ms: now.getTime(),
    cutoff: { ms: cutoff.ts, iso: cutoff.iso },
    day_start: { ms: dayStart.getTime(), iso: dayStart.toISOString(), local_date: localDate(now) },
    introduced_basis:
      'derived from review events: a card\'s first-ever review at/after local midnight (shared/decks/study-queue.ts introducedToday)',
    budget: { ...budget },
    new_card_order: readNewCardOrder(),
    bonus: { all: bonusAll, by_deck: byDeckBonus, day_key: bonusKey(undefined).split('_').pop() ?? '' },
    sync: {
      sync_meta: syncMeta,
      event_sync_meta: eventSyncMeta,
      online: typeof navigator !== 'undefined' ? navigator.onLine : null,
      rejected_events: await db.reviewEvents.where('_synced').equals(-1).count(),
      install_kind: detectInstallKind(),
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    },
    totals: {
      decks: decks.length,
      notes: noteRows.length,
      cards: cards.length,
      events: eventIds.length,
      unsynced_events: unsynced,
      pending_deletions: pendingDeletions,
      orphan_events: orphanEvents,
      earliest_reviewed_at: earliest,
      latest_reviewed_at: latest,
    },
    home: {
      total: homeTotal,
      counts: { ...counts(shown), hasMoreNew: cardTotals.hasMoreNew },
      extras: { readers: dueReaders.length },
      note: 'Due readers are folded into new / learning / review on screen, as HomePage does; learning = every learning card (no cutoff), as countRawQueues does.',
    },
    queue: {
      due_cards: queue.dueCards.length,
      from_due_cards: fromDue,
      reported: counts(queue.counts),
    },
    ...(homeworkItems
      ? {
          homework: {
            todo: homeworkItems.todo.length,
            overdue: homeworkItems.todo.filter(i => i.due.tone === 'overdue').length,
            due_today: homeworkItems.todo.filter(i => i.due.tone === 'today').length,
            done: homeworkItems.done.length,
          },
        }
      : {}),
    decks: deckRows,
    card_columns: DEBUG_CARD_COLUMNS,
    cards: cardRows,
    event_hashes: eventIds.map(eventIdHash).sort(),
  };
}

async function gzip(text: string): Promise<Blob | null> {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    return await new Response(stream).blob();
  } catch {
    return null;
  }
}

export interface DebugUploadResult {
  id: string;
  cards: number;
  events: number;
  homeTotal: number;
  kb: number;
}

/** Build and upload a report now. Throws on failure (the Settings button shows it). */
export async function sendDebugReport(): Promise<DebugUploadResult> {
  const report = await buildDebugReport();
  const text = JSON.stringify({ client: 'web', app_version: report.app_version, install_kind: detectInstallKind(), report });
  const zipped = await gzip(text);
  const res = await fetch(`${API_BASE}/api/debug/reports`, {
    method: 'POST',
    credentials: 'include',
    headers: { ...getAuthHeaders(), 'Content-Type': zipped ? 'application/gzip' : 'application/json' },
    body: zipped ?? text,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  const { report: row } = (await res.json()) as { report: { id: string } };
  try {
    localStorage.setItem(LAST_UPLOAD_KEY, String(Date.now()));
  } catch { /* storage unavailable */ }
  return {
    id: row.id,
    cards: report.cards.length,
    events: report.event_hashes.length,
    homeTotal: report.home.total,
    kb: Math.round(((zipped?.size ?? text.length) / 1024) * 10) / 10,
  };
}

let inFlight = false;

/** After a sync: upload at most every 30 minutes. Never throws. */
export async function sendDebugReportIfDue(): Promise<void> {
  if (inFlight || import.meta.env.MODE === 'test') return;
  try {
    const last = Number(localStorage.getItem(LAST_UPLOAD_KEY) || 0);
    if (Date.now() - last < AUTO_INTERVAL_MS) return;
    // Stamp before trying: a failing upload waits for the next window too.
    localStorage.setItem(LAST_UPLOAD_KEY, String(Date.now()));
  } catch {
    return;
  }
  inFlight = true;
  try {
    await sendDebugReport();
  } catch (err) {
    console.warn('[debugReport] upload failed:', err instanceof Error ? err.message : err);
  } finally {
    inFlight = false;
  }
}
