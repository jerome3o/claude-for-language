/**
 * "🎤 Read it aloud" on a graded reader page (docs/STUDY_SESSION.md "Graded readers" → "Read it
 * aloud"; Jerome: "transcribe my voice and then see if it's correct against the actual story").
 *
 * The learner reads the page aloud; the take is transcribed (the voice boxes' pipeline: live
 * transcript while speaking, upload fallback) and judged here against the page's own Chinese,
 * CHARACTER BY CHARACTER, so the page itself can be marked in place (no second copy of the text):
 *
 * - Both sides become keys: punctuation, spaces and quotes are left out; numbers become hanzi
 *   (a page's "3" and a heard 三 / "3" match; "12" = 十二); 两 = 二; traditional characters the
 *   recogniser may give become simplified; Latin letters compare in lower case.
 * - Each Han character gets its syllable IN CONTEXT: the app's automatic pinyin (pinyin-pro + the
 *   一 / 不 tone changes) over each unbroken run of characters, on both sides.
 * - The two key strings are lined up by a weighted edit distance (ok 0, same sound 1, tone only 2,
 *   another character 3, a missed / extra character 2 each) — a deterministic DP from the end,
 *   walked from the start preferring a pairing, then a missed character, then an extra one.
 * - A page character is `ok` (said as written), `sound` (another character with the same toned
 *   syllable — recognisers often pick a homophone: counts as right; a neutral syllable on the page
 *   matches any tone), `close` (the same syllable in another tone), `wrong` (another character) or
 *   `missed`; what was said that isn't on the page is an EXTRA, shown as a caret before the
 *   character it came before (or at the end). Punctuation / spaces are `plain`.
 * - A digit run on the page ("12") is one unit: right only when every one of its keys is.
 *
 * Score: right = ok + sound over every character to read (`pct`, floored — never "100%" with a
 * mistake); `toCheck` = the characters not right + the extra stretches. Practice only — nothing is
 * stored, no review event. Lab port: core `ReadAloud.kt`, parity-tested
 * (android-lab/parity/fixtures/read-aloud.ts → ReadAloudParityTest).
 */
import { pinyin } from 'pinyin-pro';
import { applyYiBuToneChanges } from '../pinyin/toneChange';
import { normalizeNumbersToHanzi } from '../text/numberHanzi';
import { toSimplified } from '../picture-hunt/match';
import { normalizeSpokenPinyin, tonelessPinyin } from '../cards/answer';

/** How one character of the page was read. `plain` = punctuation / space (nothing to read). */
export type ReadAloudMark = 'ok' | 'sound' | 'close' | 'wrong' | 'missed' | 'plain';

export interface ReadAloudChar {
  /** The page's character (one code point). */
  char: string;
  mark: ReadAloudMark;
  /** What was heard for it ('' when missed or plain). */
  heard: string;
  /** Words said just before this character that aren't on the page ('' = none) — a caret. */
  extraBefore: string;
}

export interface ReadAloudResult {
  /** One entry per code point of the page's Chinese, in order. */
  chars: ReadAloudChar[];
  /** Words said after the last character that aren't on the page. */
  extraAtEnd: string;
  /** Characters to read (a digit run counts once). */
  total: number;
  /** Read right (ok + sound). */
  right: number;
  /** right / total, floored, 0..100. */
  pct: number;
  /** Characters not right + extra stretches. */
  toCheck: number;
}

/** A character that is read (a letter of any script, a digit); the rest is plain. */
const MARKABLE = /[\p{L}\p{Nd}]/u;
const HAN = /\p{Script=Han}/u;
const ASCII_DIGIT = /^[0-9]$/;

export const READ_ALOUD_COST = { ok: 0, sound: 1, close: 2, wrong: 3, gap: 2 } as const;

/** One character's comparison key (lower case, 两 → 二, simplified). */
function keyOf(ch: string): string {
  const lower = ch.toLowerCase();
  return toSimplified(lower === '两' ? '二' : lower);
}

interface Keys {
  keys: string[];
  /** Index of the unit each key belongs to (page) / -1 (transcript). */
  unit: number[];
  /** True where a run of characters is broken before this key (a gap, punctuation, a non-Han key). */
  breakBefore: boolean[];
}

interface Unit { start: number; end: number; firstKey: number; keyCount: number }

/** The page's units (code-point spans) and their keys. */
function pageKeys(text: string): { units: Unit[]; keys: Keys; cps: string[] } {
  const cps = [...text];
  const units: Unit[] = [];
  const keys: Keys = { keys: [], unit: [], breakBefore: [] };
  let gap = true;
  let i = 0;
  while (i < cps.length) {
    const c = cps[i];
    if (ASCII_DIGIT.test(c)) {
      let j = i;
      while (j < cps.length && ASCII_DIGIT.test(cps[j])) j++;
      const k = [...normalizeNumbersToHanzi(cps.slice(i, j).join(''))].map(keyOf);
      units.push({ start: i, end: j, firstKey: keys.keys.length, keyCount: k.length });
      k.forEach((key, n) => {
        keys.keys.push(key);
        keys.unit.push(units.length - 1);
        keys.breakBefore.push(n === 0 && gap);
      });
      gap = false;
      i = j;
      continue;
    }
    if (MARKABLE.test(c)) {
      units.push({ start: i, end: i + 1, firstKey: keys.keys.length, keyCount: 1 });
      keys.keys.push(keyOf(c));
      keys.unit.push(units.length - 1);
      keys.breakBefore.push(gap);
      gap = false;
    } else {
      gap = true;
    }
    i++;
  }
  return { units, keys, cps };
}

/** The transcript's keys: numbers → hanzi first (三, "3", "three"), then character by character. */
function transcriptKeys(transcript: string): Keys {
  const text = normalizeNumbersToHanzi(transcript.trim().toLowerCase());
  const keys: Keys = { keys: [], unit: [], breakBefore: [] };
  let gap = true;
  for (const c of text) {
    if (MARKABLE.test(c)) {
      keys.keys.push(keyOf(c));
      keys.unit.push(-1);
      keys.breakBefore.push(gap);
      gap = false;
    } else {
      gap = true;
    }
  }
  return keys;
}

/**
 * Each key's syllable in context (null for a non-Han key): the automatic pinyin + 一 / 不 over each
 * unbroken run of Han keys. A run whose pinyin doesn't line up with its characters gets nulls.
 */
function syllablesOf(k: Keys): (string | null)[] {
  const out: (string | null)[] = k.keys.map(() => null);
  let i = 0;
  while (i < k.keys.length) {
    if (!HAN.test(k.keys[i])) { i++; continue; }
    let j = i + 1;
    while (j < k.keys.length && HAN.test(k.keys[j]) && !k.breakBefore[j]) j++;
    const run = k.keys.slice(i, j).join('');
    const tokens = applyYiBuToneChanges(run, pinyin(run, { toneType: 'symbol', type: 'string' })).split(' ');
    if (tokens.length === j - i) {
      for (let n = 0; n < tokens.length; n++) out[i + n] = normalizeSpokenPinyin(tokens[n]) || null;
    }
    i = j;
  }
  return out;
}

const hasToneMark = (py: string) => tonelessPinyin(py) !== py;

type PairMark = 'ok' | 'sound' | 'close' | 'wrong';

/** One page key read as one heard key. */
function pairMark(page: string, heard: string, pageSyl: string | null, heardSyl: string | null): PairMark {
  if (page === heard) return 'ok';
  if (pageSyl && heardSyl) {
    if (pageSyl === heardSyl) return 'sound';
    if (!hasToneMark(pageSyl) && tonelessPinyin(heardSyl) === pageSyl) return 'sound';
    if (tonelessPinyin(pageSyl) === tonelessPinyin(heardSyl)) return 'close';
  }
  return 'wrong';
}

type KeyMark = PairMark | 'missed';

const SEVERITY: Record<KeyMark, number> = { ok: 0, sound: 1, close: 2, wrong: 3, missed: 4 };

/** A unit's mark from its keys' (a digit run): all missed = missed; any missed or wrong = wrong; else the worst. */
function unitMark(marks: KeyMark[]): ReadAloudMark {
  if (marks.every((m) => m === 'missed')) return 'missed';
  if (marks.some((m) => m === 'missed' || m === 'wrong')) return 'wrong';
  let worst: KeyMark = 'ok';
  for (const m of marks) if (SEVERITY[m] > SEVERITY[worst]) worst = m;
  return worst;
}

/** Does the transcript have anything to judge (a letter or digit)? */
export function readAloudHeardAnything(transcript: string): boolean {
  return transcriptKeys(transcript).keys.length > 0;
}

/** The page's Chinese read aloud as `transcript`: every character marked, the score. */
export function judgeReadAloud(pageText: string, transcript: string): ReadAloudResult {
  const { units, keys: page, cps } = pageKeys(pageText);
  const heard = transcriptKeys(transcript);
  const ps = syllablesOf(page);
  const hs = syllablesOf(heard);
  const n = page.keys.length;
  const m = heard.keys.length;
  const C = READ_ALOUD_COST;

  // dp[i][j] = the cheapest way to line up page[i..] with heard[j..].
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  const pair: PairMark[][] = Array.from({ length: n }, () => new Array<PairMark>(m).fill('wrong'));
  for (let j = m; j >= 0; j--) dp[n][j] = (m - j) * C.gap;
  for (let i = n - 1; i >= 0; i--) {
    dp[i][m] = (n - i) * C.gap;
    for (let j = m - 1; j >= 0; j--) {
      const pm = pairMark(page.keys[i], heard.keys[j], ps[i], hs[j]);
      pair[i][j] = pm;
      dp[i][j] = Math.min(C[pm] + dp[i + 1][j + 1], C.gap + dp[i + 1][j], C.gap + dp[i][j + 1]);
    }
  }

  const keyMarks: KeyMark[] = new Array<KeyMark>(n).fill('missed');
  const keyHeard: string[] = new Array<string>(n).fill('');
  const extraBeforeKey: string[] = new Array<string>(n + 1).fill('');
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && dp[i][j] === C[pair[i][j]] + dp[i + 1][j + 1]) {
      keyMarks[i] = pair[i][j];
      keyHeard[i] = heard.keys[j];
      i++;
      j++;
    } else if (i < n && dp[i][j] === C.gap + dp[i + 1][j]) {
      keyMarks[i] = 'missed';
      i++;
    } else {
      extraBeforeKey[i] += heard.keys[j];
      j++;
    }
  }

  const chars: ReadAloudChar[] = cps.map((char) => ({ char, mark: 'plain', heard: '', extraBefore: '' }));
  let right = 0;
  let toCheck = 0;
  for (const u of units) {
    const ks = keyMarks.slice(u.firstKey, u.firstKey + u.keyCount);
    const mark = unitMark(ks);
    const said = keyHeard.slice(u.firstKey, u.firstKey + u.keyCount).join('');
    let extra = '';
    for (let k = u.firstKey; k < u.firstKey + u.keyCount; k++) extra += extraBeforeKey[k];
    for (let c = u.start; c < u.end; c++) chars[c] = { char: cps[c], mark, heard: mark === 'missed' ? '' : said, extraBefore: c === u.start ? extra : '' };
    if (mark === 'ok' || mark === 'sound') right++;
    else toCheck++;
    if (extra) toCheck++;
  }
  const extraAtEnd = extraBeforeKey[n];
  if (extraAtEnd) toCheck++;
  const total = units.length;
  return { chars, extraAtEnd, total, right, pct: total > 0 ? Math.floor((right * 100) / total) : 0, toCheck };
}

// --- words (both apps) ---------------------------------------------------------------------------

export const READ_ALOUD_LABEL = 'Read it aloud';
export const READ_ALOUD_AGAIN = 'Say it again';
export const READ_ALOUD_STOP = 'Stop — check my reading';
export const READ_ALOUD_LISTENING = 'Listening… read the page aloud';
export const READ_ALOUD_CHECKING = 'Checking your reading…';
export const READ_ALOUD_OFFLINE = 'Needs a connection to check your reading';
export const READ_ALOUD_EMPTY = 'Didn’t catch that — try again.';
export const READ_ALOUD_YOU_SAID = 'You said';

/** The one line under the page: "✓ 92% — 2 to check" (icon + words, never colour alone). */
export function readAloudLine(r: Pick<ReadAloudResult, 'pct' | 'toCheck'>): string {
  if (r.toCheck === 0) return `✓ ${r.pct}% — all read right`;
  const icon = r.pct >= 90 ? '✓' : r.pct >= 60 ? '≈' : '✕';
  return `${icon} ${r.pct}% — ${r.toCheck} to check`;
}

/** The line's tone (the apps' colour for it). */
export function readAloudTone(r: Pick<ReadAloudResult, 'pct' | 'toCheck'>): 'good' | 'some' | 'low' {
  if (r.toCheck === 0 || r.pct >= 90) return 'good';
  return r.pct >= 60 ? 'some' : 'low';
}

/** `reader.read_aloud { result_bucket }`: all · 90 · 75 · 50 · under_50 (or failed / empty for no take). */
export function readAloudBucket(pct: number): string {
  if (pct >= 100) return 'all';
  if (pct >= 90) return '90';
  if (pct >= 75) return '75';
  if (pct >= 50) return '50';
  return 'under_50';
}

/** A marked character for a screen reader: "银 — tone off, heard yín → 音". */
export function readAloudCharLabel(c: ReadAloudChar): string {
  const extra = c.extraBefore ? `You also said ${c.extraBefore}. ` : '';
  switch (c.mark) {
    case 'sound': return `${extra}${c.char} — sounded right (heard ${c.heard})`;
    case 'close': return `${extra}${c.char} — tone off (heard ${c.heard})`;
    case 'wrong': return `${extra}${c.char} — heard ${c.heard}`;
    case 'missed': return `${extra}${c.char} — missed`;
    default: return `${extra}${c.char}`;
  }
}

/** A word (a run of the page's characters) needs a look: any of them is close / wrong / missed or has an extra before it. */
export function readAloudNeedsLook(chars: readonly ReadAloudChar[]): boolean {
  return chars.some((c) => c.mark === 'close' || c.mark === 'wrong' || c.mark === 'missed' || !!c.extraBefore);
}
