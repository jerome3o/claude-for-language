/**
 * Pictures on cards against a REAL SQLite with every migration: asking queues the prompt once,
 * the queue job draws it once and writes it into every note waiting for it (and the students'
 * copies), duplicates and other accounts reuse it, a picture never touches updated_at, failures
 * end as 'failed', uploads replace generated pictures and R2 objects go only when unreferenced.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import {
  deckIllustrateStatus,
  deleteUnreferencedNoteImages,
  ensureNoteImages,
  handleNoteImageMessage,
  illustrateDeck,
  illustrateNewNotes,
  removeNoteImage,
  requestNoteImage,
  setDeckIllustrateNew,
  setUploadedNoteImage,
  type NoteImageMessage,
} from '../note-images';
import { getNotesChangedSince, insertNoteCopy } from '../../db/queries';
import { buildNoteImagePrompt, NOTE_IMAGE_COST_USD } from '@shared/cards/note-image';

function exec(db: SqliteD1, sql: string, ...params: unknown[]) {
  const stmt = db.raw.prepare(sql);
  stmt.run(params as never);
  stmt.free();
}

function fakeBucket() {
  const store = new Map<string, Uint8Array>();
  const deleted: string[] = [];
  const bucket = {
    put: async (key: string, value: Uint8Array | ArrayBuffer) => {
      store.set(key, value instanceof Uint8Array ? value : new Uint8Array(value));
    },
    delete: async (key: string) => {
      store.delete(key);
      deleted.push(key);
    },
  } as unknown as R2Bucket;
  return { bucket, store, deleted };
}

function fakeQueue() {
  const sent: NoteImageMessage[] = [];
  const queue = {
    send: async (m: NoteImageMessage) => { sent.push(m); },
    sendBatch: async (ms: Array<{ body: NoteImageMessage }>) => { for (const m of ms) sent.push(m.body); },
  } as unknown as Queue<NoteImageMessage>;
  return { queue, sent };
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xe1, 0x00, 0x04, 0x45, 0x78, 0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff, 0xd9]);

let db: SqliteD1;
let r2: ReturnType<typeof fakeBucket>;
let q: ReturnType<typeof fakeQueue>;
let env: { DB: D1Database; AUDIO_BUCKET: R2Bucket; IMAGE_QUEUE: Queue<never>; GEMINI_API_KEY: string; E2E_TEST_MODE?: string };
let drawn: string[];
const draw = async (_prompt: string, hash: string) => {
  drawn.push(hash);
  return `note-images/${hash}.png`;
};

const note = (id: string) => db.rows<Record<string, unknown>>('SELECT * FROM notes WHERE id = ?', [id])[0];

beforeEach(async () => {
  db = await createSqliteD1();
  r2 = fakeBucket();
  q = fakeQueue();
  drawn = [];
  env = { DB: db, AUDIO_BUCKET: r2.bucket, IMAGE_QUEUE: q.queue as unknown as Queue<never>, GEMINI_API_KEY: 'key' };
  exec(db, "INSERT INTO users (id, email, name, role) VALUES ('tutor', 't@example.com', 'T', 'tutor'), ('stu', 's@example.com', 'S', 'student'), ('other', 'o@example.com', 'O', 'student')");
  exec(db, "INSERT INTO decks (id, user_id, name) VALUES ('dT', 'tutor', 'Fruit'), ('dS', 'stu', 'Fruit'), ('dO', 'other', 'Mine')");
  exec(db, "INSERT INTO notes (id, deck_id, hanzi, pinyin, english, updated_at) VALUES ('nT', 'dT', '苹果', 'píngguǒ', 'apple', '2026-01-01 00:00:00'), ('nT2', 'dT', '香蕉', 'xiāngjiāo', 'banana', '2026-01-01 00:00:00'), ('nO', 'dO', '苹果', 'píngguǒ', 'apple', '2026-01-01 00:00:00')");
  exec(db, "INSERT INTO tutor_relationships (id, requester_id, recipient_id, requester_role, status) VALUES ('rel', 'tutor', 'stu', 'tutor', 'active')");
  exec(db, "INSERT INTO shared_decks (id, relationship_id, source_deck_id, target_deck_id) VALUES ('sh', 'rel', 'dT', 'dS')");
});

describe('generated pictures', () => {
  it('queues once, draws once, and writes the picture without touching updated_at', async () => {
    const view = await requestNoteImage(env as never, 'tutor', 'nT');
    expect(view).toMatchObject({ image_status: 'pending', image_key: null });
    expect(q.sent).toHaveLength(1);
    expect(q.sent[0].prompt).toBe(buildNoteImagePrompt({ hanzi: '苹果', english: 'apple' }));
    // Asking again while it is being drawn queues nothing more.
    await requestNoteImage(env as never, 'tutor', 'nT');
    expect(q.sent).toHaveLength(1);

    const out = await handleNoteImageMessage(env, q.sent[0], draw);
    expect(out).toMatchObject({ action: 'ack', status: 'ready', applied: 1 });
    const n = note('nT');
    expect(n.image_key).toBe(`note-images/${q.sent[0].hash}.png`);
    expect(n.image_source).toBe('generated');
    expect(n.image_status).toBeNull();
    expect(n.updated_at).toBe('2026-01-01 00:00:00');
    expect(n.image_at).toBeTruthy();

    // The sync picks the note up by image_at.
    const changed = await getNotesChangedSince(db, 'tutor', '2026-06-01 00:00:00');
    expect((changed.results ?? []).map(r => r.id)).toContain('nT');

    // A duplicate message applies the existing picture, never draws again.
    await handleNoteImageMessage(env, q.sent[0], draw);
    expect(drawn).toHaveLength(1);
  });

  it('reuses a drawn picture for the same word in another account (no queue, no cost)', async () => {
    await requestNoteImage(env as never, 'tutor', 'nT');
    await handleNoteImageMessage(env, q.sent[0], draw);
    const view = await requestNoteImage(env as never, 'other', 'nO');
    expect(view).toMatchObject({ image_status: null, image_key: note('nT').image_key });
    expect(q.sent).toHaveLength(1);
  });

  it('Regenerate draws a new picture and deletes the old one when nothing else shows it', async () => {
    await requestNoteImage(env as never, 'tutor', 'nT');
    await handleNoteImageMessage(env, q.sent[0], draw);
    const first = note('nT').image_key as string;
    const view = await requestNoteImage(env as never, 'tutor', 'nT', { regenerate: true });
    // The old picture stays on the card until the new one is drawn.
    expect(view).toMatchObject({ image_status: 'pending', image_key: first });
    expect(q.sent).toHaveLength(2);
    expect(q.sent[1].hash).not.toBe(q.sent[0].hash);
    await handleNoteImageMessage(env, q.sent[1], draw);
    expect(note('nT').image_key).not.toBe(first);
    expect(r2.deleted).toContain(first);
    expect(db.rows('SELECT * FROM note_images WHERE image_key = ?', [first])).toHaveLength(0);
  });

  it('gives up after three attempts: the note says failed', async () => {
    await requestNoteImage(env as never, 'tutor', 'nT');
    const nothing = async () => null;
    expect(await handleNoteImageMessage(env, q.sent[0], nothing)).toEqual({ action: 'retry', delaySeconds: 60 });
    expect(await handleNoteImageMessage(env, q.sent[0], nothing)).toEqual({ action: 'retry', delaySeconds: 120 });
    expect(await handleNoteImageMessage(env, q.sent[0], nothing)).toMatchObject({ action: 'ack', status: 'failed' });
    expect(note('nT').image_status).toBe('failed');
    // Asking again re-queues it.
    await requestNoteImage(env as never, 'tutor', 'nT');
    expect(q.sent).toHaveLength(2);
    expect(note('nT').image_status).toBe('pending');
  });

  it.each([['no key', ''], ['a real key (the E2E workflow has one)', 'real-key']])('E2E_TEST_MODE draws the fake picture inline, with %s', async (_label, key) => {
    const e2e = { ...env, GEMINI_API_KEY: key, E2E_TEST_MODE: 'true' };
    const view = await requestNoteImage(e2e as never, 'tutor', 'nT');
    expect(view?.image_key).toMatch(/^note-images\/[0-9a-f]{32}\.png$/);
    expect(r2.store.has(view!.image_key!)).toBe(true);
    expect(q.sent).toHaveLength(0);
  });

  it('refuses without an image generator, and only for the owner', async () => {
    await expect(ensureNoteImages({ ...env, GEMINI_API_KEY: '' } as never, [note('nT') as never])).rejects.toThrow(/no image generator/);
    expect(await requestNoteImage(env as never, 'stu', 'nT')).toBeNull();
  });
});

describe("students' copies", () => {
  it('a copy made while the picture is being drawn gets it when drawn; later changes follow', async () => {
    await requestNoteImage(env as never, 'tutor', 'nT');
    const copyId = await insertNoteCopy(db, 'dS', note('nT'));
    expect(note(copyId).image_status).toBe('pending');
    await handleNoteImageMessage(env, q.sent[0], draw);
    const key = note('nT').image_key;
    expect(note(copyId).image_key).toBe(key);

    // The tutor uploads her own photo: the copy follows.
    await setUploadedNoteImage(env, 'tutor', 'nT', JPEG);
    const upload = note('nT').image_key as string;
    expect(upload).toMatch(/^note-uploads\/nT-[0-9a-f]{12}\.jpg$/);
    expect(note(copyId).image_key).toBe(upload);
    expect(note(copyId).image_source).toBe('upload');
    // EXIF (APP1) is stripped from the stored photo.
    expect([...r2.store.get(upload)!]).not.toContain(0xe1);
    // The generated picture nothing shows any more is deleted.
    expect(r2.deleted).toContain(key);

    // Removing it takes it off the copy too.
    await removeNoteImage(env, 'tutor', 'nT');
    expect(note(copyId).image_key).toBeNull();
    expect(r2.deleted).toContain(upload);
  });

  it("never replaces a student's own picture, and keeps a key a copy still shows", async () => {
    await setUploadedNoteImage(env, 'tutor', 'nT', JPEG);
    const copyId = await insertNoteCopy(db, 'dS', note('nT'));
    const shared = note('nT').image_key as string;
    // The student puts her own photo on her copy.
    await setUploadedNoteImage(env, 'stu', copyId, JPEG);
    const mine = note(copyId).image_key;
    expect(mine).not.toBe(shared);
    // The tutor's key is now only hers.
    await setUploadedNoteImage(env, 'tutor', 'nT', JPEG);
    expect(note(copyId).image_key).toBe(mine);
    expect(r2.deleted).toContain(shared);

    // A key a copy still shows survives the tutor removing hers.
    const copy2 = await insertNoteCopy(db, 'dS', note('nT2'));
    await setUploadedNoteImage(env, 'tutor', 'nT2', JPEG);
    const k2 = note('nT2').image_key as string;
    expect(note(copy2).image_key).toBe(k2);
    exec(db, 'DELETE FROM shared_decks');
    await removeNoteImage(env, 'tutor', 'nT2');
    expect(note(copy2).image_key).toBe(k2);
    expect(r2.deleted).not.toContain(k2);
    expect(await deleteUnreferencedNoteImages(env, [k2])).toBe(0);
  });
});

describe('decks', () => {
  it('Illustrate this deck: estimate first, then every card without a picture is asked for', async () => {
    const before = await deckIllustrateStatus(env as never, 'tutor', 'dT');
    expect(before).toMatchObject({ total: 2, with_image: 0, missing: 2, pending: 0, illustrate_new: false, available: true });
    expect(before!.estimate.usd).toBeCloseTo(2 * NOTE_IMAGE_COST_USD);
    const res = await illustrateDeck(env as never, 'tutor', 'dT');
    expect(res).toMatchObject({ pending: 2, queued: 2 });
    expect(res!.status).toMatchObject({ pending: 2, missing: 0 });
    for (const m of q.sent) await handleNoteImageMessage(env, m, draw);
    expect(await deckIllustrateStatus(env as never, 'tutor', 'dT')).toMatchObject({ with_image: 2, pending: 0, missing: 0 });
    // Pressing it again draws nothing.
    expect(await illustrateDeck(env as never, 'tutor', 'dT')).toMatchObject({ pending: 0, queued: 0 });
    expect(await deckIllustrateStatus(env as never, 'stu', 'dT')).toBeNull();
  });

  it('"Illustrate new cards" is off by default and per deck', async () => {
    await illustrateNewNotes(env as never, 'tutor', 'dT', ['nT']);
    expect(q.sent).toHaveLength(0);
    expect(await setDeckIllustrateNew(db, 'tutor', 'dT', true)).toBe(true);
    await illustrateNewNotes(env as never, 'tutor', 'dT', ['nT']);
    expect(q.sent).toHaveLength(1);
    expect(await setDeckIllustrateNew(db, 'stu', 'dT', true)).toBeNull();
  });
});
