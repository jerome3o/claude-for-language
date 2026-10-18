/**
 * Re-rendering ready story lessons in the current layout (services/audio-lessons/rerender.ts;
 * docs/AUDIO_LESSONS.md "Story" → "Re-rendering") on real SQLite with an in-memory R2: the clips are
 * cut out of the lesson's OWN old file (no translation, no TTS), the new file is byte-for-byte what
 * rendering the new script from those clips gives, the lesson keeps its id / title / dates and gets a
 * new audio version, and the whole thing is idempotent and never touches what it can't finish.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildTimeline,
  compileDialogueLesson,
  compileStoryLesson,
  SAMPLE_DIALOGUE_PLAN,
  SAMPLE_STORY_PLAN,
  ScriptBuilder,
  sleepTranslationText,
  speechKey,
  storySpeakers,
  storyVoiceOf,
  STORY_LAYOUT,
  transcriptRows,
  uniqueSpeech,
  type AudioLessonScript,
  type StoryPlan,
} from '@shared/audio-lesson';
import type { Env } from '../../types';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import * as q from '../../db/audio-lesson-queries';
import { assembleMp3, emptyFrame, frameMs, LESSON_MP3, parseMp3Frames, type AssemblyPart } from '../audio-lessons/mp3';
import { cutClips, queueStoryRerenders, queueStoryRerendersOnce, rerenderStoryLesson } from '../audio-lessons/rerender';
import { runAudioLessonJob } from '../audio-lessons/job';
import type { ClipOutcome, ClipRequest } from '../audio-lessons/synth';

function fakeBucket() {
  const store = new Map<string, Uint8Array>();
  const bucket = {
    async put(key: string, value: Uint8Array | ArrayBuffer) {
      store.set(key, value instanceof Uint8Array ? value : new Uint8Array(value));
    },
    async get(key: string) {
      const v = store.get(key);
      return v ? { arrayBuffer: async () => v.slice().buffer, customMetadata: {}, size: v.length } : null;
    },
    async delete(keys: string | string[]) {
      for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
    },
    async list(opts: { prefix?: string }) {
      return { objects: [...store.keys()].filter((k) => k.startsWith(opts.prefix ?? '')).map((key) => ({ key })), truncated: false };
    },
  };
  return { store, bucket: bucket as unknown as R2Bucket };
}

/** A clip whose every frame carries a marker of its text, a length of its own (so a wrong cut shows). */
function clipFrames(key: string): Uint8Array[] {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  const n = 20 + (h % 37);
  return Array.from({ length: n }, (_, i) => {
    const f = emptyFrame(16, LESSON_MP3);
    f[20] = h & 0xff;
    f[21] = i & 0xff;
    return f;
  });
}

/** What the job's render step does: the script's clips and pauses → one file + its timeline. */
function render(script: AudioLessonScript, clip: (key: string) => Uint8Array[] = clipFrames) {
  const keys = uniqueSpeech(script).map((u) => u.key);
  const clips = new Map(keys.map((k) => [k, clip(k)]));
  const parts: AssemblyPart[] = script.segments.map((s) => (s.kind === 'pause' ? { kind: 'silence', ms: s.ms } : { kind: 'frames', frames: clips.get(speechKey(s))! }));
  const file = assembleMp3(parts);
  const timeline = buildTimeline(script, new Map([...clips].map(([k, f]) => [k, f.length])), frameMs(), 1);
  return { bytes: file.bytes, timeline };
}

/** The story layout before Oct 2026 (one section): per chunk ×3 with 2 s after each, the English, 2.5 s. */
function compileOldLayout(plan: StoryPlan): AudioLessonScript {
  const current = compileStoryLesson(plan);
  const b = new ScriptBuilder();
  const labels = plan.speakers.map((s) => s.label);
  b.chapter(plan.chunks[0].section ?? 'x');
  b.pause(1000);
  for (const c of plan.chunks) {
    const voice = storyVoiceOf(labels.length ? labels : storySpeakers(plan.chunks), c.speaker ?? null);
    const display = c.speaker ? `${c.speaker}：${c.hanzi}` : undefined;
    for (let k = 0; k < 3; k++) {
      b.say('zh', voice, c.hanzi, 0.5, k === 0 ? { pinyin: c.pinyin, english: c.english, display } : { display });
      b.pause(2000);
    }
    b.say('en', 'recap', sleepTranslationText(c.english), 0.9);
    b.pause(2500);
  }
  b.pause(3000);
  const { layout: _layout, ...rest } = current;
  return { ...rest, chapters: b.chapters, segments: b.segments };
}

let db: SqliteD1;
let r2: ReturnType<typeof fakeBucket>;
let sent: Array<{ body: unknown; opts?: unknown }>;
let env: Env;

beforeEach(async () => {
  db = await createSqliteD1();
  r2 = fakeBucket();
  sent = [];
  env = {
    DB: db,
    AUDIO_BUCKET: r2.bucket,
    AUDIO_LESSON_QUEUE: { send: async (body: unknown, opts?: unknown) => void sent.push({ body, opts }) },
  } as unknown as Env;
  db.raw.run("INSERT INTO users (id, email, name, role) VALUES ('u1', 'learner@example.com', 'Learner', 'student')");
});

/** A ready lesson as the job leaves it: plan, script, timeline, file in R2 (version `v1`). */
async function readyLesson(format: 'story' | 'dialogue', script: AudioLessonScript, plan: unknown, clip?: (key: string) => Uint8Array[]): Promise<string> {
  const id = await q.createAudioLesson(db, { userId: 'u1', format, title: 'Lesson title', input: { text: 'x' } });
  const { bytes, timeline } = render(script, clip);
  const audioKey = q.audioLessonFileKey('u1', id, 'v1');
  await r2.bucket.put(audioKey, bytes);
  await q.patchAudioLesson(db, id, {
    status: 'ready',
    plan_json: plan,
    script_json: script,
    timeline_json: { chapters: timeline.chapters, transcript: timeline.transcript },
    audio_key: audioKey,
    duration_ms: timeline.duration_ms,
    size_bytes: bytes.length,
    zh_provider: 'minimax',
    finished_at: '2026-10-01T10:00:00.000Z',
  });
  return id;
}

const noSpeak = async (): Promise<ClipOutcome> => {
  throw new Error('nothing should be spoken');
};

describe('cutClips', () => {
  it('cuts every distinct clip out of a rendered file, exactly', () => {
    const script = compileOldLayout(SAMPLE_STORY_PLAN);
    const { bytes, timeline } = render(script);
    const out = cutClips(script, timeline.transcript, bytes, timeline.duration_ms);
    if ('error' in out) throw new Error(out.error);
    expect(out.clips.size).toBe(uniqueSpeech(script).length);
    for (const [key, frames] of out.clips) expect(frames.map((f) => [...f])).toEqual(clipFrames(key).map((f) => [...f]));
  });

  it('a timeline that does not match the file → an error, never a guess', () => {
    const script = compileOldLayout(SAMPLE_STORY_PLAN);
    const { bytes, timeline } = render(script);
    const shifted = timeline.transcript.map((l, i) => (i === 3 ? { ...l, start_ms: l.start_ms + 24 } : l));
    expect(cutClips(script, shifted, bytes, timeline.duration_ms)).toHaveProperty('error');
    expect(cutClips(script, timeline.transcript.slice(1), bytes, timeline.duration_ms)).toHaveProperty('error');
    expect(cutClips(script, timeline.transcript, bytes.slice(0, bytes.length - 24 * 10), timeline.duration_ms)).toHaveProperty('error');
  });
});

describe('rerenderStoryLesson', () => {
  it('re-renders an old-layout story from its own file: same id / title / dates, new version, ×3 +2, nothing spoken', async () => {
    const old = compileOldLayout(SAMPLE_STORY_PLAN);
    const id = await readyLesson('story', old, SAMPLE_STORY_PLAN);
    const before = (await q.getAudioLesson(db, id))!;
    const res = await rerenderStoryLesson(env, id, { speak: noSpeak, version: () => 'v2' });
    expect(res).toMatchObject({ id, outcome: 'rerendered', clips_cut: 10, clips_made: 0, version: 'v2' });

    const row = (await q.getAudioLesson(db, id))!;
    expect(row).toMatchObject({ id, title: 'Lesson title', status: 'ready', created_at: before.created_at, finished_at: before.finished_at, plan_json: before.plan_json, zh_provider: 'minimax' });
    expect(row.audio_key).toBe(q.audioLessonFileKey('u1', id, 'v2'));
    expect(q.audioVersion(row)).toBe('v2');
    expect(r2.store.has(before.audio_key!)).toBe(false);
    // The new file is exactly the new script rendered from the same clips.
    const want = render(compileStoryLesson(SAMPLE_STORY_PLAN));
    expect([...r2.store.get(row.audio_key!)!]).toEqual([...want.bytes]);
    expect(row.size_bytes).toBe(want.bytes.length);
    expect(row.duration_ms).toBe(want.timeline.duration_ms);
    expect(row.duration_ms!).toBeGreaterThan(before.duration_ms! * 1.3);
    const script = JSON.parse(row.script_json!) as AudioLessonScript;
    expect(script.layout).toBe(STORY_LAYOUT);
    expect(script.title).toBe(old.title);
    // The player: one row per chunk, "×3 +2"; chapters timed in the new file.
    const detail = q.lessonDetail(row);
    const rows = transcriptRows(detail.transcript);
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.repeat === 3 && r.again === 2)).toBe(true);
    expect(JSON.parse(row.timeline_json!).chapters).toEqual(want.timeline.chapters);
    expect(parseMp3Frames(r2.store.get(row.audio_key!)!).frames.length * 24 + 24).toBe(row.duration_ms);

    // Idempotent: again → up to date, nothing changed.
    expect(await rerenderStoryLesson(env, id, { speak: noSpeak, version: () => 'v3' })).toMatchObject({ outcome: 'up_to_date' });
    expect((await q.getAudioLesson(db, id))!.audio_key).toBe(row.audio_key);
    expect([...r2.store.keys()].filter((k) => k.includes(id))).toEqual([row.audio_key]);
  });

  it('leaves other formats, unfinished lessons and missing ones alone', async () => {
    const dialogue = compileDialogueLesson(SAMPLE_DIALOGUE_PLAN);
    const d = await readyLesson('dialogue', dialogue, SAMPLE_DIALOGUE_PLAN);
    const dBefore = await q.getAudioLesson(db, d);
    expect(await rerenderStoryLesson(env, d, { speak: noSpeak })).toMatchObject({ outcome: 'not_story' });
    expect(await q.getAudioLesson(db, d)).toEqual(dBefore);

    const s = await readyLesson('story', compileOldLayout(SAMPLE_STORY_PLAN), SAMPLE_STORY_PLAN);
    await q.patchAudioLesson(db, s, { status: 'speaking' });
    expect(await rerenderStoryLesson(env, s, { speak: noSpeak })).toMatchObject({ outcome: 'not_ready' });
    expect(await rerenderStoryLesson(env, 'nope', { speak: noSpeak })).toMatchObject({ outcome: 'not_found' });
  });

  it('a clip that is not in the old file is made (the pinned provider); one that can’t be made leaves the lesson as it was', async () => {
    const plan: StoryPlan = JSON.parse(JSON.stringify(SAMPLE_STORY_PLAN));
    const id = await readyLesson('story', compileOldLayout(plan), plan);
    // The stored plan says one English line differently from the file (a clip the file doesn't have).
    plan.chunks[2].english = 'Of course. Large or small?';
    await q.patchAudioLesson(db, id, { plan_json: plan });
    const before = (await q.getAudioLesson(db, id))!;

    const busy = async (): Promise<ClipOutcome> => ({ ok: false, wait: true, retryAfterMs: 60_000, reason: 'minimax paused (account)' });
    const res = await rerenderStoryLesson(env, id, { speak: busy });
    expect(res).toMatchObject({ outcome: 'failed' });
    expect(res.reason).toMatch(/minimax paused/);
    expect(await q.getAudioLesson(db, id)).toEqual(before);
    expect(r2.store.has(before.audio_key!)).toBe(true);

    const asked: Array<{ clip: ClipRequest; pinned: string | null }> = [];
    const speak = async (clip: ClipRequest, pinned: string | null): Promise<ClipOutcome> => {
      asked.push({ clip, pinned });
      return { ok: true, bytes: assembleMp3([{ kind: 'frames', frames: clipFrames(clip.text) }]).bytes, provider: 'azure', voice: 'v' };
    };
    expect(await rerenderStoryLesson(env, id, { speak, version: () => 'v2' })).toMatchObject({ outcome: 'rerendered', clips_cut: 9, clips_made: 1 });
    expect(asked).toEqual([{ clip: { lang: 'en', voice: 'recap', rate: 0.9, text: 'Of course. Large or small?' }, pinned: 'minimax' }]);
  });

  it('a file that does not match its timeline: left as it was, with the reason', async () => {
    const id = await readyLesson('story', compileOldLayout(SAMPLE_STORY_PLAN), SAMPLE_STORY_PLAN);
    const row = (await q.getAudioLesson(db, id))!;
    await r2.bucket.put(row.audio_key!, r2.store.get(row.audio_key!)!.slice(0, 2000));
    const res = await rerenderStoryLesson(env, id, { speak: noSpeak });
    expect(res.outcome).toBe('failed');
    expect(res.reason).toMatch(/couldn't cut the clips/);
    expect((await q.getAudioLesson(db, id))!.script_json).toBe(row.script_json);
  });
});

describe('queueing', () => {
  it('lists / queues only ready story lessons in an older layout; the cron does it once', async () => {
    const stale = await readyLesson('story', compileOldLayout(SAMPLE_STORY_PLAN), SAMPLE_STORY_PLAN);
    await readyLesson('story', compileStoryLesson(SAMPLE_STORY_PLAN), SAMPLE_STORY_PLAN);
    await readyLesson('dialogue', compileDialogueLesson(SAMPLE_DIALOGUE_PLAN), SAMPLE_DIALOGUE_PLAN);
    const failedStory = await readyLesson('story', compileOldLayout(SAMPLE_STORY_PLAN), SAMPLE_STORY_PLAN);
    await q.patchAudioLesson(db, failedStory, { status: 'failed' });

    const dry = await queueStoryRerenders(env, { dryRun: true });
    expect(dry).toMatchObject({ dry_run: true, count: 1, queued: 0 });
    expect(dry.lessons[0]).toMatchObject({ id: stale, chunks: 5 });
    expect(dry.lessons[0].estimated_ms_after!).toBeGreaterThan(dry.lessons[0].duration_ms! * 1.3);
    expect(sent).toEqual([]);

    expect(await queueStoryRerendersOnce(env)).toEqual({ ran: true, dry_run: false, count: 1, queued: 1 });
    expect(sent).toEqual([{ body: { lessonId: stale, rerender: true }, opts: undefined }]);
    expect(await queueStoryRerendersOnce(env)).toEqual({ ran: false });
    expect(sent).toHaveLength(1);

    // The message's work, then nothing left to do.
    await rerenderStoryLesson(env, stale, { speak: noSpeak });
    expect((await queueStoryRerenders(env, { dryRun: true })).count).toBe(0);
  });
});

describe('the job', () => {
  it('a story still speaking with an older-layout script is rendered in the current layout (same clips)', async () => {
    const id = await q.createAudioLesson(db, { userId: 'u1', format: 'story', title: '在咖啡馆', input: { text: 'x' } });
    await q.patchAudioLesson(db, id, { status: 'speaking', plan_json: SAMPLE_STORY_PLAN, script_json: compileOldLayout(SAMPLE_STORY_PLAN) });
    const spoken: ClipRequest[] = [];
    const speak = async (clip: ClipRequest): Promise<ClipOutcome> => {
      spoken.push(clip);
      return { ok: true, bytes: assembleMp3([{ kind: 'frames', frames: clipFrames(clip.text) }]).bytes, provider: 'azure', voice: 'v' };
    };
    expect(await runAudioLessonJob(env, id, { speak, requeue: async () => {} })).toBe('done');
    expect(spoken).toHaveLength(10);
    const row = (await q.getAudioLesson(db, id))!;
    expect((JSON.parse(row.script_json!) as AudioLessonScript).layout).toBe(STORY_LAYOUT);
    expect(transcriptRows(q.lessonDetail(row).transcript).every((r) => r.again === 2)).toBe(true);
  });
});
