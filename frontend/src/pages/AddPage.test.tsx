/**
 * The ＋ Add tab never records by itself (Jerome, Nov 2026: "Go to the plus sign and have to click to start
 * recording, as opposed to it automatically happening"). Opening the page starts no take; only the tap on 🎤 Say it /
 * 🗣 In English opens the box listening — once, for that tap; ✏️ Type it never listens.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const say = vi.fn();
vi.mock('../hooks/useVoiceDictation', () => ({
  useVoiceDictation: () => ({
    state: { mode: 'voice', phase: 'idle', blocked: null },
    finalText: '',
    partialText: '',
    canSubmit: false,
    say: () => say(),
    stop: vi.fn(),
    cancel: vi.fn(),
    retake: vi.fn(),
    retryUpload: vi.fn(),
    edit: vi.fn(),
    type: vi.fn(),
    submit: vi.fn(),
  }),
}));
vi.mock('../components/voice/VoiceTextInput', () => ({
  VoiceTextInputView: (p: { testId?: string }) => <div data-testid={p.testId ?? 'voice-input'} />,
}));
vi.mock('../services/analytics', () => ({ track: vi.fn(), trackError: vi.fn() }));
vi.mock('../services/chineseSegmenter', () => ({ preloadSegmenter: vi.fn(), useSegmentedWords: () => null }));
vi.mock('../contexts/NetworkContext', () => ({ useNetwork: () => ({ isOnline: true }) }));
vi.mock('../components/explorer/ExplorerContext', () => ({ useExplorer: () => ({ open: vi.fn() }) }));
vi.mock('../services/askClaudeLanguage', () => ({ useAskLanguage: () => ['zh', vi.fn()] }));
vi.mock('../services/claudeThreads', () => ({ startClaudeThread: vi.fn() }));
vi.mock('../db/database', () => ({ db: {} }));
vi.mock('../api/add', () => ({ englishWords: vi.fn(), getLessonRequest: vi.fn(), readPhotoWords: vi.fn(), requestLesson: vi.fn() }));
vi.mock('../api/client', () => ({ generateDeck: vi.fn(), generateGradedReader: vi.fn() }));
vi.mock('../api/audioLessons', () => ({ createAudioLesson: vi.fn() }));
vi.mock('../api/clips', () => ({ generateClips: vi.fn() }));
vi.mock('../api/pictureHunts', () => ({ createPictureHunt: vi.fn() }));
vi.mock('../services/chatMedia', () => ({ compressPhoto: vi.fn() }));

import { AddPage } from './AddPage';

describe('AddPage — nothing records until he taps 🎤', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    say.mockReset();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const mount = async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/add']}>
          <AddPage />
        </MemoryRouter>,
      );
    });
  };
  const click = async (testId: string) => {
    await act(async () => (host.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement).click());
  };

  it('opening the tab starts no take and shows no voice box', async () => {
    await mount();
    expect(host.querySelector('[data-testid="add-page"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="add-word-input"]')).toBeNull();
    expect(say).not.toHaveBeenCalled();
  });

  it('✏️ Type it never listens', async () => {
    await mount();
    await click('add-method-type');
    expect(host.querySelector('[data-testid="add-word-input"]')).toBeTruthy();
    expect(say).not.toHaveBeenCalled();
  });

  it('the tap on 🎤 Say it starts listening once; opening the tab again starts nothing', async () => {
    await mount();
    await click('add-method-say_zh');
    expect(say).toHaveBeenCalledTimes(1);
    // Leave the tab and come back: a fresh page, nothing records.
    act(() => root.unmount());
    root = createRoot(host);
    await mount();
    expect(say).toHaveBeenCalledTimes(1);
  });
});
