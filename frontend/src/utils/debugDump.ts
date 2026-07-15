/**
 * Builds a compact, copy-pasteable JSON snapshot of the LOCAL (IndexedDB)
 * study state. Generate one on each device (PWA, native app) and diff them
 * to find where their local states diverge.
 */

import {
  db,
  getDatabaseStats,
  getEventSyncMeta,
  getRawQueueCounts,
  applyNewCardBonus,
  sumQueueCounts,
  getStudyCutoff,
} from '../db/database';
import { CardQueue } from '../types';
import { copyTextToClipboard } from './clipboard';

const QUEUE_NAMES: Record<number, string> = {
  [CardQueue.NEW]: 'new',
  [CardQueue.LEARNING]: 'learning',
  [CardQueue.REVIEW]: 'review',
  [CardQueue.RELEARNING]: 'relearning',
};

function localDateString(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export async function buildDebugDump(): Promise<string> {
  const now = new Date();
  const cutoff = getStudyCutoff();

  const [stats, eventSyncMeta, rawQueue, decks] = await Promise.all([
    getDatabaseStats(),
    getEventSyncMeta(),
    getRawQueueCounts(),
    db.decks.toArray(),
  ]);

  // Review-event histogram by month + simple order-independent id checksum.
  // Equal totals + equal monthly counts + equal checksum => same event set.
  const eventsByMonth: Record<string, number> = {};
  let minReviewedAt: string | null = null;
  let maxReviewedAt: string | null = null;
  let idChecksum = 0;
  await db.reviewEvents.each((e) => {
    const month = (e.reviewed_at || '').slice(0, 7) || 'unknown';
    eventsByMonth[month] = (eventsByMonth[month] || 0) + 1;
    if (!minReviewedAt || e.reviewed_at < minReviewedAt) minReviewedAt = e.reviewed_at;
    if (!maxReviewedAt || e.reviewed_at > maxReviewedAt) maxReviewedAt = e.reviewed_at;
    let h = 0;
    for (let i = 0; i < e.id.length; i++) {
      h = (h * 31 + e.id.charCodeAt(i)) | 0;
    }
    idChecksum = (idChecksum + h) | 0;
  });

  // Card queue distribution and due buckets (same fields the study queue uses)
  const queueDist: Record<string, number> = {};
  let dueNow = 0;
  let dueByCutoff = 0;
  let nullNextReview = 0;
  await db.cards.each((card) => {
    const name = QUEUE_NAMES[card.queue] ?? `queue_${card.queue}`;
    queueDist[name] = (queueDist[name] || 0) + 1;
    if (card.queue !== CardQueue.NEW) {
      if (!card.next_review_at) {
        nullNextReview++;
      } else {
        if (card.next_review_at <= now.toISOString()) dueNow++;
        if (card.next_review_at <= cutoff.iso) dueByCutoff++;
      }
    }
  });

  // Per-deck view: raw counts + what the UI displays after daily limits
  const deckNames = new Map(decks.map((d) => [d.id, d.name]));
  const perDeck: Record<string, unknown> = {};
  for (const [deckId, raw] of rawQueue) {
    perDeck[deckNames.get(deckId) ?? deckId] = {
      raw,
      displayed: applyNewCardBonus(raw, 0),
    };
  }
  const totals = sumQueueCounts([...rawQueue.values()].map((r) => applyNewCardBonus(r, 0)));

  const todaysStats = await db.dailyStats.where('date').equals(localDateString()).toArray();

  const dump = {
    generated_at: now.toISOString(),
    device: {
      origin: window.location.origin,
      user_agent: navigator.userAgent,
      standalone_pwa: window.matchMedia?.('(display-mode: standalone)')?.matches ?? false,
      online: navigator.onLine,
    },
    study_cutoff: cutoff.iso,
    db_counts: stats,
    event_sync_meta: eventSyncMeta ?? null,
    review_events: {
      min_reviewed_at: minReviewedAt,
      max_reviewed_at: maxReviewedAt,
      id_checksum: idChecksum,
      by_month: eventsByMonth,
    },
    cards: {
      queue_distribution: queueDist,
      due_now: dueNow,
      due_by_cutoff: dueByCutoff,
      non_new_missing_next_review: nullNextReview,
    },
    displayed_totals: totals,
    per_deck: perDeck,
    daily_stats_today: todaysStats,
  };

  return JSON.stringify(dump, null, 1);
}

/** Copy the dump to the clipboard, falling back to the Android share sheet. */
export async function copyDebugDump(): Promise<string> {
  const dump = await buildDebugDump();
  if (await copyTextToClipboard(dump)) {
    return `Debug dump copied to clipboard (${(dump.length / 1024).toFixed(1)} KB). Paste it into the Claude chat.`;
  }
  try {
    await navigator.share({ text: dump });
    return 'Debug dump sent to the share sheet.';
  } catch {
    console.log('[debugDump]', dump);
    return 'Could not access clipboard — the dump was printed to the console (enable the Debug Console to copy it from there).';
  }
}
