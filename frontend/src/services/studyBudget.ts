/**
 * The learner's daily new-card budget (across ALL decks), cached on the
 * device so the study queue works offline. The server copy lives on the user
 * row (`/api/auth/me` returns it; `PUT /api/profile/study-budget` changes it;
 * the tutor can change it too, and `/api/sync/changes` carries it, so the
 * tutor's numbers reach this device on the next sync the same day).
 */
import { DEFAULT_STUDY_BUDGET, type StudyBudget, type StudyBudgetInfo } from '@shared/decks';

const KEY = 'studyBudget';
const INFO_KEY = 'studyBudgetInfo';
/** Fired on window when the mirror changed (AuthContext patches the user, Home recounts). */
export const STUDY_BUDGET_CHANGED = 'study-budget-changed';

export function readStudyBudget(): StudyBudget {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StudyBudget>;
      return {
        new_cards_per_day: clamp(parsed.new_cards_per_day, DEFAULT_STUDY_BUDGET.new_cards_per_day),
        secondary_cards_per_day: clamp(parsed.secondary_cards_per_day, DEFAULT_STUDY_BUDGET.secondary_cards_per_day),
      };
    }
  } catch { /* storage unavailable */ }
  return { ...DEFAULT_STUDY_BUDGET };
}

/** Who set the cached budget (null before the server said). */
export function readStudyBudgetInfo(): StudyBudgetInfo | null {
  try {
    const raw = localStorage.getItem(INFO_KEY);
    if (raw) return { ...(JSON.parse(raw) as StudyBudgetInfo), ...readStudyBudget() };
  } catch { /* storage unavailable */ }
  return null;
}

/** Store the server's budget (a StudyBudgetInfo, or a user from /auth/me carrying `study_budget`). */
export function writeStudyBudget(budget: (Partial<StudyBudget> & { study_budget?: StudyBudgetInfo | null }) | Partial<StudyBudgetInfo> | null | undefined): void {
  if (!budget) return;
  const info = ('study_budget' in budget && budget.study_budget) || ('is_default' in budget ? (budget as StudyBudgetInfo) : null);
  const src = info ?? budget;
  const next: StudyBudget = {
    new_cards_per_day: clamp(src.new_cards_per_day, DEFAULT_STUDY_BUDGET.new_cards_per_day),
    secondary_cards_per_day: clamp(src.secondary_cards_per_day, DEFAULT_STUDY_BUDGET.secondary_cards_per_day),
  };
  let changed = false;
  try {
    const before = localStorage.getItem(KEY);
    const nextRaw = JSON.stringify(next);
    localStorage.setItem(KEY, nextRaw);
    changed = before !== nextRaw;
    if (info) {
      const beforeInfo = localStorage.getItem(INFO_KEY);
      const infoRaw = JSON.stringify(info);
      localStorage.setItem(INFO_KEY, infoRaw);
      changed = changed || beforeInfo !== infoRaw;
    }
  } catch { /* storage unavailable */ }
  if (changed && typeof window !== 'undefined') {
    try { window.dispatchEvent(new CustomEvent(STUDY_BUDGET_CHANGED, { detail: info ?? next })); } catch { /* no window events */ }
  }
}

function clamp(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : fallback;
}
