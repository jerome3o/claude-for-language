/**
 * The learner's daily new-card budget (across ALL decks), cached on the
 * device so the study queue works offline. The server copy lives on the user
 * row (`/api/auth/me` returns it; `PUT /api/profile/study-budget` changes it).
 */
import { DEFAULT_STUDY_BUDGET, type StudyBudget } from '@shared/decks';

const KEY = 'studyBudget';

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

export function writeStudyBudget(budget: Partial<StudyBudget> | null | undefined): void {
  if (!budget) return;
  const next: StudyBudget = {
    new_cards_per_day: clamp(budget.new_cards_per_day, DEFAULT_STUDY_BUDGET.new_cards_per_day),
    secondary_cards_per_day: clamp(budget.secondary_cards_per_day, DEFAULT_STUDY_BUDGET.secondary_cards_per_day),
  };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
}

function clamp(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : fallback;
}
