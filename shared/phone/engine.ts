/**
 * The phone practice engine (docs/PHONE_PRACTICE.md): pure functions over a scenario spec and
 * the phone's event log. The apps append events (an order paid, a message sent, a persona's
 * action); records are the LATEST version of each (record, id), so a ticket booked and then
 * refunded is a refunded ticket. Goals and mistakes are declarative conditions over records
 * and events (types.ts `GoalCondition`). Like shared/quest/engine.ts: no DOM, no clock — the
 * caller passes times — so the Lab app can port it.
 */
import type {
  GoalCondition,
  Matcher,
  PhoneEvent,
  PhoneRecord,
  PhoneRecordEvent,
  Scalar,
  ScenarioGoal,
  ScenarioSpec,
  Where,
} from './types';

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export function isRecordEvent(e: PhoneEvent): e is PhoneRecordEvent {
  return e.type === 'record' && typeof (e as PhoneRecordEvent).record === 'string' && typeof (e as PhoneRecordEvent).id === 'string';
}

/** The latest version of every record, in first-written order. */
export function recordsFrom(events: readonly PhoneEvent[]): PhoneRecord[] {
  const byKey = new Map<string, PhoneRecord>();
  for (const e of events) {
    if (!isRecordEvent(e)) continue;
    const key = `${e.record}\u0000${e.id}`;
    const prev = byKey.get(key);
    // A write merges into the previous version (an app can update one field).
    byKey.set(key, { record: e.record, id: e.id, data: { ...(prev?.data ?? {}), ...e.data }, at: prev?.at ?? e.at });
  }
  return [...byKey.values()];
}

export function recordsOf(events: readonly PhoneEvent[], record: string): PhoneRecord[] {
  return recordsFrom(events).filter((r) => r.record === record);
}

// ---------------------------------------------------------------------------
// Matchers
// ---------------------------------------------------------------------------

/** A dotted path into an object ("seats.0", "order.total"). */
export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur) && /^\d+$/.test(part)) cur = cur[Number(part)];
    else if (typeof cur === 'object') cur = (cur as Record<string, unknown>)[part];
    else return undefined;
  }
  return cur;
}

function isScalar(m: unknown): m is Scalar {
  return m === null || typeof m === 'string' || typeof m === 'number' || typeof m === 'boolean';
}

function eqScalar(a: unknown, b: Scalar): boolean {
  if (a === b) return true;
  // Numbers written as strings in a world ("18.50") still compare.
  if (typeof a === 'number' && typeof b === 'string' && b.trim() !== '' && Number(b) === a) return true;
  if (typeof a === 'string' && typeof b === 'number' && a.trim() !== '' && Number(a) === b) return true;
  return false;
}

function compare(a: unknown, b: number | string): number | null {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === 'number' && typeof b === 'string' && Number.isFinite(Number(b))) return a - Number(b);
  if (typeof a === 'string' && typeof b === 'number' && Number.isFinite(Number(a))) return Number(a) - b;
  return null;
}

function sizeOf(v: unknown): number | null {
  if (Array.isArray(v)) return v.length;
  if (typeof v === 'string') return [...v].length;
  return null;
}

/** Does `value` satisfy `m`? Pure. */
export function matches(value: unknown, m: Matcher): boolean {
  if (isScalar(m)) {
    if (Array.isArray(value)) return value.some((v) => eqScalar(v, m));
    return eqScalar(value, m);
  }
  if (m.exists !== undefined) {
    const present = value !== undefined && value !== null;
    if (present !== m.exists) return false;
  }
  if (m.eq !== undefined && !eqScalar(value, m.eq)) return false;
  if (m.ne !== undefined && eqScalar(value, m.ne)) return false;
  if (m.in && !m.in.some((x) => eqScalar(value, x))) return false;
  if (m.nin && m.nin.some((x) => eqScalar(value, x))) return false;
  for (const [op, test] of [['gt', (d: number) => d > 0], ['gte', (d: number) => d >= 0], ['lt', (d: number) => d < 0], ['lte', (d: number) => d <= 0]] as const) {
    const bound = m[op];
    if (bound === undefined) continue;
    const d = compare(value, bound);
    if (d === null || !test(d)) return false;
  }
  if (m.contains !== undefined) {
    if (Array.isArray(value)) {
      if (!value.some((v) => eqScalar(v, m.contains as Scalar) || (typeof v === 'string' && typeof m.contains === 'string' && v.includes(m.contains)))) return false;
    } else if (typeof value === 'string') {
      if (!value.includes(String(m.contains))) return false;
    } else return false;
  }
  if (m.size !== undefined) {
    const n = sizeOf(value);
    if (n === null) return false;
    if (typeof m.size === 'number' ? n !== m.size : (m.size.gte !== undefined && n < m.size.gte) || (m.size.lte !== undefined && n > m.size.lte)) return false;
  }
  if (m.match !== undefined) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !matchesWhere(value, m.match)) return false;
  }
  if (m.has_all !== undefined) {
    if (!Array.isArray(value) || !m.has_all.every((x) => value.some((v) => eqScalar(v, x)))) return false;
  }
  if (m.every !== undefined) {
    if (!Array.isArray(value) || value.length === 0 || !value.every((v) => matches(v, m.every!))) return false;
  }
  if (m.some !== undefined) {
    if (!Array.isArray(value) || !value.some((v) => matches(v, m.some!))) return false;
  }
  return true;
}

export function matchesWhere(obj: unknown, where: Where | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([path, m]) => matches(getPath(obj, path), m));
}

function countOk(n: number, count: number | { gte?: number; lte?: number } | undefined): boolean {
  if (count === undefined) return n >= 1;
  if (typeof count === 'number') return n >= count;
  return (count.gte === undefined || n >= count.gte) && (count.lte === undefined || n <= count.lte);
}

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

export interface PhoneSnapshot {
  events: readonly PhoneEvent[];
  records: readonly PhoneRecord[];
}

export function snapshot(events: readonly PhoneEvent[]): PhoneSnapshot {
  return { events, records: recordsFrom(events) };
}

export function checkCondition(c: GoalCondition, s: PhoneSnapshot): boolean {
  switch (c.kind) {
    case 'record': {
      const n = s.records.filter((r) => r.record === c.record && matchesWhere(r.data, c.where)).length;
      return countOk(n, c.count);
    }
    case 'event': {
      const n = s.events.filter((e) => e.type === c.event && matchesWhere(e, c.where)).length;
      return countOk(n, c.count);
    }
    case 'all_of':
      return c.conditions.every((x) => checkCondition(x, s));
    case 'any_of':
      return c.conditions.some((x) => checkCondition(x, s));
    case 'not':
      return !checkCondition(c.condition, s);
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Progress, hints, finish
// ---------------------------------------------------------------------------

export interface GoalState {
  goal: ScenarioGoal;
  done: boolean;
}

export function goalStates(spec: ScenarioSpec, events: readonly PhoneEvent[]): GoalState[] {
  const s = snapshot(events);
  return spec.goals.map((goal) => ({ goal, done: checkCondition(goal.condition, s) }));
}

/** Every required goal holds. */
export function isComplete(spec: ScenarioSpec, events: readonly PhoneEvent[]): boolean {
  return goalStates(spec, events).every((g) => g.done || g.goal.optional);
}

/**
 * The hint to show next: the first whose `done` condition doesn't hold yet (hints without one
 * count as done once a LATER hint's condition holds or once it has been shown). `shown` =
 * how many hints were already revealed — the next one is offered after them.
 */
export function nextHintIndex(spec: ScenarioSpec, events: readonly PhoneEvent[], shown: number): number | null {
  if (spec.hints.length === 0) return null;
  const s = snapshot(events);
  // The furthest hint whose step is already done: start after it.
  let from = 0;
  spec.hints.forEach((h, i) => {
    if (h.done && checkCondition(h.done, s)) from = i + 1;
  });
  const idx = Math.max(from, Math.min(shown, spec.hints.length));
  return idx < spec.hints.length ? idx : null;
}

export interface MistakeHit {
  id: string;
  label: { en: string; zh: string };
}

export function mistakesMade(spec: ScenarioSpec, events: readonly PhoneEvent[]): MistakeHit[] {
  const s = snapshot(events);
  return (spec.mistakes ?? []).filter((m) => checkCondition(m.when, s)).map((m) => ({ id: m.id, label: m.label }));
}

/** Slips the apps report themselves (a wrong pay password, a form sent with gaps). */
export function slipCount(events: readonly PhoneEvent[]): number {
  return events.filter((e) => e.type === 'error').length;
}

export const DURATION_BUCKETS = ['lt2m', '2-5m', '5-10m', '10-20m', 'gt20m'] as const;
export type DurationBucket = (typeof DURATION_BUCKETS)[number];

/** Analytics bucket of a play's length (never the exact time). */
export function durationBucket(ms: number): DurationBucket {
  const min = ms / 60_000;
  if (min < 2) return 'lt2m';
  if (min < 5) return '2-5m';
  if (min < 10) return '5-10m';
  if (min < 20) return '10-20m';
  return 'gt20m';
}

export interface ScenarioResult {
  scenario_id: string;
  success: boolean;
  duration_ms: number;
  hints_used: number;
  goals_done: string[];
  bonus_done: string[];
  bonus_total: number;
  mistakes: MistakeHit[];
  slips: number;
  persona_messages: number;
}

export function scenarioResult(spec: ScenarioSpec, events: readonly PhoneEvent[], startedAt: number, endedAt: number): ScenarioResult {
  const states = goalStates(spec, events);
  return {
    scenario_id: spec.id,
    success: states.every((g) => g.done || g.goal.optional),
    duration_ms: Math.max(0, endedAt - startedAt),
    hints_used: events.filter((e) => e.type === 'hint').length,
    goals_done: states.filter((g) => g.done && !g.goal.optional).map((g) => g.goal.id),
    bonus_done: states.filter((g) => g.done && g.goal.optional).map((g) => g.goal.id),
    bonus_total: states.filter((g) => g.goal.optional).length,
    mistakes: mistakesMade(spec, events),
    slips: slipCount(events),
    persona_messages: events.filter((e) => e.type === 'persona.message' && e.from === 'me').length,
  };
}

/** "3分12秒" / "3 min 12 s". */
export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m} min ${s % 60} s` : `${s} s`;
}
