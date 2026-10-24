/**
 * 🎬 Clips (experimental, docs/CLIPS.md): short, vertical, learning-first "TikTok" clips.
 *
 * A clip is NOT an MP4: it is a JSON script (`ClipSpec`, spec v1 — the authoring text every
 * clip-writing Claude reads is CLIP_SPEC_DOC in doc.ts) that the apps PLAY like a video —
 * full-screen scenes on a timeline, TTS voice-over (the practice-TTS path, cached on the
 * device), big animated text, optional generated pictures (one per `image_prompt`, shared by
 * prompt hash like lesson pictures) and the soft lesson music loop underneath. Captions
 * (hanzi + pinyin + English) are always there, so it works muted.
 *
 * Field names follow the spec exactly; new fields may be ADDED (optional), never renamed.
 * The Lab app's port: android-lab/core/…/clips/Clips.kt (parity-tested).
 */

export const CLIP_SPEC_VERSION = 1;

export const CLIP_THEMES = ['neon', 'paper', 'chalk', 'comic', 'sunset', 'mono', 'ink', 'retro'] as const;
export type ClipTheme = (typeof CLIP_THEMES)[number];

export const CLIP_LAYOUTS = ['title', 'big_word', 'sentence', 'compare', 'quiz', 'story', 'list', 'fact'] as const;
export type ClipLayout = (typeof CLIP_LAYOUTS)[number];

export const CLIP_VOICES = ['teacher', 'female', 'male', 'narrator'] as const;
export type ClipVoiceName = (typeof CLIP_VOICES)[number];

export type ClipLang = 'zh' | 'en';

export interface ClipWord {
  hanzi: string;
  pinyin: string;
  english: string;
}

export interface ClipVoiceLine {
  /** What TTS reads: no brackets / slashes / blanks. */
  text: string;
  lang: ClipLang;
  /** teacher (default) | female | male | narrator. */
  voice?: ClipVoiceName;
}

export interface ClipTitleBody {
  headline_zh?: string;
  headline_en?: string;
  sub?: string;
}

export interface ClipBigWordBody {
  hanzi: string;
  pinyin: string;
  english: string;
  breakdown?: Array<{ char: string; meaning: string }>;
}

export interface ClipSentenceBody {
  hanzi: string;
  pinyin: string;
  english: string;
  /** A stretch of `hanzi` to highlight (must occur in it). */
  highlight?: string;
}

export interface ClipCompareSide {
  hanzi: string;
  pinyin: string;
  english: string;
  example?: string;
}

export interface ClipCompareBody {
  left: ClipCompareSide;
  right: ClipCompareSide;
  rule_en?: string;
}

export interface ClipQuizBody {
  /** Chinese prompt; may contain "___" for the gap. */
  prompt_zh?: string;
  prompt_en?: string;
  /** 2–4 options. */
  options: string[];
  answer_index: number;
  explain?: string;
}

export interface ClipStoryLine {
  speaker?: string;
  hanzi: string;
  pinyin: string;
  english: string;
}

export interface ClipStoryBody {
  /** ≤ 6 lines. */
  lines: ClipStoryLine[];
}

export interface ClipListItem {
  hanzi: string;
  pinyin: string;
  english: string;
}

export interface ClipListBody {
  title?: string;
  /** ≤ 6 items. */
  items: ClipListItem[];
}

export interface ClipFactBody {
  text_en: string;
  hanzi?: string;
  /** Optional (added): the pinyin of `hanzi`. */
  pinyin?: string;
}

interface ClipSceneBase {
  layout: ClipLayout;
  /** 1500–9000 ms (a quiz waits for a tap up to its duration). */
  duration_ms: number;
  voice?: ClipVoiceLine;
  /** A vertical background illustration (no text in the picture); ≤ 3 per clip. */
  image_prompt?: string;
  emoji?: string;
}

export interface ClipTitleScene extends ClipSceneBase { layout: 'title'; title: ClipTitleBody }
export interface ClipBigWordScene extends ClipSceneBase { layout: 'big_word'; big_word: ClipBigWordBody }
export interface ClipSentenceScene extends ClipSceneBase { layout: 'sentence'; sentence: ClipSentenceBody }
export interface ClipCompareScene extends ClipSceneBase { layout: 'compare'; compare: ClipCompareBody }
export interface ClipQuizScene extends ClipSceneBase { layout: 'quiz'; quiz: ClipQuizBody }
export interface ClipStoryScene extends ClipSceneBase { layout: 'story'; story: ClipStoryBody }
export interface ClipListScene extends ClipSceneBase { layout: 'list'; list: ClipListBody }
export interface ClipFactScene extends ClipSceneBase { layout: 'fact'; fact: ClipFactBody }

export type ClipScene =
  | ClipTitleScene
  | ClipBigWordScene
  | ClipSentenceScene
  | ClipCompareScene
  | ClipQuizScene
  | ClipStoryScene
  | ClipListScene
  | ClipFactScene;

export interface ClipStyle {
  theme: ClipTheme;
  /** Optional hex accent (#RGB or #RRGGBB). */
  accent?: string;
}

export interface ClipEnding {
  question_en?: string;
  cta?: string;
}

export interface ClipSpec {
  v: 1;
  /** ≤ 60 chars. */
  title: string;
  /** ≤ 60 chars, big on screen for the first scene. */
  hook: string;
  style: ClipStyle;
  /** 1–6 focus words. */
  words: ClipWord[];
  /** Free, ≤ 6. */
  tags?: string[];
  /** 4–10 scenes. */
  scenes: ClipScene[];
  ending?: ClipEnding;
  /** Optional (added): what the clip is about, for "More clips like this". */
  topic?: string;
}

// ---------- Stored / API shapes ----------

export type ClipStatus = 'ready' | 'generating' | 'failed';
export type ClipSource = 'agent' | 'generated' | 'manual';

/** The learner's own state on a clip (from their events). */
export interface ClipUserState {
  viewed: boolean;
  completed: boolean;
  liked: boolean;
  saved: boolean;
  skips: number;
}

export interface ClipRecord {
  id: string;
  status: ClipStatus;
  source: ClipSource;
  title: string | null;
  topic: string | null;
  theme: ClipTheme | null;
  /** Null while generating / failed. */
  spec: ClipSpec | null;
  /** The ready pictures by image_prompt → R2 key (lesson-images/…). */
  images: Record<string, string>;
  progress: string | null;
  error: string | null;
  created_at: string;
  state: ClipUserState;
  /** The clip's one mini lesson ("Learn more" → ✨ Mini lesson). */
  lesson: ClipLessonState | null;
}

export interface ClipLessonState {
  status: 'generating' | 'ready' | 'failed';
  lesson_id: string | null;
  error: string | null;
}

export const CLIP_EVENT_KINDS = ['view', 'complete', 'like', 'unlike', 'save', 'unsave', 'skip', 'double_tap', 'quiz', 'learn_more'] as const;
export type ClipEventKind = (typeof CLIP_EVENT_KINDS)[number];

/** One event from a device (idempotent by client id). */
export interface ClipEvent {
  id: string;
  clip_id: string;
  kind: ClipEventKind;
  /** quiz: 1 = right, 0 = wrong; otherwise unused. */
  value?: number | null;
  created_at?: string;
}

export const CLIP_LEARN_MORE_ACTIONS = ['lesson', 'reader', 'podcast', 'study_words', 'add_card', 'more'] as const;
export type ClipLearnMoreAction = (typeof CLIP_LEARN_MORE_ACTIONS)[number];
