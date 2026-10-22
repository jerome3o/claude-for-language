/**
 * "How fast am I going?" — the Progress page's Characters & words chart in **Per week**
 * mode: newly known characters / words gained each week, plus the pace of the last 4
 * weeks against the 4 before. Pure functions over the same history the totals use
 * (`knownProgress`, shared/progress/known.ts), so the two views always agree. The Lab
 * app's Kotlin port (`core/…/KnownRate.kt`) is parity-tested against this file.
 *
 * - A **week** runs Monday 00:00 → next Monday 00:00 in the learner's time zone, given as
 *   a fixed `tzOffsetMinutes` (minutes EAST of UTC — London summer = 60) for the whole
 *   range, so the functions stay pure; a summer-time change moves a boundary by an hour,
 *   which no one can see in a weekly bar.
 * - A week's **gain** is the NET change of the known count across it: count at its end
 *   minus count at its start (counts include events at or before a point, like the
 *   totals). A card that lapses stops being known, so a week can be NEGATIVE — shown as
 *   such, below the zero line.
 * - The current week is **partial** (start → now), marked so the apps draw it fainter
 *   and say "so far".
 * - **Pace** = the gain over the last 28 days ending now, per week (÷ 4, rounded), and
 *   the same for the 28 days before that. No pace until there are 28 days of history;
 *   no comparison until there are 56.
 *
 * Why weekly bars (not "per day, 7-day average"): a word becomes known when a review
 * pushes a card's stability past 21 days, so knowing arrives in lumps on study days —
 * daily numbers are mostly 0 or small decimals, a rolling average still wiggles daily,
 * while a weekly whole number ("+61 words") matches the weekly rhythm of study and is
 * easy to read; ~40 bars cover 9 months at phone width.
 */
import {
  knownProgress, historyPoints,
  type KnownProgress, type KnownPoint, type KnownNoteInput, type KnownCardInput, type KnownEventInput,
} from './known';

const DAY_MS = 86_400_000;
export const WEEK_MS = 7 * DAY_MS;
/** The chart shows at most this many weeks (the most recent). */
export const RATE_MAX_WEEKS = 52;
/** Pace window: the last 4 weeks. */
export const PACE_WEEKS = 4;

export interface WeekGain {
  /** Monday 00:00 local, epoch ms. */
  start_ms: number;
  /** Next Monday 00:00 local, or now for the current week. */
  end_ms: number;
  /** The current week, still running. */
  partial: boolean;
  characters: number;
  words: number;
}

export interface SeriesPace {
  /** Known gained per week over the last 4 weeks (rounded). */
  per_week: number;
  /** The same for the 4 weeks before; null without 8 weeks of history. */
  previous_per_week: number | null;
  /** per_week vs previous_per_week; null without a comparison. */
  trend: 'up' | 'down' | 'same' | null;
}

export interface KnownPace {
  characters: SeriesPace;
  words: SeriesPace;
}

export interface KnownRate {
  /** Oldest first, at most RATE_MAX_WEEKS, the last one the current (partial) week. */
  weeks: WeekGain[];
  /** null until there are 4 weeks of history. */
  pace: KnownPace | null;
}

export type KnownProgressWithRate = KnownProgress & { rate: KnownRate };

/** Monday 00:00 (local, at a fixed offset) of the week containing `ms`. */
export function weekStart(ms: number, tzOffsetMinutes: number): number {
  const off = tzOffsetMinutes * 60_000;
  const day = Math.floor((ms + off) / DAY_MS);
  // Epoch day 0 (1 Jan 1970) was a Thursday: days since Monday = (day + 3) mod 7.
  const sinceMonday = (((day + 3) % 7) + 7) % 7;
  return (day - sinceMonday) * DAY_MS - off;
}

function firstEventMs(events: readonly KnownEventInput[]): number {
  let first = Infinity;
  for (const e of events) {
    const ms = Date.parse(e.reviewed_at);
    if (!Number.isNaN(ms) && ms < first) first = ms;
  }
  return first;
}

/**
 * The points the rate needs, ascending and distinct: every Monday from the week of the
 * first review (at most RATE_MAX_WEEKS weeks back, plus one) up to this week's, 28 and 56
 * days ago (when inside the history), and now. No events → [].
 */
export function ratePoints(events: readonly KnownEventInput[], nowMs: number, tzOffsetMinutes: number, maxWeeks = RATE_MAX_WEEKS): number[] {
  const first = firstEventMs(events);
  if (first === Infinity) return [];
  const thisWeek = weekStart(nowMs, tzOffsetMinutes);
  let start = weekStart(Math.min(first, nowMs), tzOffsetMinutes);
  start = Math.max(start, thisWeek - Math.max(1, maxWeeks) * WEEK_MS);
  const out = new Set<number>();
  for (let w = start; w <= thisWeek; w += WEEK_MS) out.add(w);
  for (const k of [1, 2]) {
    const p = nowMs - k * PACE_WEEKS * WEEK_MS;
    if (p >= start) out.add(p);
  }
  out.add(nowMs);
  return [...out].sort((a, b) => a - b);
}

function perWeek(gain: number): number {
  return Math.floor(gain / PACE_WEEKS + 0.5) + 0; // + 0: never -0
}

function seriesPace(now: number, ago4: number, ago8: number | null): SeriesPace {
  const per = perWeek(now - ago4);
  const prev = ago8 == null ? null : perWeek(ago4 - ago8);
  return {
    per_week: per,
    previous_per_week: prev,
    trend: prev == null ? null : per > prev ? 'up' : per < prev ? 'down' : 'same',
  };
}

/**
 * Weekly gains and pace from a history sampled (at least) at `ratePoints(…)` — extra
 * points are ignored; a missing one counts as 0 known (before any review).
 */
export function knownRate(
  history: readonly KnownPoint[],
  firstMs: number | null,
  nowMs: number,
  tzOffsetMinutes: number,
  maxWeeks = RATE_MAX_WEEKS,
): KnownRate {
  if (firstMs == null || history.length === 0) return { weeks: [], pace: null };
  const at = new Map<number, KnownPoint>();
  for (const p of history) at.set(p.at_ms, p);
  const chars = (ms: number) => at.get(ms)?.characters.known ?? 0;
  const words = (ms: number) => at.get(ms)?.words.known ?? 0;

  const thisWeek = weekStart(nowMs, tzOffsetMinutes);
  let start = weekStart(Math.min(firstMs, nowMs), tzOffsetMinutes);
  start = Math.max(start, thisWeek - Math.max(1, maxWeeks) * WEEK_MS);
  const weeks: WeekGain[] = [];
  for (let w = start; w <= thisWeek; w += WEEK_MS) {
    const partial = w === thisWeek;
    const end = partial ? nowMs : w + WEEK_MS;
    weeks.push({ start_ms: w, end_ms: end, partial, characters: chars(end) - chars(w), words: words(end) - words(w) });
  }
  const shown = weeks.slice(-Math.max(1, maxWeeks));

  const window = PACE_WEEKS * WEEK_MS;
  let pace: KnownPace | null = null;
  if (firstMs <= nowMs - window) {
    const a4 = nowMs - window;
    const a8 = firstMs <= nowMs - 2 * window ? nowMs - 2 * window : null;
    pace = {
      characters: seriesPace(chars(nowMs), chars(a4), a8 == null ? null : chars(a8)),
      words: seriesPace(words(nowMs), words(a4), a8 == null ? null : words(a8)),
    };
  }
  return { weeks: shown, pace };
}

/**
 * The totals (`knownProgress` at `historyPoints`) and the rate in ONE replay: the
 * history is sampled at both sets of points and split again.
 */
export function knownProgressWithRate(
  notes: readonly KnownNoteInput[],
  cards: readonly KnownCardInput[],
  events: readonly KnownEventInput[],
  nowMs: number,
  tzOffsetMinutes: number,
): KnownProgressWithRate {
  const totalPoints = historyPoints(events, nowMs);
  const rPoints = ratePoints(events, nowMs, tzOffsetMinutes);
  const all = [...new Set([...totalPoints, ...rPoints])].sort((a, b) => a - b);
  const progress = knownProgress(notes, cards, events, all);
  const totalSet = new Set(totalPoints);
  const first = firstEventMs(events);
  return {
    ...progress,
    history: progress.history.filter((p) => totalSet.has(p.at_ms)),
    rate: knownRate(progress.history, first === Infinity ? null : first, nowMs, tzOffsetMinutes),
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "6 Oct" for a week's Monday, in the same fixed offset. */
export function weekDayLabel(startMs: number, tzOffsetMinutes: number): string {
  const d = new Date(startMs + tzOffsetMinutes * 60_000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "Week of 6 Oct" — "(so far)" for the current week. */
export function weekLabel(week: Pick<WeekGain, 'start_ms' | 'partial'>, tzOffsetMinutes: number): string {
  return `Week of ${weekDayLabel(week.start_ms, tzOffsetMinutes)}${week.partial ? ' (so far)' : ''}`;
}

function grouped(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** "+38", "−5" (a real minus sign), "0". */
export function signedCount(n: number): string {
  if (n > 0) return `+${grouped(n)}`;
  if (n < 0) return `−${grouped(-n)}`;
  return '0';
}

/** The tooltip / inspect line: "Week of 6 Oct · +38 characters · +61 words". */
export function weekSummary(week: WeekGain, tzOffsetMinutes: number): string {
  return `${weekLabel(week, tzOffsetMinutes)} · ${signedCount(week.characters)} characters · ${signedCount(week.words)} words`;
}

/** "≈ 42 words / week" */
export function paceLabel(perWeek: number, noun: 'characters' | 'words'): string {
  const n = perWeek < 0 ? `−${grouped(-perWeek)}` : grouped(perWeek);
  return `≈ ${n} ${noun} / week`;
}

/** "↑ from 30", "↓ from 51", "= same as before"; null without a comparison. */
export function paceTrendLabel(p: SeriesPace): string | null {
  if (p.previous_per_week == null || p.trend == null) return null;
  const prev = p.previous_per_week < 0 ? `−${grouped(-p.previous_per_week)}` : grouped(p.previous_per_week);
  if (p.trend === 'up') return `↑ from ${prev}`;
  if (p.trend === 'down') return `↓ from ${prev}`;
  return 'same as before';
}

/** Chart's Total | Per week toggle, remembered per device. */
export type KnownChartMode = 'total' | 'rate';
export function parseKnownChartMode(raw: unknown): KnownChartMode {
  return raw === 'rate' ? 'rate' : 'total';
}
