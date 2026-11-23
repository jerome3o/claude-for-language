import { describe, it, expect } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { registerAudioLessonFeedbackTools, type FeedbackResponse } from './audio-lesson-feedback';
import type { ToolContext } from './context';
import { buildFeedbackEvent, summarizeLessonFeedback } from '../../../shared/audio-lesson/feedback';
import { transcriptRows } from '../../../shared/audio-lesson/timeline';

type Handler = (args: Record<string, unknown>) => Promise<CallToolResult>;

const LINES = [
  { start_ms: 0, lang: 'zh' as const, voice: 'teacher' as const, text: '小明起床了。', pinyin: 'Xiǎomíng qǐchuáng le.', english: 'Xiaoming got up.', chapter: 0 },
  { start_ms: 65_000, lang: 'zh' as const, voice: 'teacher' as const, text: '他很累。', pinyin: 'tā hěn lèi.', english: 'He is tired.', chapter: 0 },
  { start_ms: 130_000, lang: 'zh' as const, voice: 'teacher' as const, text: '他去公司。', pinyin: 'tā qù gōngsī.', english: 'He goes to the office.', chapter: 0 },
];
const ROWS = transcriptRows(LINES);
const ev = (id: string, kind: 'too_hard' | 'again' | 'back_section' | 'skip', positionMs: number) =>
  buildFeedbackEvent({ id, lessonId: 'al-1', kind, where: 'lock_screen', positionMs, speed: 1, audioVersion: 'v2', createdAt: new Date(Date.UTC(2026, 10, 23, 8) + positionMs).toISOString(), rows: ROWS, chapters: [{ title: 'One', start_ms: 0 }] });

const EVENTS = [ev('e-000001', 'too_hard', 70_000), ev('e-000002', 'too_hard', 72_000), ev('e-000003', 'again', 75_000), ev('e-000004', 'skip', 131_000)];
const RESPONSE: FeedbackResponse = {
  lessons: [{
    lesson: { id: 'al-1', title: 'At the noodle shop', format: 'story', status: 'ready', duration_ms: 600_000, listened_at: null, created_at: '2026-11-22' },
    events: EVENTS,
    summary: summarizeLessonFeedback(EVENTS),
  }],
  cursor: '2026-11-23T08:03:00.000Z',
  more: false,
};

function fakeContext(response: FeedbackResponse = RESPONSE) {
  const tools = new Map<string, Handler>();
  const calls: string[] = [];
  const api = { get: async (path: string) => { calls.push(path); return response; } };
  const server = { tool: (name: string, _d: string, _s: unknown, handler: Handler) => tools.set(name, handler) };
  registerAudioLessonFeedbackTools({ server, api, env: {}, userId: 'u1' } as unknown as ToolContext);
  return { tools, calls };
}

const text = (r: CallToolResult) => r.content.map((c) => (c.type === 'text' ? c.text : '')).join('');

describe('get_audio_lesson_feedback', () => {
  it('reads the API and gives Claude the hardest lines first, trimmed', async () => {
    const { tools, calls } = fakeContext();
    const out = JSON.parse(text(await tools.get('get_audio_lesson_feedback')!({ lesson_id: 'al-1', since: '2026-11-01T00:00:00Z' })));
    expect(calls).toEqual(['/api/me/audio-lesson-feedback?lesson_id=al-1&since=2026-11-01T00%3A00%3A00Z']);
    const l = out.lessons[0];
    expect(l).toMatchObject({
      id: 'al-1', title: 'At the noodle shop', format: 'story', minutes: 10, listened_to_the_end: false, furthest_press_at: '2:11',
      listen_path: '/audio-lessons/al-1', counts: { too_hard: 2, went_back: 1, skipped: 1 },
      summary: 'Too hard ×2 · went back ×1 · skipped ×1 — hardest: 他很累。 (too hard ×2, replayed ×1)',
    });
    expect(l.hardest_lines[0]).toEqual({ at: '1:05', text: '他很累。', pinyin: 'tā hěn lèi.', english: 'He is tired.', too_hard: 2, replayed: 1 });
    expect(l.hardest_lines[1]).toMatchObject({ text: '他去公司。', skipped: 1 });
    expect(l.presses[0]).toEqual({ when: '2026-11-23T08:01:10.000Z', at: '1:10', what: 'too hard', from: 'lock_screen', playing: '他很累。 — He is tired.', line_before: '小明起床了。 — Xiaoming got up.' });
    expect(out.cursor).toBe('2026-11-23T08:03:00.000Z');
  });

  it('events: none drops the presses; nothing yet says how feedback is given', async () => {
    const { tools } = fakeContext();
    const out = JSON.parse(text(await tools.get('get_audio_lesson_feedback')!({ events: 'none' })));
    expect(out.lessons[0].presses).toBeUndefined();
    const empty = fakeContext({ lessons: [], cursor: null, more: false });
    const none = JSON.parse(text(await empty.tools.get('get_audio_lesson_feedback')!({})));
    expect(empty.calls).toEqual(['/api/me/audio-lesson-feedback']);
    expect(none.lessons).toEqual([]);
    expect(none.note).toMatch(/Too hard/);
  });
});
