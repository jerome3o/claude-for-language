/**
 * "Revisit later" — the schedule of mini lessons. (Graded readers were on it
 * too until Oct 2026; now a story is read once and never repeated —
 * shared/study/daily-reader.ts.)
 *
 * Lessons are big chunks, not flashcards: FSRS's short learning steps brought
 * a Hard / Good one back within minutes or a day. Instead, the rating after
 * finishing sets the gap until the next visit:
 *
 *   Again → 1 day · Hard → 2 days · Good → 14 days · Easy → 42 days (~6 weeks)
 *
 * Each later successful visit (Hard / Good / Easy) grows the gap: the next gap
 * is max(the rating's base gap, previous gap × growth) — growth 2.0 (Hard grows
 * less, ×1.2 at most) — capped at 180 days. Again resets it to 1 day.
 *
 * "Done for good" retires the item: never scheduled again (still listed on the
 * Mini Lessons / Readers pages, where "Bring back" puts it in rotation again,
 * due at once).
 *
 * Event-sourced: the state is derived from the history (completion / reader
 * review events + retire / restore events), never stored. The gaps are an
 * account setting (Settings → "Lessons & readers"; users.revisit_settings).
 *
 * Pure; the Lab app's port (core/…/Revisit.kt) is parity-tested against it.
 */

export interface RevisitSettings {
  /** First gap after Hard, in days. */
  hard_days: number;
  /** First gap after Good, in days. */
  good_days: number;
  /** First gap after Easy, in days. */
  easy_days: number;
  /** How much the gap grows on each later successful visit (Hard grows less). */
  growth: number;
  /** No gap is ever longer than this, in days. */
  cap_days: number;
  /** At most this many NEW (never-finished) lessons are introduced per local day (0 = none). */
  new_lessons_per_day: number;
}

export const DEFAULT_REVISIT_SETTINGS: Readonly<RevisitSettings> = Object.freeze({
  hard_days: 2,
  good_days: 14,
  easy_days: 42,
  growth: 2,
  cap_days: 180,
  new_lessons_per_day: 1,
});

/** Again always comes back the next day. */
export const REVISIT_AGAIN_DAYS = 1;
/** Hard grows the gap by at most this much (never more than `growth`). */
export const REVISIT_HARD_GROWTH = 1.2;

export const REVISIT_LIMITS = Object.freeze({
  days: { min: 1, max: 365 },
  growth: { min: 1, max: 5 },
  cap_days: { min: 1, max: 3650 },
  new_lessons_per_day: { min: 0, max: 20 },
});

const DAY_MS = 24 * 60 * 60 * 1000;

/** One event in an item's history. `rating` events are finishes (0 Again … 3 Easy; null = a legacy finish = Good). */
export type RevisitEvent =
  | { id: string; at: string; kind: 'rating'; rating: number | null }
  | { id: string; at: string; kind: 'retire' | 'restore' };

export type RevisitStatus = 'new' | 'scheduled' | 'retired';

export interface RevisitState {
  status: RevisitStatus;
  /** When it is next due (ms since epoch); null when new or retired. */
  due_ms: number | null;
  /** The current gap in days (0 before the first finish). */
  gap_days: number;
  /** The last finish (ms), null before the first. */
  last_ms: number | null;
  /** How many times it was finished. */
  finishes: number;
}

function ms(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** The gap a rating gives after a previous gap of `prevGap` days (0 = first finish). */
export function nextGapDays(prevGap: number, rating: number | null, settings: RevisitSettings = DEFAULT_REVISIT_SETTINGS): number {
  const r = rating ?? 2;
  if (r <= 0) return REVISIT_AGAIN_DAYS;
  const cap = settings.cap_days;
  const base = r === 1 ? settings.hard_days : r === 2 ? settings.good_days : settings.easy_days;
  const growth = r === 1 ? Math.min(REVISIT_HARD_GROWTH, settings.growth) : settings.growth;
  const grown = prevGap > 0 ? prevGap * growth : 0;
  return round2(Math.min(cap, Math.max(base, grown)));
}

/** Events in time order (ties by id, so every device replays them the same way). */
export function sortRevisitEvents<T extends RevisitEvent>(events: T[]): T[] {
  return [...events].sort((a, b) => {
    const d = ms(a.at) - ms(b.at);
    if (d !== 0) return d;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Replay an item's history into its schedule. */
export function computeRevisitState(events: RevisitEvent[], settings: RevisitSettings = DEFAULT_REVISIT_SETTINGS): RevisitState {
  let gap = 0;
  let last: number | null = null;
  let due: number | null = null;
  let retired = false;
  let finishes = 0;
  for (const e of sortRevisitEvents(events)) {
    const at = ms(e.at);
    if (e.kind === 'retire') {
      retired = true;
    } else if (e.kind === 'restore') {
      // Back in rotation, due at once; the gap it had grown is kept.
      if (retired) due = at;
      retired = false;
    } else if (e.kind === 'rating') {
      gap = nextGapDays(gap, e.rating, settings);
      last = at;
      due = at + Math.round(gap * DAY_MS);
      finishes++;
    }
  }
  if (retired) return { status: 'retired', due_ms: null, gap_days: gap, last_ms: last, finishes };
  if (due === null) return { status: 'new', due_ms: null, gap_days: 0, last_ms: null, finishes };
  return { status: 'scheduled', due_ms: due, gap_days: gap, last_ms: last, finishes };
}

/** Whether it should be offered by `cutoffMs` (the end of today's study day). New items are "due" too. */
export function isRevisitDue(state: RevisitState, cutoffMs: number): boolean {
  if (state.status === 'retired') return false;
  if (state.status === 'new') return true;
  return state.due_ms !== null && state.due_ms <= cutoffMs;
}

/** The gap each rating button would give now (days), for the button labels. */
export function revisitPreviews(state: RevisitState, settings: RevisitSettings = DEFAULT_REVISIT_SETTINGS): [number, number, number, number] {
  const prev = state.status === 'new' ? 0 : state.gap_days;
  return [0, 1, 2, 3].map(r => nextGapDays(prev, r, settings)) as [number, number, number, number];
}

/** "1 day", "2 days", "2 wk", "6 wk", "3 mo", "1.5 yr" — the button label for a gap. */
export function revisitGapLabel(days: number): string {
  const d = Math.max(1, Math.round(days));
  if (d < 14) return d === 1 ? '1 day' : `${d} days`;
  if (d < 60) return `${Math.round(d / 7)} wk`;
  if (d < 365) return `${Math.round(d / 30)} mo`;
  const y = Math.round((d / 365) * 10) / 10;
  return `${y} yr`;
}

// ============ Settings ============

export type RevisitSettingsUpdate = { [K in keyof RevisitSettings]?: number | null };

const KEYS = ['hard_days', 'good_days', 'easy_days', 'growth', 'cap_days', 'new_lessons_per_day'] as const;

function limitFor(key: keyof RevisitSettings): { min: number; max: number } {
  return key === 'growth' ? REVISIT_LIMITS.growth
    : key === 'cap_days' ? REVISIT_LIMITS.cap_days
    : key === 'new_lessons_per_day' ? REVISIT_LIMITS.new_lessons_per_day
    : REVISIT_LIMITS.days;
}

function asNumber(v: unknown): number {
  return typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
}

/**
 * Validate an update from an untrusted body: day fields whole numbers 1–365,
 * growth 1–5 (one decimal place is plenty, two allowed), cap 1–3650,
 * new lessons a day a whole number 0–20;
 * null = back to that default. Checks the merged result keeps Hard ≤ Good ≤ Easy.
 */
export function pickRevisitSettingsUpdate(
  input: Record<string, unknown> | null | undefined,
  current: RevisitSettings = DEFAULT_REVISIT_SETTINGS,
): { update: RevisitSettingsUpdate; problems: string[] } {
  const update: RevisitSettingsUpdate = {};
  const problems: string[] = [];
  for (const key of KEYS) {
    if (!input || !(key in input)) continue;
    const v = input[key];
    if (v === undefined) continue;
    if (v === null) { update[key] = null; continue; }
    const n = asNumber(v);
    const { min, max } = limitFor(key);
    if (key === 'growth') {
      if (!Number.isFinite(n) || n < min || n > max) problems.push(`growth must be a number between ${min} and ${max}`);
      else update[key] = round2(n);
    } else if (key === 'new_lessons_per_day') {
      if (!Number.isInteger(n) || n < min || n > max) problems.push(`new_lessons_per_day must be a whole number between ${min} and ${max}`);
      else update[key] = n;
    } else if (!Number.isInteger(n) || n < min || n > max) {
      problems.push(`${key} must be a whole number of days between ${min} and ${max}`);
    } else {
      update[key] = n;
    }
  }
  if (problems.length === 0) {
    const merged = applyRevisitSettingsUpdate(current, update);
    if (!(merged.hard_days <= merged.good_days && merged.good_days <= merged.easy_days)) {
      problems.push('the gaps must go up: Hard ≤ Good ≤ Easy');
    }
  }
  return { update, problems };
}

/** Apply an update (null = that field's default). */
export function applyRevisitSettingsUpdate(current: RevisitSettings, update: RevisitSettingsUpdate): RevisitSettings {
  const next: RevisitSettings = { ...current };
  for (const key of KEYS) {
    if (!(key in update)) continue;
    const v = update[key];
    next[key] = v === null || v === undefined ? DEFAULT_REVISIT_SETTINGS[key] : v;
  }
  return next;
}

/** Read stored settings (a JSON string or object, maybe partial / garbage) into a full, valid set. */
export function parseRevisitSettings(raw: unknown): RevisitSettings {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw); } catch { obj = null; }
  }
  const out: RevisitSettings = { ...DEFAULT_REVISIT_SETTINGS };
  if (!obj || typeof obj !== 'object') return out;
  const src = obj as Record<string, unknown>;
  for (const key of KEYS) {
    const n = asNumber(src[key]);
    const { min, max } = limitFor(key);
    if (Number.isFinite(n) && n >= min && n <= max) out[key] = key === 'growth' ? round2(n) : Math.round(n);
  }
  if (!(out.hard_days <= out.good_days && out.good_days <= out.easy_days)) {
    return { ...DEFAULT_REVISIT_SETTINGS, growth: out.growth, cap_days: out.cap_days, new_lessons_per_day: out.new_lessons_per_day };
  }
  return out;
}

export function isDefaultRevisitSettings(s: RevisitSettings): boolean {
  return KEYS.every(k => s[k] === DEFAULT_REVISIT_SETTINGS[k]);
}

/** What /api/auth/me and /api/sync/changes carry. */
export interface RevisitSettingsInfo extends RevisitSettings {
  is_default: boolean;
}

export function revisitSettingsInfo(s: RevisitSettings): RevisitSettingsInfo {
  return { ...s, is_default: isDefaultRevisitSettings(s) };
}

// ============ Pacing: no flood of overdue items ============

/**
 * At most this many lesson REVISITS a day (new lessons have their own cap), so
 * items that were overdue when the schedule changed — or after a week away —
 * come back a couple a day instead of all at once. Most overdue first.
 */
export const MAX_LESSON_REVISITS_PER_DAY = 2;

/** Due items, most overdue first, limited to what today still allows. */
export function pickRevisitsForToday<T>(
  items: Array<{ item: T; state: RevisitState }>,
  cutoffMs: number,
  doneToday: number,
  perDay: number = MAX_LESSON_REVISITS_PER_DAY,
): T[] {
  const room = Math.max(0, perDay - doneToday);
  return items
    .filter(x => x.state.status === 'scheduled' && isRevisitDue(x.state, cutoffMs))
    .sort((a, b) => (a.state.due_ms ?? 0) - (b.state.due_ms ?? 0))
    .slice(0, room)
    .map(x => x.item);
}

// ============ Pacing: new lessons per local DAY ============

/**
 * How many lessons were INTRODUCED today: lessons whose very first finish is at
 * or after `dayStartMs` (local midnight) — derived from the completion events,
 * never a counter (like introducedToday for cards). Lessons in `exclude` (one-off
 * homework, done in the homework pass) don't count.
 */
export function newLessonsIntroducedToday(
  events: Array<{ lesson_id: string; completed_at: string }>,
  dayStartMs: number,
  exclude: ReadonlySet<string> = new Set(),
): number {
  const first = new Map<string, number>();
  for (const e of events) {
    if (exclude.has(e.lesson_id)) continue;
    const t = ms(e.completed_at);
    const f = first.get(e.lesson_id);
    if (f === undefined || t < f) first.set(e.lesson_id, t);
  }
  let n = 0;
  for (const t of first.values()) if (t >= dayStartMs) n++;
  return n;
}

/** The NEW lessons today still has room for: oldest first (ties by id), `perDay` minus those already introduced. */
export function pickNewLessonsForToday<T extends { id: string; created_at: string }>(
  fresh: T[],
  introducedToday: number,
  perDay: number = DEFAULT_REVISIT_SETTINGS.new_lessons_per_day,
): T[] {
  const room = Math.max(0, Math.floor(perDay) - introducedToday);
  return [...fresh]
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, room);
}
