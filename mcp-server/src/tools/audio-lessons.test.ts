import { describe, it, expect } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { registerAudioLessonTools } from './audio-lessons';
import type { ToolContext } from './context';

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>;

const SUMMARY = { id: 'a1', format: 'sleep', title: '银行和邮局', status: 'speaking', progress: 'Recording 3 of 40 clips…', progress_done: 3, progress_total: 40, error: null, duration_ms: null, size_bytes: null, word_count: 2, audio_version: null, created_at: '2026-10-06', finished_at: null };
const DETAIL = {
  ...SUMMARY, status: 'ready', duration_ms: 600_000, input: { text: '…' }, words: [{ hanzi: '邮局', pinyin: 'yóujú', english: 'post office' }],
  chapters: [{ title: '开始', start_ms: 0 }, { title: '邮局 yóujú', start_ms: 65_000 }],
  transcript: [
    { start_ms: 0, lang: 'zh', voice: 'sleep', text: '这是一个新词。', chapter: 1 },
    { start_ms: 1, lang: 'zh', voice: 'sleep', text: '邮局', pinyin: 'yóujú', english: 'post office', chapter: 1 },
    { start_ms: 2, lang: 'zh', voice: 'sleep', text: '邮局', chapter: 1 },
    { start_ms: 3, lang: 'en', voice: 'narrator', text: 'Hello', chapter: 1 },
  ],
  speakers: [], usage: null, for_relationship_id: null,
};

const FEED = { url: 'https://api.example/api/podcast/TOKEN/feed.xml', podcast_url: 'podcast://api.example/api/podcast/TOKEN/feed.xml', apple_url: 'pcast://api.example/api/podcast/TOKEN/feed.xml', created_at: '2026-10-07', rotated_at: null, last_fetched_at: null, fetch_count: 0 };

function fakeContext() {
  const tools = new Map<string, Handler>();
  const schemas = new Map<string, Record<string, { safeParse: (v: unknown) => { success: boolean } }>>();
  const descriptions = new Map<string, string>();
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const api = {
    get: async (path: string) => { calls.push({ method: 'GET', path }); return path === '/api/me/podcast-feed' ? { feed: FEED } : path.endsWith('/a1') ? { lesson: DETAIL } : { lessons: [SUMMARY] }; },
    post: async (path: string, body: unknown) => {
      calls.push({ method: 'POST', path, body });
      const story = (body as { format?: string }).format === 'story';
      return { lesson: { ...SUMMARY, status: 'queued', ...(story ? { format: 'story', word_count: 0 } : {}) }, ...(story ? { chunks: 42, notice: 'The text is long: this lesson covers the first 1,500 of 4,000 characters (about 60 minutes). Paste the rest as another lesson.' } : {}) };
    },
  };
  const server = {
    tool: (name: string, d: string, s: unknown, handler: Handler) => {
      tools.set(name, handler);
      descriptions.set(name, d);
      schemas.set(name, s as never);
    },
  };
  registerAudioLessonTools({ server, api, env: {}, userId: 'u1' } as unknown as ToolContext);
  return { tools, calls, schemas, descriptions };
}

const text = (r: CallToolResult) => r.content.map((c) => (c.type === 'text' ? c.text : '')).join('');

describe('audio lesson tools', () => {
  it('creates through the API and never sends anything', async () => {
    const { tools, calls } = fakeContext();
    const out = JSON.parse(text(await tools.get('create_audio_lesson')!({ format: 'sleep', text: '我家旁边有一个邮局。', for_relationship_id: 'rel-1' })));
    expect(calls).toEqual([{ method: 'POST', path: '/api/audio-lessons', body: { format: 'sleep', text: '我家旁边有一个邮局。', for_relationship_id: 'rel-1' } }]);
    expect(out.sent).toBe(false);
    expect(out.lesson).toMatchObject({ id: 'a1', status: 'queued', listen_path: '/audio-lessons/a1' });
  });

  it('story: a pasted conversation → the API with format story; the chunk count and the cut notice come back', async () => {
    const { tools, calls, schemas, descriptions } = fakeContext();
    expect(schemas.get('create_audio_lesson')!.format.safeParse('story').success).toBe(true);
    expect(schemas.get('create_audio_lesson')!.format.safeParse('podcast').success).toBe(false);
    // The description says when to use which format.
    const d = descriptions.get('create_audio_lesson')!;
    for (const f of ['"dialogue"', '"sleep"', '"story"']) expect(d).toContain(f);
    expect(d).toMatch(/LONGER STORY OR CONVERSATION/);
    const text0 = 'A：你好！\nB：你好，你去哪儿？';
    const out = JSON.parse(text(await tools.get('create_audio_lesson')!({ format: 'story', text: text0 })));
    expect(calls).toEqual([{ method: 'POST', path: '/api/audio-lessons', body: { format: 'story', text: text0 } }]);
    expect(out).toMatchObject({ chunks: 42, sent: false, lesson: { format: 'story', listen_path: '/audio-lessons/a1' } });
    expect(out.notice).toMatch(/covers the first/);
  });

  it('lists with progress while being made', async () => {
    const { tools } = fakeContext();
    const out = JSON.parse(text(await tools.get('list_audio_lessons')!({})));
    expect(out.lessons[0]).toMatchObject({ status: 'speaking', clips_done: 3, clips_total: 40 });
  });

  it('get: chapters as times, the Chinese transcript with repeats folded', async () => {
    const { tools } = fakeContext();
    const out = JSON.parse(text(await tools.get('get_audio_lesson')!({ id: 'a1' })));
    expect(out.lesson.minutes).toBe(10);
    expect(out.lesson.chapters[1]).toEqual({ title: '邮局 yóujú', at: '1:05' });
    expect(out.lesson.transcript).toEqual(['这是一个新词。', '邮局 — post office']);
  });

  it('get_audio_lesson_feed: the signed-in user’s feed link from the API', async () => {
    const { tools, calls } = fakeContext();
    const out = JSON.parse(text(await tools.get('get_audio_lesson_feed')!({})));
    expect(calls).toEqual([{ method: 'GET', path: '/api/me/podcast-feed' }]);
    expect(out).toMatchObject({ feed_url: FEED.url, open_in_podcast_app: FEED.podcast_url, open_in_apple_podcasts: FEED.apple_url });
    expect(out.how_to).toContain('Reset link');
  });
});
