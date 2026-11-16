/**
 * The take lock (docs/STUDY_SESSION.md "While a take is recording"): while a take records, an advancing control
 * stops it instead (and does nothing else); while it is checked, a tap waits; then everything runs as usual.
 * The study card's footer / a feedback row give way to ONE "■ Stop recording" in the same place.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { guardTake, resetTakeLock, setTake, stopTakes, takeLockSnapshot, takeTap } from './takeLock';
import { useReportTake } from '../components/voice/TakeLock';
import { takePhase } from '@shared/voice/takeLock';
import { TakeLockedActions } from '../components/voice/TakeStop';
import { StudyCardFooter } from '../components/study/ReRecordBar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  resetTakeLock();
});

function render(node: React.ReactNode) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
}
const q = (id: string) => host!.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement | null;
const click = (el: Element | null) => act(() => { (el as HTMLElement).click(); });

describe('registry', () => {
  it('merges takes and decides each tap', () => {
    const stop = vi.fn();
    const next = vi.fn();
    const guarded = guardTake(next);
    guarded();
    expect(next).toHaveBeenCalledTimes(1);

    setTake('a', { phase: 'recording', stop });
    setTake('b', { phase: 'checking', stop: vi.fn() });
    expect(takeLockSnapshot().phase).toBe('recording');
    guarded();
    expect(next).toHaveBeenCalledTimes(1); // not advanced …
    expect(stop).toHaveBeenCalledTimes(1); // … the take was stopped instead

    setTake('a', { phase: 'checking', stop });
    expect(takeTap()).toBe('wait');
    guarded();
    expect(next).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1); // nothing to stop while it is checked

    setTake('a', null);
    setTake('b', { phase: 'idle', stop: vi.fn() });
    guarded();
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('back stops only the takes the global guard owns', () => {
    const own = vi.fn();
    const global = vi.fn();
    setTake('own', { phase: 'recording', stop: own, ownBack: true });
    setTake('global', { phase: 'recording', stop: global });
    expect(takeLockSnapshot()).toEqual({ phase: 'recording', backPhase: 'recording' });
    stopTakes({ backOnly: true });
    expect(global).toHaveBeenCalledTimes(1);
    expect(own).not.toHaveBeenCalled();
    setTake('global', null);
    expect(takeLockSnapshot()).toEqual({ phase: 'recording', backPhase: 'idle' });
  });
});

function Harness({ onNext, onRate }: { onNext: () => void; onRate: () => void }) {
  const [phase, setPhase] = useState('idle');
  const stop = () => setPhase('finishing');
  useReportTake(takePhase(phase === 'listening', phase === 'finishing'), stop);
  return (
    <>
      <button type="button" data-testid="mic" onClick={() => setPhase(phase === 'listening' ? 'finishing' : 'listening')}>🎤</button>
      <button type="button" data-testid="done" onClick={() => setPhase('idle')}>done</button>
      <TakeLockedActions testId="row-stop">
        <button type="button" data-testid="next" onClick={onNext}>Next</button>
      </TakeLockedActions>
      <StudyCardFooter rerecord={null} actions={<span>actions</span>} ratings={<button type="button" data-testid="good" onClick={onRate}>Good</button>} />
    </>
  );
}

describe('TakeLockedActions / the study footer', () => {
  it('Next and the ratings give way to Stop recording, which stops the take; they come back after', () => {
    const onNext = vi.fn();
    const onRate = vi.fn();
    render(<Harness onNext={onNext} onRate={onRate} />);
    expect(q('next')).not.toBeNull();
    expect(q('good')).not.toBeNull();

    click(q('mic'));
    expect(q('next')).toBeNull();
    expect(q('good')).toBeNull();
    const stop = q('row-stop')!;
    expect(stop.textContent).toContain('Stop recording');
    expect(q('study-footer-stop')).not.toBeNull();

    // The thumb aimed at Next stops the take — nothing advances.
    click(stop);
    expect(onNext).not.toHaveBeenCalled();
    expect(q('row-stop')!.disabled).toBe(true); // checking
    expect(q('row-stop')!.textContent).toContain('Checking');

    click(q('done'));
    expect(q('next')).not.toBeNull();
    click(q('good'));
    expect(onRate).toHaveBeenCalledTimes(1);
  });

  it('a take that unmounts is forgotten', () => {
    render(<Harness onNext={vi.fn()} onRate={vi.fn()} />);
    click(q('mic'));
    expect(takeLockSnapshot().phase).toBe('recording');
    act(() => root!.unmount());
    root = null;
    expect(takeLockSnapshot().phase).toBe('idle');
  });
});
