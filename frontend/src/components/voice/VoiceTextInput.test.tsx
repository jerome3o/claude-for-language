/**
 * The voice-first box end to end with a fake microphone and transcriber: 🎤 Say it → ⏹ Stop → the
 * review → ✓ Submit (a spoken answer), ✏️ Edit (into the box, still spoken until changed), ✏️ Type,
 * the never-silent failure, and typing with a reason when speaking is off.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mic = { ok: true, errorName: null as string | null, onStop: null as null | ((b: Blob) => void) };
vi.mock('../../hooks/useAudio', async () => {
  const { useState } = await import('react');
  return {
    useAudioRecorder: () => {
      const [errorName, setErrorName] = useState<string | null>(null);
      return {
        isRecording: false,
        audioBlob: null,
        error: null,
        errorName,
        audioLevel: 0,
        startRecording: async (_d: unknown, hooks: { onStop: (b: Blob) => void }) => {
          if (!mic.ok) { setErrorName(mic.errorName); return false; }
          mic.onStop = hooks.onStop;
          return true;
        },
        stopRecording: () => mic.onStop?.(new Blob(['x'], { type: 'audio/webm' })),
        cancelRecording: () => { mic.onStop = null; },
        clearRecording: () => {},
        restoreRecording: () => {},
      };
    },
  };
});
const upload = vi.fn(async () => ({ text: '我喜欢猫', language: 'zh', provider: 'whisper' }));
vi.mock('../../api/client', () => ({ transcribeAudio: (...a: unknown[]) => (upload as (...x: unknown[]) => unknown)(...a) }));
vi.mock('../../services/liveTranscription', () => ({
  getLiveSession: async () => null,
  liveSessionUnavailable: () => true,
  prefetchLiveSession: () => {},
  resetLiveSessionCache: () => {},
  LiveTranscriber: class {},
}));
const tracked: Array<[string, Record<string, unknown>]> = [];
vi.mock('../../services/analytics', () => ({ track: (name: string, props: Record<string, unknown>) => tracked.push([name, props]) }));
vi.mock('../../utils/autoPinyin', () => ({ devicePinyinLine: (s: string) => (s ? 'wǒ xǐhuan māo' : '') }));

import { VoiceTextInput, type DictatedAnswer } from './VoiceTextInput';

let root: Root;
let host: HTMLDivElement;
const answers: DictatedAnswer[] = [];

function Harness({ online = true, defaultMode }: { online?: boolean; defaultMode?: 'voice' | 'type' }) {
  const [value, setValue] = useState('');
  return (
    <VoiceTextInput surface="test" value={value} onChange={setValue} onSubmit={(a) => answers.push(a)} online={online} defaultMode={defaultMode} placeholder="Type in Chinese…" />
  );
}

const q = (id: string) => host.querySelector(`[data-testid="voice-input-${id}"]`) as HTMLElement | null;
const click = async (id: string) => {
  const el = q(id);
  if (!el) throw new Error(`no ${id} in ${host.innerHTML}`);
  await act(async () => { el.click(); });
  await act(async () => { await Promise.resolve(); });
};
const render = async (ui: React.ReactElement) => { await act(async () => { root.render(ui); }); };

beforeEach(() => {
  mic.ok = true;
  mic.errorName = null;
  answers.length = 0;
  tracked.length = 0;
  upload.mockClear();
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: async () => ({}) }, configurable: true });
  (globalThis as { MediaRecorder?: unknown }).MediaRecorder = class {};
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('VoiceTextInput', () => {
  it('opens in voice: Type · Say it, then listening, the review and a spoken submit', async () => {
    await render(<Harness />);
    expect(host.querySelector('[data-testid="voice-input"]')?.getAttribute('data-mode')).toBe('voice');
    expect(q('type')).not.toBeNull();
    expect(q('text')).toBeNull(); // no keyboard
    await click('say');
    expect(q('stop')).not.toBeNull();
    expect(q('cancel')).not.toBeNull();
    expect(q('live')?.textContent).toContain('Listening');
    await click('stop');
    expect(q('review-text')?.textContent).toBe('我喜欢猫');
    expect(q('review-pinyin')?.textContent).toBe('wǒ xǐhuan māo');
    await click('submit');
    expect(answers).toEqual([{ text: '我喜欢猫', source: 'spoken', transcript: '我喜欢猫', via: 'upload' }]);
    expect(tracked.at(-1)).toEqual(['voice_input.used', expect.objectContaining({ surface: 'test', outcome: 'submitted', via: 'upload' })]);
    // Ready for the next answer, still voice-first.
    expect(q('say')).not.toBeNull();
  });

  it('✏️ Edit puts the transcript in the box: unchanged = spoken, changed = edited', async () => {
    await render(<Harness />);
    await click('say');
    await click('stop');
    await click('edit');
    const box = q('text') as HTMLInputElement;
    expect(box.value).toBe('我喜欢猫');
    await click('submit');
    expect(answers.at(-1)).toEqual({ text: '我喜欢猫', source: 'spoken', transcript: '我喜欢猫' });
  });

  it('🔁 Retry starts a new take; ✏️ Type goes to the keyboard with a 🎤 back', async () => {
    await render(<Harness />);
    await click('say');
    await click('stop');
    await click('retake');
    expect(q('stop')).not.toBeNull();
    await click('cancel');
    await click('type');
    expect(host.querySelector('[data-testid="voice-input"]')?.getAttribute('data-mode')).toBe('type');
    expect(q('mic')).not.toBeNull();
    expect(q('submit')?.getAttribute('aria-disabled')).toBe('true');
  });

  it('never silent: a failed transcription offers the same take again', async () => {
    upload.mockRejectedValueOnce(new Error('502'));
    await render(<Harness />);
    await click('say');
    await click('stop');
    expect(q('retry-upload')?.textContent).toContain('Couldn’t transcribe');
    await click('retry-upload');
    expect(q('review-text')?.textContent).toBe('我喜欢猫');
  });

  it('offline: typing with a reason, no 🎤', async () => {
    await render(<Harness online={false} />);
    expect(host.querySelector('[data-testid="voice-input"]')?.getAttribute('data-mode')).toBe('type');
    expect(q('blocked')?.textContent).toMatch(/Offline/);
    expect(q('mic')).toBeNull();
  });

  it('a blocked microphone falls back to typing, the 🎤 stays to try again', async () => {
    mic.ok = false;
    mic.errorName = 'NotAllowedError';
    await render(<Harness />);
    await click('say');
    expect(q('blocked')?.getAttribute('data-blocked')).toBe('denied');
    expect(q('mic')).not.toBeNull();
  });
});
