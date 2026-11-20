/**
 * Where an answer's feedback can ask Claude about it (docs/STUDY_SESSION.md "Answer feedback: one line and a diff" →
 * "💬 Ask Claude"): the study card (and the homework pass on it) provides `ask` while online — it opens the card's own
 * Claude thread (the Ask Claude sheet) with the question already sent. Every `AnswerDiff` inside reads it: the small
 * "💬 Ask Claude" link when the check gave no reason (`answerAskOffered`), and "Explain more ›" when it has nothing
 * to open in place. No provider (offline, a surface with no thread) → neither is offered.
 */
import { createContext, useContext } from 'react';

export interface AnswerAskValue {
  /** Open the card's Claude thread and ask this. */
  ask: (question: string) => void;
}

export const AnswerAskContext = createContext<AnswerAskValue | null>(null);

export function useAnswerAsk(): AnswerAskValue | null {
  return useContext(AnswerAskContext);
}
