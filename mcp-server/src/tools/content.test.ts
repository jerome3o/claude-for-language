import { describe, it, expect } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  readerSpecProblems,
  lessonSpecProblems,
  trimReader,
  filterReaders,
  normalizeNotes,
  notesMissingAudio,
  READER_SPEC_DOC,
  LESSON_SPEC_DOC,
} from './content/specs';
import { registerReaderTools } from './content/readers';
import { registerLessonLibraryTools } from './content/lessons';
import { registerStudentDeckTools } from './content/decks';
import { registerContentTools } from './content';
import type { ToolContext } from './context';
import { ApiError } from '../api';

// ============ Pure helpers ============

const validReader = {
  title_chinese: '小猫找家',
  title_english: 'The Kitten Finds a Home',
  difficulty_level: 'beginner',
  pages: [
    { content_chinese: '小猫很饿。', content_pinyin: 'xiǎo māo hěn è', content_english: 'The kitten is hungry.', image_prompt: 'a small hungry kitten' },
    { content_chinese: '它找到了家。', content_pinyin: '', content_english: 'It found a home.' },
  ],
};

describe('spec pre-validation', () => {
  it('accepts a valid reader spec and rejects a broken one with the API validator problems', () => {
    expect(readerSpecProblems(validReader)).toEqual([]);
    const problems = readerSpecProblems({ title_chinese: '', difficulty_level: 'hard', pages: [] });
    expect(problems).toEqual(expect.arrayContaining([
      'title_chinese is required',
      'title_english is required',
      expect.stringContaining('difficulty_level must be one of'),
      'A reader needs at least one page',
    ]));
  });

  it('validates lesson specs with the shared validator', () => {
    expect(lessonSpecProblems({
      title: 'Tones', sections: [{ exercises: [{ type: 'match', pairs: [{ hanzi: '有', english: 'have' }, { hanzi: '又', english: 'again' }] }] }],
    })).toEqual([]);
    expect(lessonSpecProblems({ title: 'x', sections: [] }).length).toBeGreaterThan(0);
  });

  it('documents the exact field names Claude must produce', () => {
    for (const field of ['title_chinese', 'title_english', 'difficulty_level', 'vocabulary_used', 'content_chinese', 'content_pinyin', 'content_english', 'image_prompt']) {
      expect(READER_SPEC_DOC).toContain(field);
    }
    for (const type of ['note', 'scramble', 'choice', 'translate', 'match', 'describe_image', 'speak', 'listen_choice', 'listen_translate']) {
      expect(LESSON_SPEC_DOC).toContain(`type:"${type}"`);
    }
  });
});

describe('trimReader / filterReaders', () => {
  const rows = [
    { id: 'r1', title_chinese: '小猫找家', title_english: 'Kitten', difficulty_level: 'beginner', topic: 'pets', status: 'ready', is_published: 1, creator_role: 'tutor', created_at: '2026-09-01', pages: [{}, {}, {}] },
    { id: 'r2', title_chinese: '生成中...', title_english: 'Story about: zoo', difficulty_level: 'elementary', topic: 'zoo', status: 'generating', created_at: '2026-09-02', pages: [] },
    { id: 'r3', title_chinese: 'x', title_english: 'y', difficulty_level: 'beginner', topic: null, status: 'failed', error_message: 'boom', created_at: '2026-09-03' },
  ];

  it('keeps only the fields the model needs and counts pages', () => {
    expect(trimReader(rows[0])).toEqual({
      id: 'r1', title_chinese: '小猫找家', title_english: 'Kitten', difficulty_level: 'beginner', topic: 'pets',
      status: 'ready', page_count: 3, created_at: '2026-09-01', creator_role: 'tutor', is_published: true,
    });
    expect(trimReader(rows[2])).toMatchObject({ page_count: 0, creator_role: 'student', error_message: 'boom', topic: null });
    expect(Object.keys(trimReader(rows[1]))).not.toContain('pages');
  });

  it('filters by status, default all', () => {
    expect(filterReaders(rows, undefined).map(r => r.id)).toEqual(['r1', 'r2', 'r3']);
    expect(filterReaders(rows, 'all').map(r => r.id)).toEqual(['r1', 'r2', 'r3']);
    expect(filterReaders(rows, 'failed').map(r => r.id)).toEqual(['r3']);
  });
});

describe('normalizeNotes', () => {
  it('trims, drops incomplete / tone-number / duplicate notes and says why', () => {
    const { notes, rejected } = normalizeNotes([
      { hanzi: ' 你好 ', pinyin: 'nǐ hǎo', english: 'hello', fun_facts: '  ' },
      { hanzi: '谢谢', pinyin: 'xie4 xie', english: 'thanks' },
      { hanzi: '再见', pinyin: '', english: 'bye' },
      { hanzi: '你好', pinyin: 'nǐ hǎo', english: 'hi again' },
      { hanzi: '猫', pinyin: 'māo', english: 'cat', sentence_clue: '我有一只猫。' },
      { hanzi: '(请)坐', pinyin: 'qǐng zuò', english: 'sit' },
    ]);
    expect(notes).toEqual([
      { hanzi: '你好', pinyin: 'nǐ hǎo', english: 'hello' },
      { hanzi: '猫', pinyin: 'māo', english: 'cat', sentence_clue: '我有一只猫。' },
    ]);
    expect(rejected.map(r => r.hanzi)).toEqual(['谢谢', '再见', '你好', '(请)坐']);
    expect(rejected[0].reason).toContain('tone numbers');
    expect(rejected[2].reason).toContain('duplicate');
    expect(rejected[3].reason).toContain('fun_facts');
  });

  it('lists the notes still without audio', () => {
    expect(notesMissingAudio([{ id: 'a', audio_url: 'x.mp3' }, { id: 'b', audio_url: null }], ['a', 'b', 'c'])).toEqual(['b', 'c']);
  });
});

// ============ Tools against a fake context ============

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>;

interface Call { method: string; path: string; body?: unknown }

function fakeContext(routes: Record<string, (body?: unknown) => unknown>) {
  const tools = new Map<string, Handler>();
  const calls: Call[] = [];
  const respond = (method: string, path: string, body?: unknown) => {
    calls.push({ method, path, body });
    const key = `${method} ${path}`;
    const route = routes[key] ?? routes[`${method} ${path.split('?')[0]}`];
    if (!route) throw new ApiError(404, `No fake route for ${key}`, null);
    return Promise.resolve(route(body));
  };
  const api = {
    get: (path: string, query?: Record<string, unknown>) => respond('GET', query && Object.keys(query).length ? `${path}?${new URLSearchParams(query as Record<string, string>)}` : path),
    post: (path: string, body?: unknown) => respond('POST', path, body ?? {}),
    put: (path: string, body?: unknown) => respond('PUT', path, body ?? {}),
    patch: (path: string, body?: unknown) => respond('PATCH', path, body ?? {}),
    delete: (path: string) => respond('DELETE', path),
  };
  const server = {
    tool: (name: string, _description: string, _shape: unknown, handler: Handler) => {
      tools.set(name, handler);
    },
  };
  const ctx = { server, api, env: {}, userId: 'tutor-1', userName: 'Tutor', userEmail: null } as unknown as ToolContext;
  return { ctx, tools, calls };
}

function text(result: CallToolResult): string {
  return result.content.map(c => (c.type === 'text' ? c.text : '')).join('');
}

describe('registerContentTools', () => {
  it('registers every content tool once', () => {
    const { ctx, tools } = fakeContext({});
    registerContentTools(ctx);
    expect([...tools.keys()].sort()).toEqual([
      'add_words_to_student_deck', 'archive_library_lesson', 'assign_lesson_to_students', 'create_deck_for_student',
      'create_library_lesson', 'create_reader', 'delete_reader', 'duplicate_library_lesson', 'export_library_lesson',
      'export_reader', 'generate_reader', 'get_lesson_assignments', 'get_library_lesson', 'get_reader', 'get_starter_deck',
      'list_lesson_library', 'list_readers', 'list_student_lessons', 'list_student_readers', 'push_lesson_update',
      'retry_reader', 'share_reader_with_student', 'update_library_lesson', 'update_reader',
    ]);
  });
});

describe('reader tools', () => {
  it('list_readers reads the readers with pages and trims them', async () => {
    const { ctx, tools, calls } = fakeContext({
      'GET /api/readers?include_pages=true': () => [
        { id: 'r1', title_chinese: '小猫', title_english: 'Kitten', difficulty_level: 'beginner', topic: null, status: 'ready', created_at: 't', pages: [{}, {}] },
        { id: 'r2', title_chinese: '…', title_english: '…', difficulty_level: 'beginner', topic: null, status: 'failed', created_at: 't' },
      ],
    });
    registerReaderTools(ctx);
    const result = await tools.get('list_readers')!({ status: 'ready' });
    expect(calls).toEqual([{ method: 'GET', path: '/api/readers?include_pages=true', body: undefined }]);
    const parsed = JSON.parse(text(result));
    expect(parsed.count).toBe(1);
    expect(parsed.readers[0]).toMatchObject({ id: 'r1', page_count: 2 });
  });

  it('create_reader rejects an invalid spec locally without calling the API', async () => {
    const { ctx, tools, calls } = fakeContext({});
    registerReaderTools(ctx);
    const result = await tools.get('create_reader')!({ spec: { ...validReader, pages: [] } });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('A reader needs at least one page');
    expect(calls).toEqual([]);
  });

  it('create_reader imports a valid spec, update_reader replaces it, share posts to the relationship', async () => {
    const { ctx, tools, calls } = fakeContext({
      'POST /api/readers/import': () => ({ id: 'new-1', status: 'ready', image_jobs: 1, spec: validReader }),
      'PUT /api/readers/new-1/spec': (body) => ({ id: 'new-1', status: 'ready', image_jobs: 0, spec: (body as { spec: unknown }).spec }),
      'POST /api/relationships/rel-1/share-reader': () => ({
        share: { id: 's1', relationship_id: 'rel-1', source_reader_id: 'new-1', target_reader_id: 'copy-1', shared_at: 't' },
        reader: { id: 'copy-1', title_chinese: '小猫找家', title_english: 'The Kitten Finds a Home', pages: [{}, {}] },
      }),
    });
    registerReaderTools(ctx);

    const created = JSON.parse(text(await tools.get('create_reader')!({ spec: validReader })));
    expect(created).toMatchObject({ id: 'new-1', image_jobs: 1 });

    const updated = JSON.parse(text(await tools.get('update_reader')!({ reader_id: 'new-1', spec: validReader })));
    expect(updated).toMatchObject({ id: 'new-1', page_count: 2 });

    const shared = JSON.parse(text(await tools.get('share_reader_with_student')!({ relationship_id: 'rel-1', reader_id: 'new-1' })));
    expect(shared.student_reader).toEqual({ id: 'copy-1', title_chinese: '小猫找家', title_english: 'The Kitten Finds a Home', page_count: 2 });

    expect(calls.map(c => `${c.method} ${c.path}`)).toEqual([
      'POST /api/readers/import',
      'PUT /api/readers/new-1/spec',
      'POST /api/relationships/rel-1/share-reader',
    ]);
    expect(calls[0].body).toEqual({ spec: validReader });
    expect(calls[2].body).toEqual({ reader_id: 'new-1' });
  });

  it('generate_reader posts the decks source and tells the model to poll', async () => {
    const { ctx, tools, calls } = fakeContext({
      'POST /api/readers/generate': () => ({ id: 'gen-1', status: 'generating' }),
    });
    registerReaderTools(ctx);
    const result = JSON.parse(text(await tools.get('generate_reader')!({ deck_ids: ['d1'], topic: 'night market' })));
    expect(result).toMatchObject({ id: 'gen-1', status: 'generating' });
    expect(result.message).toContain('get_reader');
    expect(calls[0].body).toEqual({ source: 'decks', deck_ids: ['d1'], topic: 'night market', difficulty: 'beginner' });
  });

  it('turns API errors into isError results with the problem list', async () => {
    const { ctx, tools } = fakeContext({
      'POST /api/readers/rel/retry': () => { throw new ApiError(409, 'Only a failed reader can be retried', { error: 'Only a failed reader can be retried' }); },
    });
    registerReaderTools(ctx);
    const result = await tools.get('retry_reader')!({ reader_id: 'rel' });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Only a failed reader can be retried (HTTP 409)');
  });
});

describe('lesson library tools', () => {
  const lesson = { title: 'Tones', sections: [{ exercises: [{ type: 'match', pairs: [{ hanzi: '有', english: 'have' }, { hanzi: '又', english: 'again' }] }] }] };

  it('create_library_lesson refuses spec+prompt together, pre-validates specs and forwards a brief', async () => {
    const { ctx, tools, calls } = fakeContext({
      'POST /api/lesson-library': (body) => ({ id: 'lib-1', title: 'Tones', version: 1, tags: (body as { tags?: string[] }).tags ?? [], spec: lesson }),
    });
    registerLessonLibraryTools(ctx);
    const both = await tools.get('create_library_lesson')!({ spec: lesson, generate_prompt: 'x' });
    expect(both.isError).toBe(true);

    const bad = await tools.get('create_library_lesson')!({ spec: { title: 'x', sections: [] } });
    expect(bad.isError).toBe(true);
    expect(calls).toEqual([]);

    const ok = JSON.parse(text(await tools.get('create_library_lesson')!({ spec: lesson, tags: ['tones'] })));
    expect(ok).toMatchObject({ id: 'lib-1', tags: ['tones'], exercise_count: 1 });
    expect(calls[0].body).toEqual({ spec: lesson, tags: ['tones'] });

    await tools.get('create_library_lesson')!({ generate_prompt: 'A2 lesson on 了', learner: 'adult beginner' });
    expect(calls[1].body).toEqual({ generate: { prompt: 'A2 lesson on 了', learner: 'adult beginner' }, tags: undefined });
  });

  it('assign / assignments / push-update / student-lessons hit the right paths', async () => {
    const { ctx, tools, calls } = fakeContext({
      'POST /api/lesson-library/lib-1/assign': () => ({ assigned: [{ relationship_id: 'rel-1' }], already_had: [], errors: [] }),
      'GET /api/lesson-library/lib-1/assignments': () => ({ assignments: [{ lesson_id: 'l1', up_to_date: false }] }),
      'POST /api/lesson-library/lib-1/push-update': () => ({ updated: 1, skipped: 0, image_jobs: 0 }),
      'GET /api/relationships/rel-1/student-lessons': () => ({ lessons: [{ id: 'l1' }] }),
      'PUT /api/lesson-library/lib-1': (body) => ({ id: 'lib-1', title: 'Tones', version: 2, tags: ['t'], assignment_count: 1, spec: (body as { spec: unknown }).spec }),
    });
    registerLessonLibraryTools(ctx);

    const assigned = JSON.parse(text(await tools.get('assign_lesson_to_students')!({ library_id: 'lib-1', relationship_ids: ['rel-1'] })));
    expect(assigned.message).toContain('Assigned to 1 student(s)');
    const assignments = JSON.parse(text(await tools.get('get_lesson_assignments')!({ library_id: 'lib-1' })));
    expect(assignments.count).toBe(1);
    const updated = JSON.parse(text(await tools.get('update_library_lesson')!({ library_id: 'lib-1', spec: lesson })));
    expect(updated.message).toContain('push_lesson_update');
    const pushed = JSON.parse(text(await tools.get('push_lesson_update')!({ library_id: 'lib-1', relationship_ids: ['rel-1'] })));
    expect(pushed.updated).toBe(1);
    const studentLessons = JSON.parse(text(await tools.get('list_student_lessons')!({ relationship_id: 'rel-1' })));
    expect(studentLessons.count).toBe(1);

    expect(calls.map(c => `${c.method} ${c.path}`)).toEqual([
      'POST /api/lesson-library/lib-1/assign',
      'GET /api/lesson-library/lib-1/assignments',
      'PUT /api/lesson-library/lib-1',
      'POST /api/lesson-library/lib-1/push-update',
      'GET /api/relationships/rel-1/student-lessons',
    ]);
    // tags omitted → not sent, so the API keeps the current ones
    expect(calls[2].body).toEqual({ spec: lesson });
    expect(calls[3].body).toEqual({ relationship_ids: ['rel-1'] });
  });
});

describe('student deck tools', () => {
  it('create_deck_for_student creates the deck and notes in one batch, then shares without waiting for audio — continuing past a failed note', async () => {
    const { ctx, tools, calls } = fakeContext({
      'GET /api/relationships': () => ({ students: [{ id: 'rel-1', requester_id: 'tutor-1', recipient_id: 'student-1', requester_role: 'tutor', status: 'active' }], tutors: [] }),
      'POST /api/decks': () => ({ id: 'deck-1', name: 'Weather' }),
      'POST /api/decks/deck-1/notes/batch': (body) => {
        // The API creates each row on its own and reports the failures by index.
        const rows = (body as { notes: Array<{ hanzi: string }> }).notes;
        const created: Array<{ id: string; hanzi: string; audio_url: null }> = [];
        const failed: Array<{ index: number; hanzi: string; error: string }> = [];
        rows.forEach((r, index) => {
          if (r.hanzi === '下雨') failed.push({ index, hanzi: r.hanzi, error: 'TTS exploded' });
          else created.push({ id: `n${created.length + 1}`, hanzi: r.hanzi, audio_url: null });
        });
        return { created, failed };
      },
      'GET /api/decks/deck-1': () => ({ id: 'deck-1', notes: [{ id: 'n1', audio_url: 'a.mp3' }, { id: 'n2', audio_url: null }] }),
      'POST /api/relationships/rel-1/share-deck': () => ({ id: 'share-1', target_deck_id: 'deck-s', target_deck_name: 'Weather (from tutor)' }),
    });
    registerStudentDeckTools(ctx, { audioWait: { attempts: 1, delayMs: 0 } });

    const result = JSON.parse(text(await tools.get('create_deck_for_student')!({
      relationship_id: 'rel-1',
      name: 'Weather',
      notes: [
        { hanzi: '刮风', pinyin: 'guā fēng', english: 'windy', sentence_clue: '今天刮风。' },
        { hanzi: '下雨', pinyin: 'xià yǔ', english: 'rain' },
        { hanzi: '晴天', pinyin: 'qíng tiān', english: 'sunny' },
        { hanzi: '雪', pinyin: 'xue3', english: 'snow' },
      ],
    })));

    expect(result).toMatchObject({
      tutor_deck_id: 'deck-1', student_deck_id: 'deck-s', shared_deck_id: 'share-1', created: 2, audio_generating: 1,
      failed: [{ hanzi: '下雨', error: 'TTS exploded' }],
    });
    expect(result.rejected).toEqual([{ hanzi: '雪', reason: expect.stringContaining('tone numbers') }]);
    // One batch POST carries the sentence_clue in the row (no follow-up PUT);
    // there is no synchronous generate-audio call anywhere.
    expect(calls.map(c => `${c.method} ${c.path}`)).toEqual([
      'GET /api/relationships',
      'POST /api/decks',
      'POST /api/decks/deck-1/notes/batch',
      'GET /api/decks/deck-1',
      'POST /api/relationships/rel-1/share-deck',
    ]);
    expect(calls[2].body).toEqual({
      notes: [
        { hanzi: '刮风', pinyin: 'guā fēng', english: 'windy', fun_facts: undefined, sentence_clue: '今天刮风。' },
        { hanzi: '下雨', pinyin: 'xià yǔ', english: 'rain', fun_facts: undefined, sentence_clue: undefined },
        { hanzi: '晴天', pinyin: 'qíng tiān', english: 'sunny', fun_facts: undefined, sentence_clue: undefined },
      ],
    });
    expect(calls[4].body).toEqual({ deck_id: 'deck-1' });
    expect(result.message).toContain('still generating in the background');
  });

  it('create_deck_for_student refuses before creating anything when the caller is the student', async () => {
    const { ctx, tools, calls } = fakeContext({
      'GET /api/relationships': () => ({
        students: [],
        tutors: [{ id: 'rel-9', requester_id: 'tutor-x', recipient_id: 'tutor-1', requester_role: 'tutor', status: 'active', requester: { name: 'Stephanie' } }],
      }),
      'POST /api/decks': () => { throw new Error('must not be called'); },
    });
    registerStudentDeckTools(ctx, { audioWait: { attempts: 1, delayMs: 0 } });
    const result = await tools.get('create_deck_for_student')!({
      relationship_id: 'rel-9', name: 'Weather', notes: [{ hanzi: '刮风', pinyin: 'guā fēng', english: 'windy' }],
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('you are the STUDENT');
    expect(text(result)).toContain('Stephanie');
    expect(text(result)).toContain('Nothing was created');
    expect(calls.map(c => `${c.method} ${c.path}`)).toEqual(['GET /api/relationships']);
  });

  it('create_deck_for_student removes the deck again when sharing fails', async () => {
    const { ctx, tools, calls } = fakeContext({
      'GET /api/relationships': () => ({ students: [{ id: 'rel-1', requester_id: 'tutor-1', recipient_id: 's', requester_role: 'tutor', status: 'active' }], tutors: [] }),
      'POST /api/decks': () => ({ id: 'deck-1', name: 'Weather' }),
      'POST /api/decks/deck-1/notes/batch': (body) => ({ created: (body as { notes: Array<{ hanzi: string }> }).notes.map(n => ({ id: 'n1', hanzi: n.hanzi, audio_url: 'a.mp3' })), failed: [] }),
      'GET /api/decks/deck-1': () => ({ id: 'deck-1', notes: [{ id: 'n1', audio_url: 'a.mp3' }] }),
      'POST /api/relationships/rel-1/share-deck': () => { throw new ApiError(400, 'The student no longer has an account', null); },
      'DELETE /api/decks/deck-1': () => ({ success: true }),
    });
    registerStudentDeckTools(ctx, { audioWait: { attempts: 1, delayMs: 0 } });
    const result = await tools.get('create_deck_for_student')!({
      relationship_id: 'rel-1', name: 'Weather', notes: [{ hanzi: '刮风', pinyin: 'guā fēng', english: 'windy' }],
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('could not be shared');
    expect(text(result)).toContain('removed again');
    expect(calls.map(c => `${c.method} ${c.path}`).slice(-2)).toEqual(['POST /api/relationships/rel-1/share-deck', 'DELETE /api/decks/deck-1']);
  });

  it('add_words_to_student_deck resolves the source deck from the share and updates the copy', async () => {
    const { ctx, tools, calls } = fakeContext({
      'GET /api/relationships/rel-1/shared-decks': () => [{ id: 'share-1', source_deck_id: 'src', target_deck_id: 'tgt', source_deck_name: 'Weather' }],
      'POST /api/decks/src/notes/batch': () => ({ created: [{ id: 'n9', hanzi: '雾', audio_url: null }], failed: [] }),
      'GET /api/decks/src': () => ({ id: 'src', notes: [{ id: 'n9', audio_url: 'c.mp3' }] }),
      'POST /api/relationships/rel-1/shared-decks/share-1/update': () => ({ shared_deck_id: 'share-1', target_deck_id: 'tgt', added: 1, kept: 3, audio_filled: 0 }),
    });
    registerStudentDeckTools(ctx, { audioWait: { attempts: 1, delayMs: 0 } });

    const result = JSON.parse(text(await tools.get('add_words_to_student_deck')!({
      relationship_id: 'rel-1', shared_deck_id: 'share-1', notes: [{ hanzi: '雾', pinyin: 'wù', english: 'fog' }],
    })));
    expect(result).toMatchObject({ tutor_deck_id: 'src', student_deck_id: 'tgt', created: 1, student_copy: { added: 1, kept: 3 } });
    expect(calls.map(c => `${c.method} ${c.path}`)).toEqual([
      'GET /api/relationships/rel-1/shared-decks',
      'POST /api/decks/src/notes/batch',
      'GET /api/decks/src',
      'POST /api/relationships/rel-1/shared-decks/share-1/update',
    ]);

    const unknown = await tools.get('add_words_to_student_deck')!({ relationship_id: 'rel-1', shared_deck_id: 'nope', notes: [] });
    expect(unknown.isError).toBe(true);
    expect(text(unknown)).toContain('share-1 (Weather)');
  });

  it('get_starter_deck posts to the idempotent starter route', async () => {
    const { ctx, tools, calls } = fakeContext({
      'POST /api/decks/starter': () => ({ deck: { id: 'st', name: 'Starter Chinese' }, created: false, word_count: 15 }),
    });
    registerStudentDeckTools(ctx);
    const result = JSON.parse(text(await tools.get('get_starter_deck')!({})));
    expect(result).toMatchObject({ deck_id: 'st', created: false, word_count: 15 });
    expect(calls).toEqual([{ method: 'POST', path: '/api/decks/starter', body: {} }]);
  });
});
