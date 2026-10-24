/**
 * How a clip plays (both apps; the Lab port Clips.kt is parity-tested): the scene timeline,
 * the progress segments, what each scene says aloud (its `voice`, or — without one — its own
 * Chinese: a story's lines in one voice per speaker, a list's items, a sentence / big word),
 * the voices and the TTS text, the pictures, and where a story bubble sits.
 *
 * Playback rules (docs/CLIPS.md "Player"): a scene shows for its duration_ms, but the clock
 * HOLDS at the scene's end while its audio is still playing (a scene stretches to its voice);
 * an interactive scene (quiz, listen, order, reveal, speak) stops the clock until the learner
 * answers or skips (playback.ts) and then shows the answer; after the last scene the end card.
 */
import { LESSON_VOICE_POOLS } from '../lesson/voices';
import type { ClipScene, ClipSpec, ClipStoryLine, ClipVoiceName, ClipLang } from './types';

/** How long the explanation shows after a quiz answer before the clip moves on. */
export const QUIZ_REVEAL_MS = 2500;
/** The pause between two spoken lines of one scene. */
export const CLIP_LINE_GAP_MS = 250;
/** Practice-TTS speed of every clip line (the app's stored-clip speed: the same R2 / device keys). */
export const CLIP_TTS_SPEED = 0.6;
/** A double tap = two taps within this (ms) and CLIP_DOUBLE_TAP_PX of each other. */
export const CLIP_DOUBLE_TAP_MS = 300;
export const CLIP_DOUBLE_TAP_PX = 60;
/** A press held this long opens Learn more. */
export const CLIP_LONG_PRESS_MS = 550;

export interface ClipSegment {
  index: number;
  layout: ClipScene['layout'];
  start_ms: number;
  end_ms: number;
}

/** The scenes on the nominal timeline (durations only). */
export function clipTimeline(spec: Pick<ClipSpec, 'scenes'>): ClipSegment[] {
  let at = 0;
  return spec.scenes.map((s, index) => {
    const seg = { index, layout: s.layout, start_ms: at, end_ms: at + s.duration_ms };
    at += s.duration_ms;
    return seg;
  });
}

/** The nominal length (the sum of the scenes; a voice may stretch a scene, a quiz waits). */
export function clipDurationMs(spec: Pick<ClipSpec, 'scenes'>): number {
  return spec.scenes.reduce((sum, s) => sum + s.duration_ms, 0);
}

/** "0:34". */
export function formatClipDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The progress bar: one fill (0–1) per scene, given the scene on screen and the time spent in
 * it. Scenes before are full, after are empty; `sceneIndex` = scenes.length = the end card
 * (all full).
 */
export function clipProgressSegments(spec: Pick<ClipSpec, 'scenes'>, sceneIndex: number, elapsedMs: number): number[] {
  return spec.scenes.map((s, i) => {
    if (i < sceneIndex) return 1;
    if (i > sceneIndex) return 0;
    return Math.max(0, Math.min(1, elapsedMs / s.duration_ms));
  });
}

// ---------- Speech ----------

export interface ClipUtterance {
  scene: number;
  /** -1 = the scene's own `voice`; else the line / item it reads. */
  line: number;
  /** Exactly what TTS is asked for (clipTtsText applied). */
  text: string;
  lang: ClipLang;
  /** The practice-TTS voice id; null = the app's default voice (no voice_id sent). */
  voice_id: string | null;
}

/**
 * The voice of each named voice. teacher = the app voice (no voice_id); female / male / narrator
 * = the first default-on lesson voices (News Anchor, Male Announcer, Audiobook narrator).
 */
export const CLIP_VOICE_IDS: Record<ClipVoiceName, string | null> = {
  teacher: null,
  female: LESSON_VOICE_POOLS.female[0] ?? null,
  male: LESSON_VOICE_POOLS.male[0] ?? null,
  narrator: 'audiobook_male_1',
};

/** Story speakers in turn: female, male, then the next voices of each pool. */
const SPEAKER_VOICES: Array<string | null> = [
  LESSON_VOICE_POOLS.female[0],
  LESSON_VOICE_POOLS.male[0],
  LESSON_VOICE_POOLS.female[1],
  LESSON_VOICE_POOLS.male[1],
  LESSON_VOICE_POOLS.female[2],
  LESSON_VOICE_POOLS.male[2],
].map((v) => v ?? null);

const NARRATOR_LABELS = new Set(['旁白', 'narrator', '解说', '画外音']);

/** A story speaker label that means the narrator (centred, the narrator's voice). */
export function isNarratorSpeaker(speaker: string | null | undefined): boolean {
  return !!speaker && NARRATOR_LABELS.has(speaker.trim().toLowerCase());
}

/** The text TTS is given: " / " between alternatives becomes a pause (i人 / e人 → i人，e人); spaces tidied. */
export function clipTtsText(text: string): string {
  return text
    .replace(/\s*[/／]\s*/g, '，')
    .replace(/\s+/g, ' ')
    .trim();
}

export type StorySide = 'left' | 'right' | 'center';

export interface StoryCast {
  /** Per line: where its bubble sits. */
  sides: StorySide[];
  /** Per line: its voice id (null = app voice). */
  voices: Array<string | null>;
}

/**
 * A story's cast: distinct speakers in order of first appearance — the first on the left, the
 * second on the right (then alternating), narrator labels (旁白 / Narrator) centred; each
 * distinct speaker its own voice (female, male, female, … ; the narrator the narrator voice).
 * Lines with no speaker belong to one unnamed speaker.
 */
export function storyCast(lines: readonly Pick<ClipStoryLine, 'speaker'>[]): StoryCast {
  const order: string[] = [];
  const sides: StorySide[] = [];
  const voices: Array<string | null> = [];
  for (const line of lines) {
    const label = (line.speaker ?? '').trim();
    if (isNarratorSpeaker(label)) {
      sides.push('center');
      voices.push(CLIP_VOICE_IDS.narrator);
      continue;
    }
    let i = order.indexOf(label);
    if (i < 0) {
      order.push(label);
      i = order.length - 1;
    }
    sides.push(i % 2 === 0 ? 'left' : 'right');
    voices.push(SPEAKER_VOICES[i % SPEAKER_VOICES.length]);
  }
  return { sides, voices };
}

/**
 * What one scene says when it starts, in order. A scene WITH `voice` says only that — except
 * `listen` and `speak`, which always say their hanzi (after the voice line, if any): that is the
 * exercise. Without a voice: a story reads every line (a voice per speaker), a list its items, a
 * sentence / big word / listen / speak its hanzi; the other layouts are silent.
 */
export function sceneUtterances(scene: ClipScene, index: number): ClipUtterance[] {
  const zh = (text: string, line: number, voice_id: string | null = null): ClipUtterance => ({ scene: index, line, text: clipTtsText(text), lang: 'zh', voice_id });
  const voiced: ClipUtterance[] =
    scene.voice && scene.voice.text?.trim()
      ? [{ scene: index, line: -1, text: clipTtsText(scene.voice.text), lang: scene.voice.lang === 'en' ? 'en' : 'zh', voice_id: CLIP_VOICE_IDS[scene.voice.voice ?? 'teacher'] ?? null }]
      : [];
  if (scene.layout === 'listen' || scene.layout === 'speak') {
    const hanzi = scene.layout === 'listen' ? scene.listen.hanzi : scene.speak.hanzi;
    return [...voiced, ...(hanzi?.trim() ? [zh(hanzi, 0)] : [])];
  }
  if (voiced.length) return voiced;
  switch (scene.layout) {
    case 'story': {
      const cast = storyCast(scene.story.lines);
      return scene.story.lines.map((l, i) => zh(l.hanzi, i, cast.voices[i])).filter((u) => u.text);
    }
    case 'list':
      return scene.list.items.map((it, i) => zh(it.hanzi, i)).filter((u) => u.text);
    case 'sentence':
      return scene.sentence.hanzi ? [zh(scene.sentence.hanzi, 0)] : [];
    case 'big_word':
      return scene.big_word.hanzi ? [zh(scene.big_word.hanzi, 0)] : [];
    default:
      return [];
  }
}

/** The sentence of an `order` scene (its tiles, joined). */
export function clipOrderSentence(tiles: readonly string[]): string {
  return tiles.join('');
}

/**
 * What an interactive scene says once it is answered (or skipped): an `order` scene its sentence,
 * a `reveal` card its hanzi — the learner hears the Chinese he just put together / guessed.
 */
export function sceneRevealUtterances(scene: ClipScene, index: number): ClipUtterance[] {
  const text = scene.layout === 'order' ? clipOrderSentence(scene.order.tiles) : scene.layout === 'reveal' ? scene.reveal.hanzi : '';
  const tts = clipTtsText(text ?? '');
  return tts ? [{ scene: index, line: 0, text: tts, lang: 'zh', voice_id: null }] : [];
}

/** Every utterance of the clip, scene by scene (the answers' lines included). */
export function clipUtterances(spec: Pick<ClipSpec, 'scenes'>): ClipUtterance[] {
  return spec.scenes.flatMap((s, i) => [...sceneUtterances(s, i), ...sceneRevealUtterances(s, i)]);
}

/** The distinct TTS requests of a clip (prefetch / server pre-generation): text + voice. */
export function clipAudioClips(spec: Pick<ClipSpec, 'scenes'>): Array<{ text: string; voice_id: string | null }> {
  const seen = new Set<string>();
  const out: Array<{ text: string; voice_id: string | null }> = [];
  for (const u of clipUtterances(spec)) {
    const key = `${u.text}|${u.voice_id ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ text: u.text, voice_id: u.voice_id });
  }
  return out;
}

/** The distinct picture prompts, in scene order. */
export function clipImagePrompts(spec: Pick<ClipSpec, 'scenes'>): string[] {
  const out: string[] = [];
  for (const s of spec.scenes) {
    const p = s.image_prompt?.trim();
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}

/** Every hanzi of the clip a learner might tap (words first): for the explorer prefetch. */
export function clipFocusHanzi(spec: Pick<ClipSpec, 'words'>): string[] {
  return [...new Set(spec.words.map((w) => w.hanzi.trim()).filter(Boolean))];
}

/** The clip's topic for "More clips like this" and the follow-ups. */
export function clipTopic(spec: Pick<ClipSpec, 'topic' | 'title'>): string {
  return (spec.topic ?? '').trim() || spec.title.trim();
}
