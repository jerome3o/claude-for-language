/**
 * The reading view locks around a 🎤 Read it aloud take (Jerome: "accidentally clicked next"): while
 * the take records, Previous / Next (and Finish) give way to ONE big red "■ Stop recording" in the
 * footer, the audio row and ▶ Play whole story are disabled, a tap on the top bar (✕) or back stops
 * the take instead of leaving; then "Checking your reading…" until the result shows; and the whole
 * page read right throws confetti once for that take.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface FakeDictation {
  land: (text: string) => void;
}
const fake = vi.hoisted(() => ({ current: null as FakeDictation | null }));
vi.mock('../../hooks/useVoiceDictation', async () => {
  const React = await import('react');
  return {
    useVoiceDictation: (opts: { onSubmit: (a: { text: string; source: string; transcript: string | null; via?: string }) => void }) => {
      const [phase, setPhase] = React.useState<string>('idle');
      const latest = React.useRef(opts);
      latest.current = opts;
      fake.current = {
        land: (t) => { setPhase('idle'); latest.current.onSubmit({ text: t, source: 'spoken', transcript: t, via: 'live' }); },
      };
      return {
        state: { mode: 'voice', phase, failure: null, blocked: null },
        finalText: '', partialText: '', listening: phase === 'listening', busy: false, level: 0,
        say: () => setPhase('listening'),
        stop: () => setPhase('finishing'),
        cancel: () => setPhase('idle'),
        retake: vi.fn(), retryUpload: vi.fn(), edit: vi.fn(), type: vi.fn(), submit: vi.fn(), canSubmit: false, reset: vi.fn(),
      };
    },
  };
});
const track = vi.fn();
vi.mock('../../services/analytics', () => ({ track: (...a: unknown[]) => track(...a), trackError: vi.fn() }));
vi.mock('../../api/client', () => ({ backfillReaderWords: vi.fn(), apiErrorStatus: () => undefined, generateReaderPageImage: vi.fn() }));
vi.mock('../../services/chineseSegmenter', () => ({ useSegmentedWords: () => null, preloadSegmenter: () => {} }));
vi.mock('../../services/readerSync', () => ({ cacheReaderNarration: vi.fn(async () => {}), updateLocalReaderPageImage: vi.fn() }));
vi.mock('../../hooks/useCachedImageUrl', () => ({ useCachedImageUrl: () => null }));
vi.mock('../editor/useLessonSpeak', () => ({ useLessonSpeak: () => vi.fn() }));
vi.mock('../Confetti', () => ({ Confetti: () => <div data-testid="confetti" /> }));
// The page's audio row: its controls, disabled as the reading view says (the real scrubber decodes audio).
vi.mock('../ReaderAudioScrubber', () => ({
  ReaderAudioScrubber: ({ controlsExtra, disabled }: { controlsExtra?: React.ReactNode; disabled?: boolean }) => (
    <div data-testid="scrubber" data-locked={disabled ? 'true' : 'false'}>
      <button type="button" disabled={disabled} data-testid="scrubber-play">🔊</button>
      <button type="button" disabled={disabled} data-testid="reader-speed-chip">1×</button>
      {controlsExtra}
    </div>
  ),
}));

import { MemoryRouter } from 'react-router-dom';
import { ExplorerProvider } from '../explorer/ExplorerContext';
import { ReaderView, type ReaderViewData } from './ReaderView';

const page = (id: string, zh: string) => ({
  id, reader_id: 'r1', page_number: 0, content_chinese: zh, content_pinyin: '', content_english: '', image_url: null, image_prompt: null,
}) as unknown as ReaderViewData['pages'][number];
const READER: ReaderViewData = {
  id: 'r1', title_chinese: '小徐', title_english: 'Xiao Xu',
  pages: [page('p1', '早上好。我叫小徐。'), page('p2', '他在游泳。')],
};

let host: HTMLDivElement;
let root: Root;
const close = vi.fn();
const finish = vi.fn();
const q = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const click = async (el: Element | null) => {
  expect(el).toBeTruthy();
  await act(async () => (el as HTMLElement).click());
  await flush();
};
const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) ?? null;
const pageLabel = () => q('study-reader-page-label')?.textContent;

beforeEach(async () => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  track.mockClear();
  close.mockClear();
  finish.mockClear();
  await act(async () => root.render(
    <MemoryRouter>
      <ExplorerProvider>
        <ReaderView
          reader={READER}
          source="session"
          topbarStart={<span>2 cards</span>}
          topbarEnd={<button type="button" onClick={close} data-testid="topbar-close">✕</button>}
          isFinishing={false}
          onFinish={finish}
        />
      </ExplorerProvider>
    </MemoryRouter>,
  ));
  await flush();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('the reading view while a take records', () => {
  it('swaps Previous / Next for ■ Stop recording, disables the audio row and the story, and unlocks with the result', async () => {
    expect(button('Next')).not.toBeNull();
    expect(q('reader-read-aloud-footer')).toBeNull();
    expect(q('scrubber')?.dataset.locked).toBe('false');

    await click(q('reader-read-aloud'));
    // Recording: no way to turn the page — one big red Stop in the footer's slot.
    expect(button('Next')).toBeNull();
    expect(button('Previous')).toBeNull();
    const stop = q('reader-read-aloud-stop-footer') as HTMLButtonElement;
    expect(stop.textContent).toBe('Stop recording');
    expect(stop.disabled).toBe(false);
    expect(q('scrubber')?.dataset.locked).toBe('true');
    expect((q('scrubber-play') as HTMLButtonElement).disabled).toBe(true);
    expect((q('reader-speed-chip') as HTMLButtonElement).disabled).toBe(true);
    expect((q('reader-play-story') as HTMLButtonElement).disabled).toBe(true);
    // The in-row ⏹ stays live.
    expect((q('reader-read-aloud') as HTMLButtonElement).disabled).toBe(false);

    // The footer's Stop stops the take like ⏹: "Checking your reading…" until the result lands.
    await click(stop);
    expect(q('reader-read-aloud-stop-footer')?.textContent).toBe('Checking your reading…');
    expect((q('reader-read-aloud-stop-footer') as HTMLButtonElement).disabled).toBe(true);
    expect(button('Next')).toBeNull();
    expect(pageLabel()).toContain('Page 1 of 2');

    await act(async () => fake.current!.land('我叫小许'));
    await flush();
    expect(q('reader-read-aloud-footer')).toBeNull();
    expect(button('Next')).not.toBeNull();
    expect(q('scrubber')?.dataset.locked).toBe('false');
    expect((q('reader-play-story') as HTMLButtonElement).disabled).toBe(false);
    expect(q('reader-read-aloud-result')).not.toBeNull();
    // Not all right: no confetti.
    expect(q('confetti')).toBeNull();
    await click(button('Next'));
    expect(pageLabel()).toContain('Page 2 of 2');
  });

  it('the top bar ✕ stops the take first instead of leaving', async () => {
    await click(q('reader-read-aloud'));
    await click(q('topbar-close'));
    expect(close).not.toHaveBeenCalled();
    expect(q('reader-read-aloud-stop-footer')?.textContent).toBe('Checking your reading…');
    await act(async () => fake.current!.land('早上好我叫小徐'));
    await flush();
    await click(q('topbar-close'));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('back (the Android back gesture / browser ←) stops the take instead of leaving the page', async () => {
    await click(q('reader-read-aloud'));
    await act(async () => {
      window.history.back();
      await new Promise((r) => setTimeout(r, 30));
    });
    await flush();
    expect(q('reader-read-aloud-stop-footer')?.textContent).toBe('Checking your reading…');
    expect(pageLabel()).toContain('Page 1 of 2');
  });

  it('the whole page read right throws confetti once for that take', async () => {
    await click(q('reader-read-aloud'));
    await click(q('reader-read-aloud-stop-footer'));
    expect(q('confetti')).toBeNull();
    await act(async () => fake.current!.land('早上好，我叫小徐。'));
    await flush();
    expect(host.querySelectorAll('[data-testid="confetti"]').length).toBe(1);
    expect(track).toHaveBeenCalledWith('reader.read_aloud', { result_bucket: 'all', chars: 7, via: 'live', all_right: true });
    // A take that is not all right throws no new burst (the first one has already played out).
    await click(q('reader-read-aloud'));
    await act(async () => fake.current!.land('早上好我叫小许'));
    await flush();
    expect(host.querySelectorAll('[data-testid="confetti"]').length).toBe(1);
  });
});
