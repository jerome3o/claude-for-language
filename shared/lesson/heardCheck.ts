/**
 * What the ear can't tell (Nov 2026). Jerome heard 她责怪我 (tā zéguài wǒ, "She blamed me.") in Hard mode's
 * "👂 What does it mean?", answered "He blames me." and got "≈ Nearly · Wrong subject: "he" instead of "she"" with
 * a tip about 她 vs 他: "The gender of this is impossible for me to know if I'm just listening to it."
 *
 * A check where the learner only HEARD the Chinese (`isHeardOnlyCheck`: listen_translate — the Sentence round's
 * listen slot and a mini lesson's "Listen and translate", answered in English or in Chinese) never counts against
 * them what the audio can't carry:
 * - 他 / 她 / 它 (and 他们 / 她们 / 它们) all sound tā(men): he / she / it, him / her, his / her / its are one answer
 *   wherever the Chinese has one of them;
 * - a tense or aspect the Chinese doesn't mark (no 了 / 过 / 在 / 会 / 将 / time word… — `UNHEARD_TENSE_MARKERS`):
 *   "blames" = "blamed" = "is blaming" = "will blame";
 * - singular vs plural ("a book" = "books").
 * I vs you, who did what to whom, a wrong verb or object, a negation and a tense the Chinese DOES mark still count.
 * A check where the learner SAW the hanzi (translate, read aloud) stays strict.
 *
 * The prompts say it (services/answer-check.ts); `forgiveUnheard` makes sure of it, conservatively, after the
 * model: a non-right verdict is upgraded to right with no tip when (A) the answer IS the reference once those
 * differences are neutralised (`heardMeaningKey`; in Chinese `taKey`), or (B) every line of the check
 * (headline + tips) only complains about them (`unheardPronounLine` / `unheardTenseLine`; in Chinese, the
 * correction only swaps 他 / 她 / 它). Applied by the worker and by both apps on every check they receive or
 * read from their cache. Lab port: core `HeardCheck.kt`, parity-tested (parity/fixtures/heard-check.ts).
 * docs/STUDY_SESSION.md "What the ear can't tell".
 */
import { checkKey, hasHan, isMeaningCheck, type AnswerCheck, type AnswerCheckInput } from './answerCheck';

/** The checks where the learner only heard the Chinese (never saw the hanzi). */
export function isHeardOnlyCheck(input: Pick<AnswerCheckInput, 'exercise_type'>): boolean {
  return input.exercise_type === 'listen_translate';
}

/** The Chinese the learner heard: a meaning check's prompt, else the model answer. */
export function heardChinese(input: Pick<AnswerCheckInput, 'exercise_type' | 'answer' | 'model_answer' | 'prompt_en'>): string {
  return isMeaningCheck(input) ? input.prompt_en : input.model_answer;
}

/** 他 / 她 / 它 (and the old 牠 / 祂): one sound, tā. */
export const TA_PRONOUNS = '他她它牠祂';
const isTa = (ch: string) => TA_PRONOUNS.includes(ch);

/** Does the Chinese carry a tā pronoun (他 / 她 / 它, 他们…)? */
export function hasTaPronoun(zh: string): boolean {
  return Array.from(zh).some(isTa);
}

/** A Chinese text compared by ear: `checkKey` with 她 / 它 / 牠 / 祂 read as 他. */
export function taKey(s: string): string {
  return Array.from(checkKey(s), (ch) => (isTa(ch) ? '他' : ch)).join('');
}

/**
 * What fixes a tense / aspect in a Chinese sentence: aspect particles, 会 / 将 / 要, 没 (= didn't), 已经 / 曾经 / 刚 /
 * 正在, and time words. Conservative: any of them anywhere (了 in 为了, 在 as "at", 要 as "want" too) = marked.
 */
export const UNHEARD_TENSE_MARKERS: readonly string[] = [
  '了', '过', '着', '在', '会', '将', '要', '没', '刚', '已', '曾', '正', '昨',
  '明天', '明年', '明早', '明晚', '前天', '后天', '前年', '后年', '去年', '上个', '下个', '上周', '下周', '上星期', '下星期',
  '上次', '下次', '以前', '以后', '之前', '之后', '将来', '未来', '马上', '快要', '就要', '待会', '等会', '从前', '当时',
  '那时', '后来', '早就', '今后',
];

/** Does the Chinese fix the tense / aspect (`UNHEARD_TENSE_MARKERS`)? */
export function marksTense(zh: string): boolean {
  const text = zh.normalize('NFKC');
  return UNHEARD_TENSE_MARKERS.some((m) => text.includes(m));
}

// ============ English compared by ear ============

const ARTICLES = new Set(['a', 'an', 'the']);
const PRONOUN_KEY: Record<string, string> = {
  he: 'ta', she: 'ta', it: 'ta', him: 'ta', her: 'ta', his: 'ta', hers: 'ta', its: 'ta',
  himself: 'taself', herself: 'taself', itself: 'taself',
};
/** Third-person singular pronouns (what tā can be). */
export const THIRD_PERSON_WORDS: readonly string[] = Object.keys(PRONOUN_KEY);
const AUX_DROPPED = new Set(['will', 'shall', 'do', 'does', 'did']);
const AUX_BE = new Set(['am', 'is', 'are', 'was', 'were', 'be', 'been', 'being']);
const AUX_HAVE = new Set(['has', 'have', 'had']);
/** Subjects whose 's is "is" (she's = she is). */
const S_IS = new Set(['he', 'she', 'it', 'that', 'there', 'what', 'who', 'here', 'where']);

/** Irregular verbs: [base, past / participle forms…]. */
const IRREGULAR_VERBS: ReadonlyArray<readonly string[]> = [
  ['go', 'went', 'gone'], ['see', 'saw', 'seen'], ['eat', 'ate', 'eaten'], ['come', 'came'], ['take', 'took', 'taken'],
  ['give', 'gave', 'given'], ['say', 'said'], ['tell', 'told'], ['buy', 'bought'], ['think', 'thought'], ['make', 'made'],
  ['find', 'found'], ['get', 'got', 'gotten'], ['leave', 'left'], ['meet', 'met'], ['run', 'ran'], ['write', 'wrote', 'written'],
  ['speak', 'spoke', 'spoken'], ['feel', 'felt'], ['know', 'knew', 'known'], ['sit', 'sat'], ['stand', 'stood'],
  ['begin', 'began', 'begun'], ['bring', 'brought'], ['hear', 'heard'], ['keep', 'kept'], ['sleep', 'slept'], ['lose', 'lost'],
  ['pay', 'paid'], ['send', 'sent'], ['spend', 'spent'], ['teach', 'taught'], ['understand', 'understood'], ['win', 'won'],
  ['drink', 'drank', 'drunk'], ['forget', 'forgot', 'forgotten'], ['fall', 'fell', 'fallen'], ['break', 'broke', 'broken'],
  ['choose', 'chose', 'chosen'], ['drive', 'drove', 'driven'], ['fly', 'flew', 'flown'], ['grow', 'grew', 'grown'],
  ['throw', 'threw', 'thrown'], ['wear', 'wore', 'worn'], ['catch', 'caught'], ['fight', 'fought'], ['hold', 'held'],
  ['lend', 'lent'], ['build', 'built'], ['sell', 'sold'], ['sing', 'sang', 'sung'], ['swim', 'swam', 'swum'],
  ['ride', 'rode', 'ridden'], ['wake', 'woke', 'woken'], ['steal', 'stole', 'stolen'], ['hide', 'hid', 'hidden'],
  ['draw', 'drew', 'drawn'], ['feed', 'fed'], ['lead', 'led'], ['mean', 'meant'], ['do', 'did', 'done'],
  ['be', 'was', 'were', 'been'], ['have', 'had'],
];
/** Other forms the suffix rules can't reach. */
const EXTRA_FORMS: Record<string, string> = {
  goes: 'go', going: 'go', does: 'do', doing: 'do', has: 'have', having: 'have',
  am: 'be', is: 'be', are: 'be', being: 'be', sees: 'see', seeing: 'see',
};
const PAST_FORMS = new Set(IRREGULAR_VERBS.flatMap((v) => v.slice(1)));
const UNDOUBLE = new Set(['b', 'd', 'g', 'm', 'n', 'p', 'r', 't']);

function undouble(s: string): string {
  const n = s.length;
  return n >= 4 && s[n - 1] === s[n - 2] && UNDOUBLE.has(s[n - 1]) ? s.slice(0, -1) : s;
}

/** Plural / 3rd-person -s off (boxes → box, tries → try, books → book); 3 letters or fewer untouched. */
export function pluralStem(t: string): string {
  if (t.length <= 3) return t;
  if (t.endsWith('ies')) return `${t.slice(0, -3)}y`;
  if (/(?:s|x|z|ch|sh)es$/.test(t)) return t.slice(0, -2);
  if (t.endsWith('s') && !/(?:ss|us|is)$/.test(t)) return t.slice(0, -1);
  return t;
}

/** A word's stem by the regular suffix rules (blames / blamed / blaming / blame → blam). */
function regularStem(t: string): string {
  if (t.length <= 3) return t;
  let s: string;
  if (t.endsWith('ied') && t.length > 4) s = `${t.slice(0, -3)}y`;
  else if (t.endsWith('ing') && t.length > 5) s = undouble(t.slice(0, -3));
  else if (t.endsWith('ed') && t.length > 4) s = undouble(t.slice(0, -2));
  else s = pluralStem(t);
  if (s.length > 3 && s.endsWith('e')) s = s.slice(0, -1);
  return s;
}

const IRREGULAR_STEM = new Map<string, string>();
for (const [base, ...forms] of IRREGULAR_VERBS) for (const f of forms) IRREGULAR_STEM.set(f, regularStem(base));
for (const [form, base] of Object.entries(EXTRA_FORMS)) IRREGULAR_STEM.set(form, regularStem(base));

/** A verb's (or noun's) tense-free stem: went = go = goes, blamed = blames = blame. */
export function tenseStem(t: string): string {
  return IRREGULAR_STEM.get(t) ?? regularStem(t);
}

/** "-ing", "-ed" or an irregular past form: the word after an auxiliary that makes it one. */
function verbish(t: string): boolean {
  return (t.endsWith('ing') && t.length > 4) || (t.endsWith('ed') && t.length > 3) || PAST_FORMS.has(t);
}

/** One written word → its words (didn't → did not, she's → she is, won't → will not). */
function expand(token: string): string[] {
  if (token === "won't") return ['will', 'not'];
  if (token === "can't" || token === 'cannot') return ['can', 'not'];
  if (token === "shan't") return ['shall', 'not'];
  if (token === "ain't") return ['is', 'not'];
  const cut = (n: number, word: string) => [token.slice(0, -n), word];
  if (token.endsWith("n't")) return cut(3, 'not');
  if (token.endsWith("'ll")) return cut(3, 'will');
  if (token.endsWith("'re")) return cut(3, 'are');
  if (token.endsWith("'ve")) return cut(3, 'have');
  if (token.endsWith("'m")) return cut(2, 'am');
  if (token.endsWith("'d")) return cut(2, 'd');
  if (token.endsWith("'s") && S_IS.has(token.slice(0, -2))) return cut(2, 'is');
  return [token.replace(/'/g, '')];
}

/** An English line's words: lower case, apostrophes kept for the contractions, then expanded. */
export function englishWords(text: string): string[] {
  const s = text.normalize('NFKC').toLowerCase().replace(/[’‘`]/g, "'");
  return s.split(/[^\p{L}\p{N}']+/u).filter(Boolean).flatMap(expand).filter((t) => t.length > 0 && t !== "'");
}

/**
 * An English meaning compared by ear: articles dropped, plural -s off; with `pronouns` he / she / it (him / her,
 * his / her / its…) are one word; with `tense` the auxiliaries of tense (will, did, is …-ing, has …-ed) go and every
 * word is reduced to its tense-free stem. Negation (not), the other persons and every content word stay.
 */
export function heardMeaningKey(text: string, opts: { pronouns: boolean; tense: boolean }): string {
  let toks = englishWords(text).filter((t) => !ARTICLES.has(t));
  if (opts.pronouns) toks = toks.map((t) => PRONOUN_KEY[t] ?? t);
  if (opts.tense) {
    const out: string[] = [];
    toks.forEach((t, i) => {
      if (AUX_DROPPED.has(t)) return;
      if (AUX_BE.has(t) || AUX_HAVE.has(t)) {
        let j = i + 1;
        while (toks[j] === 'not') j++;
        if (j < toks.length && verbish(toks[j])) return;
        out.push(AUX_BE.has(t) ? 'be' : 'have');
        return;
      }
      out.push(t);
    });
    toks = out;
  }
  return toks.map((t) => (opts.tense ? tenseStem(t) : pluralStem(t))).join(' ');
}

// ============ The check's own lines ============

// English words matched with explicit ASCII edges (never `\b`), so the Lab's Java regexes agree character for character.
const W = (words: string) => `(?<![A-Za-z0-9_])(?:${words})(?![A-Za-z0-9_])`;
const THIRD_RE = new RegExp(W(THIRD_PERSON_WORDS.join('|')), 'gi');
const THIRD_ONE = new RegExp(W(THIRD_PERSON_WORDS.join('|')), 'i');
const FIRST_SECOND = new RegExp(W('i|me|my|mine|myself|you|your|yours|yourself|we|us|our|ours|they|them|their|theirs'), 'i');
const GENDER_CUE = new RegExp(W('gender|genders|pronoun|pronouns|male|female|masculine|feminine|man|woman|animate|inanimate'), 'i');
const TENSE_CUE = new RegExp(W('tense|tenses|past|present|future|aspect'), 'i');
/** Anything else a line can be about: a negation, a missed part, the verb, place / time, number, roles swapped. */
const OTHER_ISSUE = new RegExp(W([
  'negat[a-z]*', 'never', 'opposite', 'missed', 'missing', 'left out', 'leave out', 'forgot', 'forgotten', "didn't", "doesn't",
  "don't", "isn't", "wasn't", "won't", 'did not', 'does not', 'do not', 'no longer', 'verb', 'action', 'place', 'where', 'when',
  'time', 'number', 'plural', 'singular', 'swap[a-z]*', 'revers[a-z]*', 'order', 'who did',
].join('|')), 'i');
const QUOTED = /"([^"]*)"|“([^”]*)”/g;
const HAN_CHAR = /\p{Script=Han}/u;

function apostrophes(s: string): string {
  return s.replace(/[’‘`]/g, "'");
}

function quotedParts(text: string): { quoted: string[]; rest: string } {
  const quoted: string[] = [];
  const rest = text.replace(QUOTED, (_m, a: string | undefined, b: string | undefined) => {
    quoted.push(a ?? b ?? '');
    return ' ';
  });
  return { quoted, rest };
}

function hanChars(s: string): string[] {
  return Array.from(s).filter((ch) => HAN_CHAR.test(ch));
}

/**
 * Is this line of a check ONLY about which of he / she / it (他 / 她 / 它) it was? Its Chinese is nothing but tā
 * pronouns (+ 们), its quoted words are third-person pronouns, it names no other person (I / you / we / they) and no
 * other issue (negation, verb, time, tense…), and it is about gender: "gender" / "pronoun" / "male"…, two of he / she /
 * it, or a tā character with one of them.
 */
export function unheardPronounLine(text: string, quote?: string | null): boolean {
  const line = apostrophes(text);
  const han = hanChars(`${line}${quote ?? ''}`);
  if (!han.every((ch) => isTa(ch) || ch === '们')) return false;
  const { quoted, rest } = quotedParts(line);
  if (FIRST_SECOND.test(rest) || OTHER_ISSUE.test(rest) || TENSE_CUE.test(rest)) return false;
  for (const q of quoted) {
    if (!englishWords(q).every((t) => THIRD_PERSON_WORDS.includes(t) || Array.from(t).every((ch) => isTa(ch) || ch === '们'))) return false;
  }
  const thirds = new Set(Array.from(line.matchAll(THIRD_RE), (m) => m[0].toLowerCase()));
  const tas = new Set(han.filter(isTa));
  return GENDER_CUE.test(rest) || thirds.size >= 2 || tas.size >= 2 || (tas.size >= 1 && thirds.size >= 1);
}

/**
 * Is this line of a check ONLY about the tense (when the Chinese marks none)? No Chinese, no person, no gender, no
 * other issue; its quoted bits are one and the same once tense is set aside ("blamed" / "blames"); and it is about
 * tense: "tense" / "past" / "present" / "future" / "aspect", or two such quoted forms.
 */
export function unheardTenseLine(text: string, quote?: string | null): boolean {
  const line = apostrophes(text);
  if (hasHan(line) || hasHan(quote ?? '')) return false;
  const { quoted, rest } = quotedParts(line);
  if (FIRST_SECOND.test(rest) || OTHER_ISSUE.test(rest) || GENDER_CUE.test(rest) || THIRD_ONE.test(rest)) return false;
  const keys = new Set(quoted.map((q) => heardMeaningKey(q, { pronouns: true, tense: true })));
  if (keys.size > 1) return false;
  const plain = new Set(quoted.map((q) => heardMeaningKey(q, { pronouns: true, tense: false })));
  return TENSE_CUE.test(rest) || (quoted.length >= 2 && plain.size >= 2);
}

// ============ The rule ============

const NEGATIONS = new Set(['not', 'no', 'never', 'nobody', 'nothing', 'none', 'neither', 'nor', 'nowhere']);
const PERSONS: Record<string, string> = {
  i: 'i', me: 'i', my: 'i', mine: 'i', myself: 'i', you: 'you', your: 'you', yours: 'you', yourself: 'you', yourselves: 'you',
  we: 'we', us: 'we', our: 'we', ours: 'we', ourselves: 'we', they: 'they', them: 'they', their: 'they', theirs: 'they', themselves: 'they',
};

/**
 * The model's lines are only trusted (rule B) when the answer and the reference say the same about what the ear CAN
 * tell: as many negations (not / never / no…) and the same other persons (I, you, we, they) — so a check that only
 * mentions he / she can't hide a lost "not" or a "you" for "me".
 */
export function sameRolesAndPolarity(answer: string, reference: string): boolean {
  const facts = (s: string) => {
    const w = englishWords(s);
    return {
      neg: w.filter((t) => NEGATIONS.has(t)).length,
      persons: [...new Set(w.map((t) => PERSONS[t]).filter(Boolean))].sort().join(','),
    };
  };
  const a = facts(answer);
  const b = facts(reference);
  return a.neg === b.neg && a.persons === b.persons;
}

export const HEARD_PRONOUN_HEADLINE = 'Right — by ear, tā can be he, she or it.';
export const HEARD_TENSE_HEADLINE = "Right — the Chinese doesn't mark the tense here.";
export const HEARD_BOTH_HEADLINE = 'Right — tā can be he, she or it, and no tense is marked.';
export const HEARD_RIGHT_HEADLINE = 'Right — you understood it.';
export const HEARD_TA_HEADLINE = 'Right — 他, 她 and 它 all sound tā, so any of them works.';

/** The headline of a check the rule made right. */
export function heardHeadline(pronoun: boolean, tense: boolean): string {
  if (pronoun && tense) return HEARD_BOTH_HEADLINE;
  if (pronoun) return HEARD_PRONOUN_HEADLINE;
  if (tense) return HEARD_TENSE_HEADLINE;
  return HEARD_RIGHT_HEADLINE;
}

function upgraded(headline: string): AnswerCheck {
  return { verdict: 'correct', headline, corrected: '', corrected_pinyin: '', tips: [], suggested: 'got_it' };
}

/**
 * A check of a heard-only answer with what the ear can't tell forgiven (see the file comment). Any other check —
 * the learner SAW the Chinese — comes back as it is. Right verdicts lose the tips (and headline) that only complain
 * about it; almost / wrong become correct, with no tip, when (A) the answer is the reference by ear, or (B, almost
 * only for an English answer) every line only complains about it — in Chinese, when the correction only swaps 他 / 她 / 它
 * and every tip is about that.
 */
export function forgiveUnheard(check: AnswerCheck, input: AnswerCheckInput): AnswerCheck {
  if (!isHeardOnlyCheck(input)) return check;
  const zh = heardChinese(input);
  const pronouns = hasTaPronoun(zh);
  const meaning = isMeaningCheck(input);
  const tense = meaning && hasHan(zh) && !marksTense(zh);
  if (!pronouns && !tense) return check;
  const forgivenLine = (text: string, quote?: string) =>
    (pronouns && unheardPronounLine(text, quote)) || (tense && unheardTenseLine(text, quote));
  const good = check.verdict === 'correct' || check.verdict === 'acceptable';
  if (good) {
    const tips = check.tips.filter((t) => !forgivenLine(t.text, t.quote));
    const headlineForgiven = forgivenLine(check.headline);
    if (tips.length === check.tips.length && !headlineForgiven) return check;
    const headline = !headlineForgiven ? check.headline
      : meaning ? heardHeadline(pronouns && unheardPronounLine(check.headline), tense && unheardTenseLine(check.headline)) : HEARD_TA_HEADLINE;
    if (headlineForgiven && tips.length === 0) return upgraded(headline);
    return { ...check, headline, tips };
  }
  if (meaning) {
    const a = heardMeaningKey(input.answer, { pronouns, tense });
    const m = heardMeaningKey(input.model_answer, { pronouns, tense });
    if (a && a === m) {
      const pronounMattered = pronouns && heardMeaningKey(input.answer, { pronouns: false, tense }) !== heardMeaningKey(input.model_answer, { pronouns: false, tense });
      const tenseMattered = tense && heardMeaningKey(input.answer, { pronouns, tense: false }) !== heardMeaningKey(input.model_answer, { pronouns, tense: false });
      return upgraded(heardHeadline(pronounMattered, tenseMattered));
    }
    if (check.verdict !== 'almost' || !sameRolesAndPolarity(input.answer, input.model_answer)) return check;
    const lines = [{ text: check.headline }, ...check.tips];
    if (!lines.every((l) => forgivenLine(l.text, l.quote))) return check;
    const aboutPronoun = pronouns && lines.some((l) => unheardPronounLine(l.text, l.quote));
    const aboutTense = tense && lines.some((l) => unheardTenseLine(l.text, l.quote));
    return upgraded(heardHeadline(aboutPronoun, aboutTense));
  }
  // Answered in Chinese: 他 / 她 / 它 are one sound.
  const mine = taKey(input.answer);
  if (mine && mine === taKey(input.model_answer)) return upgraded(HEARD_TA_HEADLINE);
  if (check.corrected && taKey(check.corrected) === mine && check.tips.every((t) => unheardPronounLine(t.text, t.quote))) {
    return upgraded(HEARD_TA_HEADLINE);
  }
  return check;
}
