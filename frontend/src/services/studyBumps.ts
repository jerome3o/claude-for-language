/**
 * "⚡ Study it today" on the device (shared/decks/bumps.ts; CLAUDE.md "Study it today").
 *
 * A learner who tries to add a word they already have bumps it instead: the note's
 * cards come first in today's session (the shared queue rule). Offline-first:
 *   - a bump / clear is written to IndexedDB (`studyBumps`) at once with `pending`,
 *     so the queue and Home see it immediately, offline too;
 *   - it goes up straight away when online (POST /api/me/bumps with a client id,
 *     DELETE /api/me/bumps/:noteId — both idempotent), else in the next sync;
 *   - every sync replaces the server's rows whole (`bumps` on /api/sync/changes),
 *     keeping this device's pending rows on top.
 * Which cards are in the pocket and whether a bump is done is derived from the
 * local review events every time (never stored).
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { bumpedMessage, normalizeBumpSource, type BumpSource } from '@shared/decks';
import { normalizeHanzi } from '@shared/import/parse';
import { db, type LocalNote, type LocalStudyBump } from '../db/database';
export { bumpTimeMs, loadQueueBumps } from '../db/database';
import { addBumpsApi, clearBumpApi, listBumpsApi, type ApiStudyBump } from '../api/bumps';
import { track } from './analytics';

const online = () => typeof navigator === 'undefined' || navigator.onLine;

/** Rows the queue counts (not waiting to be cleared). */
async function activeRows(): Promise<LocalStudyBump[]> {
  return (await db.studyBumps.toArray()).filter((b) => b.pending !== 'clear');
}

/** note id → its bump row (pending clears left out), live. */
export function useBumps(): Map<string, LocalStudyBump> {
  const rows = useLiveQuery(() => activeRows(), []) ?? [];
  return new Map(rows.map((r) => [r.note_id, r]));
}

/** The user's notes with this hanzi (punctuation / spaces ignored), every deck, with the deck name. */
export async function findExistingNotes(hanzi: string): Promise<Array<{ note: LocalNote; deckName: string }>> {
  const key = normalizeHanzi(hanzi);
  if (!key) return [];
  const notes = await db.notes.filter((n) => normalizeHanzi(n.hanzi ?? '') === key).toArray();
  if (notes.length === 0) return [];
  const decks = await db.decks.bulkGet([...new Set(notes.map((n) => n.deck_id))]);
  const names = new Map(decks.filter(Boolean).map((d) => [d!.id, d!.name]));
  return notes.filter((n) => names.has(n.deck_id)).map((note) => ({ note, deckName: names.get(note.deck_id)! }));
}

export interface BumpOutcome {
  added: string[];
  already: string[];
  message: string;
}

/**
 * Bump notes now (local at once, uploaded when online). Returns the toast line.
 * `hanziById` lets callers name words they already have in hand.
 */
export async function bumpNotes(noteIds: string[], source: BumpSource, hanziById?: Map<string, string>): Promise<BumpOutcome> {
  const ids = [...new Set(noteIds.filter(Boolean))];
  const now = new Date().toISOString();
  const added: string[] = [];
  const already: string[] = [];
  await db.transaction('rw', db.studyBumps, async () => {
    for (const noteId of ids) {
      const row = await db.studyBumps.where('note_id').equals(noteId).first();
      if (row && row.pending !== 'clear') {
        already.push(noteId);
        continue;
      }
      if (row) await db.studyBumps.delete(row.id);
      await db.studyBumps.put({ id: crypto.randomUUID(), note_id: noteId, created_at: now, source, bumped_by_name: null, pending: 'add' });
      added.push(noteId);
    }
  });
  const names = async (list: string[]) => {
    const notes = await db.notes.bulkGet(list);
    return list.map((id, i) => hanziById?.get(id) ?? notes[i]?.hanzi ?? '').filter(Boolean);
  };
  track('study.bump_added', { source, count: added.length, already: already.length });
  if (added.length && online()) void flushPendingBumps().catch(() => undefined);
  return { added, already, message: bumpedMessage(await names(added), already.length) };
}

/** Take a note out of today's pocket (local at once). */
export async function clearBump(noteId: string, source: BumpSource = 'other'): Promise<void> {
  await db.transaction('rw', db.studyBumps, async () => {
    const rows = await db.studyBumps.where('note_id').equals(noteId).toArray();
    for (const r of rows) {
      if (r.pending === 'add') await db.studyBumps.delete(r.id);
      else await db.studyBumps.update(r.id, { pending: 'clear' });
    }
  });
  track('study.bump_cleared', { source: normalizeBumpSource(source) });
  if (online()) void flushPendingBumps().catch(() => undefined);
}

let flushing: Promise<void> | null = null;

/** Send every pending add / clear; then take the server's list. Single-flight. */
export function flushPendingBumps(): Promise<void> {
  if (!flushing) {
    flushing = doFlush().finally(() => {
      flushing = null;
    });
  }
  return flushing;
}

async function doFlush(): Promise<void> {
  const pending = (await db.studyBumps.toArray()).filter((b) => b.pending);
  if (pending.length === 0) return;
  let latest: ApiStudyBump[] | null = null;
  const adds = pending.filter((b) => b.pending === 'add');
  if (adds.length) {
    const r = await addBumpsApi(adds.map((b) => ({ id: b.id, note_id: b.note_id, created_at: b.created_at, source: b.source })));
    latest = r.bumps ?? null;
    await db.transaction('rw', db.studyBumps, async () => {
      for (const b of adds) {
        const now = await db.studyBumps.get(b.id);
        if (now?.pending === 'add') await db.studyBumps.update(b.id, { pending: null });
      }
    });
  }
  for (const b of pending.filter((x) => x.pending === 'clear')) {
    const r = await clearBumpApi(b.note_id);
    latest = r.bumps ?? latest;
    const now = await db.studyBumps.get(b.id);
    if (now?.pending === 'clear') await db.studyBumps.delete(b.id);
  }
  if (latest) await replaceLocalBumps(latest);
}

/** The server's active list replaces the synced rows; this device's pending rows win. */
export async function replaceLocalBumps(server: ApiStudyBump[]): Promise<void> {
  await db.transaction('rw', db.studyBumps, async () => {
    const local = await db.studyBumps.toArray();
    const pendingNotes = new Set(local.filter((b) => b.pending).map((b) => b.note_id));
    const stale = local.filter((b) => !b.pending).map((b) => b.id);
    if (stale.length) await db.studyBumps.bulkDelete(stale);
    const rows: LocalStudyBump[] = server
      .filter((b) => !pendingNotes.has(b.note_id))
      .map((b) => ({ id: b.id, note_id: b.note_id, created_at: b.created_at, source: b.source, bumped_by_name: b.bumped_by_name ?? null, pending: null }));
    if (rows.length) await db.studyBumps.bulkPut(rows);
  });
}

/** Sync: upload what's pending (never throws). The list itself comes with /sync/changes. */
export async function uploadPendingBumps(): Promise<void> {
  try {
    await flushPendingBumps();
  } catch (err) {
    console.error('[Bumps] upload failed:', err);
  }
}

/** Full sync: pending up, then the whole list down (never throws). */
export async function syncBumps(): Promise<void> {
  await uploadPendingBumps();
  try {
    const { bumps } = await listBumpsApi();
    if (Array.isArray(bumps)) await replaceLocalBumps(bumps);
  } catch (err) {
    console.error('[Bumps] sync failed:', err);
  }
}

/**
 * The learner's notes that appear in a sentence (the Coach's "⚡ Study today" chip):
 * the whole sentence itself, or any note of 2+ characters inside it (single
 * characters would match nearly everything). Punctuation / spaces ignored; ≤ 10.
 */
export async function findNotesInText(text: string): Promise<LocalNote[]> {
  const whole = normalizeHanzi(text);
  if (!whole) return [];
  const notes = await db.notes
    .filter((n) => {
      const key = normalizeHanzi(n.hanzi ?? '');
      return !!key && (key === whole || (key.length >= 2 && whole.includes(key)));
    })
    .toArray();
  const live = new Set((await db.decks.toArray()).map((d) => d.id));
  return notes.filter((n) => live.has(n.deck_id)).slice(0, 10);
}
