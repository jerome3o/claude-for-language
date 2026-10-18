/**
 * 梗 Meme review (prototype): the issue page renders a cached / fetched issue, expands a meme
 * (meaning, origin, examples, register, "would you say it?", links out with analytics), runs the
 * quiz (practice only: one analytics event) and starts "Make a mini lesson".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { pinyin } from 'pinyin-pro';
import { SAMPLE_MEME_SEEN_URLS, SAMPLE_MEME_SUBMISSION, validateMemeIssue, type MemeIssueRecord } from '@shared/meme-review';
import { applyYiBuToneChanges } from '@shared/pinyin/toneChange';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const issue = validateMemeIssue(SAMPLE_MEME_SUBMISSION, {
  month: '2026-10',
  today: '2026-10-18',
  seenUrls: SAMPLE_MEME_SEEN_URLS,
  derivePinyin: (t) => (/\p{Script=Han}/u.test(t) ? applyYiBuToneChanges(t, pinyin(t, { toneType: 'symbol', type: 'string', nonZh: 'consecutive' })) : null),
}).issue!;
const record: MemeIssueRecord = { month: '2026-10', status: 'ready', issue, progress: null, error: null, updated_at: null };

const track = vi.fn();
const startMemeLesson = vi.fn();
vi.mock('../services/analytics', () => ({ track: (...a: unknown[]) => track(...a) }));
vi.mock('../services/memeReview', () => ({
  cachedMemeIssue: vi.fn(async () => null),
  fetchMemeIssue: vi.fn(async () => ({ issue: record, lesson: null })),
  memePictureUrl: vi.fn(async (k: string) => `https://api.test/api/audio/${k}`),
  prefetchMemeAudio: vi.fn(),
}));
vi.mock('../api/memeReview', () => ({
  startMemeLesson: (...a: unknown[]) => startMemeLesson(...a),
  getMemeLessonJob: vi.fn(),
}));
vi.mock('../services/ttsCache', () => ({ getTTSWithCache: vi.fn(async () => null) }));
vi.mock('../services/studyBumps', () => ({ findExistingNotes: vi.fn(async () => []) }));
vi.mock('../services/readerWords', () => ({ invalidateKnownHanzi: vi.fn() }));
vi.mock('../hooks/useAudio', () => ({ useTTS: () => ({ speak: vi.fn() }) }));
vi.mock('../utils/audioPlayback', () => ({
  createAudioPlayer: () => ({ claim: () => 1, isCurrent: () => true, play: vi.fn(), stop: vi.fn(), dispose: vi.fn() }),
}));
vi.mock('../contexts/NetworkContext', () => ({ useNetwork: () => ({ isOnline: true }) }));
vi.mock('../components/AddChunkModal', () => ({
  AddChunkModal: (p: { chunk: { hanzi: string; fun_facts?: string } }) => <div data-testid="add-chunk">{p.chunk.hanzi}|{p.chunk.fun_facts}</div>,
}));
vi.mock('../components/bumps/BumpButton', () => ({ BumpButton: () => <button type="button">⚡</button> }));
vi.mock('../components/explorer/ExplorableText', () => ({ ExplorableText: (p: { text: string }) => <span>{p.text}</span> }));
vi.mock('../components/explorer/ExplorerContext', () => ({ useExplorer: () => ({ open: vi.fn() }) }));

describe('MemeIssuePage', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    track.mockReset();
    startMemeLesson.mockReset();
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  async function render() {
    const { MemeIssuePage } = await import('./MemeIssuePage');
    await act(async () =>
      root.render(
        <MemoryRouter initialEntries={['/meme-review/2026-10?from=list']}>
          <Routes>
            <Route path="/meme-review/:month" element={<MemeIssuePage />} />
          </Routes>
        </MemoryRouter>,
      ),
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  const q = (sel: string) => host.querySelector(sel) as HTMLElement | null;
  const all = (sel: string) => Array.from(host.querySelectorAll(sel)) as HTMLElement[];

  it('shows the issue with one collapsed card per meme', async () => {
    await render();
    expect(q('[data-testid="meme-issue-title"]')?.textContent).toBe('示例 · 梗回顾');
    expect(all('[data-testid="meme-card"]')).toHaveLength(6);
    expect(q('[data-testid="meme-card-body"]')).toBeNull();
    expect(track).toHaveBeenCalledWith('meme_review.open', { source: 'list', cached: false, items: 6 });
  });

  it('expands a meme: meaning, origin, examples, register, the verdict and links out', async () => {
    await render();
    await act(async () => (all('.meme-card-toggle')[0]).click());
    const body = q('[data-testid="meme-card-body"]')!;
    expect(body.textContent).toContain('时髦不时髦');
    expect(body.textContent).toContain('travel vlogger');
    expect(body.textContent).toContain('这家咖啡店好City啊！');
    expect(q('[data-testid="meme-verdict"]')?.textContent).toContain('😊 Cute from you');
    const media = all('[data-testid="meme-link-media"]');
    expect(media.map((a) => a.textContent)).toEqual([expect.stringContaining('▶ Watch on Bilibili'), expect.stringContaining('▶ Watch on YouTube')]);
    expect(media[1].querySelector('img')?.getAttribute('src')).toBe('https://img.youtube.com/vi/sampleVid01/hqdefault.jpg');
    expect(media[0].getAttribute('target')).toBe('_blank');
    expect(track).toHaveBeenCalledWith('meme_review.item_open', { item: 'm1', position: 1 });
    await act(async () => media[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
    expect(track).toHaveBeenCalledWith('meme_review.link_out', { link: 'media', kind: 'video', platform: 'bilibili' });
    await act(async () => (q('[data-testid="meme-add-card"]')!).click());
    // The sheet is a portal on document.body: the meme with its card-standard explanation.
    expect(document.querySelector('[data-testid="add-chunk"]')?.textContent).toContain('City不City|');
    expect(document.querySelector('[data-testid="add-chunk"]')?.textContent).toContain('Would you say it?');
  });

  it('runs the quiz (practice only) and starts a mini lesson', async () => {
    await render();
    for (const question of all('[data-testid="meme-quiz-question"]')) {
      await act(async () => (question.querySelector('.meme-quiz-option') as HTMLButtonElement).click());
    }
    expect(q('[data-testid="meme-quiz-score"]')?.textContent).toMatch(/\/ 4/);
    expect(track).toHaveBeenCalledWith('meme_review.quiz_finish', expect.objectContaining({ total: 4 }));
    startMemeLesson.mockResolvedValueOnce({ job: { id: 'j1', month: '2026-10', status: 'generating', lesson_id: null, error: null, created_at: null } });
    await act(async () => (q('[data-testid="meme-make-lesson"]')!).click());
    expect(startMemeLesson).toHaveBeenCalledWith('2026-10');
    expect(q('[data-testid="meme-lesson"]')?.textContent).toContain('Claude is writing your mini lesson');
  });
});
