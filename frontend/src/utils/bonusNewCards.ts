/**
 * Per-deck "+10 more" new-card bonuses are persisted in localStorage, keyed by
 * deck (or "all") and date so they reset each day.
 */

export function bonusKey(deckId: string | undefined): string {
  return `bonusNewCards_${deckId || 'all'}_${new Date().toISOString().slice(0, 10)}`;
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
