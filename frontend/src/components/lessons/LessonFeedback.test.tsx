/**
 * The answer screen's feedback (shared/lesson/feedback.ts): the model answer + his marked answer at once,
 * "Claude is checking…" BELOW the buttons, the verdict landing in that slot without moving anything above,
 * a right answer felt (once), 🎤 Say it again (practice only — never the scored answer), and the coordinator's
 * sentence_making case: Claude's corrected sentence gets its own 🎤 practice row.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { AnswerCheck } from '@shared/lesson/answerCheck';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let resolveCheck: ((v: { check: AnswerCheck; cached: boolean }) => void) | null = null;
vi.mock('../../services/answerCheck', () => ({
  checkLessonAnswer: () => new Promise((r) => { resolveCheck = r; }),
  askAboutLessonAnswer: vi.fn(),
  AnswerCheckUnavailable: class extends Error {},
}));
let resolveSentence: ((v: unknown) => void) | null = null;
vi.mock('../../api/lessonPractice', () => ({
  checkMadeSentence: () => new Promise((r) => { resolveSentence = r; }),
}));
const track = vi.fn();
vi.mock('../../services/analytics', () => ({ track: (...a: unknown[]) => track(...a) }));
const feel = vi.fn();
vi.mock('../../services/studyFeel', () => ({ studyFeel: (f: unknown) => feel(f) }));
vi.mock('../voice/VoiceTextInput', () => ({
  VoiceTextInput: ({ onSubmit, value }: { onSubmit: (a: { text: string; source: string }) => void; value: string }) => (
    <button data-testid="submit" onClick={() => onSubmit({ text: (globalThis as { __answer?: string }).__answer ?? value, source: 'spoken' })}>submit</button>
  ),
}));
// The practice take itself (live transcription) is the coach's PractiseSentence, tested there.
vi.mock('../coach/PractiseSentence', () => ({
  PractiseSentence: ({ hanzi, label, onPractised }: { hanzi: string; label: string; onPractised?: (p: unknown) => void }) => (
    <button data-testid="practise" data-hanzi={hanzi} onClick={() => onPractised?.({ result: { accepted: true } })}>{label}</button>
  ),
}));

const CHECK: AnswerCheck = {
  verdict: 'almost', headline: 'Use 换 for changing jobs.', corrected: '你怎么突然回伦敦去了？', corrected_pinyin: 'nǐ …', tips: [], suggested: 'missed_it',
};

describe('lesson answer feedback', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    feel.mockReset();
    track.mockReset();
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    delete (globalThis as { __answer?: string }).__answer;
  });

  const q = (id: string) => host.querySelector(`[data-testid="${id}"]`);

  it('translate: model answer + marked answer at once, Claude below the buttons, nothing above moves when it lands', async () => {
    const { TranslateExercise } = await import('../lesson-exercises');
    (globalThis as { __answer?: string }).__answer = '你哥哥怎么突然回伦敦？';
    const onNext = vi.fn();
    await act(async () => root.render(
      <TranslateExercise english="How come your brother suddenly went back to London?" referenceHanzi="你哥哥怎么突然回伦敦了？" referencePinyin="nǐ gēge …" speak={() => {}} onNext={onNext} />,
    ));
    await act(async () => (q('submit') as HTMLButtonElement).click());

    const yours = q('lesson-your-answer')!;
    const ref = host.querySelector('.translate-ref')!;
    expect(yours.textContent).toContain('你哥哥怎么突然回伦敦');
    expect(q('lesson-marked-answer')).not.toBeNull();
    expect(ref.textContent).toContain('你哥哥怎么突然回伦敦了');
    expect(q('answer-check-checking')?.textContent).toContain('Claude is checking');
    // The slot comes after the buttons.
    const slot = q('lesson-claude-slot')!;
    const gotIt = q('lesson-got-it')!;
    expect(gotIt.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const before = Array.from(host.querySelector('.exercise')!.children).indexOf(slot);

    await act(async () => resolveCheck!({ check: CHECK, cached: false }));
    expect(q('answer-check')).not.toBeNull();
    // Same nodes, same order above the slot.
    expect(q('lesson-your-answer')).toBe(yours);
    expect(host.querySelector('.translate-ref')).toBe(ref);
    expect(Array.from(host.querySelector('.exercise')!.children).indexOf(q('lesson-claude-slot')!)).toBe(before);
    // Claude's corrected sentence (differs from the model answer) gets its own practice row.
    expect(q('lesson-say-fix')).not.toBeNull();
    // Not right: no celebration.
    expect(feel).not.toHaveBeenCalledWith('success');
  });

  it('translate: an exact match is felt at once (once), and Say it again is practice only', async () => {
    const { TranslateExercise } = await import('../lesson-exercises');
    (globalThis as { __answer?: string }).__answer = '你哥哥怎么突然回伦敦了';
    const onNext = vi.fn();
    await act(async () => root.render(
      <TranslateExercise english="x" referenceHanzi="你哥哥怎么突然回伦敦了？" speak={() => {}} onNext={onNext} />,
    ));
    await act(async () => (q('submit') as HTMLButtonElement).click());
    expect(feel).toHaveBeenCalledWith('success');
    expect(host.querySelector('.confetti-burst')).not.toBeNull();
    // Exact match is checked locally: no second celebration from Claude.
    expect(feel.mock.calls.filter((c) => c[0] === 'success')).toHaveLength(1);
    const practise = host.querySelector('[data-testid="lesson-say-again"] [data-testid="practise"]') as HTMLButtonElement;
    expect(practise.dataset.hanzi).toBe('你哥哥怎么突然回伦敦了？');
    await act(async () => practise.click());
    expect(feel).toHaveBeenCalledWith('round_right');
    expect(onNext).not.toHaveBeenCalled();
  });

  it('sentence making: result at once with the example; Claude’s fix lands below with its own 🎤; Continue stays the way on', async () => {
    const { SentenceMakingExercise } = await import('../practice-exercises');
    (globalThis as { __answer?: string }).__answer = '你怎么变工作了？';
    const onNext = vi.fn();
    await act(async () => root.render(
      <SentenceMakingExercise words={[{ hanzi: '怎么' }, { hanzi: '了' }]} task="Ask why, surprised." example={{ hanzi: '你怎么搬家了？' }} speak={() => {}} onNext={onNext} />,
    ));
    await act(async () => (q('submit') as HTMLButtonElement).click());
    expect(q('lesson-your-answer')?.textContent).toContain('你怎么变工作了');
    expect(q('answer-check-checking')?.textContent).toContain('Claude is checking');
    expect(q('lesson-got-it')).not.toBeNull();
    await act(async () => resolveSentence!({ verdict: 'minor', uses_all_words: true, comment: '换 not 变.', corrected: { hanzi: '你怎么换工作了？' } }));
    expect(q('sentence-feedback')?.textContent).toContain('你怎么换工作了');
    const fix = host.querySelector('[data-testid="lesson-say-fix"] [data-testid="practise"]') as HTMLButtonElement;
    expect(fix.dataset.hanzi).toBe('你怎么换工作了？');
    await act(async () => fix.click());
    expect(onNext).not.toHaveBeenCalled();
    await act(async () => (q('lesson-continue') as HTMLButtonElement).click());
    expect(onNext).toHaveBeenCalledWith(true, expect.objectContaining({ text: '你怎么变工作了？' }));
  });
});
