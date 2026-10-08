import { useCallback, useEffect, useRef, useState } from 'react';
import type { AskLanguage } from '@shared/study/askClaude';
import {
  askAboutNote,
  getNoteQuestion,
  getNoteQuestionWords,
  translateNoteQuestion,
  type AskToolResult,
  type NoteQuestionWithTools,
} from '../../api/client';
import { looksLikeChinese } from '../chat/messageTools';
import { track, trackError } from '../../services/analytics';

export type AskPart = 'answer' | 'question';

/** When to read the row again for a question check still running (ms after the answer). */
const CHECK_POLLS_MS = [3000, 8000];

export interface AskClaudeOptions {
  noteId: string;
  cardType: string;
  /** The typed answer on a typing card ("Check my answer" + Claude's context). */
  typed: { userAnswer: string; correctAnswer: string } | null;
  aiAvailable: boolean;
  language: AskLanguage;
}

/**
 * The Ask Claude conversation on one card (docs/STUDY_SESSION.md "Ask Claude"): asking (with
 * the history, the language on screen), Claude's changes waiting for Approve / Reject, and
 * the immersion extras every message gets afterwards — its word chips (`/note-questions/:id/
 * words`, the answer and my own Chinese), the question's auto-check when it was still running,
 * and Translate on demand. Lives in the study card, so closing the sheet keeps the conversation.
 */
export function useAskClaude(opts: AskClaudeOptions) {
  const [conversation, setConversation] = useState<NoteQuestionWithTools[]>([]);
  const [question, setQuestion] = useState('');
  const [isAsking, setIsAsking] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingToolResults, setPendingToolResults] = useState<AskToolResult[] | null>(null);
  /** `${id}:${part}` → the translation failed (Translate turns itself off). */
  const [translateErrors, setTranslateErrors] = useState<Set<string>>(new Set());
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const patch = useCallback((id: string, fields: Partial<NoteQuestionWithTools>) => {
    if (!live.current) return;
    setConversation((prev) => prev.map((q) => (q.id === id ? { ...q, ...fields } : q)));
  }, []);

  const describeError = (err: unknown): string => {
    if (!opts.aiAvailable) return "Ask Claude needs an internet connection — you're offline right now.";
    const msg = err instanceof Error ? err.message : '';
    if (/network|fetch|failed to fetch/i.test(msg)) return "Couldn't reach Claude — check your connection and try again.";
    return msg ? `Claude couldn't answer: ${msg}` : "Claude couldn't answer that. Try again in a moment.";
  };

  /** Word chips for the answer (a Chinese answer) and my question (when it has Chinese). Failures leave the characters tappable. */
  const fetchWords = useCallback(
    (entry: NoteQuestionWithTools) => {
      const parts: AskPart[] = [];
      if (entry.answer_lang === 'zh' && !entry.answer_words && looksLikeChinese(entry.answer)) parts.push('answer');
      if (!entry.question_words && looksLikeChinese(entry.question)) parts.push('question');
      for (const part of parts) {
        getNoteQuestionWords(entry.id, part)
          .then((r) => {
            if (r.words) patch(entry.id, part === 'answer' ? { answer_words: r.words } : { question_words: r.words });
          })
          .catch((err) => console.warn('[ask] word chips failed:', err));
      }
    },
    [patch],
  );

  /** A question whose check was still running: read the row again a couple of times. */
  const pollCheck = useCallback(
    (id: string) => {
      for (const ms of CHECK_POLLS_MS) {
        window.setTimeout(() => {
          if (!live.current) return;
          getNoteQuestion(id)
            .then((row) => {
              if (row.question_check) patch(id, { question_check: row.question_check, question_check_pending: false });
            })
            .catch(() => undefined);
        }, ms);
      }
    },
    [patch],
  );

  const ask = useCallback(
    async (text: string, how: { quick?: boolean } = {}) => {
      const q = text.trim();
      if (!q || isAsking) return;
      setIsAsking(true);
      setPendingQuestion(q);
      setError(null);
      try {
        const context = opts.typed ? { ...opts.typed, cardType: opts.cardType } : undefined;
        // Quick chips start a conversation; typed questions carry the history.
        const history = how.quick ? undefined : conversation.map((qa) => ({ question: qa.question, answer: qa.answer }));
        const response = await askAboutNote(opts.noteId, q, context, history, { language: opts.language, quick: how.quick });
        track('study.ask_claude', { card_type: opts.cardType, language: response.answer_lang ?? opts.language, quick: !!how.quick });
        if (!live.current) return;
        setConversation((prev) => [...prev, response]);
        if (!how.quick) setQuestion('');
        if (response.toolResults && response.toolResults.length > 0) setPendingToolResults(response.toolResults);
        fetchWords(response);
        if (response.question_check_pending) pollCheck(response.id);
      } catch (err) {
        console.error('Failed to ask Claude:', err);
        if (live.current) setError(describeError(err));
        trackError('study_ask_claude', err);
      } finally {
        if (live.current) {
          setIsAsking(false);
          setPendingQuestion(null);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isAsking, conversation, opts.noteId, opts.cardType, opts.typed, opts.language, opts.aiAvailable, fetchWords, pollCheck],
  );

  /** The English of an answer / my question: stored after the first time (Translate works offline then). */
  const ensureTranslation = useCallback(
    async (entry: NoteQuestionWithTools, part: AskPart): Promise<boolean> => {
      const have = part === 'answer' ? entry.answer_translation : entry.question_translation;
      if (have) return true;
      const key = `${entry.id}:${part}`;
      setTranslateErrors((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      try {
        const r = await translateNoteQuestion(entry.id, part);
        patch(entry.id, part === 'answer' ? { answer_translation: r.translation } : { question_translation: r.translation });
        return true;
      } catch (err) {
        console.warn('[ask] translate failed:', err);
        if (live.current) setTranslateErrors((prev) => new Set(prev).add(key));
        return false;
      }
    },
    [patch],
  );

  return {
    conversation,
    question,
    setQuestion,
    isAsking,
    pendingQuestion,
    error,
    pendingToolResults,
    setPendingToolResults,
    translateErrors,
    ask,
    ensureTranslation,
  };
}

export type AskClaudeConversation = ReturnType<typeof useAskClaude>;
