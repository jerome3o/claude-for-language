/**
 * The private podcast feed of audio lessons (routes/podcast.ts, services/podcast-feed.ts):
 * the feed is well-formed RSS with one item per READY lesson, the token is the only
 * credential and grants one user's lessons only, Reset / Turn off invalidate the old link,
 * the MP3 is served with Range, and the token never reaches a log line.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { createSqliteD1, type SqliteD1 } from '../../services/__tests__/sqlite-d1';
import { podcastMe, podcastPublic } from '../podcast';
import { requestLog } from '../../services/analytics/request-log';
import {
  allowRequest,
  buildFeedXml,
  decryptFeedToken,
  encryptFeedToken,
  escapeXml,
  hashFeedToken,
  itunesDuration,
  newFeedToken,
  resetMemoryRateLimits,
  subscribeUrls,
  TOKEN_PATTERN,
  FALLBACK_LIMIT_PER_MINUTE,
} from '../../services/podcast-feed';
import type { Env } from '../../types';
import { buildTimeline, compileDialogueLesson, SAMPLE_DIALOGUE_PLAN, speechKey } from '@shared/audio-lesson';
import { cueTimestamp } from '../../services/podcast-transcript';

const ORIGIN = 'http://localhost';

function fakeBucket() {
  const store = new Map<string, Uint8Array>();
  const bucket = {
    async head(key: string) {
      const b = store.get(key);
      return b ? { size: b.length, etag: `etag-${key.length}` } : null;
    },
    async get(key: string, opts?: { range?: { offset?: number; length?: number; suffix?: number } }) {
      const b = store.get(key);
      if (!b) return null;
      const r = opts?.range;
      if (!r) return { body: b, size: b.length };
      const offset = r.suffix !== undefined ? b.length - r.suffix : r.offset ?? 0;
      const length = r.suffix !== undefined ? r.suffix : r.length ?? b.length - offset;
      return { body: b.slice(offset, offset + length), size: b.length, range: r };
    },
  };
  return { store, bucket: bucket as unknown as R2Bucket };
}

/**
 * Strict enough for a feed: CDATA sections closed (their HTML balanced too), then tags balanced
 * and properly nested, every & an entity, attributes quoted.
 */
function assertWellFormedXml(xml: string): void {
  expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  const cdatas: string[] = [];
  const withoutCdata = xml.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, inner: string) => (cdatas.push(inner), 'CDATA'));
  expect(withoutCdata).not.toContain('<![CDATA[');
  expect(withoutCdata).not.toContain(']]>');
  for (const html of cdatas) assertBalancedMarkup(html);
  assertBalancedMarkup(withoutCdata.replace(/^<\?xml[^?]*\?>/, ''));
}

/** Tags balanced and properly nested, every & an entity, attributes quoted. */
function assertBalancedMarkup(body: string): void {
  expect(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(body)).toBe(false);
  const stack: string[] = [];
  const tag = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>|<([^>]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = tag.exec(body))) {
    if (m[5] !== undefined) throw new Error(`malformed tag <${m[5]}>`);
    const [, close, name, , self] = m;
    if (self) continue;
    if (close) {
      const open = stack.pop();
      if (open !== name) throw new Error(`</${name}> closes <${open}>`);
    } else stack.push(name);
  }
  expect(stack).toEqual([]);
  // Text between tags has no raw < (the regex above would have choked on it).
}

const MP3 = Uint8Array.from({ length: 5000 }, (_, i) => i % 251);

describe('podcast feed', () => {
  let db: SqliteD1;
  let r2: ReturnType<typeof fakeBucket>;
  let env: Env;
  const logs: string[] = [];

  function app(userId: string | null) {
    const a = new Hono<{ Bindings: Env }>();
    a.use('*', requestLog);
    a.route('/api/podcast', podcastPublic);
    a.use('/api/*', async (c, next) => {
      if (userId) c.set('user', { id: userId } as never);
      await next();
    });
    a.route('/api', podcastMe);
    return a;
  }

  const ctx = { waitUntil: (p: Promise<unknown>) => void p.catch(() => {}), passThroughOnException: () => {} } as unknown as ExecutionContext;
  const call = (userId: string | null, method: string, path: string, headers: Record<string, string> = {}) =>
    app(userId).request(path.startsWith('http') ? path : `${ORIGIN}${path}`, { method, headers }, env, ctx);
  const feedPath = (url: string) => new URL(url).pathname;

  function addLesson(id: string, userId: string, status: string, opts: { title?: string; finished?: string } = {}) {
    const key = `audio-lessons/${userId}/${id}-v${id}.mp3`;
    db.raw.run(
      `INSERT INTO audio_lessons (id, user_id, title, format, status, audio_key, size_bytes, duration_ms, words_json, timeline_json, rounds, created_at, finished_at)
       VALUES (?, ?, ?, 'sleep', ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [
        id,
        userId,
        opts.title ?? `Lesson ${id}`,
        status,
        status === 'ready' ? key : null,
        MP3.length,
        754_000,
        JSON.stringify([
          { hanzi: '银行', pinyin: 'yínháng', english: 'bank & money' },
          { hanzi: '打扰了', pinyin: 'dǎrǎo le', english: 'sorry to bother you' },
        ]),
        JSON.stringify({
          chapters: [
            { title: '开始', start_ms: 24 },
            { title: '银行 yínháng', start_ms: 65_000 },
            { title: '打扰了 — sorry to bother you', start_ms: 120_000 },
          ],
          transcript: [],
        }),
        '2026-10-01T10:00:00.000Z',
        opts.finished ?? '2026-10-02T21:30:00.000Z',
      ],
    );
    if (status === 'ready') r2.store.set(key, MP3);
  }

  /** A READY dialogue lesson with the sample plan's real script + timeline (each clip ~2 s). */
  function addDialogue(id: string, userId: string, finished = '2026-10-09T08:00:00.000Z') {
    const script = compileDialogueLesson(SAMPLE_DIALOGUE_PLAN);
    const frames = new Map<string, number>();
    for (const s of script.segments) if (s.kind === 'speech') frames.set(speechKey(s), 84);
    const timeline = buildTimeline(script, frames, 24, 1);
    const key = `audio-lessons/${userId}/${id}-v${id}.mp3`;
    db.raw.run(
      `INSERT INTO audio_lessons (id, user_id, title, format, status, audio_key, size_bytes, duration_ms, words_json, script_json, timeline_json, rounds, created_at, finished_at)
       VALUES (?, ?, ?, 'dialogue', 'ready', ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [id, userId, 'Noodles', key, MP3.length, timeline.duration_ms, JSON.stringify(script.words), JSON.stringify(script),
        JSON.stringify({ chapters: timeline.chapters, transcript: timeline.transcript }), '2026-10-09T07:00:00.000Z', finished],
    );
    r2.store.set(key, MP3);
    return { script, timeline };
  }

  beforeEach(async () => {
    resetMemoryRateLimits();
    db = await createSqliteD1();
    r2 = fakeBucket();
    env = { DB: db, AUDIO_BUCKET: r2.bucket, SESSION_SECRET: 'test-secret' } as unknown as Env;
    for (const [id, name] of [['u1', 'Jerome <J&S>'], ['u2', 'Someone else']]) {
      db.raw.run('INSERT INTO users (id, email, name, role) VALUES (?, ?, ?, ?)', [id, `${id}@example.com`, name, 'student']);
    }
    addLesson('a1', 'u1', 'ready', { title: '银行和邮局 <sleep> & "dreams"' });
    addLesson('a2', 'u1', 'speaking');
    addLesson('a3', 'u1', 'ready', { title: 'Second', finished: '2026-10-05T08:00:00.000Z' });
    addLesson('b1', 'u2', 'ready', { title: 'Not yours' });
    logs.length = 0;
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(' ')));
    vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(' ')));
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(' ')));
  });

  async function myFeed(userId = 'u1') {
    const res = await call(userId, 'GET', '/api/me/podcast-feed');
    expect(res.status).toBe(200);
    return ((await res.json()) as { feed: { url: string; podcast_url: string; apple_url: string } }).feed;
  }

  it('makes the feed on first use and shows the same link again; the token is never stored in clear', async () => {
    const a = await myFeed();
    const b = await myFeed();
    expect(a.url).toBe(b.url);
    expect(a.url).toMatch(/^http:\/\/localhost\/api\/podcast\/[A-Za-z0-9_-]{43}\/feed\.xml$/);
    expect(a.podcast_url).toBe(a.url.replace('http://', 'podcast://'));
    expect(a.apple_url).toBe(a.url.replace('http://', 'pcast://'));
    const token = feedPath(a.url).split('/')[3];
    const row = db.raw.exec('SELECT token_hash, token_enc FROM podcast_feeds WHERE user_id = ?', ['u1'])[0].values[0] as string[];
    expect(row.join(' ')).not.toContain(token);
    expect(row[0]).toBe(await hashFeedToken(token));
  });

  it('serves well-formed RSS with one item per READY lesson of that user only', async () => {
    const { url } = await myFeed();
    const res = await call(null, 'GET', feedPath(url));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/rss+xml; charset=utf-8');
    const xml = await res.text();
    assertWellFormedXml(xml);
    expect(xml).toContain('xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"');
    expect((xml.match(/<item>/g) ?? []).length).toBe(2);
    expect(xml).toContain('<title>银行和邮局 &lt;sleep&gt; &amp; &quot;dreams&quot;</title>');
    expect(xml).not.toContain('Not yours');
    expect(xml).not.toContain('Lesson a2');
    // Newest first, with dates, durations, guids, enclosures and chapters.
    expect(xml.indexOf('<title>Second</title>')).toBeLessThan(xml.indexOf('银行和邮局'));
    expect(xml).toContain('<pubDate>Fri, 02 Oct 2026 21:30:00 GMT</pubDate>');
    expect(xml).toContain('<itunes:duration>00:12:34</itunes:duration>');
    expect(xml).toContain('<guid isPermaLink="false">audio-lesson-a1-va1</guid>');
    expect(xml).toMatch(/<enclosure url="http:\/\/localhost\/api\/podcast\/[A-Za-z0-9_-]{43}\/lessons\/a1\/va1\/audio\.mp3" length="5000" type="audio\/mpeg"\/>/);
    expect(xml).toContain('type="application/json+chapters"');
    // Chapter titles with their pinyin: the lesson's own for a taught word, never doubled, automatic otherwise.
    expect(xml).toContain('0:00 开始 kāi shǐ');
    expect(xml).toContain('1:05 银行 yínháng\n');
    expect(xml).toContain('2:00 打扰了 dǎrǎo le — sorry to bother you');
    expect(xml).not.toContain('yínháng yínháng');
    expect(xml).toContain('<itunes:author>Jerome &lt;J&amp;S&gt;</itunes:author>');
    expect(xml).toContain('<itunes:block>Yes</itunes:block>');
  });

  it('a wrong, malformed or other user\'s token is a 404; a lesson id of another user too', async () => {
    const { url } = await myFeed();
    const token = feedPath(url).split('/')[3];
    expect((await call(null, 'GET', `/api/podcast/${newFeedToken()}/feed.xml`)).status).toBe(404);
    expect((await call(null, 'GET', '/api/podcast/short/feed.xml')).status).toBe(404);
    expect((await call(null, 'GET', `/api/podcast/${token}/lessons/b1/vb1/audio.mp3`)).status).toBe(404);
    expect((await call(null, 'GET', `/api/podcast/${token}/lessons/a2/va2/audio.mp3`)).status).toBe(404);
    expect((await call(null, 'GET', `/api/podcast/${token}/lessons/a1/vOLD/audio.mp3`)).status).toBe(404);
    expect((await call(null, 'GET', `/api/podcast/${token}/lessons/b1/chapters.json`)).status).toBe(404);
    expect((await call(null, 'GET', `/api/podcast/${token}/anything-else`)).status).toBe(404);
    // u2's own feed lists only u2's lesson.
    const other = await myFeed('u2');
    const xml = await (await call(null, 'GET', feedPath(other.url))).text();
    expect(xml).toContain('Not yours');
    expect(xml).not.toContain('Second');
  });

  it('Reset stops the old link (feed and files) at once; Turn off too', async () => {
    const before = await myFeed();
    const oldToken = feedPath(before.url).split('/')[3];
    const res = await call('u1', 'POST', '/api/me/podcast-feed/reset');
    const after = ((await res.json()) as { feed: { url: string } }).feed;
    expect(after.url).not.toBe(before.url);
    expect((await call(null, 'GET', feedPath(before.url))).status).toBe(404);
    expect((await call(null, 'GET', `/api/podcast/${oldToken}/lessons/a1/va1/audio.mp3`)).status).toBe(404);
    expect((await call(null, 'GET', feedPath(after.url))).status).toBe(200);
    expect((await myFeed()).url).toBe(after.url);
    expect((await call('u1', 'DELETE', '/api/me/podcast-feed')).status).toBe(200);
    expect((await call(null, 'GET', feedPath(after.url))).status).toBe(404);
  });

  it('serves the MP3 with Range (206), full (200), HEAD and an unsatisfiable range (416)', async () => {
    const { url } = await myFeed();
    const token = feedPath(url).split('/')[3];
    const path = `/api/podcast/${token}/lessons/a1/va1/audio.mp3`;
    const full = await call(null, 'GET', path);
    expect(full.status).toBe(200);
    expect(full.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(full.headers.get('Content-Length')).toBe('5000');
    expect(full.headers.get('Accept-Ranges')).toBe('bytes');
    expect(new Uint8Array(await full.arrayBuffer())).toEqual(MP3);

    const part = await call(null, 'GET', path, { Range: 'bytes=100-199' });
    expect(part.status).toBe(206);
    expect(part.headers.get('Content-Range')).toBe('bytes 100-199/5000');
    expect(part.headers.get('Content-Length')).toBe('100');
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(MP3.slice(100, 200));

    const open = await call(null, 'GET', path, { Range: 'bytes=4990-' });
    expect(open.status).toBe(206);
    expect(open.headers.get('Content-Range')).toBe('bytes 4990-4999/5000');
    const past = await call(null, 'GET', path, { Range: 'bytes=0-99999999' });
    expect(past.status).toBe(206);
    expect(past.headers.get('Content-Range')).toBe('bytes 0-4999/5000');
    const suffix = await call(null, 'GET', path, { Range: 'bytes=-10' });
    expect(suffix.headers.get('Content-Range')).toBe('bytes 4990-4999/5000');
    expect((await call(null, 'GET', path, { Range: 'bytes=6000-' })).status).toBe(416);

    const head = await call(null, 'HEAD', path);
    expect(head.status).toBe(200);
    expect(head.headers.get('Content-Length')).toBe('5000');
    expect((await head.arrayBuffer()).byteLength).toBe(0);

    const chapters = await call(null, 'GET', `/api/podcast/${token}/lessons/a1/chapters.json`);
    expect(await chapters.json()).toEqual({ version: '1.2.0', title: '银行和邮局 <sleep> & "dreams"', chapters: [
        { startTime: 0.024, title: '开始 kāi shǐ' },
        { startTime: 65, title: '银行 yínháng' },
        { startTime: 120, title: '打扰了 dǎrǎo le — sorry to bother you' },
      ],
    });
  });

  it('each episode carries its transcript: hanzi / pinyin / English in the notes, and timed transcripts', async () => {
    const { timeline } = addDialogue('d1', 'u1');
    const { url } = await myFeed();
    const token = feedPath(url).split('/')[3];
    const xml = await (await call(null, 'GET', feedPath(url))).text();
    assertWellFormedXml(xml);
    expect(xml).toContain('xmlns:content="http://purl.org/rss/1.0/modules/content/"');
    expect(xml).toContain('xmlns:podcast="https://podcastindex.org/namespace/1.0"');
    expect(xml).toContain('<language>zh-cn</language>');
    const item = xml.slice(xml.indexOf('<item>'), xml.indexOf('</item>'));
    expect(item).toContain('<title>Noodles</title>');
    // HTML show notes: the whole conversation with speakers, pinyin and English, chapter headings with times.
    const html = item.slice(item.indexOf('<content:encoded><![CDATA['), item.indexOf(']]></content:encoded>'));
    expect(html).toContain('<h3>0:00 · Introduction</h3>');
    expect(html).toContain('<p><strong>Cook:</strong> 你好，吃什么？<br/><em>nǐ hǎo, chī shénme?</em><br/>Hi, what are you having?</p>');
    expect(html).toContain('<p><strong>Customer:</strong> 我要一碗牛肉面。<br/><em>wǒ yào yì wǎn niúròu miàn.</em><br/>I&#39;d like a bowl of beef noodles.</p>');
    expect(html).toContain('(The same 6 lines as in “First listen”.)');
    expect(html).toMatch(/<h3>\d+:\d\d · 粗 cū — thick<\/h3>/);
    // A word repeat the lesson stored without pinyin gets the automatic one.
    expect(html).toContain('<p>粗<br/><em>cū</em></p>');
    // Plain notes: the chapters, then the transcript's first lines; cut to ≤ 4000 characters.
    const desc = item.match(/<description>([\s\S]*?)<\/description>/)![1];
    expect(desc).toContain('Transcript:');
    expect(desc).toContain('Cook: 你好，吃什么？\nnǐ hǎo, chī shénme?\nHi, what are you having?');
    expect(desc.replace(/&[a-z]+;/g, '_').length).toBeLessThanOrEqual(4000);
    // Three timed transcripts, versioned like the MP3.
    const base = `http://localhost/api/podcast/${token}/lessons/d1/vd1/transcript`;
    expect(item).toContain(`<podcast:transcript url="${base}.vtt" type="text/vtt" language="zh-cn" rel="captions"/>`);
    expect(item).toContain(`<podcast:transcript url="${base}.srt" type="application/x-subrip" language="zh-cn" rel="captions"/>`);
    expect(item).toContain(`<podcast:transcript url="${base}.json" type="application/json" language="zh-cn"/>`);
    // A lesson without a stored transcript gets no transcript tags (and still well-formed notes).
    const old = xml.slice(xml.indexOf('<title>Second</title>'));
    expect(old.slice(0, old.indexOf('</item>'))).not.toContain('podcast:transcript');

    const vtt = await call(null, 'GET', `/api/podcast/${token}/lessons/d1/vd1/transcript.vtt`);
    expect(vtt.status).toBe(200);
    expect(vtt.headers.get('Content-Type')).toBe('text/vtt; charset=utf-8');
    expect(vtt.headers.get('Cache-Control')).toBe('private, max-age=3600');
    const vttText = await vtt.text();
    expect(vttText.startsWith('WEBVTT\n\n1\n')).toBe(true);
    const firstLine = timeline.transcript.find((l) => l.text === '你好，吃什么？')!;
    expect(vttText).toContain(`${cueTimestamp(firstLine.start_ms)} --> `);
    expect(vttText).toMatch(/\n\d\d:\d\d:\d\d\.\d{3} --> \d\d:\d\d:\d\d\.\d{3}\n<v Cook>你好，吃什么？\nnǐ hǎo, chī shénme\?\nHi, what are you having\?\n/);

    const srt = await call(null, 'GET', `/api/podcast/${token}/lessons/d1/vd1/transcript.srt`);
    expect(srt.headers.get('Content-Type')).toBe('application/x-subrip; charset=utf-8');
    const srtText = await srt.text();
    expect(srtText.startsWith('1\n00:00:00,')).toBe(true);
    expect(srtText).toMatch(/\n\d\d:\d\d:\d\d,\d{3} --> \d\d:\d\d:\d\d,\d{3}\nCook: 你好，吃什么？\nnǐ hǎo, chī shénme\?\nHi, what are you having\?\n/);

    const json = await call(null, 'GET', `/api/podcast/${token}/lessons/d1/vd1/transcript.json`);
    expect(json.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    const doc = (await json.json()) as { version: string; segments: Array<{ speaker?: string; startTime: number; endTime: number; body: string }> };
    expect(doc.version).toBe('1.0.0');
    const seg = doc.segments.find((s) => s.body.startsWith('你好，吃什么？'))!;
    expect(seg).toMatchObject({ speaker: 'Cook', startTime: firstLine.start_ms / 1000, body: '你好，吃什么？\nnǐ hǎo, chī shénme?\nHi, what are you having?' });
    expect(seg.endTime).toBeGreaterThan(seg.startTime);
    for (let i = 1; i < doc.segments.length; i++) expect(doc.segments[i].startTime).toBeGreaterThanOrEqual(doc.segments[i - 1].endTime - 1e-9);
    expect(doc.segments[doc.segments.length - 1].endTime).toBeCloseTo(timeline.duration_ms / 1000, 3);

    // Same token rules as the other files: a wrong / old version, another user's lesson, a wrong token, other names.
    expect((await call(null, 'GET', `/api/podcast/${token}/lessons/d1/vOLD/transcript.vtt`)).status).toBe(404);
    expect((await call(null, 'GET', `/api/podcast/${token}/lessons/a1/va1/transcript.vtt`)).status).toBe(404); // no transcript stored
    expect((await call(null, 'GET', `/api/podcast/${token}/lessons/d1/vd1/transcript.txt`)).status).toBe(404);
    expect((await call(null, 'GET', `/api/podcast/${newFeedToken()}/lessons/d1/vd1/transcript.vtt`)).status).toBe(404);
    addDialogue('d2', 'u2');
    expect((await call(null, 'GET', `/api/podcast/${token}/lessons/d2/vd2/transcript.json`)).status).toBe(404);
    await call('u1', 'POST', '/api/me/podcast-feed/reset');
    expect((await call(null, 'GET', `/api/podcast/${token}/lessons/d1/vd1/transcript.srt`)).status).toBe(404);
  });

  it('a long feed keeps its size: older episodes get the short notes once the budget is spent', () => {
    const line = (i: number) => ({ start_ms: i * 10_000, lang: 'zh' as const, voice: 'teacher' as const, text: `第${i}句话很长很长很长。`, pinyin: 'dì jù huà', english: `Sentence ${i}.`, chapter: 0 });
    const lesson = (id: string, published_at: string) => ({
      id, format: 'story' as const, title: id, version: 'v1', size_bytes: 1, duration_ms: 3_000_000, words: [],
      chapters: [{ title: '故事', start_ms: 0 }], transcript: Array.from({ length: 300 }, (_, i) => line(i)), speakers: [], published_at,
    });
    const lessons = Array.from({ length: 200 }, (_, i) => lesson(`l${i}`, new Date(Date.UTC(2026, 0, 1) + (200 - i) * 86_400_000).toISOString()));
    const xml = buildFeedXml({ origin: 'https://x.dev', token: 'T'.repeat(43), ownerName: '', lessons });
    assertWellFormedXml(xml);
    expect(xml.length).toBeLessThan(5_500_000);
    const items = xml.split('<item>').slice(1);
    expect(items[0]).toContain('Sentence 299.');
    expect(items[199]).not.toContain('Sentence 299.');
    expect(items[199]).toContain('The full transcript (hanzi, pinyin, English) is in this episode’s transcript');
    expect(items[199]).toContain('podcast:transcript');
  });

  it('never writes the token into a log line', async () => {
    addDialogue('d1', 'u1');
    const { url } = await myFeed();
    const token = feedPath(url).split('/')[3];
    await call(null, 'GET', `/api/podcast/${token}/lessons/d1/vd1/transcript.vtt`);
    await call(null, 'GET', feedPath(url));
    await call(null, 'GET', `/api/podcast/${token}/lessons/a1/va1/audio.mp3`, { Range: 'bytes=0-9' });
    await call(null, 'GET', `/api/podcast/${token}/lessons/zzz/v/audio.mp3`);
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.some((l) => l.includes('/api/podcast/:token/feed.xml'))).toBe(true);
    expect(logs.join('\n')).not.toContain(token);
  });

  it('rate-limits a token (429 with Retry-After) and unknown tokens per address', async () => {
    const { url } = await myFeed();
    for (let i = 0; i < FALLBACK_LIMIT_PER_MINUTE; i++) expect((await call(null, 'GET', feedPath(url))).status).toBe(200);
    const limited = await call(null, 'GET', feedPath(url));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('60');
    // The binding, when present, decides.
    const decided: string[] = [];
    const binding = { limit: async ({ key }: { key: string }) => (decided.push(key), { success: false }) };
    expect(await allowRequest({ PODCAST_RATE_LIMITER: binding }, 'podcast-miss:1.2.3.4')).toBe(false);
    expect(decided).toEqual(['podcast-miss:1.2.3.4']);
  });
});

describe('podcast feed helpers', () => {
  const env = { SESSION_SECRET: 'one' } as unknown as Env;

  it('tokens are 43 base64url characters; encryption round-trips and fails with another secret', async () => {
    const t = newFeedToken();
    expect(TOKEN_PATTERN.test(t)).toBe(true);
    expect(newFeedToken()).not.toBe(t);
    const enc = await encryptFeedToken(env, t);
    expect(enc).not.toContain(t);
    expect(await decryptFeedToken(env, enc)).toBe(t);
    expect(await decryptFeedToken({ SESSION_SECRET: 'two' } as unknown as Env, enc)).toBeNull();
    expect(await decryptFeedToken(env, 'garbage')).toBeNull();
  });

  it('formats', () => {
    expect(itunesDuration(3_723_400)).toBe('01:02:03');
    expect(escapeXml('a<b>&"\'\u0001')).toBe('a&lt;b&gt;&amp;&quot;&apos;');
    expect(subscribeUrls('https://x.dev/api/podcast/t/feed.xml')).toEqual({ podcast_url: 'podcast://x.dev/api/podcast/t/feed.xml', apple_url: 'pcast://x.dev/api/podcast/t/feed.xml' });
    const xml = buildFeedXml({ origin: 'https://x.dev', token: 'T'.repeat(43), ownerName: '', lessons: [], now: new Date('2026-10-07T00:00:00Z') });
    assertWellFormedXml(xml);
    expect(xml).toContain('<lastBuildDate>Wed, 07 Oct 2026 00:00:00 GMT</lastBuildDate>');
  });
});
