/**
 * Feedback while listening (docs/AUDIO_LESSONS.md "Feedback while listening"): every "Too hard" and back /
 * next a section in the audio-lesson player is an event (shared/audio-lesson/feedback.ts) written to this
 * small IndexedDB first — so it is never lost on the train — then posted at once when online and by every
 * sync (`flushAudioLessonFeedback`). The server is idempotent by event id. Uploaded events are kept (marked)
 * so the transcript can show which lines were flagged on this device.
 *
 * Also the player's Media Session wiring for ⏮ / ⏭ (`feedbackMediaHandlers`): previous track = back a
 * section, next track = next section. The browser has no custom lock-screen actions, so "Too hard" is a
 * button in the player.
 */
import Dexie, { type Table } from 'dexie';
import {
  backSectionTarget,
  buildFeedbackEvent,
  flaggedRowIndex,
  nextSectionTarget,
  MAX_FEEDBACK_EVENTS_PER_REQUEST,
  type AudioLessonFeedbackEvent,
  type AudioLessonFeedbackKind,
  type AudioLessonFeedbackWhere,
} from '@shared/audio-lesson/feedback';
import { previousChapterTarget, type TranscriptRow } from '@shared/audio-lesson/timeline';
import type { AudioLessonChapter } from '@shared/audio-lesson/types';
import { postAudioLessonFeedback } from '../api/audioLessons';
import { track } from './analytics';

export interface StoredFeedbackEvent extends AudioLessonFeedbackEvent {
  /** 0 = waiting to upload, 1 = uploaded (or refused for good). */
  uploaded: 0 | 1;
}

class FeedbackDb extends Dexie {
  events!: Table<StoredFeedbackEvent, string>;
  constructor() {
    super('audio-lesson-feedback');
    this.version(1).stores({ events: 'id, audio_lesson_id, uploaded' });
  }
}

let dbInstance: FeedbackDb | null = null;
function fdb(): FeedbackDb {
  if (!dbInstance) dbInstance = new FeedbackDb();
  return dbInstance;
}

export async function __resetAudioLessonFeedbackForTests(): Promise<void> {
  await fdb().events.clear();
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `fb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export async function listFeedbackEvents(lessonId?: string): Promise<StoredFeedbackEvent[]> {
  const all = lessonId ? await fdb().events.where('audio_lesson_id').equals(lessonId).toArray() : await fdb().events.toArray();
  return all.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** The transcript rows flagged "Too hard" on this device (the 😵 dot). */
export async function tooHardRows(lessonId: string): Promise<Set<number>> {
  const rows = new Set<number>();
  for (const e of await listFeedbackEvents(lessonId)) {
    if (e.kind !== 'too_hard') continue;
    const i = flaggedRowIndex(e);
    if (i !== null) rows.add(i);
  }
  return rows;
}

let flushing: Promise<{ sent: number; failed: number }> | null = null;

/**
 * Posts every waiting event, a lesson at a time (≤ 100 per request). A network failure keeps them for the
 * next try; a refusal (4xx — e.g. the lesson was deleted) marks them done so they never block the queue.
 */
export function flushAudioLessonFeedback(post = postAudioLessonFeedback): Promise<{ sent: number; failed: number }> {
  if (flushing) return flushing;
  flushing = (async () => {
    let sent = 0;
    let failed = 0;
    const waiting = await fdb().events.where('uploaded').equals(0).toArray();
    const byLesson = new Map<string, StoredFeedbackEvent[]>();
    for (const e of waiting) byLesson.set(e.audio_lesson_id, [...(byLesson.get(e.audio_lesson_id) ?? []), e]);
    for (const [lessonId, events] of byLesson) {
      for (let i = 0; i < events.length; i += MAX_FEEDBACK_EVENTS_PER_REQUEST) {
        const batch = events.slice(i, i + MAX_FEEDBACK_EVENTS_PER_REQUEST);
        try {
          await post(lessonId, batch.map(({ uploaded: _u, ...e }) => e));
          sent += batch.length;
        } catch (err) {
          const status = (err as { status?: number }).status;
          if (status === undefined || status >= 500 || status === 408 || status === 429) return { sent, failed };
          failed += batch.length;
        }
        await fdb().events.bulkPut(batch.map((e) => ({ ...e, uploaded: 1 as const })));
      }
    }
    return { sent, failed };
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

/** Writes one event on the device and posts it when online (never throws). */
export async function recordAudioLessonFeedback(event: AudioLessonFeedbackEvent, online = typeof navigator === 'undefined' || navigator.onLine): Promise<void> {
  try {
    await fdb().events.put({ ...event, uploaded: 0 });
  } catch (err) {
    console.error('[audio-lesson-feedback] could not save', err);
    return;
  }
  if (online) void flushAudioLessonFeedback().catch(() => {});
}

export interface FeedbackPlayer {
  lessonId: string;
  format: string;
  audioVersion: string | null;
  rows: ReadonlyArray<TranscriptRow>;
  chapters: ReadonlyArray<AudioLessonChapter>;
  /** Where the audio is now (ms). */
  position: () => number;
  speed: () => number;
  seekTo: (ms: number) => void;
}

function record(p: FeedbackPlayer, kind: AudioLessonFeedbackKind, where: AudioLessonFeedbackWhere, positionMs: number): AudioLessonFeedbackEvent {
  const event = buildFeedbackEvent({
    id: newId(), lessonId: p.lessonId, kind, where, positionMs, speed: p.speed(), audioVersion: p.audioVersion,
    createdAt: new Date().toISOString(), rows: p.rows, chapters: p.chapters,
  });
  void recordAudioLessonFeedback(event);
  return event;
}

/** "Too hard": noted where the audio is; playing carries on. */
export function tooHard(p: FeedbackPlayer, where: AudioLessonFeedbackWhere): AudioLessonFeedbackEvent {
  const e = record(p, 'too_hard', where, p.position());
  track('audio_lesson.too_hard', { format: p.format, where });
  return e;
}

/** Back a section: the line playing from its start, or the one before within 2 s of listening; no transcript → previous chapter. */
export function backSection(p: FeedbackPlayer, where: AudioLessonFeedbackWhere): AudioLessonFeedbackEvent | null {
  const at = p.position();
  const jump = backSectionTarget(p.rows, at, p.speed());
  if (!jump) {
    p.seekTo(previousChapterTarget(p.chapters as AudioLessonChapter[], at));
    return null;
  }
  const e = record(p, jump.kind, where, at);
  p.seekTo(jump.target_ms);
  track('audio_lesson.back_section', { format: p.format, where, kind: jump.kind });
  return e;
}

/** Next section: the start of the next line (nothing after the last). */
export function nextSection(p: FeedbackPlayer, where: AudioLessonFeedbackWhere): AudioLessonFeedbackEvent | null {
  const at = p.position();
  const jump = nextSectionTarget(p.rows, at);
  if (!jump) return null;
  const e = record(p, 'skip', where, at);
  p.seekTo(jump.target_ms);
  track('audio_lesson.next_section', { format: p.format, where });
  return e;
}

/**
 * The Media Session's ⏮ / ⏭ (lock screen, notification, headphones — the browser doesn't say which:
 * recorded as `lock_screen` while the page is hidden, else `notification`).
 */
export function feedbackMediaHandlers(p: () => FeedbackPlayer | null): Array<[MediaSessionAction, MediaSessionActionHandler]> {
  const where = (): AudioLessonFeedbackWhere => (typeof document !== 'undefined' && document.visibilityState === 'hidden' ? 'lock_screen' : 'notification');
  return [
    ['previoustrack', () => { const player = p(); if (player) backSection(player, where()); }],
    ['nexttrack', () => { const player = p(); if (player) nextSection(player, where()); }],
  ];
}
