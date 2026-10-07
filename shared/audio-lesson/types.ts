/**
 * Audio lessons (docs/AUDIO_LESSONS.md): agent-written listening lessons
 * rendered to ONE audio file per lesson.
 *
 * Two layers:
 * - a PLAN is what Claude writes (the content: the dialogue, the words, the
 *   explanations, the example sentences) — `DialoguePlan` / `SleepPlan`;
 * - a SCRIPT is what gets spoken: ordered speech / pause segments in chapters,
 *   built from a plan by `compileDialogueLesson` / `compileSleepLesson`
 *   (compile.ts). The structure — three plays of the dialogue, every new word
 *   said three times, the pauses — is code, so it is always right; Claude only
 *   decides what is said.
 */

export type AudioLessonFormat = 'dialogue' | 'sleep';
export const AUDIO_LESSON_FORMATS: readonly AudioLessonFormat[] = ['dialogue', 'sleep'];

export type ScriptLang = 'zh' | 'en';

/**
 * Who speaks a segment. The worker maps a role to a voice per TTS provider
 * (worker services/audio-lessons/voices.ts), so the same lesson sounds the same
 * whichever provider makes it.
 */
export type VoiceRole =
  /** English host (format A). */
  | 'narrator'
  /** Chinese words / examples inside the English explanations (format A). */
  | 'teacher'
  /** The calm, slow voice of a sleep lesson (format B). */
  | 'sleep'
  | 'speaker_a'
  | 'speaker_b';

export type Gender = 'female' | 'male';

export interface SpeechSegment {
  kind: 'speech';
  lang: ScriptLang;
  voice: VoiceRole;
  text: string;
  /** On the app's speed scale (MiniMax's: 1 = normal, cards 0.6); each provider maps it. */
  rate: number;
  chapter: number;
  /** For the transcript under a Chinese line. */
  pinyin?: string;
  english?: string;
}

export interface PauseSegment {
  kind: 'pause';
  ms: number;
  chapter: number;
}

export type ScriptSegment = SpeechSegment | PauseSegment;

export interface LessonWord {
  hanzi: string;
  pinyin: string;
  english: string;
  /** What the learner's cards say about it when the lesson was written. */
  status?: 'new' | 'learning' | 'known';
}

export interface ScriptSpeaker {
  role: 'speaker_a' | 'speaker_b';
  name: string;
  gender: Gender;
}

export interface AudioLessonScript {
  version: 1;
  format: AudioLessonFormat;
  title: string;
  chapters: Array<{ title: string }>;
  segments: ScriptSegment[];
  /** Format A's two speakers (empty for format B). */
  speakers: ScriptSpeaker[];
  /** The words / structures the lesson teaches. */
  words: LessonWord[];
}

// ---------- Plans (what Claude writes) ----------

export interface PlanLine {
  hanzi: string;
  pinyin: string;
  english: string;
}

export interface DialoguePlan {
  title: string;
  /** English, 2–5 sentences: the situation and what to listen for. Chinese words may appear in Han characters (spoken in the Chinese voice). */
  intro_en: string;
  speakers: Array<{ id: 'A' | 'B'; name: string; gender: Gender }>;
  dialogue: Array<PlanLine & { speaker: 'A' | 'B' }>;
  /** The words and structures to dig into, most important first. */
  points: Array<
    PlanLine & {
      kind: 'word' | 'structure';
      status: 'new' | 'learning' | 'known';
      /** English explanation; Chinese in Han characters is spoken by the Chinese teacher voice. No pinyin. */
      explanation_en: string;
      /** Index into `dialogue` of the line that uses it. */
      line: number;
      example?: PlanLine;
    }
  >;
  /** One or two English sentences to close. */
  outro_en: string;
}

export interface SleepPlan {
  title: string;
  /** Very simple Chinese, 1–3 short sentences. */
  intro_zh: string;
  words: Array<
    PlanLine & {
      /** 2–4 very short, very simple Chinese sentences, built from words the learner knows. */
      explanation_zh: string[];
      /** The known words the explanation leans on (for the record). */
      related_known: string[];
      /** Exactly three short, simple example sentences. */
      sentences: PlanLine[];
    }
  >;
  /** Very simple Chinese, 1–2 short sentences. */
  outro_zh: string;
}

export type AudioLessonPlan = { format: 'dialogue'; plan: DialoguePlan } | { format: 'sleep'; plan: SleepPlan };

// ---------- What the player shows ----------

export interface AudioLessonChapter {
  title: string;
  start_ms: number;
}

export interface AudioLessonTranscriptLine {
  start_ms: number;
  lang: ScriptLang;
  voice: VoiceRole;
  text: string;
  pinyin?: string;
  english?: string;
  chapter: number;
}

// ---------- The API's shapes (worker routes/audio-lessons.ts) ----------

export type AudioLessonStatus = 'queued' | 'writing' | 'speaking' | 'rendering' | 'ready' | 'failed';

/** What the learner gives (POST /api/audio-lessons). */
export interface AudioLessonInput {
  /** Format A: the situation to practise. */
  description?: string;
  /** Format A: a dialogue to build the lesson on (optional). */
  dialogue?: string;
  /** Format B: the Chinese text to mine for new words. */
  text?: string;
  target_minutes?: number;
  /** A title the learner chose (else Claude names the lesson). */
  title?: string;
}

export const AUDIO_LESSON_INPUT_LIMITS = {
  description: 1000,
  dialogue: 4000,
  /** Format B's raw text (a long article is fine; the agent picks the words). */
  text: 20_000,
  minMinutes: 5,
  maxMinutes: 40,
  defaultMinutes: { dialogue: 12, sleep: 20 } as Record<AudioLessonFormat, number>,
} as const;

export interface AudioLessonUsage {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  rounds: number;
  /** Characters sent to TTS (each distinct clip once). */
  tts_chars_zh: number;
  tts_chars_en: number;
  tts_clips: number;
  zh_provider: string | null;
  en_provider: string | null;
  /** Claude's part, at list price. */
  claude_usd: number;
}

export interface AudioLessonSummary {
  id: string;
  format: AudioLessonFormat;
  title: string;
  status: AudioLessonStatus;
  progress: string | null;
  progress_done: number | null;
  progress_total: number | null;
  error: string | null;
  duration_ms: number | null;
  size_bytes: number | null;
  word_count: number;
  /** Changes whenever the file changes (a rebuilt lesson gets a new key): the devices' cache key. */
  audio_version: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface AudioLessonDetail extends AudioLessonSummary {
  input: AudioLessonInput;
  words: LessonWord[];
  chapters: AudioLessonChapter[];
  transcript: AudioLessonTranscriptLine[];
  speakers: ScriptSpeaker[];
  usage: AudioLessonUsage | null;
  for_relationship_id: string | null;
}
