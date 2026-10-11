/**
 * The pinyin check on every write path of lessons / library lessons / readers, and the scan of
 * stored content (POST /api/me/pinyin-scan), against real SQLite with every migration.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createSqliteD1, type SqliteD1 } from '../../services/__tests__/sqlite-d1';
import lessonEditor from '../lesson-editor';
import readerEditor from '../reader-editor';
import pinyinScan from '../pinyin-scan';
import { createCustomLessonFromSpec, updateCustomLessonFromSpec } from '../../services/custom-lesson';
import type { Env } from '../../types';

let db: SqliteD1;
let env: Env;

const lessonSpec = () => ({
  title: 'At the mall',
  sections: [{
    exercises: [
      { type: 'note', title: '扶梯', sentences: [{ hanzi: '我们坐扶梯上去吧。', pinyin: 'Wǒmen zuò fúqī shàngqù ba.', english: "Let's take the escalator." }] },
      {
        type: 'conversation',
        situation: 'In a mall',
        speakers: [{ name: 'A', voice: 'female' }, { name: 'B', voice: 'male' }],
        lines: [
          { speaker: 0, hanzi: '扶梯在哪儿？', pinyin: 'Fúqī zài nǎr?', english: 'Where is the escalator?' },
          { speaker: 1, hanzi: '在那儿。', pinyin: 'Zài nàr.', english: 'Over there.' },
        ],
        questions: [{ question: 'What is A looking for?', answer: 'The escalator' }],
      },
    ],
  }],
});

const readerSpec = () => ({
  title_chinese: '商场',
  title_english: 'The mall',
  difficulty_level: 'beginner',
  vocabulary_used: [{ hanzi: '扶梯', pinyin: 'fúqī', english: 'escalator' }],
  pages: [
    { content_chinese: '小明坐扶梯。', content_pinyin: 'Xiǎo Míng zuò fúqī.', content_english: 'Xiao Ming takes the escalator.' },
    { content_chinese: '他还没还书。', content_pinyin: 'Tā hái méi hái shū.', content_english: "He hasn't returned the book." },
  ],
});

function makeApp(userId = 'u1') {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', async (c, next) => {
    c.set('user', { id: userId } as never);
    await next();
  });
  app.route('/api', lessonEditor);
  app.route('/api', readerEditor);
  app.route('/api', pinyinScan);
  const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
  return (path: string, method: string, body?: unknown) =>
    app.request(path, { method, headers: { 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }, env, ctx);
}

type Fix = { path: string; where: string; hanzi: string; before: string; after: string };

beforeEach(async () => {
  db = await createSqliteD1();
  db.raw.exec("INSERT INTO users (id, email, name, role) VALUES ('u1', 'a@x', 'Tutor', 'tutor'), ('u2', 'b@x', 'Student', 'student')");
  env = { DB: db, ANTHROPIC_API_KEY: '', GEMINI_API_KEY: '' } as unknown as Env;
});

describe('pinyin check on write', () => {
  it('custom lessons (REST / Ask Claude / coach / MCP / companion all go through the service): create + update', async () => {
    const created = await createCustomLessonFromSpec(env, 'u1', lessonSpec(), 'api');
    if (!created.ok) throw new Error('rejected');
    expect(created.pinyinFixes.map((f) => [f.where, f.before, f.after])).toEqual([
      ['section 1 · exercise 1 (note) · sentence 1', 'Wǒmen zuò fúqī shàngqù ba.', 'Wǒmen zuò fútī shàngqù ba.'],
      ['section 1 · exercise 2 (conversation) · line 1', 'Fúqī zài nǎr?', 'Fútī zài nǎr?'],
    ]);
    expect(db.rows<{ spec: string }>('SELECT spec FROM custom_lessons')[0].spec).not.toContain('fúqī');

    const updated = await updateCustomLessonFromSpec(env, 'u1', created.lesson.id, lessonSpec());
    if (!updated.ok) throw new Error('rejected');
    expect(updated.pinyinFixes).toHaveLength(2);
    expect(updated.lesson.id).toBe(created.lesson.id);
    expect(updated.lesson.spec).toContain('Fútī zài nǎr?');
  });

  it('library lessons: create, import, update; the lesson editor PUT', async () => {
    const api = makeApp();
    const res = await api('/api/lesson-library', 'POST', { spec: lessonSpec() });
    expect(res.status).toBe(201);
    const item = await res.json() as { id: string; spec: unknown; pinyin_fixes: Fix[] };
    expect(item.pinyin_fixes.map((f) => f.after)).toEqual(['Wǒmen zuò fútī shàngqù ba.', 'Fútī zài nǎr?']);
    expect(JSON.stringify(item.spec)).not.toContain('úqī');

    const imported = await (await api('/api/lesson-library/import', 'POST', { spec: lessonSpec() })).json() as { pinyin_fixes: Fix[] };
    expect(imported.pinyin_fixes).toHaveLength(2);

    const put = await (await api(`/api/lesson-library/${item.id}`, 'PUT', { spec: lessonSpec() })).json() as { pinyin_fixes: Fix[]; version: number };
    expect(put.pinyin_fixes).toHaveLength(2);
    expect(put.version).toBe(1); // the corrected spec is the stored one: no content change, no version bump

    const lesson = await createCustomLessonFromSpec(env, 'u1', { title: 'Plain', sections: [{ exercises: [{ type: 'translate', english: 'escalator', reference_hanzi: '扶梯', reference_pinyin: 'fútī' }] }] }, 'api');
    if (!lesson.ok) throw new Error('rejected');
    const edited = await (await api(`/api/lessons/${lesson.lesson.id}`, 'PUT', { spec: lessonSpec() })).json() as { pinyin_fixes: Fix[] };
    expect(edited.pinyin_fixes).toHaveLength(2);
  });

  it('readers: import and PUT spec (page ids kept); a real reading (还 hái) is left alone', async () => {
    const api = makeApp();
    const res = await api('/api/readers/import', 'POST', { spec: readerSpec() });
    expect(res.status).toBe(201);
    const reader = await res.json() as { id: string; pinyin_fixes: Fix[]; spec: { pages: Array<{ id: string; content_pinyin: string }> } };
    expect(reader.pinyin_fixes.map((f) => [f.where, f.after])).toEqual([['vocabulary 1', 'fútī'], ['page 1', 'Xiǎo Míng zuò fútī.']]);
    expect(reader.spec.pages.map((p) => p.content_pinyin)).toEqual(['Xiǎo Míng zuò fútī.', 'Tā hái méi hái shū.']);

    const again = readerSpec();
    const pages = again.pages.map((p, i) => ({ ...p, id: reader.spec.pages[i].id }));
    const put = await (await api(`/api/readers/${reader.id}/spec`, 'PUT', { spec: { ...again, pages } })).json() as { pinyin_fixes: Fix[]; spec: { pages: Array<{ id: string }> } };
    expect(put.pinyin_fixes).toHaveLength(2);
    expect(put.spec.pages.map((p) => p.id)).toEqual(reader.spec.pages.map((p) => p.id));
    expect(db.rows('SELECT content_pinyin FROM reader_pages ORDER BY page_number')).toEqual([
      { content_pinyin: 'Xiǎo Míng zuò fútī.' },
      { content_pinyin: 'Tā hái méi hái shū.' },
    ]);
  });
});

describe('POST /api/me/pinyin-scan', () => {
  function seed() {
    const bad = JSON.stringify(lessonSpec());
    db.raw.exec(`INSERT INTO custom_lessons (id, user_id, title, spec, source, updated_at) VALUES
      ('L1', 'u1', 'At the mall', '${bad.replace(/'/g, "''")}', 'mcp', '2026-01-01 00:00:00'),
      ('L2', 'u2', 'Student copy', '${bad.replace(/'/g, "''")}', 'api', '2026-01-01 00:00:00'),
      ('L3', 'u2', 'Not mine', '${bad.replace(/'/g, "''")}', 'api', '2026-01-01 00:00:00')`);
    db.raw.exec("UPDATE custom_lessons SET assigned_by = 'u1' WHERE id = 'L2'");
    db.raw.exec("INSERT INTO custom_lesson_completions (id, user_id, lesson_id, correct, total, completed_at) VALUES ('c1', 'u1', 'L1', 3, 4, '2026-01-02')");
    db.raw.exec(`INSERT INTO lesson_library (id, owner_id, title, spec, updated_at) VALUES ('B1', 'u1', 'Library', '${bad.replace(/'/g, "''")}', '2026-01-01 00:00:00')`);
    db.raw.exec(`INSERT INTO graded_readers (id, user_id, title_chinese, title_english, difficulty_level, source_deck_ids, vocabulary_used, status)
      VALUES ('R1', 'u1', '商场', 'The mall', 'beginner', '[]', '[{"hanzi":"扶梯","pinyin":"fúqī","english":"escalator"}]', 'ready')`);
    db.raw.exec(`INSERT INTO reader_pages (id, reader_id, page_number, content_chinese, content_pinyin, content_english)
      VALUES ('P1', 'R1', 1, '小明坐扶梯。', 'Xiǎo Míng zuò fúqī.', 'x'), ('P2', 'R1', 2, '他很高兴。', 'Tā hěn gāoxìng.', 'y')`);
  }

  it('dry run lists the fixes and writes nothing; apply writes them in place; a second run finds nothing', async () => {
    seed();
    const api = makeApp();
    const before = db.rows('SELECT id, spec, updated_at FROM custom_lessons ORDER BY id');

    const dry = await (await api('/api/me/pinyin-scan', 'POST', {})).json() as {
      apply: boolean; scanned: Record<string, number>; items: Array<{ kind: string; id: string; owner?: string; fixes: Fix[]; status?: string }>; fix_count: number; applied: number; report: string;
    };
    expect(dry.apply).toBe(false);
    expect(dry.scanned).toEqual({ lesson: 2, library: 1, reader: 1 });
    expect(dry.items.map((i) => [i.kind, i.id, i.owner ?? null, i.fixes.length])).toEqual([
      ['lesson', 'L1', 'mine', 2],
      ['lesson', 'L2', 'student_copy', 2],
      ['library', 'B1', null, 2],
      ['reader', 'R1', null, 2],
    ]);
    expect(dry.fix_count).toBe(8);
    expect(dry.applied).toBe(0);
    expect(dry.report).toContain('dry run');
    expect(dry.report).toContain('section 1 · exercise 2 (conversation) · line 1: 扶梯在哪儿？');
    expect(dry.report).toContain('→ Fútī zài nǎr?');
    expect(db.rows('SELECT id, spec, updated_at FROM custom_lessons ORDER BY id')).toEqual(before);

    const applied = await (await api('/api/me/pinyin-scan', 'POST', { apply: true })).json() as typeof dry;
    expect(applied.applied).toBe(4);
    expect(applied.items.every((i) => i.status === 'applied')).toBe(true);
    const lessons = db.rows<{ id: string; spec: string; updated_at: string }>('SELECT id, spec, updated_at FROM custom_lessons ORDER BY id');
    expect(lessons.map((l) => [l.id, l.spec.includes('úqī'), l.updated_at !== '2026-01-01 00:00:00'])).toEqual([
      ['L1', false, true],
      ['L2', false, true],
      ['L3', true, false], // someone else's lesson: never touched
    ]);
    expect(db.rows('SELECT id, lesson_id FROM custom_lesson_completions')).toEqual([{ id: 'c1', lesson_id: 'L1' }]);
    expect(db.rows<{ spec: string }>('SELECT spec FROM lesson_library')[0].spec).toContain('Fútī zài nǎr?');
    expect(db.rows('SELECT id, content_pinyin FROM reader_pages ORDER BY page_number')).toEqual([
      { id: 'P1', content_pinyin: 'Xiǎo Míng zuò fútī.' },
      { id: 'P2', content_pinyin: 'Tā hěn gāoxìng.' },
    ]);
    expect(db.rows<{ vocabulary_used: string }>('SELECT vocabulary_used FROM graded_readers')[0].vocabulary_used).toContain('fútī');

    const third = await (await api('/api/me/pinyin-scan', 'POST', { apply: true })).json() as typeof dry;
    expect(third.items).toEqual([]);
    expect(third.report).toContain('Nothing to fix.');
  });

  it('kinds narrows the scan; bad input is a 400', async () => {
    seed();
    const api = makeApp();
    const only = await (await api('/api/me/pinyin-scan', 'POST', { kinds: ['reader'] })).json() as { scanned: Record<string, number>; items: unknown[] };
    expect(only.scanned).toEqual({ lesson: 0, library: 0, reader: 1 });
    expect(only.items).toHaveLength(1);
    expect((await api('/api/me/pinyin-scan', 'POST', { kinds: ['decks'] })).status).toBe(400);
    expect((await api('/api/me/pinyin-scan', 'POST', { apply: 'yes' })).status).toBe(400);
  });

  it('lists lines whose syllables don\'t line up under "needs a look" and never writes them, even with apply', async () => {
    const api = makeApp();
    db.raw.exec(`INSERT INTO graded_readers (id, user_id, title_chinese, title_english, difficulty_level, source_deck_ids, vocabulary_used, status)
      VALUES ('R2', 'u1', '朋友', 'Friends', 'beginner', '[]', '[{"hanzi":"漂","pinyin":"piāo / piào","english":"to float"},{"hanzi":"混血","pinyin":"hùnxuě","english":"mixed race"}]', 'ready')`);
    const page = '李友说：「没关系。你的中文说得真好！」';
    const pagePinyin = 'Lǐ Yǒu shuō: "Méi guānxi. Nǐ Zhōngwén shuō de zhēn hǎo!"';
    db.raw.run('INSERT INTO reader_pages (id, reader_id, page_number, content_chinese, content_pinyin, content_english) VALUES (?, ?, ?, ?, ?, ?)', ['P9', 'R2', 1, page, pagePinyin, 'x']);

    const dry = await (await api('/api/me/pinyin-scan', 'POST', {})).json() as {
      items: Array<{ id: string; fixes: Fix[]; warnings: Array<{ where: string; detail: string }> }>; fix_count: number; warning_count: number; report: string;
    };
    expect(dry.fix_count).toBe(1);
    expect(dry.warning_count).toBe(1);
    expect(dry.items[0].fixes.map((f) => f.after)).toEqual(['hùnxuè']);
    expect(dry.items[0].warnings).toEqual([expect.objectContaining({ where: 'page 1', detail: expect.stringContaining('one syllable missing for 的') })]);
    expect(dry.report).toContain('Needs a look (not changed)');
    expect(dry.report).not.toContain('line rebuilt');

    await api('/api/me/pinyin-scan', 'POST', { apply: true });
    expect(db.rows('SELECT content_pinyin FROM reader_pages WHERE id = ?', ['P9'])).toEqual([{ content_pinyin: pagePinyin }]);
    const vocab = db.rows<{ vocabulary_used: string }>("SELECT vocabulary_used FROM graded_readers WHERE id = 'R2'")[0].vocabulary_used;
    expect(vocab).toContain('piāo / piào');
    expect(vocab).toContain('hùnxuè');
  });
});
