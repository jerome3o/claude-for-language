import { describe, it, expect } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ZodTypeAny } from 'zod';
import { registerStudentTools } from './students.js';
import { registerContentTools } from './content.js';
import { registerHomeworkTools } from './homework.js';
import type { ToolContext } from './context.js';
import { CREATE_THEN_SEND, SEND_RULE, nameMatches } from './homework-send.js';

/**
 * Create, then send (Minghui, Oct 2026 — an agent sent a 319-word deck she never
 * meant to send): no create tool reaches a student, and every send tool needs an
 * explicit student and `confirm: true`.
 */

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>;
interface Call { method: string; path: string; body?: unknown }

/** Paths that put something in a student's account. */
const SENDING = [/\/homework$/, /\/share-(deck|reader)$/, /\/assign$/, /\/push-update$/, /\/shared-decks\/[^/]+\/update$/, /\/session-notes\/[^/]+\/send$/, /\/homework-drafts\/[^/]+\/assign$/];
const sends = (c: Call) => c.method === 'POST' && SENDING.some((r) => r.test(c.path));

/** A permissive fake API: enough of every answer for the create tools to finish. */
function answer(method: string, path: string, body: unknown): unknown {
  if (path === '/api/relationships') return { students: [{ id: 'rel-1', requester_id: 'tutor-1', recipient_id: 's', requester_role: 'tutor', status: 'active', recipient: { name: 'Jerome' } }], tutors: [] };
  if (method === 'POST' && path === '/api/decks') return { id: 'deck-1', name: 'Weather' };
  if (path.includes('/notes/batch')) return { created: (body as { notes: Array<{ hanzi: string }> }).notes.map((n, i) => ({ id: `n${i}`, hanzi: n.hanzi, audio_url: null })), failed: [] };
  if (method === 'GET' && path.startsWith('/api/decks/')) return { id: 'deck-1', notes: [] };
  if (path.endsWith('/shared-decks')) return [{ id: 'share-1', source_deck_id: 'src', target_deck_id: 'tgt', source_deck_name: 'Weather' }];
  if (path === '/api/readers/import') return { id: 'r1', status: 'ready', image_jobs: 0, spec: {} };
  if (path === '/api/readers/generate') return { id: 'r2', status: 'generating' };
  if (path.startsWith('/api/lesson-library')) return { id: 'lib-1', title: 'Tones', version: 1, tags: [], spec: { sections: [] } };
  if (path === '/api/decks/starter') return { deck: { id: 'st', name: 'Starter Chinese' }, created: true, word_count: 15 };
  if (path.endsWith('/session-notes')) return { job: { id: 'job-1', relationship_id: 'rel-1', status: 'queued', steps: [], result: {}, auto_share: false } };
  if (path.endsWith('/lesson-notes')) return { entry: { id: 'e1' }, job: { id: 'job-2', status: 'queued' } };
  return {};
}

function fake() {
  const tools = new Map<string, { description: string; shape: Record<string, ZodTypeAny>; handler: Handler }>();
  const calls: Call[] = [];
  const respond = (method: string, path: string, body?: unknown) => {
    calls.push({ method, path, body });
    return Promise.resolve(answer(method, path, body));
  };
  const api = {
    baseUrl: 'https://api.example',
    get: (path: string) => respond('GET', path),
    post: (path: string, body?: unknown) => respond('POST', path, body ?? {}),
    put: (path: string, body?: unknown) => respond('PUT', path, body ?? {}),
    patch: (path: string, body?: unknown) => respond('PATCH', path, body ?? {}),
    delete: (path: string) => respond('DELETE', path),
  };
  const server = {
    tool: (name: string, description: string, shape: Record<string, ZodTypeAny>, handler: Handler) => tools.set(name, { description, shape, handler }),
  };
  const ctx = { server, api, env: {}, userId: 'tutor-1', userName: 'Minghui', userEmail: null } as unknown as ToolContext;
  registerStudentTools(ctx);
  registerContentTools(ctx);
  registerHomeworkTools(ctx);
  return { tools, calls };
}

const text = (r: CallToolResult) => r.content.map((c) => (c.type === 'text' ? c.text : '')).join('');
const words = [{ hanzi: '刮风', pinyin: 'guā fēng', english: 'windy' }];
const reader = { title_chinese: '小猫找家', title_english: 'The Kitten', difficulty_level: 'beginner', pages: [{ content_chinese: '小猫很饿。', content_pinyin: '', content_english: 'The kitten is hungry.' }] };

/** Every tool that makes content — with the arguments a chat would pass. */
const CREATE_CALLS: Array<[string, Record<string, unknown>]> = [
  ['create_homework_deck', { name: 'Weather', notes: words }],
  ['create_homework_deck', { name: 'Weather', notes: words, for_relationship_id: 'rel-1' }],
  // The deprecated name with a student: still only a label.
  ['create_deck_for_student', { relationship_id: 'rel-1', name: 'Weather', notes: words }],
  ['add_words_to_student_deck', { relationship_id: 'rel-1', shared_deck_id: 'share-1', notes: words }],
  ['get_starter_deck', {}],
  ['create_reader', { spec: reader }],
  ['generate_reader', { deck_ids: ['deck-1'] }],
  ['create_library_lesson', { generate_prompt: 'A2 lesson on 了' }],
  ['duplicate_library_lesson', { library_id: 'lib-1' }],
  ['submit_session_notes', { relationship_id: 'rel-1', notes: 'x'.repeat(40) }],
  ['add_student_lesson_notes', { relationship_id: 'rel-1', notes: 'x'.repeat(40) }],
];

describe('create tools never send', () => {
  it.each(CREATE_CALLS)('%s keeps everything in the tutor account', async (name, args) => {
    const { tools, calls } = fake();
    const res = await tools.get(name)!.handler(args);
    expect(res.isError, text(res)).toBeFalsy();
    expect(calls.filter(sends)).toEqual([]);
    // submit_session_notes asks the API not to send either.
    for (const c of calls) if (c.body && typeof c.body === 'object' && 'auto_share' in c.body) expect((c.body as { auto_share: unknown }).auto_share).toBe(false);
  });

  it('create replies say "not sent"', async () => {
    const { tools } = fake();
    for (const name of ['create_homework_deck', 'create_deck_for_student', 'create_reader', 'generate_reader', 'create_library_lesson', 'add_words_to_student_deck']) {
      const args = CREATE_CALLS.find(([n]) => n === name)![1];
      expect(text(await tools.get(name)!.handler(args)), name).toContain('Saved in your account (not sent)');
    }
  });

  it('create_homework_deck refuses send_now without a student and confirm, before creating anything', async () => {
    const { tools, calls } = fake();
    for (const extra of [{ send_now: true }, { send_now: true, relationship_id: 'rel-1' }, { send_now: true, confirm: true }]) {
      const res = await tools.get('create_homework_deck')!.handler({ name: 'Weather', notes: words, ...extra });
      expect(res.isError).toBe(true);
    }
    expect(calls).toEqual([]);
  });
});

describe('send tools need an explicit student and confirm: true', () => {
  const sendTools = () => [...fake().tools.entries()].filter(([, t]) => t.description.startsWith(SEND_RULE));

  it('finds the send tools by their description', () => {
    expect(sendTools().map(([n]) => n).sort()).toEqual([
      'assign_homework', 'assign_homework_draft', 'assign_lesson_to_students', 'push_lesson_update',
      'send_session_notes_items', 'share_deck_with_student', 'share_reader_with_student', 'update_student_deck_copy',
    ]);
  });

  it.each(['assign_homework', 'assign_homework_draft', 'assign_lesson_to_students', 'push_lesson_update', 'send_session_notes_items', 'share_deck_with_student', 'share_reader_with_student', 'update_student_deck_copy'])(
    '%s: confirm must be literally true, and the student is required',
    (name) => {
      const tool = fake().tools.get(name)!;
      const confirm = tool.shape.confirm;
      expect(confirm, 'has a confirm param').toBeDefined();
      expect(confirm.safeParse(undefined).success).toBe(false);
      expect(confirm.safeParse(false).success).toBe(false);
      expect(confirm.safeParse(true).success).toBe(true);
      const student = tool.shape.relationship_id ?? tool.shape.relationship_ids;
      expect(student, 'names the student').toBeDefined();
      expect(student.safeParse(undefined).success).toBe(false);
    },
  );

  it('a send tool called without confirm touches nothing', async () => {
    const { tools, calls } = fake();
    for (const [, t] of [...tools.entries()].filter(([, t]) => t.description.startsWith(SEND_RULE))) {
      const res = await t.handler({ relationship_id: 'rel-1', relationship_ids: ['rel-1'], deck_id: 'deck-1', reader_id: 'r1', library_id: 'lib-1', job_id: 'job-1', shared_deck_id: 'share-1', items: [{ kind: 'deck', source_id: 'deck-1', mode: 'both' }] });
      expect(res.isError).toBe(true);
      expect(text(res)).toContain('Not sent');
    }
    expect(calls).toEqual([]);
  });
});

describe('the server instructions', () => {
  it('state the rule', () => {
    expect(CREATE_THEN_SEND).toContain('Never send anything to a student unless the tutor explicitly asks you to send that item to that named student in this conversation. When in doubt, create it and ask.');
  });

  it('nameMatches the student the tutor named', () => {
    expect(nameMatches('Jerome', 'Jerome Swannack', null)).toBe(true);
    expect(nameMatches('jerome s', 'Jerome Swannack', null)).toBe(true);
    expect(nameMatches('Mei', 'Jerome Swannack', 'jerome@example.com')).toBe(false);
  });
});
