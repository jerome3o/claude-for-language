/**
 * "Revisit later" golden vectors (mini lessons + graded readers), from the web app's own
 * TypeScript — shared/study/revisit.ts:
 *   - nextGapDays over every rating × previous gap × settings set;
 *   - computeRevisitState over seeded histories (legacy null ratings, Again resets, the cap,
 *     custom settings, retire / restore, same-millisecond ties broken by id, garbage dates)
 *     with isRevisitDue and revisitPreviews on each result;
 *   - revisitGapLabel, pickRevisitSettingsUpdate / applyRevisitSettingsUpdate /
 *     parseRevisitSettings (problems verbatim), isDefaultRevisitSettings;
 *   - pickRevisitsForToday; newLessonsIntroducedToday + pickNewLessonsForToday ("New lessons a day").
 * Writes revisit.json; core RevisitParityTest asserts Revisit.kt matches exactly.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  nextGapDays,
  computeRevisitState,
  isRevisitDue,
  revisitPreviews,
  revisitGapLabel,
  pickRevisitSettingsUpdate,
  applyRevisitSettingsUpdate,
  parseRevisitSettings,
  isDefaultRevisitSettings,
  pickRevisitsForToday,
  newLessonsIntroducedToday,
  pickNewLessonsForToday,
  DEFAULT_REVISIT_SETTINGS,
  type RevisitEvent,
  type RevisitSettings,
  type RevisitState,
} from '../../../shared/study/revisit';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: revisit <out-dir>');
mkdirSync(OUT, { recursive: true });

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261006);
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];

const SETTINGS: RevisitSettings[] = [
  { ...DEFAULT_REVISIT_SETTINGS },
  { hard_days: 1, good_days: 7, easy_days: 21, growth: 1.5, cap_days: 90, new_lessons_per_day: 2 },
  { hard_days: 3, good_days: 3, easy_days: 3, growth: 1, cap_days: 3, new_lessons_per_day: 0 },
  { hard_days: 5, good_days: 30, easy_days: 120, growth: 3.33, cap_days: 365, new_lessons_per_day: 1 },
  { hard_days: 2, good_days: 10, easy_days: 50, growth: 1.1, cap_days: 3650, new_lessons_per_day: 20 },
  { hard_days: 365, good_days: 365, easy_days: 365, growth: 5, cap_days: 1, new_lessons_per_day: 3 },
];
const RATINGS: Array<number | null> = [null, 0, 1, 2, 3];

const gaps: unknown[] = [];
for (const s of SETTINGS) {
  for (const prev of [0, 0.5, 1, 1.2, 2, 2.4, 13.99, 14, 28, 37.33, 90, 179.99, 180, 400, 1234.56]) {
    for (const r of RATINGS) gaps.push({ s, prev, r, gap: nextGapDays(prev, r, s) });
  }
}

const stateJson = (st: RevisitState) => st;

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1, 9, 30, 0);
const histories: unknown[] = [];
for (let i = 0; i < 500; i++) {
  const s = i < 150 ? DEFAULT_REVISIT_SETTINGS : pick(SETTINGS);
  const n = int(0, 14);
  const events: RevisitEvent[] = [];
  let t = T0 + int(0, 400) * DAY + int(0, DAY - 1);
  for (let k = 0; k < n; k++) {
    const roll = rand();
    const sameMs = rand() < 0.12; // ties broken by id
    if (!sameMs) t += int(0, 3) === 0 ? int(0, 5000) : int(1, 120) * DAY / int(1, 4);
    const at = rand() < 0.02 ? pick(['garbage', '']) : new Date(Math.floor(t)).toISOString();
    const id = `${String.fromCharCode(97 + int(0, 25))}${int(0, 999)}`;
    if (roll < 0.12) events.push({ id, at, kind: 'retire' });
    else if (roll < 0.22) events.push({ id, at, kind: 'restore' });
    else events.push({ id, at, kind: 'rating', rating: pick([null, 0, 1, 1, 2, 2, 2, 2, 3, 3]) });
  }
  // Shuffled: computeRevisitState sorts them itself.
  const shuffled = [...events].sort(() => rand() - 0.5);
  const state = computeRevisitState(shuffled, s);
  const cutoffs = [T0, T0 + int(0, 900) * DAY, state.due_ms ?? T0, (state.due_ms ?? T0) - 1];
  histories.push({
    s,
    events: shuffled,
    state: stateJson(state),
    due: cutoffs.map(c => ({ cutoff: c, due: isRevisitDue(state, c) })),
    previews: revisitPreviews(state, s),
  });
}
// The named cases from the spec: Good, Good, Good… with the defaults and the cap; Again reset.
const named = [
  [2, 2, 2, 2, 2, 2, 2],
  [3, 3, 3, 3],
  [1, 1, 1, 1, 1, 1],
  [2, 2, 0, 2, 2],
  [2, 1, 2, 3, 0, 1],
  [null, null, null],
];
for (const ratings of named) {
  for (const s of SETTINGS) {
    const events: RevisitEvent[] = ratings.map((r, k) => ({ id: `n${k}`, at: new Date(T0 + k * 500 * DAY).toISOString(), kind: 'rating', rating: r }));
    const state = computeRevisitState(events, s);
    histories.push({ s, events, state: stateJson(state), due: [{ cutoff: T0, due: isRevisitDue(state, T0) }], previews: revisitPreviews(state, s) });
  }
}

const labels: unknown[] = [];
for (const d of [-3, 0, 0.4, 0.5, 1, 1.49, 1.5, 2, 6.5, 13, 13.5, 14, 20, 20.9, 21, 42, 59, 59.5, 60, 89, 90, 105, 180, 270, 364, 364.5, 365, 400, 547, 730, 1000, 3650]) {
  labels.push({ d, label: revisitGapLabel(d) });
}
for (let i = 0; i < 200; i++) {
  const d = Math.round(rand() * 4000 * 100) / 100;
  labels.push({ d, label: revisitGapLabel(d) });
}

const VALUES: unknown[] = [
  null, 0, 1, 2, 7, 14, 20, 21, 42, 180, 365, 366, 3650, 3651, -1, 1.5, 2.25, 4.999, 5, 5.01, 1.234, 0.99,
  '14', ' 30 ', '', '  ', 'abc', '1e2', '0x10', '2.5', 'Infinity', '7days', true, false, [], {},
];
const KEYS = ['hard_days', 'good_days', 'easy_days', 'growth', 'cap_days', 'new_lessons_per_day'] as const;
const updates: unknown[] = [];
for (let i = 0; i < 400; i++) {
  const input: Record<string, unknown> = {};
  for (const k of KEYS) if (rand() < 0.45) input[k] = pick(VALUES);
  if (rand() < 0.1) input.junk = 5;
  const current = pick(SETTINGS);
  const { update, problems } = pickRevisitSettingsUpdate(input, current);
  updates.push({ input, current, update, problems, applied: applyRevisitSettingsUpdate(current, update) });
}
// Explicit: the order check, a reset of one field, an empty body, a null body.
for (const [input, current] of [
  [{ hard_days: 20 }, DEFAULT_REVISIT_SETTINGS],
  [{ easy_days: 10 }, DEFAULT_REVISIT_SETTINGS],
  [{ good_days: null }, SETTINGS[1]],
  [{ hard_days: 14, good_days: 14, easy_days: 14 }, DEFAULT_REVISIT_SETTINGS],
  [{}, DEFAULT_REVISIT_SETTINGS],
  [null, DEFAULT_REVISIT_SETTINGS],
  [{ growth: 1.15, cap_days: 365 }, DEFAULT_REVISIT_SETTINGS],
  [{ hard_days: '3', good_days: '21', easy_days: '60', growth: '1.5', cap_days: '200' }, DEFAULT_REVISIT_SETTINGS],
  [{ hard_days: 0, growth: 9 }, DEFAULT_REVISIT_SETTINGS],
  [{ new_lessons_per_day: 0 }, DEFAULT_REVISIT_SETTINGS],
  [{ new_lessons_per_day: '3' }, DEFAULT_REVISIT_SETTINGS],
  [{ new_lessons_per_day: 1.5 }, DEFAULT_REVISIT_SETTINGS],
  [{ new_lessons_per_day: null }, SETTINGS[3]],
  [{ new_lessons_per_day: 21, hard_days: 20 }, DEFAULT_REVISIT_SETTINGS],
] as Array<[Record<string, unknown> | null, RevisitSettings]>) {
  const { update, problems } = pickRevisitSettingsUpdate(input, current);
  updates.push({ input, current, update, problems, applied: applyRevisitSettingsUpdate(current, update) });
}

const parses: unknown[] = [];
const RAWS: unknown[] = [
  null, '', 'not json', '{}', '[]', 'null', '42',
  JSON.stringify(DEFAULT_REVISIT_SETTINGS), JSON.stringify(SETTINGS[1]),
  { hard_days: 20, good_days: 10, easy_days: 5, growth: 3, cap_days: 99 },
  { hard_days: 1.4, good_days: 13.6, easy_days: 365.4, growth: 1.234, cap_days: 0.5 },
  { growth: '2.555', cap_days: '400' }, { hard_days: true }, [1, 2],
  { new_lessons_per_day: 0 }, { new_lessons_per_day: '4' }, { new_lessons_per_day: 2.6 }, { new_lessons_per_day: 99 },
  { hard_days: 20, good_days: 10, new_lessons_per_day: 5 },
];
for (const raw of RAWS) parses.push({ raw, settings: parseRevisitSettings(raw) });
for (let i = 0; i < 100; i++) {
  const raw: Record<string, unknown> = {};
  for (const k of KEYS) if (rand() < 0.6) raw[k] = pick(VALUES);
  const asString = rand() < 0.3;
  parses.push({ raw: asString ? JSON.stringify(raw) : raw, settings: parseRevisitSettings(asString ? JSON.stringify(raw) : raw) });
}
const defaults = SETTINGS.map(s => ({ s, isDefault: isDefaultRevisitSettings(s) }));

const picks: unknown[] = [];
for (let i = 0; i < 200; i++) {
  const items = Array.from({ length: int(0, 8) }, (_, k) => {
    const status = pick(['new', 'scheduled', 'scheduled', 'scheduled', 'retired'] as const);
    const due_ms = status === 'scheduled' ? (rand() < 0.08 ? null : T0 + int(-30, 30) * DAY + int(0, 3) * 1000) : null;
    return { item: `L${k}`, state: { status, due_ms, gap_days: int(0, 60), last_ms: null, finishes: int(0, 5) } as RevisitState };
  });
  const cutoff = T0 + int(-2, 2) * DAY;
  const doneToday = int(0, 3);
  const perDay = rand() < 0.7 ? undefined : int(0, 4);
  picks.push({ items, cutoff, doneToday, perDay: perDay ?? null, picked: pickRevisitsForToday(items, cutoff, doneToday, perDay) });
}

// "New lessons a day": lessons introduced today (first-ever finish at / after local midnight)
// and the new lessons that still fit, oldest first.
const newLessons: unknown[] = [];
for (let i = 0; i < 200; i++) {
  const dayStart = T0 + int(0, 30) * DAY;
  const lessonIds = Array.from({ length: int(0, 6) }, (_, k) => `L${k}`);
  const events = Array.from({ length: int(0, 10) }, (_, k) => ({
    lesson_id: lessonIds.length ? pick(lessonIds) : 'L0',
    completed_at: rand() < 0.03 ? 'garbage' : new Date(dayStart + int(-3, 1) * DAY + int(0, DAY - 1) + (k % 2)).toISOString(),
  }));
  const exclude = lessonIds.filter(() => rand() < 0.2);
  const introduced = newLessonsIntroducedToday(events, dayStart, new Set(exclude));
  const fresh = Array.from({ length: int(0, 14) }, (_, k) => ({
    id: `F${int(0, 99)}-${k}`,
    created_at: rand() < 0.15 ? '2026-10-01T00:00:00.000Z' : new Date(T0 - int(0, 60) * DAY - int(0, 1000) * 1000).toISOString(),
  }));
  const perDay = rand() < 0.5 ? undefined : int(0, 4);
  newLessons.push({
    events, day_start: dayStart, exclude, introduced,
    fresh, per_day: perDay ?? null,
    picked: pickNewLessonsForToday(fresh, introduced, perDay).map(f => f.id),
  });
}

writeFileSync(join(OUT, 'revisit.json'), JSON.stringify({ gaps, histories, labels, updates, parses, defaults, picks, newLessons }));
console.log(`revisit: ${gaps.length} gaps, ${histories.length} histories, ${labels.length} labels, ${updates.length} updates, ${parses.length} parses, ${picks.length} picks`);
