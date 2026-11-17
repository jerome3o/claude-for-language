/**
 * The ONE "why" sentence under an answer's verdict + diff (docs/STUDY_SESSION.md "Answer feedback: one line and a
 * diff"). Jerome, Nov 2026 — after the slim feedback took the explanations away: "I actually did like having the little
 * explainer, one sentence as to why my answer is also okay or why it's wrong. So just like one sentence. Maybe have a
 * little button that's like explain more or something."
 *
 * - `answerWhy` — one short plain sentence (≤ `ANSWER_WHY_MAX` characters): what the check (Claude's answer check,
 *   the sentence check, the read-take check, the word-order check) already said — its headline's first sentence, else
 *   its first tip — unless that is a stock line that says nothing ("Exactly right — nice!", "Nearly — compare with the
 *   corrected version.") or repeats the line above. With no check, the device's own reason where it has one: a
 *   homophone ("Same sounds — written differently: 由 vs 有"). An exact match needs no why.
 * - `answerMore` — what "Explain more ›" opens IN PLACE without a new call: the check's tips, its corrected line, its
 *   alternative (`null` = nothing more on hand: the surface may open Ask Claude about this answer instead).
 *
 * Pure; the Lab port is core `AnswerWhy.kt`, parity-tested (android-lab/parity/fixtures/answer-diff.ts).
 */
import type { AnswerDiff } from './answer-diff';
import { firstSentence } from './answer-diff';

/** The why sentence's length cap (characters). */
export const ANSWER_WHY_MAX = 110;
/** The small text button after the why. */
export const ANSWER_WHY_MORE = 'Explain more ›';
export const ANSWER_WHY_LESS = 'Show less';
/** The labels inside "Explain more". */
export const ANSWER_WHY_CORRECTED = 'Corrected:';
export const ANSWER_WHY_ALTERNATIVE = 'Also natural:';

/** What a check gives the why (the answer check, the sentence check, the read-take check's reason). */
export interface AnswerWhyCheck {
  headline?: string | null;
  tips?: readonly { text: string }[] | null;
  corrected?: string | null;
  alternative?: string | null;
}

/** Stock lines that carry no reason (the answer check's plain / neutral / exact headlines). */
export const ANSWER_WHY_STOCK: readonly string[] = [
  'Exactly right — nice!',
  'Natural and right — nicely said.',
  'Different wording, same meaning — that works.',
  'Nearly — compare with the corrected version.',
  'Not quite — compare with the corrected version.',
  'Nearly — one thing to fix.',
  'Not quite — have another go.',
];

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().replace(/[.!?。！？…]+$/u, '').toLowerCase();

/** A sentence that is a stock line or says what the line above already says. */
function saysNothing(s: string, line: string | null | undefined): boolean {
  if (!s) return true;
  if (ANSWER_WHY_STOCK.some((stock) => norm(stock) === norm(s))) return true;
  return !!line && norm(line) === norm(s);
}

/** The device's own reason: written differently, said the same (a homophone counted right). */
export function deviceWhy(diff: AnswerDiff): string | null {
  const pairs = diff.parts.filter((p) => p.kind === 'sound' && p.expected).map((p) => `${p.text} vs ${p.expected}`);
  if (pairs.length === 0) return null;
  const shown = pairs.slice(0, 3).join(', ');
  return firstSentence(`Same sounds — written differently: ${shown}${pairs.length > 3 ? ', …' : ''}`, ANSWER_WHY_MAX);
}

/**
 * The one why sentence (see the file comment); `null` = none. `line` = the verdict line the surface shows above it
 * (never repeated).
 */
export function answerWhy(args: { diff?: AnswerDiff | null; check?: AnswerWhyCheck | null; line?: string | null }): string | null {
  const { check, line } = args;
  if (check) {
    const head = firstSentence(check.headline, ANSWER_WHY_MAX);
    if (!saysNothing(head, line)) return head;
    for (const t of check.tips ?? []) {
      const tip = firstSentence(t.text, ANSWER_WHY_MAX);
      if (!saysNothing(tip, line)) return tip;
    }
  }
  const device = args.diff ? deviceWhy(args.diff) : null;
  return device && !saysNothing(device, line) ? device : null;
}

/** What "Explain more ›" shows in place: the check's tips, its corrected line, its alternative. */
export interface AnswerMore {
  tips: string[];
  corrected: string | null;
  alternative: string | null;
}

/**
 * The details a check already returned, minus the why sentence itself (`null` = nothing to open in place). `said` =
 * his answer (a corrected line equal to it is no correction).
 */
export function answerMore(check: AnswerWhyCheck | null | undefined, why: string | null, said = ''): AnswerMore | null {
  if (!check) return null;
  const whyKey = why ? norm(why) : '';
  const tips = (check.tips ?? []).map((t) => t.text.replace(/\s+/g, ' ').trim()).filter((t) => t && norm(t) !== whyKey && norm(firstSentence(t, ANSWER_WHY_MAX)) !== whyKey).slice(0, 4);
  const corrected = (check.corrected ?? '').trim();
  const alternative = (check.alternative ?? '').trim();
  const fixed = corrected && corrected !== said.trim() ? corrected : null;
  const alt = alternative && alternative !== said.trim() && alternative !== corrected ? alternative : null;
  // The headline beyond the why (the rest after its first sentence, or all of it when the why had to be cut short).
  const head = (check.headline ?? '').replace(/\s+/g, ' ').trim();
  let rest = '';
  if (why && head && head !== why) {
    if (why.endsWith('…')) rest = head;
    else if (head.startsWith(why)) rest = head.slice(why.length).trim();
  }
  const all = rest && !tips.some((t) => norm(t) === norm(rest)) ? [rest, ...tips].slice(0, 4) : tips;
  if (all.length === 0 && !fixed && !alt) return null;
  return { tips: all, corrected: fixed, alternative: alt };
}
