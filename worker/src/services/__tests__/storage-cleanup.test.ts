/**
 * R2 clean-up against a REAL SQLite with every migration applied: the "in use"
 * set comes from every key column, only registered collectable prefixes are
 * candidates, unknown prefixes and young objects are never deleted, dry run is
 * the default, and a failed reference query deletes nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach } from 'vitest';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import {
  REFERENCE_SOURCES,
  STORAGE_PREFIXES,
  planStorageCleanup,
  prefixFor,
  referencedKeys,
  runStorageCleanup,
  type BucketObject,
} from '../admin/storage-cleanup';

const NOW = new Date('2026-09-27T12:00:00Z');
const OLD = new Date('2026-08-01T00:00:00Z');
const FRESH = new Date('2026-09-26T00:00:00Z');

function exec(db: SqliteD1, sql: string, ...params: unknown[]) {
  const stmt = db.raw.prepare(sql);
  stmt.run(params as never);
  stmt.free();
}

function fakeBucket(objects: BucketObject[]) {
  const store = new Map(objects.map((o) => [o.key, o]));
  const deleted: string[] = [];
  const bucket = {
    list: async ({ cursor }: { cursor?: string; limit?: number }) => {
      // Two pages, to exercise the cursor loop.
      const all = [...store.values()].sort((a, b) => a.key.localeCompare(b.key));
      const start = cursor ? Number(cursor) : 0;
      const page = all.slice(start, start + 3);
      const next = start + 3;
      return { objects: page, truncated: next < all.length, cursor: String(next) };
    },
    delete: async (keys: string | string[]) => {
      for (const k of Array.isArray(keys) ? keys : [keys]) {
        store.delete(k);
        deleted.push(k);
      }
    },
  } as unknown as R2Bucket;
  return { bucket, deleted, has: (k: string) => store.has(k) };
}

/** One row per kind of stored object the app writes. */
function seed(db: SqliteD1) {
  exec(db, "INSERT INTO users (id, email, name, role, picture_key) VALUES ('u1', 'a@example.com', 'A', 'student', 'avatars/u1/me.jpg')");
  exec(db, "INSERT INTO decks (id, user_id, name) VALUES ('d1', 'u1', 'HSK 1')");
  exec(db, "INSERT INTO notes (id, deck_id, hanzi, pinyin, english, audio_url, sentence_clue, sentence_clue_audio_url) VALUES ('n1', 'd1', '猫', 'māo', 'cat', 'generated/n1_a.mp3', '我有一只猫。', 'generated/n1-sentence_b.mp3')");
  exec(db, "INSERT INTO cards (id, note_id, card_type) VALUES ('c1', 'n1', 'hanzi_to_meaning')");
  exec(db, "INSERT INTO note_sentences (id, note_id, position, hanzi, pinyin, translation, audio_url) VALUES ('s1', 'n1', 0, '猫很可爱。', 'māo hěn kě''ài', 'Cats are cute.', 'generated/s1-sentence_c.mp3')");
  exec(db, "INSERT INTO review_events (id, card_id, user_id, rating, reviewed_at, recording_url) VALUES ('ev1', 'c1', 'u1', 2, '2026-09-01', 'recordings/ev1.webm')");
  exec(db, "INSERT INTO graded_readers (id, user_id, title_chinese, title_english, difficulty_level, source_deck_ids, vocabulary_used) VALUES ('r1', 'u1', '小猫', 'Kitten', 'beginner', '[]', '[]')");
  exec(db, "INSERT INTO reader_pages (id, reader_id, page_number, content_pinyin, content_english, content_chinese, image_url) VALUES ('p1', 'r1', 1, 'p', 'e', '小猫', 'reader-images/p1.png')");
  exec(db, "INSERT INTO lesson_images (prompt_hash, prompt, status, image_key) VALUES ('h1', 'a cat on a mat', 'ready', 'lesson-images/h1.png')");
  // A lesson from before lesson-images/: its picture lives under reader-images/ and only the spec points at it.
  exec(db, `INSERT INTO custom_lessons (id, user_id, title, spec) VALUES ('l1', 'u1', 'Old lesson', '{"sections":[{"exercises":[{"type":"describe_image","image_url":"reader-images/lesson-l1-s0e0.png"}]}]}')`);
}

const objects: BucketObject[] = [
  // Referenced — must survive.
  { key: 'generated/n1_a.mp3', size: 10, uploaded: OLD },
  { key: 'generated/n1-sentence_b.mp3', size: 10, uploaded: OLD },
  { key: 'generated/s1-sentence_c.mp3', size: 10, uploaded: OLD },
  { key: 'reader-images/p1.png', size: 100, uploaded: OLD },
  { key: 'reader-images/lesson-l1-s0e0.png', size: 100, uploaded: OLD },
  { key: 'lesson-images/h1.png', size: 100, uploaded: OLD },
  { key: 'recordings/ev1.webm', size: 5, uploaded: OLD },
  { key: 'avatars/u1/me.jpg', size: 5, uploaded: OLD },
  // Unreferenced but protected / unknown — must survive.
  { key: 'calls/call-9/piece-9.webm', size: 50, uploaded: OLD },
  { key: 'recordings/orphan.webm', size: 5, uploaded: OLD },
  { key: 'voice-samples/v1/Radio_Host.mp3', size: 5, uploaded: OLD },
  { key: 'debug/u1/r1.json', size: 5, uploaded: OLD },
  { key: 'mystery-feature/thing.bin', size: 7, uploaded: OLD },
  { key: 'rootfile.mp3', size: 7, uploaded: OLD },
  // Unreferenced generated content: too recent (kept) and old (collected).
  { key: 'generated/fresh_x.mp3', size: 10, uploaded: FRESH },
  { key: 'generated/gone_y.mp3', size: 10, uploaded: OLD },
  { key: 'reader-images/deleted-page.png', size: 100, uploaded: OLD },
];

describe('storage clean-up', () => {
  let db: SqliteD1;
  beforeEach(async () => {
    db = await createSqliteD1();
    seed(db);
  });

  it('the old clean-up (notes.audio_url + recordings + avatars) would delete sentence clips, reader and lesson images', async () => {
    // Verbatim reference set of the endpoint before this fix, to document the bug.
    const inUse = new Set<string>();
    for (const sql of [
      'SELECT DISTINCT audio_url AS v FROM notes WHERE audio_url IS NOT NULL',
      'SELECT DISTINCT recording_url AS v FROM review_events WHERE recording_url IS NOT NULL',
      'SELECT picture_key AS v FROM users WHERE picture_key IS NOT NULL',
    ]) for (const r of db.rows<{ v: string }>(sql)) inUse.add(r.v);
    const wouldDelete = objects.map((o) => o.key).filter((k) => !inUse.has(k));
    expect(wouldDelete).toEqual(expect.arrayContaining([
      'generated/n1-sentence_b.mp3', 'generated/s1-sentence_c.mp3', 'reader-images/p1.png', 'lesson-images/h1.png', 'calls/call-9/piece-9.webm', 'mystery-feature/thing.bin',
    ]));
  });

  it('applies: deletes only old, unreferenced objects under collectable prefixes', async () => {
    const b = fakeBucket(objects);
    const result = await runStorageCleanup({ DB: db, AUDIO_BUCKET: b.bucket }, { apply: true, now: NOW });
    expect(result.mode).toBe('applied');
    expect(b.deleted.sort()).toEqual(['generated/gone_y.mp3', 'reader-images/deleted-page.png']);
    for (const keep of [
      'generated/n1_a.mp3', 'generated/n1-sentence_b.mp3', 'generated/s1-sentence_c.mp3',
      'reader-images/p1.png', 'reader-images/lesson-l1-s0e0.png', 'lesson-images/h1.png',
      'recordings/ev1.webm', 'recordings/orphan.webm', 'avatars/u1/me.jpg', 'calls/call-9/piece-9.webm',
      'voice-samples/v1/Radio_Host.mp3', 'debug/u1/r1.json', 'generated/fresh_x.mp3',
    ]) expect(b.has(keep), keep).toBe(true);
    expect(result.deleted).toEqual({ count: 2, bytes: 110, failed: 0 });
  });

  it('never deletes a key under an unknown prefix, even old, unreferenced and forced', async () => {
    const b = fakeBucket(objects);
    const result = await runStorageCleanup({ DB: db, AUDIO_BUCKET: b.bucket }, { apply: true, force: true, now: NOW, minAgeDays: 1 });
    expect(b.has('mystery-feature/thing.bin')).toBe(true);
    expect(b.has('rootfile.mp3')).toBe(true);
    expect(result.unknown.objects).toBe(2);
    expect(result.unknown.top_level).toEqual({ 'mystery-feature/': 1, '(root)': 1 });
  });

  it('is a dry run by default: counts and samples per prefix, nothing deleted', async () => {
    const b = fakeBucket(objects);
    const result = await runStorageCleanup({ DB: db, AUDIO_BUCKET: b.bucket }, { now: NOW });
    expect(result.mode).toBe('dry_run');
    expect(b.deleted).toEqual([]);
    expect(result.deletable).toEqual({ count: 2, bytes: 110 });
    const gen = result.prefixes.find((p) => p.prefix === 'generated/')!;
    expect(gen).toMatchObject({ objects: 5, referenced: 3, too_recent: 1, unreferenced: 1, sample_keys: ['generated/gone_y.mp3'] });
    const rec = result.prefixes.find((p) => p.prefix === 'recordings/')!;
    expect(rec).toMatchObject({ collectable: false, unreferenced: 1 });
    expect(result).not.toHaveProperty('keys');
  });

  it('keeps objects younger than the minimum age', () => {
    const plan = planStorageCleanup({
      objects: [{ key: 'generated/a.mp3', size: 1, uploaded: FRESH }, { key: 'generated/b.mp3', size: 1, uploaded: null }],
      references: new Set(),
      now: NOW,
    });
    expect(plan.keys).toEqual([]);
    expect(plan.prefixes.find((p) => p.prefix === 'generated/')!.too_recent).toBe(2);
  });

  it('refuses to apply when more than half of a prefix would go, unless forced', async () => {
    const many: BucketObject[] = Array.from({ length: 30 }, (_, i) => ({ key: `generated/old_${i}.mp3`, size: 1, uploaded: OLD }));
    const b = fakeBucket(many);
    const refused = await runStorageCleanup({ DB: db, AUDIO_BUCKET: b.bucket }, { apply: true, now: NOW });
    expect(refused.mode).toBe('refused');
    expect(refused.warnings[0]).toMatch(/generated\//);
    expect(b.deleted).toEqual([]);
    const forced = await runStorageCleanup({ DB: db, AUDIO_BUCKET: b.bucket }, { apply: true, force: true, now: NOW });
    expect(forced.mode).toBe('applied');
    expect(b.deleted).toHaveLength(30);
  });

  it('deletes nothing when a reference query fails', async () => {
    db.raw.exec('DROP TABLE lesson_images');
    const b = fakeBucket(objects);
    await expect(runStorageCleanup({ DB: db, AUDIO_BUCKET: b.bucket }, { apply: true, now: NOW })).rejects.toThrow(/lesson_images/);
    expect(b.deleted).toEqual([]);
  });
});

describe('storage registry', () => {
  it('maps keys to the longest registered prefix', () => {
    expect(prefixFor('recordings/messages/m1.webm')?.prefix).toBe('recordings/messages/');
    expect(prefixFor('recordings/ev1.webm')?.prefix).toBe('recordings/');
    expect(prefixFor('nope/x')).toBeNull();
  });

  it('reads keys out of URLs, API paths and JSON specs', () => {
    expect(referencedKeys('/api/feature-requests/screenshot/screenshots/u/x.png')).toContain('screenshots/u/x.png');
    expect(referencedKeys('https://app.example/api/audio/generated/a.mp3?v=1')).toContain('generated/a.mp3');
    expect(referencedKeys('{"a":{"image_url":"lesson-images/h.png"},"b":"reader-images/p.png"}').sort()).toEqual(['lesson-images/h.png', 'reader-images/p.png']);
  });

  it('every referencedBy source has a reference query, and collectable prefixes name at least one', () => {
    const sources = new Set(REFERENCE_SOURCES.map((s) => s.source));
    for (const p of STORAGE_PREFIXES) {
      for (const s of p.referencedBy) expect(sources.has(s), `${p.prefix} → ${s}`).toBe(true);
      if (p.collectable) expect(p.referencedBy.length, p.prefix).toBeGreaterThan(0);
    }
  });

  it('registers every R2 key prefix the worker writes', () => {
    // Template-literal keys like `generated/${…}` and the prefix constants.
    const root = path.resolve(__dirname, '../..');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'migrations') walk(full); }
        else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) files.push(full);
      }
    };
    walk(root);
    const found = new Set<string>();
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      for (const m of src.matchAll(/`([a-z][a-z0-9-]*\/)(?:[a-z0-9_-]*\/)?\$\{/g)) found.add(m[1]);
      for (const m of src.matchAll(/(?:PREFIX|Prefix)\s*=\s*'([a-z][a-z0-9-]*)\/?'/g)) found.add(`${m[1]}/`);
    }
    // Template literals that are not R2 keys.
    const NOT_KEYS = new Set(['api/']);
    const registered = new Set(STORAGE_PREFIXES.map((p) => p.prefix));
    const missing = [...found].filter((p) => !NOT_KEYS.has(p) && !registered.has(p));
    expect(missing, 'new R2 prefix: add it to STORAGE_PREFIXES in services/admin/storage-cleanup.ts').toEqual([]);
    expect(found.has('generated/') && found.has('lesson-images/') && found.has('avatars/')).toBe(true);
  });
});
