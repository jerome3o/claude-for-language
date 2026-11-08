/**
 * Sentence answers checked by Claude (docs/STUDY_SESSION.md; shared/study/sentenceAnswerCheck.ts): Hard
 * mode's question with a sentence the device didn't accept — the CARD'S answer (hanzi, pinyin, English) and
 * "You said" against it at once, a slim "Checking your sentence…" row under them, then Claude's verdict ON
 * THE QUESTION (never its fix of his wording in place of the card's answer): acceptable → right (held with You said vs the card, no give-up, Got it
 * suggested); almost → ≈ Nearly with the fix + tips, 🔁 Try again keeps the question and the new answer
 * replaces the old one (checked afresh; the same answer again is not a second call); offline → the
 * device's verdict. The harness wires `useSentenceQuestionCheck` + `HardModeFeedback` the way StudyCard does.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { AnswerCheck, AnswerCheckInput } from '@shared/lesson/answerCheck';
import { checkSpokenAnswer } from '@shared/cards/answer';
import { hardModeQuestionResult } from '@shared/study/hardMode';
import { passSuggestion } from '@shared/homework/pass-card';
import { SENTENCE_CHECKING } from '@shared/study/sentenceAnswerCheck';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const track = vi.fn();
vi.mock('../../services/analytics', () => ({ track: (...a: unknown[]) => track(...a), trackError: vi.fn() }));
vi.mock('../explorer/ExplorableText', () => ({ ExplorableText: ({ text }: { text: string }) => <span>{text}</span> }));

const MODEL = '我早上喝咖啡是为了上班不困。';
const SAID = '我早上喝咖啡，因为工作不困。';
const ENGLISH = "I drink coffee in the morning so I'm not sleepy at work.";

const ALMOST: AnswerCheck = {
  verdict: 'almost',
  headline: 'Clear meaning — but 因为 gives a reason, not a purpose.',
  corrected: '我早上喝咖啡是为了上班不困。',
  corrected_pinyin: 'Wǒ zǎoshang hē kāfēi shì wèile shàngbān bú kùn.',
  tips: [{ text: 'Use 是为了 for "so that / in order to".', quote: '因为' }],
  alternative: { hanzi: '我早上喝咖啡，这样上班就不困了。', pinyin: 'Wǒ zǎoshang hē kāfēi, zhèyàng shàngbān jiù bú kùn le.' },
  suggested: 'missed_it',
};
const ACCEPTABLE: AnswerCheck = {
  verdict: 'acceptable', headline: 'Natural and right — 为了 works just as well.', corrected: '', corrected_pinyin: '', tips: [], suggested: 'got_it',
};

let host: HTMLDivElement;
let root: Root;
const q = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  track.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function mount(checker: (input: AnswerCheckInput) => Promise<{ check: AnswerCheck; cached: boolean }>, opts: { online?: boolean; next?: string; said?: string } = {}) {
  const { useSentenceQuestionCheck } = await import('./useSentenceAnswerCheck');
  const { HardModeFeedback } = await import('./HardModeFeedback');
  function Harness() {
    const [answer, setAnswer] = useState(opts.said ?? SAID);
    const [open, setOpen] = useState(true);
    const [gaveUp, setGaveUp] = useState(false);
    const local = answer ? checkSpokenAnswer(answer, MODEL) : null;
    const sc = useSentenceQuestionCheck({
      showingKey: 'c1', cardType: 'meaning_to_hanzi', hanzi: MODEL, pinyin: 'Wǒ zǎoshang hē kāfēi shì wèile shàngbān bú kùn.', english: ENGLISH,
      answer, spoken: true, localVerdict: local, multipleChoice: false, active: open && !gaveUp, online: opts.online ?? true, where: 'homework', checker,
    });
    const result = sc.checking ? 'checking' as const : sc.verdict ? hardModeQuestionResult({ answerVerdict: sc.verdict })! : null;
    if (!open) {
      return <button type="button" data-testid="say" onClick={() => { setAnswer(opts.next ?? SAID); setOpen(true); }}>🎤</button>;
    }
    return (
      <div data-testid="question" data-pass={sc.verdict ? passSuggestion({ answerVerdict: sc.verdict }) : ''} data-gave-up={gaveUp ? 'true' : 'false'}>
        {result && (
          <HardModeFeedback
            result={gaveUp ? 'revealed' : result}
            said={answer}
            spoken
            roundFollows
            difference={result === 'right' && sc.difference ? { reason: sc.difference, said: answer, model: MODEL, modelPinyin: null } : null}
            check={sc.check}
            checkingLabel={sc.checking ? SENTENCE_CHECKING : undefined}
            onTypeInstead={sc.check && result !== 'right' ? () => {} : undefined}
            onTryAgain={() => { setAnswer(''); setOpen(false); }}
            onShowAnswer={() => setGaveUp(true)}
            onNext={() => {}}
            sentenceView={sc.view}
            answer={{ hanzi: MODEL, pinyin: 'Wǒ zǎoshang hē kāfēi shì wèile shàngbān bú kùn.', english: ENGLISH }}
            onMoveOn={() => setGaveUp(true)}
            moveOnLabel="Continue to the sentences"
          />
        )}
      </div>
    );
  }
  await act(async () => { root.render(<Harness />); });
}

describe('Hard mode: a sentence answer checked by Claude', () => {
  it('acceptable → right on the question: held with You said vs the card, no give-up, Got it suggested', async () => {
    let resolve!: (v: { check: AnswerCheck; cached: boolean }) => void;
    const checker = vi.fn((_input: AnswerCheckInput) => new Promise<{ check: AnswerCheck; cached: boolean }>((r) => { resolve = r; }));
    await mount(checker);
    expect(q('hard-feedback')!.dataset.result).toBe('checking');
    // No waiting: the card's answer (hanzi, pinyin, English) and "You said" against it, marked, at once.
    expect(q('hard-feedback')!.dataset.answerFirst).toBe('true');
    expect(q('difference-model')!.textContent).toContain('The answer');
    expect(q('difference-model')!.textContent).toContain(MODEL);
    expect(q('difference-model')!.textContent).toContain('shàngbān');
    expect(q('difference-model-english')!.textContent).toBe(ENGLISH);
    expect(q('difference-said')!.textContent).toContain(SAID);
    expect(q('difference-said')!.querySelector('[data-mark="wrong"]')).not.toBeNull();
    expect(q('hard-sentence-checking')!.textContent).toContain(SENTENCE_CHECKING);
    expect(host.querySelector('.spinner')).toBeNull();
    expect(q('hard-try-again')).toBeNull();
    expect(checker).toHaveBeenCalledTimes(1);
    expect(checker.mock.calls[0][0]).toMatchObject({ exercise_type: 'translate', input: 'spoken', model_answer: MODEL, answer: SAID, prompt_en: ENGLISH });
    await act(async () => { resolve({ check: ACCEPTABLE, cached: false }); });
    expect(q('hard-feedback')!.dataset.result).toBe('right');
    expect(q('hard-feedback')!.dataset.held).toBe('true');
    expect(q('answer-check')!.dataset.verdict).toBe('acceptable');
    expect(host.textContent).toContain('✓ Also right');
    expect(q('hard-sentence-checking')).toBeNull();
    expect(q('difference-model')!.textContent).toContain(MODEL);
    // Accepted: his differences turn yellow, nothing red.
    expect(q('difference-said')!.querySelector('[data-mark="wrong"]')).toBeNull();
    expect(q('hard-next')).not.toBeNull();
    expect(q('hard-try-again')).toBeNull();
    expect(q('question')!.dataset.gaveUp).toBe('false');
    expect(q('question')!.dataset.pass).toBe('right');
    expect(track).toHaveBeenCalledWith('study.sentence_answer_check', expect.objectContaining({ verdict: 'acceptable', retry: 0, input: 'spoken', card_type: 'meaning_to_hanzi', where: 'homework' }));
  });

  it('almost → ≈ Nearly with the fix and tips; Try again keeps the question, the new answer is checked afresh', async () => {
    const replies: AnswerCheck[] = [ALMOST, { ...ACCEPTABLE, verdict: 'correct', headline: 'Spot on.' }];
    const checker = vi.fn(async (_input: AnswerCheckInput) => ({ check: replies.shift()!, cached: false }));
    await mount(checker, { next: '我早上喝咖啡是为了工作不困。' });
    await flush();
    expect(q('hard-feedback')!.dataset.result).toBe('close');
    expect(q('answer-check')!.dataset.verdict).toBe('almost');
    expect(host.textContent).toContain('因为 gives a reason');
    expect(host.textContent).toContain('Also natural');
    // The card's answer stays THE answer: Claude's fix (here the card's own sentence) is not shown again.
    expect(q('difference-model')!.textContent).toContain(MODEL);
    expect(host.querySelector('.answer-check-fix')).toBeNull();
    expect(q('hard-sentence-your-fix')).toBeNull();
    expect(q('hard-type-instead')).not.toBeNull();
    expect(q('hard-show-answer')).not.toBeNull();
    expect(q('question')!.dataset.pass).toBe('wrong');
    // 🔁 Try again: back to the question (not the answer), then a new take.
    act(() => q('hard-try-again')!.click());
    expect(q('hard-feedback')).toBeNull();
    expect(q('say')).not.toBeNull();
    await act(async () => { q('say')!.click(); });
    await flush();
    expect(checker).toHaveBeenCalledTimes(2);
    expect(checker.mock.calls[1][0]).toMatchObject({ answer: '我早上喝咖啡是为了工作不困。' });
    expect(q('hard-feedback')!.dataset.result).toBe('right');
    expect(q('answer-check')!.dataset.verdict).toBe('correct');
    expect(track).toHaveBeenLastCalledWith('study.sentence_answer_check', expect.objectContaining({ verdict: 'correct', retry: 1 }));
  });

  it('the same answer again is not a second call; 👁 Show answer after the check is still giving up', async () => {
    const checker = vi.fn(async () => ({ check: ALMOST, cached: false }));
    await mount(checker);
    await flush();
    act(() => q('hard-try-again')!.click());
    await act(async () => { q('say')!.click(); });
    await flush();
    expect(checker).toHaveBeenCalledTimes(1);
    expect(q('hard-feedback')!.dataset.result).toBe('close');
    act(() => q('hard-show-answer')!.click());
    expect(q('question')!.dataset.gaveUp).toBe('true');
    expect(q('hard-feedback')!.dataset.result).toBe('revealed');
  });

  it('offline: no call, the device verdict (✗ Not quite) as before', async () => {
    const checker = vi.fn(async () => ({ check: ALMOST, cached: false }));
    await mount(checker, { online: false });
    await flush();
    expect(checker).not.toHaveBeenCalled();
    expect(q('hard-feedback')!.dataset.result).toBe('wrong');
    expect(q('answer-check')).toBeNull();
    expect(host.textContent).toContain('✗ Not quite');
    // The answer and the diff all the same.
    expect(q('difference-model')!.textContent).toContain(MODEL);
    expect(q('difference-said')!.textContent).toContain(SAID);
    expect(q('hard-sentence-checking')).toBeNull();
  });

  it('almost with a fix of HIS wording: a small labelled line under the verdict, never in place of the card answer', async () => {
    const fix = '我早上喝咖啡，所以上班不困。';
    const checker = vi.fn(async () => ({ check: { ...ALMOST, corrected: fix }, cached: false }));
    await mount(checker);
    await flush();
    expect(q('difference-model')!.textContent).toContain(MODEL);
    expect(q('hard-sentence-your-fix')!.textContent).toContain('Your wording, fixed:');
    expect(q('hard-sentence-your-fix')!.textContent).toContain(fix);
    expect(host.querySelector('.answer-check-fix')).toBeNull();
  });

  it('a failed check: the device verdict, reported as an error', async () => {
    const { AnswerCheckUnavailable } = await import('../../services/answerCheck');
    const checker = vi.fn(async () => { throw new AnswerCheckUnavailable('HTTP 502'); });
    await mount(checker);
    await flush();
    expect(q('hard-feedback')!.dataset.result).toBe('wrong');
    expect(track).toHaveBeenCalledWith('study.sentence_answer_check', expect.objectContaining({ verdict: 'error' }));
  });
});
