import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createMockD1, MockD1Database } from '../../services/__tests__/d1-mock';

let idCounter = 0;
vi.stubGlobal('crypto', {
  randomUUID: () => `uuid-${++idCounter}`,
});

import readerEditor from '../reader-editor';
import lessonEditor from '../lesson-editor';
import { Env } from '../../types';

const OWNER = 'user-1';

function readerRow() {
  return {
    id: 'reader-1',
    user_id: OWNER,
    title_chinese: '长春的冬天',
    title_english: 'Winter in Changchun',
    difficulty_level: 'beginner',
    topic: 'winter',
    source_deck_ids: '[]',
    vocabulary_used: JSON.stringify([{ hanzi: '冷', pinyin: 'lěng', english: 'cold' }]),
    status: 'ready',
    error_message: null,
    is_published: 1,
    creator_role: 'tutor',
    created_at: '2026-01-01T00:00:00Z',
  };
}

function pageRows() {
  return [
    { id: 'p1', reader_id: 'reader-1', page_number: 1, content_chinese: '长春的冬天很冷。', content_pinyin: 'Chángchūn de dōngtiān hěn lěng.', content_english: 'Winter in Changchun is very cold.', image_url: 'reader-images/p1.png', image_prompt: 'snowy city' },
    { id: 'p2', reader_id: 'reader-1', page_number: 2, content_chinese: '我每天穿大衣。', content_pinyin: 'wǒ měitiān chuān dàyī.', content_english: 'I wear a coat every day.', image_url: 'reader-images/p2.png', image_prompt: 'a person in a coat' },
    { id: 'p3', reader_id: 'reader-1', page_number: 3, content_chinese: '晚上我喝热茶。', content_pinyin: 'wǎnshang wǒ hē rè chá.', content_english: 'In the evening I drink hot tea.', image_url: 'reader-images/p3.png', image_prompt: 'tea' },
  ];
}

function makeApp(db: MockD1Database, userId = OWNER, envOverrides: Partial<Env> = {}) {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', async (c, next) => {
    c.set('user', { id: userId } as never);
    await next();
  });
  app.route('/api', readerEditor);
  app.route('/api', lessonEditor);
  const sendBatch = vi.fn(async () => undefined);
  const del = vi.fn(async () => undefined);
  const env = {
    DB: db,
    ANTHROPIC_API_KEY: '',
    GEMINI_API_KEY: 'gemini',
    IMAGE_QUEUE: { sendBatch },
    AUDIO_BUCKET: { delete: del },
    ...envOverrides,
  } as unknown as Env;
  return { request: (path: string, init?: RequestInit) => app.request(path, init, env), sendBatch, del };
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

describe('reader editor routes', () => {
  let db: MockD1Database;

  beforeEach(() => {
    db = createMockD1();
    idCounter = 0;
    db.addResult('FROM graded_readers WHERE id = ? AND user_id = ?', readerRow());
    db.addAllResult('FROM reader_pages WHERE reader_id = ?', pageRows());
  });

  describe('GET /readers/:id/spec', () => {
    it('returns the reader as a spec with page ids and image keys', async () => {
      const { request } = makeApp(db);
      const res = await request('/api/readers/reader-1/spec');
      expect(res.status).toBe(200);
      const body = await res.json() as { id: string; spec: { pages: Array<{ id: string; image_url: string }>; vocabulary_used: unknown[] } };
      expect(body.id).toBe('reader-1');
      expect(body.spec.pages.map(p => p.id)).toEqual(['p1', 'p2', 'p3']);
      expect(body.spec.pages[0].image_url).toBe('reader-images/p1.png');
      expect(body.spec.vocabulary_used).toHaveLength(1);
    });

    it('404s for someone else', async () => {
      const { request } = makeApp(db, 'intruder');
      db.reset();
      const res = await request('/api/readers/reader-1/spec');
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /readers/:id/spec', () => {
    it('upserts pages by id, renumbers, keeps unchanged illustrations, clears changed ones and queues new ones', async () => {
      const { request, sendBatch, del } = makeApp(db);
      const res = await request('/api/readers/reader-1/spec', json('PUT', {
        spec: {
          title_chinese: '长春的冬天',
          title_english: 'Changchun Winter',
          difficulty_level: 'beginner',
          topic: null,
          pages: [
            // p2 first: same prompt → keeps its image
            { id: 'p2', content_chinese: '我每天都穿大衣。', content_pinyin: 'wǒ měitiān dōu chuān dàyī.', content_english: 'I wear a coat every day.', image_prompt: 'a person in a coat' },
            // p1: prompt changed → image cleared and regenerated
            { id: 'p1', content_chinese: '长春的冬天很冷。', content_pinyin: 'Chángchūn de dōngtiān hěn lěng.', content_english: 'Winter in Changchun is very cold.', image_prompt: 'a snowy street with a red bus' },
            // new page, no id, with a prompt → inserted and queued
            { content_chinese: '外面刮风了。', content_pinyin: 'wàimiàn guā fēng le.', content_english: 'It is windy outside.', image_prompt: 'wind blowing snow' },
            // new page without prompt → inserted, nothing queued
            { content_chinese: '我回家了。', content_pinyin: '', content_english: 'I went home.' },
          ],
          // p3 omitted → deleted
        },
      }));
      expect(res.status).toBe(200);
      const body = await res.json() as { image_jobs: number; spec: { title_english: string; pages: Array<{ id: string; image_url: string | null }> } };
      expect(body.spec.title_english).toBe('Changchun Winter');
      expect(body.spec.pages.map(p => p.id)).toEqual(['p2', 'p1', 'uuid-1', 'uuid-2']);
      expect(body.spec.pages.map(p => p.image_url)).toEqual(['reader-images/p2.png', null, null, null]);
      expect(body.image_jobs).toBe(2);

      const queries = db.getQueries();
      const meta = queries.find(q => q.sql.includes('UPDATE graded_readers'));
      expect(meta?.params.slice(0, 4)).toEqual(['长春的冬天', 'Changchun Winter', 'beginner', null]);

      const updates = queries.filter(q => q.sql.includes('UPDATE reader_pages'));
      // params: page_number, chinese, pinyin, english, image_prompt, image_url, id, reader_id
      expect(updates.map(q => [q.params[0], q.params[6], q.params[5]])).toEqual([
        [1, 'p2', 'reader-images/p2.png'],
        [2, 'p1', null],
      ]);
      const inserts = queries.filter(q => q.sql.includes('INSERT INTO reader_pages'));
      expect(inserts.map(q => [q.params[0], q.params[2], q.params[6]])).toEqual([
        ['uuid-1', 3, 'wind blowing snow'],
        ['uuid-2', 4, null],
      ]);
      const deletes = queries.filter(q => q.sql.includes('DELETE FROM reader_pages'));
      expect(deletes.map(q => q.params[0])).toEqual(['p3']);

      // Stale illustrations are removed from R2 (changed prompt + deleted page)
      expect(del.mock.calls.map(c => c[0]).sort()).toEqual(['reader-images/p1.png', 'reader-images/p3.png']);

      // Image jobs go on the shared image queue with the reader message shape
      expect(sendBatch).toHaveBeenCalledTimes(1);
      const messages = sendBatch.mock.calls[0][0] as Array<{ body: { readerId: string; pageId: string; imagePrompt: string } }>;
      expect(messages.map(m => [m.body.readerId, m.body.pageId, m.body.imagePrompt])).toEqual([
        ['reader-1', 'p1', 'a snowy street with a red bus'],
        ['reader-1', 'uuid-1', 'wind blowing snow'],
      ]);
    });

    it('does not queue images without a Gemini key', async () => {
      const { request, sendBatch } = makeApp(db, OWNER, { GEMINI_API_KEY: '' });
      const res = await request('/api/readers/reader-1/spec', json('PUT', {
        spec: {
          title_chinese: '长春的冬天', title_english: 'Winter', difficulty_level: 'beginner',
          pages: [{ content_chinese: '新的一页。', content_pinyin: '', content_english: 'A new page.', image_prompt: 'x' }],
        },
      }));
      expect(res.status).toBe(200);
      expect((await res.json() as { image_jobs: number }).image_jobs).toBe(0);
      expect(sendBatch).not.toHaveBeenCalled();
    });

    it('rejects an invalid spec with the problem list', async () => {
      const { request } = makeApp(db);
      const res = await request('/api/readers/reader-1/spec', json('PUT', { spec: { title_chinese: '', title_english: 'x', difficulty_level: 'beginner', pages: [] } }));
      expect(res.status).toBe(400);
      const body = await res.json() as { problems: string[] };
      expect(body.problems).toContain('title_chinese is required');
      expect(body.problems).toContain('A reader needs at least one page');
      expect(db.getQueries().some(q => q.sql.includes('UPDATE'))).toBe(false);
    });

    it('404s for a reader the caller does not own', async () => {
      db.reset();
      const { request } = makeApp(db, 'intruder');
      const res = await request('/api/readers/reader-1/spec', json('PUT', { spec: {} }));
      expect(res.status).toBe(404);
    });
  });

  describe('POST /readers/import', () => {
    it('creates a new unpublished reader with fresh page ids', async () => {
      db.reset();
      const { request, sendBatch } = makeApp(db);
      const res = await request('/api/readers/import', json('POST', {
        spec: {
          title_chinese: '小猫', title_english: 'The Kitten', difficulty_level: 'elementary', topic: 'animals',
          vocabulary_used: [{ hanzi: '猫', pinyin: 'māo', english: 'cat' }],
          pages: [
            { id: 'someone-elses-id', content_chinese: '我有一只猫。', content_pinyin: 'wǒ yǒu yì zhī māo.', content_english: 'I have a cat.', image_prompt: 'a kitten', image_url: 'reader-images/foreign.png' },
          ],
        },
      }));
      expect(res.status).toBe(201);
      const body = await res.json() as { id: string; user_id: string; is_published: number; spec: { pages: Array<{ id: string; image_url: string | null }> }; image_jobs: number };
      expect(body.id).toBe('uuid-1');
      expect(body.user_id).toBe(OWNER);
      expect(body.is_published).toBe(0);
      expect(body.spec.pages[0].id).toBe('uuid-2');
      expect(body.spec.pages[0].image_url).toBeNull();
      expect(body.image_jobs).toBe(1);
      expect(sendBatch).toHaveBeenCalledTimes(1);

      const insert = db.getQueries().find(q => q.sql.includes('INSERT INTO graded_readers'));
      // id, user_id, title_chinese, title_english, difficulty_level, topic, vocabulary_used
      expect(insert?.params).toEqual(['uuid-1', OWNER, '小猫', 'The Kitten', 'elementary', 'animals', JSON.stringify([{ hanzi: '猫', pinyin: 'māo', english: 'cat' }])]);
    });

    it('validates the spec', async () => {
      const { request } = makeApp(db);
      const res = await request('/api/readers/import', json('POST', { spec: { pages: [] } }));
      expect(res.status).toBe(400);
    });
  });

  describe('exports', () => {
    it('serves markdown, json and csv with download headers', async () => {
      const { request } = makeApp(db);
      const md = await request('/api/readers/reader-1/export.md');
      expect(md.status).toBe(200);
      expect(md.headers.get('Content-Type')).toContain('text/markdown');
      expect(md.headers.get('Content-Disposition')).toContain('Winter-in-Changchun.md');
      expect(await md.text()).toContain('# 长春的冬天');

      const js = await request('/api/readers/reader-1/export.json');
      const parsed = JSON.parse(await js.text()) as { pages: Array<Record<string, unknown>> };
      expect(parsed.pages[0].id).toBeUndefined();
      expect(parsed.pages[0].image_url).toBeUndefined();

      const csv = await request('/api/readers/reader-1/export.csv');
      expect(await csv.text()).toBe('hanzi,pinyin,english\n冷,lěng,cold\n');
    });

    it('rejects unknown formats', async () => {
      const { request } = makeApp(db);
      const res = await request('/api/readers/reader-1/export.xml');
      expect(res.status).toBe(404);
    });
  });

  describe('editor chat with a reader target', () => {
    it('gets or creates the chat for reader/<id> and computes reader diffs', async () => {
      db.addResult('FROM editor_chats WHERE id = ?', { id: 'uuid-1', owner_id: OWNER, target_type: 'reader', target_id: 'reader-1', created_at: '', updated_at: '' });
      const snapshot = {
        title_chinese: '长春的冬天', title_english: 'Winter in Changchun', difficulty_level: 'beginner', topic: 'winter',
        pages: pageRows().map(({ id, content_chinese, content_pinyin, content_english, image_prompt }) => ({ id, content_chinese, content_pinyin, content_english, image_prompt })),
      };
      const proposed = { ...snapshot, pages: [snapshot.pages[0], { ...snapshot.pages[1], content_chinese: '我每天都穿大衣。' }] };
      db.addAllResult('FROM editor_chat_messages WHERE chat_id = ?', [
        { id: 'm1', chat_id: 'uuid-1', role: 'user', content: 'Simplify page 2', spec_snapshot: JSON.stringify(snapshot), proposed_spec: null, proposal_status: null, created_at: '' },
        { id: 'm2', chat_id: 'uuid-1', role: 'assistant', content: 'Done', spec_snapshot: JSON.stringify(snapshot), proposed_spec: JSON.stringify(proposed), proposal_status: 'pending', created_at: '' },
      ]);
      const { request } = makeApp(db);
      const res = await request('/api/editor-chat/reader/reader-1');
      expect(res.status).toBe(200);
      const body = await res.json() as { chat: { target_type: string }; messages: Array<{ proposal_diff: { pages: Array<{ kind: string; index: number }> } | null }> };
      expect(body.chat.target_type).toBe('reader');
      const insert = db.getQueries().find(q => q.sql.includes('INSERT INTO editor_chats'));
      expect(insert?.params).toEqual(['uuid-1', OWNER, 'reader', 'reader-1']);
      const diff = body.messages[1].proposal_diff!;
      expect(diff.pages.map(p => `${p.kind}@${p.index}`).sort()).toEqual(['changed@1', 'removed@2']);
    });

    it('503s on send when Claude is not configured', async () => {
      db.addResult('FROM editor_chats WHERE id = ?', { id: 'uuid-1', owner_id: OWNER, target_type: 'reader', target_id: 'reader-1', created_at: '', updated_at: '' });
      const { request } = makeApp(db);
      const res = await request('/api/editor-chat/reader/reader-1/messages', json('POST', { message: 'hi', current_spec: { pages: [] } }));
      expect(res.status).toBe(503);
    });

    it('404s for a reader the caller cannot edit', async () => {
      db.reset();
      const { request } = makeApp(db, 'intruder');
      const res = await request('/api/editor-chat/reader/reader-1');
      expect(res.status).toBe(404);
    });
  });
});
