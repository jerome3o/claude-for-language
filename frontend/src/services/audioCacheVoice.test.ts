import { afterEach, describe, expect, it, vi } from 'vitest';
import { cancelSpeakFallback, pickChineseVoiceFrom, speakFallback, speakWithBrowserTTS } from './audioCache';

const voices = [
  { name: 'Google US English', lang: 'en-US', localService: true },
  { name: 'Microsoft Tracy - Chinese (Hong Kong)', lang: 'zh-HK', localService: true },
  { name: 'Microsoft Kangkang - Chinese (Simplified, PRC)', lang: 'zh-CN', localService: true },
  { name: 'Microsoft Huihui - Chinese (Simplified, PRC)', lang: 'zh-CN', localService: true },
  { name: 'cmn-cn-x-cce-local', lang: 'zh-CN', localService: false },
];

describe('pickChineseVoiceFrom', () => {
  it('picks a mainland Mandarin voice of the asked gender', () => {
    expect(pickChineseVoiceFrom(voices, 'male')?.name).toMatch(/Kangkang/);
    expect(pickChineseVoiceFrom(voices, 'female')?.name).toMatch(/Huihui/);
  });

  it('falls back to any zh-CN voice, never a non-Chinese one', () => {
    expect(pickChineseVoiceFrom(voices.filter((v) => !/Kangkang/.test(v.name)), 'male')?.lang).toBe('zh-CN');
    expect(pickChineseVoiceFrom([voices[0]], 'male')).toBeUndefined();
  });
});

describe('speakFallback — the one device-voice fallback', () => {
  class FakeUtterance {
    lang = '';
    rate = 1;
    voice: unknown = null;
    onstart: (() => void) | null = null;
    onend: (() => void) | null = null;
    onerror: ((e: { error: string }) => void) | null = null;
    constructor(public text: string) {}
  }
  function install(fail = false) {
    const spoken: FakeUtterance[] = [];
    const synth = {
      cancel: vi.fn(),
      getVoices: () => voices,
      speak: (u: FakeUtterance) => {
        spoken.push(u);
        u.onstart?.();
        if (fail) u.onerror?.({ error: 'synthesis-failed' });
        else u.onend?.();
      },
    };
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
    return { spoken, synth };
  }
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as { speechSynthesis?: unknown }).speechSynthesis;
  });

  it("cancels what was being said, then speaks in a Chinese voice of the speaker's gender", async () => {
    const { spoken, synth } = install();
    const onStart = vi.fn();
    await speakFallback('你好', { gender: 'male', onStart });
    expect(synth.cancel).toHaveBeenCalled();
    expect(spoken[0].text).toBe('你好');
    expect(spoken[0].lang).toBe('zh-CN');
    expect((spoken[0].voice as { name: string }).name).toMatch(/Kangkang/);
    expect(onStart).toHaveBeenCalled();
    await speakWithBrowserTTS('好', 'female');
    expect((spoken[1].voice as { name: string }).name).toMatch(/Huihui/);
  });

  it('rejects when the utterance fails or the device has no voice (the Android WebView)', async () => {
    install(true);
    await expect(speakFallback('你好')).rejects.toThrow('synthesis-failed');
    delete (window as { speechSynthesis?: unknown }).speechSynthesis;
    await expect(speakFallback('你好')).rejects.toThrow(/not supported/);
    expect(() => cancelSpeakFallback()).not.toThrow();
  });
});
