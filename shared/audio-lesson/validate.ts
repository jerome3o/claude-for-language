/**
 * Checks for what Claude writes (plans) and what gets spoken (scripts). Each
 * returns a list of problems in plain words — fed back to the model for a
 * repair round, or shown to whoever sent the input.
 */
import { hasHan } from './compile';
import { charToneProblems } from './tones';
import type { AudioLessonScript, DialoguePlan, SleepPlan } from './types';

export const SCRIPT_LIMITS = {
  /** Characters in one speech segment (one TTS call). */
  maxSegmentChars: 300,
  maxSegments: 1500,
  /** Distinct clips to synthesise (repeats are made once): bounds TTS cost and time. */
  maxUniqueSpeech: 220,
  maxPauseMs: 20_000,
  minRate: 0.5,
  maxRate: 1.5,
  maxChapters: 40,
} as const;

export const PLAN_LIMITS = {
  dialogueLines: { min: 4, max: 16 },
  points: { min: 2, max: 10 },
  sleepWords: { min: 2, max: 18 },
  /** What a sleep-lesson word means (required) / where its characters come from (optional). */
  meaningSentences: { min: 1, max: 3 },
  characterSentences: { min: 0, max: 3 },
  /** Sentences of meaning + characters together. */
  explanationSentences: { min: 1, max: 5 },
  /** A sleep-lesson word's English recap (after "The word was 银行: "). */
  maxRecapChars: 220,
  /** A dialogue line / example sentence (characters). */
  maxLineChars: 60,
  /** A sleep example sentence: "only simple sentences". */
  maxSleepSentenceChars: 24,
  maxEnglishChars: 900,
} as const;

/** Tone-marked vowels: pinyin has no place in English narration (an English voice mangles it). */
const TONE_MARKS = /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/;

function str(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function checkLine(where: string, l: unknown, problems: string[], maxChars: number = PLAN_LIMITS.maxLineChars): void {
  if (!l || typeof l !== 'object') {
    problems.push(`${where}: missing`);
    return;
  }
  const line = l as Record<string, unknown>;
  if (!str(line.hanzi) || !hasHan(line.hanzi)) problems.push(`${where}.hanzi: Chinese characters are required`);
  else if ([...line.hanzi].length > maxChars) problems.push(`${where}.hanzi: too long (${[...line.hanzi].length} characters, at most ${maxChars}) — keep it short and simple`);
  else if (/[\/()（）\[\]{}|_]|\.\.\.|…/.test(line.hanzi)) problems.push(`${where}.hanzi: no slashes, brackets, ellipses or blanks — it is read aloud`);
  if (!str(line.pinyin)) problems.push(`${where}.pinyin: required (tone marks)`);
  else if (/[1-5]/.test(line.pinyin)) problems.push(`${where}.pinyin: use tone marks, not numbers`);
  if (!str(line.english)) problems.push(`${where}.english: required`);
  else if (hasHan(line.english)) problems.push(`${where}.english: no Chinese characters in the translation`);
}

function checkNarration(where: string, v: unknown, problems: string[]): void {
  if (!str(v)) {
    problems.push(`${where}: required`);
    return;
  }
  if (v.length > PLAN_LIMITS.maxEnglishChars) problems.push(`${where}: too long (${v.length} characters, at most ${PLAN_LIMITS.maxEnglishChars})`);
  // Pinyin outside the Chinese is read by the English voice.
  const englishOnly = v.replace(/[㐀-鿿豈-﫿][^A-Za-z]*/g, ' ');
  if (TONE_MARKS.test(englishOnly)) problems.push(`${where}: no pinyin in the English narration — write the Chinese in characters (it is spoken by a Chinese voice) and never spell it out in pinyin`);
}

export function validateDialoguePlan(raw: unknown): string[] {
  const problems: string[] = [];
  if (!raw || typeof raw !== 'object') return ['The plan is missing'];
  const p = raw as Partial<DialoguePlan>;
  if (!str(p.title)) problems.push('title: required');
  checkNarration('intro_en', p.intro_en, problems);
  checkNarration('outro_en', p.outro_en, problems);
  const speakers = Array.isArray(p.speakers) ? p.speakers : [];
  const ids = speakers.map((s) => s?.id).sort().join(',');
  if (ids !== 'A,B') problems.push('speakers: exactly two, with ids "A" and "B"');
  speakers.forEach((s, i) => {
    if (!s || !str(s.name)) problems.push(`speakers[${i}].name: required`);
    if (!s || (s.gender !== 'female' && s.gender !== 'male')) problems.push(`speakers[${i}].gender: "female" or "male"`);
  });
  const lines = Array.isArray(p.dialogue) ? p.dialogue : [];
  const { min, max } = PLAN_LIMITS.dialogueLines;
  if (lines.length < min || lines.length > max) problems.push(`dialogue: ${min}–${max} lines (got ${lines.length})`);
  lines.forEach((l, i) => {
    checkLine(`dialogue[${i}]`, l, problems);
    if (l && l.speaker !== 'A' && l.speaker !== 'B') problems.push(`dialogue[${i}].speaker: "A" or "B"`);
  });
  if (lines.length >= 2 && !lines.some((l) => l?.speaker === 'A') ) problems.push('dialogue: speaker A never speaks');
  if (lines.length >= 2 && !lines.some((l) => l?.speaker === 'B')) problems.push('dialogue: speaker B never speaks');
  const points = Array.isArray(p.points) ? p.points : [];
  if (points.length < PLAN_LIMITS.points.min || points.length > PLAN_LIMITS.points.max) problems.push(`points: ${PLAN_LIMITS.points.min}–${PLAN_LIMITS.points.max} words or structures (got ${points.length})`);
  points.forEach((pt, i) => {
    checkLine(`points[${i}]`, pt, problems, 20);
    if (!pt) return;
    if (pt.kind !== 'word' && pt.kind !== 'structure') problems.push(`points[${i}].kind: "word" or "structure"`);
    if (pt.status !== 'new' && pt.status !== 'learning' && pt.status !== 'known') problems.push(`points[${i}].status: "new", "learning" or "known"`);
    checkNarration(`points[${i}].explanation_en`, pt.explanation_en, problems);
    if (typeof pt.line !== 'number' || !Number.isInteger(pt.line) || pt.line < 0 || pt.line >= lines.length) problems.push(`points[${i}].line: the index (0-based) of the dialogue line that uses it`);
    else if (str(pt.hanzi) && lines[pt.line] && str(lines[pt.line].hanzi) && pt.kind === 'word' && !lines[pt.line].hanzi.includes(pt.hanzi)) {
      problems.push(`points[${i}]: dialogue[${pt.line}] does not contain "${pt.hanzi}" — point at the line that uses it`);
    }
    if (pt.example !== undefined && pt.example !== null) checkLine(`points[${i}].example`, pt.example, problems);
  });
  return problems;
}

/**
 * "'银'就是'银行'的'银'。" / "'寄'是'寄信'的'寄'。" — a sentence that only says which known word
 * a character comes from. Fine in characters_zh, not as the whole meaning.
 */
export function isCharacterOrigin(sentence: string): boolean {
  const s = sentence.replace(/[\s‘’“”'"「」『』]/g, '').replace(/[。！？!?，,]+$/u, '');
  // X (就)是 …X… (里)的 X (字) — the same character on both ends, inside a word in the middle.
  return /^(.{1,2}?)(?:就|也)?是.{0,5}\1.{0,5}?(?:里|中)?的\1字?$/u.test(s);
}

/** A sleep-lesson word's English recap: plain English (the word itself is added in front). */
function checkRecap(where: string, v: unknown, problems: string[]): void {
  if (!str(v)) {
    problems.push(`${where}: required — the meaning in English, spoken after "The word was <hanzi>: " (e.g. "bank, as in the place where you keep your money, not the bank of a river")`);
    return;
  }
  if (!/[A-Za-z]/.test(v)) problems.push(`${where}: English is required`);
  if (v.length > PLAN_LIMITS.maxRecapChars) problems.push(`${where}: too long (${v.length} characters, at most ${PLAN_LIMITS.maxRecapChars}) — one short line`);
  const englishOnly = v.replace(/[㐀-鿿豈-﫿][^A-Za-z]*/g, ' ');
  if (TONE_MARKS.test(englishOnly)) problems.push(`${where}: no pinyin — it is read by an English voice`);
}

export function validateSleepPlan(raw: unknown): string[] {
  const problems: string[] = [];
  if (!raw || typeof raw !== 'object') return ['The plan is missing'];
  const p = raw as Partial<SleepPlan>;
  if (!str(p.title)) problems.push('title: required');
  for (const key of ['intro_zh', 'outro_zh'] as const) {
    const v = p[key];
    if (!str(v) || !hasHan(v)) problems.push(`${key}: simple Chinese is required`);
    else if (/[A-Za-z]/.test(v)) problems.push(`${key}: Chinese only — no English or pinyin`);
  }
  const words = Array.isArray(p.words) ? p.words : [];
  const { min, max } = PLAN_LIMITS.sleepWords;
  if (words.length < min || words.length > max) problems.push(`words: ${min}–${max} words (got ${words.length})`);
  const seen = new Set<string>();
  words.forEach((w, i) => {
    checkLine(`words[${i}]`, w, problems, 8);
    if (!w) return;
    if (str(w.hanzi)) {
      if (seen.has(w.hanzi)) problems.push(`words[${i}]: "${w.hanzi}" appears twice`);
      seen.add(w.hanzi);
    }
    const meaning = Array.isArray(w.meaning_zh) ? w.meaning_zh : [];
    const chars = Array.isArray(w.characters_zh) ? w.characters_zh : w.characters_zh === undefined ? [] : null;
    const mm = PLAN_LIMITS.meaningSentences;
    const cm = PLAN_LIMITS.characterSentences;
    if (meaning.length < mm.min || meaning.length > mm.max) {
      problems.push(`words[${i}].meaning_zh: ${mm.min}–${mm.max} very short, very simple Chinese sentences saying what "${str(w.hanzi) ? w.hanzi : 'the word'}" MEANS, in words the learner knows — required`);
    }
    if (chars === null) problems.push(`words[${i}].characters_zh: a list (may be empty)`);
    else if (chars.length > cm.max) problems.push(`words[${i}].characters_zh: at most ${cm.max} sentences`);
    const checkZh = (field: string, list: unknown[]) =>
      list.forEach((s, j) => {
        if (!str(s) || !hasHan(s)) problems.push(`words[${i}].${field}[${j}]: simple Chinese is required`);
        else if (/[A-Za-z]/.test(s)) problems.push(`words[${i}].${field}[${j}]: Chinese only — no English or pinyin`);
        else if ([...s].length > 40) problems.push(`words[${i}].${field}[${j}]: too long — one short sentence (at most 40 characters)`);
      });
    checkZh('meaning_zh', meaning);
    checkZh('characters_zh', chars ?? []);
    if (meaning.length >= mm.min && meaning.every((s) => typeof s === 'string' && isCharacterOrigin(s))) {
      problems.push(`words[${i}].meaning_zh: only says where a character comes from — that goes in characters_zh; meaning_zh must say what the word MEANS (what it is, what it does, what it is like, or its opposite)`);
    }
    if (meaning.length + (chars?.length ?? 0) > PLAN_LIMITS.explanationSentences.max) {
      problems.push(`words[${i}]: meaning_zh + characters_zh at most ${PLAN_LIMITS.explanationSentences.max} sentences together — keep it short`);
    }
    if (str(w.hanzi)) problems.push(...charToneProblems(`words[${i}]`, w));
    checkRecap(`words[${i}].recap_en`, w.recap_en, problems);
    if (!Array.isArray(w.related_known)) problems.push(`words[${i}].related_known: a list (may be empty)`);
    const sentences = Array.isArray(w.sentences) ? w.sentences : [];
    if (sentences.length !== 3) problems.push(`words[${i}].sentences: exactly 3 (got ${sentences.length})`);
    sentences.forEach((s, j) => {
      checkLine(`words[${i}].sentences[${j}]`, s, problems, PLAN_LIMITS.maxSleepSentenceChars);
      if (s && str(s.hanzi) && str(w.hanzi) && !s.hanzi.includes(w.hanzi)) problems.push(`words[${i}].sentences[${j}]: must contain "${w.hanzi}"`);
    });
  });
  return problems;
}

/** Checks a compiled script (it is also what the renderer trusts). */
export function validateScript(script: AudioLessonScript): string[] {
  const problems: string[] = [];
  if (script.version !== 1) problems.push('unknown script version');
  if (!str(script.title)) problems.push('title: required');
  if (!Array.isArray(script.chapters) || script.chapters.length === 0) problems.push('chapters: at least one');
  else if (script.chapters.length > SCRIPT_LIMITS.maxChapters) problems.push(`chapters: at most ${SCRIPT_LIMITS.maxChapters}`);
  const segs = Array.isArray(script.segments) ? script.segments : [];
  if (segs.length === 0) problems.push('segments: nothing to say');
  if (segs.length > SCRIPT_LIMITS.maxSegments) problems.push(`segments: at most ${SCRIPT_LIMITS.maxSegments}`);
  let lastChapter = 0;
  segs.forEach((s, i) => {
    if (!Number.isInteger(s.chapter) || s.chapter < 0 || s.chapter >= script.chapters.length) problems.push(`segments[${i}]: unknown chapter`);
    else if (s.chapter < lastChapter) problems.push(`segments[${i}]: chapters out of order`);
    else lastChapter = s.chapter;
    if (s.kind === 'pause') {
      if (!(s.ms >= 0 && s.ms <= SCRIPT_LIMITS.maxPauseMs)) problems.push(`segments[${i}]: pause must be 0–${SCRIPT_LIMITS.maxPauseMs} ms`);
      return;
    }
    if (!str(s.text)) problems.push(`segments[${i}]: empty speech`);
    else if (s.text.length > SCRIPT_LIMITS.maxSegmentChars) problems.push(`segments[${i}]: too long for one clip`);
    else if (s.lang === 'zh' && !hasHan(s.text)) problems.push(`segments[${i}]: Chinese segment without Chinese`);
    else if (s.lang === 'en' && hasHan(s.text)) problems.push(`segments[${i}]: English segment with Chinese characters`);
    if (!(s.rate >= SCRIPT_LIMITS.minRate && s.rate <= SCRIPT_LIMITS.maxRate)) problems.push(`segments[${i}]: rate must be ${SCRIPT_LIMITS.minRate}–${SCRIPT_LIMITS.maxRate}`);
  });
  const unique = uniqueSpeech(script).length;
  if (unique > SCRIPT_LIMITS.maxUniqueSpeech) problems.push(`too much to say: ${unique} different clips (at most ${SCRIPT_LIMITS.maxUniqueSpeech}) — fewer words or shorter explanations`);
  return problems;
}

/** The identity of a clip: the same text, voice, language and rate is made once. */
export function speechKey(s: { lang: string; voice: string; rate: number; text: string }): string {
  return `${s.lang}|${s.voice}|${s.rate.toFixed(2)}|${s.text}`;
}

/** The distinct clips a script needs, in first-use order. */
export function uniqueSpeech(script: AudioLessonScript): Array<{ key: string; lang: 'zh' | 'en'; voice: string; rate: number; text: string }> {
  const seen = new Map<string, { key: string; lang: 'zh' | 'en'; voice: string; rate: number; text: string }>();
  for (const s of script.segments) {
    if (s.kind !== 'speech') continue;
    const key = speechKey(s);
    if (!seen.has(key)) seen.set(key, { key, lang: s.lang, voice: s.voice, rate: s.rate, text: s.text });
  }
  return [...seen.values()];
}

/** Rough spoken length (for the form's "about N minutes" and the agent's sizing). */
export function estimateScriptMs(script: AudioLessonScript): number {
  let ms = 0;
  for (const s of script.segments) {
    if (s.kind === 'pause') ms += s.ms;
    else if (s.lang === 'zh') ms += ([...s.text].filter((c) => hasHan(c)).length * 260) / s.rate + 300;
    else ms += (s.text.split(/\s+/).length * 380) / s.rate + 200;
  }
  return Math.round(ms);
}

/** Characters sent to TTS (the cost driver), by language. */
export function speechChars(script: AudioLessonScript): { zh: number; en: number; clips: number } {
  let zh = 0;
  let en = 0;
  const unique = uniqueSpeech(script);
  for (const u of unique) {
    if (u.lang === 'zh') zh += [...u.text].length;
    else en += u.text.length;
  }
  return { zh, en, clips: unique.length };
}
