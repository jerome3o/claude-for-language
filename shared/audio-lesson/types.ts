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

/**
 * - dialogue: an English host + a Chinese dialogue played three times, then the words;
 * - sleep: slow all-Chinese immersion teaching the new words of a text;
 * - story: "Listen & repeat" — a pasted story or conversation, chunk by chunk, each chunk said
 *   three times slowly and then its English (story.ts). No words are taught; Claude only translates.
 */
export type AudioLessonFormat = 'dialogue' | 'sleep' | 'story';
export const AUDIO_LESSON_FORMATS: readonly AudioLessonFormat[] = ['dialogue', 'sleep', 'story'];

/** How each format is named and shown (both apps: the picker, the list's icon, the player's header). */
export interface AudioLessonFormatInfo {
  icon: string;
  /** The picker's name. */
  label: string;
  /** Under the name in the picker: what it is for, in a few words. */
  short: string;
  /** The player's header. */
  kind: string;
}

export const AUDIO_LESSON_FORMAT_INFO: Record<AudioLessonFormat, AudioLessonFormatInfo> = {
  dialogue: { icon: '🎙️', label: 'Dialogue', short: 'Practise a situation', kind: 'Dialogue lesson' },
  sleep: { icon: '🌙', label: 'Sleep', short: 'New words, slowly', kind: 'Sleep lesson' },
  story: { icon: '📖', label: 'Story', short: 'Listen & repeat', kind: 'Listen & repeat a story' },
};

/** The format's info; an unknown format is shown as a dialogue lesson. */
export function audioLessonFormatInfo(format: string | null | undefined): AudioLessonFormatInfo {
  return format && Object.prototype.hasOwnProperty.call(AUDIO_LESSON_FORMAT_INFO, format) ? AUDIO_LESSON_FORMAT_INFO[format as AudioLessonFormat] : AUDIO_LESSON_FORMAT_INFO.dialogue;
}

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
  /** The one short English recap after each word of a sleep lesson (format B), a calm English voice. */
  | 'recap'
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
  /**
   * What the transcript shows when it differs from what is spoken: a character's tone line
   * is SAID "导，第三声。" (a Chinese voice reads Latin pinyin as English letters) and SHOWN
   * "导，dǎo，第三声。". Not part of the clip's identity (`speechKey`).
   */
  display?: string;
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
  /**
   * `learner`: the speaker whose part the learner plays (the one who says 我 as the traveller /
   * customer / guest) — at most one. With the account's voice gender set, that speaker takes it
   * (`applyLearnerGender`, worker agent.ts).
   */
  speakers: Array<{ id: 'A' | 'B'; name: string; gender: Gender; learner?: boolean }>;
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

/** A sleep-lesson word's character and its citation tone (1–4, 5 = 轻声). */
export interface SleepCharTone {
  /** One Han character of the word, in order. */
  char: string;
  /** Its citation pinyin: one syllable with a tone mark ("dǎo"; no mark for 轻声). */
  pinyin: string;
  tone: 1 | 2 | 3 | 4 | 5;
}

/**
 * One character's line in a sleep lesson, said right after its tone line (characters.ts): the
 * words it names come from the facts the worker computed (`pickCharLinks`), never the model's memory.
 */
export interface SleepCharNote {
  /** One distinct Han character of the word, in order. */
  char: string;
  /** The words the line names (empty for a new character). */
  words: string[];
  /** The spoken line: "你学过‘导游’的‘导’。" / "‘航’也在‘航空’里。"; "" for a new character (the app says that). */
  zh: string;
  /**
   * Stamped by the worker from its facts when the plan is accepted (never trusted from the model):
   * 'new' = the compiler says one of its own "a new character" lines (phrases.ts) instead of zh.
   */
  kind?: 'known' | 'common' | 'other_reading' | 'new' | 'none';
}

export interface SleepPlan {
  title: string;
  /** Very simple Chinese, 1–3 short sentences. */
  intro_zh: string;
  words: Array<
    PlanLine & {
      /**
       * What the word MEANS, comprehensible-input style: 5–8 very short, very simple Chinese
       * sentences built from words the learner knows that circle the meaning — say it, say it
       * again another way, a tiny everyday situation, a contrast with a known word ("邮局是一个
       * 地方。" "在邮局，你可以寄信。" "邮局不是银行。…"). Required — never where its characters
       * come from (that is characters_zh).
       */
      meaning_zh: string[];
      /**
       * One entry per Han character of the word, in order, with its CITATION tone (导航 →
       * 导 dǎo 3, 航 háng 2; 任务 → 务 wù 4 although the word is said rènwu). The compiler
       * speaks "导，第三声。" for each and adds "在‘任务’里，‘务’读轻声。" where the word is
       * said differently (neutral tone, third-tone sandhi, 一 / 不) — tones.ts. Optional only
       * for plans written before it existed; validateSleepPlan requires it.
       */
      char_tones?: SleepCharTone[];
      /**
       * One entry per DISTINCT character of the word, in order: the line said after that
       * character's tone ("导，第三声。" → "你学过‘导游’的‘导’。"). Required by the worker since
       * round 4; plans written before it compile without the lines.
       */
      char_notes?: SleepCharNote[];
      /**
       * Before round 4: its characters, related to words the learner knows ("'银'就是'银行'的'银'。"),
       * 0–3 sentences. Empty in plans with char_notes (they replace it).
       */
      characters_zh?: string[];
      /**
       * The ONE English line after the word's block, spoken as "The word was 银行: <recap_en>"
       * — the meaning, with the sense pinned down when the English word has several
       * ("bank, as in the place where you keep your money, not the bank of a river").
       */
      recap_en: string;
      /** The known words the explanation leans on (for the record). */
      related_known: string[];
      /**
       * Exactly three short, simple example sentences. Each is said three times, then its
       * `english` translation once by the English voice.
       */
      sentences: PlanLine[];
    }
  >;
  /** Very simple Chinese, 1–2 short sentences. */
  outro_zh: string;
}

/**
 * A story lesson (story.ts): the pasted text split into chunks by code (`splitStoryText`), each
 * translated by Claude (english + pinyin) — the Chinese is never rewritten.
 */
export interface StoryPlan {
  title: string;
  /** The speaker labels of a conversation, in order of first appearance, with the voice gender to use. */
  speakers: Array<{ label: string; gender: Gender }>;
  chunks: Array<
    PlanLine & {
      /** The speaker label as written ("A", "明慧"); null = narration. */
      speaker: string | null;
      /** The heading this chunk is under (a chapter), if the text has headings. */
      section: string | null;
    }
  >;
  /** Set when the text was longer than one lesson holds: what was kept of how much. */
  cut?: { chunks: number; total_chunks: number; chars: number; total_chars: number };
}

export type AudioLessonPlan =
  | { format: 'dialogue'; plan: DialoguePlan }
  | { format: 'sleep'; plan: SleepPlan }
  | { format: 'story'; plan: StoryPlan };

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
  /** Format B: the Chinese text to mine for new words. Story: the story / conversation to listen to. */
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
  /** A story lesson's pasted text (its length decides the lesson's; see STORY_LIMITS). */
  storyText: 6000,
  minMinutes: 5,
  maxMinutes: 40,
  /** Story: not a target — the lesson is as long as the text (STORY_LIMITS.maxMinutes at most). */
  defaultMinutes: { dialogue: 12, sleep: 20, story: 0 } as Record<AudioLessonFormat, number>,
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
  /** Story: "The text is long: this lesson covers the first …" when part of the text was left out. */
  notice?: string | null;
}

/**
 * The private podcast feed of a user's audio lessons (GET /api/me/podcast-feed,
 * worker services/podcast-feed.ts; docs/AUDIO_LESSONS.md "Podcast feed").
 */
export interface PodcastFeedInfo {
  /** The feed URL (secret — it is the only credential). Null when it can't be shown any more: Reset makes a new one. */
  url: string | null;
  /** The same as podcast:// (AntennaPod, Pocket Casts, Podcast Addict …). */
  podcast_url: string | null;
  /** The same as pcast:// (Apple Podcasts). */
  apple_url: string | null;
  created_at: string;
  rotated_at: string | null;
  /** When a podcast app last fetched the feed. */
  last_fetched_at: string | null;
  fetch_count: number;
}
