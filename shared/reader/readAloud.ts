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
 * - Stopped early (Jerome: "when I cancel it early … it comes up with a ton of things to look at"):
 *   the page characters AFTER the last one that was paired with something heard (right or not) were
 *   never reached — they are `unread`, not `missed`: no mark, no difference row, not in the score.
 *   A skipped word in the middle is still missed; extra words at the end stay extras. A take that
 *   paired nothing keeps every character missed (nothing heard to stop after).
 *
 * Score: right = ok + sound over every character read up to where he stopped (`pct`, floored — never
 * "100%" with a mistake); `toCheck` = the characters not right + the extra stretches. Practice only — nothing is
 * stored, no review event. Lab port: core `ReadAloud.kt`, parity-tested
 * (android-lab/parity/fixtures/read-aloud.ts → ReadAloudParityTest).
 */
import { pinyin } from 'pinyin-pro';
import { applyYiBuToneChanges } from '../pinyin/toneChange';
import { normalizeNumbersToHanzi } from '../text/numberHanzi';
import { toSimplified } from '../picture-hunt/match';
import { normalizeSpokenPinyin, tonelessPinyin } from '../cards/answer';

/**
 * How one character of the page was read. `plain` = punctuation / space (nothing to read); `unread` =
 * after the last character he reached (he stopped early): no mark, not counted.
 */
export type ReadAloudMark = 'ok' | 'sound' | 'close' | 'wrong' | 'missed' | 'unread' | 'plain';

export interface ReadAloudChar {
  /** The page's character (one code point). */
  char: string;
  mark: ReadAloudMark;
  /** What was heard for it ('' when missed or plain). */
  heard: string;
  /** Words said just before this character that aren't on the page ('' = none) — a caret. */
  extraBefore: string;
  /**
   * The page's syllable(s) for this character IN CONTEXT (the automatic pinyin + 一 / 不, tone marks);
   * '' for punctuation, a run whose pinyin doesn't line up, or a digit run's later characters.
   */
  pinyin?: string;
  /** The heard character's syllable(s) in the transcript's context ('' when missed / unknown). */
  heardPinyin?: string;
  /** The syllables of `extraBefore`. */
  extraBeforePinyin?: string;
  /** A later character of a multi-character unit (a digit run "12"): its mark / heard repeat the first's. */
  unitCont?: boolean;
}

/** How one character of the transcript lined up: `extra` = said but not on the page. */
export type ReadAloudHeardMark = 'ok' | 'sound' | 'close' | 'wrong' | 'extra' | 'plain';

/** One character of the transcript as checked (numbers written as hanzi), for "You said" with its marks. */
export interface ReadAloudHeardChar {
  char: string;
  mark: ReadAloudHeardMark;
}

export interface ReadAloudResult {
  /** One entry per code point of the page's Chinese, in order. */
  chars: ReadAloudChar[];
  /** Words said after the last character that aren't on the page. */
  extraAtEnd: string;
  /** Characters to read up to where he stopped (a digit run counts once). */
  total: number;
  /** Read right (ok + sound). */
  right: number;
  /** right / total, floored, 0..100. */
  pct: number;
  /** Characters not right + extra stretches. */
  toCheck: number;
  /** The syllables of `extraAtEnd`. */
  extraAtEndPinyin?: string;
  /** The transcript, character by character, marked like the page (`extra` = not on the page). */
  heard?: ReadAloudHeardChar[];
  /** He stopped before the end of the page: the characters from `unreadFrom` on are `unread`. */
  stoppedEarly?: boolean;
  /** The code point where the unread rest starts (= the page's length when he read to the end). */
  unreadFrom?: number;
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

/** The transcript as checked: trimmed, lower case, numbers → hanzi (三, "3", "three"). */
function transcriptText(transcript: string): string {
  return normalizeNumbersToHanzi(transcript.trim().toLowerCase());
}

/** The transcript's keys, character by character. */
function transcriptKeys(transcript: string): Keys {
  const text = transcriptText(transcript);
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
  const keyHeardIdx: number[] = new Array<number>(n).fill(-1);
  const extraBeforeKey: string[] = new Array<string>(n + 1).fill('');
  const extraBeforePy: string[] = new Array<string>(n + 1).fill('');
  const heardMark: ReadAloudHeardMark[] = new Array<ReadAloudHeardMark>(m).fill('extra');
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && dp[i][j] === C[pair[i][j]] + dp[i + 1][j + 1]) {
      keyMarks[i] = pair[i][j];
      keyHeard[i] = heard.keys[j];
      keyHeardIdx[i] = j;
      heardMark[j] = pair[i][j];
      i++;
      j++;
    } else if (i < n && dp[i][j] === C.gap + dp[i + 1][j]) {
      keyMarks[i] = 'missed';
      i++;
    } else {
      extraBeforeKey[i] += heard.keys[j];
      extraBeforePy[i] += hs[j] ?? '';
      j++;
    }
  }

  // Stopped early: the units after the last one paired with something heard were never reached.
  let lastPaired = -1;
  for (let k = 0; k < n; k++) if (keyHeardIdx[k] >= 0) lastPaired = k;
  const readUnits = lastPaired < 0 ? units.length : page.unit[lastPaired] + 1;
  const stoppedEarly = readUnits < units.length;
  const unreadFrom = stoppedEarly ? units[readUnits].start : cps.length;

  const chars: ReadAloudChar[] = cps.map((char) => ({ char, mark: 'plain', heard: '', extraBefore: '', pinyin: '', heardPinyin: '', extraBeforePinyin: '', unitCont: false }));
  let right = 0;
  let toCheck = 0;
  for (let ui = 0; ui < units.length; ui++) {
    const u = units[ui];
    const ks = keyMarks.slice(u.firstKey, u.firstKey + u.keyCount);
    const unread = ui >= readUnits;
    const mark: ReadAloudMark = unread ? 'unread' : unitMark(ks);
    const said = keyHeard.slice(u.firstKey, u.firstKey + u.keyCount).join('');
    let extra = '';
    let extraPy = '';
    let py = '';
    let heardPy = '';
    for (let k = u.firstKey; k < u.firstKey + u.keyCount; k++) {
      extra += extraBeforeKey[k];
      extraPy += extraBeforePy[k];
      py += ps[k] ?? '';
      if (keyHeardIdx[k] >= 0) heardPy += hs[keyHeardIdx[k]] ?? '';
    }
    for (let c = u.start; c < u.end; c++) {
      const first = c === u.start;
      chars[c] = {
        char: cps[c],
        mark,
        heard: mark === 'missed' || unread ? '' : said,
        extraBefore: first ? extra : '',
        pinyin: first ? py : '',
        heardPinyin: first && mark !== 'missed' && !unread ? heardPy : '',
        extraBeforePinyin: first ? extraPy : '',
        unitCont: !first,
      };
    }
    if (unread) continue;
    if (mark === 'ok' || mark === 'sound') right++;
    else toCheck++;
    if (extra) toCheck++;
  }
  const extraAtEnd = extraBeforeKey[n];
  if (extraAtEnd) toCheck++;
  const total = readUnits;
  // The transcript as checked, each of its characters marked by how it lined up.
  const heardChars: ReadAloudHeardChar[] = [];
  let hk = 0;
  for (const c of transcriptText(transcript)) {
    if (MARKABLE.test(c)) heardChars.push({ char: c, mark: heardMark[hk++] });
    else heardChars.push({ char: c, mark: 'plain' });
  }
  return {
    chars, extraAtEnd, total, right, pct: total > 0 ? Math.floor((right * 100) / total) : 0, toCheck,
    extraAtEndPinyin: extraBeforePy[n], heard: heardChars, stoppedEarly, unreadFrom,
  };
}

// --- the differences, one per word (both apps) ----------------------------------------------------

/** What a difference is, worst first: another character, a missed one, a tone slip, extra words, or only the written form (a homophone — right). */
export type ReadAloudDiffKind = 'wrong' | 'missed' | 'tone' | 'extra' | 'sound';

/**
 * One place where what was heard differs from the page — a WORD of the page (the page's word chips
 * when given, else each run of differing characters), with what was heard there, both in pinyin,
 * and a reason line per character: "都 dū → you said dù (4th tone instead of 1st)". A word whose only
 * difference is a homophone (`sound`) is listed too but is NOT to check — it was read right.
 */
export interface ReadAloudDifference {
  /** Code-point span on the page ([n, n] = extra words after the last character). */
  start: number;
  end: number;
  /** The page's text for the span (成都) and its pinyin in context (chéngdū). */
  page: string;
  pagePinyin: string;
  /** What was heard there (程度) and its pinyin (chéngdù); '' when nothing was. */
  heard: string;
  heardPinyin: string;
  kind: ReadAloudDiffKind;
  /** Counts toward "N to check" (everything but a homophone-only word). */
  toCheck: boolean;
  /** One short line per character that differs, in page order. */
  reasons: string[];
}

const TONE_VOWELS = ['āēīōūǖ', 'áéíóúǘ', 'ǎěǐǒǔǚ', 'àèìòùǜ'];

/** A syllable's tone: 1–4 from its mark, 0 = neutral (no mark). */
export function pinyinTone(py: string): number {
  for (const ch of py) {
    for (let t = 0; t < 4; t++) if (TONE_VOWELS[t].includes(ch)) return t + 1;
  }
  return 0;
}

/** "1st" · "2nd" · "3rd" · "4th" · "neutral" — tones in words, never colour alone. */
export function toneName(tone: number): string {
  return ['neutral', '1st', '2nd', '3rd', '4th'][tone] ?? 'neutral';
}

const withPy = (text: string, py: string | undefined) => (py ? `${text} ${py}` : text);

/** One character's reason line ('' for a character read as written). */
function reasonFor(text: string, c: ReadAloudChar): string {
  const py = c.pinyin ?? '';
  const heardPy = c.heardPinyin ?? '';
  switch (c.mark) {
    case 'sound': return `${withPy(text, py)} — sounded right (written ${c.heard})`;
    case 'close': return `${withPy(text, py)} → you said ${heardPy || c.heard} (${toneName(pinyinTone(heardPy))} tone instead of ${toneName(pinyinTone(py))})`;
    case 'wrong': return `${withPy(text, py)} → you said ${withPy(c.heard, heardPy)}`;
    case 'missed': return `missed ${withPy(text, py)}`;
    default: return '';
  }
}

const KIND_RANK: Record<ReadAloudDiffKind, number> = { sound: 0, extra: 1, tone: 2, missed: 3, wrong: 4 };
const KIND_OF: Partial<Record<ReadAloudMark, ReadAloudDiffKind>> = { sound: 'sound', close: 'tone', wrong: 'wrong', missed: 'missed' };

const differs = (c: ReadAloudChar) => c.mark === 'sound' || c.mark === 'close' || c.mark === 'wrong' || c.mark === 'missed' || !!c.extraBefore;

/**
 * The take's differences, in page order (+ extra words at the end last). `words` = the page's word
 * chips (their texts concatenate to the page): a difference covers the whole word (成都, not just 都);
 * without them (or when they don't line up) each run of differing characters is one.
 */
export function readAloudDifferences(r: Pick<ReadAloudResult, 'chars' | 'extraAtEnd' | 'extraAtEndPinyin'>, words?: readonly string[] | null): ReadAloudDifference[] {
  const chars = r.chars;
  const spans: [number, number][] = [];
  const pageText = chars.map((c) => c.char).join('');
  if (words && words.length > 0 && words.join('') === pageText) {
    let at = 0;
    for (const w of words) {
      const len = [...w].length;
      if (len > 0) spans.push([at, at + len]);
      at += len;
    }
  } else {
    let i = 0;
    while (i < chars.length) {
      if (!differs(chars[i])) { i++; continue; }
      let j = i + 1;
      while (j < chars.length && (differs(chars[j]) || chars[j].unitCont)) j++;
      spans.push([i, j]);
      i = j;
    }
  }
  const out: ReadAloudDifference[] = [];
  for (const [start, end] of spans) {
    const span = chars.slice(start, end);
    if (!span.some(differs)) continue;
    let page = '';
    let pagePinyin = '';
    let heard = '';
    let heardPinyin = '';
    let kind: ReadAloudDiffKind = 'sound';
    const reasons: string[] = [];
    for (let k = 0; k < span.length; k++) {
      const c = span[k];
      page += c.char;
      pagePinyin += c.pinyin ?? '';
      heard += c.extraBefore;
      heardPinyin += c.extraBeforePinyin ?? '';
      if (c.unitCont) continue;
      if (c.mark !== 'missed') {
        heard += c.heard;
        heardPinyin += c.heardPinyin ?? '';
      }
      // A unit's text: the character, or a whole digit run ("12").
      let text = c.char;
      for (let n = k + 1; n < span.length && span[n].unitCont; n++) text += span[n].char;
      if (c.extraBefore) {
        reasons.push(`extra ${withPy(c.extraBefore, c.extraBeforePinyin)}`);
        if (KIND_RANK.extra > KIND_RANK[kind]) kind = 'extra';
      }
      const reason = reasonFor(text, c);
      if (reason) reasons.push(reason);
      const k2 = KIND_OF[c.mark];
      if (k2 && KIND_RANK[k2] > KIND_RANK[kind]) kind = k2;
    }
    out.push({ start, end, page, pagePinyin, heard, heardPinyin, kind, toCheck: kind !== 'sound', reasons });
  }
  if (r.extraAtEnd) {
    const n = chars.length;
    out.push({
      start: n, end: n, page: '', pagePinyin: '', heard: r.extraAtEnd, heardPinyin: r.extraAtEndPinyin ?? '',
      kind: 'extra', toCheck: true, reasons: [`extra ${withPy(r.extraAtEnd, r.extraAtEndPinyin)}`],
    });
  }
  return out;
}

/** A difference's kind in words (its row's label — never colour alone). */
export const READ_ALOUD_DIFF_KIND: Record<ReadAloudDiffKind, string> = {
  wrong: 'Another word',
  missed: 'Missed',
  tone: 'Tone',
  extra: 'Extra words',
  sound: 'Sounded right',
};

// --- words (both apps) ---------------------------------------------------------------------------

export const READ_ALOUD_LABEL = 'Read it aloud';
export const READ_ALOUD_AGAIN = 'Say it again';
export const READ_ALOUD_STOP = 'Stop — check my reading';
export const READ_ALOUD_LISTENING = 'Listening… read the page aloud';
export const READ_ALOUD_CHECKING = 'Checking your reading…';
export const READ_ALOUD_OFFLINE = 'Needs a connection to check your reading';
export const READ_ALOUD_EMPTY = 'Didn’t catch that — try again.';
export const READ_ALOUD_YOU_SAID = 'You said';

/** The footer's big red button while a take records (it replaces Previous / Next / Finish — Jerome tapped Next mid-take). */
export const READ_ALOUD_STOP_RECORDING = 'Stop recording';

/**
 * A take is under way — the dictation phase is `listening` (recording) or `finishing` (stopped,
 * the transcript on its way) — so the page is LOCKED: the footer's Previous / Next / Finish give
 * way to one big red "■ Stop recording" (disabled "Checking your reading…" while finishing), the
 * audio row (play, waveform, ↻, speed, ⏮ ⏭) and ▶ Play whole story are disabled, and back / ✕
 * stop the take instead of leaving the page.
 */
export function readAloudLocksPage(phase: string): boolean {
  return phase === 'listening' || phase === 'finishing';
}

/**
 * The WHOLE page read right — every character ok or a homophone (`sound`), nothing tone-off,
 * wrong or missed, no extra words anywhere — and there was something to read. The apps throw
 * confetti once for such a take (`reader.read_aloud { all_right: true }`). A page read right but
 * with extra words said is 100% yet not all right (its `toCheck` counts the extras); nor is a take
 * stopped before the end (`stoppedEarly`), however well the part he read went.
 */
export function readAloudAllRight(r: Pick<ReadAloudResult, 'total' | 'right' | 'toCheck' | 'stoppedEarly'>): boolean {
  return r.total > 0 && r.right === r.total && r.toCheck === 0 && !r.stoppedEarly;
}

/** The line's note when he stopped before the end of the page. */
export const READ_ALOUD_STOPPED_EARLY = 'stopped early';

/**
 * The one line under the page: "✓ 92% — 2 to check" (icon + words, never colour alone); a take
 * stopped before the end says so — "✓ 96% — 1 to check · stopped early", "✓ 100% — right so far ·
 * stopped early" (the % is over the part he read).
 */
export function readAloudLine(r: Pick<ReadAloudResult, 'pct' | 'toCheck' | 'stoppedEarly'>): string {
  const early = r.stoppedEarly ? ` · ${READ_ALOUD_STOPPED_EARLY}` : '';
  if (r.toCheck === 0) return `✓ ${r.pct}% — ${r.stoppedEarly ? 'right so far' : 'all read right'}${early}`;
  const icon = r.pct >= 90 ? '✓' : r.pct >= 60 ? '≈' : '✕';
  return `${icon} ${r.pct}% — ${r.toCheck} to check${early}`;
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

/** A mark the legend explains (`ok` / `sound` carry no mark: read right). */
export type ReadAloudLegendKey = 'close' | 'wrong' | 'missed' | 'extra';

/** The legend's words, beside a sample of each mark (wavy = tone off, solid = wrong, dashed = missed, ‸ = extra). */
export const READ_ALOUD_LEGEND: Record<ReadAloudLegendKey, string> = {
  close: 'tone off',
  wrong: 'wrong',
  missed: 'missed',
  extra: 'extra words',
};

/**
 * The tiny legend under the line: only the marks this result shows, in a fixed order (tone off ·
 * wrong · missed · extra words); empty when everything was read right.
 */
export function readAloudLegend(r: Pick<ReadAloudResult, 'chars' | 'extraAtEnd'>): ReadAloudLegendKey[] {
  const has = (m: ReadAloudMark) => r.chars.some((c) => c.mark === m);
  const keys: ReadAloudLegendKey[] = [];
  if (has('close')) keys.push('close');
  if (has('wrong')) keys.push('wrong');
  if (has('missed')) keys.push('missed');
  if (r.extraAtEnd || r.chars.some((c) => !!c.extraBefore)) keys.push('extra');
  return keys;
}
