import { describe, it, expect, vi } from 'vitest';
import initSqlJs from 'sql.js';
import { resolveAudio, audioRefKey, blobToMedia } from './media';
import { ttsCacheKey } from '../ttsCache';
import type { AudioRef } from './sources';

const MP3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]);

// The browser loader imports the .wasm as a Vite asset; under vitest use the
// Node build of sql.js instead.
vi.mock('./sqljs-loader', () => ({ loadSqlJs: () => initSqlJs() }));

// Blobs don't survive fake-indexeddb's structured clone under happy-dom, so
// stand in for the IndexedDB audio cache: one clip cached, everything else not.
vi.mock('../audioCache', async importOriginal => {
  const actual = await importOriginal<typeof import('../audioCache')>();
  return {
    ...actual,
    getCachedAudio: async (key: string) =>
      key === ttsCacheKey('咖啡') ? new Blob([MP3], { type: 'audio/mpeg' }) : null,
  };
});

import { exportLessonToAnki, readApkg, apkgFilename } from './index';

describe('resolveAudio', () => {
  it('dedupes refs by key, names files by content hash, counts misses', async () => {
    const refs: AudioRef[] = [
      { kind: 'r2', key: 'generated/a.mp3' },
      { kind: 'r2', key: 'generated/a.mp3' },
      { kind: 'tts', text: '你好' },
      { kind: 'reader-page', pageId: 'p1', text: '小猫' },
      { kind: 'r2', key: 'generated/missing.mp3' },
    ];
    const seen: string[] = [];
    const progress: Array<[number, number]> = [];
    const { files, missing } = await resolveAudio(refs, {
      onProgress: (d, t) => progress.push([d, t]),
      load: async ref => {
        seen.push(audioRefKey(ref));
        if (ref.kind === 'r2' && ref.key.includes('missing')) return null;
        if (ref.kind === 'reader-page') throw new Error('boom');
        return new Blob([MP3], { type: 'audio/mpeg' });
      },
    });
    expect(seen).toHaveLength(4); // duplicate r2 ref loaded once
    expect(missing).toBe(2);
    expect(files.size).toBe(2);
    const a = files.get('generated/a.mp3')!;
    expect(a.filename).toMatch(/^[0-9a-f]{20}\.mp3$/);
    expect(files.get(ttsCacheKey('你好'))!.filename).toBe(a.filename); // same bytes → same file
    expect(progress[0]).toEqual([0, 4]);
    expect(progress.at(-1)).toEqual([4, 4]);
  });

  it('picks an extension from the blob type', async () => {
    expect((await blobToMedia(new Blob([MP3], { type: 'audio/wav' }))).filename).toMatch(/\.wav$/);
    expect((await blobToMedia(new Blob([MP3], { type: '' }))).filename).toMatch(/\.mp3$/);
  });
});

describe('exportLessonToAnki (offline, cache-backed)', () => {
  it('bundles cached clips, reports missing ones and still builds the file', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true, writable: true });

    const progress: string[] = [];
    const result = await exportLessonToAnki(
      {
        title: 'Cafe: basics?',
        sections: [{ exercises: [
          { type: 'match', pairs: [{ hanzi: '咖啡', pinyin: 'kāfēi', english: 'coffee' }, { hanzi: '茶', english: 'tea' }] },
          { type: 'note', sentences: [{ hanzi: '我要一杯咖啡。', english: 'I want a coffee.' }] },
        ] }],
      },
      { sourceId: 'L1', onProgress: p => progress.push(p.stage) },
    );

    expect(result.filename).toBe('Lessons-Cafe-basics.apkg');
    expect(result.stats).toMatchObject({ notes: 3, audioIncluded: 1, audioMissing: 2 });
    // 咖啡 has audio → 3 cards; 茶 has none → 2; the sentence → 1
    expect(result.stats.cards).toBe(6);
    expect(result.stats.bytes).toBe(result.blob.size);
    expect(progress[0]).toBe('audio');
    expect(progress.at(-1)).toBe('building');

    const sql = await initSqlJs();
    const { db, media, files } = await readApkg(new Uint8Array(await result.blob.arrayBuffer()), sql);
    try {
      expect(Object.values(media)).toHaveLength(1);
      expect(Array.from(Object.values(files)[0])).toEqual(Array.from(MP3));
      const rows = db.exec('SELECT flds FROM notes ORDER BY id')[0].values.map(r => (r[0] as string).split(''));
      expect(rows[0][3]).toBe(`[sound:${Object.values(media)[0]}]`);
      expect(rows[1][3]).toBe('');
      expect(rows[2][3]).toBe(''); // sentence model: Audio is its 4th field too
    } finally {
      db.close();
    }
  });

  it('skips audio entirely when includeAudio is false', async () => {
    const result = await exportLessonToAnki(
      { title: 'T', sections: [{ exercises: [{ type: 'match', pairs: [{ hanzi: '茶', english: 'tea' }] }] }] },
      { includeAudio: false },
    );
    expect(result.stats).toMatchObject({ notes: 1, cards: 2, audioIncluded: 0, audioMissing: 0 });
  });
});

describe('apkgFilename', () => {
  it('slugs deck names', () => {
    expect(apkgFilename('Readers::小猫的一天')).toBe('Readers-xiao-mao-de-yi-tian.apkg');
    expect(apkgFilename('HSK 1 · Greetings')).toBe('HSK-1-Greetings.apkg');
    expect(apkgFilename('  ')).toBe('anki-export.apkg');
    expect(apkgFilename('a/b:c*d')).toBe('a-b-c-d.apkg');
    expect(apkgFilename('小猫')).toBe('xiao-mao.apkg');
  });
});
