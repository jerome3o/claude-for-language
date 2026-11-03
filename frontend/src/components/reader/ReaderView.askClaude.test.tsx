/**
 * 📖 Ask Claude about this page (components/reader/ReaderView.tsx → claude/ContextClaudeSheet.tsx): the
 * 💬 in the reading view opens the page's Claude thread with the reader context — the page, and the
 * words of the reader word recap's run on that page (tapped / read aloud wrong).
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

// The sheet itself (tested in ContextClaudeSheet.test.tsx): what it was opened with.
vi.mock('../claude/ContextClaudeSheet', () => ({
  default: (p: { context: unknown; fields: unknown; onResolved?: (r: boolean) => void }) => {
    p.onResolved?.(false);
    return <div data-testid="context-claude-sheet" data-context={JSON.stringify(p.context)} data-fields={JSON.stringify(p.fields)} />;
  },
}));

import { MemoryRouter } from 'react-router-dom';
import { recapDb } from '../../services/wordRecap';
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
const q = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });

beforeEach(async () => {
  await recapDb().runs.clear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  track.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function render(initialPage = 0) {
  await act(async () => root.render(
    <MemoryRouter>
      <ExplorerProvider>
        <ReaderView reader={READER} source="library" initialPage={initialPage} topbarStart={<span />} topbarEnd={<span />} isFinishing={false} onFinish={vi.fn()} />
      </ExplorerProvider>
    </MemoryRouter>,
  ));
  await flush();
}

describe('📖 Ask Claude about this page', () => {
  it("opens the page's Claude thread with the words he looked up / misread on THIS page in this reading", async () => {
    await recapDb().runs.put({
      reader_id: 'r1', started_at: '2026-11-03T10:00:00Z', finished_at: null, recapped_at: null, answers: [], words: [
        { hanzi: '游泳', pinyin: 'yóuyǒng', gloss: 'swim', sentence: '他在游泳。', page_english: '', page: 1, pos: 2, reasons: ['tapped'], said: [], at: '2026-11-03T10:01:00Z' },
        { hanzi: '小徐', pinyin: '', gloss: '', sentence: '', page_english: '', page: 0, pos: 6, reasons: ['tapped'], said: [], at: '2026-11-03T10:00:30Z' },
      ],
    } as never);
    await render(1);
    expect(q('study-reader-page-label')?.textContent).toContain('Page 2 of 2');
    await act(async () => q('reader-ask-claude')!.click());
    for (let i = 0; i < 30 && !q('context-claude-sheet'); i++) await flush();
    const sheet = q('context-claude-sheet')!;
    expect(JSON.parse(sheet.dataset.context!)).toEqual({ kind: 'reader', reader_id: 'r1', page_id: 'p2', page: 2, looked_up: ['游泳'], label: '小徐' });
    expect(JSON.parse(sheet.dataset.fields!)).toEqual({ looked_up: ['游泳'], said_wrong: null });
    expect(track).toHaveBeenCalledWith('reader.ask_claude', { from: 'toolbar', resumed: false, words: 1 });
  });

  it('no words collected: the page alone', async () => {
    await render(0);
    await act(async () => q('reader-ask-claude')!.click());
    await flush();
    expect(JSON.parse(q('context-claude-sheet')!.dataset.context!)).toEqual({ kind: 'reader', reader_id: 'r1', page_id: 'p1', page: 1, label: '小徐' });
  });
});
