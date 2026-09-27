/**
 * Ghost decks: decks this device still holds that the server no longer has.
 *
 * Deletions normally travel as tombstones (`deleted_items`, migration 0068),
 * but a deck deleted before tombstones existed — or by any path that wrote
 * none — was never announced, and an incremental sync only ever ADDS decks.
 * Only a full sync (first launch / empty IndexedDB) replaced the list, so such
 * a deck stayed on the home page for good ("I deleted it and it's still there").
 *
 * `/api/sync/changes` now returns every deck id the account has
 * (`live_deck_ids`) and when that list was taken (`live_deck_ids_at`). A local
 * deck missing from it is a ghost — unless it was created after the list was
 * taken (a deck made on this device while the sync request was in flight), so
 * decks newer than the snapshot, minus a margin for clock rounding, are kept.
 */

/** Seconds of slack around the server snapshot (created_at has 1 s resolution). */
const SNAPSHOT_MARGIN_MS = 60_000;

/** A SQLite `YYYY-MM-DD HH:MM:SS` (UTC) or ISO timestamp → epoch ms, NaN if unreadable. */
export function parseServerTime(value: string | null | undefined): number {
  if (!value) return NaN;
  const iso = value.includes('T') ? value : value.replace(' ', 'T');
  const withZone = /[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`;
  return Date.parse(withZone);
}

export function findGhostDecks(
  localDecks: Array<{ id: string; created_at?: string | null }>,
  liveDeckIds: string[],
  liveDeckIdsAt: string | null | undefined,
): string[] {
  const live = new Set(liveDeckIds);
  const snapshot = parseServerTime(liveDeckIdsAt);
  if (Number.isNaN(snapshot)) return [];
  return localDecks
    .filter((deck) => {
      if (live.has(deck.id)) return false;
      const created = parseServerTime(deck.created_at);
      // Unknown age: can't prove it predates the snapshot — keep it.
      if (Number.isNaN(created)) return false;
      return created < snapshot - SNAPSHOT_MARGIN_MS;
    })
    .map((deck) => deck.id);
}
