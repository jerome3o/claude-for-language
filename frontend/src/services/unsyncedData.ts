/**
 * What hasn't reached the server from this browser yet (shared/auth/session.ts `UnsyncedCounts`):
 * asked before Settings → Sign out and before a DIFFERENT account replaces the local data
 * (components/auth/AccountGuards.tsx). Each store is counted on its own; one that can't be read
 * counts as 0 rather than blocking the question.
 */
import type { UnsyncedCounts } from '@shared/auth/session';
import { db } from '../db/database';
import { pendingOutboxCount } from './chatOutbox';
import { pendingFeedbackCount } from './feedback';

async function safe(n: () => Promise<number>): Promise<number> {
  try {
    return await n();
  } catch {
    return 0;
  }
}

export async function countUnsynced(): Promise<UnsyncedCounts> {
  const [events, readerEvents, lessonEvents, recordings, lessonMedia, callUploads, flags, homework, deletions, upNextOps, chat, feedback] = await Promise.all([
    safe(() => db.reviewEvents.where('_synced').equals(0).count()),
    safe(() => db.readerReviewEvents.filter((e) => e._synced === 0).count()),
    safe(() => db.customLessonCompletionEvents.filter((e) => e._synced === 0).count()),
    safe(() => db.pendingRecordings.filter((r) => !r.uploaded).count()),
    safe(() => db.lessonAttemptMedia.filter((m) => m._synced === 0).count()),
    safe(() => db.callUploads.count()),
    safe(() => db.pendingCardFlags.filter((f) => f._synced === 0).count()),
    safe(() => db.homeworkEvents.where('_synced').equals(0).count()),
    safe(() => db.pendingReviewDeletions.count()),
    safe(() => db.upNextOps.count()),
    safe(() => pendingOutboxCount()),
    safe(() => pendingFeedbackCount()),
  ]);
  return {
    reviews: events + readerEvents + lessonEvents,
    recordings: recordings + lessonMedia + (callUploads > 0 ? 1 : 0),
    other: flags + homework + deletions + upNextOps + chat + feedback,
  };
}
