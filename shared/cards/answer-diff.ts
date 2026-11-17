/**
 * The slim answer feedback (docs/STUDY_SESSION.md "Answer feedback: one line and a diff"; Jerome, Nov 2026:
 * "When I am on a hard mode card and I get it wrong, it pops up with the little 'how I said it wrong' display.
 * This is way too much information … Slim it down: no explanations, just one short sentence that summarises
 * what the differences were. Then a diff view where it's clear what the issues with my answer were").
 *
 * ONE rule set every "how your answer differs" surface follows (Hard mode's check, the sentence check, the read
 * take, "You said", the Sentence round, the homework pass, a mini lesson's answer check, the Coach's Practise
 * saying it, a reader's 🎤 Read it aloud):
 *
 * 1. `answerDiff(said, expected)` — his answer against the expected one, CHARACTER BY CHARACTER, lined up by the
 *    reader's read-aloud judge (`judgeReadAloud`: numbers as hanzi — a 3 IS 三 —, 两 = 二, simplified, each
 *    character's syllable in context): a list of parts in reading order —
 *    - `ok` his character is the expected one; `sound` another character with the same toned syllable (a
 *      homophone: counts as RIGHT, "written X" at most);
 *    - `tone` the same syllable in another tone (都 dū said dù);
 *    - `wrong` another character (red); `extra` a character he added (yellow); `missing` an expected character
 *      he left out (shown as the expected character in a muted dashed slot);
 *    - `plain` punctuation / spaces of the expected answer.
 * 2. `answerDiffSummary(diff)` — ONE short sentence from the diff, no explanations: "Right", "Sounded right —
 *    written 由", "Tone off on 都", "Extra 了 at the end", "Missing 了", "得 instead of 的", "Right words,
 *    different order", "2 wrong characters, 1 missing", "Quite different from the answer".
 * 3. `answerDiffLine({ diff, accepted, headline })` — the line a surface shows: the summary, "Right — worded
 *    differently" for an answer Claude (or the card's alternatives) accepted in other words, or Claude's first
 *    sentence only when the answer is too different for a character count to say anything.
 *
 * Pure; the Lab port is core `AnswerDiff.kt`, parity-tested (android-lab/parity/fixtures/answer-diff.ts).
 */
import { judgeReadAloud, readAloudKeys } from '../reader/readAloud';

export type AnswerDiffKind = 'ok' | 'sound' | 'tone' | 'wrong' | 'extra' | 'missing' | 'plain';
export const ANSWER_DIFF_KINDS: readonly AnswerDiffKind[] = ['ok', 'sound', 'tone', 'wrong', 'extra', 'missing', 'plain'];

export interface AnswerDiffPart {
  /** What to show: his character(s) — the expected one(s) for `missing`, the punctuation for `plain`. */
  text: string;
  kind: AnswerDiffKind;
  /** The expected character(s) this part stands for ('' for `extra` / `plain`). */
  expected: string;
}

export interface AnswerDiff {
  parts: AnswerDiffPart[];
  /** Characters (a digit run "12" counts once) per kind; `extra` counts characters he added. */
  wrong: number;
  tone: number;
  missing: number;
  extra: number;
  sound: number;
  /** Nothing to fix (homophones allowed) and something was said. */
  right: boolean;
  /** The expected characters, each as often, in another order. */
  reordered: boolean;
  /** Nothing to compare: he said nothing (or only punctuation). */
  empty: boolean;
}

const cps = (s: string) => [...s];

/** His answer against the expected one, character by character (see the file comment). */
export function answerDiff(said: string, expected: string): AnswerDiff {
  const r = judgeReadAloud(expected, said);
  const parts: AnswerDiffPart[] = [];
  const push = (p: AnswerDiffPart) => {
    // A run of the same kind stays one part only for extras (a word he added); every other part is one unit.
    const last = parts[parts.length - 1];
    if (p.kind === 'extra' && last && last.kind === 'extra') last.text += p.text;
    else parts.push(p);
  };
  const count = { wrong: 0, tone: 0, missing: 0, extra: 0, sound: 0 };
  const chars = r.chars;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (c.extraBefore) {
      push({ text: c.extraBefore, kind: 'extra', expected: '' });
      count.extra += cps(c.extraBefore).length;
    }
    if (c.unitCont) continue;
    // A unit's expected text: the character, or a whole digit run ("12").
    let unit = c.char;
    for (let n = i + 1; n < chars.length && chars[n].unitCont; n++) unit += chars[n].char;
    switch (c.mark) {
      case 'plain': push({ text: c.char, kind: 'plain', expected: '' }); break;
      case 'ok': push({ text: c.heard || unit, kind: 'ok', expected: unit }); break;
      case 'sound': push({ text: c.heard, kind: 'sound', expected: unit }); count.sound++; break;
      case 'close': push({ text: c.heard, kind: 'tone', expected: unit }); count.tone++; break;
      case 'wrong': push({ text: c.heard, kind: 'wrong', expected: unit }); count.wrong++; break;
      default: push({ text: unit, kind: 'missing', expected: unit }); count.missing++; break; // missed / unread
    }
  }
  if (r.extraAtEnd) {
    push({ text: r.extraAtEnd, kind: 'extra', expected: '' });
    count.extra += cps(r.extraAtEnd).length;
  }
  const saidKeys = readAloudKeys(said);
  const expectedKeys = readAloudKeys(expected);
  const empty = saidKeys.length === 0;
  const fixes = count.wrong + count.tone + count.missing + count.extra;
  const sorted = (k: string[]) => [...k].sort().join('');
  const reordered = !empty && fixes > 0 && saidKeys.length === expectedKeys.length
    && sorted(saidKeys) === sorted(expectedKeys) && saidKeys.join('') !== expectedKeys.join('');
  return { parts, ...count, right: !empty && fixes === 0, reordered, empty };
}

// --- the one sentence ------------------------------------------------------------------------------

export const ANSWER_DIFF_RIGHT = 'Right';
export const ANSWER_DIFF_WORDED = 'Right — worded differently';
export const ANSWER_DIFF_ORDER = 'Right words, different order';
export const ANSWER_DIFF_FAR = 'Quite different from the answer';
export const ANSWER_DIFF_EMPTY = 'Nothing to compare';

/** Runs of consecutive parts of one kind (punctuation between them doesn't break a run). */
function runsOf(parts: readonly AnswerDiffPart[], kind: AnswerDiffKind): { text: string; expected: string; first: number; last: number }[] {
  const out: { text: string; expected: string; first: number; last: number }[] = [];
  let cur: { text: string; expected: string; first: number; last: number } | null = null;
  parts.forEach((p, i) => {
    if (p.kind === kind) {
      if (cur) { cur.text += p.text; cur.expected += p.expected; cur.last = i; }
      else { cur = { text: p.text, expected: p.expected, first: i, last: i }; out.push(cur); }
    } else if (p.kind !== 'plain') {
      cur = null;
    }
  });
  return out;
}

/** Where a run sits: before every other character / after every other character / inside. */
function where(parts: readonly AnswerDiffPart[], run: { first: number; last: number }): '' | ' at the start' | ' at the end' {
  const other = (p: AnswerDiffPart) => p.kind !== 'plain' && p.kind !== 'missing' && p.kind !== 'extra';
  const before = parts.slice(0, run.first).some(other);
  const after = parts.slice(run.last + 1).some(other);
  if (!before && after) return ' at the start';
  if (before && !after) return ' at the end';
  return '';
}

const SHORT = 4;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const joinAnd = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/**
 * ONE short sentence that says what differs — deterministic, from the diff alone (the file comment lists them).
 * Never an explanation: no reasons, no tips, no tones named.
 */
export function answerDiffSummary(d: AnswerDiff): string {
  if (d.empty) return ANSWER_DIFF_EMPTY;
  if (d.right) {
    if (d.sound === 0) return ANSWER_DIFF_RIGHT;
    const written = d.parts.filter((p) => p.kind === 'sound').map((p) => p.text).join('');
    return `Sounded right — written ${written}`;
  }
  if (d.reordered) return ANSWER_DIFF_ORDER;
  const kinds = (['wrong', 'missing', 'extra', 'tone'] as const).filter((k) => d[k] > 0);
  const units = d.parts.filter((p) => p.kind !== 'plain' && p.kind !== 'extra').length;
  const off = d.wrong + d.missing + Math.min(d.extra, 4);
  if (off > SHORT && off * 2 > Math.max(units, 1)) return ANSWER_DIFF_FAR;
  if (kinds.length === 1) {
    const kind = kinds[0];
    const runs = runsOf(d.parts, kind);
    const run = runs.length === 1 && cps(kind === 'missing' ? runs[0].expected : runs[0].text).length <= SHORT ? runs[0] : null;
    switch (kind) {
      case 'tone': {
        const on = d.parts.filter((p) => p.kind === 'tone').map((p) => p.expected);
        return on.length <= 2 ? `${on.length === 1 ? 'Tone' : 'Tones'} off on ${joinAnd(on)}` : `${on.length} tones off`;
      }
      case 'extra': return run ? `Extra ${run.text}${where(d.parts, run)}` : plural(d.extra, 'extra character', 'extra characters');
      case 'missing': return run ? `Missing ${run.expected}${where(d.parts, run)}` : `${plural(d.missing, 'character', 'characters')} missing`;
      case 'wrong': return run ? `${run.text} instead of ${run.expected}` : plural(d.wrong, 'wrong character', 'wrong characters');
    }
  }
  // Mixed: counts, the first with its noun — "2 wrong characters, 1 missing, 1 tone off".
  return kinds.map((k, i) => {
    const n = d[k];
    const noun = i === 0 ? (n === 1 ? ' character' : ' characters') : '';
    switch (k) {
      case 'wrong': return `${n} wrong${noun}`;
      case 'missing': return i === 0 ? `${n}${noun} missing` : `${n} missing`;
      case 'extra': return `${n} extra${noun}`;
      default: return `${n} ${n === 1 ? 'tone' : 'tones'} off`;
    }
  }).join(', ');
}

/** The first sentence of a line, at most ~90 characters (Claude's headline, never its explanation). */
export function firstSentence(text: string | null | undefined, max = 90): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const m = t.match(/^.+?[.!?。！？](?=\s|$)/u);
  const s = (m ? m[0] : t).trim();
  return cps(s).length <= max ? s : `${cps(s).slice(0, max - 1).join('').trimEnd()}…`;
}

/**
 * The line a surface shows above the diff: `accepted` (Claude said correct / acceptable, a listed alternative) →
 * "Right — worded differently" unless the diff itself is right (then its own "Right" / "Sounded right — written 由");
 * otherwise the summary — or, when the answer is too different for a count to help, Claude's `headline` (its
 * first sentence only) where there is one.
 */
export function answerDiffLine(args: { diff: AnswerDiff; accepted?: boolean; headline?: string | null }): string {
  const { diff } = args;
  if (args.accepted) {
    if (diff.right) return answerDiffSummary(diff);
    return diff.reordered ? ANSWER_DIFF_ORDER : ANSWER_DIFF_WORDED;
  }
  const summary = answerDiffSummary(diff);
  const headline = firstSentence(args.headline);
  return summary === ANSWER_DIFF_FAR && headline ? headline : summary;
}

/**
 * The line's tone (its icon + colour, never colour alone): `right` ✓ (accepted, or nothing to fix), `close` ≈ (only
 * tones slipped, or the right characters in another order), `wrong` ✕.
 */
export type AnswerDiffTone = 'right' | 'close' | 'wrong';
export function answerDiffTone(diff: AnswerDiff, accepted = false): AnswerDiffTone {
  if (accepted || diff.right) return 'right';
  if (diff.empty) return 'wrong';
  if (diff.reordered || (diff.wrong + diff.missing + diff.extra === 0)) return 'close';
  return 'wrong';
}
/** The tone's icon: ✓ · ≈ · ✕. */
export const ANSWER_DIFF_ICON: Record<AnswerDiffTone, string> = { right: '✓', close: '≈', wrong: '✕' };

/**
 * A verdict that isn't the diff's own, as the line's small chip: Claude's check (correct · acceptable · almost ·
 * wrong) or Hard mode's question result (right · close · wrong) — "≈ Almost · Tone off on 都".
 */
export type AnswerDiffVerdictKey = 'correct' | 'acceptable' | 'almost' | 'wrong' | 'right' | 'close';
export const ANSWER_DIFF_VERDICT: Record<AnswerDiffVerdictKey, { tone: AnswerDiffTone; label: string }> = {
  correct: { tone: 'right', label: 'Correct' },
  acceptable: { tone: 'right', label: 'Also right' },
  almost: { tone: 'close', label: 'Almost' },
  wrong: { tone: 'wrong', label: 'Not quite' },
  right: { tone: 'right', label: 'Right' },
  close: { tone: 'close', label: 'Nearly' },
};

/** One part for a screen reader ("得 — wrong, the answer has 的"; the marks are never colour alone). */
export function answerDiffPartLabel(p: AnswerDiffPart): string {
  switch (p.kind) {
    case 'sound': return `${p.text} — sounded right, written ${p.expected} in the answer`;
    case 'tone': return `${p.text} — tone off (${p.expected})`;
    case 'wrong': return `${p.text} — wrong, the answer has ${p.expected}`;
    case 'extra': return `${p.text} — extra`;
    case 'missing': return `missing ${p.expected}`;
    default: return p.text;
  }
}

/** The whole diff as one sentence for a screen reader: "Your answer: 我们去了北京. 1 extra character." */
export function answerDiffLabel(d: AnswerDiff, line: string, label = 'Your answer'): string {
  const said = d.parts.filter((p) => p.kind !== 'missing').map((p) => p.text).join('');
  const marked = d.parts.filter((p) => p.kind !== 'ok' && p.kind !== 'plain').map(answerDiffPartLabel);
  return `${label}: ${said || '…'}. ${line}.${marked.length ? ` ${marked.join('; ')}.` : ''}`.replace(/\.\./g, '.');
}

/** The diff's small label in each surface. */
export const ANSWER_DIFF_YOU_SAID = 'You said';
export const ANSWER_DIFF_YOUR_ANSWER = 'Your answer';
