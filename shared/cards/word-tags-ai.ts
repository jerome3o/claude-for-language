/**
 * Word tags — the AI pass (docs/STUDY_SESSION.md "Word tags → AI tags"). The lexicon
 * (word-tags.ts) can't say whether a verb takes an object, and has a register label for only a
 * few thousand words. A cheap batched model call (worker services/word-tags-ai.ts, on the
 * card-check queue) fills those gaps per note and stores the verdict as `notes.word_tags`
 * (JSON `AiWordTags`, synced to the devices by `word_tags_at`).
 *
 * Merge rules (`mergeAiWordTags`):
 * - the lexicon always wins: an AI register only when the lexicon gave none, an AI "Separable
 *   verb" only when the lexicon didn't already say so;
 * - transitivity only for a verb (the lexicon says Verb, or it has no part of speech for it) —
 *   never a sentence, never for a word the lexicon calls a noun / adjective…;
 * - low-confidence verdicts are never shown; AI pills carry `ai: true` (the UI adds ✨) and their
 *   sheet says "Suggested by AI — may be wrong" plus the register note.
 *
 * Pure; ported to the Lab app (core/…/cards/WordTagsAi.kt) and parity-tested over the shipped
 * lexicon (android-lab/parity/fixtures/word-tags-ai.ts).
 */
import {
  REGISTER_EXPLAIN,
  REGISTER_LABELS,
  REGISTER_TONE,
  wordTagExplanation,
  wordTagKey,
  wordTags,
  type WordTag,
  type WordTagExplanation,
  type WordTagLexicon,
  type WordTagOptions,
} from './word-tags';

export const WORD_TAGS_AI_VERSION = 1;

export const TRANSITIVITIES = ['transitive', 'intransitive', 'both', 'n/a'] as const;
export type Transitivity = (typeof TRANSITIVITIES)[number];

export const AI_REGISTERS = ['formal', 'neutral', 'informal', 'polite', 'rude', 'slang', 'literary'] as const;
export type AiRegister = (typeof AI_REGISTERS)[number];

export const AI_CONFIDENCES = ['high', 'medium', 'low'] as const;
export type AiConfidence = (typeof AI_CONFIDENCES)[number];

/** The AI's verdict on one note (`notes.word_tags`). */
export interface AiWordTags {
  v: number;
  transitivity?: Transitivity;
  separable?: boolean;
  register?: AiRegister;
  /** ≤ 60 characters, e.g. "formal written; in speech use 告诉". */
  register_note?: string;
  confidence: AiConfidence;
}

export const REGISTER_NOTE_MAX = 60;
/** Words per model call. */
export const WORD_TAGS_BATCH_SIZE = 40;
/** At most this many of a user's untagged notes are queued per hour by the sync backfill. */
export const WORD_TAGS_BACKFILL_PER_HOUR = 200;

/** The AI register → the lexicon's register code (neutral = no pill). */
export const AI_REGISTER_CODE: Readonly<Record<AiRegister, string | null>> = {
  formal: 'F',
  neutral: null,
  informal: 'I',
  polite: 'P',
  rude: 'R',
  slang: 'S',
  literary: 'L',
};

export const TRANSITIVITY_LABELS: Readonly<Record<Exclude<Transitivity, 'n/a'>, string>> = {
  transitive: 'Takes an object',
  intransitive: 'No object',
  both: 'Object optional',
};

const TRANSITIVITY_EXPLAIN: Readonly<Record<Exclude<Transitivity, 'n/a'>, readonly [title: string, body: string, example: string]>> = {
  transitive: [
    'Takes an object',
    'A transitive verb: the thing it acts on comes straight after it, with no preposition in between.',
    '我喜欢音乐。',
  ],
  intransitive: [
    'No object',
    'An intransitive verb: nothing comes straight after it. To say who or what it involves, use a preposition BEFORE the verb (跟, 对, 给…).',
    '我跟他见面。',
  ],
  both: [
    'Object optional',
    'Works with or without an object after it — both are natural.',
    '我在吃。我在吃饭。',
  ],
};

/** What every AI pill's sheet says. */
export const AI_WORD_TAG_NOTICE = 'Suggested by AI — may be wrong';
const AI_SOURCE = 'AI suggestion from the card’s word and meaning';

const HAN = /^\p{Script=Han}+$/u;
const SENTENCE_MARK = /[。！？!?，,；;]/;

function oneOf<T extends string>(list: readonly T[], v: unknown): T | undefined {
  return typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : undefined;
}

/** A register note cleaned up: whitespace collapsed, trimmed, cut to REGISTER_NOTE_MAX. '' = none. */
export function cleanRegisterNote(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.replace(/\s+/g, ' ').trim().slice(0, REGISTER_NOTE_MAX).trim();
}

/**
 * Validate one verdict (the model's output or a stored value): unknown values dropped, the
 * note cut to 60 characters. null when it has no usable confidence. Keys in a fixed order.
 */
export function pickAiWordTags(input: unknown): AiWordTags | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const o = input as Record<string, unknown>;
  const confidence = oneOf(AI_CONFIDENCES, o.confidence);
  if (!confidence) return null;
  const v = o.v === undefined ? WORD_TAGS_AI_VERSION : typeof o.v === 'number' && Number.isInteger(o.v) && o.v >= 1 ? o.v : null;
  if (v === null) return null;
  const out: AiWordTags = { v, confidence };
  const transitivity = oneOf(TRANSITIVITIES, o.transitivity);
  if (transitivity) out.transitivity = transitivity;
  if (typeof o.separable === 'boolean') out.separable = o.separable;
  const register = oneOf(AI_REGISTERS, o.register);
  if (register) out.register = register;
  const note = cleanRegisterNote(o.register_note);
  if (note) out.register_note = note;
  // Fixed key order: v, transitivity, separable, register, register_note, confidence.
  const { confidence: c, ...rest } = out;
  return { ...rest, confidence: c };
}

/** `notes.word_tags` (JSON text, or an already-parsed value) → the verdict; junk → null. */
export function parseAiWordTags(raw: unknown): AiWordTags | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'string') {
    try {
      return pickAiWordTags(JSON.parse(raw));
    } catch {
      return null;
    }
  }
  return pickAiWordTags(raw);
}

/** The verdict if it may be shown (not low confidence), else null. */
export function visibleAiWordTags(ai: AiWordTags | null | undefined): AiWordTags | null {
  return ai && ai.confidence !== 'low' ? ai : null;
}

/** Display order of the kinds: the lexicon's order, with transitivity after part of speech. */
const SLOT: Readonly<Record<string, number>> = {
  pos: 0,
  phrase: 0,
  separable: 1,
  transitivity: 2,
  register: 3,
  measure: 4,
  hsk: 5,
  frequency: 6,
  trad: 7,
};

/**
 * The lexicon's tags for `hanzi` plus what the AI verdict adds where the lexicon has nothing
 * (rules in the file header). `base` = wordTags(hanzi, lexicon, …) WITHOUT an exclude.
 */
export function mergeAiWordTags(hanzi: string, base: readonly WordTag[], ai: AiWordTags | null | undefined): WordTag[] {
  const v = visibleAiWordTags(ai);
  if (!v) return [...base];
  const key = wordTagKey(hanzi);
  const added: WordTag[] = [];
  const sentence = SENTENCE_MARK.test(String(hanzi ?? '').normalize('NFC')) || !HAN.test(key);
  const hasPos = base.some((t) => t.kind === 'pos');
  const verbish = !sentence && (base.some((t) => t.id === 'pos:v') || !hasPos);
  if (verbish && v.transitivity && v.transitivity !== 'n/a') {
    added.push({ kind: 'transitivity', id: `transitivity:${v.transitivity}`, label: TRANSITIVITY_LABELS[v.transitivity], tone: 'grammar', ai: true });
  }
  if (verbish && v.separable === true && !base.some((t) => t.kind === 'separable')) {
    added.push({ kind: 'separable', id: 'separable', label: 'Separable verb', tone: 'grammar', ai: true });
  }
  const code = v.register ? AI_REGISTER_CODE[v.register] : null;
  if (code && !base.some((t) => t.kind === 'register')) {
    added.push({ kind: 'register', id: `register:${code}`, label: REGISTER_LABELS[code], tone: REGISTER_TONE[code] ?? 'plain', ai: true });
  }
  if (added.length === 0) return [...base];
  return [...base, ...added]
    .map((t, i) => ({ t, i }))
    .sort((a, b) => (SLOT[a.t.kind] ?? 9) - (SLOT[b.t.kind] ?? 9) || a.i - b.i)
    .map(({ t }) => t);
}

/**
 * Everything the pills row shows: the lexicon's tags merged with the AI verdict, then the
 * exclude applied. `lexicon` null (not loaded) → no tags, as wordTags.
 */
export function wordTagsWithAi(hanzi: string, lexicon: WordTagLexicon | null, ai: AiWordTags | null | undefined, options: WordTagOptions = {}): WordTag[] {
  if (!lexicon) return [];
  const merged = mergeAiWordTags(hanzi, wordTags(hanzi, lexicon, { rank: options.rank }), ai);
  const exclude = new Set(options.exclude ?? []);
  return merged.filter((t) => !exclude.has(t.kind));
}

/** The sheet for any pill: an AI pill's explanation (with the notice and the note), else the lexicon's. */
export function explainWordTag(tag: WordTag, hanzi: string, lexicon: WordTagLexicon | null, ai: AiWordTags | null | undefined): WordTagExplanation {
  if (!tag.ai) return wordTagExplanation(tag, hanzi, lexicon);
  if (tag.kind === 'transitivity') {
    const t = tag.id.slice('transitivity:'.length) as Exclude<Transitivity, 'n/a'>;
    const [title, body, example] = TRANSITIVITY_EXPLAIN[t] ?? [tag.label, '', ''];
    return { title, body, example, source: AI_SOURCE, ai: true };
  }
  if (tag.kind === 'separable') {
    const base = wordTagExplanation(tag, hanzi, null);
    return { ...base, example: '', source: AI_SOURCE, ai: true };
  }
  if (tag.kind === 'register') {
    const code = tag.id.slice('register:'.length);
    const note = ai?.register_note ?? '';
    return { title: REGISTER_LABELS[code] ?? tag.label, body: REGISTER_EXPLAIN[code] ?? '', example: '', source: AI_SOURCE, ai: true, ...(note ? { note } : {}) };
  }
  return { ...wordTagExplanation(tag, hanzi, lexicon), source: AI_SOURCE, ai: true };
}

/**
 * Cost model of the AI pass in tokens (measured on real batches): the fixed prompt + tool sent
 * with every batch, input per word, output per word (every word gets a verdict). $1 / M input,
 * $5 / M output.
 */
export const WORD_TAGS_COST = {
  promptTokens: 1000,
  inputTokensPerWord: 30,
  outputTokensPerWord: 32,
  outputTokensPerBatch: 30,
  usdPerInputToken: 1 / 1_000_000,
  usdPerOutputToken: 5 / 1_000_000,
} as const;

export function wordTagsCostUsd(inputTokens: number, outputTokens: number): number {
  return inputTokens * WORD_TAGS_COST.usdPerInputToken + outputTokens * WORD_TAGS_COST.usdPerOutputToken;
}

/** Estimated dollars to tag `words` notes. */
export function estimateWordTagsCost(words: number): number {
  const n = Math.max(0, Math.floor(words));
  const batches = Math.ceil(n / WORD_TAGS_BATCH_SIZE);
  return wordTagsCostUsd(
    batches * WORD_TAGS_COST.promptTokens + n * WORD_TAGS_COST.inputTokensPerWord,
    batches * WORD_TAGS_COST.outputTokensPerBatch + n * WORD_TAGS_COST.outputTokensPerWord,
  );
}
