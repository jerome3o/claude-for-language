/**
 * 成语 Idioms (docs/IDIOMS.md): ONE entry shape per idiom, generated once by Claude and
 * cached for every user (D1 `idioms`, keyed by the normalised hanzi). The web app, the Lab
 * app (android-lab/core/…/idioms/Idioms.kt) and the MCP tools all read this shape.
 */

/** Bump when the prompt / shape changes enough that old entries should be regenerated. */
export const IDIOM_GENERATOR_VERSION = 1;

/** How sure the generator is about the facts — shown as a quiet note when not `high`. */
export type IdiomConfidence = 'high' | 'medium' | 'low';
/** 褒义 / 贬义 / 中性. */
export type IdiomSentiment = 'praise' | 'criticism' | 'neutral';
/** 书面 / 口语 / both. */
export type IdiomRegister = 'written' | 'spoken' | 'both';
/**
 * Where the idiom comes from: a classical text (典故 with a known source), a folk saying, a
 * modern coinage, or uncertain — then the entry says so instead of inventing a source.
 */
export type IdiomOriginKind = 'classical' | 'folk' | 'modern' | 'uncertain';

/** One character of the literal row: 画 · huà · draw. */
export interface IdiomChar {
  hanzi: string;
  pinyin: string;
  gloss: string;
}

/** A line of Chinese with its pinyin and English (a story paragraph, an example, a collocation). */
export interface IdiomLine {
  hanzi: string;
  pinyin: string;
  english: string;
}

/** A synonym / antonym idiom (tappable → its own entry). */
export interface IdiomRef {
  hanzi: string;
  pinyin: string;
  english: string;
}

/** One "Try it" question: pick the right option. Practice only — nothing is recorded. */
export interface IdiomQuizQuestion {
  /** meaning = what does it mean; fit = which sentence uses it right / fill the blank. */
  kind: 'meaning' | 'fit';
  prompt: string;
  options: string[];
  /** Index into options. */
  answer: number;
  /** One line shown after answering. */
  explanation: string;
}

export interface IdiomOrigin {
  kind: IdiomOriginKind;
  /** The source text, e.g. 《战国策·齐策二》 — null when unknown. Never invented. */
  source: string | null;
  /** The era, e.g. 战国 (Warring States) — null when unknown. */
  era: string | null;
  /** One English sentence: the story (or "No single story — it describes …"). */
  summary: string;
  /** The 典故 retold in simple graded Chinese (HSK 3–4), short paragraphs. May be empty for a modern idiom. */
  story: IdiomLine[];
  /** An honesty note: "The origin is uncertain…", "A modern idiom…". */
  note: string | null;
}

/** 谓语 / 定语 / … — the grammatical roles the idiom plays. */
export const IDIOM_ROLES: Record<string, string> = {
  谓语: 'predicate',
  定语: 'attributive',
  状语: 'adverbial',
  补语: 'complement',
  宾语: 'object',
  主语: 'subject',
  分句: 'stand-alone clause',
};

export interface IdiomUsage {
  /** Keys of IDIOM_ROLES, most typical first. */
  roles: string[];
  register: IdiomRegister;
  sentiment: IdiomSentiment;
  /** One English line: when and how it is used. */
  note: string;
  /** Typical collocations: 简直是画蛇添足 … */
  collocations: IdiomLine[];
  /** 3–4 example sentences, easiest → hardest; each contains the idiom exactly. */
  examples: IdiomLine[];
  /** The common mistake, in English (may quote Chinese). */
  mistake: string;
}

export interface IdiomEntry {
  hanzi: string;
  pinyin: string;
  /** One per character, in order. */
  literal: IdiomChar[];
  /** "draw a snake and add feet to it". */
  literal_english: string;
  /** The figurative meaning in English. */
  meaning: string;
  /** One line in simple Chinese: 比喻做了多余的事，反而把事情弄坏了。 */
  explanation_zh: string;
  explanation_pinyin: string;
  origin: IdiomOrigin;
  usage: IdiomUsage;
  synonyms: IdiomRef[];
  antonyms: IdiomRef[];
  quiz: IdiomQuizQuestion[];
  confidence: IdiomConfidence;
  /** Why not high: "Sources differ on …". */
  confidence_note: string | null;
}

/**
 * The row the API serves: generating → ready (entry) | failed (error, Retry) | not_idiom
 * (the generator said it isn't a 成语; `suggestion` = the idiom it probably meant).
 */
export type IdiomStatus = 'generating' | 'ready' | 'failed' | 'not_idiom' | 'missing';

export interface IdiomRecord {
  hanzi: string;
  status: IdiomStatus;
  entry: IdiomEntry | null;
  /** failed: why; not_idiom: the generator's reason. */
  error: string | null;
  /** not_idiom: the idiom the text most likely meant (画蛇添脚 → 画蛇添足). */
  suggestion: string | null;
  generator_version: number;
  updated_at: string | null;
}

/** A row of the browsable list. */
export interface IdiomSummary {
  hanzi: string;
  pinyin: string;
  english: string;
  status: IdiomStatus;
  starter: boolean;
}
