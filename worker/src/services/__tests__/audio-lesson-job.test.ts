/**
 * The audio-lesson job end to end against real SQLite (every migration) with a
 * mocked model and mocked voices: writing (tool loop + a repair round),
 * speaking (a rate-limit wait → re-enqueue, then resume without remaking
 * clips), rendering (one MP3, chapters timed, parts deleted).
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { SAMPLE_DIALOGUE_PLAN, SAMPLE_SLEEP_PLAN, uniqueSpeech, type AudioLessonScript } from '@shared/audio-lesson';
import type { Env } from '../../types';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import * as q from '../../db/audio-lesson-queries';
import { runAudioLessonJob } from '../audio-lessons/job';
import { fakeClip } from '../audio-lessons/fake';
import { parseMp3Frames } from '../audio-lessons/mp3';
import { analyseText, buildVocabIndex, checkWords } from '../audio-lessons/vocab';
import { acceptPlan, buildBriefing, type ModelCall } from '../audio-lessons/agent';
import type { ClipOutcome, ClipRequest } from '../audio-lessons/synth';

function fakeBucket() {
  const store = new Map<string, { bytes: Uint8Array; meta?: Record<string, string> }>();
  const bucket = {
    async put(key: string, value: Uint8Array | ArrayBuffer, opts?: { customMetadata?: Record<string, string> }) {
      store.set(key, { bytes: value instanceof Uint8Array ? value : new Uint8Array(value), meta: opts?.customMetadata });
    },
    async get(key: string) {
      const v = store.get(key);
      if (!v) return null;
      return { arrayBuffer: async () => v.bytes.slice().buffer, customMetadata: v.meta, size: v.bytes.length };
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

let db: SqliteD1;
let r2: ReturnType<typeof fakeBucket>;
let env: Env;

function exec(sql: string, ...params: (string | number | null)[]) {
  db.raw.run(sql, params);
}

beforeEach(async () => {
  db = await createSqliteD1();
  r2 = fakeBucket();
  env = { DB: db, AUDIO_BUCKET: r2.bucket } as unknown as Env;
  exec("INSERT INTO users (id, email, name, role) VALUES ('u1', 'learner@example.com', 'Learner', 'student')");
  exec("INSERT INTO decks (id, user_id, name) VALUES ('d1', 'u1', 'Mine')");
  const notes: Array<[string, string, string, number]> = [
    ['银行', 'yínháng', 'bank', 2],
    ['地方', 'dìfang', 'place', 2],
    ['信', 'xìn', 'letter', 2],
    ['送', 'sòng', 'to give, deliver', 1],
    ['加油', 'jiāyóu', 'come on!', 2],
  ];
  notes.forEach(([hanzi, pinyin, english, tier], i) => {
    exec('INSERT INTO notes (id, deck_id, hanzi, pinyin, english) VALUES (?, ?, ?, ?, ?)', `n${i}`, 'd1', hanzi, pinyin, english);
    exec('INSERT INTO cards (id, note_id, card_type, queue, stability) VALUES (?, ?, ?, ?, ?)', `c${i}`, `n${i}`, 'hanzi_to_meaning', tier === 2 ? 2 : 1, tier === 2 ? 40 : 2);
  });
});

/** A model that checks words, hands in a broken plan, then the right one. */
function scriptedModel(format: 'dialogue' | 'sleep'): { call: ModelCall; requests: number } {
  const good = format === 'dialogue' ? SAMPLE_DIALOGUE_PLAN : SAMPLE_SLEEP_PLAN;
  const broken = JSON.parse(JSON.stringify(good));
  if (format === 'dialogue') broken.intro_en = 'Listen for cū, thick.';
  else broken.words[0].sentences = broken.words[0].sentences.slice(0, 1);
  const turns = [
    { content: [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'tool_use', id: 't1', name: 'check_known_words', input: { words: ['邮局', '粗'] } }] },
    { content: [{ type: 'tool_use', id: 't2', name: 'submit_lesson', input: { plan: broken } }] },
    { content: [{ type: 'tool_use', id: 't3', name: 'submit_lesson', input: { plan: good } }] },
  ];
  const m: { requests: number; call: ModelCall } = { requests: 0, call: async () => ({ content: [] }) };
  m.call = async ({ messages }) => {
    const turn = turns[m.requests++];
    if (m.requests === 3) {
      // The repair round sees the problem list as the tool's error.
      const last = messages[messages.length - 1].content as Array<{ is_error?: boolean; content: string }>;
      expect(last[0].is_error).toBe(true);
    }
    return { ...turn, usage: { input_tokens: 1000, output_tokens: 500 }, stop_reason: 'tool_use' };
  };
  return m;
}

async function newLesson(format: 'dialogue' | 'sleep') {
  return q.createAudioLesson(db, {
    userId: 'u1',
    format,
    title: 'x',
    input: format === 'sleep' ? { text: '我家旁边有一个邮局，邮局在银行旁边。我常常去邮局给妈妈寄信。', target_minutes: 10 } : { description: 'Ordering noodles' },
  });
}

describe('runAudioLessonJob', () => {
  it('writes, speaks (waiting once on a rate limit) and renders a sleep lesson', async () => {
    const id = await newLesson('sleep');
    const model = scriptedModel('sleep');
    const requeued: number[] = [];
    let calls = 0;
    const speak = async (clip: ClipRequest): Promise<ClipOutcome> => {
      calls++;
      if (calls === 4) return { ok: false, wait: true, retryAfterMs: 30_000, reason: 'limiter' };
      return { ok: true, bytes: fakeClip(clip.text, clip.rate), provider: 'azure', voice: 'zh-CN-XiaoxiaoNeural' };
    };
    const deps = { call: model.call, speak, requeue: async (_: string, d: number) => void requeued.push(d) };

    expect(await runAudioLessonJob(env, id, deps)).toBe('waiting');
    expect(requeued).toEqual([30]);
    let row = (await q.getAudioLesson(db, id))!;
    expect(row.status).toBe('speaking');
    expect(row.zh_provider).toBe('azure');
    expect(row.title).toBe(SAMPLE_SLEEP_PLAN.title);
    const script = JSON.parse(row.script_json!) as AudioLessonScript;
    const unique = uniqueSpeech(script).length;
    expect(row.progress_total).toBe(unique);
    expect(row.progress_done).toBe(3);

    // Resume: only the missing clips are made, the model is not called again.
    expect(await runAudioLessonJob(env, id, deps)).toBe('done');
    expect(model.requests).toBe(3);
    expect(calls).toBe(unique + 1);
    row = (await q.getAudioLesson(db, id))!;
    expect(row.status).toBe('ready');
    expect([...r2.store.keys()].filter((k) => k.includes('/parts/'))).toEqual([]);
    const file = r2.store.get(row.audio_key!)!.bytes;
    expect(row.size_bytes).toBe(file.length);
    const parsed = parseMp3Frames(file);
    expect(parsed.mismatched).toBe(0);
    // Duration in the row = the file's frames + the Xing frame.
    expect(row.duration_ms).toBe((parsed.frames.length + 1) * 24);

    const detail = q.lessonDetail(row);
    expect(detail.chapters.map((c) => c.title)).toEqual(['开始', '邮局 yóujú', '寄 jì', '结束', '原文']);
    for (let i = 1; i < detail.chapters.length; i++) expect(detail.chapters[i].start_ms).toBeGreaterThan(detail.chapters[i - 1].start_ms);
    expect(detail.transcript.find((l) => l.text === '邮局在银行旁边。')?.english).toBe('The post office is next to the bank.');
    expect(detail.words.map((w) => w.hanzi)).toEqual(['邮局', '寄']);
    expect(detail.usage).toMatchObject({ rounds: 3, input_tokens: 3000, output_tokens: 1500, zh_provider: 'azure', tts_clips: unique });
    expect(detail.usage!.claude_usd).toBeCloseTo((3000 * 4 + 1500 * 20) / 1e6);
    expect(detail.audio_version).toMatch(/^[0-9a-f]+$/);
  });

  it('a dialogue lesson pins the Chinese provider and records the English one', async () => {
    const id = await newLesson('dialogue');
    const pins: Array<string | null> = [];
    const speak = async (clip: ClipRequest, pinned: string | null): Promise<ClipOutcome> => {
      if (clip.lang === 'zh') pins.push(pinned);
      return { ok: true, bytes: fakeClip(clip.text, clip.rate), provider: clip.lang === 'zh' ? 'minimax' : 'azure', voice: 'v' };
    };
    expect(await runAudioLessonJob(env, id, { call: scriptedModel('dialogue').call, speak: speak as never, requeue: async () => {} })).toBe('done');
    expect(pins[0]).toBeNull();
    expect(pins.slice(1).every((p) => p === 'minimax')).toBe(true);
    const detail = q.lessonDetail((await q.getAudioLesson(db, id))!);
    expect(detail.usage).toMatchObject({ zh_provider: 'minimax', en_provider: 'azure' });
    expect(detail.speakers.map((s) => s.role)).toEqual(['speaker_a', 'speaker_b']);
    expect(detail.chapters[1].title).toBe('First listen');
  });

  it('a clip that keeps failing fails the lesson with the reason; Retry resumes without rewriting', async () => {
    const id = await newLesson('sleep');
    const model = scriptedModel('sleep');
    const bad = async (): Promise<ClipOutcome> => ({ ok: false, wait: false, permanent: true, reason: 'azure http 400' });
    expect(await runAudioLessonJob(env, id, { call: model.call, speak: bad, requeue: async () => {} })).toBe('failed');
    let row = (await q.getAudioLesson(db, id))!;
    expect(row.status).toBe('failed');
    expect(row.error).toMatch(/azure http 400/);
    await q.resetAudioLessonForRetry(db, id);
    const good = async (clip: ClipRequest): Promise<ClipOutcome> => ({ ok: true, bytes: fakeClip(clip.text, clip.rate), provider: 'azure', voice: 'v' });
    expect(await runAudioLessonJob(env, id, { call: model.call, speak: good, requeue: async () => {} })).toBe('done');
    expect(model.requests).toBe(3);
    row = (await q.getAudioLesson(db, id))!;
    expect(row.status).toBe('ready');
  });

  it('a model that never hands in a lesson fails after one nudge', async () => {
    const id = await newLesson('dialogue');
    let n = 0;
    const call: ModelCall = async () => {
      n++;
      return { content: [{ type: 'text', text: 'Here is a lesson…' }], stop_reason: 'end_turn' };
    };
    expect(await runAudioLessonJob(env, id, { call, requeue: async () => {} })).toBe('failed');
    expect(n).toBe(2);
    expect((await q.getAudioLesson(db, id))!.error).toMatch(/without handing in/);
  });

  it('lists only lessons of this format generation', async () => {
    exec("INSERT INTO audio_lessons (id, user_id, title, status) VALUES ('old', 'u1', 'old one', 'done')");
    await newLesson('sleep');
    const rows = await q.listAudioLessons(db, 'u1');
    expect(rows.map((r) => r.format)).toEqual(['sleep']);
  });
});

describe('vocabulary for the agent', () => {
  it('statuses and known words per character', async () => {
    const index = buildVocabIndex(await q.learnerVocabulary(db, 'u1'));
    expect(index.knownWords).toBe(4);
    const [yin, song, youju] = checkWords(index, ['银', '送', '邮局']);
    expect(yin.status).toBe('new');
    expect(yin.characters[0].words.map((w) => w.hanzi)).toEqual(['银行']);
    expect(song.status).toBe('learning');
    expect(youju.status).toBe('new');
  });

  it('text analysis finds the uncovered stretches', async () => {
    const index = buildVocabIndex(await q.learnerVocabulary(db, 'u1'));
    const a = analyseText(index, '邮局在银行旁边。我去邮局寄信。');
    expect(a.familiar.map((f) => f.hanzi)).toEqual(expect.arrayContaining(['银行', '信']));
    expect(a.unfamiliar.map((u) => u.text)).toEqual(['我去邮局寄', '邮局在', '旁边']);
    expect(a.coverage).toBeGreaterThan(0);
    const briefing = buildBriefing('sleep', { text: '邮局在银行旁边。' }, index);
    expect(briefing).toContain('Knows 4 words');
    expect(briefing).toContain('Teach about');
  });

  it('acceptPlan refuses a lesson far longer than asked', () => {
    const big = JSON.parse(JSON.stringify(SAMPLE_SLEEP_PLAN));
    const second: Array<[string, string, number]> = [['一', 'yī', 1], ['二', 'èr', 4], ['三', 'sān', 1], ['四', 'sì', 4], ['五', 'wǔ', 3], ['六', 'liù', 4], ['七', 'qī', 1], ['八', 'bā', 1], ['九', 'jiǔ', 3], ['十', 'shí', 2], ['甲', 'jiǎ', 3], ['乙', 'yǐ', 3], ['丙', 'bǐng', 3], ['丁', 'dīng', 1]];
    const charTones = (i: number) => [{ char: '词', pinyin: 'cí', tone: 2 }, { char: second[i][0], pinyin: second[i][1], tone: second[i][2] }];
    for (let i = 0; i < 14; i++) big.words.push({ ...big.words[0], hanzi: `词${'一二三四五六七八九十甲乙丙丁'[i]}`, pinyin: `cí ${second[i][1]}`, char_tones: charTones(i), sentences: big.words[0].sentences.map((s: { hanzi: string }) => ({ ...s, hanzi: s.hanzi.replace('邮局', `词${'一二三四五六七八九十甲乙丙丁'[i]}`) })) });
    const out = acceptPlan('sleep', { plan: big }, { text: '', target_minutes: 5 });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.problems[0]).toMatch(/minutes/);
  });
});
