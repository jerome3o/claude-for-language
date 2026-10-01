/**
 * The Progress page's "Characters known" / "Words known" (shared/progress/known.ts) from
 * the device's own notes, cards and review events — offline, no server. The FSRS replay
 * runs in a Web Worker; the last result is kept in localStorage so the numbers show at
 * once on the next visit while the fresh ones are computed.
 */
import { db } from '../db/database';
import {
  knownProgress, historyPoints,
  type KnownProgress, type KnownNoteInput, type KnownCardInput, type KnownEventInput,
} from '@shared/progress';

export interface KnownInput {
  notes: KnownNoteInput[];
  cards: KnownCardInput[];
  events: KnownEventInput[];
  now_ms: number;
}

const CACHE_KEY = 'known-progress-v1';

export function cachedKnownProgress(): KnownProgress | undefined {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as KnownProgress) : undefined;
  } catch {
    return undefined;
  }
}

function inWorker(input: KnownInput): Promise<KnownProgress> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./knownProgress.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ ok: boolean; result?: KnownProgress; error?: string }>) => {
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

function inline(input: KnownInput): KnownProgress {
  return knownProgress(input.notes, input.cards, input.events, historyPoints(input.events, input.now_ms));
}

export async function loadKnownProgress(nowMs = Date.now()): Promise<KnownProgress> {
  const [notes, cards, events] = await Promise.all([
    db.notes.toArray(),
    db.cards.toArray(),
    db.reviewEvents.toArray(),
  ]);
  const input: KnownInput = {
    notes: notes.map((n) => ({ id: n.id, hanzi: n.hanzi })),
    cards: cards.map((c) => ({ id: c.id, note_id: c.note_id })),
    events: events.map((e) => ({ id: e.id, card_id: e.card_id, rating: e.rating, reviewed_at: e.reviewed_at })),
    now_ms: nowMs,
  };
  let result: KnownProgress;
  if (typeof Worker === 'undefined') {
    result = inline(input);
  } else {
    try {
      result = await inWorker(input);
    } catch {
      result = inline(input);
    }
  }
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(result));
  } catch {
    // Storage full or blocked: the numbers are just recomputed next time.
  }
  return result;
}
