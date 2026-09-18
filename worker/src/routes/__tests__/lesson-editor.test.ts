import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createMockD1, createTestRelationship, MockD1Database } from '../../services/__tests__/d1-mock';

let idCounter = 0;
vi.stubGlobal('crypto', {
  randomUUID: () => `uuid-${++idCounter}`,
});

import lessonEditor from '../lesson-editor';
import { Env } from '../../types';

const TUTOR = 'tutor-1';
const STUDENT = 'student-1';

const spec = {
  title: 'Ordering coffee',
  icon: '☕',
  sections: [
    {
      title: 'Warm-up',
      exercises: [
        { type: 'translate', english: 'I want a coffee', reference_hanzi: '我要一杯咖啡' },
        { type: 'describe_image', image_prompt: 'a busy café', reference_hanzi: '咖啡馆里有很多人' },
      ],
    },
  ],
};

function libraryRow(overrides: Partial<{ spec: unknown; version: number }> = {}) {
  return {
    id: 'lib-1',
    owner_id: TUTOR,
    title: 'Ordering coffee',
    description: null,
    icon: '☕',
    spec: JSON.stringify(overrides.spec ?? spec),
    tags: '["beginner"]',
    version: overrides.version ?? 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    archived_at: null,
  };
}

function copyRow(id: string, copySpec: unknown, relId = 'rel-1') {
  return {
    id,
    user_id: STUDENT,
    title: 'Ordering coffee',
    description: null,
    icon: '☕',
    spec: JSON.stringify(copySpec),
    source: 'api',
    status: 'active',
    created_at: '2026-01-02T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    library_item_id: 'lib-1',
    assigned_by: TUTOR,
    assigned_relationship_id: relId,
    student_name: 'Sam',
    student_email: 'sam@test.com',
    student_picture_url: null,
  };
}

function makeApp(db: MockD1Database, userId = TUTOR) {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', async (c, next) => {
    c.set('user', { id: userId } as never);
    await next();
  });
  app.route('/api', lessonEditor);
  const env = { DB: db, ANTHROPIC_API_KEY: '', GEMINI_API_KEY: '' } as unknown as Env;
  return (path: string, init?: RequestInit) => app.request(path, init, env);
}

function post(body: unknown): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

describe('lesson library routes', () => {
  let db: MockD1Database;

  beforeEach(() => {
    db = createMockD1();
    idCounter = 0;
    db.addResult('FROM lesson_library WHERE id = ? AND owner_id = ?', libraryRow());
    db.addResult('FROM tutor_relationships', createTestRelationship({ id: 'rel-1', requester_id: TUTOR, recipient_id: STUDENT, requester_role: 'tutor' }));
  });

  describe('POST /lesson-library/:id/assign', () => {
    it('creates a linked copy for the student and queues nothing without an image key', async () => {
      // The copy read back after INSERT
      db.addResult('FROM custom_lessons WHERE id = ?', copyRow('uuid-1', spec));
      const request = makeApp(db);
      const res = await request('/api/lesson-library/lib-1/assign', post({ relationship_ids: ['rel-1'] }));
      expect(res.status).toBe(200);
      const body = await res.json() as { assigned: unknown[]; already_had: unknown[]; errors: unknown[] };
      expect(body.assigned).toEqual([{ relationship_id: 'rel-1', lesson_id: 'uuid-1', student_id: STUDENT }]);
      expect(body.already_had).toEqual([]);
      expect(body.errors).toEqual([]);

      const insert = db.getQueries().find(q => q.sql.includes('INSERT INTO custom_lessons'));
      expect(insert).toBeDefined();
      // id, user_id, title, description, icon, spec, library_item_id, assigned_by, assigned_relationship_id
      expect(insert!.params[1]).toBe(STUDENT);
      expect(insert!.params[6]).toBe('lib-1');
      expect(insert!.params[7]).toBe(TUTOR);
      expect(insert!.params[8]).toBe('rel-1');
      expect(JSON.parse(insert!.params[5] as string).title).toBe('Ordering coffee');
    });

    it('reports students who already have a copy instead of duplicating', async () => {
      db.addResult('WHERE library_item_id = ? AND user_id = ?', copyRow('existing-1', spec));
      const request = makeApp(db);
      const res = await request('/api/lesson-library/lib-1/assign', post({ relationship_ids: ['rel-1'] }));
      const body = await res.json() as { assigned: unknown[]; already_had: Array<{ lesson_id: string }> };
      expect(body.assigned).toEqual([]);
      expect(body.already_had[0].lesson_id).toBe('existing-1');
      expect(db.getQueries().some(q => q.sql.includes('INSERT INTO custom_lessons'))).toBe(false);
    });

    it('refuses when the caller is the student in the relationship', async () => {
      db.reset();
      db.addResult('FROM lesson_library WHERE id = ? AND owner_id = ?', libraryRow());
      // Caller is the recipient with role student
      db.addResult('FROM tutor_relationships', createTestRelationship({ id: 'rel-1', requester_id: STUDENT, recipient_id: TUTOR, requester_role: 'tutor' }));
      const request = makeApp(db);
      const res = await request('/api/lesson-library/lib-1/assign', post({ relationship_ids: ['rel-1'] }));
      const body = await res.json() as { assigned: unknown[]; errors: Array<{ error: string }> };
      expect(body.assigned).toEqual([]);
      expect(body.errors[0].error).toMatch(/not the tutor/);
    });

    it('404s for a library item the caller does not own', async () => {
      db.reset();
      const request = makeApp(db, 'someone-else');
      const res = await request('/api/lesson-library/lib-1/assign', post({ relationship_ids: ['rel-1'] }));
      expect(res.status).toBe(404);
    });
  });

  describe('POST /lesson-library/:id/push-update', () => {
    it('overwrites copies that are behind, keeps their illustrations, skips current ones', async () => {
      const oldCopySpec = {
        ...spec,
        title: 'Old title',
        sections: [
          {
            title: 'Warm-up',
            exercises: [
              { type: 'translate', english: 'I want a coffee', reference_hanzi: '我要一杯咖啡' },
              { type: 'describe_image', image_prompt: 'a busy café', reference_hanzi: '咖啡馆里有很多人', image_url: 'readers/img-1.png' },
            ],
          },
        ],
      };
      db.addAllResult('WHERE c.library_item_id = ?', [
        copyRow('copy-behind', oldCopySpec),
        copyRow('copy-current', spec, 'rel-2'),
      ]);
      const request = makeApp(db);
      const res = await request('/api/lesson-library/lib-1/push-update', post({}));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ updated: 1, skipped: 1, image_jobs: 0 });

      const updates = db.getQueries().filter(q => q.sql.includes('UPDATE custom_lessons'));
      expect(updates).toHaveLength(1);
      // title, description, icon, spec, id
      expect(updates[0].params[0]).toBe('Ordering coffee');
      expect(updates[0].params[4]).toBe('copy-behind');
      const pushed = JSON.parse(updates[0].params[3] as string);
      expect(pushed.sections[0].exercises[1].image_url).toBe('readers/img-1.png');
    });

    it('limits the push to the given relationships', async () => {
      db.addAllResult('WHERE c.library_item_id = ?', [
        copyRow('copy-a', { ...spec, title: 'A' }, 'rel-a'),
        copyRow('copy-b', { ...spec, title: 'B' }, 'rel-b'),
      ]);
      const request = makeApp(db);
      const res = await request('/api/lesson-library/lib-1/push-update', post({ relationship_ids: ['rel-b'] }));
      expect(await res.json()).toEqual({ updated: 1, skipped: 0, image_jobs: 0 });
      const updates = db.getQueries().filter(q => q.sql.includes('UPDATE custom_lessons'));
      expect(updates[0].params[4]).toBe('copy-b');
    });
  });

  describe('GET /lesson-library/:id/assignments', () => {
    it('flags copies whose content differs from the library version', async () => {
      db.addAllResult('WHERE c.library_item_id = ?', [
        copyRow('copy-behind', { ...spec, title: 'Edited by student' }),
        copyRow('copy-current', spec, 'rel-2'),
      ]);
      db.addAllResult('FROM custom_lesson_completions c', [
        { lesson_id: 'copy-current', completions: 2, last_completed_at: '2026-02-01T00:00:00Z', last_rating: 3, last_correct: 4, last_total: 5 },
      ]);
      const request = makeApp(db);
      const res = await request('/api/lesson-library/lib-1/assignments');
      const body = await res.json() as { assignments: Array<Record<string, unknown>> };
      expect(body.assignments.map(a => [a.lesson_id, a.up_to_date, a.completions])).toEqual([
        ['copy-behind', false, 0],
        ['copy-current', true, 2],
      ]);
      expect(body.assignments[1].last_score).toEqual({ correct: 4, total: 5 });
      expect(body.assignments[1].student).toEqual({ id: STUDENT, name: 'Sam', email: 'sam@test.com', picture_url: null });
    });
  });

  describe('editor chat', () => {
    it('answers 503 without an API key and never stores the message', async () => {
      db.addResult('FROM editor_chats WHERE owner_id', { id: 'chat-1', owner_id: TUTOR, target_type: 'library', target_id: 'lib-1' });
      const request = makeApp(db);
      const res = await request('/api/editor-chat/library/lib-1/messages', post({ message: 'make it easier', current_spec: spec }));
      expect(res.status).toBe(503);
      expect(db.getQueries().some(q => q.sql.includes('INSERT INTO editor_chat_messages'))).toBe(false);
    });

    it('get-or-creates the chat and returns annotated messages', async () => {
      db.addResult('FROM editor_chats WHERE owner_id', { id: 'chat-1', owner_id: TUTOR, target_type: 'library', target_id: 'lib-1' });
      const proposed = { ...spec, title: 'Proposed title' };
      db.addAllResult('FROM editor_chat_messages WHERE chat_id', [
        { id: 'm1', chat_id: 'chat-1', role: 'user', content: 'rename it', spec_snapshot: JSON.stringify(spec), proposed_spec: null, proposal_status: null, created_at: '2026-01-01T00:00:00Z' },
        { id: 'm2', chat_id: 'chat-1', role: 'assistant', content: 'Renamed.', spec_snapshot: JSON.stringify(spec), proposed_spec: JSON.stringify(proposed), proposal_status: 'accepted', created_at: '2026-01-01T00:00:01Z' },
        { id: 'm3', chat_id: 'chat-1', role: 'user', content: 'thanks', spec_snapshot: JSON.stringify({ ...proposed, icon: '🍵' }), proposed_spec: null, proposal_status: null, created_at: '2026-01-01T00:00:02Z' },
      ]);
      const request = makeApp(db);
      const res = await request('/api/editor-chat/library/lib-1');
      expect(res.status).toBe(200);
      const body = await res.json() as { ai_available: boolean; messages: Array<Record<string, unknown>> };
      expect(body.ai_available).toBe(false);
      expect(body.messages).toHaveLength(3);
      // The proposal's diff is against the snapshot it was made from
      const diff = body.messages[1].proposal_diff as { meta: Array<{ field: string }> };
      expect(diff.meta.map(m => m.field)).toEqual(['title']);
      // After an accepted proposal, only the author's OWN change (the icon) counts
      expect(body.messages[2].author_changes).toEqual(['icon: "☕" → "🍵"']);
    });
  });
});
