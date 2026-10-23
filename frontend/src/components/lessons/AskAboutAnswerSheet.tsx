/**
 * 💬 Ask about this (docs/STUDY_SESSION.md "Claude checks your answer"): a short follow-up chat
 * about ONE checked lesson answer, inside the lesson (nothing is left behind, the exercise stays
 * where it was). Each question goes to `POST /api/lessons/answer-check/ask` with the exercise,
 * the answer, the check and the conversation so far. Online only; a failure shows inline.
 * Lab: `AskAboutAnswerSheet` in ui/lessons/AnswerCheckViews.kt.
 */
import { useState } from 'react';
import { askQuickQuestions, type AnswerCheck, type AnswerCheckInput } from '@shared/lesson/answerCheck';
import { askAboutLessonAnswer, type AskTurn } from '../../services/answerCheck';
import { ExplorableText } from '../explorer/ExplorableText';
import { VoiceTextInput } from '../voice/VoiceTextInput';
import { track } from '../../services/analytics';

export function AskAboutAnswerSheet({ input, check, onClose }: {
  input: AnswerCheckInput;
  check: AnswerCheck | null;
  onClose: () => void;
}) {
  const [turns, setTurns] = useState<AskTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    const history = turns;
    setTurns([...history, { role: 'user', text: q }]);
    setDraft('');
    setBusy(true);
    setError(null);
    track('lesson.answer_ask', { verdict: check?.verdict ?? 'none', exercise_type: input.exercise_type, turn: history.length / 2 + 1 });
    try {
      const reply = await askAboutLessonAnswer(input, check, history, q);
      setTurns((t) => [...t, { role: 'assistant', text: reply }]);
    } catch {
      setError(navigator.onLine === false ? 'Asking needs a connection.' : 'Claude couldn’t answer just now — try again.');
      setTurns(history);
      setDraft(q);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="answer-ask-backdrop" onClick={onClose} role="presentation" />
      <div className="answer-ask-sheet" role="dialog" aria-label="Ask about this answer" data-testid="answer-ask-sheet">
        <div className="answer-ask-grip" aria-hidden="true" />
        <div className="answer-ask-head">
          <span>💬 Ask about your answer</span>
          <button type="button" className="answer-ask-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="answer-ask-body">
          <div className="answer-ask-context">
            <div>{input.prompt_en}</div>
            <div>You: <strong lang="zh-CN">{check?.cleaned || input.answer}</strong></div>
            {check?.corrected && <div>Fix: <strong lang="zh-CN">{check.corrected}</strong></div>}
          </div>
          {turns.map((t, i) => (
            <div key={i} className={`answer-ask-msg ${t.role}`}>
              {t.role === 'assistant' ? <ExplorableText text={t.text} source="lesson" /> : t.text}
            </div>
          ))}
          {busy && <div className="answer-ask-msg assistant thinking" role="status">Thinking…</div>}
          {error && <div className="answer-ask-error" role="alert">{error}</div>}
          {turns.length === 0 && !busy && (
            <div className="answer-ask-chips">
              {askQuickQuestions(check?.verdict, input.exercise_type).map((q) => (
                <button key={q} type="button" className="answer-ask-chip" onClick={() => send(q)}>{q}</button>
              ))}
            </div>
          )}
        </div>
        <VoiceTextInput
          surface="lesson_answer_ask"
          value={draft}
          onChange={setDraft}
          onSubmit={(a) => send(a.text)}
          submitLabel="Ask"
          placeholder="Ask about your answer…"
          listeningPlaceholder="Listening… ask your question"
          lang="en"
          disabled={busy}
          testId="answer-ask-input"
        />
      </div>
    </>
  );
}
