/**
 * Ask Claude on the study card, immersion edition (docs/STUDY_SESSION.md "Ask Claude"):
 * the stored Q&A row (`note_questions`) shaped for the apps, and the learning tools the
 * conversation borrows from the tutor chat — word chips (the reader words splitter,
 * `segmentReaderText`), Translate (`translateChineseText`) and the background "Check my
 * Chinese" of the learner's own question (the chat's auto-check: `defaultAutoChecker` +
 * `normalizeAutoCheck`, the same `chat_auto_check` switch). Nothing is re-implemented here:
 * each piece is the chat's, pointed at a `note_questions` row.
 */

import type { Env } from '../types';
import { parseReaderWords, type ReaderWord } from '@shared/reader/words';
import { autoCheckApplies, autoCheckSkipReason, parseAutoCheck, type AutoCheckResult } from '@shared/chats/autoCheck';
import { parseAskLanguage, type AskLanguage } from '@shared/study/askClaude';
import { StructuredCallError } from './structured-call';
import { defaultSegment, type Segment } from './chat/messages';
import { defaultAutoChecker, normalizeAutoCheck, type AutoChecker } from './chat/auto-check';
import { HAN, WORDS_MAX_CHARS } from './chat/words';

export type AskPart = 'answer' | 'question';

/** A `note_questions` row as stored (migration 0116 adds the immersion columns). */
export interface NoteQuestionRow {
  id: string;
  note_id: string;
  question: string;
  answer: string;
  asked_at: string;
  answer_lang?: string | null;
  answer_words?: string | null;
  answer_translation?: string | null;
  question_words?: string | null;
  question_translation?: string | null;
  question_check?: string | null;
}

/** What the apps get for one Q&A. */
export interface AskQuestionView {
  id: string;
  note_id: string;
  question: string;
  answer: string;
  asked_at: string;
  /** 'zh' = plain Chinese text (word chips), 'en' = Markdown; null = an answer from before (English Markdown). */
  answer_lang: AskLanguage | null;
  /** Word chips of the answer, while they still concatenate to it; null = not made yet / no Chinese. */
  answer_words: ReaderWord[] | null;
  answer_translation: string | null;
  question_words: ReaderWord[] | null;
  question_translation: string | null;
  /** The background check of the question (only while it is about the question's text). */
  question_check: AutoCheckResult | null;
}

export class AskClaudeError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409 | 502 | 503) {
    super(message);
  }
}

export function shapeNoteQuestion(row: NoteQuestionRow): AskQuestionView {
  return {
    id: row.id,
    note_id: row.note_id,
    question: row.question,
    answer: row.answer,
    asked_at: row.asked_at,
    answer_lang: parseAskLanguage(row.answer_lang),
    answer_words: row.answer_words ? parseReaderWords(row.answer_words, row.answer) : null,
    answer_translation: row.answer_translation || null,
    question_words: row.question_words ? parseReaderWords(row.question_words, row.question) : null,
    question_translation: row.question_translation || null,
    question_check: parseAutoCheck(row.question_check, row.question),
  };
}

/** The row, if its note is in one of the caller's decks. */
export async function loadOwnedQuestion(db: D1Database, id: string, userId: string): Promise<NoteQuestionRow> {
  const row = await db
    .prepare(
      `SELECT q.* FROM note_questions q
         JOIN notes n ON n.id = q.note_id
         JOIN decks d ON d.id = n.deck_id
        WHERE q.id = ? AND d.user_id = ?`,
    )
    .bind(id, userId)
    .first<NoteQuestionRow>();
  if (!row) throw new AskClaudeError('Question not found', 404);
  return row;
}

export function parsePart(v: unknown): AskPart {
  if (v === 'answer' || v === 'question') return v;
  throw new AskClaudeError("part must be 'answer' or 'question'", 400);
}

const textOf = (row: NoteQuestionRow, part: AskPart) => (part === 'answer' ? row.answer : row.question);

/**
 * Word chips of the answer / the question, made now if missing (and stored while the text is
 * still the one split). Null when it has no Chinese.
 */
export async function ensureAskWords(
  env: Pick<Env, 'DB' | 'ANTHROPIC_API_KEY'>,
  id: string,
  userId: string,
  part: AskPart,
  deps: { segment?: Segment | null } = {},
): Promise<{ words: ReaderWord[] | null; cached: boolean }> {
  const row = await loadOwnedQuestion(env.DB, id, userId);
  const text = textOf(row, part);
  if (!text || !HAN.test(text)) return { words: null, cached: false };
  const stored = parseReaderWords(part === 'answer' ? row.answer_words : row.question_words, text);
  if (stored) return { words: stored, cached: true };
  if (text.length > WORDS_MAX_CHARS) throw new AskClaudeError('This text is too long to split into words', 400);
  const segment = deps.segment === undefined ? defaultSegment(env) : deps.segment;
  if (!segment) throw new AskClaudeError('AI is not configured', 503);
  let words: ReaderWord[];
  try {
    words = await segment(text);
  } catch (err) {
    console.error('[ask] splitting into words failed for', id, err instanceof Error ? err.message : err);
    const retryable = !(err instanceof StructuredCallError) || err.retryable;
    throw new AskClaudeError('Could not split this into words just now — try again', retryable ? 503 : 502);
  }
  const col = part === 'answer' ? 'answer_words' : 'question_words';
  const src = part === 'answer' ? 'answer' : 'question';
  await env.DB.prepare(`UPDATE note_questions SET ${col} = ? WHERE id = ? AND ${src} = ?`).bind(JSON.stringify(words), id, text).run();
  return { words, cached: false };
}

export type Translate = (text: string) => Promise<string>;

function defaultTranslate(env: Pick<Env, 'ANTHROPIC_API_KEY'>): Translate | null {
  if (!env.ANTHROPIC_API_KEY) return null;
  return async (text) => {
    const { translateChineseText } = await import('./translation');
    return translateChineseText(env.ANTHROPIC_API_KEY, text);
  };
}

/** The answer / the question in English (the long-press menu's Translate), stored on the row. */
export async function ensureAskTranslation(
  env: Pick<Env, 'DB' | 'ANTHROPIC_API_KEY'>,
  id: string,
  userId: string,
  part: AskPart,
  deps: { translate?: Translate | null } = {},
): Promise<{ translation: string; cached: boolean }> {
  const row = await loadOwnedQuestion(env.DB, id, userId);
  const stored = part === 'answer' ? row.answer_translation : row.question_translation;
  if (stored) return { translation: stored, cached: true };
  const text = textOf(row, part);
  if (!text || !HAN.test(text)) throw new AskClaudeError('There is no Chinese to translate', 400);
  const translate = deps.translate === undefined ? defaultTranslate(env) : deps.translate;
  if (!translate) throw new AskClaudeError('AI is not configured', 503);
  let translation: string;
  try {
    translation = await translate(text);
  } catch (err) {
    console.error('[ask] translation failed for', id, err instanceof Error ? err.message : err);
    const retryable = !(err instanceof StructuredCallError) || err.retryable;
    throw new AskClaudeError("Couldn't translate that just now — try again", retryable ? 503 : 502);
  }
  const col = part === 'answer' ? 'answer_translation' : 'question_translation';
  await env.DB.prepare(`UPDATE note_questions SET ${col} = ? WHERE id = ?`).bind(translation, id).run();
  return { translation, cached: false };
}

// ---------- The learner's own Chinese, checked like a chat message ----------

/** The account's settings Ask Claude reads: the answer language and the chat's auto-check switch. */
export async function askSettings(db: D1Database, userId: string): Promise<{ language: AskLanguage | null; autoCheck: boolean | null }> {
  const row = await db
    .prepare('SELECT ask_claude_language, chat_auto_check FROM users WHERE id = ?')
    .bind(userId)
    .first<{ ask_claude_language: string | null; chat_auto_check: number | null }>();
  const ac = row?.chat_auto_check;
  return { language: parseAskLanguage(row?.ask_claude_language), autoCheck: ac === null || ac === undefined ? null : ac !== 0 };
}

/** `users.ask_claude_language`: 'zh' | 'en', or null = back to the default (Chinese). */
export async function setAskLanguage(db: D1Database, userId: string, language: AskLanguage | null): Promise<void> {
  await db.prepare('UPDATE users SET ask_claude_language = ? WHERE id = ?').bind(language, userId).run();
}

/**
 * The chat's auto-check of one question, or null when it isn't checked (the switch is off,
 * English / too short / too long — `autoCheckSkipReason`) or the check failed. The learner is
 * always the learner here (like a Claude practice chat). `context` = the conversation so far.
 * Never throws.
 */
export async function checkAskQuestion(
  env: Pick<Env, 'ANTHROPIC_API_KEY'>,
  setting: boolean | null,
  question: string,
  context: string,
  deps: { check?: AutoChecker | null; now?: () => string } = {},
): Promise<AutoCheckResult | null> {
  try {
    if (!autoCheckApplies(setting, 'student', true)) return null;
    if (autoCheckSkipReason(question)) return null;
    const check = deps.check === undefined ? defaultAutoChecker(env) : deps.check;
    if (!check) return null;
    return normalizeAutoCheck(await check(question, context), question, deps.now?.() ?? new Date().toISOString());
  } catch (err) {
    console.error('[ask] auto-check failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Store a check on the row (only while the question is still the text checked). */
export async function storeQuestionCheck(db: D1Database, id: string, result: AutoCheckResult): Promise<void> {
  await db.prepare('UPDATE note_questions SET question_check = ? WHERE id = ? AND question = ?').bind(JSON.stringify(result), id, result.text).run();
}

/** The conversation so far as the check's context lines (who said what, short). */
export function askCheckContext(note: { hanzi: string; english: string }, history: Array<{ question: string; answer: string }> = []): string {
  const lines = [`(Asking a tutor about the flashcard ${note.hanzi} — ${note.english})`];
  for (const h of history.slice(-3)) {
    lines.push(`Learner: ${(h.question || '').slice(0, 300)}`);
    lines.push(`Other: ${(h.answer || '').slice(0, 300)}`);
  }
  return lines.join('\n');
}

/** Wait for `p` at most `ms`; `{ done: false }` when it is still running. */
export async function within<T>(p: Promise<T>, ms: number): Promise<{ done: true; value: T } | { done: false }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ done: false }>((resolve) => {
    timer = setTimeout(() => resolve({ done: false }), ms);
  });
  try {
    return await Promise.race([p.then((value) => ({ done: true as const, value })), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
