/**
 * 🎤 Read it again in Hard mode's answer in place (docs/STUDY_SESSION.md "Hard mode"): the take is judged with the
 * read card's rule and shown as "You said" under ✓ Right this time / ≈ Nearly / ✗ Not quite — practice only, so the
 * panel's Continue stays the way on and nothing about the card changes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface FakeDictation {
  surface: string;
  land: (text: string) => void;
  fail: (failure: 'failed' | 'empty') => void;
  retryUpload: ReturnType<typeof vi.fn>;
}
const fakes = vi.hoisted(() => ({ list: [] as FakeDictation[], blocked: null as string | null }));
vi.mock('../../hooks/useVoiceDictation', async () => {
  const React = await import('react');
  return {
    useVoiceDictation: (opts: { surface: string; onSubmit: (a: { text: string; source: string; transcript: string | null; via?: string }) => void }) => {
      const [phase, setPhase] = React.useState<string>('idle');
      const [failure, setFailure] = React.useState<string | null>(null);
      const latest = React.useRef(opts);
      latest.current = opts;
      const fake = React.useRef<FakeDictation | null>(null);
      const retryUpload = React.useRef(vi.fn());
      if (!fake.current) {
        fake.current = {
          surface: opts.surface,
          land: (t) => { setPhase('idle'); latest.current.onSubmit({ text: t, source: 'spoken', transcript: t, via: 'live' }); },
          fail: (f) => { setPhase('failed'); setFailure(f); },
          retryUpload: retryUpload.current,
        };
        fakes.list.push(fake.current);
      }
      return {
        state: { mode: 'voice', phase, failure, blocked: fakes.blocked },
        finalText: '', partialText: '', listening: phase === 'listening', busy: false, level: 0,
        say: () => { setPhase('listening'); setFailure(null); },
        stop: () => setPhase('finishing'),
        cancel: () => setPhase('idle'),
        retake: vi.fn(), retryUpload: retryUpload.current, edit: vi.fn(), type: vi.fn(), submit: vi.fn(), canSubmit: false, reset: vi.fn(),
      };
    },
  };
});

const track = vi.fn();
vi.mock('../../services/analytics', () => ({ track: (...a: unknown[]) => track(...a), trackError: vi.fn() }));
const vibrate = vi.fn();
Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true, writable: true });

let host: HTMLDivElement;
let root: Root;
const q = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

beforeEach(() => {
  localStorage.clear();
  fakes.list.length = 0;
  fakes.blocked = null;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  track.mockClear();
  vibrate.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const ANSWER = { hanzi: '他怎么把头发剪短了？', pinyin: 'Tā zěnme bǎ tóufa jiǎn duǎn le?', english: 'Why did he cut his hair short?' };

async function renderRevealed(extra: { onStart?: () => void } = {}) {
  const { HardModeFeedback } = await import('./HardModeFeedback');
  const handlers = { onTryAgain: vi.fn(), onShowAnswer: vi.fn(), onNext: vi.fn(), onPlayAnswer: vi.fn() };
  act(() => root.render(
    <HardModeFeedback
      result="revealed"
      said="他这么拔，头发什么短了?"
      spoken
      roundFollows
      answer={ANSWER}
      readAgain={{ hanzi: ANSWER.hanzi, pinyin: ANSWER.pinyin, cardType: 'hanzi_to_meaning', where: 'homework', onStart: extra.onStart }}
      {...handlers}
    />,
  ));
  return handlers;
}

describe('🎤 Read it again', () => {
  it('sits in the answer in place, under what he said, with Continue still the way on', async () => {
    const h = await renderRevealed();
    expect(q('hard-read-again')).not.toBeNull();
    expect(q('hard-read-again-mic')!.textContent).toContain('Read it aloud');
    expect(fakes.list[0].surface).toBe('hard_mode_read_again');
    expect(q('hard-continue')!.className).toContain('btn-primary');
    act(() => q('hard-continue')!.click());
    expect(h.onNext).toHaveBeenCalled();
  });

  it('read right this time: ✓ Right this time, the "You said" row, felt — and still practice only', async () => {
    const onStart = vi.fn();
    const h = await renderRevealed({ onStart });
    act(() => q('hard-read-again-mic')!.click());
    expect(onStart).toHaveBeenCalled();
    expect(q('hard-read-again-live')!.textContent).toContain('Listening');
    expect(q('hard-read-again-mic')!.textContent).toContain('Stop');
    act(() => fakes.list[0].land('他怎么把头发剪短了'));
    const result = q('hard-read-again-result')!;
    expect(result.dataset.result).toBe('right');
    expect(result.textContent).toContain('✓ Right this time');
    expect(q('hard-read-again-said')!.dataset.verdict).toBe('exact');
    expect(result.textContent).toContain('still counts as a miss');
    expect(vibrate).toHaveBeenCalledWith([40, 70, 60]);
    expect(track).toHaveBeenCalledWith('study.hard_mode_read_again', { result: 'right', tries: 1, via: 'live', card_type: 'hanzi_to_meaning', where: 'homework' });
    expect(q('hard-read-again-mic')!.textContent).toContain('Read it again');
    // Nothing about the card moved: no next, no try again, no give up.
    expect(h.onNext).not.toHaveBeenCalled();
    expect(h.onTryAgain).not.toHaveBeenCalled();
    expect(h.onShowAnswer).not.toHaveBeenCalled();
  });

  it('read wrong: ✗ Not quite with the marked "You said"; a second take replaces it', async () => {
    await renderRevealed();
    act(() => q('hard-read-again-mic')!.click());
    act(() => fakes.list[0].land('他这么拔，头发什么短了?'));
    expect(q('hard-read-again-result')!.dataset.result).toBe('wrong');
    expect(q('hard-read-again-result')!.textContent).toContain('✗ Not quite');
    expect(q('hard-read-again-said')!.dataset.verdict).toBe('wrong');
    expect(vibrate).toHaveBeenCalledWith([30, 80, 30]);
    act(() => q('hard-read-again-mic')!.click());
    expect(q('hard-read-again-result')).toBeNull();
    act(() => fakes.list[0].land('他怎么把头发剪短了？'));
    expect(q('hard-read-again-result')!.dataset.result).toBe('right');
    expect(track).toHaveBeenLastCalledWith('study.hard_mode_read_again', expect.objectContaining({ result: 'right', tries: 2 }));
  });

  it('a take that failed offers tap to retry (the same take); one that heard nothing says so', async () => {
    await renderRevealed();
    act(() => q('hard-read-again-mic')!.click());
    act(() => fakes.list[0].fail('failed'));
    expect(q('hard-read-again-retry')!.textContent).toContain('Tap to retry');
    act(() => q('hard-read-again-retry')!.click());
    expect(fakes.list[0].retryUpload).toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith('study.hard_mode_read_again', expect.objectContaining({ result: 'failed' }));
    act(() => q('hard-read-again-mic')!.click());
    act(() => fakes.list[0].fail('empty'));
    expect(q('hard-read-again-empty')).not.toBeNull();
  });

  it('offline: the 🎤 is off and says why', async () => {
    fakes.blocked = 'offline';
    await renderRevealed();
    expect((q('hard-read-again-mic') as HTMLButtonElement).disabled).toBe(true);
    expect(q('hard-read-again-blocked')).not.toBeNull();
  });
});
