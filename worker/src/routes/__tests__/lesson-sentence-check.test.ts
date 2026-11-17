/**
 * POST /api/lessons/sentence-feedback + /sentence-fix (sentence_making's honest grade; docs/STUDY_SESSION.md
 * "Sentence making: an honest verdict"), run with the E2E stand-in against real SQLite (the cache table).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createSqliteD1, type SqliteD1 } from '../../services/__tests__/sqlite-d1';
import lessonAttempts from '../lesson-attempts';
import type { Env } from '../../types';

function client(env: Env) {
  const app = new Hono<{ Bindings: Env }>();
  app.use('/api/*', async (c, next) => {
    c.set('user', { id: 'user-1' } as never);
    await next();
  });
  app.route('/api', lessonAttempts);
  return async (path: string, body: unknown) => {
    const res = await app.request(`/api${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env);
    return { status: res.status, json: (await res.json()) as any };
  };
}

const BENLAI = { words: ['本来', '要'], sentence: '我本来要去健身馆，但是我学中文。' };

describe('POST /api/lessons/sentence-feedback', () => {
  let db: SqliteD1;
  let post: ReturnType<typeof client>;
  beforeEach(async () => {
    db = await createSqliteD1();
    post = client({ DB: db, E2E_TEST_MODE: 'true' } as unknown as Env);
  });

  it('Jerome\'s 本来…要 sentence → needs_work (legacy verdict minor), a headline, fixable, no corrected sentence; cached', async () => {
    const r = await post('/lessons/sentence-feedback', BENLAI);
    expect(r.status).toBe(200);
    expect(r.json.feedback).toMatchObject({ grade: 'needs_work', verdict: 'minor', fixable: true, uses_all_words: true });
    expect(r.json.feedback.headline).toBe('本来…要 used right — the second half doesn’t follow');
    expect(r.json.feedback.corrected).toBeUndefined();
    expect(r.json.cached).toBe(false);
    const again = await post('/lessons/sentence-feedback', { ...BENLAI, sentence: '我本来要去健身馆 但是我学中文' });
    expect(again.json.cached).toBe(true);
    expect(again.json.feedback.grade).toBe('needs_work');
  });

  it('a right sentence stays right; a missing word is wrong', async () => {
    expect((await post('/lessons/sentence-feedback', { ...BENLAI, sentence: '我本来要去健身房，可是后来下雨了。' })).json.feedback.grade).toBe('right');
    expect((await post('/lessons/sentence-feedback', { ...BENLAI, sentence: '我想去健身房。' })).json.feedback.grade).toBe('wrong');
  });

  it('a spoken sentence is scrubbed of the recogniser\'s punctuation (a pause is never grammar)', async () => {
    const r = await post('/lessons/sentence-feedback', { words: ['不知道', '有没有'], sentence: '我不知道。 我妹妹有，不有新电脑。', input: 'spoken' });
    expect(r.json.sentence).toBe('我不知道我妹妹有不有新电脑');
    expect(r.json.feedback.grade).toBe('needs_work');
    expect(`${r.json.feedback.headline} ${r.json.feedback.reason}`).not.toMatch(/split|separate|punctuation/i);
  });

  it('400 without words or a sentence; 503 without a model', async () => {
    expect((await post('/lessons/sentence-feedback', { words: [], sentence: '' })).status).toBe(400);
    const none = client({ DB: db } as unknown as Env);
    expect((await none('/lessons/sentence-feedback', BENLAI)).status).toBe(503);
    expect((await none('/lessons/sentence-fix', BENLAI)).status).toBe(503);
  });
});

describe('POST /api/lessons/sentence-fix', () => {
  it('his sentence minimally fixed, with pinyin; cached per exercise + sentence', async () => {
    const db = await createSqliteD1();
    const post = client({ DB: db, E2E_TEST_MODE: 'true' } as unknown as Env);
    const r = await post('/lessons/sentence-fix', BENLAI);
    expect(r.status).toBe(200);
    expect(r.json.fix.hanzi).toBe('我本来要去健身房，可是后来去学中文了。');
    expect(r.json.fix.pinyin).toMatch(/běnlái/);
    expect(r.json.cached).toBe(false);
    expect((await post('/lessons/sentence-fix', BENLAI)).json.cached).toBe(true);
  });
});
