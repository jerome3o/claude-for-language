/**
 * 📱 Phone practice on the device (docs/PHONE_PRACTICE.md). Plays are LOCAL-ONLY for now: kept
 * in their own small IndexedDB database (`phone-practice`, separate from ChineseLearningDB so
 * no schema bump and the study sync never sees them) — finished plays (the result: success,
 * time, hints, mistakes) for the list's "done / best time", and the play in progress (its event
 * log) so leaving the page and coming back carries on where you were.
 *
 * The only network call is the persona chat (api/phone.ts).
 */
import Dexie, { type Table } from 'dexie';
import type { PhoneEvent, ScenarioResult } from '@shared/phone';

export interface StoredPlay {
  id: string;
  scenario_id: string;
  started_at: number;
  ended_at: number;
  result: ScenarioResult;
  gave_up: boolean;
}

export interface CurrentPlay {
  scenario_id: string;
  started_at: number;
  /** When the play was last touched (the clock and the timer resume from here). */
  touched_at: number;
  events: PhoneEvent[];
  hints_shown: number;
}

class PhonePracticeDB extends Dexie {
  plays!: Table<StoredPlay, string>;
  current!: Table<CurrentPlay, string>;
  constructor() {
    super('phone-practice');
    this.version(1).stores({ plays: 'id, scenario_id, ended_at', current: 'scenario_id' });
  }
}

let db: PhonePracticeDB | null = null;
function getDb(): PhonePracticeDB | null {
  if (db) return db;
  try {
    db = new PhonePracticeDB();
    return db;
  } catch {
    return null;
  }
}

export async function savePlay(play: StoredPlay): Promise<void> {
  await getDb()?.plays.put(play).catch(() => undefined);
}

export async function listPlays(): Promise<StoredPlay[]> {
  return (await getDb()?.plays.orderBy('ended_at').reverse().toArray().catch(() => [])) ?? [];
}

export interface ScenarioStatus {
  done: boolean;
  plays: number;
  best_ms: number | null;
  last_at: number | null;
  in_progress: boolean;
}

/** Per scenario: finished?, best (fastest successful) time, plays, a play under way. */
export async function scenarioStatuses(): Promise<Record<string, ScenarioStatus>> {
  const [plays, current] = await Promise.all([listPlays(), (getDb()?.current.toArray().catch(() => []) ?? Promise.resolve([])) as Promise<CurrentPlay[]>]);
  const out: Record<string, ScenarioStatus> = {};
  const get = (id: string) => (out[id] ??= { done: false, plays: 0, best_ms: null, last_at: null, in_progress: false });
  for (const p of plays) {
    const s = get(p.scenario_id);
    s.plays++;
    s.last_at = Math.max(s.last_at ?? 0, p.ended_at);
    if (p.result.success) {
      s.done = true;
      s.best_ms = s.best_ms === null ? p.result.duration_ms : Math.min(s.best_ms, p.result.duration_ms);
    }
  }
  for (const c of current ?? []) if (c.events.length > 0) get(c.scenario_id).in_progress = true;
  return out;
}

export async function loadCurrentPlay(scenarioId: string): Promise<CurrentPlay | null> {
  return (await getDb()?.current.get(scenarioId).catch(() => undefined)) ?? null;
}

export async function saveCurrentPlay(play: CurrentPlay): Promise<void> {
  await getDb()?.current.put(play).catch(() => undefined);
}

export async function clearCurrentPlay(scenarioId: string): Promise<void> {
  await getDb()?.current.delete(scenarioId).catch(() => undefined);
}

/** A play left for more than this starts afresh (yesterday's half-booked ticket is gone). */
export const RESUME_WITHIN_MS = 12 * 60 * 60 * 1000;
