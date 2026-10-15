/**
 * Every clip a mini lesson can play, in ONE list (docs/AUDIO.md "Lesson audio prefetch"):
 * the default-voice texts each exercise speaks (Check / reveal / a tap / autoplay —
 * `exerciseTtsTexts`) and every conversation line in its speaker's voice at the resolved
 * speed / delivery (`resolveConversationAudio`). Read by
 * - both apps' background prefetch (the lessons the device will offer soon,
 *   `lessonsToPrefetch`) and the player's open-time prefetch (current exercise first,
 *   `orderClipsForPrefetch`), so the clip is on the device before Check is pressed;
 * - the server's pre-generation into R2 `tts-cache/` when a lesson is created / assigned /
 *   updated (worker services/lesson-audio.ts), so a device fetch is a cache hit, not a
 *   fresh TTS call.
 *
 * Pure; the Lab app's `core/…/LessonAudioClips.kt` is parity-tested against it
 * (android-lab/parity/fixtures/lesson-audio.ts).
 */
import { exerciseTtsTexts, type ConversationExerciseSpec, type CustomLessonSpec, type LessonExercise } from './types';
import type { ResolvedConversationAudio } from './conversationAudio';
import type { ConversationDelivery } from '../tts/conversation';

export type LessonClipKind = 'tts' | 'conversation';

export interface LessonAudioClip {
  /** 'tts' = the default lesson voice (`POST /api/practice/tts { text, speed }`); 'conversation' = a dialogue line. */
  kind: LessonClipKind;
  text: string;
  /** A conversation line's voice; undefined for 'tts' (the default lesson voice). */
  voice?: string;
  /** A conversation line's provider rate; undefined for 'tts' (the app's default speed). */
  speed?: number;
  /** A conversation line's delivery; undefined for 'tts'. */
  delivery?: ConversationDelivery;
  /** The exercise's position in the flattened lesson (sections in order, 0-based). */
  exercise: number;
}

/** How a conversation sounds on this account (voices per speaker, speed, delivery). */
export type ResolveConversationClips = (ex: ConversationExerciseSpec) => Pick<ResolvedConversationAudio, 'voices' | 'speed' | 'delivery'>;

/**
 * The clips ONE exercise plays, in the order it plays them. A conversation needs
 * `resolveConversation` (without it its lines are left out); blank texts are skipped.
 */
export function exerciseAudioClips(ex: LessonExercise, exercise: number, resolveConversation?: ResolveConversationClips): LessonAudioClip[] {
  if (ex.type === 'conversation') {
    if (!resolveConversation) return [];
    const audio = resolveConversation(ex);
    const out: LessonAudioClip[] = [];
    for (const line of ex.lines) {
      const voice = audio.voices[line.speaker];
      if (!line.hanzi.trim() || !voice) continue;
      out.push({ kind: 'conversation', text: line.hanzi, voice, speed: audio.speed, delivery: audio.delivery, exercise });
    }
    return out;
  }
  return exerciseTtsTexts(ex).filter((t) => t.trim()).map((text) => ({ kind: 'tts' as const, text, exercise }));
}

/** Every clip of a lesson, exercise by exercise (duplicates kept — `orderClipsForPrefetch` drops them). */
export function lessonAudioClips(spec: CustomLessonSpec, resolveConversation?: ResolveConversationClips): LessonAudioClip[] {
  const out: LessonAudioClip[] = [];
  let exercise = 0;
  for (const section of spec.sections) {
    for (const ex of section.exercises) {
      out.push(...exerciseAudioClips(ex, exercise, resolveConversation));
      exercise++;
    }
  }
  return out;
}

/** One clip's identity (what it sounds like): the same text in the same voice / speed / delivery is one clip. */
export function lessonClipId(clip: Pick<LessonAudioClip, 'kind' | 'text' | 'voice' | 'speed' | 'delivery'>): string {
  return `${clip.kind}|${clip.voice ?? ''}|${clip.speed === undefined ? '' : String(clip.speed)}|${clip.delivery ?? ''}|${clip.text}`;
}

/**
 * The order to fetch a lesson's clips in when it opens on exercise `current`: that exercise
 * first, then the ones after it in order, then the ones before it (a ← back / a replay) —
 * each distinct clip once, at its earliest place in that order.
 */
export function orderClipsForPrefetch(clips: readonly LessonAudioClip[], current: number = 0): LessonAudioClip[] {
  const ahead = clips.filter((c) => c.exercise >= current);
  const behind = clips.filter((c) => c.exercise < current);
  const seen = new Set<string>();
  const out: LessonAudioClip[] = [];
  for (const c of [...ahead, ...behind]) {
    const id = lessonClipId(c);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(c);
  }
  return out;
}

/** Distinct clips of a lesson (sync prefetch / server pre-generation), first exercise first. */
export function distinctLessonClips(spec: CustomLessonSpec, resolveConversation?: ResolveConversationClips): LessonAudioClip[] {
  return orderClipsForPrefetch(lessonAudioClips(spec, resolveConversation), 0);
}

/** New lessons (never finished, unlocked-or-unlockable aside) whose audio is fetched ahead of their day. */
export const UPCOMING_NEW_LESSONS_PREFETCH = 3;

export interface PrefetchLessonRow {
  id: string;
  created_at: string;
  /** Finishes so far (0 = new). */
  finishes: number;
  retired: boolean;
  /** shared/lesson/unlock.ts `lessonLockStatus`. */
  lock: 'none' | 'locked' | 'unlocked';
}

/**
 * Which lessons the background sync fetches audio for — the ones the device will offer soon:
 * today's lessons (`pickTodaysLessons`), every lesson with OPEN homework (a one-off pass is
 * never in today's rotation, so it was never prefetched — Jerome's homework lesson played each
 * clip seconds late, Oct 2026), the locked / unlocked lessons (often unlocked on the train, right
 * after their podcast) and the next few NEW lessons oldest first. Ids of lessons not on the
 * device are dropped; each id once, in that order.
 */
export function lessonsToPrefetch(input: {
  todays: readonly string[];
  homework: ReadonlyArray<{ kind: string; target_id: string; status: string }>;
  lessons: readonly PrefetchLessonRow[];
  upcomingNew?: number;
}): string[] {
  const byId = new Map(input.lessons.map((l) => [l.id, l]));
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (id: string) => {
    const row = byId.get(id);
    if (!row || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  };
  input.todays.forEach(add);
  for (const a of input.homework) if (a.kind === 'lesson' && a.status === 'active') add(a.target_id);
  for (const l of input.lessons) if (l.lock !== 'none' && !l.retired) add(l.id);
  const upcoming = input.lessons
    .filter((l) => l.lock === 'none' && !l.retired && l.finishes === 0 && !seen.has(l.id))
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, Math.max(0, input.upcomingNew ?? UPCOMING_NEW_LESSONS_PREFETCH));
  upcoming.forEach((l) => add(l.id));
  return out;
}

/** How a lesson's audio played this run (analytics `lesson.audio`): counts only. */
export interface LessonAudioStats {
  /** Clips played straight from the device. */
  hits: number;
  /** Clips that had to be fetched when asked for. */
  misses: number;
  /** Late clips dropped because the learner had moved on to another exercise. */
  stale: number;
  /** The longest wait for a missing clip (ms). */
  max_wait_ms: number;
}

export const EMPTY_LESSON_AUDIO_STATS: LessonAudioStats = { hits: 0, misses: 0, stale: 0, max_wait_ms: 0 };
