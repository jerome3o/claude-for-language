/**
 * The homework pass's "⚡ Study it today" (docs/HOMEWORK.md §3c) — now the ONE rule every ⚡ follows,
 * shared/decks/study-today.ts. These names stay for the pass and the Lab's PassBump.kt.
 */
import {
  studyTodayHint, studyTodayKindOfRow, studyTodayLabel, studyTodayPlan,
  type StudyTodayInput, type StudyTodayKind, type StudyTodayPlan,
} from '../decks/study-today';

export type PassBumpKind = StudyTodayKind;
export type PassBumpPlan = StudyTodayPlan;
export type PassBumpInput = StudyTodayInput;

export const passBumpPlan = studyTodayPlan;
export const passBumpLabel = studyTodayLabel;
export const passBumpHint = studyTodayHint;
export const passBumpKindOfRow = studyTodayKindOfRow;
