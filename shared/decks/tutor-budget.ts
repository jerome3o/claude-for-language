/**
 * The daily new-card budget as the tutor and the learner both see it: who set it,
 * and the words both sides read (tutor's "Daily new cards" row and sheet, the chat
 * message the tutor's change posts, the learner's Settings "Set by …" line).
 *
 * The budget itself is shared/decks/budget.ts; this file is only presentation and
 * the one shape (`StudyBudgetInfo`) the API returns on /auth/me, /sync/changes, the
 * tutor's student overview and GET|PUT /relationships/:relId/student-study-budget.
 * Ported to the Lab app (core/…/TutorBudget.kt), parity-tested.
 */
import { DEFAULT_STUDY_BUDGET, daysToIntroduce, type StudyBudget } from './budget';

export interface StudyBudgetInfo extends StudyBudget {
  /** Nothing set: both numbers are DEFAULT_STUDY_BUDGET (the user row's columns are NULL). */
  is_default: boolean;
  /** Who last changed it (users.study_budget_set_by) — null when never changed. */
  set_by_id: string | null;
  set_by_name: string | null;
  /** Someone other than the learner (their tutor) set the current numbers. */
  set_by_tutor: boolean;
  /** When (server ISO time). */
  set_at: string | null;
}

/** The user-row columns `studyBudgetInfo` reads. */
export interface StudyBudgetRow {
  new_cards_per_day?: number | null;
  secondary_cards_per_day?: number | null;
  study_budget_set_by?: string | null;
  study_budget_set_at?: string | null;
  /** users.name of study_budget_set_by (joined). */
  study_budget_set_by_name?: string | null;
}

export function studyBudgetInfo(row: StudyBudgetRow | null | undefined, ownerId: string): StudyBudgetInfo {
  const p = row?.new_cards_per_day;
  const s = row?.secondary_cards_per_day;
  const setBy = row?.study_budget_set_by ?? null;
  return {
    new_cards_per_day: p ?? DEFAULT_STUDY_BUDGET.new_cards_per_day,
    secondary_cards_per_day: s ?? DEFAULT_STUDY_BUDGET.secondary_cards_per_day,
    is_default: (p === null || p === undefined) && (s === null || s === undefined),
    set_by_id: setBy,
    set_by_name: setBy ? row?.study_budget_set_by_name ?? null : null,
    set_by_tutor: !!setBy && setBy !== ownerId,
    set_at: row?.study_budget_set_at ?? null,
  };
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "3 new words + 6 extra a day" — the tutor's row and the dashboard chip. */
export function budgetSummary(b: StudyBudget): string {
  return `${plural(b.new_cards_per_day, 'new word', 'new words')} + ${b.secondary_cards_per_day} extra a day`;
}

/**
 * The chat message the tutor's change posts as her (so the learner sees it, with the
 * unread badge and the push): "I've set your new cards to 5 a day (+10 extra) 📚".
 */
export function budgetChangeMessage(b: StudyBudget, isDefault: boolean): string {
  const extra = b.secondary_cards_per_day > 0 ? ` (+${b.secondary_cards_per_day} extra)` : ' (no extra cards)';
  return isDefault
    ? `I've set your new cards back to the usual ${b.new_cards_per_day} a day${extra} 📚`
    : `I've set your new cards to ${b.new_cards_per_day} a day${extra} 📚`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "3 Oct" of an ISO time in a zone given as Date.getTimezoneOffset() minutes. */
export function shortDay(iso: string, tzOffsetMinutes: number): string | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t - tzOffsetMinutes * 60_000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** First word of a name ("Minghui Wang" → "Minghui"); "your tutor" when there is none. */
export function firstName(name: string | null | undefined): string {
  const first = (name ?? '').trim().split(/\s+/)[0];
  return first || 'your tutor';
}

/**
 * The learner's Settings line under "New cards a day" while the numbers are the
 * tutor's: "Set by Minghui · 3 Oct". Null when the learner set them (or nobody did).
 */
export function budgetSetByLabel(info: Pick<StudyBudgetInfo, 'set_by_tutor' | 'set_by_name' | 'set_at'> | null | undefined, tzOffsetMinutes: number): string | null {
  if (!info?.set_by_tutor) return null;
  const day = info.set_at ? shortDay(info.set_at, tzOffsetMinutes) : null;
  return day ? `Set by ${firstName(info.set_by_name)} · ${day}` : `Set by ${firstName(info.set_by_name)}`;
}

/**
 * The tutor sheet's live hint for the deck at the top of the learner's queue:
 * "At 5 a day, Lesson vocab – 2 Oct finishes in ~9 days". Null when there is no
 * such deck or nothing left to introduce.
 */
export function budgetFinishHint(newPerDay: number, deckName: string | null | undefined, wordsToGo: number | null | undefined): string | null {
  if (!deckName || !wordsToGo || wordsToGo <= 0) return null;
  if (newPerDay <= 0) return `At 0 a day, no new words from ${deckName} are introduced`;
  const days = daysToIntroduce(wordsToGo, { new_cards_per_day: newPerDay });
  return `At ${newPerDay} a day, ${deckName} finishes in ~${plural(days, 'day', 'days')}`;
}
