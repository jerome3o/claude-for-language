import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqliteD1, type SqliteD1 } from './sqlite-d1';
import { makePng, pngDataUrl } from './picture-hunt-png';
import * as huntDb from '../../db/picture-hunt-queries';
import {
  assembleObjects, boxFrom2d, buildScenePrompt, cleanDetections, parseJsonArray, runPictureHuntJob, sniffImage,
  type Detection, type NamedItem,
} from '../picture-hunt';

const SCENE_PNG = makePng(64, 48, (x, y) => (x + y) % 256, { rgba: true });
const DISC = pngDataUrl(makePng(32, 32, (x, y) => ((x - 16) ** 2 + (y - 16) ** 2 <= 144 ? 255 : 0)));

function fakeBucket() {
  const store = new Map<string, Uint8Array>();
  return {
    store,
    get: vi.fn(async (key: string) => {
      const bytes = store.get(key);
      return bytes ? { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), body: bytes, httpMetadata: { contentType: 'image/png' } } : null;
    }),
    put: vi.fn(async (key: string, bytes: Uint8Array) => { store.set(key, new Uint8Array(bytes)); }),
    delete: vi.fn(async (key: string) => { store.delete(key); }),
  };
}

const geminiText = (text: string, finishReason = 'STOP') =>
  new Response(JSON.stringify({ candidates: [{ finishReason, content: { parts: [{ text }] } }] }), { status: 200 });

const DETECTIONS = [
  { box_2d: [100, 100, 400, 300], label: 'teacup', mask: DISC },
  { box_2d: [500, 600, 800, 800], label: 'cup', mask: DISC },
  { box_2d: [200, 500, 600, 900], label: 'wooden table' },
  { box_2d: [0, 0, 1000, 1000], label: 'kitchen' }, // whole scene → dropped
  { box_2d: [10, 10, 12, 12], label: 'speck' }, // tiny → dropped
  { box_2d: [300, 300, 500, 500], label: 'object' }, // junk label → dropped
  { box_2d: [700, 50, 950, 250], label: 'person hand' },
];

function namingAnswer(items: NamedItem[], title = { title_hanzi: '厨房', title_english: 'Kitchen' }) {
  return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't', name: 'name_objects', input: { ...title, items } }] };
}

const GOOD_ITEMS: NamedItem[] = [
  { n: 1, hanzi: '杯子', pinyin: 'bēizi', english: 'cup', alternatives: ['茶杯'], sentence_clue: '桌子上有一个杯子。' },
  { n: 2, hanzi: '杯子', pinyin: 'bēizi', english: 'cup', alternatives: ['水杯'] },
  { n: 3, hanzi: '桌子', pinyin: 'zhuōzi', english: 'table', alternatives: ['饭桌'] },
  { n: 4, skip: true },
];

describe('picture hunt helpers', () => {
  it('parses fenced JSON and box_2d', () => {
    expect(parseJsonArray('```json\n[{"a":1}]\n```')).toEqual([{ a: 1 }]);
    expect(() => parseJsonArray('[{"box_2d": [1, 2')).toThrow();
    expect(boxFrom2d([100, 200, 300, 600])).toEqual({ x: 0.2, y: 0.1, w: 0.4, h: 0.2 });
    expect(boxFrom2d([1, 2, 3])).toBeNull();
  });
  it('drops junk, specks, the whole scene and duplicate boxes', () => {
    const d = (label: string, x: number, y: number, w: number, h: number): Detection => ({ label, box: { x, y, w, h } });
    const kept = cleanDetections([d('cup', 0.1, 0.1, 0.2, 0.2), d('mug', 0.1, 0.1, 0.2, 0.19), d('room', 0, 0, 1, 1), d('thing', 0.5, 0.5, 0.2, 0.2), d('pen', 0.5, 0.5, 0.01, 0.01)]);
    expect(kept.map((k) => k.label)).toEqual(['cup']);
  });
  it('merges same hanzi into one object with two regions and reports rule-breakers', () => {
    const dets: Detection[] = [
      { label: 'a', box: { x: 0, y: 0, w: 0.2, h: 0.2 } },
      { label: 'b', box: { x: 0.5, y: 0.5, w: 0.2, h: 0.2 } },
      { label: 'c', box: { x: 0.3, y: 0.3, w: 0.2, h: 0.2 } },
    ];
    const { objects, problems } = assembleObjects(dets, [[[0, 0], [0.1, 0], [0.1, 0.1]], null, null], {
      title_hanzi: '', title_english: '', items: [
        { n: 1, hanzi: '杯子', pinyin: 'bēizi', english: 'cup', alternatives: ['茶杯'] },
        { n: 2, hanzi: '杯子。', pinyin: 'bēizi', english: 'cup', alternatives: ['水杯'] },
        { n: 3, hanzi: '椅子/凳子', pinyin: 'yi3zi', english: 'chair' },
        { n: 9, hanzi: '书', pinyin: 'shū', english: 'book' },
      ],
    });
    expect(objects).toHaveLength(1);
    expect(objects[0]).toMatchObject({ id: 'o1', hanzi: '杯子', alternatives: ['茶杯', '水杯'] });
    expect(objects[0].regions).toHaveLength(2);
    expect(objects[0].regions[0].polygon).toHaveLength(3);
    expect(problems.join('\n')).toMatch(/#3 .*ONE clean form/);
  });
  it('sniffs PNG size and leans the scene prompt toward the learner\'s words', () => {
    expect(sniffImage(SCENE_PNG)).toEqual({ mime: 'image/png', width: 64, height: 48 });
    const prompt = buildScenePrompt('a busy kitchen', [{ hanzi: '苹果', pinyin: 'píngguǒ', english: 'apple' }, { hanzi: '跑', pinyin: 'pǎo', english: 'to run fast every morning' }]);
    expect(prompt).toContain('apple');
    expect(prompt).not.toContain('to run fast');
    expect(prompt).toMatch(/No text/);
  });
});

describe('runPictureHuntJob', () => {
  let db: SqliteD1;
  let bucket: ReturnType<typeof fakeBucket>;

  beforeEach(async () => {
    db = await createSqliteD1();
    db.raw.run("INSERT INTO users (id, email, name) VALUES ('u1', 'u1@x.test', 'U')");
    bucket = fakeBucket();
  });

  const env = () => ({ DB: db, AUDIO_BUCKET: bucket, GEMINI_API_KEY: 'g-key', ANTHROPIC_API_KEY: 'a-key' }) as never;

  function fakeFetch(detectAnswers: Response[]) {
    const calls: string[] = [];
    const fn = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(url);
      if (url.includes('gemini-2.5-flash-image')) {
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: Buffer.from(SCENE_PNG).toString('base64') } }] } }] }), { status: 200 });
      }
      const body = JSON.parse(String(init?.body));
      calls.push(body.contents[0].parts[1].text.includes('segmentation') ? 'masks' : 'boxes');
      return detectAnswers.shift()!;
    });
    return { fn, calls };
  }

  function fakeClaude(answers: unknown[]) {
    const create = vi.fn(async () => answers.shift());
    return { client: { messages: { create } } as never, create };
  }

  it('draws, detects with masks, names and stores a ready hunt', async () => {
    const id = await huntDb.createPictureHunt(db, { userId: 'u1', title: 'kitchen', source: 'generated', prompt: 'a busy kitchen', deckIds: [] });
    const { fn, calls } = fakeFetch([geminiText(JSON.stringify(DETECTIONS))]);
    const { client, create } = fakeClaude([namingAnswer(GOOD_ITEMS)]);
    const outcome = await runPictureHuntJob(env(), id, { fetch: fn, claude: client, sleep: async () => {} });
    expect(outcome).toBe('ready');
    expect(calls.filter((c) => c === 'masks')).toHaveLength(1);
    const row = await huntDb.getPictureHunt(db, id, 'u1');
    expect(row).toMatchObject({ status: 'ready', title: '厨房 · Kitchen', object_count: 2, image_width: 64, image_height: 48, progress: null });
    expect(bucket.store.has(`picture-hunts/${id}.png`)).toBe(true);
    const objects = huntDb.parseHuntObjects(row!.objects);
    expect(objects.map((o) => o.hanzi)).toEqual(['杯子', '桌子']);
    expect(objects[0].regions).toHaveLength(2);
    expect(objects[0].regions[0].polygon?.length).toBeGreaterThanOrEqual(3);
    expect(objects[1].regions[0].polygon).toBeUndefined();
    // Claude saw the picture and the numbered list (4 kept detections).
    const request = (create.mock.calls[0] as unknown[])[0] as { thinking: unknown; tool_choice: unknown; messages: Array<{ content: Array<{ type: string; text?: string }> }> };
    expect(request.thinking).toEqual({ type: 'disabled' });
    expect(request.tool_choice).toEqual({ type: 'tool', name: 'name_objects' });
    expect(request.messages[0].content[0].type).toBe('image');
    expect(request.messages[0].content[1].text).toContain('4. "person hand"');
  });

  it('falls back to boxes when the mask answer is cut off', async () => {
    const id = await huntDb.createPictureHunt(db, { userId: 'u1', title: 'k', source: 'generated', prompt: 'kitchen', deckIds: null });
    const boxesOnly = DETECTIONS.map(({ box_2d, label }) => ({ box_2d, label }));
    const { fn, calls } = fakeFetch([geminiText('[{"box_2d": [1, 2', 'MAX_TOKENS'), geminiText('```json\n' + JSON.stringify(boxesOnly) + '\n```')]);
    const { client } = fakeClaude([namingAnswer(GOOD_ITEMS)]);
    expect(await runPictureHuntJob(env(), id, { fetch: fn, claude: client, sleep: async () => {} })).toBe('ready');
    expect(calls.filter((c) => c === 'masks' || c === 'boxes')).toEqual(['masks', 'boxes']);
    const objects = huntDb.parseHuntObjects((await huntDb.getPictureHunt(db, id, 'u1'))!.objects);
    expect(objects.every((o) => o.regions.every((r) => !r.polygon))).toBe(true);
  });

  it('runs one repair round for items that break a rule', async () => {
    const id = await huntDb.createPictureHunt(db, { userId: 'u1', title: 'k', source: 'generated', prompt: 'kitchen', deckIds: null });
    const { fn } = fakeFetch([geminiText(JSON.stringify(DETECTIONS))]);
    const bad: NamedItem[] = [
      { n: 1, hanzi: '杯子', pinyin: 'bei1zi', english: 'cup' },
      { n: 3, hanzi: '桌子（饭桌）', pinyin: 'zhuōzi', english: 'table' },
    ];
    const { client, create } = fakeClaude([namingAnswer(bad), namingAnswer(GOOD_ITEMS)]);
    expect(await runPictureHuntJob(env(), id, { fetch: fn, claude: client, sleep: async () => {} })).toBe('ready');
    expect(create).toHaveBeenCalledTimes(2);
    const repairText = ((create.mock.calls[1] as unknown[])[0] as { messages: Array<{ content: Array<{ text?: string }> }> }).messages[0].content.at(-1)!.text!;
    expect(repairText).toMatch(/previous answer had these problems/);
    expect(repairText).toMatch(/tone numbers/);
    expect((await huntDb.getPictureHunt(db, id, 'u1'))!.object_count).toBe(2);
  });

  it('uses the uploaded picture without drawing one', async () => {
    const id = await huntDb.createPictureHunt(db, { userId: 'u1', title: 'My photo', source: 'upload', prompt: null, deckIds: [] });
    bucket.store.set(`picture-hunts/${id}.png`, SCENE_PNG);
    await huntDb.setPictureHuntImage(db, id, `picture-hunts/${id}.png`, 64, 48);
    const { fn, calls } = fakeFetch([geminiText(JSON.stringify(DETECTIONS))]);
    const { client } = fakeClaude([namingAnswer(GOOD_ITEMS)]);
    expect(await runPictureHuntJob(env(), id, { fetch: fn, claude: client, sleep: async () => {} })).toBe('ready');
    expect(calls.some((c) => c.includes('flash-image'))).toBe(false);
  });

  it('records a readable error: missing upload, nothing detected, no keys', async () => {
    const up = await huntDb.createPictureHunt(db, { userId: 'u1', title: 'p', source: 'upload', prompt: null, deckIds: [] });
    await huntDb.setPictureHuntImage(db, up, 'picture-hunts/gone.jpg', 1, 1);
    expect(await runPictureHuntJob(env(), up, { fetch: fakeFetch([]).fn })).toBe('error');
    expect((await huntDb.getPictureHunt(db, up, 'u1'))!.error).toMatch(/uploaded photo is missing/);

    const empty = await huntDb.createPictureHunt(db, { userId: 'u1', title: 'e', source: 'generated', prompt: 'x', deckIds: null });
    const { fn } = fakeFetch([geminiText('[]'), geminiText('[]')]);
    expect(await runPictureHuntJob(env(), empty, { fetch: fn })).toBe('error');
    expect((await huntDb.getPictureHunt(db, empty, 'u1'))!.error).toMatch(/No nameable objects/);

    const nokey = await huntDb.createPictureHunt(db, { userId: 'u1', title: 'n', source: 'generated', prompt: 'x', deckIds: null });
    expect(await runPictureHuntJob({ DB: db, AUDIO_BUCKET: bucket, GEMINI_API_KEY: '', ANTHROPIC_API_KEY: 'a' } as never, nokey)).toBe('error');
    expect((await huntDb.getPictureHunt(db, nokey, 'u1'))!.error).toMatch(/Gemini key/);
    expect(await runPictureHuntJob(env(), 'nope')).toBe('missing');
  });
});
