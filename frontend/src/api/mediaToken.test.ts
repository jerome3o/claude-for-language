import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { PRIVATE_MEDIA_PREFIXES } from '@shared/media/access';
import { getMediaToken, mediaTokenRefreshDue, setMediaToken, withMediaCredential } from './mediaToken';
import { API_BASE, getAudioUrl, getReaderImageUrl } from './client';

const DAY = 24 * 3600 * 1000;

describe('media token (private recordings / photos, docs/AUDIO.md "Private media")', () => {
  beforeEach(() => setMediaToken(null));

  it('only private keys carry the token; generated clips stay plain public URLs', () => {
    setMediaToken({ token: 'tok.sig', expires_at: new Date(Date.now() + 3 * DAY).toISOString() });
    expect(getAudioUrl('recordings/ev-1.webm')).toBe(API_BASE + '/api/audio/recordings/ev-1.webm?mt=tok.sig');
    expect(getReaderImageUrl('note-uploads/n-1.jpg')).toBe(API_BASE + '/api/audio/note-uploads/n-1.jpg?mt=tok.sig');
    expect(getAudioUrl('generated/n-1_a.mp3')).toBe(API_BASE + '/api/audio/generated/n-1_a.mp3');
    expect(getReaderImageUrl('reader-images/p.png')).toBe(API_BASE + '/api/audio/reader-images/p.png');
  });

  it('an expired token is not used; refresh is due with under 2 days left', () => {
    setMediaToken({ token: 'old', expires_at: new Date(Date.now() - 1000).toISOString() });
    expect(getMediaToken()).toBeNull();
    expect(withMediaCredential('/api/audio/recordings/x.webm', 'recordings/x.webm')).toBe('/api/audio/recordings/x.webm');
    expect(mediaTokenRefreshDue()).toBe(true);
    setMediaToken({ token: 't', expires_at: new Date(Date.now() + 3 * DAY).toISOString() });
    expect(mediaTokenRefreshDue()).toBe(false);
    expect(mediaTokenRefreshDue(Date.now() + 1.5 * DAY)).toBe(true);
  });

  it('survives a reload (localStorage)', () => {
    setMediaToken({ token: 'kept', expires_at: new Date(Date.now() + DAY).toISOString() });
    expect(JSON.parse(localStorage.getItem('media-token-v1')!).token).toBe('kept');
  });

  it("the service worker's audio cache leaves exactly the private prefixes out", () => {
    const config = fs.readFileSync(path.resolve(__dirname, '../../vite.config.ts'), 'utf8');
    const m = /\\\/api\\\/audio\\\/\(([a-z|-]+)\)\\\//.exec(config);
    expect(m, 'private-prefix regex in vite.config.ts').not.toBeNull();
    expect(m![1].split('|').map((p) => `${p}/`).sort()).toEqual([...PRIVATE_MEDIA_PREFIXES].sort());
  });
});
