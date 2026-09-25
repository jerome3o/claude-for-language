import { describe, it, expect } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { registerStudentTools } from './students.js';
import type { ToolContext } from './context.js';
import type { ApiClient } from '../api.js';
import { ApiError } from '../api.js';
import {
  audioUrl,
  clampInt,
  compactInvite,
  compactMessage,
  compactMyRelationships,
  compactRecording,
  compactSharedDeckProgress,
  compactStruggling,
  compactStudentRow,
  filterRecordings,
  lastMessages,
  normalizeDateParam,
  ratingLabel,
} from './students/shape.js';
import type {
  InsightRecording,
  InviteRow,
  MessageRow,
  MyRelationships,
  SharedDeckProgress,
  StrugglingNote,
  StudentOverview,
} from './students/types.js';

const API = 'https://api.example.test';

// ---------- Fixtures ----------

const note = { id: 'n1', hanzi: '谢谢', pinyin: 'xièxie', english: 'thanks', deck_id: 'd1', deck_name: 'HSK 1' };

function overview(partial: Partial<StudentOverview> = {}): StudentOverview {
  return {
    relationship_id: 'rel-1',
    student: { id: 'u-student', name: 'Mei', email: 'mei@example.com', picture_url: null },
    joined_at: '2026-09-01T00:00:00.000Z',
    joined_via_invite: true,
    is_new: false,
    status: {
      last_studied_at: '2026-09-19T08:00:00.000Z',
      studied_today: false,
      streak_days: 3,
      today: { reviews: 0, accuracy: null, time_ms: 0 },
    },
    pills: { struggling_words: 2, recordings_to_hear: 1, homework_percent: 40 },
    needs_attention: Array.from({ length: 7 }, (_, i) => ({
      note: { ...note, id: `n${i}`, hanzi: `词${i}` },
      attempts: 4,
      again_count: 2,
      hard_count: 1,
      wrong_answers: ['谢射'],
      wrong_typed_count: 1,
      last_reviewed_at: '2026-09-19T08:00:00.000Z',
      recording: i === 0 ? { event_id: 'ev-1', recording_url: 'recordings/ev-1.webm' } : null,
      recordings_unheard: i === 0 ? 1 : 0,
    })),
    homework: {
      percent: 40,
      cards_total: 30,
      cards_started: 12,
      cards_mastered: 6,
      lessons_total: 1,
      lessons_completed: 0,
      decks: [],
      lessons: [],
    },
    setup: {
      steps: [
        { key: 'signed_in', title: 'Signed in', done: true, detail: 'Joined 1 Sep' },
        { key: 'homework', title: 'Homework', done: true, detail: '1 deck' },
        { key: 'installed', title: 'Installed', done: false, detail: 'Browser only' },
        { key: 'first_session', title: 'First session', done: false, detail: '' },
      ],
      done_count: 2,
      install_kind: 'browser',
      audio: { cached: 0, total: 90 },
      last_opened_at: null,
      invite: null,
    },
    activity: [{ day: '2026-09-19', reviews: 20, accuracy: 0.8, time_ms: 300000 }],
    last_conversation_id: 'conv-1',
    ...partial,
  };
}

function recording(id: string, mark: InsightRecording['mark'] = null): InsightRecording {
  return {
    event_id: id,
    note,
    card_type: 'hanzi_to_meaning',
    rating: 2,
    reviewed_at: '2026-09-18T10:00:00.000Z',
    recording_url: `recordings/${id}.webm`,
    user_answer: null,
    mark,
  };
}

// ---------- Pure helpers ----------

describe('audioUrl', () => {
  it('turns an R2 key into the API audio route', () => {
    expect(audioUrl(API, 'recordings/ev-1.webm')).toBe(`${API}/api/audio/recordings/ev-1.webm`);
    expect(audioUrl(`${API}/`, '/recordings/ev-1.webm')).toBe(`${API}/api/audio/recordings/ev-1.webm`);
  });
  it('keeps absolute URLs and already-routed paths', () => {
    expect(audioUrl(API, 'https://cdn/x.webm')).toBe('https://cdn/x.webm');
    expect(audioUrl(API, '/api/audio/recordings/a.webm')).toBe(`${API}/api/audio/recordings/a.webm`);
    expect(audioUrl(API, null)).toBeNull();
  });
});

describe('normalizeDateParam', () => {
  it('passes bare dates through so the API can widen them to the whole day', () => {
    expect(normalizeDateParam('2026-09-01', 'from')).toBe('2026-09-01');
  });
  it('normalises timestamps to ISO and drops blanks', () => {
    expect(normalizeDateParam('2026-09-01T10:00:00+02:00', 'from')).toBe('2026-09-01T08:00:00.000Z');
    expect(normalizeDateParam('', 'from')).toBeUndefined();
    expect(normalizeDateParam(undefined, 'from')).toBeUndefined();
  });
  it('rejects garbage with the parameter name', () => {
    expect(() => normalizeDateParam('last tuesday', 'to')).toThrow(/^to must be an ISO date/);
  });
});

describe('clampInt / ratingLabel', () => {
  it('clamps and falls back', () => {
    expect(clampInt(undefined, 1, 100, 15)).toBe(15);
    expect(clampInt(1000, 1, 100, 15)).toBe(100);
    expect(clampInt(2.6, 1, 100, 15)).toBe(3);
  });
  it('labels ratings', () => {
    expect([0, 1, 2, 3].map(ratingLabel)).toEqual(['again', 'hard', 'good', 'easy']);
    expect(ratingLabel(null)).toBeNull();
  });
});

describe('compactStudentRow', () => {
  it('keeps the ids and status, trims needs_attention to 5 and omits setup for active students', () => {
    const row = compactStudentRow(overview(), API);
    expect(row.relationship_id).toBe('rel-1');
    expect(row.student).toEqual({ id: 'u-student', name: 'Mei', email: 'mei@example.com' });
    expect(row.needs_attention).toHaveLength(5);
    expect(row.needs_attention[0].latest_recording).toEqual({
      event_id: 'ev-1',
      audio_url: `${API}/api/audio/recordings/ev-1.webm`,
    });
    expect(row.needs_attention[0].wrong_answers).toEqual(['谢射']);
    expect('setup' in row).toBe(false);
    expect(row.homework).toEqual({
      percent: 40,
      cards_total: 30,
      cards_started: 12,
      cards_mastered: 6,
      lessons_total: 1,
      lessons_completed: 0,
    });
    expect(row.last_conversation_id).toBe('conv-1');
  });
  it('includes the setup checklist for a brand-new student', () => {
    const row = compactStudentRow(overview({ is_new: true }), API);
    expect(row.setup?.done_count).toBe(2);
    expect(row.setup?.steps.map((s) => s.key)).toEqual(['signed_in', 'homework', 'installed', 'first_session']);
    expect(row.setup?.install_kind).toBe('browser');
  });
});

describe('compactMyRelationships', () => {
  it('names the other party from either side of the relationship', () => {
    const me = { id: 'me', name: 'Jerome', email: 'j@example.com' };
    const tutor = { id: 't', name: 'Laoshi', email: 'l@example.com' };
    const mine: MyRelationships = {
      tutors: [
        {
          id: 'rel-t',
          requester_id: 't',
          recipient_id: 'me',
          requester_role: 'tutor',
          status: 'active',
          created_at: '2026-01-01',
          accepted_at: '2026-01-02',
          requester: tutor,
          recipient: me,
        },
      ],
      students: [],
      pending_incoming: [],
      pending_outgoing: [
        {
          id: 'rel-p',
          requester_id: 'me',
          recipient_id: 'x',
          requester_role: 'tutor',
          status: 'pending',
          created_at: '2026-02-01',
          accepted_at: null,
          requester: me,
          recipient: { id: 'x', name: null, email: 'x@example.com' },
        },
      ],
    };
    const out = compactMyRelationships(mine, 'me');
    expect(out.my_tutors).toEqual([{ relationship_id: 'rel-t', tutor, since: '2026-01-02' }]);
    expect(out.pending_outgoing[0]).toMatchObject({ relationship_id: 'rel-p', to: { id: 'x' }, i_would_be: 'tutor' });
    expect(out.pending_incoming).toEqual([]);
  });
});

describe('insights shaping', () => {
  it('drops the bulky events array from struggling words and flattens the note', () => {
    const s: StrugglingNote = {
      note,
      score: 3.2,
      attempts: 5,
      again_count: 3,
      again_rate: 0.6,
      hard_count: 1,
      forgot_count: 2,
      avg_time_ms: 4000,
      last_reviewed_at: '2026-09-18T10:00:00.000Z',
      by_card_type: { meaning_to_hanzi: { attempts: 5, again_count: 3, accuracy: 0.4 } },
      wrong_answers: ['谢射', '射谢'],
      wrong_typed_count: 2,
      recordings_count: 0,
      events: [{ big: true }],
    };
    const out = compactStruggling(s) as Record<string, unknown>;
    expect(out.events).toBeUndefined();
    expect(out.note).toBeUndefined();
    expect(out).toMatchObject({ note_id: 'n1', hanzi: '谢谢', deck: 'HSK 1', deck_id: 'd1', wrong_answers: ['谢射', '射谢'] });
  });
  it('filters and compacts recordings', () => {
    const marked = recording('b', { review_event_id: 'b', status: 'needs_work', comment: 'tone', updated_at: 'now' });
    const list = [recording('a'), marked];
    expect(filterRecordings(list, true).map((r) => r.event_id)).toEqual(['a']);
    expect(filterRecordings(list, false)).toHaveLength(2);
    expect(compactRecording(marked, API)).toEqual({
      event_id: 'b',
      hanzi: '谢谢',
      pinyin: 'xièxie',
      english: 'thanks',
      deck: 'HSK 1',
      card_type: 'hanzi_to_meaning',
      rating: 'good',
      recorded_at: '2026-09-18T10:00:00.000Z',
      audio_url: `${API}/api/audio/recordings/b.webm`,
      user_answer: null,
      mark: { status: 'needs_work', comment: 'tone', updated_at: 'now' },
    });
  });
});

describe('messages', () => {
  it('labels my own messages and keeps only the tail', () => {
    const m = (id: string, sender_id: string): MessageRow => ({
      id,
      conversation_id: 'c',
      sender_id,
      content: `msg ${id}`,
      created_at: id,
      check_status: null,
      check_feedback: null,
      recording_url: null,
      reply_to_message_id: null,
      translation: null,
      sender: { id: sender_id, name: sender_id === 'me' ? 'Jerome' : 'Mei' },
    });
    const msgs = [m('1', 'me'), m('2', 'stu'), m('3', 'stu')];
    expect(lastMessages(msgs, 2).map((x) => x.id)).toEqual(['2', '3']);
    expect(lastMessages(msgs, 10)).toHaveLength(3);
    expect(compactMessage(msgs[0], 'me', API).from).toBe('me');
    expect(compactMessage(msgs[1], 'me', API).from).toBe('Mei');
    expect('audio_url' in compactMessage(msgs[1], 'me', API)).toBe(false);
  });
});

describe('compactSharedDeckProgress', () => {
  it('caps the words and labels recent ratings', () => {
    const p: SharedDeckProgress = {
      deck_name: 'HSK 1',
      shared_at: '2026-09-01',
      student: { id: 'u', name: 'Mei', email: null },
      completion: { total_cards: 6, cards_seen: 3, cards_mastered: 0, percent_seen: 50, percent_mastered: 0 },
      card_type_breakdown: {
        hanzi_to_meaning: { total: 2, new: 1, learning: 1, familiar: 0, mastered: 0 },
        meaning_to_hanzi: { total: 2, new: 1, learning: 1, familiar: 0, mastered: 0 },
        audio_to_hanzi: { total: 2, new: 1, learning: 1, familiar: 0, mastered: 0 },
      },
      notes: [
        { hanzi: '你好', pinyin: 'nǐ hǎo', english: 'hello', mastery_percent: 60, recent_ratings: { hanzi_to_meaning: [2, 0], meaning_to_hanzi: [], audio_to_hanzi: [3] } },
        { hanzi: '谢谢', pinyin: 'xièxie', english: 'thanks', mastery_percent: 10, recent_ratings: { hanzi_to_meaning: [], meaning_to_hanzi: [], audio_to_hanzi: [] } },
      ],
      activity: { last_studied_at: null, total_study_time_ms: 0, reviews_last_7_days: 0 },
    };
    const out = compactSharedDeckProgress(p, 1);
    expect(out.words_total).toBe(2);
    expect(out.words).toHaveLength(1);
    expect(out.words[0].recent_ratings).toEqual({ hanzi_to_meaning: ['good', 'again'], meaning_to_hanzi: [], audio_to_hanzi: ['easy'] });
  });
});

describe('compactInvite', () => {
  it('parses share_deck_ids and summarises uses and redemptions', () => {
    const row: InviteRow = {
      id: 'tok',
      url: 'https://app/join/tok',
      status: 'used',
      email: null,
      inviter_role: 'tutor',
      share_deck_ids: '["d1","d2"]',
      max_uses: 1,
      use_count: 1,
      expires_at: null,
      revoked_at: null,
      created_at: '2026-09-01',
      note: 'for Mei',
      welcome_message: '欢迎!',
      opened_at: '2026-09-02',
      redemptions: [{ user_id: 'u', redeemed_at: '2026-09-03', user_name: 'Mei', user_email: 'mei@example.com' }],
    };
    const out = compactInvite(row);
    expect(out).toMatchObject({ invite_id: 'tok', share_deck_ids: ['d1', 'd2'], uses: '1/1', link_opened_at: '2026-09-02' });
    expect(out.redemptions).toEqual([{ user_id: 'u', name: 'Mei', email: 'mei@example.com', redeemed_at: '2026-09-03' }]);
    expect(compactInvite({ ...row, share_deck_ids: 'not json' }).share_deck_ids).toEqual([]);
  });
});

// ---------- Tool handlers end to end (fake server + fake API) ----------

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>;

interface Call {
  method: string;
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
}

function fakeContext(routes: Record<string, unknown | ((call: Call) => unknown)>) {
  const tools = new Map<string, { description: string; handler: Handler }>();
  const calls: Call[] = [];
  const respond = (call: Call) => {
    const key = `${call.method} ${call.path}`;
    if (!(key in routes)) throw new ApiError(404, `No fake route for ${key}`, null);
    const r = routes[key];
    return typeof r === 'function' ? (r as (c: Call) => unknown)(call) : r;
  };
  const api = {
    baseUrl: API,
    get: async (path: string, query?: Record<string, unknown>) => {
      const call = { method: 'GET', path, query };
      calls.push(call);
      return respond(call);
    },
    post: async (path: string, body?: unknown) => {
      const call = { method: 'POST', path, body: body ?? {} };
      calls.push(call);
      return respond(call);
    },
    put: async (path: string, body?: unknown) => {
      const call = { method: 'PUT', path, body: body ?? {} };
      calls.push(call);
      return respond(call);
    },
    patch: async (path: string, body?: unknown) => {
      const call = { method: 'PATCH', path, body: body ?? {} };
      calls.push(call);
      return respond(call);
    },
    delete: async (path: string) => {
      const call = { method: 'DELETE', path };
      calls.push(call);
      return respond(call);
    },
  };
  const ctx = {
    server: {
      tool: (name: string, description: string, _shape: unknown, handler: Handler) => {
        tools.set(name, { description, handler });
      },
    },
    env: {},
    userId: 'me',
    userName: 'Jerome',
    userEmail: 'j@example.com',
    api: api as unknown as ApiClient,
  } as unknown as ToolContext;
  registerStudentTools(ctx);
  return { tools, calls };
}

function parse(result: CallToolResult): Record<string, unknown> {
  const first = result.content[0];
  if (first.type !== 'text') throw new Error('expected text content');
  return JSON.parse(first.text) as Record<string, unknown>;
}

const EXPECTED_TOOLS = [
  'list_students',
  'get_student_overview',
  'get_student_insights',
  'get_student_history',
  'get_student_daily_progress',
  'get_student_day',
  'write_student_summary',
  'list_student_summaries',
  'list_student_recordings',
  'mark_recording',
  'clear_recording_mark',
  'log_lesson',
  'list_lesson_log',
  'delete_lesson_log_entry',
  'send_message_to_student',
  'list_conversations',
  'get_conversation_messages',
  'send_install_howto',
  'list_student_homework',
  'get_shared_deck_progress',
  'share_deck_with_student',
  'update_student_deck_copy',
  'move_student_deck',
  'create_student_invite',
  'list_invites',
  'revoke_invite',
];

describe('registerStudentTools', () => {
  it('registers every student tool with a description', () => {
    const { tools } = fakeContext({});
    expect([...tools.keys()].sort()).toEqual([...EXPECTED_TOOLS].sort());
    for (const [name, t] of tools) expect(t.description.length, name).toBeGreaterThan(40);
  });

  it('move_student_deck posts the move and returns the new position', async () => {
    const { tools, calls } = fakeContext({
      'POST /api/relationships/rel-1/shared-decks/sd-1/move': (call: Call) => ({
        shared_deck_id: 'sd-1',
        target_deck_id: 'deck-s',
        queue_position: (call.body as { to: string }).to === 'top' ? 1 : 4,
        queue_total: 6,
      }),
    });
    const res = await tools.get('move_student_deck')!.handler({ relationship_id: 'rel-1', shared_deck_id: 'sd-1', to: 'top' });
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/relationships/rel-1/shared-decks/sd-1/move', body: { to: 'top' } });
    const text = (res.content[0] as { text: string }).text;
    expect(JSON.parse(text)).toEqual({ shared_deck_id: 'sd-1', target_deck_id: 'deck-s', queue_position: 1, queue_total: 6 });
  });

  it('list_students calls the dashboard with tz_offset and the relationships list, in parallel', async () => {
    const { tools, calls } = fakeContext({
      'GET /api/tutor/dashboard': {
        students: [overview()],
        invites: [
          {
            id: 'tok',
            url: 'https://app/join/tok',
            email: null,
            inviter_role: 'tutor',
            created_at: '2026-09-10',
            expires_at: null,
            note: null,
            share_deck_count: 1,
            opened_at: '2026-09-11',
          },
        ],
        homework_decks: [{ deck_id: 'd1', name: 'HSK 1', note_count: 10 }],
        generated_at: '2026-09-20T00:00:00.000Z',
      },
      'GET /api/relationships': { tutors: [], students: [], pending_incoming: [], pending_outgoing: [], pending_invitations: [] },
    });
    const out = parse(await tools.get('list_students')!.handler({ tz_offset_minutes: -120 }));
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /api/tutor/dashboard', 'GET /api/relationships']);
    expect(calls[0].query).toEqual({ tz_offset: -120 });
    expect((out.students as unknown[]).length).toBe(1);
    expect((out.students as Array<{ relationship_id: string }>)[0].relationship_id).toBe('rel-1');
    expect(out.pending_invites).toEqual([
      expect.objectContaining({ invite_id: 'tok', link_opened_at: '2026-09-11', share_deck_count: 1 }),
    ]);
    expect(out.my_tutors).toEqual([]);
    expect(out.homework_decks).toEqual([{ deck_id: 'd1', name: 'HSK 1', note_count: 10 }]);
  });

  it('get_student_insights forwards the range, trims lists to top_n and drops events', async () => {
    const struggling = Array.from({ length: 20 }, (_, i) => ({
      note: { ...note, id: `n${i}` },
      score: 20 - i,
      attempts: 3,
      again_count: 1,
      again_rate: 0.3,
      hard_count: 0,
      forgot_count: 0,
      avg_time_ms: null,
      last_reviewed_at: '2026-09-18',
      by_card_type: {},
      wrong_answers: [],
      wrong_typed_count: 0,
      recordings_count: 0,
      events: [{}, {}],
    }));
    const { tools, calls } = fakeContext({
      'GET /api/relationships/rel-1/insights': {
        range: { from: '2026-09-01T00:00:00.000Z', to: '2026-09-20T23:59:59.999Z' },
        since_lesson: null,
        latest_lesson: null,
        totals: { reviews: 100 },
        struggling,
        going_well: [],
        activity: { lessons: [], readers: [], quests: [] },
        recordings: [recording('a')],
      },
    });
    const out = parse(
      await tools.get('get_student_insights')!.handler({ relationship_id: 'rel-1', from: '2026-09-01', to: '2026-09-20', top_n: 3 })
    );
    expect(calls[0].query).toEqual({ from: '2026-09-01', to: '2026-09-20' });
    expect(out.struggling_total).toBe(20);
    expect((out.struggling as unknown[]).length).toBe(3);
    expect((out.struggling as Array<Record<string, unknown>>)[0].events).toBeUndefined();
    expect((out.recordings as Array<Record<string, unknown>>)[0].audio_url).toBe(`${API}/api/audio/recordings/a.webm`);
  });

  it('get_student_history passes every filter as a query param and returns next_cursor', async () => {
    const { tools, calls } = fakeContext({
      'GET /api/relationships/rel-1/history': {
        range: { from: 'f', to: 't' },
        events: [
          {
            event_id: 'e1',
            card_id: 'c1',
            card_type: 'meaning_to_hanzi',
            note_id: 'n1',
            hanzi: '谢谢',
            pinyin: 'xièxie',
            english: 'thanks',
            deck_id: 'd1',
            deck_name: 'HSK 1',
            rating: 0,
            time_spent_ms: 5000,
            user_answer: '谢射',
            recording_url: null,
            reviewed_at: '2026-09-18T10:00:00.000Z',
          },
        ],
        next_cursor: '2026-09-18T10:00:00.000Z|e1',
        decks: [{ id: 'd1', name: 'HSK 1' }],
      },
    });
    const out = parse(
      await tools.get('get_student_history')!.handler({
        relationship_id: 'rel-1',
        deck_id: 'd1',
        card_type: 'meaning_to_hanzi',
        rating: 0,
        q: '谢',
        cursor: 'abc|def',
        limit: 25,
      })
    );
    expect(calls[0].query).toEqual({
      from: undefined,
      to: undefined,
      deck_id: 'd1',
      card_type: 'meaning_to_hanzi',
      rating: 0,
      q: '谢',
      cursor: 'abc|def',
      limit: 25,
    });
    expect(out.next_cursor).toBe('2026-09-18T10:00:00.000Z|e1');
    expect((out.events as Array<Record<string, unknown>>)[0]).toMatchObject({ rating: 'again', user_answer: '谢射', deck: 'HSK 1' });
    expect(out.decks).toEqual([{ id: 'd1', name: 'HSK 1' }]);
  });

  it('send_message_to_student opens the latest conversation then posts the message', async () => {
    const { tools, calls } = fakeContext({
      'POST /api/relationships/rel-1/conversations/open': { conversation_id: 'conv-9', created: true },
      'POST /api/conversations/conv-9/messages': (call: Call) => ({
        id: 'm1',
        content: (call.body as { content: string }).content,
        created_at: '2026-09-20T09:00:00.000Z',
      }),
    });
    const out = parse(await tools.get('send_message_to_student')!.handler({ relationship_id: 'rel-1', text: '今天练习第三课' }));
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /api/relationships/rel-1/conversations/open',
      'POST /api/conversations/conv-9/messages',
    ]);
    expect(calls[1].body).toEqual({ content: '今天练习第三课' });
    expect(out).toEqual({
      conversation_id: 'conv-9',
      conversation_created: true,
      message: { message_id: 'm1', content: '今天练习第三课', created_at: '2026-09-20T09:00:00.000Z' },
    });
  });

  it('send_message_to_student skips the open call when a conversation is given', async () => {
    const { tools, calls } = fakeContext({
      'POST /api/conversations/conv-2/messages': { id: 'm2', content: 'hi', created_at: 'now' },
    });
    await tools.get('send_message_to_student')!.handler({ relationship_id: 'rel-1', text: 'hi', conversation_id: 'conv-2' });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /api/conversations/conv-2/messages']);
  });

  it('mark_recording PUTs the status and comment; clear_recording_mark DELETEs', async () => {
    const { tools, calls } = fakeContext({
      'PUT /api/relationships/rel-1/recordings/ev-1/mark': { mark: { review_event_id: 'ev-1', status: 'needs_work', comment: 'tone', updated_at: 'now' } },
      'DELETE /api/relationships/rel-1/recordings/ev-1/mark': { success: true },
    });
    const out = parse(
      await tools.get('mark_recording')!.handler({ relationship_id: 'rel-1', event_id: 'ev-1', status: 'needs_work', comment: 'tone' })
    );
    expect(calls[0].body).toEqual({ status: 'needs_work', comment: 'tone' });
    expect(out.mark).toEqual({ status: 'needs_work', comment: 'tone', updated_at: 'now' });
    const cleared = await tools.get('clear_recording_mark')!.handler({ relationship_id: 'rel-1', event_id: 'ev-1' });
    expect(cleared.isError).toBeFalsy();
    expect(calls[1]).toEqual({ method: 'DELETE', path: '/api/relationships/rel-1/recordings/ev-1/mark' });
  });

  it('log_lesson defaults lesson_at to now (server side) and reports the student-notes copy', async () => {
    const { tools, calls } = fakeContext({
      'POST /api/relationships/rel-1/lesson-log': {
        entry: { id: 'll1', relationship_id: 'rel-1', tutor_id: 'me', student_id: 'u', lesson_at: '2026-09-20T12:00:00.000Z', notes: 'Lesson 3', created_at: 'now' },
        student_lesson_note_id: 'note-1',
      },
    });
    const out = parse(await tools.get('log_lesson')!.handler({ relationship_id: 'rel-1', lesson_at: '2026-09-20', notes: 'Lesson 3' }));
    expect(calls[0].body).toEqual({ lesson_at: '2026-09-20', notes: 'Lesson 3' });
    expect(out.copied_to_student_notes).toBe(true);
    expect((out.entry as { id: string }).id).toBe('ll1');
  });

  it('list_student_homework combines shared decks, per-deck progress and student lessons', async () => {
    const { tools, calls } = fakeContext({
      'GET /api/relationships/rel-1/shared-decks': [
        { id: 'sd1', relationship_id: 'rel-1', source_deck_id: 'd1', target_deck_id: 'd1c', shared_at: 's', source_deck_name: 'HSK 1', target_deck_name: 'HSK 1 (from tutor)' },
      ],
      'GET /api/relationships/rel-1/student-lessons': {
        lessons: [{ id: 'l1', title: 'Tones', description: null, icon: null, source: 'library', created_at: 'c', exercise_count: 5, library_item_id: 'lib1', assigned_by: 'me', assigned_by_me: true, completions: 1, last_completed_at: 'x', last_rating: 2, last_score: { correct: 4, total: 5 } }],
      },
      'GET /api/relationships/rel-1/shared-decks/sd1/progress': {
        deck_name: 'HSK 1',
        shared_at: 's',
        student: { id: 'u', name: 'Mei', email: null },
        completion: { total_cards: 30, cards_seen: 10, cards_mastered: 2, percent_seen: 33, percent_mastered: 7 },
        card_type_breakdown: {},
        notes: [{ hanzi: '一', pinyin: 'yī', english: 'one', mastery_percent: 50, recent_ratings: { hanzi_to_meaning: [], meaning_to_hanzi: [], audio_to_hanzi: [] } }],
        activity: { last_studied_at: 'y', total_study_time_ms: 1000, reviews_last_7_days: 3 },
      },
    });
    const out = parse(await tools.get('list_student_homework')!.handler({ relationship_id: 'rel-1' }));
    expect(calls.map((c) => c.path)).toEqual([
      '/api/relationships/rel-1/shared-decks',
      '/api/relationships/rel-1/student-lessons',
      '/api/relationships/rel-1/shared-decks/sd1/progress',
    ]);
    expect(out.decks).toEqual([
      expect.objectContaining({
        shared_deck_id: 'sd1',
        name: 'HSK 1',
        completion: expect.objectContaining({ percent_seen: 33 }),
        activity: expect.objectContaining({ reviews_last_7_days: 3 }),
      }),
    ]);
    expect((out.decks as Array<Record<string, unknown>>)[0].notes).toBeUndefined();
    expect((out.lessons as Array<Record<string, unknown>>)[0]).toMatchObject({ lesson_id: 'l1', assigned_by_me: true, last_score: { correct: 4, total: 5 } });
  });

  it('create_student_invite always invites as tutor and returns the join url', async () => {
    const { tools, calls } = fakeContext({
      'POST /api/invites': (call: Call) => ({
        id: 'tok',
        url: 'https://app/join/tok',
        status: 'active',
        email: (call.body as { email: string | null }).email,
        inviter_role: (call.body as { inviter_role: string }).inviter_role,
        share_deck_ids: JSON.stringify((call.body as { share_deck_ids: string[] }).share_deck_ids),
        max_uses: 1,
        use_count: 0,
        expires_at: null,
        revoked_at: null,
        created_at: 'now',
        note: null,
        welcome_message: (call.body as { welcome_message: string | null }).welcome_message,
        opened_at: null,
        redemptions: [],
      }),
    });
    const out = parse(await tools.get('create_student_invite')!.handler({ share_deck_ids: ['d1'], welcome_message: '欢迎' }));
    expect(calls[0].body).toEqual({
      inviter_role: 'tutor',
      share_deck_ids: ['d1'],
      welcome_message: '欢迎',
      email: null,
      expires_in_days: null,
      max_uses: 1,
      note: null,
    });
    expect(out).toMatchObject({ invite_id: 'tok', url: 'https://app/join/tok', inviter_role: 'tutor', share_deck_ids: ['d1'], uses: '0/1' });
  });

  it('surfaces API errors (e.g. no AI key for summaries) as isError results with the status', async () => {
    const { tools } = fakeContext({
      'POST /api/relationships/rel-1/insights/summary': () => {
        throw new ApiError(503, 'AI summaries are not configured on this server (missing ANTHROPIC_API_KEY)', null);
      },
    });
    const result = await tools.get('write_student_summary')!.handler({ relationship_id: 'rel-1' });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('missing ANTHROPIC_API_KEY');
    expect((result.content[0] as { text: string }).text).toContain('HTTP 503');
  });

  it('rejects an unparseable date before calling the API', async () => {
    const { tools, calls } = fakeContext({});
    const result = await tools.get('get_student_insights')!.handler({ relationship_id: 'rel-1', from: 'yesterday' });
    expect(result.isError).toBe(true);
    expect(calls).toEqual([]);
  });
});
