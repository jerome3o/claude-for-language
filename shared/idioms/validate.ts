/**
 * Validation of what the idiom generator returns (worker/src/services/idioms.ts) and of any
 * stored entry. Cleans as it goes: trims and caps strings, applies the 一 / 不 tone changes to
 * every pinyin (card standard), lines the literal row up with the idiom's own syllables, drops
 * example sentences that break the card standard or don't contain the idiom, and drops broken
 * quiz questions — but refuses (problems) an entry too broken to read.
 */
import { cardTextProblems } from '../cards/standard';
import { applyYiBuToneChanges, pinyinSyllables } from '../pinyin/toneChange';
import { normalizeIdiomHanzi } from './normalize';
import {
  IDIOM_ROLES,
  type IdiomChar,
  type IdiomConfidence,
  type IdiomEntry,
  type IdiomLine,
  type IdiomOriginKind,
  type IdiomQuizQuestion,
  type IdiomRef,
  type IdiomRegister,
  type IdiomSentiment,
} from './types';

export const IDIOM_LIMITS = {
  storyParagraphs: 8,
  paragraphChars: 220,
  examplesMin: 2,
  examplesMax: 5,
  collocations: 5,
  refs: 4,
  quizMin: 1,
  quizMax: 4,
  text: 600,
} as const;

const HAN = /\p{Script=Han}/u;
const TONE_NUMBER = /[a-zü]+[1-5](?=\s|$|[,.;!?])/i;

const str = (v: unknown, max: number = IDIOM_LIMITS.text): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const strOrNull = (v: unknown, max: number = IDIOM_LIMITS.text): string | null => str(v, max) || null;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;

function line(raw: unknown): IdiomLine | null {
  const o = obj(raw);
  const hanzi = str(o.hanzi, IDIOM_LIMITS.paragraphChars);
  if (!hanzi || !HAN.test(hanzi)) return null;
  const pinyin = str(o.pinyin, IDIOM_LIMITS.paragraphChars * 6);
  return { hanzi, pinyin: pinyin ? applyYiBuToneChanges(hanzi, pinyin) : '', english: str(o.english) };
}

function ref(raw: unknown, self: string): IdiomRef | null {
  const o = obj(raw);
  const hanzi = normalizeIdiomHanzi(str(o.hanzi, 40));
  const n = Array.from(hanzi).length;
  if (!hanzi || hanzi === self || n < 2 || n > 12 || !Array.from(hanzi).every((c) => HAN.test(c))) return null;
  const pinyin = str(o.pinyin, 80);
  return { hanzi, pinyin: pinyin ? applyYiBuToneChanges(hanzi, pinyin) : '', english: str(o.english, 160) };
}

function refs(raw: unknown, self: string): IdiomRef[] {
  const seen = new Set<string>();
  const out: IdiomRef[] = [];
  for (const r of arr(raw)) {
    const x = ref(r, self);
    if (!x || seen.has(x.hanzi)) continue;
    seen.add(x.hanzi);
    out.push(x);
    if (out.length >= IDIOM_LIMITS.refs) break;
  }
  return out;
}

function quizQuestion(raw: unknown): IdiomQuizQuestion | null {
  const o = obj(raw);
  const prompt = str(o.prompt, 300);
  const options = arr(o.options).map((x) => str(x, 200)).filter(Boolean);
  const answer = typeof o.answer === 'number' && Number.isInteger(o.answer) ? o.answer : -1;
  if (!prompt || options.length < 2 || options.length > 4) return null;
  if (new Set(options).size !== options.length) return null;
  if (answer < 0 || answer >= options.length) return null;
  return { kind: oneOf(o.kind, ['meaning', 'fit'] as const, 'meaning'), prompt, options, answer, explanation: str(o.explanation, 300) };
}

export interface IdiomCheck {
  entry: IdiomEntry | null;
  problems: string[];
}

/**
 * Check (and clean) an entry for `requested` (the normalised key). An entry whose hanzi is not
 * the requested idiom is a problem — the caller decides (the generator's "did you mean").
 */
export function checkIdiomEntry(raw: unknown, requested?: string): IdiomCheck {
  const problems: string[] = [];
  const o = obj(raw);
  const hanzi = normalizeIdiomHanzi(str(o.hanzi, 40));
  const chars = Array.from(hanzi);
  if (!hanzi) problems.push('hanzi is missing');
  else if (!chars.every((c) => HAN.test(c))) problems.push(`hanzi "${hanzi}" must be Chinese characters only`);
  if (requested && hanzi && hanzi !== requested) problems.push(`hanzi "${hanzi}" is not the requested idiom "${requested}"`);

  let pinyin = str(o.pinyin, 120);
  if (!pinyin) problems.push('pinyin is missing');
  else if (TONE_NUMBER.test(pinyin)) problems.push(`pinyin "${pinyin}" uses tone numbers — use tone marks`);
  if (pinyin && hanzi) pinyin = applyYiBuToneChanges(hanzi, pinyin);

  // The literal row: one per character, in order; its pinyin follows the idiom's own syllables.
  const literalRaw = arr(o.literal).map(obj);
  const syllables = pinyin ? pinyinSyllables(pinyin) : null;
  const literal: IdiomChar[] = chars.map((ch, i) => {
    // The row at the same position, unless the model skipped / reordered one: then the first row for this character.
    const r = str(literalRaw[i]?.hanzi, 4) === ch ? literalRaw[i] : (literalRaw.find((x) => str(x.hanzi, 4) === ch) ?? literalRaw[i] ?? {});
    const own = str(r.pinyin, 12);
    return {
      hanzi: ch,
      pinyin: syllables && syllables.length === chars.length ? syllables[i] : own,
      gloss: str(r.gloss, 80),
    };
  });
  if (chars.length && literal.filter((c) => c.gloss).length < chars.length) problems.push('literal needs a gloss for every character');

  const meaning = str(o.meaning, 300);
  if (!meaning) problems.push('meaning is missing');
  const explanationZh = str(o.explanation_zh, 200);
  if (!explanationZh) problems.push('explanation_zh is missing');
  const explanationPinyinRaw = str(o.explanation_pinyin, 800);

  // 典故
  const originRaw = obj(o.origin);
  const kind = oneOf<IdiomOriginKind>(originRaw.kind, ['classical', 'folk', 'modern', 'uncertain'], 'uncertain');
  const story = arr(originRaw.story).map(line).filter((x): x is IdiomLine => !!x).slice(0, IDIOM_LIMITS.storyParagraphs);
  if ((kind === 'classical' || kind === 'folk') && story.length === 0) problems.push('origin.story needs at least one paragraph for a classical or folk idiom');
  const summary = str(originRaw.summary, 400);
  if (!summary) problems.push('origin.summary is missing');
  let source = strOrNull(originRaw.source, 80);
  let note = strOrNull(originRaw.note, 400);
  // Honesty: an uncertain / modern origin never carries a source it couldn't name.
  if (kind === 'uncertain' && !note) note = 'The origin of this idiom is uncertain.';
  if (kind === 'modern') source = source && /《/.test(source) ? source : null;

  // 用法
  const usageRaw = obj(o.usage);
  const roles = [...new Set(arr(usageRaw.roles).map((r) => str(r, 8)).filter((r) => r in IDIOM_ROLES))];
  if (roles.length === 0) problems.push(`usage.roles needs at least one of ${Object.keys(IDIOM_ROLES).join(' ')}`);
  const examples = arr(usageRaw.examples)
    .map(line)
    .filter((x): x is IdiomLine => !!x && !!hanzi && x.hanzi.includes(hanzi) && cardTextProblems({ sentence_clue: x.hanzi }).length === 0 && !!x.english)
    .slice(0, IDIOM_LIMITS.examplesMax);
  if (examples.length < IDIOM_LIMITS.examplesMin) {
    problems.push(`usage.examples needs at least ${IDIOM_LIMITS.examplesMin} sentences that contain ${hanzi || 'the idiom'} exactly, each with pinyin and English, no brackets or slashes`);
  }
  const collocations = arr(usageRaw.collocations).map(line).filter((x): x is IdiomLine => !!x).slice(0, IDIOM_LIMITS.collocations);

  const quiz = arr(o.quiz).map(quizQuestion).filter((x): x is IdiomQuizQuestion => !!x).slice(0, IDIOM_LIMITS.quizMax);
  if (quiz.length < IDIOM_LIMITS.quizMin) problems.push('quiz needs at least one question with 2–4 different options and a valid answer index');

  if (problems.length) return { entry: null, problems };
  return {
    entry: {
      hanzi,
      pinyin,
      literal,
      literal_english: str(o.literal_english, 200),
      meaning,
      explanation_zh: explanationZh,
      explanation_pinyin: explanationPinyinRaw ? applyYiBuToneChanges(explanationZh, explanationPinyinRaw) : '',
      origin: { kind, source, era: strOrNull(originRaw.era, 60), summary, story, note },
      usage: {
        roles,
        register: oneOf<IdiomRegister>(usageRaw.register, ['written', 'spoken', 'both'], 'both'),
        sentiment: oneOf<IdiomSentiment>(usageRaw.sentiment, ['praise', 'criticism', 'neutral'], 'neutral'),
        note: str(usageRaw.note, 300),
        collocations,
        examples,
        mistake: str(usageRaw.mistake, 400),
      },
      synonyms: refs(o.synonyms, hanzi),
      antonyms: refs(o.antonyms, hanzi),
      quiz,
      confidence: oneOf<IdiomConfidence>(o.confidence, ['high', 'medium', 'low'], 'medium'),
      confidence_note: strOrNull(o.confidence_note, 300),
    },
    problems: [],
  };
}

export type IdiomGeneration =
  | { kind: 'idiom'; entry: IdiomEntry }
  | { kind: 'not_idiom'; reason: string; suggestion: string | null };

export class IdiomValidationError extends Error {
  constructor(public readonly problems: string[]) {
    super(`The idiom entry has problems: ${problems.join('; ')}`);
  }
}

/**
 * The generator's whole answer: an entry, or "not a 成语" (with the idiom it probably meant).
 * Throws IdiomValidationError on a broken entry (structuredCall retries it).
 */
export function validateIdiomGeneration(raw: unknown, requested: string): IdiomGeneration {
  const o = obj(raw);
  const didYouMean = normalizeIdiomHanzi(str(o.did_you_mean, 40));
  const suggestion = didYouMean && didYouMean !== requested && Array.from(didYouMean).every((c) => HAN.test(c)) ? didYouMean : null;
  if (o.is_idiom === false) {
    return { kind: 'not_idiom', reason: str(o.not_idiom_reason, 300) || `${requested} doesn’t look like a 成语.`, suggestion };
  }
  const returned = normalizeIdiomHanzi(str(o.hanzi, 40));
  if (returned && returned !== requested) {
    // The model wrote up a different idiom (a typo in the request): offer it instead.
    return { kind: 'not_idiom', reason: `${requested} doesn’t look like a 成语.`, suggestion: suggestion ?? returned };
  }
  const { entry, problems } = checkIdiomEntry(raw, requested);
  if (!entry) throw new IdiomValidationError(problems);
  return { kind: 'idiom', entry };
}
