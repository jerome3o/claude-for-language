import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The session-notes agent loop around the model: tool execution, the D1
 * checkpoints, idempotent creates on resume, the soft deadline that
 * re-enqueues a long job, finalize (share / assign / clean up) and the
 * failure path. The model and every store are mocked; what is under test is
 * the orchestration in tutor-notes-agent.ts.
 */

const create = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {
    status: number;
    constructor(status: number, message = 'api error') {
      super(message);
      this.status = status;
    }
  }
  class APIConnectionError extends Error {}
  class Anthropic {
    messages = { create };
    static APIError = APIError;
    static APIConnectionError = APIConnectionError;
  }
  return { default: Anthropic };
});

// ---- In-memory job store standing in for db/tutor-notes-queries ----
type AnyJob = Record<string, any>;
const store = new Map<string, AnyJob>();
const studentWords = new Map<string, any[]>();
const deckNotes = new Map<string, Set<string>>();

vi.mock('../../db/tutor-notes-queries', () => ({
  getJob: vi.fn(async (_db: unknown, id: string) => {
    const j = store.get(id);
    return j ? JSON.parse(JSON.stringify(j)) : null;
  }),
  patchJob: vi.fn(async (_db: unknown, id: string, patch: AnyJob) => {
    const j = store.get(id)!;
    for (const [k, v] of Object.entries(patch)) j[k] = v === undefined ? j[k] : JSON.parse(JSON.stringify(v));
  }),
  listRecentJobSummaries: vi.fn(async () => []),
  getUserBrief: vi.fn(async (_db: unknown, id: string) => (id === 'student' ? { name: 'Jerome', bio: 'Lives in Paris' } : { name: 'Tutor Li', bio: null })),
  listStudentDecks: vi.fn(async () => [{ id: 'sd1', name: 'Core Homework', note_count: 40, started: 30, mastered: 12, from_tutor: true }]),
  findStudentWords: vi.fn(async (_db: unknown, _sid: string, hanzi: string[]) => {
    const out = new Map<string, any[]>();
    for (const h of hanzi) if (studentWords.has(h)) out.set(h, studentWords.get(h)!);
    return out;
  }),
  searchStudentWords: vi.fn(async () => []),
  listStudentDeckWords: vi.fn(async () => []),
  listDeckHanzi: vi.fn(async (_db: unknown, deckId: string) => new Set(deckNotes.get(deckId) ?? [])),
}));

const createDeck = vi.fn(async (_db: unknown, _uid: string, input: { name: string }) => {
  deckNotes.set('deck-1', new Set());
  return { id: 'deck-1', name: input.name };
});
const deleteDeck = vi.fn(async () => true);
vi.mock('../content', () => ({
  createDeck: (...a: unknown[]) => createDeck(...(a as [unknown, string, { name: string }])),
  deleteDeck: (...a: unknown[]) => deleteDeck(...(a as [])),
  createNotes: vi.fn(async (_env: unknown, _uid: string, deckId: string, inputs: Array<{ hanzi: string }>) => {
    const created: Array<{ hanzi: string }> = [];
    const failed: Array<{ index: number; hanzi: string; error: string }> = [];
    inputs.forEach((n, i) => {
      if (n.hanzi.includes('/')) failed.push({ index: i, hanzi: n.hanzi, error: 'hanzi must be one clean form' });
      else {
        deckNotes.get(deckId)!.add(n.hanzi);
        created.push({ hanzi: n.hanzi });
      }
    });
    return { created, failed };
  }),
}));

const shareDeck = vi.fn(async () => ({ target_deck_id: 'student-deck-1' }));
vi.mock('../conversations', () => ({ shareDeck: (...a: unknown[]) => shareDeck(...(a as [])) }));
vi.mock('../shared-readers', () => ({ shareReader: vi.fn(async () => ({ reader: { id: 'student-reader-1' } })) }));

const libraryItems = new Map<string, AnyJob>();
vi.mock('../../db/lesson-library-queries', () => ({
  createLibraryItem: vi.fn(async (_db: unknown, _uid: string, data: AnyJob) => {
    const row = { id: `lib-${libraryItems.size + 1}`, ...data };
    libraryItems.set(row.id, row);
    return row;
  }),
  getLibraryItem: vi.fn(async (_db: unknown, id: string) => libraryItems.get(id) ?? null),
  findAssignedCopy: vi.fn(async () => null),
  createAssignedLesson: vi.fn(async () => ({ id: 'lesson-copy-1' })),
}));
vi.mock('../custom-lesson', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  queueLessonImages: vi.fn(async () => 0),
}));
vi.mock('../../db/insights-queries', () => ({
  fetchReviewRows: vi.fn(async () => []),
  fetchCardStatesForRange: vi.fn(async () => []),
  listLessonLog: vi.fn(async () => [{ id: 'log-1', lesson_at: '2026-09-10T12:00:00.000Z', notes: 'Talked about food' }]),
}));
vi.mock('../../db/reader-editor-queries', () => ({
  createReaderFromSpec: vi.fn(async () => ({ reader: { id: 'reader-1' }, imageJobs: [] })),
}));

const { runTutorNotesJob, buildBriefing, clipNotes, toNoteInput, stepForTool, MAX_NOTES_CHARS } = await import('../tutor-notes-agent');

function textBlock(text: string) {
  return { type: 'text', text };
}
function toolUse(id: string, name: string, input: unknown) {
  return { type: 'tool_use', id, name, input };
}
function turn(content: unknown[], stop: 'tool_use' | 'end_turn' = 'tool_use') {
  return { content, stop_reason: stop };
}

function seedJob(overrides: AnyJob = {}) {
  const job = {
    id: 'job-1',
    relationship_id: 'rel-1',
    tutor_id: 'tutor',
    student_id: 'student',
    title: 'Restaurant lesson',
    notes: 'Taught 点菜, 服务员, 菜单. Example: 我想点菜。',
    lesson_at: '2026-09-14T12:00:00.000Z',
    priority: 'core',
    auto_share: 1,
    status: 'queued',
    progress: null,
    steps: [],
    transcript: null,
    rounds: 0,
    result: {},
    error: null,
    lesson_log_id: null,
    created_at: '2026-09-14T13:00:00.000Z',
    updated_at: '2026-09-14T13:00:00.000Z',
    started_at: null,
    finished_at: null,
    ...overrides,
  };
  store.set(job.id, job);
  return job;
}

const queueSend = vi.fn(async () => {});
const env = {
  DB: {} as D1Database,
  ANTHROPIC_API_KEY: 'k',
  TUTOR_NOTES_QUEUE: { send: queueSend },
  IMAGE_QUEUE: { sendBatch: vi.fn() },
  GEMINI_API_KEY: '',
} as unknown as import('../../types').Env;

beforeEach(() => {
  create.mockReset();
  queueSend.mockReset();
  createDeck.mockClear();
  deleteDeck.mockClear();
  shareDeck.mockClear();
  store.clear();
  studentWords.clear();
  deckNotes.clear();
  libraryItems.clear();
  vi.restoreAllMocks();
});

describe('runTutorNotesJob — happy path', () => {
  it('checks words, creates the deck, adds cards, finishes and shares to the student', async () => {
    seedJob();
    studentWords.set('服务员', [{ hanzi: '服务员', pinyin: 'fúwùyuán', english: 'waiter', deck_name: 'Core Homework', state: 'review', reps: 6, lapses: 0, interval_days: 21 }]);
    create
      .mockResolvedValueOnce(
        turn([
          textBlock('Checking which words the student already has.'),
          toolUse('t1', 'check_student_words', { hanzi: ['点菜', '服务员', '菜单'] }),
          toolUse('t2', 'create_deck', { name: 'Restaurant — 14 Sep' }),
        ])
      )
      .mockResolvedValueOnce(
        turn([
          toolUse('t3', 'add_cards', {
            deck_id: 'deck-1',
            cards: [
              { hanzi: '点菜', pinyin: 'diǎn cài', english: 'to order food', fun_facts: '点 order · 菜 dish', sentence_clue: '我想点菜。' },
              { hanzi: '菜单', pinyin: 'càidān', english: 'menu', fun_facts: '菜 dish · 单 list' },
              { hanzi: '服务员/服务生', pinyin: 'fúwùyuán', english: 'waiter', fun_facts: 'x' },
            ],
          }),
        ])
      )
      .mockResolvedValueOnce(turn([toolUse('t4', 'finish', { summary: 'Made a deck of 2 cards. Skipped 服务员 (already in review).', skipped: ['服务员 — already in review'] })]));

    const outcome = await runTutorNotesJob(env, 'job-1');
    expect(outcome).toBe('done');

    const job = store.get('job-1')!;
    expect(job.status).toBe('done');
    expect(job.rounds).toBe(3);
    expect(job.result.deck).toMatchObject({ id: 'deck-1', name: 'Restaurant — 14 Sep', note_count: 2, target_deck_id: 'student-deck-1' });
    expect(job.result.summary).toContain('Made a deck');
    expect(job.result.skipped).toEqual(['服务员 — already in review']);
    expect(shareDeck).toHaveBeenCalledWith(env.DB, 'rel-1', 'tutor', 'deck-1', 'core');

    const texts = job.steps.map((s: { text: string }) => s.text);
    expect(texts).toContain('Checked 3 words against the student\'s cards · 1 already there');
    expect(texts).toContain('Created the deck "Restaurant — 14 Sep"');
    expect(texts).toContain('Added 2 cards · 1 rejected by the card standard');
    expect(texts.at(-1)).toBe('Done');

    // The model saw the rejection reason so it can fix the card.
    expect(JSON.stringify(job.transcript[4].content)).toContain('one clean form');
    // The briefing carried the student's decks and the notes verbatim.
    const briefing = create.mock.calls[0][0].messages[0].content as string;
    expect(briefing).toContain('Core Homework');
    expect(briefing).toContain('我想点菜');
    expect(briefing).toContain('Tutor\'s title: Restaurant lesson');
    // Transcript is checkpointed: user, assistant, tool results, ... final tool results.
    expect(job.transcript.length).toBe(7);
  });

  it('treats a plain-text ending as the summary and removes an empty deck', async () => {
    seedJob();
    create
      .mockResolvedValueOnce(turn([toolUse('t1', 'create_deck', { name: 'Nothing here' })]))
      .mockResolvedValueOnce(turn([textBlock('The notes contain no vocabulary to learn.')], 'end_turn'));
    expect(await runTutorNotesJob(env, 'job-1')).toBe('done');
    const job = store.get('job-1')!;
    expect(job.result.summary).toBe('The notes contain no vocabulary to learn.');
    expect(job.result.deck).toBeUndefined();
    expect(deleteDeck).toHaveBeenCalledTimes(1);
    expect(shareDeck).not.toHaveBeenCalled();
  });

  it('does not share when auto_share is off, and assigns a validated lesson only when on', async () => {
    seedJob({ auto_share: 0 });
    const spec = {
      title: '把 sentences',
      sections: [{ exercises: [{ type: 'note', title: '把', body: 'Put the object before the verb.', examples: [{ hanzi: '把门关上。', pinyin: 'bǎ mén guān shàng.', english: 'Close the door.' }] }] }],
    };
    create
      .mockResolvedValueOnce(turn([toolUse('t1', 'create_deck', { name: 'D' }), toolUse('t2', 'add_cards', { deck_id: 'deck-1', cards: [{ hanzi: '把', pinyin: 'bǎ', english: 'take', fun_facts: 'x' }] })]))
      .mockResolvedValueOnce(turn([toolUse('t3', 'create_mini_lesson', { spec })]))
      .mockResolvedValueOnce(turn([toolUse('t4', 'finish', { summary: 'ok' })]));
    expect(await runTutorNotesJob(env, 'job-1')).toBe('done');
    const job = store.get('job-1')!;
    expect(job.result.lessons).toHaveLength(1);
    expect(job.result.lessons[0]).toMatchObject({ library_item_id: 'lib-1', title: '把 sentences', exercise_count: 1 });
    expect(job.result.lessons[0].lesson_id).toBeUndefined();
    expect(job.result.deck.target_deck_id).toBeUndefined();
    expect(shareDeck).not.toHaveBeenCalled();
  });

  it('hands an invalid lesson spec back as problems instead of saving it', async () => {
    seedJob();
    create
      .mockResolvedValueOnce(turn([toolUse('t1', 'create_mini_lesson', { spec: { title: 'broken', sections: [] } })]))
      .mockResolvedValueOnce(turn([toolUse('t2', 'finish', { summary: 'gave up on the lesson' })]));
    await runTutorNotesJob(env, 'job-1');
    const job = store.get('job-1')!;
    expect(job.result.lessons).toBeUndefined();
    const toolResult = JSON.parse(job.transcript[2].content[0].content);
    expect(toolResult.problems.length).toBeGreaterThan(0);
    expect(job.steps.some((s: { kind: string }) => s.kind === 'warn')).toBe(true);
  });
});

describe('runTutorNotesJob — resilience', () => {
  it('resumes from a checkpoint whose tool calls were never answered, without duplicating the deck', async () => {
    // Crashed after checkpoint A: the assistant asked for create_deck, the deck
    // exists in the result, but no tool_result was saved.
    seedJob({
      status: 'running',
      rounds: 1,
      result: { deck: { id: 'deck-1', name: 'Existing', note_count: 0 } },
      transcript: [
        { role: 'user', content: 'briefing' },
        { role: 'assistant', content: [toolUse('t1', 'create_deck', { name: 'Existing' })] },
      ],
    });
    deckNotes.set('deck-1', new Set());
    create.mockResolvedValueOnce(turn([toolUse('t2', 'finish', { summary: 'done' })]));

    expect(await runTutorNotesJob(env, 'job-1')).toBe('done');
    expect(createDeck).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
    const job = store.get('job-1')!;
    expect(job.rounds).toBe(2);
    // The unanswered tool call got its result before the model was asked again.
    const resumedCall = create.mock.calls[0][0];
    expect(resumedCall.messages[2].role).toBe('user');
    expect(JSON.stringify(resumedCall.messages[2].content)).toContain('already has its deck');
    expect(job.steps.map((s: { text: string }) => s.text)).toContain('Resumed where it left off');
  });

  it('skips cards already in the deck, so a re-run of add_cards is idempotent', async () => {
    seedJob();
    create
      .mockResolvedValueOnce(turn([toolUse('t1', 'create_deck', { name: 'D' })]))
      .mockResolvedValueOnce(turn([toolUse('t2', 'add_cards', { deck_id: 'deck-1', cards: [{ hanzi: '点菜', pinyin: 'diǎn cài', english: 'order', fun_facts: 'x' }] })]))
      .mockResolvedValueOnce(turn([toolUse('t3', 'add_cards', { deck_id: 'deck-1', cards: [{ hanzi: '点菜', pinyin: 'diǎn cài', english: 'order', fun_facts: 'x' }, { hanzi: '菜单', pinyin: 'càidān', english: 'menu', fun_facts: 'x' }] })]))
      .mockResolvedValueOnce(turn([toolUse('t4', 'finish', { summary: 'ok' })]));
    await runTutorNotesJob(env, 'job-1');
    const job = store.get('job-1')!;
    expect(job.result.deck.note_count).toBe(2);
    const third = JSON.parse(job.transcript[6].content[0].content);
    expect(third.skipped_duplicates).toEqual(['点菜']);
    expect(third.added).toEqual(['菜单']);
  });

  it('re-enqueues itself when a delivery runs past the soft deadline', async () => {
    seedJob();
    let t = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => {
      t += 2 * 60 * 1000; // every look at the clock is two minutes later
      return t;
    });
    create.mockResolvedValue(turn([toolUse('t1', 'check_student_words', { hanzi: ['点菜'] })]));
    expect(await runTutorNotesJob(env, 'job-1')).toBe('continue');
    expect(queueSend).toHaveBeenCalledWith({ jobId: 'job-1', resume: true });
    const job = store.get('job-1')!;
    expect(job.status).toBe('running');
    expect(job.progress).toBe('Still working…');
    expect(create.mock.calls.length).toBeLessThan(5);
  });

  it('stops between rounds when the tutor cancelled', async () => {
    seedJob();
    create.mockImplementation(async () => {
      store.get('job-1')!.status = 'cancelled';
      return turn([toolUse('t1', 'check_student_words', { hanzi: ['点菜'] })]);
    });
    expect(await runTutorNotesJob(env, 'job-1')).toBe('cancelled');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('records a non-retryable model error on the row and keeps the transcript', async () => {
    seedJob();
    const Anthropic = (await import('@anthropic-ai/sdk')).default as unknown as { APIError: new (status: number, message?: string) => Error };
    create.mockRejectedValue(new Anthropic.APIError(400, 'bad request: prompt too long'));
    expect(await runTutorNotesJob(env, 'job-1')).toBe('failed');
    const job = store.get('job-1')!;
    expect(job.status).toBe('failed');
    expect(job.error).toContain('prompt too long');
    expect(job.transcript).toHaveLength(1);
    expect(job.steps.at(-1).kind).toBe('error');
  });

  it('retries a 529 and then succeeds', async () => {
    seedJob();
    const Anthropic = (await import('@anthropic-ai/sdk')).default as unknown as { APIError: new (status: number, message?: string) => Error };
    create.mockRejectedValueOnce(new Anthropic.APIError(529, 'overloaded')).mockResolvedValueOnce(turn([toolUse('t1', 'finish', { summary: 'ok' })]));
    expect(await runTutorNotesJob(env, 'job-1')).toBe('done');
    expect(create).toHaveBeenCalledTimes(2);
  }, 10_000);

  it('does nothing for a job that already finished', async () => {
    seedJob({ status: 'done' });
    expect(await runTutorNotesJob(env, 'job-1')).toBe('skipped');
    expect(create).not.toHaveBeenCalled();
  });
});

describe('pure helpers', () => {
  it('clipNotes cuts very long notes with a marker', () => {
    const long = 'x'.repeat(MAX_NOTES_CHARS + 100);
    const clipped = clipNotes(long);
    expect(clipped.length).toBeLessThan(long.length);
    expect(clipped).toContain('100 more characters');
    expect(clipNotes('  short  ')).toBe('short');
  });

  it('toNoteInput trims and nulls blanks', () => {
    expect(toNoteInput({ hanzi: ' 点菜 ', pinyin: 'diǎn cài', english: 'order', fun_facts: '', sentence_clue: ' 我想点菜。 ' })).toEqual({
      hanzi: '点菜',
      pinyin: 'diǎn cài',
      english: 'order',
      fun_facts: null,
      sentence_clue: '我想点菜。',
      sentence_clue_pinyin: null,
      sentence_clue_translation: null,
      alternatives: null,
    });
  });

  it('stepForTool describes each tool call for the progress list', () => {
    expect(stepForTool('add_cards', {}, { added: ['a'], rejected: [], skipped_duplicates: ['b'] })?.text).toBe('Added 1 card · 1 already in the deck');
    expect(stepForTool('create_mini_lesson', {}, { problems: ['x', 'y'] })).toMatchObject({ kind: 'warn', text: 'Lesson draft had 2 problems — fixing' });
    expect(stepForTool('create_reader', {}, { title_english: 'At the market' })?.text).toBe('Wrote the reader "At the market"');
    expect(stepForTool('finish', {}, {})).toBeNull();
  });

  it('buildBriefing lists decks, struggles, earlier jobs and the delivery choice', () => {
    const text = buildBriefing({
      studentName: 'Jerome',
      studentBio: null,
      tutorName: 'Li',
      decks: [{ id: 'd1', name: 'Core', note_count: 10, started: 4, mastered: 1, from_tutor: true }],
      struggling: [{ hanzi: '银行', english: 'bank', again_count: 3, attempts: 5, wrong_answers: ['很行'] }],
      goingWell: [{ hanzi: '你好', english: 'hello' }],
      lessonLog: [{ lesson_at: '2026-09-01T12:00:00.000Z', notes: 'Numbers' }],
      earlierJobs: [{ created_at: '2026-09-07T10:00:00.000Z', title: 'Week 2', result: { deck: { id: 'x', name: 'Week 2 words', note_count: 9 }, lessons: [{ library_item_id: 'l', title: '了', exercise_count: 5 }] } }],
      job: { title: null, notes: 'Notes here', lesson_at: null, priority: 'non_urgent', auto_share: 1 },
    });
    expect(text).toContain('d1 · Core (homework from tutor) · 10 words');
    expect(text).toContain('银行 · bank · 3/5 · typed: 很行');
    expect(text).toContain('Going well: 你好 (hello)');
    expect(text).toContain('2026-09-01: Numbers');
    expect(text).toContain('deck "Week 2 words" (9 cards), lessons: 了');
    expect(text).toContain('bottom of the student\'s study queue');
    expect(text).toContain('Notes here');
  });
});
