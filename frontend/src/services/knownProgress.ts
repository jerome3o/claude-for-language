/**
 * The Progress page's "Characters known" / "Words known" (shared/progress/known.ts) from
 * the device's own notes, cards and review events — offline, no server. The FSRS replay
 * runs in a Web Worker; the last result is kept in localStorage so the numbers show at
 * once on the next visit while the fresh ones are computed.
 */
import { db } from '../db/database';
import {
  knownProgressWithRate, parseKnownChartMode,
  type KnownProgressWithRate, type KnownNoteInput, type KnownCardInput, type KnownEventInput, type KnownChartMode,
} from '@shared/progress';

/** What the Progress page shows: the totals, their history and (since the Per week mode) the rate. */
export type KnownProgressView = KnownProgressWithRate;

export interface KnownInput {
  notes: KnownNoteInput[];
  cards: KnownCardInput[];
  events: KnownEventInput[];
  now_ms: number;
  /** Minutes east of UTC at `now_ms` (weeks start Monday 00:00 local). */
  tz_offset_minutes: number;
}

const CACHE_KEY = 'known-progress-v2';
const MODE_KEY = 'known-chart-mode-v1';

/** The chart's Total | Per week choice, remembered on this device. */
export function loadKnownChartMode(): KnownChartMode {
  try {
    return parseKnownChartMode(localStorage.getItem(MODE_KEY));
  } catch {
    return 'total';
  }
}

export function saveKnownChartMode(mode: KnownChartMode): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // Blocked storage: the choice just isn't remembered.
  }
}

export function cachedKnownProgress(): KnownProgressView | undefined {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as KnownProgressView) : undefined;
  } catch {
    return undefined;
  }
}

function inWorker(input: KnownInput): Promise<KnownProgressView> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./knownProgress.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ ok: boolean; result?: KnownProgressView; error?: string }>) => {
      worker.terminate();
      if (e.data.ok && e.data.result) resolve(e.data.result);
      else reject(new Error(e.data.error || 'Could not count known words'));
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || 'Could not count known words'));
    };
    worker.postMessage(input);
  });
}

export function computeKnown(input: KnownInput): KnownProgressView {
  return knownProgressWithRate(input.notes, input.cards, input.events, input.now_ms, input.tz_offset_minutes);
}

export async function loadKnownProgress(nowMs = Date.now()): Promise<KnownProgressView> {
  const [notes, cards, events, forgets] = await Promise.all([
    db.notes.toArray(),
    db.cards.toArray(),
    db.reviewEvents.toArray(),
    db.cardForgets.toArray().catch(() => []),
  ]);
  const input: KnownInput = {
    notes: notes.map((n) => ({ id: n.id, hanzi: n.hanzi })),
    cards: cards.map((c) => ({ id: c.id, note_id: c.note_id })),
    events: [
      ...events.map((e): KnownEventInput => ({ id: e.id, card_id: e.card_id, rating: e.rating, reviewed_at: e.reviewed_at })),
      // "Forget this card": the card is NEW again from then (not known, not seen).
      ...forgets.filter((f) => f.pending !== 'undo').map((f): KnownEventInput => ({ id: f.id, card_id: f.card_id, rating: 0, reviewed_at: f.forgotten_at, kind: 'forget' })),
    ],
    now_ms: nowMs,
    tz_offset_minutes: -new Date(nowMs).getTimezoneOffset(),
  };
  let result: KnownProgressView;
  if (typeof Worker === 'undefined') {
    result = computeKnown(input);
  } else {
    try {
      result = await inWorker(input);
    } catch {
      result = computeKnown(input);
    }
  }
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(result));
  } catch {
    // Storage full or blocked: the numbers are just recomputed next time.
  }
  return result;
}
