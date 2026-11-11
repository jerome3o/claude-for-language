/**
 * Per-deck "+10 more" new-card bonuses are persisted in localStorage, keyed by
 * deck (or "all") and STUDY day (services/studyDay.ts: the account's "New day
 * starts at", 4 am by default) so they reset each day — not at midnight.
 */
import { studyToday } from '../services/studyDay';

export function bonusKey(deckId: string | undefined): string {
  return `bonusNewCards_${deckId || 'all'}_${studyToday()}`;
}

export function readBonus(deckId: string | undefined): number {
  try {
    return parseInt(localStorage.getItem(bonusKey(deckId)) || '0', 10) || 0;
  } catch {
    return 0;
  }
}

export function writeBonus(deckId: string | undefined, value: number): void {
  localStorage.setItem(bonusKey(deckId), String(value));
}
