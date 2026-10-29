/**
 * 🎤 Read it aloud on a reader page (components/reader/ReadAloud.tsx): the button records (the live
 * transcript shows while he reads), the take is judged against the page and the page's OWN Chinese is
 * marked in place — no second copy — with one line ("≈ 66% — 2 to check") and the transcript behind
 * "You said ▸"; 🎤 again replaces the result; a failed take offers "tap to retry"; offline says why
 * and records nothing; `reader.read_aloud` carries the bucket, the page's characters and the path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReaderWord } from '@shared/reader/words';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface FakeDictation {
  land: (text: string) => void;
  fail: (failure: 'failed' | 'empty' | 'signed_out') => void;
  live: (finalText: string) => void;
}
const fake = vi.hoisted(() => ({ current: null as FakeDictation | null, blocked: null as string | null }));
vi.mock('../../hooks/useVoiceDictation', async () => {
  const React = await import('react');
  return {
    useVoiceDictation: (opts: { onSubmit: (a: { text: string; source: string; transcript: string | null; via?: string }) => void }) => {
      const [phase, setPhase] = React.useState<string>('idle');
      const [failure, setFailure] = React.useState<string | null>(null);
      const [finalText, setFinal] = React.useState('');
      const latest = React.useRef(opts);
      latest.current = opts;
      fake.current = {
        land: (t) => { setPhase('idle'); setFinal(''); latest.current.onSubmit({ text: t, source: 'spoken', transcript: t, via: 'live' }); },
        fail: (f) => { setPhase('failed'); setFailure(f); },
        live: (t) => setFinal(t),
      };
      return {
        state: { mode: 'voice', phase, failure, blocked: fake.blocked },
        finalText, partialText: '', listening: phase === 'listening', busy: false, level: 0,
        say: () => { setPhase('listening'); setFailure(null); },
        stop: () => setPhase('finishing'),
        cancel: () => setPhase('idle'),
        retake: vi.fn(), retryUpload: vi.fn(), edit: vi.fn(), type: vi.fn(), submit: vi.fn(), canSubmit: false, reset: vi.fn(),
      };
    },
  };
});
const track = vi.fn();
vi.mock('../../services/analytics', () => ({ track: (...a: unknown[]) => track(...a), trackError: vi.fn() }));
vi.mock('../../api/client', () => ({ backfillReaderWords: vi.fn(), apiErrorStatus: () => undefined }));
vi.mock('../../services/chineseSegmenter', () => ({ useSegmentedWords: () => null, preloadSegmenter: () => {} }));

import { MemoryRouter } from 'react-router-dom';
import { ExplorerProvider } from '../explorer/ExplorerContext';
import { ReaderWordsText } from './ReaderWords';
import { ReadAloudMic, ReadAloudPanel, useReadAloud } from './ReadAloud';

const TEXT = '早上好。我叫小徐。';
const WORDS: ReaderWord[] = [
  { text: '早上', pinyin: 'zǎoshang', gloss: 'morning' },
  { text: '好', pinyin: 'hǎo', gloss: 'good' },
  { text: '。', pinyin: '', gloss: '' },
  { text: '我', pinyin: 'wǒ', gloss: 'I' },
  { text: '叫', pinyin: 'jiào', gloss: 'am called' },
  { text: '小徐', pinyin: 'Xiǎo Xú', gloss: 'Xiao Xu' },
  { text: '。', pinyin: '', gloss: '' },
];
const speak = vi.fn();

function Harness() {
  const ra = useReadAloud(TEXT);
  return (
    <>
      <ReaderWordsText readerId="r1" page={{ id: 'p1', content_chinese: TEXT, words: WORDS }} marks={ra.result} onSpeak={speak} />
      <ReadAloudMic ra={ra} />
      <ReadAloudPanel ra={ra} />
    </>
  );
}

let host: HTMLDivElement;
let root: Root;
const q = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const click = async (el: Element | null) => {
  expect(el).toBeTruthy();
  await act(async () => (el as HTMLElement).click());
  await flush();
};
const markOf = (ch: string) => [...host.querySelectorAll<HTMLElement>('.ra-char')].find((e) => e.textContent === ch)?.dataset.mark;

beforeEach(async () => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  track.mockClear();
  speak.mockClear();
  fake.blocked = null;
  await act(async () => root.render(<MemoryRouter><ExplorerProvider><Harness /></ExplorerProvider></MemoryRouter>));
  await flush();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('🎤 Read it aloud', () => {
  it('button → live transcript → the page marked in place + one line', async () => {
    expect(q('reader-read-aloud')?.getAttribute('aria-label')).toBe('Read it aloud');
    expect(host.querySelector('.ra-char')).toBeNull();

    await click(q('reader-read-aloud'));
    expect(q('reader-read-aloud')?.getAttribute('aria-label')).toBe('Stop — check my reading');
    expect(q('reader-read-aloud-live')?.textContent).toBe('Listening… read the page aloud');
    await act(async () => fake.current!.live('我叫'));
    expect(q('reader-read-aloud-live')?.textContent).toBe('我叫');

    // He skipped 早上好 and said 许 (xǔ) for 徐 (xú): tone only.
    await act(async () => fake.current!.land('我叫小许。'));
    await flush();
    expect(markOf('早')).toBe('missed');
    expect(markOf('我')).toBe('ok');
    expect(markOf('徐')).toBe('close');
    // The page's own text, once — no copy of it.
    expect(host.querySelector('[data-testid="reader-words"]')?.textContent).toBe(TEXT);
    expect(q('reader-read-aloud-line')?.textContent).toBe('✕ 42% — 4 to check');
    expect(q('reader-read-aloud-said')).toBeNull();
    await click(q('reader-read-aloud-said-toggle'));
    expect(q('reader-read-aloud-said')?.textContent).toBe('我叫小许。');
    expect(track).toHaveBeenCalledWith('reader.read_aloud', { result_bucket: 'under_50', chars: 7, via: 'live' });
    expect(q('reader-read-aloud')?.getAttribute('aria-label')).toBe('Say it again');
    const chip = [...host.querySelectorAll('.reader-word-chip')].find((c) => c.textContent === '小徐')!;
    expect(chip.getAttribute('aria-label')).toBe('小, 徐 — tone off (heard 许)');
  });

  it('say it again replaces the result', async () => {
    await click(q('reader-read-aloud'));
    await act(async () => fake.current!.land('我叫小许'));
    await click(q('reader-read-aloud'));
    expect(host.querySelector('.ra-char')).toBeNull();
    expect(q('reader-read-aloud-result')).toBeNull();
    await act(async () => fake.current!.land('早上好，我叫小徐。'));
    await flush();
    expect(q('reader-read-aloud-line')?.textContent).toBe('✓ 100% — all read right');
    expect(markOf('徐')).toBe('ok');
  });

  it('a failed take offers tap to retry; nothing heard says so', async () => {
    await click(q('reader-read-aloud'));
    await act(async () => fake.current!.fail('failed'));
    expect(q('reader-read-aloud-retry')).not.toBeNull();
    expect(track).toHaveBeenCalledWith('reader.read_aloud', { result_bucket: 'failed', chars: 0, via: 'none' });
    await click(q('reader-read-aloud'));
    await act(async () => fake.current!.fail('empty'));
    expect(q('reader-read-aloud-empty')?.textContent).toBe('Didn’t catch that — try again.');
  });

  it('offline: says it needs a connection and records nothing', async () => {
    fake.blocked = 'offline';
    await act(async () => root.render(<MemoryRouter><ExplorerProvider><Harness /></ExplorerProvider></MemoryRouter>));
    await click(q('reader-read-aloud'));
    expect(q('reader-read-aloud-offline')?.textContent).toBe('Needs a connection to check your reading');
    expect(q('reader-read-aloud-live')).toBeNull();
    expect(track).not.toHaveBeenCalled();
  });
});
