/**
 * Claude's check under "🎤 You said" (AnswerCheckCard + TranslateExercise): the slim "Checking…"
 * row that never blocks the buttons, ✓ Correct with no correction, ~ Almost with the red-pen diff
 * and the tips' quoted Chinese, the suggested button ringed, 🔁 Try again keeping the first try in
 * the attempt, and offline = no card (the old self-assessment).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { AnswerCheck } from '@shared/lesson/answerCheck';
import { AnswerCheckCard } from './AnswerCheckCard';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const checkLessonAnswer = vi.fn();
vi.mock('../../services/answerCheck', () => ({
  checkLessonAnswer: (...args: unknown[]) => checkLessonAnswer(...args),
  askAboutLessonAnswer: vi.fn(async () => 'Because 别 makes it a command.'),
  AnswerCheckUnavailable: class extends Error {
    constructor(m: string, readonly offline = false) { super(m); }
  },
}));
vi.mock('../../services/analytics', () => ({ track: vi.fn() }));
// The voice-first box is tested on its own (VoiceTextInput.test.tsx): here a plain box + Check.
const typed = { text: '' };
vi.mock('../voice/VoiceTextInput', () => ({
  VoiceTextInput: (p: { submitLabel?: string; onSubmit: (a: { text: string; source: 'typed'; transcript: null }) => void }) => (
    <button type="button" data-testid="fake-submit" onClick={() => p.onSubmit({ text: typed.text, source: 'typed', transcript: null })}>{p.submitLabel}</button>
  ),
}));

const ALMOST: AnswerCheck = {
  verdict: 'almost',
  headline: '和 can’t join two actions — use a comma.',
  corrected: '医生让我吃药，好好休息。',
  corrected_pinyin: 'yīshēng ràng wǒ chī yào, hǎohǎo xiūxi.',
  tips: [{ text: '和 links nouns, not two verb phrases — use a comma or 然后.', quote: '和' }],
  suggested: 'missed_it',
};
const CORRECT: AnswerCheck = {
  verdict: 'correct',
  headline: 'Correct and natural — 很 is optional here.',
  corrected: '',
  corrected_pinyin: '',
  tips: [],
  alternative: { hanzi: '即使再便宜，我也不买。', pinyin: 'jíshǐ zài piányi, wǒ yě bù mǎi.', english: 'However cheap it is…' },
  suggested: 'got_it',
};

describe('AnswerCheckCard', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    checkLessonAnswer.mockReset();
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('checking: one slim status row', () => {
    act(() => root.render(<AnswerCheckCard state={{ status: 'checking' }} answer="x" speak={() => {}} />));
    expect(host.querySelector('[data-testid="answer-check-checking"]')?.textContent).toContain('Checking');
  });

  it('almost: chip, the red-pen diff of their sentence, the quote marked', () => {
    act(() => root.render(<AnswerCheckCard state={{ status: 'done', check: ALMOST, cached: false }} answer="医生让我吃药和好好休息。" speak={() => {}} onRetry={() => {}} onAsk={() => {}} />));
    expect(host.querySelector('.answer-check-chip')?.textContent).toBe('~ Almost');
    expect(host.querySelector('.chat-diff-del')?.textContent).toBe('和');
    expect(host.querySelector('.answer-check-pinyin')?.textContent).toContain('xiūxi');
    expect(host.querySelector('mark.answer-check-quote')?.textContent).toBe('和');
    expect(host.querySelector('[data-testid="answer-check-retry"]')).toBeTruthy();
  });

  it('correct: no correction, the alternative shown', () => {
    act(() => root.render(<AnswerCheckCard state={{ status: 'done', check: CORRECT, cached: true }} answer="即使便宜，我也不买。" speak={() => {}} />));
    expect(host.querySelector('.answer-check-chip')?.textContent).toBe('✓ Correct');
    expect(host.querySelector('.answer-check-fix')).toBeNull();
    expect(host.querySelector('.answer-check-alt')?.textContent).toContain('即使再便宜');
  });

  it('unavailable (offline): nothing', () => {
    act(() => root.render(<AnswerCheckCard state={{ status: 'unavailable', offline: true }} answer="x" speak={() => {}} />));
    expect(host.innerHTML).toBe('');
  });
});

describe('TranslateExercise with the check', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    checkLessonAnswer.mockReset();
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  async function answer(text: string) {
    typed.text = text;
    await act(async () => (host.querySelector('[data-testid="fake-submit"]') as HTMLButtonElement).click());
  }

  it('starts the check on submit, rings the suggestion, Try again keeps the first try', async () => {
    const { TranslateExercise } = await import('../lesson-exercises');
    let resolve!: (v: unknown) => void;
    checkLessonAnswer.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    const onNext = vi.fn();
    await act(async () => root.render(
      <TranslateExercise english="The doctor told me to take medicine and rest well." referenceHanzi="医生让我吃药，好好休息。" speak={() => {}} onNext={onNext} focus="Linking actions" />,
    ));
    await answer('医生让我吃药和好好休息。');
    expect(checkLessonAnswer).toHaveBeenCalledWith(expect.objectContaining({ answer: '医生让我吃药和好好休息。', exercise_type: 'translate', input: 'typed', focus: 'Linking actions' }));
    expect(host.querySelector('[data-testid="answer-check-checking"]')).toBeTruthy();
    // The buttons never wait for the check.
    expect((host.querySelector('[data-testid="lesson-got-it"]') as HTMLButtonElement).disabled).toBe(false);
    await act(async () => resolve({ check: ALMOST, cached: false }));
    expect(host.querySelector('[data-testid="lesson-missed-it"]')!.className).toContain('suggested');
    expect(host.querySelector('[data-testid="lesson-got-it"]')!.className).not.toContain('suggested');

    // 🔁 Try again → the input again; the second answer is checked too.
    checkLessonAnswer.mockResolvedValueOnce({ check: { ...CORRECT, alternative: undefined }, cached: false });
    await act(async () => (host.querySelector('[data-testid="answer-check-retry"]') as HTMLButtonElement).click());
    expect(host.querySelector('[data-testid="answer-check"]')).toBeNull();
    await answer('医生让我吃药，好好休息。');
    expect(host.querySelector('[data-testid="lesson-got-it"]')!.className).toContain('suggested');
    await act(async () => (host.querySelector('[data-testid="lesson-got-it"]') as HTMLButtonElement).click());
    const reported = onNext.mock.calls[0][1];
    expect(onNext.mock.calls[0][0]).toBe(true);
    expect(reported.check.verdict).toBe('correct');
    expect(reported.tries).toEqual([{ text: '医生让我吃药和好好休息。', input: 'typed', check: ALMOST }]);
  });

  it('offline: no card, the self-assessment as before', async () => {
    const { TranslateExercise } = await import('../lesson-exercises');
    const { AnswerCheckUnavailable } = await import('../../services/answerCheck');
    checkLessonAnswer.mockRejectedValueOnce(new AnswerCheckUnavailable('offline', true));
    await act(async () => root.render(<TranslateExercise english="Hello" referenceHanzi="你好" speak={() => {}} onNext={() => {}} />));
    await answer('您好');
    expect(host.querySelector('[data-testid="answer-check"]')).toBeNull();
    expect(host.querySelector('[data-testid="answer-check-checking"]')).toBeNull();
    expect(host.textContent).toContain('Did yours match the meaning?');
  });
});
