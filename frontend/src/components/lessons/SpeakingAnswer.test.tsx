/**
 * The recorded speaking answer (SpeakingAnswer, docs/STUDY_SESSION.md "Claude checks your speaking"):
 * the transcript under "🎤 You said", Claude's check started at Done with the task + useful words,
 * the task's parts ✓ ~ ✗ and the cleaner version, the suggestion ringed, the check + transcript in
 * the reported answer, "Couldn't transcribe — tap to retry", and offline = the recording kept.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { AnswerCheck } from '@shared/lesson/answerCheck';
import type { SpeakingTranscript } from '../../hooks/useSpeakingTake';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const checkLessonAnswer = vi.fn();
vi.mock('../../services/answerCheck', () => ({
  checkLessonAnswer: (...args: unknown[]) => checkLessonAnswer(...args),
  askAboutLessonAnswer: vi.fn(),
  AnswerCheckUnavailable: class extends Error {},
}));
vi.mock('../../services/analytics', () => ({ track: vi.fn() }));
vi.mock('../../utils/audioPlayback', () => ({ createAudioPlayer: () => ({ play: vi.fn(), stop: vi.fn(), dispose: vi.fn() }) }));
const take = {
  isRecording: false, audioLevel: 0, error: null as string | null, elapsed: 0, durationMs: 42_000,
  take: new Blob(['x'], { type: 'audio/webm' }) as Blob | null, liveText: '',
  transcript: { status: 'done', text: '你就是……sorry，你就是Annie吧？今天的会议是关于下个月的活动。' } as SpeakingTranscript,
  start: vi.fn(), stop: vi.fn(), retry: vi.fn(), reset: vi.fn(),
};
vi.mock('../../hooks/useSpeakingTake', () => ({ useSpeakingTake: () => take }));

const CHECK: AnswerCheck = {
  verdict: 'acceptable',
  headline: 'All there — just close 是关于…的 with 的.',
  cleaned: '你就是Annie吧？今天的会议是关于下个月的活动。',
  cleaned_pinyin: 'nǐ jiù shì Annie ba?',
  corrected: '你就是Annie吧？今天的会议是关于下个月的活动的。',
  corrected_pinyin: 'nǐ jiù shì Annie ba? …',
  parts: [{ label: '① 就是…吧', status: 'used' }, { label: '③ 是关于…的', status: 'used_with_issue', note: 'missing 的' }, { label: '④ 形容词 + 到…', status: 'missing' }],
  tips: [{ text: 'Close it with 的.', quote: '是关于下个月的活动', fix: '是关于下个月的活动的', fix_pinyin: 'shì guānyú xià ge yuè de huódòng de' }],
  suggested: 'got_it',
};
const PROMPT = 'Guess who she is (① 就是…吧), what the meeting is about (③ 是关于…的), how busy (④ 形容词 + 到…).';

describe('SpeakingAnswer', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    checkLessonAnswer.mockReset();
    take.transcript = { status: 'done', text: '你就是……sorry，你就是Annie吧？今天的会议是关于下个月的活动。' };
    take.retry.mockReset();
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  async function render(onNext = vi.fn()) {
    const { SpeakingAnswer } = await import('./SpeakingAnswer');
    await act(async () => root.render(
      <SpeakingAnswer exerciseType="oral_expression" prompt={PROMPT} hints={['就是', '关于']} example={{ hanzi: '你就是Annie吧？' }} mediaKey="m0" focus="At the office" speak={() => {}} onNext={onNext} />,
    ));
    return onNext;
  }

  it('shows the transcript, checks it at Done, renders parts + the cleaner version, reports the check', async () => {
    checkLessonAnswer.mockResolvedValueOnce({ check: CHECK, cached: false });
    const onNext = await render();
    expect(host.querySelector('[data-testid="speaking-transcript"]')?.textContent).toContain('sorry，你就是Annie吧');
    expect(checkLessonAnswer).not.toHaveBeenCalled();
    await act(async () => (host.querySelector('[data-testid="speaking-done"]') as HTMLButtonElement).click());
    expect(checkLessonAnswer).toHaveBeenCalledWith(expect.objectContaining({
      exercise_type: 'oral_expression', input: 'spoken', prompt_en: PROMPT, hints: ['就是', '关于'], model_answer: '你就是Annie吧？', focus: 'At the office',
    }));
    const statuses = Array.from(host.querySelectorAll('.answer-check-part')).map((li) => li.getAttribute('data-status'));
    expect(statuses).toEqual(['used', 'used_with_issue', 'missing']);
    expect(host.querySelector('[data-testid="answer-check-cleaner"]')?.textContent).toContain('A cleaner version');
    expect(host.querySelector('.chat-diff-ins')?.textContent).toBe('的');
    expect(host.querySelector('.answer-check-tip-fix')?.textContent).toContain('huódòng de');
    expect(host.textContent).toContain('One way to say it');
    expect(host.querySelector('[data-testid="lesson-got-it"]')!.className).toContain('suggested');
    await act(async () => (host.querySelector('[data-testid="lesson-got-it"]') as HTMLButtonElement).click());
    const [correct, answer, recording] = onNext.mock.calls[0];
    expect(correct).toBe(true);
    expect(answer.text).toBe(take.transcript.status === 'done' ? take.transcript.text : '');
    expect(answer.input).toBe('spoken');
    expect(answer.check.parts).toHaveLength(3);
    expect(answer.recording.media_key).toBe('m0');
    expect(recording).toBe(take.take);
  });

  it('transcription failed: tap to retry the same take; no check, the buttons still work', async () => {
    take.transcript = { status: 'failed' };
    const onNext = await render();
    const retry = host.querySelector('[data-testid="speaking-transcript-retry"]') as HTMLButtonElement;
    expect(retry.textContent).toContain('Couldn’t transcribe — tap to retry');
    await act(async () => retry.click());
    expect(take.retry).toHaveBeenCalled();
    await act(async () => (host.querySelector('[data-testid="speaking-done"]') as HTMLButtonElement).click());
    expect(checkLessonAnswer).not.toHaveBeenCalled();
    await act(async () => (host.querySelector('[data-testid="lesson-missed-it"]') as HTMLButtonElement).click());
    expect(onNext.mock.calls[0][1].text).toBeUndefined();
    expect(onNext.mock.calls[0][1].recording.media_key).toBe('m0');
  });

  it('offline: the recording is kept and checked later', async () => {
    take.transcript = { status: 'offline' };
    await render();
    expect(host.querySelector('[data-testid="speaking-transcript"]')?.textContent).toContain('Claude will check it when you’re online');
  });
});
