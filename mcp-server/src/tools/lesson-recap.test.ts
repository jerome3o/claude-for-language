import { describe, it, expect } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { groupLessons, registerLessonRecapTools, type CallListRow } from './lesson-recap';
import { registerAudioLessonTools } from './audio-lessons';
import type { ToolContext } from './context';
import { ApiError } from '../api';
import { COMPOSED_SPEC_DOC } from '../../../shared/audio-lesson/composed-doc';

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>;

const H = 3_600_000;
const T0 = Date.UTC(2026, 10, 21, 10);
const call = (id: string, lesson: string | null, started: number, extra: Partial<CallListRow> = {}): CallListRow => ({
  id,
  relationship_id: 'rel-1',
  title: null,
  status: 'ended',
  processing_status: 'done',
  started_at: started,
  ended_at: started + 0.5 * H,
  created_at: new Date(started).toISOString(),
  lesson_id: lesson,
  has_summary: true,
  segment_count: 10,
  other_user_name: 'Laoshi',
  ...extra,
});
const CALLS = [
  call('c3', 'L2', T0 + 72 * H, { segment_count: 0, has_summary: false }),
  call('c2', 'L1', T0 + 0.75 * H),
  call('c1', 'L1', T0),
  call('c0', null, T0 - 48 * H, { other_user_name: null, relationship_id: null }),
];

const RECAP = {
  call_id: 'c1',
  lesson_id: 'L1',
  title: null,
  started_at: T0,
  ended_at: T0 + 1.25 * H,
  duration_minutes: 75,
  my_role: 'student',
  people: [
    { id: 't', name: 'Laoshi', role: 'tutor', is_me: false },
    { id: 's', name: 'Learner', role: 'student', is_me: true },
  ],
  calls: [],
  processing_status: 'done',
  transcript: [
    { at: '1:00', ms: 60_000, speaker: 'Laoshi (tutor)', me: false, text: '你周末打算做什么？', pinyin: 'nǐ zhōumò dǎsuàn zuò shénme?', english: 'What are you planning to do at the weekend?' },
    { at: '1:05', ms: 65_000, speaker: 'Learner (student)', me: true, text: '我打算去爬山。', pinyin: 'wǒ dǎsuàn qù páshān.', english: null },
  ],
  transcript_lines_total: 900,
  board_text: '周末',
  chat: [{ from: 'Laoshi', text: '爬山', at: '1:00' }],
  report: { summary: 'Weekend plans.', topics: [], vocabulary: [], corrections: [], follow_ups: [] },
  lesson_notes: [{ text: '[From tutor Laoshi] 打算', given_at: null, created_at: '2026-11-21 11:00:00' }],
  homework: [{ title: 'Weekend', kind: 'deck', mode: 'both', due_date: null, from_this_lesson: true, words: [{ hanzi: '打算', pinyin: 'dǎsuàn', english: 'to plan to' }], word_count: 1 }],
};

function fakeContext(opts: { previewProblems?: string[]; createFails?: boolean } = {}) {
  const tools = new Map<string, Handler>();
  const descriptions = new Map<string, string>();
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const api = {
    get: async (path: string) => {
      calls.push({ method: 'GET', path });
      if (path === '/api/calls') return { calls: CALLS };
      if (path.startsWith('/api/calls/')) return { recap: RECAP };
      throw new Error(`unexpected ${path}`);
    },
    post: async (path: string, body: unknown) => {
      calls.push({ method: 'POST', path, body });
      if (path === '/api/audio-lessons/composed/preview') {
        return { dry_run: true, problems: opts.previewProblems ?? [], estimate_minutes: 6.2, chapters: [{ title: 'What we talked about', at: '0:00' }], transcript_preview: [], clips: 46 };
      }
      if (opts.createFails) throw new ApiError(400, 'blocks[0]: unknown block type "song"', { problems: ['blocks[0]: unknown block type "song"'] });
      return {
        lesson: { id: 'al1', format: 'composed', title: 'Recap', status: 'queued', progress: 'Waiting to start', progress_done: 0, progress_total: 46, error: null, duration_ms: null, size_bytes: null, word_count: 2, audio_version: null, created_at: 'now', finished_at: null, source_label: 'Recap of the 21 Nov lesson' },
        estimate_minutes: 6.2,
        chapters: [],
        clips: 46,
      };
    },
  };
  const server = {
    tool: (name: string, d: string, _s: unknown, handler: Handler) => {
      tools.set(name, handler);
      descriptions.set(name, d);
    },
  };
  const ctx = { server, api, env: {}, userId: 'u1' } as unknown as ToolContext;
  registerLessonRecapTools(ctx);
  registerAudioLessonTools(ctx);
  return { tools, calls, descriptions };
}

const json = (r: CallToolResult) => JSON.parse(r.content.map((c) => (c.type === 'text' ? c.text : '')).join(''));

describe('video lessons for a recap', () => {
  it('groupLessons: calls of one lesson together, newest lesson first', () => {
    const lessons = groupLessons(CALLS);
    expect(lessons.map((l) => [l.lesson_id, l.call_ids])).toEqual([
      ['L2', ['c3']],
      ['L1', ['c1', 'c2']],
      [null, ['c0']],
    ]);
    expect(lessons[1]).toMatchObject({ with: 'Laoshi', minutes: 75, transcript_lines: 20, has_report: true, started_at: new Date(T0).toISOString() });
  });

  it('list_my_lessons reads GET /api/calls only', async () => {
    const { tools, calls } = fakeContext();
    const out = json(await tools.get('list_my_lessons')!({ limit: 2 }));
    expect(out.lessons).toHaveLength(2);
    expect(calls).toEqual([{ method: 'GET', path: '/api/calls' }]);
  });

  it('get_lesson_for_recap: by default the newest lesson WITH a transcript, through the members-only recap route', async () => {
    const { tools, calls } = fakeContext();
    const out = json(await tools.get('get_lesson_for_recap')!({}));
    // L2 has no transcript: the recap is of L1 (its first call).
    expect(calls.map((c) => c.path)).toEqual(['/api/calls', '/api/calls/c1/recap?max_segments=400']);
    expect(out.transcript).toEqual([
      '1:00 Laoshi (tutor): 你周末打算做什么？ | nǐ zhōumò dǎsuàn zuò shénme? | What are you planning to do at the weekend?',
      '1:05 Learner (student), me: 我打算去爬山。 | wǒ dǎsuàn qù páshān.',
    ]);
    expect(out.transcript_note).toBe('First 2 of 900 lines — pass max_lines to get more.');
    expect(out.people).toEqual(['Laoshi (tutor)', 'Learner (me)']);
    expect(out.tutor_notes[0].text).toContain('打算');
    expect(out.homework[0].words[0].hanzi).toBe('打算');
    expect(out.next_step).toContain('compose_audio_lesson');
  });

  it('get_lesson_for_recap: a call id goes straight to the route; pinyin can be left out', async () => {
    const { tools, calls } = fakeContext();
    const out = json(await tools.get('get_lesson_for_recap')!({ call_id: 'c2', max_lines: 50, pinyin: false }));
    expect(calls.map((c) => c.path)).toEqual(['/api/calls/c2/recap?max_segments=50']);
    expect(out.transcript[0]).toBe('1:00 Laoshi (tutor): 你周末打算做什么？ | What are you planning to do at the weekend?');
    const missing = json(await tools.get('get_lesson_for_recap')!({ lesson_id: 'nope' }));
    expect(missing.error).toMatch(/No lesson nope/);
  });
});

describe('compose_audio_lesson', () => {
  const plan = { version: 1, title: 'Recap', blocks: [{ type: 'drill', hanzi: '我打算去爬山。', english: "I'm planning to go hiking." }] };

  it('dry-runs by default through the preview route (nothing made)', async () => {
    const { tools, calls } = fakeContext();
    const out = json(await tools.get('compose_audio_lesson')!({ plan, source: { lesson_id: 'L1' } }));
    expect(calls).toEqual([{ method: 'POST', path: '/api/audio-lessons/composed/preview', body: { plan, source: { lesson_id: 'L1' } } }]);
    expect(out).toMatchObject({ dry_run: true, estimate_minutes: 6.2, sent: false });
    expect(out.next).toMatch(/dry_run: false/);
    const withProblems = json(await fakeContext({ previewProblems: ['blocks[0]: x'] }).tools.get('compose_audio_lesson')!({ plan }));
    expect(withProblems.next).toBe('Fix the problems and dry-run again.');
  });

  it('dry_run false makes it (format composed) and returns the lesson with its source', async () => {
    const { tools, calls } = fakeContext();
    const out = json(await tools.get('compose_audio_lesson')!({ plan, title: 'Recap', dry_run: false }));
    expect(calls).toEqual([{ method: 'POST', path: '/api/audio-lessons', body: { format: 'composed', plan, title: 'Recap' } }]);
    expect(out.lesson).toMatchObject({ id: 'al1', format: 'composed', source: 'Recap of the 21 Nov lesson', listen_path: '/audio-lessons/al1' });
    expect(out.sent).toBe(false);
  });

  it('a refused plan comes back with its problems', async () => {
    const { tools } = fakeContext({ createFails: true });
    const res = await tools.get('compose_audio_lesson')!({ plan, dry_run: false });
    expect(res.isError).toBe(true);
    expect(res.content[0].type === 'text' && res.content[0].text).toContain('unknown block type');
  });

  it('its description is the block reference', () => {
    const { descriptions } = fakeContext();
    expect(descriptions.get('compose_audio_lesson')).toContain(COMPOSED_SPEC_DOC);
    expect(descriptions.get('compose_audio_lesson')).toMatch(/ALWAYS dry-run first/);
  });
});
