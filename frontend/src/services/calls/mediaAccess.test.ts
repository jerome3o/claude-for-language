import { describe, expect, it } from 'vitest';
import { acquireMedia, classifyMediaError, detectBrowser, mainProblem, mediaHelp, problemDevice } from './mediaAccess';

const err = (name: string, message = '') => Object.assign(new Error(message), { name });
const CHROME_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const CHROME_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; rv:130.0) Gecko/20100101 Firefox/130.0';
const EDGE = 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Edg/140.0';
const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

describe('classifyMediaError', () => {
  it('tells the kinds of failure apart', () => {
    expect(classifyMediaError(err('NotAllowedError', 'Permission denied'))).toBe('blocked');
    expect(classifyMediaError(err('NotAllowedError', 'Permission denied by system'))).toBe('system');
    expect(classifyMediaError(err('NotAllowedError', 'Permission dismissed'))).toBe('dismissed');
    expect(classifyMediaError(err('NotReadableError', 'Could not start video source'))).toBe('in-use');
    expect(classifyMediaError(err('AbortError'))).toBe('in-use');
    expect(classifyMediaError(err('NotFoundError', 'Requested device not found'))).toBe('no-device');
    expect(classifyMediaError(err('OverconstrainedError'))).toBe('no-device');
    expect(classifyMediaError(err('SecurityError'))).toBe('blocked');
    expect(classifyMediaError(new TypeError('x'))).toBe('insecure');
    expect(classifyMediaError('weird')).toBe('unknown');
  });
});

describe('mediaHelp', () => {
  it('gives Chrome site-settings steps and mentions work computers', () => {
    const h = mediaHelp('blocked', 'both', CHROME_WIN);
    expect(h.title).toMatch(/blocking the camera and microphone/);
    expect(h.steps.join(' ')).toMatch(/address bar/);
    expect(h.steps.join(' ')).toMatch(/work computer/);
    expect(h.canRetry).toBe(true);
  });
  it('points at the OS privacy settings', () => {
    expect(mediaHelp('system', 'camera', CHROME_MAC).steps[0]).toMatch(/Privacy & Security → Camera/);
    expect(mediaHelp('system', 'microphone', CHROME_WIN).steps[0]).toMatch(/Privacy & security → Microphone/);
  });
  it('has browser-specific steps', () => {
    expect(mediaHelp('blocked', 'camera', FIREFOX).steps[0]).toMatch(/crossed-out camera/);
    expect(mediaHelp('blocked', 'camera', SAFARI).steps[0]).toMatch(/Safari/);
    expect(mediaHelp('in-use', 'camera', CHROME_WIN).steps[0]).toMatch(/Teams, Zoom/);
    expect(mediaHelp('insecure', 'both', CHROME_WIN).canRetry).toBe(false);
  });
  it('detects browsers', () => {
    expect([CHROME_WIN, FIREFOX, EDGE, SAFARI].map(detectBrowser)).toEqual(['chrome', 'firefox', 'edge', 'safari']);
  });
});

describe('acquireMedia', () => {
  const track = (kind: string) => ({ kind, stop() {} }) as unknown as MediaStreamTrack;
  class FakeStream {
    constructor(private tracks: MediaStreamTrack[] = []) {}
    getAudioTracks() { return this.tracks.filter((t) => t.kind === 'audio'); }
    getVideoTracks() { return this.tracks.filter((t) => t.kind === 'video'); }
    getTracks() { return this.tracks; }
  }
  (globalThis as unknown as { MediaStream: unknown }).MediaStream = FakeStream;
  const make = (rules: { audio?: Error; video?: Error; both?: Error }) => async (c: MediaStreamConstraints) => {
    if (c.audio && c.video) {
      if (rules.both || rules.audio || rules.video) throw rules.both ?? rules.video ?? rules.audio;
      return new FakeStream([track('audio'), track('video')]) as unknown as MediaStream;
    }
    if (c.audio) {
      if (rules.audio) throw rules.audio;
      return new FakeStream([track('audio')]) as unknown as MediaStream;
    }
    if (rules.video) throw rules.video;
    return new FakeStream([track('video')]) as unknown as MediaStream;
  };

  it('gets both in one go', async () => {
    const r = await acquireMedia({ audio: true, video: true }, {}, make({}));
    expect(r.stream?.getTracks()).toHaveLength(2);
    expect(r.audioProblem).toBeNull();
  });
  it('keeps the mic when the camera is busy', async () => {
    const r = await acquireMedia({ audio: true, video: true }, {}, make({ video: err('NotReadableError') }));
    expect(r.stream?.getAudioTracks()).toHaveLength(1);
    expect(r.videoProblem).toBe('in-use');
    expect(problemDevice(r.audioProblem, r.videoProblem)).toBe('camera');
  });
  it('keeps the camera when the mic is blocked', async () => {
    const r = await acquireMedia({ audio: true, video: true }, {}, make({ audio: err('NotAllowedError') }));
    expect(r.stream?.getVideoTracks()).toHaveLength(1);
    expect(r.audioProblem).toBe('blocked');
  });
  it('returns no stream when both are blocked, and joins can still go ahead', async () => {
    const r = await acquireMedia({ audio: true, video: true }, {}, make({ audio: err('NotAllowedError'), video: err('NotAllowedError') }));
    expect(r.stream).toBeNull();
    expect(mainProblem(r.audioProblem, r.videoProblem)).toBe('blocked');
    expect(problemDevice(r.audioProblem, r.videoProblem)).toBe('both');
  });
  it('falls back to the default device when a remembered one is gone', async () => {
    const seen: MediaStreamConstraints[] = [];
    const gum = async (c: MediaStreamConstraints) => {
      seen.push(c);
      const vid = c.video as MediaTrackConstraints | undefined;
      if (vid && vid.deviceId) throw err('OverconstrainedError');
      if (c.audio && c.video) throw err('OverconstrainedError');
      return new FakeStream([track(c.audio ? 'audio' : 'video')]) as unknown as MediaStream;
    };
    const r = await acquireMedia({ audio: true, video: true }, { videoId: 'gone' }, gum);
    expect(r.stream?.getTracks()).toHaveLength(2);
    expect(r.videoProblem).toBeNull();
  });
  it('reports insecure without mediaDevices', async () => {
    const r = await acquireMedia({ audio: true, video: false }, {}, null);
    expect(r.audioProblem).toBe('insecure');
    expect(r.videoProblem).toBeNull();
  });
});
