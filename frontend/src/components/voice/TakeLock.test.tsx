/**
 * The take lock (shared/voice/takeLock.ts) in the mini-lesson player: while a 🎤 take records, the exercise's
 * primary action row is ONE "■ Stop recording" that stops the take and never advances — for EVERY exercise type
 * (the sample of each type, question side), and on the answer screens Jerome hit (word order → 🎤 Say it again →
 * the tap meant to stop the take pressed Continue). Back / ✕ stop the take first.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SAMPLE_LESSONS } from '@shared/lesson/samples';
import type { LessonExercise } from '@shared/lesson';
import type { TakePhase } from '@shared/voice/takeLock';
import { TakeLockActions, TakeLockProvider, useReportTake, useTakeLock } from './TakeLock';
import { ExerciseView } from '../ExerciseView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const track = vi.fn();
vi.mock('../../services/analytics', () => ({ track: (...a: unknown[]) => track(...a) }));
vi.mock('../../services/studyFeel', () => ({ studyFeel: vi.fn() }));
vi.mock('../../services/answerCheck', () => ({
  checkLessonAnswer: () => new Promise(() => {}),
  askAboutLessonAnswer: vi.fn(),
  AnswerCheckUnavailable: class extends Error {},
}));
vi.mock('../../api/lessonPractice', () => ({ checkMadeSentence: () => new Promise(() => {}) }));
vi.mock('../../utils/audioPlayback', () => ({ createAudioPlayer: () => ({ play: vi.fn(), stop: vi.fn(), dispose: vi.fn(), claim: vi.fn(), isCurrent: () => true }) }));
vi.mock('../../hooks/useLessonImage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks/useLessonImage')>()),
  useLessonImage: () => ({ state: { status: 'drawing' }, url: null }),
}));
// The voice pieces: their own takes are tested where they live; here a fake take reports into the lock.
vi.mock('./VoiceTextInput', () => ({
  VoiceTextInput: ({ onSubmit }: { onSubmit: (a: { text: string; source: string; transcript: null }) => void }) => (
    <button data-testid="voice-submit" onClick={() => onSubmit({ text: '我们一起去吧', source: 'typed', transcript: null })}>submit</button>
  ),
}));
vi.mock('../coach/PractiseSentence', () => ({ PractiseSentence: () => <span data-testid="practise" /> }));
vi.mock('../../hooks/useSpeakingTake', () => ({
  useSpeakingTake: () => ({
    isRecording: false, audioLevel: 0, error: null, elapsed: 0, durationMs: 0, take: null, liveText: '',
    transcript: { status: 'none' }, start: vi.fn(), stop: vi.fn(), retry: vi.fn(), reset: vi.fn(),
  }),
}));

/** A recorder on the screen whose phase the test sets. */
let setFake: (p: TakePhase) => void = () => {};
const fakeStop = vi.fn();
function FakeTake() {
  const [phase, setPhase] = useState<TakePhase>('idle');
  setFake = setPhase;
  useReportTake(phase, fakeStop);
  return null;
}

let lockRef: ReturnType<typeof useTakeLock> = null;
function LockSpy() {
  const lock = useTakeLock();
  useEffect(() => { lockRef = lock; });
  return null;
}

describe('the take lock', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    fakeStop.mockReset();
    track.mockReset();
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const all = (sel: string) => Array.from(host.querySelectorAll<HTMLElement>(sel));
  const q = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const setPhase = (p: TakePhase) => act(() => setFake(p));

  it('turns the action row into Stop recording, then Checking…, then back', () => {
    const next = vi.fn();
    act(() => root.render(
      <TakeLockProvider>
        <FakeTake />
        <TakeLockActions><button className="practice-btn primary" onClick={next}>Continue</button></TakeLockActions>
        <TakeLockActions role="secondary"><button className="practice-btn" data-testid="play">▶ Play</button></TakeLockActions>
      </TakeLockProvider>,
    ));
    expect(q('take-lock-stop')).toBeNull();
    setPhase('recording');
    const stop = q('take-lock-stop')!;
    expect(stop.textContent).toContain('Stop recording');
    expect(host.textContent).not.toContain('Continue');
    expect(q('take-lock-muted')?.hasAttribute('inert')).toBe(true);
    act(() => stop.click());
    expect(fakeStop).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith('voice.take_lock_stop', { via: 'footer', screen: 'lesson' });
    setPhase('checking');
    expect(q('take-lock-stop')!.textContent).toContain('Checking what you said…');
    expect((q('take-lock-stop') as HTMLButtonElement).disabled).toBe(true);
    setPhase('idle');
    expect(q('take-lock-stop')).toBeNull();
    expect(q('play')?.closest('.exercise-actions')?.hasAttribute('inert')).toBe(false);
    act(() => (all('button').find((b) => b.textContent === 'Continue') as HTMLElement).click());
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('✕ while recording stops the take instead of leaving; leaves otherwise', () => {
    const leave = vi.fn();
    act(() => root.render(<TakeLockProvider><FakeTake /><LockSpy /></TakeLockProvider>));
    setPhase('recording');
    act(() => lockRef!.guardLeave(leave));
    expect(fakeStop).toHaveBeenCalledTimes(1);
    expect(leave).not.toHaveBeenCalled();
    setPhase('checking');
    act(() => lockRef!.guardLeave(leave));
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it('outside a provider nothing is locked (other screens are unchanged)', () => {
    act(() => root.render(<><FakeTake /><TakeLockActions><button className="practice-btn primary">Continue</button></TakeLockActions></>));
    setPhase('recording');
    expect(q('take-lock-stop')).toBeNull();
    expect(host.textContent).toContain('Continue');
  });

  // Every exercise type: with a take recording, no primary action of the exercise is on screen (only Stop recording).
  const byType = new Map<string, LessonExercise>();
  for (const l of SAMPLE_LESSONS) for (const s of l.spec.sections) for (const ex of s.exercises) if (!byType.has(ex.type)) byType.set(ex.type, ex);
  it('covers every exercise type in the catalogue', () => {
    expect(byType.size).toBeGreaterThanOrEqual(17);
  });
  for (const [type, exercise] of byType) {
    it(`${type}: the primary action is Stop recording while a take records, and never advances`, () => {
      const onDone = vi.fn();
      act(() => root.render(
        <TakeLockProvider>
          <FakeTake />
          <ExerciseView exercise={exercise} speak={() => {}} onDone={onDone} />
        </TakeLockProvider>,
      ));
      setPhase('recording');
      const primaries = all('.practice-btn.primary, .btn.btn-primary').filter((b) => !b.closest('[inert]'));
      expect(primaries, `${type}: a primary action is still tappable mid-take`).toEqual([]);
      for (const stop of all('[data-testid="take-lock-stop"]')) act(() => stop.click());
      expect(onDone).not.toHaveBeenCalled();
      setPhase('idle');
      expect(q('take-lock-stop')).toBeNull();
    });
  }

  it('word order: after Check, 🎤 Say it again recording → Continue is Stop recording; stopped → Continue advances', () => {
    const scramble = byType.get('scramble') as Extract<LessonExercise, { type: 'scramble' }>;
    const onDone = vi.fn();
    act(() => root.render(
      <TakeLockProvider>
        <FakeTake />
        <ExerciseView exercise={scramble} speak={() => {}} onDone={onDone} />
      </TakeLockProvider>,
    ));
    // Place every block in the right order, then Check.
    for (const tile of scramble.correct_order) {
      const btn = all('.scramble-row.pool .tile').find((b) => b.textContent === tile && !b.classList.contains('ghost'))!;
      act(() => btn.click());
    }
    act(() => (all('button').find((b) => b.textContent?.trim() === 'Check') as HTMLElement).click());
    expect(host.textContent).toContain('✓ Correct');
    // His blocks and the right sentence are words to explore now, with ▶ to hear it again.
    expect(all('[data-testid="scramble-answer-tile"]').length).toBe(scramble.correct_order.length);
    expect(q('scramble-correct-sentence')?.querySelector('[data-testid="explorable-text"]')).not.toBeNull();
    expect(q('lesson-replay')).not.toBeNull();
    setPhase('recording');
    expect(host.textContent).not.toContain('Continue');
    expect((q('lesson-replay') as HTMLButtonElement).disabled).toBe(true);
    act(() => q('take-lock-stop')!.click());
    expect(fakeStop).toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    setPhase('idle');
    act(() => (all('button').find((b) => b.textContent?.trim() === 'Continue') as HTMLElement).click());
    expect(onDone).toHaveBeenCalledWith(true, expect.objectContaining({ order: scramble.correct_order }));
  });
});
