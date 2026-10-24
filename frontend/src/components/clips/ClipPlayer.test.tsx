/**
 * 🎬 The clip player (web): the first scene shows the hook and the voice caption; the clock
 * moves the clip on; the rail's like / 拼 / mute call back; a double tap bursts a heart, likes
 * and asks for Learn more; a quiz waits for a tap and says whether it was right. And the
 * device's pending events are laid over the server's state (withPendingEvents).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SAMPLE_CLIP, type ClipRecord } from '@shared/clips';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../services/analytics', () => ({ track: vi.fn(), trackError: vi.fn() }));
vi.mock('../../services/chineseSegmenter', () => ({ useSegmentedWords: () => null, preloadSegmenter: () => {} }));
vi.mock('../../services/ttsCache', () => ({ getTTSWithCache: vi.fn(async () => null) }));
vi.mock('../../api/clips', () => ({ listClips: vi.fn(), postClipEvents: vi.fn() }));

import { MemoryRouter } from 'react-router-dom';
import { ExplorerProvider } from '../explorer/ExplorerContext';
import { ClipPlayer, type ClipPlayerProps } from './ClipPlayer';
import { withPendingEvents, DEFAULT_CLIP_PREFS } from '../../services/clips';

const clip: ClipRecord = {
  id: 'c1', status: 'ready', source: 'agent', title: SAMPLE_CLIP.title, topic: '刚 vs 刚才', theme: 'neon', spec: SAMPLE_CLIP,
  images: {}, progress: null, error: null, created_at: '2026-10-24 10:00:00',
  state: { viewed: false, completed: false, liked: false, saved: false, skips: 0 }, lesson: null,
};

let root: Root;
let host: HTMLDivElement;

function render(props: Partial<ClipPlayerProps> = {}) {
  const all: ClipPlayerProps = {
    clip,
    active: true,
    prefs: { ...DEFAULT_CLIP_PREFS, muted: true },
    onPrefs: vi.fn(),
    onLike: vi.fn(),
    onSave: vi.fn(),
    onLearnMore: vi.fn(),
    onComplete: vi.fn(),
    onQuiz: vi.fn(),
    onExplore: vi.fn(),
    ...props,
  };
  act(() =>
    root.render(
      <MemoryRouter>
        <ExplorerProvider>
          <ClipPlayer {...all} />
        </ExplorerProvider>
      </MemoryRouter>,
    ),
  );
  return all;
}

const q = (sel: string) => host.querySelector(sel) as HTMLElement | null;

describe('ClipPlayer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  it('plays: the hook, the caption, then the next scene', () => {
    render();
    expect(q('[data-testid="clip-hook"]')?.textContent).toBe(SAMPLE_CLIP.hook);
    expect(q('[data-testid="clip-caption"]')?.textContent).toContain('刚和刚才，有什么不一样？');
    expect(q('[data-testid="clip-player"]')?.getAttribute('data-theme')).toBe('neon');
    act(() => {
      vi.advanceTimersByTime(2800);
    });
    expect(q('[data-testid="clip-player"]')?.getAttribute('data-scene')).toBe('1');
  });

  it('the rail calls back', () => {
    const p = render();
    act(() => q('[data-testid="clip-like"]')!.click());
    expect(p.onLike).toHaveBeenCalledWith('button');
    act(() => q('[data-testid="clip-toggle-pinyin"]')!.click());
    expect(p.onPrefs).toHaveBeenCalledWith({ pinyin: false, english: true, muted: true }, 'pinyin');
    act(() => q('[data-testid="clip-learn-more"]')!.click());
    expect(p.onLearnMore).toHaveBeenCalledWith('button');
  });

  it('a double tap bursts a heart, likes and opens Learn more', () => {
    const p = render();
    const stage = q('[data-testid="clip-player"]')!;
    const tap = () => {
      act(() => {
        stage.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 300 }));
        stage.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 100, clientY: 300 }));
      });
    };
    tap();
    act(() => {
      vi.advanceTimersByTime(100);
    });
    tap();
    expect(q('[data-testid="clip-heart"]')).not.toBeNull();
    expect(p.onLike).toHaveBeenCalledWith('double_tap');
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(p.onLearnMore).toHaveBeenCalledWith('double_tap');
  });

  it('a quiz waits for the tap and reacts', () => {
    const p = render({ startScene: 4 });
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(q('[data-testid="clip-player"]')?.getAttribute('data-scene')).toBe('4');
    const options = host.querySelectorAll<HTMLButtonElement>('[data-testid="clip-quiz-option"]');
    act(() => options[0].click());
    expect(q('[data-testid="clip-quiz-verdict"]')?.textContent).toBe('✗ Not quite');
    expect(p.onQuiz).toHaveBeenCalledWith(false, false);
    act(() => {
      vi.advanceTimersByTime(2700);
    });
    expect(q('[data-testid="clip-player"]')?.getAttribute('data-scene')).toBe('5');
  });
});

describe('withPendingEvents', () => {
  it('lays the device\'s events over the server state', () => {
    const [out] = withPendingEvents([clip], [
      { clip_id: 'c1', kind: 'view' },
      { clip_id: 'c1', kind: 'like' },
      { clip_id: 'c1', kind: 'save' },
      { clip_id: 'c1', kind: 'unsave' },
      { clip_id: 'other', kind: 'like' },
    ]);
    expect(out.state).toEqual({ viewed: true, completed: false, liked: true, saved: false, skips: 0 });
  });
});
