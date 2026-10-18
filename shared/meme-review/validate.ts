/**
 * The validator of what the research agent hands in (worker services/meme-review/agent.ts,
 * `submit_issue`) and of any stored issue. It cleans as it goes and refuses only what can't be
 * shown:
 *
 * - every URL (sources, media) must be one the agent's web search / fetch actually RETURNED
 *   (`seenUrls`, compared with `urlKey`) — a URL the model wrote from memory is dropped;
 * - an item with no remaining source, a low-confidence origin, no meaning, or a headword that
 *   breaks the card standard (one clean form) is dropped;
 * - pinyin is RE-DERIVED from the hanzi with the app's own path (`derivePinyin`: pinyin-pro + the
 *   一 / 不 tone changes) — the model's pinyin only lends its word spacing when its syllables are
 *   exactly the derived ones (`rederivePinyin`);
 * - media platform / kind / YouTube thumbnail are worked out here, never taken from the model.
 *
 * `problems` (fatal: fewer than MEME_LIMITS.itemsMin items, no title, too few quiz questions…)
 * go back to the agent for a repair round, together with the `notes` (what was dropped and why).
 */
import { cardTextProblems } from '../cards/standard';
import { pinyinSyllables, syllableTone, toneless } from '../pinyin/toneChange';
import { cleanUrl, coverageWindow, isMemeMonth, mediaKindOf, platformOf, urlKey, youtubeThumbnail } from './rules';
import {
  MEME_REVIEW_VERSION,
  type MemeIssue,
  type MemeItem,
  type MemeLine,
  type MemeMedia,
  type MemeQuizQuestion,
  type MemeRegister,
  type MemeRelated,
  type MemeSource,
  type MemeVerdict,
} from './types';

export const MEME_LIMITS = {
  itemsMin: 6,
  itemsMax: 10,
  examplesMin: 1,
  examplesMax: 3,
  sourcesMax: 3,
  mediaMax: 3,
  relatedMax: 4,
  quizMin: 3,
  quizMax: 5,
  headwordChars: 24,
  line: 400,
  text: 700,
} as const;

const HAN = /\p{Script=Han}/u;

const str = (v: unknown, max: number = MEME_LIMITS.text): string => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;

/** The app's automatic pinyin of a line (null when it has no Chinese). */
export type DerivePinyin = (hanzi: string) => string | null;

const pinyinKey = (s: string) => s.normalize('NFC').toLowerCase().replace(/v/g, 'ü').replace(/[^a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü]/g, '');

/** Characters often read in the neutral tone after another syllable (子 dāzi, 们, 的, 了…). */
const NEUTRAL_OK = new Set(Array.from('子么们的了着过吗呢吧啊呀嘛啦得地个头上下里边气西候道实识量方服夫生思情匠'));

/**
 * The model wrote a NEUTRAL tone where the automatic pinyin has a full one, on a character that is
 * often neutral (搭子 "dāzi", pinyin-pro "dā zǐ") or the second of a doubled character (看看) — and
 * every other syllable is the same. Only for pure-Chinese lines whose syllables line up 1:1.
 */
function neutralOnly(hanzi: string, model: string, derived: string): boolean {
  const chars = Array.from(hanzi).filter((c) => HAN.test(c));
  const letters = (s: string) => s.normalize('NFC').replace(/[^\p{L}\s]/gu, ' ');
  const ms = pinyinSyllables(letters(model));
  const ds = pinyinSyllables(letters(derived));
  if (!ms || !ds || ms.length !== ds.length || ms.length !== chars.length || Array.from(hanzi).some((c) => /[A-Za-z0-9]/.test(c))) return false;
  let neutral = 0;
  const ok = ms.every((m, i) => {
    const d = ds[i];
    if (m.toLowerCase() === d.toLowerCase()) return true;
    if (toneless(m) !== toneless(d) || syllableTone(m) !== 5 || i === 0) return false;
    neutral += 1;
    return NEUTRAL_OK.has(chars[i]) || chars[i] === chars[i - 1];
  });
  return ok && neutral > 0;
}

/**
 * The pinyin shown for `hanzi`: the app's own (`derive`). The model's pinyin is kept only when its
 * letters and tones are exactly the derived ones (it then lends its word spacing: "fā fēng" →
 * "fāfēng"), or differ only by a neutral tone on a typically neutral syllable (`neutralOnly`);
 * anything else (a wrong tone, a missed 一 / 不 change, another reading) loses.
 */
export function rederivePinyin(hanzi: string, modelPinyin: unknown, derive: DerivePinyin): string {
  const derived = (derive(hanzi) ?? '').trim();
  if (!derived) return '';
  const model = typeof modelPinyin === 'string' ? modelPinyin.trim().replace(/\s+/g, ' ') : '';
  if (!model || HAN.test(model)) return derived;
  if (pinyinKey(model) === pinyinKey(derived) || neutralOnly(hanzi, model, derived)) return model;
  return derived;
}

export interface MemeValidateContext {
  month: string;
  /** The weeks it covers; default: the 56 days before `today`. */
  covers?: { from: string; to: string };
  /** "YYYY-MM-DD" the issue is written (for the default `covers`). */
  today?: string;
  /** Every URL the agent's tools returned (search results, fetched pages, citations). */
  seenUrls: Iterable<string>;
  derivePinyin: DerivePinyin;
}

export interface MemeValidation {
  issue: MemeIssue | null;
  /** Fatal: the issue can't be shown — the agent repairs these. */
  problems: string[];
  /** What was dropped or fixed, and why. */
  notes: string[];
}

function line(raw: unknown, derive: DerivePinyin, max: number = MEME_LIMITS.line): MemeLine | null {
  const o = obj(raw);
  const hanzi = str(o.hanzi, max);
  if (!hanzi || !HAN.test(hanzi)) return null;
  return { hanzi, pinyin: rederivePinyin(hanzi, o.pinyin, derive), english: str(o.english, max) };
}

function links(
  raw: unknown,
  seen: Set<string>,
  max: number,
  label: string,
  notes: string[],
): Array<{ url: string; title: string }> {
  const out: Array<{ url: string; title: string }> = [];
  const keys = new Set<string>();
  for (const r of arr(raw)) {
    const o = typeof r === 'string' ? { url: r } : obj(r);
    const url = cleanUrl(o.url);
    const key = urlKey(o.url);
    if (!url || !key) {
      if (o.url) notes.push(`${label}: "${str(o.url, 120)}" is not a web address — dropped`);
      continue;
    }
    if (!seen.has(key)) {
      notes.push(`${label}: ${str(url, 160)} was not in your search / fetch results — dropped (only cite URLs the tools returned)`);
      continue;
    }
    if (keys.has(key)) continue;
    keys.add(key);
    out.push({ url, title: str(o.title, 160) });
    if (out.length >= max) break;
  }
  return out;
}

function register(raw: unknown): MemeRegister {
  const o = obj(raw);
  return {
    who: str(o.who, 120),
    tone: str(o.tone, 120),
    where: oneOf(o.where, ['online', 'spoken', 'both'] as const, 'online'),
    crude: o.crude === true,
    note: str(o.note, MEME_LIMITS.line),
  };
}

function item(raw: unknown, index: number, ctx: { seen: Set<string>; derive: DerivePinyin; notes: string[] }): MemeItem | null {
  const o = obj(raw);
  const hanzi = str(o.hanzi, MEME_LIMITS.headwordChars + 1);
  const name = hanzi || `item ${index + 1}`;
  const drop = (why: string) => {
    ctx.notes.push(`"${name}": ${why} — dropped`);
    return null;
  };
  if (!hanzi || !HAN.test(hanzi)) return drop('no Chinese headword');
  if (Array.from(hanzi).length > MEME_LIMITS.headwordChars) return drop(`the headword is longer than ${MEME_LIMITS.headwordChars} characters`);
  const cardProblems = cardTextProblems({ hanzi });
  if (cardProblems.length > 0) return drop(`the headword must be ONE clean form (${cardProblems[0].message})`);

  const origin = obj(o.origin);
  const confidence = oneOf(origin.confidence, ['high', 'medium', 'low'] as const, 'low');
  if (confidence === 'low') return drop('origin confidence is low');

  const meaningZh = str(o.meaning_zh, MEME_LIMITS.line);
  if (!meaningZh || !HAN.test(meaningZh)) return drop('no meaning_zh');

  const sources: MemeSource[] = links(o.sources, ctx.seen, 3, `"${name}" source`, ctx.notes).map((l) => ({ ...l, platform: platformOf(l.url) }));
  if (sources.length === 0) return drop('no source from your search results');

  const media: MemeMedia[] = links(o.media, ctx.seen, MEME_LIMITS.mediaMax, `"${name}" media`, ctx.notes).map((l) => {
    const platform = platformOf(l.url);
    return { ...l, platform, kind: mediaKindOf(platform), thumbnail_url: platform === 'youtube' ? youtubeThumbnail(l.url) : null };
  });

  const examples = arr(o.examples)
    .map((e) => line(e, ctx.derive, 160))
    .filter((e): e is MemeLine => !!e)
    .slice(0, MEME_LIMITS.examplesMax);
  if (examples.length < MEME_LIMITS.examplesMin) return drop('no example lines');

  const related: MemeRelated[] = [];
  for (const r of arr(o.related)) {
    const x = line(r, ctx.derive, 40);
    if (!x || x.hanzi === hanzi || related.some((y) => y.hanzi === x.hanzi)) continue;
    related.push(x);
    if (related.length >= MEME_LIMITS.relatedMax) break;
  }

  const say = obj(o.would_you_say_it ?? o.say_it);
  const english = str(o.english, 160);
  return {
    id: '',
    hanzi,
    pinyin: rederivePinyin(hanzi, o.pinyin, ctx.derive),
    english,
    meaning: { hanzi: meaningZh, pinyin: rederivePinyin(meaningZh, o.meaning_pinyin, ctx.derive), english: str(o.meaning_en, MEME_LIMITS.line) },
    origin: { text: str(origin.text, MEME_LIMITS.text), when: str(origin.when, 80), confidence },
    examples,
    register: register(o.register),
    say_it: { verdict: oneOf<MemeVerdict>(say.verdict, ['fine', 'cute', 'cringe', 'avoid'], 'fine'), note: str(say.note, MEME_LIMITS.line) },
    related,
    sources,
    media,
    picture: { prompt: str(o.illustration_prompt, MEME_LIMITS.line) || `${english || hanzi}: a playful cartoon scene`, image_key: null },
  };
}

function quiz(raw: unknown, items: MemeItem[], notes: string[]): MemeQuizQuestion[] {
  const out: MemeQuizQuestion[] = [];
  arr(raw).forEach((q, i) => {
    const o = obj(q);
    const prompt = str(o.prompt, 300);
    const options = arr(o.options).map((x) => str(x, 200)).filter(Boolean);
    const answer = typeof o.answer === 'number' && Number.isInteger(o.answer) ? o.answer : -1;
    if (!prompt || options.length < 2 || options.length > 5 || new Set(options).size !== options.length || answer < 0 || answer >= options.length) {
      notes.push(`quiz question ${i + 1}: needs a prompt, 2–5 different options and the index of the right one — dropped`);
      return;
    }
    const about = str(o.item_hanzi, 40);
    const item = about ? items.find((it) => it.hanzi === about) : undefined;
    out.push({ prompt, options, answer, explanation: str(o.explanation, MEME_LIMITS.line), item_id: item?.id ?? null });
  });
  return out.slice(0, MEME_LIMITS.quizMax);
}

/** Validate + clean a submitted (or stored) issue. Pure. */
export function validateMemeIssue(raw: unknown, ctx: MemeValidateContext): MemeValidation {
  const problems: string[] = [];
  const notes: string[] = [];
  const o = obj(raw);
  if (!isMemeMonth(ctx.month)) problems.push(`"${ctx.month}" is not a month (YYYY-MM)`);

  const seen = new Set<string>();
  for (const u of ctx.seenUrls) {
    const k = urlKey(u);
    if (k) seen.add(k);
  }

  const items: MemeItem[] = [];
  arr(o.items).forEach((r, i) => {
    const it = item(r, i, { seen, derive: ctx.derivePinyin, notes });
    if (!it) return;
    if (items.some((x) => x.hanzi === it.hanzi)) {
      notes.push(`"${it.hanzi}" appears twice — kept the first`);
      return;
    }
    items.push(it);
  });
  if (items.length > MEME_LIMITS.itemsMax) {
    notes.push(`${items.length} memes — kept the first ${MEME_LIMITS.itemsMax}`);
    items.length = MEME_LIMITS.itemsMax;
  }
  items.forEach((it, i) => {
    it.id = `m${i + 1}`;
  });
  if (items.length < MEME_LIMITS.itemsMin) {
    problems.push(`only ${items.length} usable meme${items.length === 1 ? '' : 's'} — an issue needs ${MEME_LIMITS.itemsMin}–${MEME_LIMITS.itemsMax} (each with a source from your search results and medium or high confidence)`);
  }

  const title = str(o.title, 40);
  if (!title || !HAN.test(title)) problems.push('title (Chinese) is missing');
  const intro = line({ hanzi: o.intro_zh, pinyin: o.intro_pinyin, english: o.intro_en }, ctx.derivePinyin, MEME_LIMITS.text);
  if (!intro) problems.push('intro_zh is missing');

  const questions = quiz(o.quiz, items, notes);
  if (questions.length < MEME_LIMITS.quizMin) problems.push(`the quiz needs ${MEME_LIMITS.quizMin}–${MEME_LIMITS.quizMax} questions (has ${questions.length} usable)`);

  if (problems.length > 0) return { issue: null, problems, notes };
  const covers = ctx.covers ?? coverageWindow(ctx.today ?? new Date().toISOString().slice(0, 10));
  return {
    issue: {
      month: ctx.month,
      title,
      title_en: str(o.title_en, 120),
      intro: intro as MemeLine,
      covers,
      items,
      quiz: questions,
      generator_version: MEME_REVIEW_VERSION,
    },
    problems,
    notes,
  };
}

/**
 * A stored issue read back (its URLs were checked when it was written): shape-checked, with the
 * stored pinyin and pictures kept. null when it no longer parses.
 */
export function parseStoredMemeIssue(raw: unknown): MemeIssue | null {
  const o = obj(raw);
  if (!isMemeMonth(o.month) || !Array.isArray(o.items) || o.items.length === 0) return null;
  const items = o.items.filter((x) => {
    const it = obj(x);
    return typeof it.hanzi === 'string' && typeof it.id === 'string' && obj(it.meaning).hanzi && Array.isArray(it.examples) && Array.isArray(it.sources);
  }) as MemeItem[];
  if (items.length === 0) return null;
  return { ...(o as unknown as MemeIssue), items, quiz: Array.isArray(o.quiz) ? (o.quiz as MemeQuizQuestion[]) : [] };
}
