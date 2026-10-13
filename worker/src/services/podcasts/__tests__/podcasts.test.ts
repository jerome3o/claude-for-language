import { describe, expect, it, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { applePodcastId, discoverFeedLink, fetchFeed, parseDuration, parseFeed, plainText, safeFetch, FeedError, type Fetcher } from '../rss';
import { pinyinLine, segmentLang, tokensToSegments, untranslated, withPinyin, type SttToken } from '../segments';
import { signSource, sourceUrl, verifySource } from '../source-url';
import { copyEnclosureToR2, fakeTokens, MAX_AUDIO_BYTES, runPodcastEpisodeJob, sonioxClient, type PodcastEpisodeMessage, type SttClient } from '../job';
import { lessonSource, lessonStretch } from '../lesson';
import { checkSegmentBatch } from '../translate';
import { episodeIdFor, getEpisode, insertEpisode, parseSegments, storeFeed } from '../store';
import { createSqliteD1, type SqliteD1 } from '../../__tests__/sqlite-d1';
import { podcastSourcePublic, podcastsRoutes } from '../../../routes/podcasts';
import { podcastPublic } from '../../../routes/podcast';

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
  <title><![CDATA[慢速中文 & Friends]]></title>
  <itunes:author>Mei &amp; Co</itunes:author>
  <description>Slow &lt;b&gt;Chinese&lt;/b&gt;</description>
  <itunes:image href="https://example.com/cover.jpg"/>
  <language>zh-cn</language>
  <item>
    <title>第一集：<![CDATA[你好 <世界>]]></title>
    <guid isPermaLink="false">ep-1</guid>
    <pubDate>Mon, 06 Oct 2026 08:00:00 +0000</pubDate>
    <itunes:duration>12:34</itunes:duration>
    <enclosure url="https://cdn.example.com/ep1.mp3?x=1&amp;y=2" length="12345678" type="audio/mpeg"/>
    <description><![CDATA[<p>Show notes with <a href="x">a link</a>.</p>]]></description>
  </item>
  <item>
    <title>Second</title>
    <itunes:duration>3723</itunes:duration>
    <enclosure url="/ep2.m4a" type="audio/x-m4a"/>
    <itunes:image href="https://example.com/ep2.jpg"/>
  </item>
  <item>
    <title>A video</title>
    <enclosure url="https://cdn.example.com/v.mp4" type="video/mp4"/>
  </item>
  <item><title>No audio</title></item>
</channel>
</rss>`;

describe('podcast feeds', () => {
  it('reads channel and episodes (CDATA, entities, durations, relative links, non-audio skipped)', () => {
    const feed = parseFeed(RSS, 'https://feeds.example.com/show.rss');
    expect(feed.title).toBe('慢速中文 & Friends');
    expect(feed.author).toBe('Mei & Co');
    expect(feed.description).toBe('Slow Chinese');
    expect(feed.image_url).toBe('https://example.com/cover.jpg');
    expect(feed.language).toBe('zh-cn');
    expect(feed.episodes).toHaveLength(2);
    const [a, b] = feed.episodes;
    expect(a).toMatchObject({ guid: 'ep-1', title: '第一集：你好 <世界>', duration_s: 754, enclosure_url: 'https://cdn.example.com/ep1.mp3?x=1&y=2', enclosure_bytes: 12345678, image_url: 'https://example.com/cover.jpg', description: 'Show notes with a link .' });
    expect(a.published_at).toBe('2026-10-06T08:00:00.000Z');
    // No guid: the enclosure URL is its identity; its own image wins.
    expect(b).toMatchObject({ guid: 'https://feeds.example.com/ep2.m4a', duration_s: 3723, image_url: 'https://example.com/ep2.jpg', published_at: null });
  });

  it('reads an Atom feed with enclosure links', () => {
    const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom show</title><logo>https://x.com/l.png</logo>
      <entry><id>urn:1</id><title>One</title><updated>2026-01-02T00:00:00Z</updated><link rel="enclosure" href="https://x.com/1.mp3" type="audio/mpeg" length="100"/></entry></feed>`;
    const feed = parseFeed(atom, 'https://x.com/feed');
    expect(feed.title).toBe('Atom show');
    expect(feed.episodes[0]).toMatchObject({ guid: 'urn:1', enclosure_url: 'https://x.com/1.mp3', enclosure_bytes: 100 });
  });

  it('refuses documents that are no podcast feed', () => {
    expect(() => parseFeed('<html><body>hi</body></html>', 'https://x.com')).toThrow(FeedError);
    expect(() => parseFeed('<rss><channel><title>x</title><item><title>t</title></item></channel></rss>', 'https://x.com')).toThrow(/no audio episodes/);
  });

  it('parses durations', () => {
    expect(parseDuration('1:02:03')).toBe(3723);
    expect(parseDuration('62:03')).toBe(3723);
    expect(parseDuration('3723')).toBe(3723);
    expect(parseDuration(' 90.4 ')).toBe(90);
    expect(parseDuration('abc')).toBeNull();
    expect(parseDuration('0')).toBeNull();
    expect(parseDuration(null)).toBeNull();
  });

  it('turns show notes into short plain text', () => {
    expect(plainText('<p>a</p><p>b &amp; c</p><script>x()</script>')).toBe('a b & c');
    expect(plainText('x'.repeat(700)).length).toBe(600);
  });

  it('finds an Apple Podcasts id and a page\'s announced feed', () => {
    expect(applePodcastId('https://podcasts.apple.com/us/podcast/slow-chinese/id1234567890')).toBe('1234567890');
    expect(applePodcastId('https://example.com/id1234567890')).toBeNull();
    expect(discoverFeedLink('<head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head>', 'https://show.com/a')).toBe('https://show.com/feed.xml');
    expect(discoverFeedLink('<head></head>', 'https://show.com/a')).toBeNull();
  });
});

function respond(body: string | Uint8Array, init: ResponseInit & { headers?: Record<string, string> } = {}): Response {
  return new Response(body as BodyInit, init);
}

describe('safe fetching (SSRF guard)', () => {
  const never: Fetcher = async () => { throw new Error('must not fetch'); };

  it.each(['http://localhost/feed', 'http://127.0.0.1/x', 'http://10.0.0.5/x', 'http://192.168.1.1/x', 'http://[::1]/x', 'ftp://example.com/x', 'http://user:pw@example.com/x', 'http://example.com:8080/x', 'http://metadata.internal/x', 'http://169.254.169.254/latest'])('refuses %s', async (url) => {
    await expect(safeFetch(url, never)).rejects.toThrow(/public http/);
  });

  it('checks every redirect hop', async () => {
    const fetcher: Fetcher = async (u) => (u.startsWith('https://example.com') ? respond('', { status: 302, headers: { Location: 'http://127.0.0.1/secret' } }) : respond('secret'));
    await expect(safeFetch('https://example.com/feed', fetcher)).rejects.toThrow(/redirects somewhere/);
  });

  it('follows public redirects and resolves the Apple link', async () => {
    const seen: string[] = [];
    const fetcher: Fetcher = async (u) => {
      seen.push(u);
      if (u.startsWith('https://itunes.apple.com/lookup')) return respond(JSON.stringify({ results: [{ feedUrl: 'https://feeds.example.com/old.rss' }] }));
      if (u === 'https://feeds.example.com/old.rss') return respond('', { status: 301, headers: { Location: 'https://feeds.example.com/new.rss' } });
      return respond(RSS);
    };
    const feed = await fetchFeed('https://podcasts.apple.com/us/podcast/x/id1234567890', fetcher);
    expect(seen).toEqual(['https://itunes.apple.com/lookup?id=1234567890&entity=podcast', 'https://feeds.example.com/old.rss', 'https://feeds.example.com/new.rss']);
    // Known by the link the lookup gave (stable across the host's redirects).
    expect(feed.feed_url).toBe('https://feeds.example.com/old.rss');
  });

  it('follows a page\'s announced feed once, and caps the size', async () => {
    const page: Fetcher = async (u) => (u.endsWith('/feed.xml') ? respond(RSS) : respond('<!doctype html><html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head></html>'));
    expect((await fetchFeed('https://show.example.com/', page)).episodes).toHaveLength(2);
    const huge: Fetcher = async () => respond('x', { headers: { 'Content-Length': String(20 * 1024 * 1024) } });
    await expect(fetchFeed('https://show.example.com/feed', huge)).rejects.toThrow(/too big/);
  });
});

function tok(text: string, start: number, end: number, speaker?: string): SttToken {
  return { text, start_ms: start, end_ms: end, speaker };
}

/** One token per character, `ms` each, starting at `start`. */
function say(text: string, start: number, ms = 250, speaker?: string): SttToken[] {
  return [...text].map((ch, i) => tok(ch, start + i * ms, start + (i + 1) * ms, speaker));
}

describe('segments from timed tokens', () => {
  it('ends a segment at a sentence end once it is long enough, and merges scraps', () => {
    const tokens = [...say('我今天去了公园散步。', 0), ...say('对。', 2600), ...say('然后我们一起吃了午饭。', 3200)];
    const segs = tokensToSegments(tokens);
    expect(segs.map((s) => s.text)).toEqual(['我今天去了公园散步。对。', '然后我们一起吃了午饭。']);
    expect(segs[0]).toMatchObject({ i: 0, start_ms: 0, end_ms: 3100, lang: 'zh' });
    expect(segs[1].i).toBe(1);
  });

  it('cuts at a long pause and at a change of speaker', () => {
    const tokens = [...say('你好', 0, 250, '1'), ...say('你好你好', 2000, 250, '1'), ...say('我很好', 3200, 250, '2')];
    const segs = tokensToSegments(tokens);
    expect(segs.map((s) => [s.text, s.speaker])).toEqual([['你好', '1'], ['你好你好', '1'], ['我很好', '2']]);
  });

  it('never goes past the hard maximum and cuts a long one at a comma', () => {
    const long = say('一二三四五六七八九十'.repeat(10), 0, 250); // 25 s with no punctuation
    const segs = tokensToSegments(long);
    expect(segs.length).toBeGreaterThan(1);
    for (const s of segs) expect(s.end_ms - s.start_ms).toBeLessThanOrEqual(20_250);
    const commas = say('我们先去这个地方看一看，然后再去那个地方吃饭，最后回家休息一下，好不好呢', 0, 400);
    const cut = tokensToSegments(commas);
    expect(cut[0].text.endsWith('，')).toBe(true);
  });

  it('keeps English spacing and marks the language', () => {
    const tokens = [tok('So', 0, 300), tok(' today', 300, 700), tok(' we', 700, 900), tok(' talk', 900, 1300), tok('.', 1300, 1350)];
    const [s] = tokensToSegments(tokens);
    expect(s.text).toBe('So today we talk.');
    expect(s.lang).toBe('en');
    expect(segmentLang('我想 order 一个 coffee')).toBe('mixed');
    const [w] = withPinyin([s]);
    expect(w.english).toBe('So today we talk.');
    expect(w.pinyin).toBeNull();
    expect(untranslated([w])).toEqual([]);
  });

  it('writes pinyin with the 一 / 不 tone changes', () => {
    expect(pinyinLine('一个人不是。')).toBe('yí gè rén bú shì。');
    expect(pinyinLine('hello')).toBeNull();
  });

  it('skips broken tokens', () => {
    const segs = tokensToSegments([{ text: '你', start_ms: NaN, end_ms: 1 } as SttToken, ...say('好的好的，没问题。', 0)]);
    expect(segs.map((s) => s.text)).toEqual(['好的好的，没问题。']);
  });
});

describe('the signed audio link', () => {
  it('verifies its own signature until it expires', async () => {
    const now = Date.UTC(2026, 9, 13);
    const url = new URL(await sourceUrl('secret', 'https://api.example.com/', 'pe_abc', now));
    expect(url.pathname).toBe('/api/podcast-source/pe_abc');
    const exp = url.searchParams.get('exp')!;
    const sig = url.searchParams.get('sig')!;
    expect(await verifySource('secret', 'pe_abc', exp, sig, now)).toBe(true);
    expect(await verifySource('secret', 'pe_other', exp, sig, now)).toBe(false);
    expect(await verifySource('other', 'pe_abc', exp, sig, now)).toBe(false);
    expect(await verifySource('secret', 'pe_abc', exp, sig, now + 7 * 3600_000)).toBe(false);
    expect(await verifySource('secret', 'pe_abc', exp, undefined, now)).toBe(false);
    expect(await verifySource('secret', 'pe_abc', String(Number(exp) + 1), sig, now)).toBe(false);
    expect(await signSource('secret', 'pe_abc', 1)).not.toBe(await signSource('secret', 'pe_abc', 2));
  });
});

describe('translation batches', () => {
  it('needs every asked segment, in English', () => {
    const req = { segments: [{ i: 3, text: '你好', speaker: null }, { i: 4, text: '再见', speaker: null }], before: [], podcastTitle: null, episodeTitle: 'x' };
    expect(checkSegmentBatch(req, { segments: [{ i: 3, english: 'Hello' }, { i: 4, english: ' Bye ' }] }).items).toEqual([{ i: 3, english: 'Hello' }, { i: 4, english: 'Bye' }]);
    expect(() => checkSegmentBatch(req, { segments: [{ i: 3, english: 'Hello' }] })).toThrow(/segments 4/);
    expect(() => checkSegmentBatch(req, { segments: [{ i: 3, english: 'Hello' }, { i: 4, english: '再见' }] })).toThrow();
  });
});

// ---------------------------------------------------------------- the job against real SQLite

interface Obj { bytes: Uint8Array; type?: string }

function fakeBucket() {
  const objects = new Map<string, Obj>();
  const partSizes: number[] = [];
  let aborted = 0;
  const bucket = {
    async put(key: string, bytes: Uint8Array | ArrayBuffer, opts?: { httpMetadata?: { contentType?: string } }) {
      objects.set(key, { bytes: new Uint8Array(bytes as ArrayBuffer), type: opts?.httpMetadata?.contentType });
    },
    async head(key: string) {
      const o = objects.get(key);
      return o ? { size: o.bytes.byteLength, etag: 'e' } : null;
    },
    async get(key: string, opts?: { range?: { offset?: number; length?: number } }) {
      const o = objects.get(key);
      if (!o) return null;
      const off = opts?.range?.offset ?? 0;
      const len = opts?.range?.length ?? o.bytes.byteLength - off;
      return { body: new Blob([o.bytes.slice(off, off + len)]).stream(), range: opts?.range ? { offset: off, length: len } : undefined };
    },
    async createMultipartUpload(key: string, opts?: { httpMetadata?: { contentType?: string } }) {
      const parts = new Map<number, Uint8Array>();
      return {
        async uploadPart(n: number, data: Uint8Array) {
          parts.set(n, data);
          partSizes.push(data.byteLength);
          return { partNumber: n, etag: `p${n}` };
        },
        async complete(list: Array<{ partNumber: number }>) {
          const chunks = list.map((p) => parts.get(p.partNumber)!);
          const all = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
          let off = 0;
          for (const c of chunks) { all.set(c, off); off += c.byteLength; }
          objects.set(key, { bytes: all, type: opts?.httpMetadata?.contentType });
        },
        async abort() { aborted++; },
      };
    },
  };
  return { bucket: bucket as unknown as R2Bucket, objects, partSizes, aborted: () => aborted };
}

/** A body of `n` bytes delivered in `chunk`-byte pieces. */
function streamOf(n: number, chunk = 1024 * 1024): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream({
    pull(ctrl) {
      if (sent >= n) return ctrl.close();
      const k = Math.min(chunk, n - sent);
      ctrl.enqueue(new Uint8Array(k).fill(sent % 251));
      sent += k;
    },
  });
}

const FEED = { feed_url: 'https://feeds.example.com/show.rss', title: 'Show', image_url: null };
const EP = { guid: 'ep-1', title: 'Episode 1', published_at: null, duration_s: 600, enclosure_url: 'https://cdn.example.com/ep1.mp3', enclosure_type: 'audio/mpeg', enclosure_bytes: null, image_url: null, description: '', link: null };

function fakeStt(tokens: SttToken[], statuses: Array<'processing' | 'completed' | 'error'> = ['processing', 'completed']): SttClient & { created: string[]; removed: string[] } {
  const created: string[] = [];
  const removed: string[] = [];
  let n = 0;
  return {
    created,
    removed,
    async create(url) { created.push(url); return 'stt-1'; },
    async status() {
      const s = statuses[Math.min(n++, statuses.length - 1)];
      return { status: s, error: s === 'error' ? 'bad audio' : null, audio_duration_ms: 31_000 };
    },
    async transcript() { return tokens; },
    async remove(id) { removed.push(id); },
  };
}

describe('runPodcastEpisodeJob', () => {
  let db: SqliteD1;
  let id: string;
  let env: Record<string, unknown>;
  let store: ReturnType<typeof fakeBucket>;
  let requeued: Array<{ msg: PodcastEpisodeMessage; delay: number }>;
  const requeue = async (msg: PodcastEpisodeMessage, delay: number) => { requeued.push({ msg, delay }); };

  beforeEach(async () => {
    db = await createSqliteD1();
    db.raw.exec("INSERT INTO users (id, email, name) VALUES ('u1', 'u1@example.com', 'U')");
    id = await episodeIdFor(FEED.feed_url, EP.guid);
    await insertEpisode(db, id, FEED, EP, 'u1', 'https://api.example.com');
    store = fakeBucket();
    env = { DB: db, AUDIO_BUCKET: store.bucket, SESSION_SECRET: 's3cret', SONIOX_API_KEY: 'k' };
    requeued = [];
  });

  const audio: Fetcher = async () => new Response(streamOf(20 * 1024 * 1024), { headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': String(20 * 1024 * 1024) } });

  it('downloads, transcribes, translates — resumable stage by stage', async () => {
    const stt = fakeStt(fakeTokens());
    let calls = 0;
    const translate = async (req: { segments: Array<{ i: number }> }) => {
      calls++;
      return { items: req.segments.map((s) => ({ i: s.i, english: `E${s.i}` })), usage: { input_tokens: 10, output_tokens: 5 } };
    };
    const deps = { fetch: audio, stt, translate, requeue };

    expect(await runPodcastEpisodeJob(env as never, id, deps)).toBe('waiting'); // downloaded, transcription asked for
    let row = (await getEpisode(db, id))!;
    expect(row).toMatchObject({ status: 'transcribing', stt_job_id: 'stt-1', audio_key: `podcast-episodes/${id}.mp3`, audio_bytes: 20 * 1024 * 1024 });
    expect(store.partSizes).toEqual([8 * 1024 * 1024, 8 * 1024 * 1024, 4 * 1024 * 1024]);
    expect(stt.created[0]).toMatch(new RegExp(`^https://api.example.com/api/podcast-source/${id}\\?exp=\\d+&sig=`));

    expect(await runPodcastEpisodeJob(env as never, id, deps)).toBe('waiting'); // still processing
    expect(await runPodcastEpisodeJob(env as never, id, deps)).toBe('done'); // completed → segments → translated
    row = (await getEpisode(db, id))!;
    expect(row.status).toBe('ready');
    expect(row.duration_ms).toBe(31_000);
    const segs = parseSegments(row.segments_json);
    expect(segs.map((s) => s.text)).toEqual(['你好，欢迎收听今天的节目。', '今天我们聊一聊周末去哪儿玩。', '我比较喜欢去公园散步。', '你呢？你周末一般做什么？', '我常常在家看书，有时候去咖啡馆。', '好的，今天的节目就到这里，下次见！']);
    expect(segs[2]).toMatchObject({ english: 'E2', speaker: '1' });
    expect(segs[0].pinyin).toBe('nǐ hǎo， huān yíng shōu tīng jīn tiān de jié mù。');
    expect(stt.removed).toEqual(['stt-1']);
    expect(calls).toBe(1);
    expect(requeued.map((r) => r.delay)).toEqual([20, 20]);
  });

  it('keeps translated batches when a later one fails, and resumes from there', async () => {
    const many: SttToken[] = [];
    for (let k = 0; k < 50; k++) many.push(...say(`第${k}句话说完了。`, k * 4000));
    let fails = 1;
    let asked: number[][] = [];
    const translate = async (req: { segments: Array<{ i: number }> }) => {
      asked.push(req.segments.map((s) => s.i));
      if (req.segments[0].i === 40 && fails-- > 0) throw new Error('overloaded');
      return { items: req.segments.map((s) => ({ i: s.i, english: `E${s.i}` })) };
    };
    const deps = { fetch: audio, stt: fakeStt(many, ['completed']), translate, requeue };
    await runPodcastEpisodeJob(env as never, id, deps); // download + create
    expect(await runPodcastEpisodeJob(env as never, id, deps)).toBe('waiting'); // batch 2 failed → retry in 60 s
    let row = (await getEpisode(db, id))!;
    expect(row).toMatchObject({ status: 'translating', attempts: 1, error: 'overloaded' });
    expect(untranslated(parseSegments(row.segments_json))).toHaveLength(10);
    asked = [];
    expect(await runPodcastEpisodeJob(env as never, id, deps)).toBe('done');
    expect(asked).toEqual([[40, 41, 42, 43, 44, 45, 46, 47, 48, 49]]);
    row = (await getEpisode(db, id))!;
    expect(row.status).toBe('ready');
  });

  it('fails for good after three failures, with the reason', async () => {
    const deps = { fetch: (async () => new Response('nope', { status: 500 })) as Fetcher, stt: fakeStt([]), requeue };
    expect(await runPodcastEpisodeJob(env as never, id, deps)).toBe('waiting');
    expect(await runPodcastEpisodeJob(env as never, id, deps)).toBe('waiting');
    expect(await runPodcastEpisodeJob(env as never, id, deps)).toBe('failed');
    const row = (await getEpisode(db, id))!;
    expect(row).toMatchObject({ status: 'failed', attempts: 3 });
    expect(row.error).toMatch(/HTTP 500/);
    expect(await runPodcastEpisodeJob(env as never, id, deps)).toBe('skipped');
  });

  it('refuses an episode that is too big at once', async () => {
    const big: Fetcher = async () => new Response(streamOf(10), { headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': String(MAX_AUDIO_BYTES + 1) } });
    expect(await runPodcastEpisodeJob(env as never, id, { fetch: big, stt: fakeStt([]), requeue })).toBe('failed');
    expect((await getEpisode(db, id))!.error).toMatch(/too big/);
  });

  it('stops a download that grows past the limit and aborts the upload', async () => {
    const lying: Fetcher = async () => new Response(streamOf(MAX_AUDIO_BYTES + 5 * 1024 * 1024, 4 * 1024 * 1024), { headers: { 'Content-Type': 'audio/mpeg' } });
    await expect(copyEnclosureToR2(store.bucket, { id, enclosure_url: EP.enclosure_url }, lying)).rejects.toThrow(/too big/);
    expect(store.aborted()).toBe(1);
    expect(store.objects.size).toBe(0);
  });

  it('runs end to end in E2E test mode without any service', async () => {
    const e2e = { ...env, E2E_TEST_MODE: 'true', SONIOX_API_KEY: undefined };
    for (let k = 0; k < 5; k++) if ((await runPodcastEpisodeJob(e2e as never, id, { requeue })) === 'done') break;
    const row = (await getEpisode(db, id))!;
    expect(row.status).toBe('ready');
    expect(parseSegments(row.segments_json)).toHaveLength(6);
    expect(store.objects.get(row.audio_key!)!.bytes.byteLength).toBeGreaterThan(1000);
  });

  it('serves the audio to the signed link only (mounted after the audio-lesson feed, like index.ts)', async () => {
    const app = new Hono();
    app.route('/api/podcast', podcastPublic);
    app.route('/api/podcast-source', podcastSourcePublic);
    const e2e = { ...env, E2E_TEST_MODE: 'true' };
    for (let k = 0; k < 5; k++) if ((await runPodcastEpisodeJob(e2e as never, id, { requeue })) === 'done') break;
    const url = new URL(await sourceUrl('s3cret', 'https://api.example.com', id));
    const ok = await app.request(`${url.pathname}${url.search}`, {}, env);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('Content-Type')).toBe('audio/mpeg');
    const ranged = await app.request(`${url.pathname}${url.search}`, { headers: { Range: 'bytes=0-99' } }, env);
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get('Content-Range')).toMatch(/^bytes 0-99\//);
    expect((await app.request(`/api/podcast-source/${id}?exp=1&sig=x`, {}, env)).status).toBe(404);
  });
});

// A real feed (Cozy Mandarin on Anchor / Spotify for Podcasters, Oct 2026), cut to its first three
// episodes: CDATA everywhere, HTML show notes, `HH:MM:SS` durations, GUIDs that are not URLs, and
// enclosures behind Anchor's tracking redirect (anchor.fm/…/play/<n>/<url-encoded CloudFront URL>).
const COZY_URL = 'https://anchor.fm/s/f0108330/podcast/rss';
const COZY_RSS = fs.readFileSync(path.resolve(__dirname, 'fixtures/cozy-mandarin.rss'), 'utf8');
const COZY_GUID = '52c6e459-cab6-499b-8375-e43f3575a681';
const COZY_CDN = 'https://d3ctxlq1ktw2nl.cloudfront.net/staging/2026-9-9/45b24332-05bb-9195-c2fa-b830c329c34b.mp3';

describe('a real episode, from Transcribe to segments (Cozy Mandarin)', () => {
  let db: SqliteD1;
  let store: ReturnType<typeof fakeBucket>;
  let sent: PodcastEpisodeMessage[];
  let env: Record<string, unknown>;
  let app: Hono;
  const ctx = { waitUntil: () => {}, passThroughOnException: () => {}, props: {} } as unknown as ExecutionContext;

  beforeEach(async () => {
    db = await createSqliteD1();
    db.raw.exec("INSERT INTO users (id, email, name) VALUES ('u1', 'u1@example.com', 'U'), ('u2', 'u2@example.com', 'V')");
    store = fakeBucket();
    sent = [];
    env = { DB: db, AUDIO_BUCKET: store.bucket, SESSION_SECRET: 's3cret', SONIOX_API_KEY: 'k', AUDIO_LESSON_QUEUE: { send: async (m: PodcastEpisodeMessage) => { sent.push(m); } } };
    // The feed as the server read and cached it (the route never refetches a fresh cache).
    await storeFeed(db, parseFeed(COZY_RSS, COZY_URL));
    app = new Hono();
    app.use('/api/*', async (c, next) => { c.set('user' as never, { id: c.req.header('X-User') ?? 'u1' } as never); await next(); });
    app.route('/api', podcastsRoutes);
  });

  const post = (body: unknown, user = 'u1') => app.request('/api/podcasts/episodes', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User': user }, body: JSON.stringify(body) }, env, ctx);

  it('reads the real feed', () => {
    const feed = parseFeed(COZY_RSS, COZY_URL);
    expect(feed.title).toMatch(/^Cozy Mandarin/);
    expect(feed.episodes).toHaveLength(3);
    expect(feed.episodes[0]).toMatchObject({ guid: COZY_GUID, title: '186. Shoes 鞋子 | Intermediate', duration_s: 598, enclosure_bytes: 9568256 });
    expect(feed.episodes[0].enclosure_url).toMatch(/^https:\/\/anchor\.fm\/s\/f0108330\/podcast\/play\/127176429\/https%3A%2F%2F/);
  });

  it('starts a NEW episode (the link to the user is written after the episode row — it references it)', async () => {
    const res = await post({ feed_url: COZY_URL, guid: COZY_GUID });
    expect(res.status).toBe(202);
    const { episode } = (await res.json()) as { episode: { id: string; status: string } };
    expect(episode.status).toBe('queued');
    expect(sent).toEqual([{ kind: 'podcast_episode', episodeId: episode.id }]);
    expect((await db.prepare('SELECT user_id FROM podcast_episode_users WHERE episode_id = ?').bind(episode.id).all()).results).toEqual([{ user_id: 'u1' }]);
    // A second person gets the same (shared) episode and their own link.
    const again = await post({ feed_url: COZY_URL, guid: COZY_GUID }, 'u2');
    expect(again.status).toBe(202);
    expect(((await again.json()) as { episode: { id: string } }).episode.id).toBe(episode.id);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM podcast_episode_users WHERE episode_id = ?').bind(episode.id).first()).toEqual({ n: 2 });
    // Unknown episode / no key: readable 4xx / 503, no rows.
    expect((await post({ feed_url: COZY_URL, guid: 'nope' })).status).toBe(404);
    env.SONIOX_API_KEY = '';
    const other = parseFeed(COZY_RSS, COZY_URL).episodes[1];
    const off = await post({ feed_url: COZY_URL, guid: other.guid });
    expect(off.status).toBe(503);
    expect(((await off.json()) as { error: string }).error).toMatch(/not set up/);
  });

  it('downloads through the tracking redirect, transcribes with Soniox, translates, and serves the segments', async () => {
    const res = await post({ feed_url: COZY_URL, guid: COZY_GUID });
    const id = ((await res.json()) as { episode: { id: string } }).episode.id;

    const AUDIO = 3 * 1024 * 1024 + 17;
    const soniox: Array<{ method: string; url: string; body?: unknown; auth: string | null }> = [];
    let polls = 0;
    const fetcher: Fetcher = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.startsWith('https://anchor.fm/')) {
        expect(init?.redirect).toBe('manual');
        return new Response('Found', { status: 302, headers: { Location: COZY_CDN } });
      }
      if (url === COZY_CDN) return new Response(streamOf(AUDIO, 65536), { headers: { 'Content-Type': 'audio/mpeg' } }); // no Content-Length
      if (url.startsWith('https://api.soniox.com/v1/')) {
        soniox.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined, auth: new Headers(init?.headers).get('Authorization') });
        if (method === 'POST' && url.endsWith('/transcriptions')) return Response.json({ id: 'tx-1', status: 'queued' }, { status: 201 });
        if (method === 'GET' && url.endsWith('/transcriptions/tx-1')) return Response.json(polls++ ? { id: 'tx-1', status: 'completed', audio_duration_ms: 598_000 } : { id: 'tx-1', status: 'processing' });
        if (method === 'GET' && url.endsWith('/transcriptions/tx-1/transcript')) return Response.json({ id: 'tx-1', text: '…', tokens: fakeTokens().map((t) => ({ ...t, confidence: 0.9, language: 'zh' })) });
        if (method === 'DELETE') return new Response(null, { status: 204 });
      }
      return new Response('unexpected ' + url, { status: 599 });
    };
    const translate = async (req: { segments: Array<{ i: number }> }) => ({ items: req.segments.map((s) => ({ i: s.i, english: `E${s.i}` })) });
    const deps = { fetch: fetcher, stt: sonioxClient('k', fetcher), translate, requeue: async () => {} };

    expect(await runPodcastEpisodeJob(env as never, id, deps)).toBe('waiting');
    let row = (await getEpisode(db, id))!;
    expect(row).toMatchObject({ status: 'transcribing', stt_job_id: 'tx-1', audio_bytes: AUDIO, audio_mime: 'audio/mpeg', error: null });
    expect(store.objects.get(row.audio_key!)!.bytes.byteLength).toBe(AUDIO);
    const create = soniox[0];
    expect(create).toMatchObject({ method: 'POST', auth: 'Bearer k', body: { language_hints: ['zh', 'en'], enable_speaker_diarization: true, enable_language_identification: true, client_reference_id: id } });
    expect((create.body as { audio_url: string }).audio_url).toMatch(new RegExp(`^http://localhost/api/podcast-source/${id}\\?exp=\\d+&sig=`));

    expect(await runPodcastEpisodeJob(env as never, id, deps)).toBe('waiting'); // processing
    expect(await runPodcastEpisodeJob(env as never, id, deps)).toBe('done');
    row = (await getEpisode(db, id))!;
    expect(row).toMatchObject({ status: 'ready', duration_ms: 598_000, error: null });
    expect(soniox.filter((r) => r.method === 'DELETE').map((r) => r.url)).toEqual(['https://api.soniox.com/v1/transcriptions/tx-1']);

    const got = await app.request(`/api/podcasts/episodes/${id}`, {}, env, ctx);
    expect(got.status).toBe(200);
    const { episode } = (await got.json()) as { episode: { status: string; segments: Array<{ text: string; english: string }> } };
    expect(episode.status).toBe('ready');
    expect(episode.segments).toHaveLength(6);
    expect(episode.segments[0]).toMatchObject({ text: '你好，欢迎收听今天的节目。', english: 'E0' });
    const list = (await (await app.request('/api/podcasts', {}, env, ctx)).json()) as { episodes: Array<{ id: string }> };
    expect(list.episodes.map((e) => e.id)).toEqual([id]);
  });

  it('a server fault comes back as JSON with a readable error, never a bare 500 page', async () => {
    const broken = { ...env, DB: { prepare: () => { throw new Error('D1_ERROR: boom'); } } };
    const res = await app.request('/api/podcasts', {}, broken, ctx);
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toMatch(/try again/);
  });
});

describe('a mini lesson from an episode', () => {
  it('takes the stretch from a segment on, Chinese only, as a story', () => {
    const segs = withPinyin(tokensToSegments([...say('你好，欢迎收听今天的节目。', 0, 250, '1'), tok('OK', 4000, 4300, '2'), tok('.', 4300, 4320, '2'), ...say('我们今天聊天气。', 6000, 250, '2')]));
    const stretch = lessonStretch(segs, 0);
    expect(stretch.map((s) => s.text)).toEqual(['你好，欢迎收听今天的节目。', '我们今天聊天气。']);
    const src = lessonSource({ id: 'pe_1', title: 'Ep', podcast_title: 'Show' }, 'u1', stretch);
    expect(src).toMatchObject({ format: 'story', title: 'Show: Ep', status: 'ready', user_id: 'u1' });
    const plan = JSON.parse(src.plan_json!);
    expect(plan.speakers.map((s: { label: string }) => s.label)).toEqual(['Speaker 1', 'Speaker 2']);
    expect(plan.chunks[1]).toMatchObject({ hanzi: '我们今天聊天气。', speaker: 'Speaker 2' });
    expect(lessonStretch(segs, 99)).toHaveLength(1);
  });
});
