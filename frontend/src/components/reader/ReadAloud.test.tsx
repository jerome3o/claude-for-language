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

const harness = { text: TEXT, words: WORDS };

function Harness() {
  const ra = useReadAloud(harness.text);
  return (
    <>
      <ReaderWordsText
        readerId="r1"
        page={{ id: 'p1', content_chinese: harness.text, words: harness.words }}
        marks={ra.result}
        onSpeak={speak}
        onWords={ra.setWords}
      />
      <ReadAloudMic ra={ra} />
      <ReadAloudPanel ra={ra} onSpeak={speak} />
      <span data-testid="perfect-takes">{ra.perfectTakes}</span>
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
const NBSP6 = '\u00a0'.repeat(6);
const markOf = (ch: string) => [...host.querySelectorAll<HTMLElement>('.ra-char')].find((e) => e.textContent === ch)?.dataset.mark;

beforeEach(async () => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  track.mockClear();
  speak.mockClear();
  fake.blocked = null;
  harness.text = TEXT;
  harness.words = WORDS;
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
    // A tiny legend of the marks the page shows (徐 tone off, 早上好 missed), chips stepped back.
    expect([...host.querySelectorAll<HTMLElement>('[data-legend]')].map((e) => e.dataset.legend)).toEqual(['close', 'missed']);
    expect(q('reader-read-aloud-legend')?.textContent).toBe(`${NBSP6}tone off${NBSP6}missed`);
    expect(q('reader-words')?.dataset.readAloud).toBe('marked');
    expect(q('reader-read-aloud-said')).toBeNull();
    await click(q('reader-read-aloud-said-toggle'));
    expect(q('reader-read-aloud-said')?.textContent).toBe('我叫小许。');
    expect(track).toHaveBeenCalledWith('reader.read_aloud', { result_bucket: 'under_50', chars: 7, via: 'live', all_right: false });
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
    expect(q('reader-read-aloud-legend')).toBeNull();
    // The whole page right: counted as a perfect take (the reading view throws confetti).
    expect(track).toHaveBeenLastCalledWith('reader.read_aloud', { result_bucket: 'all', chars: 7, via: 'live', all_right: true });
    expect(q('perfect-takes')?.textContent).toBe('1');
  });

  it('a failed take offers tap to retry; nothing heard says so', async () => {
    await click(q('reader-read-aloud'));
    await act(async () => fake.current!.fail('failed'));
    expect(q('reader-read-aloud-retry')).not.toBeNull();
    expect(track).toHaveBeenCalledWith('reader.read_aloud', { result_bucket: 'failed', chars: 0, via: 'none', all_right: false });
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

describe('what it heard vs the page', () => {
  const CHENGDU = '胆子大的话，可以试试麻辣兔头，这是很多成都人最爱的小吃。';
  const W = (text: string, pinyin = '') => ({ text, pinyin, gloss: '' });
  const CHENGDU_WORDS: ReaderWord[] = [
    W('胆子', 'dǎnzi'), W('大', 'dà'), W('的话', 'dehuà'), W('，'), W('可以', 'kěyǐ'), W('试试', 'shìshi'), W('麻辣', 'málà'), W('兔头', 'tùtóu'), W('，'),
    W('这', 'zhè'), W('是', 'shì'), W('很多', 'hěn duō'), W('成都', 'Chéngdū'), W('人', 'rén'), W('最', 'zuì'), W('爱', 'ài'), W('的', 'de'), W('小吃', 'xiǎochī'), W('。'),
  ];

  it("Jerome's take: 成都 heard as 程度 — one row, both in pinyin, the reasons in words; a tap on 成都 (page or row) opens the explorer; ▶ plays the page's word", async () => {
    harness.text = CHENGDU;
    harness.words = CHENGDU_WORDS;
    await act(async () => root.render(<MemoryRouter><ExplorerProvider><Harness /></ExplorerProvider></MemoryRouter>));
    await flush();
    await click(q('reader-read-aloud'));
    await act(async () => fake.current!.land('胆子大的话，可以试试麻辣兔头，这是很多程度人最爱的小吃。'));
    await flush();
    expect(q('reader-read-aloud-line')?.textContent).toBe('✓ 96% — 1 to check');
    const rows = [...host.querySelectorAll<HTMLElement>('[data-testid="reader-read-aloud-diff"]')];
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.dataset.kind).toBe('tone');
    expect([...row.querySelectorAll('.ra-diff-zh')].map((e) => e.textContent)).toEqual(['成都', '程度']);
    expect([...row.querySelectorAll('.ra-diff-py')].map((e) => e.textContent)).toEqual(['chéngdū', 'chéngdù']);
    expect(row.querySelector('.ra-diff-kind')?.textContent).toBe('Tone');
    expect([...row.querySelectorAll('.ra-diff-reasons li')].map((e) => e.textContent)).toEqual([
      '成 chéng — sounded right (written 程)',
      '都 dū → you said dù (4th tone instead of 1st)',
    ]);

    // A tap on the marked word on the page opens the language explorer, like any word chip.
    const chip = [...host.querySelectorAll('.reader-word-chip')].find((c) => c.textContent === '成都')!;
    await click(chip);
    expect(track).toHaveBeenCalledWith('explorer.open', { source: 'reader', kind: 'word' });
    expect(row.classList.contains('is-lit')).toBe(false);

    // The row's words open it too: the page's word (what he meant to say) and what was heard.
    track.mockClear();
    await click(row.querySelector('[data-testid="reader-read-aloud-diff-page"]'));
    expect(track).toHaveBeenCalledWith('reader.read_aloud_diff', { action: 'open_page_word', kind: 'tone' });
    expect(track).toHaveBeenCalledWith('explorer.open', { source: 'read_aloud', kind: 'word' });
    track.mockClear();
    await click(row.querySelector('[data-testid="reader-read-aloud-diff-heard"]'));
    expect(track).toHaveBeenCalledWith('reader.read_aloud_diff', { action: 'open_heard_word', kind: 'tone' });
    expect(track).toHaveBeenCalledWith('explorer.open', { source: 'read_aloud', kind: 'word' });

    await click(row.querySelector('[data-testid="reader-read-aloud-diff-play"]'));
    expect(speak).toHaveBeenCalledWith('成都');

    // "You said" marks the transcript too: 度 tone off, 程 a homophone (unmarked).
    await click(q('reader-read-aloud-said-toggle'));
    const said = q('reader-read-aloud-said')!;
    expect(said.textContent).toBe('胆子大的话，可以试试麻辣兔头，这是很多程度人最爱的小吃。');
    expect([...said.querySelectorAll<HTMLElement>('.ra-char')].map((e) => `${e.textContent}:${e.dataset.mark}`)).toEqual(['度:close']);
  });

  it('stopped early: the unread rest has no marks or rows, the line says so, no confetti', async () => {
    await click(q('reader-read-aloud'));
    await act(async () => fake.current!.land('早上好。我叫'));
    await flush();
    expect(markOf('叫')).toBe('ok');
    expect(markOf('徐')).toBe('unread');
    expect(host.querySelectorAll('.ra-char.ra-missed')).toHaveLength(0);
    expect(q('reader-read-aloud-line')?.textContent).toBe('✓ 100% — right so far · stopped early');
    expect(q('reader-read-aloud-legend')).toBeNull();
    expect(q('reader-read-aloud-diffs')).toBeNull();
    expect(q('perfect-takes')?.textContent).toBe('0');
    expect(track).toHaveBeenCalledWith('reader.read_aloud', { result_bucket: 'all', chars: 5, via: 'live', all_right: false });
  });

  it('missed, extra and homophone rows', async () => {
    await click(q('reader-read-aloud'));
    // Skipped 早上, said 许 for 徐, added 呀 at the end.
    await act(async () => fake.current!.land('好。我叫小许呀'));
    await flush();
    const rows = [...host.querySelectorAll<HTMLElement>('[data-testid="reader-read-aloud-diff"]')];
    expect(rows.map((r) => r.dataset.kind)).toEqual(['missed', 'tone', 'extra']);
    expect(rows[0].querySelector('.ra-diff-reasons')?.textContent).toContain('missed 早 zǎo');
    expect(rows[2].querySelector('.ra-diff-reasons')?.textContent).toBe('extra 呀 ya');
  });
});
