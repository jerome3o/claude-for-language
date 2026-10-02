import { describe, it, expect } from 'vitest';
import { liveBackoffMs, parseLiveFrame } from './chatLive';
import { baseMime, pickRecorderMime } from './chatMedia';

describe('chat live', () => {
  it('backs off 1 s → 30 s with jitter', () => {
    expect(liveBackoffMs(1, () => 0.5)).toBe(1000);
    expect(liveBackoffMs(3, () => 0.5)).toBe(4000);
    expect(liveBackoffMs(20, () => 0.5)).toBe(30000);
    expect(liveBackoffMs(1, () => 0)).toBe(800);
    expect(liveBackoffMs(1, () => 1)).toBe(1200);
  });

  it('parses known frames and drops the rest', () => {
    expect(parseLiveFrame('{"type":"typing","conversation_id":"c","user_id":"u"}')).toEqual({ type: 'typing', conversation_id: 'c', user_id: 'u' });
    expect(parseLiveFrame('{"type":"message","message":{"id":"m"}}')?.type).toBe('message');
    expect(parseLiveFrame('{"type":"message","message":{}}')).toBeNull();
    expect(parseLiveFrame('{"type":"read","conversation_id":"c","user_id":"u","last_read_at":"t"}')?.type).toBe('read');
    expect(parseLiveFrame('{"type":"nope"}')).toBeNull();
    expect(parseLiveFrame('not json')).toBeNull();
    expect(parseLiveFrame(42)).toBeNull();
  });
});

describe('chat media helpers', () => {
  it('picks the first recorder type the browser supports', () => {
    expect(pickRecorderMime((m) => m === 'audio/mp4')).toBe('audio/mp4');
    expect(pickRecorderMime(() => true)).toBe('audio/webm;codecs=opus');
    expect(pickRecorderMime(() => false)).toBe('');
  });
  it('strips codecs', () => {
    expect(baseMime('audio/webm;codecs=opus')).toBe('audio/webm');
    expect(baseMime('')).toBe('');
  });
});
