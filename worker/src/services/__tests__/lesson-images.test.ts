/**
 * Lesson illustrations (services/lesson-images.ts) against real SQLite with
 * every migration: one picture per scene description, queued once, written
 * into every lesson that waits for it (matched by prompt, never by index),
 * retried then marked failed, and the top-up / backfill.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { CustomLessonSpec } from '@shared/lesson';
import { SAMPLE_LESSONS } from '@shared/lesson/samples';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import {
  applyImageToSpec,
  decideEnsure,
  describeImagePrompts,
  ensureLessonImages,
  handleLessonImageMessage,
  lessonImageHash,
  normalizeImagePrompt,
  parseDbTime,
  queueLessonImages,
  sampleImagePrompts,
  topUpLessonImages,
  MAX_IMAGE_ATTEMPTS,
  PENDING_STALE_MS,
  FAILED_RETRY_MS,
  type LessonImageMessage,
} from '../lesson-images';
import type { Env } from '../../types';

const CAFE = 'A small café counter: a barista hands two cups of coffee to a smiling woman';
const PARK = 'A park bench under a willow tree, an old man feeding pigeons';

function spec(...prompts: Array<string | { prompt: string; image_url?: string }>): CustomLessonSpec {
  return {
    title: 'Scenes',
    sections: [{
      exercises: [
        { type: 'choice', question: '你好？', options: ['a', 'b'], correct: 0 },
        ...prompts.map(p => {
          const o = typeof p === 'string' ? { prompt: p } : p;
          return { type: 'describe_image', image_prompt: o.prompt, reference_hanzi: '他在喝咖啡。', ...(o.image_url ? { image_url: o.image_url } : {}) };
        }),
      ],
    }],
  } as unknown as CustomLessonSpec;
}

function exec(db: SqliteD1, sql: string, ...params: unknown[]) {
  const stmt = db.raw.prepare(sql);
  stmt.run(params as never);
  stmt.free();
}

function lessonSpec(db: SqliteD1, id: string): CustomLessonSpec {
  return JSON.parse(db.rows<{ spec: string }>('SELECT spec FROM custom_lessons WHERE id = ?', [id])[0].spec);
}

function imageUrls(s: CustomLessonSpec): Array<string | null | undefined> {
  return s.sections.flatMap(sec => sec.exercises.filter(e => e.type === 'describe_image').map(e => (e as { image_url?: string | null }).image_url));
}

describe('pure helpers', () => {
  it('hashes the normalised prompt (whitespace does not make a second picture)', async () => {
    expect(normalizeImagePrompt('  a  cat\n on a mat ')).toBe('a cat on a mat');
    expect(await lessonImageHash('a cat on a mat')).toBe(await lessonImageHash('  a  cat\n on a mat '));
    expect(await lessonImageHash('a cat on a mat')).not.toBe(await lessonImageHash('a dog on a mat'));
    expect(await lessonImageHash(CAFE)).toMatch(/^[0-9a-f]{32}$/);
  });

  it('lists distinct prompts, optionally only those still missing a picture', () => {
    const s = spec(CAFE, { prompt: PARK, image_url: 'lesson-images/x.png' }, `${CAFE} `);
    expect(describeImagePrompts(s)).toEqual([CAFE, PARK]);
    expect(describeImagePrompts(s, true)).toEqual([CAFE]);
  });

  it('applies a picture by prompt to every waiting exercise, never overwriting one', () => {
    const s = spec(CAFE, PARK, { prompt: CAFE, image_url: 'lesson-images/old.png' });
    expect(applyImageToSpec(s, CAFE, 'lesson-images/new.png')).toBe(1);
    expect(imageUrls(s)).toEqual(['lesson-images/new.png', undefined, 'lesson-images/old.png']);
    expect(applyImageToSpec(s, 'unknown scene', 'k')).toBe(0);
  });

  it('decides ready / pending / re-queue / failed from the row', () => {
    const now = Date.parse('2026-09-27T12:00:00Z');
    const at = (msAgo: number) => new Date(now - msAgo).toISOString().replace('T', ' ').slice(0, 19);
    expect(decideEnsure(null, now)).toBe('queue');
    expect(decideEnsure({ status: 'ready', image_key: 'k', updated_at: at(0) }, now)).toBe('ready');
    expect(decideEnsure({ status: 'pending', image_key: null, updated_at: at(60_000) }, now)).toBe('pending');
    expect(decideEnsure({ status: 'pending', image_key: null, updated_at: at(PENDING_STALE_MS + 1000) }, now)).toBe('queue');
    expect(decideEnsure({ status: 'failed', image_key: null, updated_at: at(60_000) }, now)).toBe('failed');
    expect(decideEnsure({ status: 'failed', image_key: null, updated_at: at(FAILED_RETRY_MS + 1000) }, now)).toBe('queue');
    expect(parseDbTime('2026-09-27 12:00:00')).toBe(now);
  });

  it('knows the catalogue sample prompts', () => {
    const sample = SAMPLE_LESSONS.find(s => s.type === 'describe_image')!;
    expect(sampleImagePrompts()).toContain((sample.spec.sections[0].exercises[0] as { image_prompt: string }).image_prompt);
  });
});

describe('ensure, queue and apply (SQLite)', () => {
  let db: SqliteD1;
  let send: ReturnType<typeof vi.fn>;
  let env: Pick<Env, 'DB' | 'IMAGE_QUEUE' | 'GEMINI_API_KEY'>;

  beforeEach(async () => {
    db = await createSqliteD1();
    send = vi.fn(async () => undefined);
    env = { DB: db, IMAGE_QUEUE: { send } as unknown as Env['IMAGE_QUEUE'], GEMINI_API_KEY: 'g' };
    for (const id of ['tutor', 'student-a', 'student-b']) {
      exec(db, 'INSERT INTO users (id, email, name) VALUES (?, ?, ?)', id, `${id}@x.test`, id);
    }
  });

  function insertLesson(id: string, userId: string, s: CustomLessonSpec) {
    exec(db, 'INSERT INTO custom_lessons (id, user_id, title, spec) VALUES (?, ?, ?, ?)', id, userId, s.title, JSON.stringify(s));
  }

  it('queues a prompt once while it is pending, however many lessons ask', async () => {
    insertLesson('la', 'student-a', spec(CAFE));
    insertLesson('lb', 'student-b', spec(CAFE));
    expect(await queueLessonImages(env, 'la', spec(CAFE))).toBe(1);
    expect(await queueLessonImages(env, 'lb', spec(CAFE))).toBe(1);
    const again = await ensureLessonImages(env, [CAFE, CAFE]);
    expect(again.map(r => r.status)).toEqual(['pending', 'pending']);
    expect(send).toHaveBeenCalledTimes(1);
    const msg = send.mock.calls[0][0] as LessonImageMessage;
    expect(msg).toEqual({ kind: 'lesson_image', hash: await lessonImageHash(CAFE), prompt: CAFE });
    expect(db.rows('SELECT status, attempts FROM lesson_images')).toEqual([{ status: 'pending', attempts: 0 }]);
  });

  it('a generated picture lands in every waiting lesson (by prompt), and a later copy gets it at once', async () => {
    insertLesson('la', 'student-a', spec(CAFE, PARK));
    insertLesson('lb', 'student-b', spec(CAFE));
    await queueLessonImages(env, 'la', spec(CAFE, PARK));
    const cafeMsg = send.mock.calls.map(c => c[0] as LessonImageMessage).find(m => m.prompt === CAFE)!;

    // The tutor edits student-a's copy while the picture is being drawn:
    // the café exercise moves from index 1 to index 2. Matching by prompt
    // still puts it on the café exercise.
    const edited = spec(PARK, CAFE);
    exec(db, 'UPDATE custom_lessons SET spec = ? WHERE id = ?', JSON.stringify(edited), 'la');

    const generate = vi.fn(async (_p: string, fileId: string) => `lesson-images/${fileId}.png`);
    const outcome = await handleLessonImageMessage({ DB: db }, cafeMsg, generate);
    const key = `lesson-images/${cafeMsg.hash}.png`;
    expect(outcome).toEqual({ action: 'ack', status: 'ready', key, applied: 2 });
    expect(imageUrls(lessonSpec(db, 'la'))).toEqual([undefined, key]);
    expect(imageUrls(lessonSpec(db, 'lb'))).toEqual([key]);

    // A copy assigned afterwards: no new job, the picture goes straight in.
    insertLesson('lc', 'student-b', spec(CAFE));
    send.mockClear();
    expect(await queueLessonImages(env, 'lc', spec(CAFE))).toBe(0);
    expect(send).not.toHaveBeenCalled();
    expect(imageUrls(lessonSpec(db, 'lc'))).toEqual([key]);

    // A duplicate delivery doesn't draw again.
    await handleLessonImageMessage({ DB: db }, cafeMsg, generate);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('retries a failed drawing with a growing delay, then marks it failed', async () => {
    await ensureLessonImages(env, [PARK]);
    const msg = send.mock.calls[0][0] as LessonImageMessage;
    const generate = vi.fn(async () => null);
    const outcomes = [];
    for (let i = 0; i < MAX_IMAGE_ATTEMPTS; i++) outcomes.push(await handleLessonImageMessage({ DB: db }, msg, generate));
    expect(outcomes).toEqual([
      { action: 'retry', delaySeconds: 60 },
      { action: 'retry', delaySeconds: 120 },
      { action: 'ack', status: 'failed' },
    ]);
    expect((await ensureLessonImages(env, [PARK]))[0].status).toBe('failed');
    // A thrown error counts as a failed attempt too.
    const thrown = await handleLessonImageMessage({ DB: db }, msg, async () => { throw new Error('429 quota'); });
    expect(thrown).toEqual({ action: 'ack', status: 'failed' });
    expect(db.rows<{ error: string }>('SELECT error FROM lesson_images')[0].error).toBe('429 quota');
  });

  it('a lookup with queue: false never draws (the editor form while typing)', async () => {
    const res = await ensureLessonImages(env, [CAFE], { queue: false });
    expect(res).toEqual([{ prompt: CAFE, status: 'missing', image_url: null }]);
    expect(send).not.toHaveBeenCalled();
    expect(db.rows('SELECT * FROM lesson_images')).toEqual([]);
  });

  it('without an image generator, anything not drawn yet is unavailable (nothing queued)', async () => {
    const res = await ensureLessonImages({ ...env, GEMINI_API_KEY: '' }, [CAFE]);
    expect(res).toEqual([{ prompt: CAFE, status: 'unavailable', image_url: null }]);
    expect(send).not.toHaveBeenCalled();
  });

  it('top-up queues the missing pictures, pre-draws library items + catalogue samples, and writes in ready ones', async () => {
    insertLesson('la', 'student-a', spec(CAFE));
    insertLesson('lz', 'student-b', spec(PARK));
    exec(db, 'INSERT INTO lesson_library (id, owner_id, title, spec) VALUES (?, ?, ?, ?)', 'lib', 'student-a', 'Lib', JSON.stringify(spec('A rainy street market at night')));
    const first = await topUpLessonImages(env, 'student-a');
    const samples = sampleImagePrompts().length;
    expect(first).toMatchObject({ lessons_checked: 1, prompts: 2 + samples, applied: 0, pending: 2 + samples });
    const queued = send.mock.calls.map(c => (c[0] as LessonImageMessage).prompt);
    expect(queued).toContain(CAFE);
    expect(queued).not.toContain(PARK); // another account's lesson: only the admin backfill touches it
    expect(queued).toEqual(expect.arrayContaining(sampleImagePrompts().map(normalizeImagePrompt)));

    // The picture was drawn but the lesson missed it (e.g. edited mid-way): top-up writes it in.
    const hash = await lessonImageHash(CAFE);
    exec(db, "UPDATE lesson_images SET status = 'ready', image_key = ? WHERE prompt_hash = ?", `lesson-images/${hash}.png`, hash);
    const second = await topUpLessonImages(env, 'student-a');
    expect(second.applied).toBe(1);
    expect(imageUrls(lessonSpec(db, 'la'))).toEqual([`lesson-images/${hash}.png`]);

    // The admin backfill covers everyone.
    send.mockClear();
    const all = await topUpLessonImages(env, null);
    expect(all.lessons_checked).toBe(2);
    expect(send.mock.calls.map(c => (c[0] as LessonImageMessage).prompt)).toContain(PARK);
  });
});
