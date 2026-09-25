/**
 * Flag a card for the tutor — offline-first.
 *
 * The flag is written to IndexedDB first (`pendingCardFlags`) with a client
 * id, posted at once when online, and otherwise by the next sync
 * (`uploadPendingCardFlags`). The server keeps the same id, so re-posting is
 * safe. The list of human tutors is mirrored to localStorage so the study
 * screen can offer "Flag for tutor" without a network round trip.
 */

import { db, LocalPendingCardFlag } from '../db/database';
import { createCardFlag } from '../api/cardFlags';
import { CLAUDE_AI_USER_ID, getOtherUserInRelationship, type TutorRelationshipWithUsers } from '../types';

const TUTORS_KEY = 'card-flags:tutors';

export interface RememberedTutor {
  relationship_id: string;
  name: string;
}

/** Human tutors from a relationships list (Claude's practice relationship is not a tutor you can flag to). */
export function humanTutors(tutors: TutorRelationshipWithUsers[], myId: string): RememberedTutor[] {
  return tutors
    .filter((rel) => rel.status === 'active')
    .map((rel) => ({ rel, other: getOtherUserInRelationship(rel, myId) }))
    .filter(({ other }) => other.id !== CLAUDE_AI_USER_ID)
    .map(({ rel, other }) => ({ relationship_id: rel.id, name: other.name || other.email || 'your tutor' }));
}

export function rememberTutors(tutors: RememberedTutor[]): void {
  try {
    localStorage.setItem(TUTORS_KEY, JSON.stringify(tutors));
  } catch {
    // Storage unavailable — the online list still works.
  }
}

export function getRememberedTutors(): RememberedTutor[] {
  try {
    const raw = localStorage.getItem(TUTORS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t): t is RememberedTutor => !!t && typeof t === 'object' && typeof (t as RememberedTutor).relationship_id === 'string'
    );
  } catch {
    return [];
  }
}

export interface QueueCardFlagInput {
  relationship_id: string;
  tutor_name: string | null;
  note_id: string;
  card_id: string | null;
  hanzi: string;
  message: string;
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `flag-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function post(flag: LocalPendingCardFlag): Promise<void> {
  await createCardFlag({
    id: flag.id,
    relationship_id: flag.relationship_id,
    note_id: flag.note_id,
    card_id: flag.card_id,
    message: flag.message,
    created_at: flag.created_at,
  });
  await db.pendingCardFlags.delete(flag.id);
}

/**
 * Save the flag locally, then try to send it right away. Resolves with
 * `sent: true` when the server has it, `false` when it is queued for sync.
 */
export async function queueCardFlag(input: QueueCardFlagInput): Promise<{ id: string; sent: boolean }> {
  const flag: LocalPendingCardFlag = {
    id: newId(),
    relationship_id: input.relationship_id,
    tutor_name: input.tutor_name,
    note_id: input.note_id,
    card_id: input.card_id,
    hanzi: input.hanzi,
    message: input.message.trim(),
    created_at: new Date().toISOString(),
    _synced: 0,
  };
  await db.pendingCardFlags.put(flag);
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    try {
      await post(flag);
      return { id: flag.id, sent: true };
    } catch (err) {
      await db.pendingCardFlags.update(flag.id, { error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { id: flag.id, sent: false };
}

/** Sync: post every queued flag; each is deleted once the server has it. */
export async function uploadPendingCardFlags(): Promise<{ uploaded: number; errors: string[] }> {
  const pending = await db.pendingCardFlags.orderBy('created_at').toArray();
  let uploaded = 0;
  const errors: string[] = [];
  for (const flag of pending) {
    try {
      await post(flag);
      uploaded++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(message);
      await db.pendingCardFlags.update(flag.id, { error: message });
    }
  }
  return { uploaded, errors };
}

/** Flags on one note still waiting to go up (so the sheet can say "already flagged, sending when online"). */
export async function pendingFlagsForNote(noteId: string): Promise<LocalPendingCardFlag[]> {
  return db.pendingCardFlags.where('note_id').equals(noteId).toArray();
}
