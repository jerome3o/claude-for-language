/**
 * The answer screen's feedback (shared/lesson/feedback.ts): the model answer + his marked answer at once,
 * "Claude is checking…" BELOW the buttons, the verdict landing in that slot without moving anything above,
 * a right answer felt (once), 🎤 Say it again (practice only — never the scored answer), and the coordinator's
 * sentence_making case: an honest grade (needs work in orange), 🎤 Try again in place, ✨ the fix on tap with its own 🎤.
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
let resolveFix: ((v: unknown) => void) | null = null;
vi.mock('../../api/lessonPractice', () => ({
  checkMadeSentence: () => new Promise((r) => { resolveSentence = r; }),
  fixMadeSentence: () => new Promise((r) => { resolveFix = r; }),
  FeedbackUnavailable: class extends Error { offline = false; },
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

  it('sentence making: an honest grade — needs work is orange, not scored right; Try again re-checks in place; the fix comes on tap', async () => {
    const { SentenceMakingExercise } = await import('../practice-exercises');
    (globalThis as { __answer?: string }).__answer = '我本来要去健身馆，但是我学中文。';
    const onNext = vi.fn();
    await act(async () => root.render(
      <SentenceMakingExercise words={[{ hanzi: '本来' }, { hanzi: '要' }]} example={{ hanzi: '我本来要买那件衣服，后来觉得太贵了。' }} speak={() => {}} onNext={onNext} />,
    ));
    await act(async () => (q('submit') as HTMLButtonElement).click());
    // A spoken sentence is shown without the recogniser's punctuation (a pause is never grammar).
    expect(q('lesson-your-answer')?.textContent).toContain('我本来要去健身馆但是我学中文');
    expect(q('answer-check-checking')?.textContent).toContain('Claude is checking');
    expect(q('lesson-got-it')).not.toBeNull();
    // The unrelated example is folded while Claude grades.
    expect(q('lesson-feedback-sentence')).toBeNull();
    expect(q('sentence-example-toggle')).not.toBeNull();
    // A v1-shaped "correct" whose own words name a problem is needs work (the guard on the device too).
    await act(async () => resolveSentence!({ feedback: { verdict: 'correct', uses_all_words: true, comment: 'Good use of 本来…要; but the second clause just states another plan rather than an actual interrupting event.' }, cached: false }));
    expect(q('sentence-feedback')?.getAttribute('data-grade')).toBe('needs_work');
    expect(q('sentence-feedback-headline')?.textContent).toBe('本来 and 要 used right — one thing to fix');
    expect(host.textContent).not.toContain('Is your sentence grammatical');
    expect(feel).not.toHaveBeenCalledWith('success');
    // ✨ Show a fixed version: only on tap; his sentence lined up with the fix, then 🎤 Say it.
    expect(q('sentence-fix')).toBeNull();
    await act(async () => (q('sentence-show-fix') as HTMLButtonElement).click());
    await act(async () => resolveFix!({ fix: { hanzi: '我本来要去健身房，可是后来去学中文了。', pinyin: 'wǒ běnlái …' }, cached: false }));
    expect(q('sentence-fix-expected')?.textContent).toContain('我本来要去健身房，可是后来去学中文了。');
    const say = host.querySelector('[data-testid="lesson-say-fix"] [data-testid="practise"]') as HTMLButtonElement;
    expect(say.dataset.hanzi).toBe('我本来要去健身房，可是后来去学中文了。');
    expect(say.textContent).toBe('Say it');
    // 🎤 Try again: a new sentence, checked in place; right → felt; the first grade still counts.
    await act(async () => (q('sentence-try-again') as HTMLButtonElement).click());
    (globalThis as { __answer?: string }).__answer = '我本来要去健身房，可是后来下雨了。';
    await act(async () => (host.querySelector('[data-testid="sentence-try"] [data-testid="submit"]') as HTMLButtonElement).click());
    expect(q('sentence-retry-checking')).not.toBeNull();
    await act(async () => resolveSentence!({ feedback: { verdict: 'correct', grade: 'right', headline: 'Natural and correct', uses_all_words: true, fixable: false, comment: '' }, cached: false }));
    expect(q('sentence-retry-feedback')?.getAttribute('data-grade')).toBe('right');
    expect(feel).toHaveBeenCalledWith('round_right');
    expect(q('sentence-try-again')).toBeNull();
    expect(track).toHaveBeenCalledWith('lesson.sentence_retry', { result: 'right', try: 1, input: 'spoken' });
    await act(async () => (q('lesson-continue') as HTMLButtonElement).click());
    expect(onNext).toHaveBeenCalledWith(false, expect.objectContaining({ text: '我本来要去健身馆但是我学中文' }));
  });
});
