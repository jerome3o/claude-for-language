/**
 * "💬 Ask Claude" on the Sentence Coach (docs/CHAT.md "Ask Claude chat"; Jerome: "the coach could
 * actually be a really nice chat interface … a button that is just 'ask a question' … tapping on the
 * words to open up the map … a recap of all the words that I had to tap … Claude's words — for me to
 * be able to read them and have them checked").
 *
 * A plain chat with Claude, not tied to a card: Claude answers in simple, graded Chinese by default
 * (the same immersion rules and the same 中文 | EN setting as Ask Claude on the study card,
 * shared/study/askClaude.ts), every Chinese word is a chip into the language explorer, ▶ plays a
 * message in Claude's voice, 🎧 Listen first hides Claude's Chinese until heard, and 🎤 Read it back
 * judges the learner reading one of Claude's messages aloud with the graded readers' comparison
 * (shared/reader/readAloud.ts).
 *
 * The words he tapped — and the words a Read it back found real mistakes in — are kept per
 * conversation ON THE DEVICE (`AskRecapWord`), for a recap pass and "Make flashcards from this chat"
 * (whose default selection they are).
 *
 * Pure rules shared by the worker (the conversation kind, the title) and both apps. Lab port: core
 * `CoachAsk.kt`, parity-tested (android-lab/parity/fixtures/coach-ask.ts → CoachAskParityTest).
 */
import { conversationAction, type CoachAction } from './actions';
import { sentenceAround } from '../reader/words';
import type { ReadAloudChar, ReadAloudResult } from '../reader/readAloud';

/** `coach_conversations.action` of an Ask Claude chat (the column has no CHECK; older rows never carry it). */
export const COACH_ASK_ACTION = 'ask';

export type CoachConversationKind = CoachAction | 'ask';

/**
 * What a coach conversation is: an Ask Claude chat (`kind` 'ask', migration 0143 — `action` 'ask'
 * too), else one of the three sentence actions.
 */
export function conversationKind(conv: { kind?: string | null; action?: string | null; input_language?: string | null }): CoachConversationKind {
  return conv.kind === COACH_ASK_ACTION || conv.action === COACH_ASK_ACTION ? 'ask' : conversationAction(conv);
}

export const COACH_ASK_ICON = '💬';
export const COACH_ASK_LABEL = 'Ask Claude';
/** The line under the Coach page's button and the empty chat's hint. */
export const COACH_ASK_HINT = 'Ask anything — Claude answers in simple Chinese. Tap any word to look it up.';
export const COACH_ASK_EMPTY_EN = 'Ask anything. Claude answers in English here — switch to 中文 for immersion.';
export const COACH_ASK_PLACEHOLDER_ZH = '用中文问吧… (or English)';
export const COACH_ASK_PLACEHOLDER_EN = 'Ask anything…';
export const COACH_ASK_THINKING_ZH = '想一想… Thinking…';
export const COACH_ASK_THINKING_EN = 'Thinking…';
/** A question is at most this long (the route refuses longer). */
export const COACH_ASK_MAX_CHARS = 2000;
export const COACH_ASK_TITLE_MAX = 120;

/** The conversation's title: the first question, on one line, at most 120 characters. */
export function askConversationTitle(first: string): string {
  const one = (first || '').replace(/\s+/g, ' ').trim();
  const cps = [...one];
  return cps.length > COACH_ASK_TITLE_MAX ? `${cps.slice(0, COACH_ASK_TITLE_MAX - 1).join('')}…` : one;
}

// ---------- 🎤 Read it back ----------

export const READ_BACK_LABEL = 'Read it back';
export const READ_BACK_LISTENING = 'Listening… read Claude’s message aloud';

/** Longest message offered for Read it back / ▶ (the Ask Claude clip limit). */
export const READ_BACK_MAX_CHARS = 2000;

const HAN = /\p{Script=Han}/u;

/**
 * 🎤 Read it back / ▶ / 🎧 are offered on a message: Claude's finished answer in Chinese
 * (`answer_lang` 'zh') with Chinese in it, not too long. English answers and my own messages aren't.
 */
export function readBackOffered(m: { role: string; content: string; answer_lang?: string | null; status?: string | null }): boolean {
  if (m.role !== 'assistant' || m.status) return false;
  if (m.answer_lang !== 'zh') return false;
  const text = (m.content || '').trim();
  return text.length > 0 && text.length <= READ_BACK_MAX_CHARS && HAN.test(text);
}

// ---------- The words to recap (kept on the device, per conversation) ----------

export type AskRecapReason = 'tapped' | 'said_wrong';

/**
 * One word to recap. The shape the reader word recap shares (a word, its sentence, why it is here):
 * `reasons` in a fixed order (tapped, then said_wrong), `reason_line` = what went wrong in a
 * Read it back ("Tone off on 银 (heard 音)").
 */
export interface AskRecapWord {
  hanzi: string;
  pinyin?: string;
  gloss?: string;
  sentence: string;
  reasons: AskRecapReason[];
  reason_line?: string;
}

/** At most this many words per conversation (the oldest go). */
export const ASK_RECAP_MAX = 200;

const REASON_ORDER: AskRecapReason[] = ['tapped', 'said_wrong'];

/** The key words are merged by: no spaces. */
export function recapKey(hanzi: string): string {
  return (hanzi || '').replace(/\s+/g, '');
}

const clean = (s: string | undefined | null): string | undefined => {
  const t = (s ?? '').trim();
  return t ? t : undefined;
};

/**
 * Add a word: a new word goes at the end; a word already there gets the new reason (fixed order),
 * the pinyin / gloss it lacked, the newest reason line — its sentence stays the first one. A word
 * with no Chinese is ignored. The list keeps the newest ASK_RECAP_MAX.
 */
export function addRecapWord(list: readonly AskRecapWord[], word: AskRecapWord, max: number = ASK_RECAP_MAX): AskRecapWord[] {
  const key = recapKey(word.hanzi);
  if (!key || !HAN.test(key)) return [...list];
  const i = list.findIndex((w) => recapKey(w.hanzi) === key);
  if (i < 0) {
    const fresh: AskRecapWord = { hanzi: key, sentence: (word.sentence || '').trim(), reasons: REASON_ORDER.filter((r) => word.reasons.includes(r)) };
    const py = clean(word.pinyin);
    const gloss = clean(word.gloss);
    const line = clean(word.reason_line);
    if (py) fresh.pinyin = py;
    if (gloss) fresh.gloss = gloss;
    if (line) fresh.reason_line = line;
    const next = [...list, fresh];
    return next.length > max ? next.slice(next.length - max) : next;
  }
  const old = list[i];
  const merged: AskRecapWord = {
    hanzi: old.hanzi,
    sentence: old.sentence || (word.sentence || '').trim(),
    reasons: REASON_ORDER.filter((r) => old.reasons.includes(r) || word.reasons.includes(r)),
  };
  const py = clean(old.pinyin) ?? clean(word.pinyin);
  const gloss = clean(old.gloss) ?? clean(word.gloss);
  const line = clean(word.reason_line) ?? clean(old.reason_line);
  if (py) merged.pinyin = py;
  if (gloss) merged.gloss = gloss;
  if (line) merged.reason_line = line;
  const next = [...list];
  next[i] = merged;
  return next;
}

export function addRecapWords(list: readonly AskRecapWord[], words: readonly AskRecapWord[], max: number = ASK_RECAP_MAX): AskRecapWord[] {
  return words.reduce<AskRecapWord[]>((acc, w) => addRecapWord(acc, w, max), [...list]);
}

const ISSUE = new Set(['close', 'wrong', 'missed']);

/** A word's characters from a Read it back with a real mistake (tone off / wrong / missed — an extra alone isn't one). */
export function readBackWordWrong(chars: readonly Pick<ReadAloudChar, 'mark'>[]): boolean {
  return chars.some((c) => ISSUE.has(c.mark));
}

/** What went wrong in one word, in a line: "Tone off on 银 (heard 音) · missed 行". */
export function readBackReasonLine(chars: readonly ReadAloudChar[]): string {
  const parts: string[] = [];
  for (const c of chars) {
    if (c.mark === 'close') parts.push(`tone off on ${c.char}${c.heard ? ` (heard ${c.heard})` : ''}`);
    else if (c.mark === 'wrong') parts.push(c.heard ? `heard ${c.heard} for ${c.char}` : `${c.char} was wrong`);
    else if (c.mark === 'missed') parts.push(`missed ${c.char}`);
  }
  const line = parts.join(' · ');
  return line ? line[0].toUpperCase() + line.slice(1) : '';
}

/**
 * The words of a message a Read it back found real mistakes in, as recap words. `words` = the
 * message cut into words (the device segmenter) — they must concatenate to `text`, else each Han
 * character counts as its own word. `result` is `judgeReadAloud(text, …)`.
 */
export function readBackMistakeWords(text: string, words: readonly string[], result: Pick<ReadAloudResult, 'chars'>): AskRecapWord[] {
  const cps = [...text];
  if (result.chars.length !== cps.length) return [];
  const segments = words.join('') === text && words.length > 0 ? words : cps;
  const out: AskRecapWord[] = [];
  let cp = 0;
  let unit = 0; // UTF-16 offset (sentenceAround works on string indices)
  for (const w of segments) {
    const len = [...w].length;
    const chars = result.chars.slice(cp, cp + len);
    if (HAN.test(w) && readBackWordWrong(chars)) {
      out.push({
        hanzi: recapKey(w),
        sentence: sentenceAround(text, unit, unit + w.length),
        reasons: ['said_wrong'],
        reason_line: readBackReasonLine(chars),
      });
    }
    cp += len;
    unit += w.length;
  }
  return out;
}

/** The ⋯ menu's recap row: "📝 3 words to recap". */
export function recapCountLabel(n: number): string {
  if (n <= 0) return '📝 No words to recap yet';
  return `📝 ${n} word${n === 1 ? '' : 's'} to recap`;
}

export const RECAP_COMING_SOON = 'Coming soon';

/**
 * "Make flashcards from this chat": a proposed card starts ticked when it is one of the recap words
 * (tapped or said wrong) and not already in his decks; with no recap words, every new card is.
 */
export function askCardChecked(card: { hanzi: string; already_have: boolean }, recap: readonly Pick<AskRecapWord, 'hanzi'>[]): boolean {
  if (card.already_have) return false;
  if (recap.length === 0) return true;
  const key = recapKey(card.hanzi);
  return recap.some((w) => recapKey(w.hanzi) === key);
}

/** The words sent with the propose request (the server puts them first), newest last, ≤ 40. */
export function recapFocusWords(recap: readonly Pick<AskRecapWord, 'hanzi'>[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of recap) {
    const k = recapKey(w.hanzi);
    if (k && !seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out.slice(-40);
}
