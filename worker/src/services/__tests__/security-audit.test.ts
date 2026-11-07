/**
 * The security audit's small guards (Nov 2026): which R2 keys a note clean-up may delete, the only
 * recording key a review event may carry, the test endpoints answering on a dev server only, and
 * the headers forwarded to a Durable Object.
 */
import { describe, it, expect } from 'vitest';
import { isDeletableNoteAudioKey } from '../tts/clips';
import { ownRecordingKey } from '../audio';
import { isLocalRequest } from '../../routes/test-auth';
import { forwardableHeaders } from '../http/trusted-headers';

describe('isDeletableNoteAudioKey', () => {
  it('a note clip: generated clips and recordings made for a note', () => {
    expect(isDeletableNoteAudioKey('generated/n1_ab12.mp3')).toBe(true);
    expect(isDeletableNoteAudioKey('generated/n1-sentence_x.mp3')).toBe(true);
    expect(isDeletableNoteAudioKey('/api/audio/generated/n1_ab12.mp3')).toBe(true);
    expect(isDeletableNoteAudioKey('recordings/note-1/rec-1.webm')).toBe(true);
  });
  it('never anything else', () => {
    for (const k of [
      'avatars/u1/a.jpg', 'lesson-images/abc.png', 'note-images/h', 'reader-images/r/p.png',
      'recordings/review-1.webm', 'recordings/messages/m1.webm', 'recordings/lessons/a/b.webm',
      'chat-media/c/m.jpg', 'calls/c/p.webm', 'tts-cache/x.mp3', 'generated/../avatars/u1/a.jpg',
      'generated/sub/dir.mp3', 'meme-review/agent/2026-11.json',
    ]) expect(isDeletableNoteAudioKey(k), k).toBe(false);
  });
});

describe('ownRecordingKey', () => {
  it('only the key the upload derives from the event id', () => {
    expect(ownRecordingKey('ev1', 'recordings/ev1.webm')).toBe('recordings/ev1.webm');
    expect(ownRecordingKey('ev1', '/api/audio/recordings/ev1.webm?exp=1&sig=x')).toBe('recordings/ev1.webm');
    expect(ownRecordingKey('ev1', 'https://api.example.com/api/audio/recordings/ev1.webm')).toBe('recordings/ev1.webm');
    expect(ownRecordingKey('ev1', 'recordings/victim.webm')).toBeNull();
    expect(ownRecordingKey('ev1', 'recordings/messages/ev1.webm')).toBeNull();
    expect(ownRecordingKey('ev1', 42)).toBeNull();
    expect(ownRecordingKey('ev1', undefined)).toBeNull();
  });
});

describe('isLocalRequest (test endpoints)', () => {
  it('a dev server only', () => {
    expect(isLocalRequest('http://localhost:8787/api/test/auth')).toBe(true);
    expect(isLocalRequest('http://127.0.0.1:8797/api/test/auth')).toBe(true);
    expect(isLocalRequest('http://10.0.2.2:8787/api/test/auth')).toBe(true);
    expect(isLocalRequest('https://chinese-learning-api.jeromeswannack.workers.dev/api/test/auth')).toBe(false);
    expect(isLocalRequest('https://localhost.evil.com/api/test/auth')).toBe(false);
    expect(isLocalRequest('https://10.0.2.2.nip.io/api/test/auth')).toBe(false);
    expect(isLocalRequest('not a url')).toBe(false);
  });
});

describe('forwardableHeaders', () => {
  it('drops every X-* header the client sent, keeps the WebSocket handshake', () => {
    const raw = new Headers({ Upgrade: 'websocket', 'Sec-WebSocket-Key': 'k', 'X-User-Id': 'someone-else', 'x-user-picture': 'https://evil/p.png', 'X-Instance': 'i' });
    const out = forwardableHeaders(raw);
    expect(out.get('Upgrade')).toBe('websocket');
    expect(out.get('Sec-WebSocket-Key')).toBe('k');
    expect(out.get('X-User-Id')).toBeNull();
    expect(out.get('X-User-Picture')).toBeNull();
    expect(out.get('X-Instance')).toBeNull();
  });
});
