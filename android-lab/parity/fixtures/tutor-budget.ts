/**
 * The daily new-card budget as tutor and learner see it (shared/decks/tutor-budget.ts):
 * studyBudgetInfo, budgetSummary, budgetChangeMessage, shortDay, firstName,
 * budgetSetByLabel, budgetFinishHint. Writes tutor-budget.json; checked by
 * core/…/TutorBudgetParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  budgetChangeMessage,
  budgetFinishHint,
  budgetSetByLabel,
  budgetSummary,
  firstName,
  shortDay,
  studyBudgetInfo,
  type StudyBudgetRow,
} from '../../../shared/decks/tutor-budget';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

const nums = [0, 1, 2, 3, 5, 6, 10, 199, 200];
const budgets = nums.flatMap((n) => nums.map((s) => ({ new_cards_per_day: n, secondary_cards_per_day: s })));
const summaries = budgets.map((b) => ({
  budget: b,
  summary: budgetSummary(b),
  message: budgetChangeMessage(b, false),
  message_default: budgetChangeMessage(b, true),
}));

const isos = [
  '2026-10-03T10:00:00.000Z',
  '2026-10-03T23:30:00Z',
  '2026-10-03T00:15:00Z',
  '2026-01-01T00:00:00.000Z',
  '2026-12-31T23:59:59.999Z',
  '2026-02-28T22:00:00+02:00',
  '2026-03-01T01:00:00-05:00',
  '2026-10-03',
  '',
  'not a date',
];
const offsets = [0, -60, -120, -330, -480, -600, -780, 60, 240, 300, 420, 600];
const days = isos.flatMap((iso) => offsets.map((tz) => ({ iso, tz, day: shortDay(iso, tz) })));

const names: Array<string | null> = [
  null, '', '   ', 'Minghui', 'Minghui Wang', '  Minghui   Wang ', '王明慧', 'Anne-Marie Li', '\tJo\nBloggs', ' Li Na', '　老师 王', 'x',
];
const firsts = names.map((name) => ({ name, first: firstName(name) }));

const rows: Array<StudyBudgetRow | null> = [
  null,
  {},
  { new_cards_per_day: null, secondary_cards_per_day: null },
  { new_cards_per_day: 5 },
  { secondary_cards_per_day: 0 },
  { new_cards_per_day: 0, secondary_cards_per_day: 0 },
  { new_cards_per_day: 5, secondary_cards_per_day: 10, study_budget_set_by: 'tutor-1', study_budget_set_at: '2026-10-03T10:00:00.000Z', study_budget_set_by_name: 'Minghui Wang' },
  { new_cards_per_day: 5, secondary_cards_per_day: 10, study_budget_set_by: 'me', study_budget_set_at: '2026-10-03T10:00:00.000Z', study_budget_set_by_name: 'Jerome' },
  { new_cards_per_day: null, secondary_cards_per_day: null, study_budget_set_by: 'tutor-1', study_budget_set_at: '2026-10-02T23:30:00Z', study_budget_set_by_name: null },
  { study_budget_set_by: '', study_budget_set_by_name: 'Ghost' },
  { study_budget_set_by: null, study_budget_set_by_name: 'Ghost', study_budget_set_at: '2026-10-03T10:00:00Z' },
];
const infos = rows.map((row) => {
  const info = studyBudgetInfo(row, 'me');
  return {
    row,
    info,
    labels: offsets.map((tz) => budgetSetByLabel(info, tz)),
  };
});
// Labels for info shapes the server could send (set_at missing / unparsable, no name).
const extraInfos = [
  { set_by_tutor: true, set_by_name: 'Minghui Wang', set_at: null },
  { set_by_tutor: true, set_by_name: null, set_at: 'garbage' },
  { set_by_tutor: true, set_by_name: '  ', set_at: '2026-10-03T00:15:00Z' },
  { set_by_tutor: false, set_by_name: 'Minghui', set_at: '2026-10-03T00:15:00Z' },
].map((info) => ({ info, labels: offsets.map((tz) => budgetSetByLabel(info, tz)) }));

const deckNames: Array<string | null> = [null, '', 'Lesson vocab – 2 Oct', 'HSK 1'];
const toGo: Array<number | null> = [null, -1, 0, 1, 2, 9, 10, 41, 500];
const perDay = [0, 1, 2, 3, 5, 7, 200];
const hints = deckNames.flatMap((deck) =>
  toGo.flatMap((words) => perDay.map((n) => ({ n, deck, words, hint: budgetFinishHint(n, deck, words) }))),
);

writeFileSync(
  join(OUT, 'tutor-budget.json'),
  JSON.stringify({ summaries, days, firsts, infos, extra_infos: extraInfos, offsets, hints }),
);
