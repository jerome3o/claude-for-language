/**
 * 📝 Word recap "🎤 Say it" (docs/STUDY_SESSION.md "Reader word recap"): the 🎤 on a recap card, a
 * take checked against the card's word (the Sentence Coach's practise rule — homophones by sound,
 * the word inside a phrase = contains), the compact "You said" row, and a right take before Show
 * answer suggesting Got it. Practice only: nothing but the analytics event.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fake = vi.hoisted(() => ({ current: null as { land: (t: string) => void } | null, blocked: null as string | null }));
vi.mock('../../hooks/useVoiceDictation', async () => {
  const React = await import('react');
  return {
    useVoiceDictation: (opts: { surface: string; onSubmit: (a: { text: string; source: string; transcript: string | null; via?: string }) => void }) => {
      const [phase, setPhase] = React.useState<string>('idle');
      const latest = React.useRef(opts);
      latest.current = opts;
      fake.current = { land: (t) => { setPhase('idle'); latest.current.onSubmit({ text: t, source: 'spoken', transcript: t, via: 'live' }); } };
      return {
        state: { mode: 'voice', phase, failure: null, blocked: fake.blocked },
        finalText: '', partialText: '', listening: phase === 'listening', busy: false, level: 0,
        say: () => setPhase('listening'), stop: () => setPhase('finishing'), cancel: () => setPhase('idle'),
        retake: vi.fn(), retryUpload: vi.fn(), edit: vi.fn(), type: vi.fn(), submit: vi.fn(), canSubmit: false, reset: vi.fn(),
      };
    },
  };
});
const track = vi.fn();
vi.mock('../../services/analytics', () => ({ track: (...a: unknown[]) => track(...a), trackError: vi.fn() }));
vi.mock('../editor/useLessonSpeak', () => ({ useLessonSpeak: () => vi.fn() }));
vi.mock('../../services/chineseSegmenter', () => ({ useSegmentedWords: () => null, preloadSegmenter: () => {} }));
vi.mock('../Confetti', () => ({ Confetti: () => null }));
vi.mock('../explorer/ExplorerContext', () => ({
  useExplorer: () => ({ open: vi.fn(), push: vi.fn(), inside: false }),
  ExplorerProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { addRecapTap, emptyRecapRun, finishRecapRun, type WordRecapRun } from '@shared/study/wordRecap';
import { ReaderRecapView } from './ReaderRecapView';

const SENTENCE = '他在春熙路采耳。';
function run(): WordRecapRun {
  let r = emptyRecapRun('r-cd', '2026-11-03T10:00:00Z');
  r = addRecapTap(r, { text: '采耳', pinyin: "cǎi'ěr", gloss: 'ear cleaning', sentence: SENTENCE, page: 0, pos: 5, page_english: 'He gets his ears cleaned on Chunxi Road.' }, '2026-11-03T10:00:01Z');
  return finishRecapRun(r, '2026-11-03T10:05:00Z');
}

let host: HTMLDivElement;
let root: Root;
const q = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const click = async (el: Element | null) => {
  expect(el).toBeTruthy();
  await act(async () => (el as HTMLElement).click());
};
const say = async (transcript: string) => {
  await click(q('recap-say-mic'));
  await act(async () => fake.current!.land(transcript));
};

beforeEach(async () => {
  track.mockClear();
  fake.blocked = null;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(
    <ReaderRecapView
      run={run()} title="Word recap" owned={new Set()} glosses={new Map()} online doneLine={null}
      actions={{ answer: vi.fn(), keep: vi.fn(), restart: vi.fn(), done: vi.fn(), close: vi.fn(), speak: vi.fn() }}
    />,
  ));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('word recap — 🎤 Say it', () => {
  it('shows 🎤 Say it on the question side, without ▶ (it would give the word away)', () => {
    expect(q('recap-say-mic')?.textContent).toContain('Say it');
    expect(q('recap-say-listen')).toBeNull();
    expect(q('recap-show')).toBeTruthy();
  });

  it('a right take before Show answer: "You said" ✓ Match, and Got it is suggested', async () => {
    await say('采耳。');
    const row = q('recap-say-result');
    expect(row?.dataset.state).toBe('match');
    expect(row?.textContent).toContain('采耳');
    expect(track).toHaveBeenCalledWith('reader.recap_say', { result: 'match', side: 'question', source: 'reader' });
    await click(q('recap-show'));
    // The result stays on the answer side.
    expect(q('recap-say-result')?.dataset.state).toBe('match');
    expect(q('recap-got-it')?.dataset.suggested).toBe('true');
    expect(q('recap-got-it')?.textContent).toContain('suggested');
  });

  it('the word said inside a phrase counts (contains)', async () => {
    await say('我想去采耳');
    expect(q('recap-say-result')?.dataset.state).toBe('contains');
    await click(q('recap-show'));
    expect(q('recap-got-it')?.dataset.suggested).toBe('true');
  });

  it('other tones are close and suggest nothing', async () => {
    await say('菜耳');
    expect(q('recap-say-result')?.dataset.state).toBe('close');
    await click(q('recap-show'));
    expect(q('recap-got-it')?.dataset.suggested).toBeUndefined();
  });

  it('a take on the answer side shows the result but never suggests', async () => {
    await click(q('recap-show'));
    await say('采耳');
    expect(q('recap-say-result')?.dataset.state).toBe('match');
    expect(track).toHaveBeenCalledWith('reader.recap_say', { result: 'match', side: 'answer', source: 'reader' });
    expect(q('recap-got-it')?.dataset.suggested).toBeUndefined();
  });

  it('offline: the mic says why and does not record', async () => {
    fake.blocked = 'offline';
    await act(async () => root.render(
      <ReaderRecapView
        run={run()} title="Word recap" owned={new Set()} glosses={new Map()} online={false} doneLine={null}
        actions={{ answer: vi.fn(), keep: vi.fn(), restart: vi.fn(), done: vi.fn(), close: vi.fn(), speak: vi.fn() }}
      />,
    ));
    expect((q('recap-say-mic') as HTMLButtonElement).disabled).toBe(true);
    expect(q('recap-say-blocked')?.textContent).toBe('Practising needs a connection.');
  });
});
