/**
 * 梗 Meme review (PROTOTYPE, docs/MEME_REVIEW.md): ONE issue per calendar month, shared by every
 * account (no user ids in the content), written by a research agent (Claude + web search) about
 * the Chinese internet of the last ~6–8 weeks. Isolated on purpose: nothing in the study queue or
 * the sync reads it.
 *
 * Every URL in an issue (sources, media) is one the agent's web search / fetch actually returned
 * (validate.ts refuses the rest). Media is LINKED OUT, never embedded or re-hosted; the only
 * third-party image shown is a YouTube thumbnail from its public img.youtube.com URL. Each item's
 * picture is our own Gemini illustration (R2 `meme-review/images/`).
 */

/** "2026-10". */
export type MemeMonth = string;

/** A Chinese line with its pinyin (re-derived by the app, never the model's own) and English. */
export interface MemeLine {
  hanzi: string;
  pinyin: string;
  english: string;
}

export type MemePlatform = 'bilibili' | 'youtube' | 'douyin' | 'weibo' | 'xiaohongshu' | 'zhihu' | 'baidu' | 'wechat' | 'news' | 'other';

/** A source the agent read (an article, an encyclopedia entry, a buzzword list). */
export interface MemeSource {
  url: string;
  title: string;
  platform: MemePlatform;
}

/** The original video / post, opened in the browser. */
export interface MemeMedia {
  url: string;
  title: string;
  platform: MemePlatform;
  kind: 'video' | 'post';
  /** YouTube only: its public thumbnail (img.youtube.com). Never a re-hosted copy. */
  thumbnail_url: string | null;
}

/** Who says it, how, where. */
export interface MemeRegister {
  /** "Gen Z and younger millennials". */
  who: string;
  /** "Ironic, self-mocking". */
  tone: string;
  where: 'online' | 'spoken' | 'both';
  /** Crude / slightly rude (labelled in the apps). */
  crude: boolean;
  note: string;
}

/** "Would you say it?" for a ~30-year-old foreigner. */
export type MemeVerdict = 'fine' | 'cute' | 'cringe' | 'avoid';

export interface MemeSayIt {
  verdict: MemeVerdict;
  note: string;
}

export interface MemeOrigin {
  /** Where / when / who, honest about what is unsure (English). */
  text: string;
  /** "Sep 2026", "a Bilibili video in August". */
  when: string;
  confidence: 'high' | 'medium';
}

export interface MemeRelated {
  hanzi: string;
  pinyin: string;
  english: string;
}

export interface MemePicture {
  /** What to draw (our own art in the meme's spirit: no real people, no logos, no text). */
  prompt: string;
  /** R2 key once drawn (`meme-review/images/<month>/<item>.<ext>`), else null. */
  image_key: string | null;
}

export interface MemeItem {
  /** "m1"…: stable within an issue (the picture key, analytics). */
  id: string;
  /** The 梗 / phrase itself: one clean form. */
  hanzi: string;
  pinyin: string;
  /** The gist in a few English words. */
  english: string;
  /** What it means in simple Chinese (2–4 short sentences) + pinyin + English. */
  meaning: MemeLine;
  origin: MemeOrigin;
  /** 2–3 short realistic lines (chat / comment style). */
  examples: MemeLine[];
  register: MemeRegister;
  say_it: MemeSayIt;
  /** Older memes it riffs on. */
  related: MemeRelated[];
  sources: MemeSource[];
  media: MemeMedia[];
  picture: MemePicture;
}

export interface MemeQuizQuestion {
  prompt: string;
  options: string[];
  answer: number;
  explanation: string;
  /** The item it is about, when one. */
  item_id: string | null;
}

export interface MemeIssue {
  month: MemeMonth;
  /** Chinese title ("十月梗回顾"). */
  title: string;
  title_en: string;
  intro: MemeLine;
  /** The weeks it covers (YYYY-MM-DD). */
  covers: { from: string; to: string };
  items: MemeItem[];
  quiz: MemeQuizQuestion[];
  generator_version: number;
}

export type MemeIssueStatus = 'missing' | 'generating' | 'ready' | 'failed';

/** What GET /api/meme-review/:month serves. */
export interface MemeIssueRecord {
  month: MemeMonth;
  status: MemeIssueStatus;
  issue: MemeIssue | null;
  /** generating: a short "what it's doing" line. */
  progress: string | null;
  error: string | null;
  updated_at: string | null;
}

/** A row of the issue list. */
export interface MemeIssueSummary {
  month: MemeMonth;
  status: MemeIssueStatus;
  title: string | null;
  title_en: string | null;
  item_count: number;
  /** The first few memes' hanzi (the list preview). */
  preview: string[];
  updated_at: string | null;
}

/** "Make a mini lesson from this issue": a job in the caller's own account. */
export interface MemeLessonJob {
  id: string;
  month: MemeMonth;
  status: 'generating' | 'ready' | 'failed';
  lesson_id: string | null;
  error: string | null;
  created_at: string | null;
}

/** Bump when the shape or the rules change. */
export const MEME_REVIEW_VERSION = 1;
