/**
 * The audio-lesson job end to end against real SQLite (every migration) with a
 * mocked model and mocked voices: writing (tool loop + a repair round),
 * speaking (a rate-limit wait → re-enqueue, then resume without remaking
 * clips), rendering (one MP3, chapters timed, parts deleted).
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { RATES, SAMPLE_DIALOGUE_PLAN, SAMPLE_SLEEP_PLAN, uniqueSpeech, type AudioLessonScript } from '@shared/audio-lesson';
import { roleVoice } from '../audio-lessons/voices';
import type { Env } from '../../types';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import * as q from '../../db/audio-lesson-queries';
import { runAudioLessonJob } from '../audio-lessons/job';
import { fakeClip } from '../audio-lessons/fake';
import { parseMp3Frames } from '../audio-lessons/mp3';
import { analyseText, buildVocabIndex, checkWords } from '../audio-lessons/vocab';
import { acceptPlan, applyLearnerGender, buildBriefing, maxLessonMinutes, runAuthor, sleepWordTarget, systemPrompt, type ModelCall } from '../audio-lessons/agent';
import { lessonClipRate, type ClipOutcome, type ClipRequest } from '../audio-lessons/synth';
import { DEFAULT_TTS_CONFIG } from '@shared/tts';
import { charShard, charShardFile, wordShard, wordShardFile, type CharRecord, type WordRecord } from '@shared/chars/types';
import { clearCharDictCache, clearWordDictCache } from '../char-dict';
import { makeCharLinks } from '../audio-lessons/char-links';
import { assetsShardLoader } from '../char-dict';

/** A CHAR_DICT binding serving a few records (shards as plain JSON; the reader takes either). */
function fakeCharDict(chars: CharRecord[], words: WordRecord[]): Fetcher {
  const files = new Map<string, Record<string, unknown>>();
  const put = (file: string, key: string, rec: unknown) => files.set(file, { ...(files.get(file) ?? {}), [key]: rec });
  for (const c of chars) put(charShardFile(charShard(c.char)), c.char, c);
  for (const w of words) put(wordShardFile(wordShard(w.hanzi)), w.hanzi, w);
  return {
    async fetch(req: Request) {
      const file = new URL(req.url).pathname.slice(1);
      const body = files.get(file);
      return body ? new Response(JSON.stringify(body)) : new Response('not found', { status: 404 });
    },
  } as unknown as Fetcher;
}

const charRecord = (char: string, words: Array<[string, string, string]>): CharRecord => ({
  char,
  readings: [],
  meaning: '',
  radical: null,
  radical_meaning: null,
  decomposition: null,
  components: [],
  etymology: null,
  strokes: null,
  rank: null,
  words: words.map(([hanzi, pinyin, english]) => ({ hanzi, pinyin, english })),
});
const wordRecord = (hanzi: string, syllables: string[], english: string, rank: number | null): WordRecord => ({ hanzi, pinyin: syllables.join(''), syllables, english, senses: [english], rank });

/** 局: 结局 / 局长 are common, 局面 is too rare; 寄: only rare words (so it is "new"). */
const DICT = fakeCharDict(
  [
    charRecord('局', [['局面', 'júmiàn', 'situation'], ['结局', 'jiéjú', 'ending'], ['局长', 'júzhǎng', 'bureau chief']]),
    charRecord('寄', [['寄托', 'jìtuō', 'to entrust']]),
  ],
  [
    wordRecord('局面', ['jú', 'miàn'], 'situation', 6200),
    wordRecord('结局', ['jié', 'jú'], 'ending', 3678),
    wordRecord('局长', ['jú', 'zhǎng'], 'bureau chief', 2717),
    wordRecord('寄托', ['jì', 'tuō'], 'to entrust', 12038),
  ],
);

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
  env = { DB: db, AUDIO_BUCKET: r2.bucket, CHAR_DICT: DICT } as unknown as Env;
  clearCharDictCache();
  clearWordDictCache();
  exec("INSERT INTO users (id, email, name, role) VALUES ('u1', 'learner@example.com', 'Learner', 'student')");
  exec("INSERT INTO decks (id, user_id, name) VALUES ('d1', 'u1', 'Mine')");
  const notes: Array<[string, string, string, number]> = [
    ['银行', 'yínháng', 'bank', 2],
    ['地方', 'dìfang', 'place', 2],
    ['信', 'xìn', 'letter', 2],
    ['送', 'sòng', 'to give, deliver', 1],
    ['加油', 'jiāyóu', 'come on!', 2],
    ['邮件', 'yóujiàn', 'email', 2],
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
    // Every character gets its line: a word he has (邮件), a common word (结局), a new character (寄).
    const spoken = script.segments.flatMap((s) => (s.kind === 'speech' ? [s.text] : []));
    expect(spoken).toContain('你学过‘邮件’的‘邮’。');
    expect(spoken).toContain('‘局’也在‘结局’里。');
    expect(spoken.some((t) => t.includes('‘寄’') && /没见过|没学过/.test(t))).toBe(true);
    const plan = JSON.parse(row.plan_json!) as typeof SAMPLE_SLEEP_PLAN;
    expect(plan.words[1].char_notes).toEqual([{ char: '寄', words: [], zh: '', kind: 'new' }]);
    expect(plan.words[0].char_notes!.map((n) => n.kind)).toEqual(['known', 'common']);

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
    // Served with the pinyin split off (sleep titles already carry it) or added (automatic).
    expect(detail.chapters.map((c) => [c.label, c.pinyin])).toEqual([
      ['开始', 'kāi shǐ'],
      ['邮局', 'yóujú'],
      ['寄', 'jì'],
      ['结束', 'jié shù'],
      ['原文', 'yuán wén'],
    ]);
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
    expect(detail.chapters[1].pinyin).toBeNull();
    // A taught point's chapter takes the point's own pinyin.
    const point = detail.chapters.find((c) => c.title.includes(' — '));
    const word = detail.words.find((w) => point?.title.startsWith(`${w.hanzi} — `));
    expect(word).toBeTruthy();
    expect(point?.pinyin).toBe(word!.pinyin);
  });

  describe("the learner's own part speaks in their voice gender (users.voice_gender)", () => {
    // Lesson A's shape: the driver a man, the traveller ("我", the learner's part) a woman.
    const traveller = (learner: boolean | undefined) => ({
      ...SAMPLE_DIALOGUE_PLAN,
      speakers: [
        { id: 'A' as const, name: 'Traveller', gender: 'female' as const, ...(learner === undefined ? {} : { learner }) },
        { id: 'B' as const, name: 'Driver', gender: 'male' as const },
      ],
    });
    /** A model that hands in `plans` one after the other, keeping every request it was sent. */
    const handIn = (...plans: unknown[]) => {
      const seen: Array<Parameters<ModelCall>[0]> = [];
      let i = 0;
      const call: ModelCall = async (req) => {
        seen.push(JSON.parse(JSON.stringify(req)));
        const plan = plans[Math.min(i, plans.length - 1)];
        i++;
        return { content: [{ type: 'tool_use', id: `t${i}`, name: 'submit_lesson', input: { plan } }], usage: { input_tokens: 10, output_tokens: 10 }, stop_reason: 'tool_use' };
      };
      return { call, seen };
    };
    const speak = async (clip: ClipRequest): Promise<ClipOutcome> => ({ ok: true, bytes: fakeClip(clip.text, clip.rate), provider: 'azure', voice: 'v' });

    it('male: the traveller marked as the learner gets the male voice, the driver the female one', async () => {
      exec("UPDATE users SET voice_gender = 'male' WHERE id = 'u1'");
      const id = await newLesson('dialogue');
      const model = handIn(traveller(true));
      expect(await runAudioLessonJob(env, id, { call: model.call, speak, requeue: async () => {} })).toBe('done');
      // The plan writer is told who the learner is and their gender.
      const briefing = model.seen[0].messages[0].content as string;
      expect(briefing).toContain('The learner is a man');
      expect(briefing).toContain('learner: true with gender "male"');
      expect(model.seen[0].system).toContain('learner: true');
      const row = (await q.getAudioLesson(db, id))!;
      const plan = JSON.parse(row.plan_json!) as typeof SAMPLE_DIALOGUE_PLAN;
      expect(plan.speakers).toEqual([
        { id: 'A', name: 'Traveller', gender: 'male', learner: true },
        { id: 'B', name: 'Driver', gender: 'female' },
      ]);
      const speakers = q.lessonDetail(row).speakers;
      expect(speakers).toEqual([
        { role: 'speaker_a', name: 'Traveller', gender: 'male' },
        { role: 'speaker_b', name: 'Driver', gender: 'female' },
      ]);
      // Azure: Yunyang for the traveller, Xiaoxiao for the driver.
      expect(roleVoice('azure', 'speaker_a', speakers, DEFAULT_TTS_CONFIG)?.voice).toBe('zh-CN-YunyangNeural');
      expect(roleVoice('azure', 'speaker_b', speakers, DEFAULT_TTS_CONFIG)?.voice).toBe('zh-CN-XiaoxiaoNeural');
    });

    it('male: a plan that marks no learner is sent back once to mark one', async () => {
      exec("UPDATE users SET voice_gender = 'male' WHERE id = 'u1'");
      const id = await newLesson('dialogue');
      const model = handIn(traveller(undefined), traveller(true));
      expect(await runAudioLessonJob(env, id, { call: model.call, speak, requeue: async () => {} })).toBe('done');
      expect(model.seen).toHaveLength(2);
      const refusal = JSON.stringify(model.seen[1].messages[model.seen[1].messages.length - 1].content);
      expect(refusal).toContain('learner: true');
      expect(refusal).toContain("learner's male voice");
      const plan = JSON.parse((await q.getAudioLesson(db, id))!.plan_json!) as typeof SAMPLE_DIALOGUE_PLAN;
      expect(plan.speakers.map((sp) => sp.gender)).toEqual(['male', 'female']);
    });

    it('female: the learner keeps a female voice; a male other speaker is left as he is', async () => {
      exec("UPDATE users SET voice_gender = 'female' WHERE id = 'u1'");
      const id = await newLesson('dialogue');
      const model = handIn(traveller(true));
      expect(await runAudioLessonJob(env, id, { call: model.call, speak, requeue: async () => {} })).toBe('done');
      expect(model.seen[0].messages[0].content as string).toContain('The learner is a woman');
      const plan = JSON.parse((await q.getAudioLesson(db, id))!.plan_json!) as typeof SAMPLE_DIALOGUE_PLAN;
      expect(plan.speakers.map((sp) => sp.gender)).toEqual(['female', 'male']);
    });

    it('other / not set: the plan\'s genders as written, no learner required', async () => {
      for (const g of ['other', null]) {
        exec('UPDATE users SET voice_gender = ? WHERE id = ?', g, 'u1');
        const id = await newLesson('dialogue');
        const model = handIn(traveller(undefined));
        expect(await runAudioLessonJob(env, id, { call: model.call, speak, requeue: async () => {} })).toBe('done');
        expect(model.seen).toHaveLength(1);
        expect(model.seen[0].messages[0].content as string).not.toContain('The learner is a');
        const plan = JSON.parse((await q.getAudioLesson(db, id))!.plan_json!) as typeof SAMPLE_DIALOGUE_PLAN;
        expect(plan.speakers.map((sp) => sp.gender)).toEqual(['female', 'male']);
      }
    });

    it('applyLearnerGender: swaps only when the other speaker had the learner\'s gender', () => {
      const both = { ...traveller(true), speakers: [{ id: 'A' as const, name: 'Guest', gender: 'female' as const, learner: true }, { id: 'B' as const, name: 'Auntie', gender: 'female' as const }] };
      expect(applyLearnerGender(both, 'male').speakers.map((sp) => sp.gender)).toEqual(['male', 'female']);
      expect(applyLearnerGender(traveller(true), 'female')).toEqual(traveller(true));
      expect(applyLearnerGender(traveller(true), null)).toEqual(traveller(true));
      expect(applyLearnerGender(traveller(undefined), 'male')).toEqual(traveller(undefined));
    });

    it('validateDialoguePlan: at most one learner, a boolean', () => {
      const two = { ...traveller(true), speakers: traveller(true).speakers.map((sp) => ({ ...sp, learner: true })) };
      expect(acceptPlan('dialogue', { plan: two }, { description: 'x' })).toMatchObject({ ok: false, problems: ['speakers: at most one is the learner (learner: true)'] });
      expect(acceptPlan('dialogue', { plan: { ...traveller(true), speakers: [{ ...traveller(true).speakers[0], learner: 'yes' }, traveller(true).speakers[1]] } }, { description: 'x' }).ok).toBe(false);
    });
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

describe('character facts for a sleep lesson', () => {
  it('from his cards and the dictionary: known, common (rank ≤ 5000, best first), new', async () => {
    const index = buildVocabIndex(await q.learnerVocabulary(db, 'u1'));
    const links = await makeCharLinks(index, assetsShardLoader(DICT))([{ hanzi: '邮局', pinyin: 'yóujú' }, { hanzi: '寄', pinyin: 'jì' }]);
    expect(links['邮局']).toEqual([
      { char: '邮', kind: 'known', words: [{ hanzi: '邮件', pinyin: 'yóujiàn', english: 'email' }] },
      { char: '局', kind: 'common', words: [{ hanzi: '局长', pinyin: 'júzhǎng', english: 'bureau chief' }, { hanzi: '结局', pinyin: 'jiéjú', english: 'ending' }] },
    ]);
    expect(links['寄']).toEqual([{ char: '寄', kind: 'new', words: [] }]);
    // Without the dictionary: no common words, so 局 is new too.
    const bare = await makeCharLinks(index, null)([{ hanzi: '邮局' }]);
    expect(bare['邮局'].map((l) => l.kind)).toEqual(['known', 'new']);
  });

  it('check_known_words hands the agent the facts; a word not among them is refused with the facts', async () => {
    const index = buildVocabIndex(await q.learnerVocabulary(db, 'u1'));
    const charLinks = makeCharLinks(index, assetsShardLoader(DICT));
    const bad = JSON.parse(JSON.stringify(SAMPLE_SLEEP_PLAN));
    bad.words[0].char_notes[0] = { char: '邮', words: ['邮票'], zh: '你学过‘邮票’的‘邮’。' };
    const turns = [
      { content: [{ type: 'tool_use', id: 'k1', name: 'check_known_words', input: { words: ['邮局', '寄'] } }] },
      { content: [{ type: 'tool_use', id: 's1', name: 'submit_lesson', input: { plan: bad } }] },
      { content: [{ type: 'tool_use', id: 's2', name: 'submit_lesson', input: { plan: SAMPLE_SLEEP_PLAN } }] },
    ];
    const seen: string[] = [];
    let n = 0;
    const call: ModelCall = async ({ messages }) => {
      const last = messages[messages.length - 1];
      if (Array.isArray(last.content)) seen.push(String((last.content[0] as { content?: unknown }).content));
      return { ...turns[n++], stop_reason: 'tool_use' };
    };
    const out = await runAuthor({
      format: 'sleep',
      input: { text: '邮局', target_minutes: 5 },
      index,
      state: { messages: [{ role: 'user', content: 'go' }], rounds: 0, usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
      call,
      checkpoint: async () => {},
      deadline: Date.now() + 60_000,
      charLinks,
    });
    expect(out.kind).toBe('done');
    const checked = JSON.parse(seen[0]) as Array<{ word: string; characters: Array<{ char: string; say: string; words: Array<{ hanzi: string }> }> }>;
    expect(checked[0].characters.map((c) => [c.char, c.say, c.words.map((w) => w.hanzi)])).toEqual([
      ['邮', 'known', ['邮件']],
      ['局', 'common', ['局长', '结局']],
    ]);
    expect(checked[1].characters[0]).toMatchObject({ char: '寄', say: 'new', words: [] });
    expect(seen[1]).toMatch(/"邮票" not among the words given for "邮".*he has LEARNED 邮件/);
  });
});

describe('vocabulary for the agent', () => {
  it('statuses and known words per character', async () => {
    const index = buildVocabIndex(await q.learnerVocabulary(db, 'u1'));
    expect(index.knownWords).toBe(5);
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
    expect(briefing).toContain('Knows 5 words');
    expect(briefing).toContain('Teach about');
  });

  it('acceptPlan refuses a lesson far longer than asked', () => {
    const big = JSON.parse(JSON.stringify(SAMPLE_SLEEP_PLAN));
    const second: Array<[string, string, number]> = [['一', 'yī', 1], ['二', 'èr', 4], ['三', 'sān', 1], ['四', 'sì', 4], ['五', 'wǔ', 3], ['六', 'liù', 4], ['七', 'qī', 1], ['八', 'bā', 1], ['九', 'jiǔ', 3], ['十', 'shí', 2], ['甲', 'jiǎ', 3], ['乙', 'yǐ', 3], ['丙', 'bǐng', 3], ['丁', 'dīng', 1]];
    const charTones = (i: number) => [{ char: '词', pinyin: 'cí', tone: 2 }, { char: second[i][0], pinyin: second[i][1], tone: second[i][2] }];
    for (let i = 0; i < 14; i++) big.words.push({ ...big.words[0], char_notes: undefined, hanzi: `词${'一二三四五六七八九十甲乙丙丁'[i]}`, pinyin: `cí ${second[i][1]}`, char_tones: charTones(i), sentences: big.words[0].sentences.map((s: { hanzi: string }) => ({ ...s, hanzi: s.hanzi.replace('邮局', `词${'一二三四五六七八九十甲乙丙丁'[i]}`) })) });
    const out = acceptPlan('sleep', { plan: big }, { text: '', target_minutes: 5 });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.problems[0]).toMatch(/minutes/);
  });

  it('sleep lessons: the voice at each provider’s slowest natural rate; English at its calm app rate', () => {
    const sleepZh = { lang: 'zh' as const, voice: 'sleep' as const, rate: 0.5 };
    expect(lessonClipRate('minimax', sleepZh, DEFAULT_TTS_CONFIG)).toBe(0.5);
    expect(lessonClipRate('azure', sleepZh, DEFAULT_TTS_CONFIG)).toBe(0.6);
    expect(lessonClipRate('google', sleepZh, DEFAULT_TTS_CONFIG)).toBe(0.6);
    const recap = { lang: 'en' as const, voice: 'recap' as const, rate: 0.9 };
    expect(lessonClipRate('azure', recap, DEFAULT_TTS_CONFIG)).toBe(0.93);
    const teacher = { lang: 'zh' as const, voice: 'teacher' as const, rate: 0.7 };
    expect(lessonClipRate('minimax', teacher, DEFAULT_TTS_CONFIG)).toBe(0.7);
    expect(lessonClipRate('azure', teacher, DEFAULT_TTS_CONFIG)).toBe(0.77);
  });

  it('dialogue lessons: a little slower than natural (Oct 2026), and the clear newsreader as the Azure man', () => {
    const at = (rate: number) => ({ lang: 'zh' as const, voice: 'speaker_b' as const, rate });
    // The plays, the third play, line by line — on Azure (speed_factor 0.75): 0.81 / 0.7 / 0.77 (were 0.93 / 0.81 / 0.85).
    expect([RATES.dialogue, RATES.dialogueSlow, RATES.line]).toEqual([0.75, 0.6, 0.7]);
    expect([RATES.dialogue, RATES.dialogueSlow, RATES.line].map((r) => lessonClipRate('azure', at(r), DEFAULT_TTS_CONFIG))).toEqual([0.81, 0.7, 0.77]);
    expect(lessonClipRate('minimax', at(RATES.dialogue), DEFAULT_TTS_CONFIG)).toBe(0.75);
    const mixed = [
      { role: 'speaker_a' as const, name: 'Auntie', gender: 'female' as const },
      { role: 'speaker_b' as const, name: 'Guest', gender: 'male' as const },
    ];
    expect(roleVoice('azure', 'speaker_b', mixed, DEFAULT_TTS_CONFIG)!.voice).toBe('zh-CN-YunyangNeural');
    expect(roleVoice('azure', 'speaker_a', mixed, DEFAULT_TTS_CONFIG)!.voice).toBe('zh-CN-XiaoxiaoNeural');
    const men = mixed.map((s) => ({ ...s, gender: 'male' as const }));
    expect([roleVoice('azure', 'speaker_a', men, DEFAULT_TTS_CONFIG)!.voice, roleVoice('azure', 'speaker_b', men, DEFAULT_TTS_CONFIG)!.voice]).toEqual(['zh-CN-YunyangNeural', 'zh-CN-YunxiNeural']);
  });

  it('sleep lessons: fewer, longer words — the briefing number fits the target', () => {
    expect(sleepWordTarget(20)).toBe(7);
    expect(sleepWordTarget(5)).toBe(2);
    expect(sleepWordTarget(40)).toBe(12);
    expect(maxLessonMinutes('sleep', 20)).toBe(28);
    // The sample (2 words) fits a 5-minute target.
    expect(acceptPlan('sleep', { plan: SAMPLE_SLEEP_PLAN }, { text: '', target_minutes: 5 }).ok).toBe(true);
    const prompt = systemPrompt('sleep');
    expect(prompt).toContain('5–8 sentences');
    expect(prompt).toContain('邮局不是银行');
    expect(prompt.indexOf('d) ONE English line')).toBeLessThan(prompt.indexOf('e) "我们听三个句子。"'));
  });
});
