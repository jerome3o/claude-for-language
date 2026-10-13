import { describe, expect, it } from 'vitest';
import { registerPreparedActivityTools, trimPrepared } from './prepared-activities';
import type { ToolContext } from './context';
import { ACTIVITY_CATALOGUE, type PreparedActivity } from '../../../shared/call-activities';

const dictation = ACTIVITY_CATALOGUE.find((a) => a.kind === 'dictation')!;
const row = (id: string, status: 'ready' | 'used', job_id = 'job-1'): PreparedActivity => ({
  id, relationship_id: 'rel-1', job_id, spec: dictation, why: 'New words from 5 Oct', status, source_lesson_id: 'L1', source_label: 'Lesson 5 Oct',
  position: 0, created_at: '2026-10-05 12:00:00', used_at: status === 'used' ? '2026-10-06 10:00:00' : null, used_in_call_id: null,
});

describe('prepared activity tools', () => {
  it('lists them with what is inside and what the student has covered; prepare waits for the job and reports only its activities', async () => {
    expect(trimPrepared(row('a', 'ready'))).toMatchObject({ id: 'a', kind: 'dictation', why: 'New words from 5 Oct', from: 'Lesson 5 Oct', status: 'ready' });
    expect(trimPrepared(row('a', 'ready')).content[0]).toBe('你好 nǐ hǎo — hello');
    const tools: Record<string, (args: Record<string, unknown>) => Promise<{ content: { text: string }[] }>> = {};
    const server = { tool: (name: string, _d: string, _s: unknown, fn: (a: Record<string, unknown>) => Promise<{ content: { text: string }[] }>) => void (tools[name] = fn) };
    const calls: string[] = [];
    let polls = 0;
    const api = {
      get: async (p: string) => {
        calls.push(`GET ${p}`);
        if (p.endsWith('/coverage')) return { coverage: { lessons: [], lesson_count: 3, words: { known: 2, learning: 3 }, characters: { known: 0, learning: 0 }, recent_words: [{ hanzi: '头疼' }], recent_corrections: [] } };
        polls++;
        return {
          activities: [row('a', 'ready'), row('b', 'used'), row('c', 'ready', 'job-2')],
          job: { id: 'job-2', status: polls > 1 ? 'done' : 'running', created_count: 1, cost_usd: 0.07, created_at: 'x', trigger: 'manual' },
          can_prepare: true,
        };
      },
      post: async (p: string, body: unknown) => {
        calls.push(`POST ${p} ${JSON.stringify(body)}`);
        return { job: { id: 'job-2', status: 'queued' }, started: true };
      },
    };
    registerPreparedActivityTools({ server, api, env: {}, userId: 'tutor-1' } as unknown as ToolContext);
    const list = JSON.parse((await tools.list_prepared_activities({ relationship_id: 'rel-1', include_used: false })).content[0].text);
    expect(list.headline).toBe('Ready for next lesson: 2 activities');
    expect(list.activities.map((a: { id: string }) => a.id)).toEqual(['a', 'c']);
    expect(list.covered.headline).toBe('5 words met (2 known well) · 3 lessons');

    polls = 0;
    const out = JSON.parse((await tools.prepare_activities({ relationship_id: 'rel-1', count: 3 })).content[0].text);
    expect(calls).toContain('POST /api/relationships/rel-1/prepared-activities {"count":3}');
    expect(out.status).toBe('done');
    expect(out.created.map((a: { id: string }) => a.id)).toEqual(['c']);
    // Never a sending endpoint.
    expect(calls.filter((c) => c.startsWith('POST')).every((c) => c.includes('/prepared-activities'))).toBe(true);
  }, 20_000);
});
