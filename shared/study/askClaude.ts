/**
 * Ask Claude on the study card, immersion edition (docs/STUDY_SESSION.md "Ask Claude"):
 * Claude answers in simple, graded Chinese by default — the setting "Ask Claude answers in:
 * 中文 / English" (`users.ask_claude_language`) — and the conversation renders like the tutor
 * chat (word chips, long-press menu, the auto-check on the learner's own Chinese).
 *
 * Pure rules shared by the worker (which language a turn is answered in, the plain text a
 * Chinese answer is stored as) and both apps (the quick-question chips). The Lab app ports the
 * client half in core `AskClaude.kt`, parity-tested (android-lab/parity/fixtures/ask-claude.ts).
 */

import { DEFAULT_LESSON_VOICE } from '../lesson/voices';
import { CHAT_READ_ALOUD_SPEED } from '../chats/voice';
import { addRevealed, hasHan, REVEALED_MAX } from '../chats/listening';

export type AskLanguage = 'zh' | 'en';

/** NULL in `users.ask_claude_language` = this: answers in Chinese. */
export const DEFAULT_ASK_LANGUAGE: AskLanguage = 'zh';

/** A stored / sent value as a language, or null for anything else ("default"). */
export function parseAskLanguage(v: unknown): AskLanguage | null {
  return v === 'zh' || v === 'en' ? v : null;
}

/** The language answers come in: the choice, else the default (Chinese). */
export function effectiveAskLanguage(setting: unknown): AskLanguage {
  return parseAskLanguage(setting) ?? DEFAULT_ASK_LANGUAGE;
}

const ENGLISH_REQUEST = [
  /\bin english\b/i,
  /\benglish (please|pls|plz)\b/i,
  /\b(answer|reply|explain|say|respond|tell me|write)( it| this| that)?( to me)? (in )?english\b/i,
  /\bswitch to english\b/i,
  /(用|说|講|讲)(英文|英语|英語)/,
  /英文(解释|回答|说)/,
];

/**
 * The learner explicitly asks for English ("in English please", "用英文解释") — that turn is
 * answered in English whatever the setting says. Merely writing in English is NOT a request.
 */
export function asksForEnglish(question: string): boolean {
  const q = (question || '').trim();
  if (!q) return false;
  return ENGLISH_REQUEST.some((re) => re.test(q));
}

/** The language one turn is answered in: an explicit request for English wins, else the setting. */
export function turnLanguage(setting: unknown, question: string): AskLanguage {
  if (asksForEnglish(question)) return 'en';
  return effectiveAskLanguage(setting);
}

/**
 * A Chinese answer as the plain text the bubble shows (and the word chips are cut from):
 * Markdown the model slipped in is taken out — **bold**, __bold__, `code`, # headings,
 * > quotes, horizontal rules, table pipes — bullets become "・", runs of blank lines one,
 * trailing spaces gone. Text without Markdown is returned as it is (trimmed).
 */
export function plainAnswerText(answer: string): string {
  const lines = (answer || '').replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  for (const raw of lines) {
    let line = raw.replace(/\s+$/, '');
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) continue; // --- / *** rules
    if (/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line)) continue; // | --- | --- |
    line = line.replace(/^\s{0,3}#{1,6}\s+/, ''); // headings
    line = line.replace(/^\s*>\s?/, ''); // quotes
    line = line.replace(/^(\s*)[-*+]\s+/, '$1・'); // bullets
    if (/^\s*\|.*\|\s*$/.test(line)) {
      line = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()).filter(Boolean).join('　');
    }
    line = line
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/__(.+?)__/g, '$1')
      // *斜体* — only around Chinese, so "3*4" or "a*b" survive
      .replace(/(^|[^*])\*([^*\n]*[\u3400-\u9fff][^*\n]*)\*(?!\*)/g, '$1$2')
      .replace(/`([^`]+)`/g, '$1');
    out.push(line);
  }
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** One quick question before the first one (`QUICK_ACTIONS`): the chip's label and what it sends. */
export interface AskQuickAction {
  id: string;
  label: string;
  question: string;
}

/**
 * The chips shown before the first question. In Chinese mode the questions themselves are in
 * simple Chinese (the conversation stays Chinese); the labels stay short and bilingual.
 * "Check my answer" only for a typing card with an answer; "Explain sentence" only when the card
 * has an example sentence.
 */
export function askQuickActions(opts: { language: AskLanguage; typedAnswer: boolean; hasSentence: boolean }): AskQuickAction[] {
  const zh = opts.language === 'zh';
  const list: AskQuickAction[] = [
    {
      id: 'sentences',
      label: zh ? '造句 Use in sentence' : 'Use in sentence',
      question: zh ? '请用这个词造几个简单的句子。' : 'Please use this word in a few example sentences with pinyin and English translations.',
    },
    {
      id: 'characters',
      label: zh ? '每个字 Explain characters' : 'Explain characters',
      question: zh ? '请解释这个词里的每个字。' : 'Please break down each character in this word, explaining the radicals, components, and individual meanings.',
    },
    {
      id: 'related',
      label: zh ? '相关的词 Related words' : 'Related words',
      question: zh ? '跟这个词有关的词还有哪些？' : 'What are some related words or phrases I should learn alongside this one?',
    },
  ];
  // One chip, not two that read as duplicates ("Check" + "Verify").
  if (opts.typedAnswer) {
    list.push({
      id: 'check_answer',
      label: zh ? '我的答案 Check my answer' : 'Check my answer',
      question: zh ? '我的答案对吗？如果不对，哪里错了？' : 'Is my answer correct, grammatically and in meaning? If not, explain what is wrong and how I can improve.',
    });
  }
  list.push(
    {
      id: 'grammar',
      label: zh ? '语法 Explain grammar' : 'Explain grammar',
      question: zh ? '请讲一下这个词的用法和语法。' : 'Can you explain the grammar of this sentence and break down each word?',
    },
    {
      id: 'fun_fact',
      label: zh ? '小知识 Add a fun fact' : 'Add a fun fact',
      question: zh ? '请给这张卡片加一个有意思的小知识。' : 'Add a brief, interesting fun fact or cultural context to this card.',
    },
  );
  if (opts.hasSentence) {
    list.push({
      id: 'sentence',
      label: zh ? '例句 Explain sentence' : 'Explain sentence',
      question: zh ? '请解释一下这张卡片的例句。' : 'Please explain the example sentence for this card. Break down the grammar, explain each word, and provide any cultural context.',
    });
  }
  return list;
}

// ---------------------------------------------------------------------------------------------
// 🎧 Listen first — the chat's listening mode (shared/chats/listening.ts) in the Ask Claude sheet.
// Jerome: "Please also allow it to be toggled to audio first, in the same way the messages are,
// so I can listen to the answer." Claude's Chinese answers arrive as the chat's hidden bubble —
// tap plays, long press reveals — and a new one plays once by itself. Ported in core `AskClaude.kt`
// (parity-tested by android-lab/parity/fixtures/ask-claude.ts).
// ---------------------------------------------------------------------------------------------

/**
 * The voice Claude's answers are read in (Read aloud, the listening tap, the server's
 * pre-generated clip): the app's own voice — the one every card and word clip speaks in — at the
 * chat's read-aloud speed. It is what `chatReadAloudVoice` gives a sender with no voice gender, so
 * it never depends on the listener's conversation voices: one clip per answer, made once.
 */
export const ASK_CLAUDE_VOICE = DEFAULT_LESSON_VOICE;
export const ASK_CLAUDE_SPEED = CHAT_READ_ALOUD_SPEED;

/**
 * Longest answer a clip is made for (the chat's `wantsClip` limit). An answer is ONE clip: the
 * TTS path has no length limit below MiniMax's 10,000 characters, and answers are a few hundred.
 */
export const ASK_CLIP_MAX_CHARS = 2000;

/** `users.ask_claude_listening` / a request's `listening`: on only for true / 1 (NULL = off). */
export function parseAskListening(v: unknown): boolean {
  return v === true || v === 1 || v === '1';
}

/** The parts of a Q&A the listening rules read. */
export interface AskListeningEntry {
  id: string;
  answer: string;
  answer_lang?: string | null;
}

/**
 * An answer listening mode could hide: Claude's answer in Chinese (`answer_lang` 'zh', plain
 * text) that has Chinese in it. My own questions never hide, and neither do English answers
 * (EN mode, "in English please") or older Markdown answers.
 */
export function askListeningCandidate(entry: AskListeningEntry): boolean {
  if (entry.answer_lang !== 'zh') return false;
  const text = (entry.answer || '').trim();
  return text.length > 0 && text.length <= ASK_CLIP_MAX_CHARS && hasHan(text);
}

function revealedHas(revealed: ReadonlySet<string> | readonly string[], id: string): boolean {
  return Array.isArray(revealed) ? revealed.includes(id) : (revealed as ReadonlySet<string>).has(id);
}

/** Is this answer drawn as the chat's hidden listening bubble? */
export function askAnswerHidden(entry: AskListeningEntry, ctx: { listening: boolean; revealed: ReadonlySet<string> | readonly string[] }): boolean {
  return ctx.listening && askListeningCandidate(entry) && !revealedHas(ctx.revealed, entry.id);
}

/**
 * Switched ON in the sheet: the answers already on screen stay as they are (the chat's
 * `sinceWhenTurnedOn` — history stays, anything newer hides), so they join the revealed ids.
 * Returns the new revealed list (newest last, capped like the chat's).
 */
export function revealedWhenListeningOn(entries: readonly AskListeningEntry[], revealed: readonly string[], max: number = REVEALED_MAX): string[] {
  let next = [...revealed];
  for (const e of entries) if (askListeningCandidate(e) && !next.includes(e.id)) next = addRevealed(next, e.id, max);
  return next;
}

/**
 * The answer to play by itself: the newest one, when it arrived while the sheet was open (not in
 * `seen` = the ids on screen when the sheet opened, plus every id this already looked at), it is
 * hidden, and no audio is playing or loading (Read aloud, another hidden answer). Once only: the
 * caller adds the newest id to `seen` whatever this returns. The chat has no auto-play — this is
 * Ask Claude's own: the learner has just asked and is waiting for the answer.
 */
export function askAutoPlayId(opts: {
  listening: boolean;
  entries: readonly AskListeningEntry[];
  seen: ReadonlySet<string> | readonly string[];
  revealed: ReadonlySet<string> | readonly string[];
  audioBusy: boolean;
}): string | null {
  if (!opts.listening || opts.audioBusy || opts.entries.length === 0) return null;
  const last = opts.entries[opts.entries.length - 1];
  if (revealedHas(opts.seen, last.id)) return null;
  return askAnswerHidden(last, { listening: true, revealed: opts.revealed }) ? last.id : null;
}
