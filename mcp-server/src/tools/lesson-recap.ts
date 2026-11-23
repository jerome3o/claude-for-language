/**
 * Video lessons as material for a recap (docs/AUDIO_LESSONS.md "Composed lessons"): the signed-in
 * user's lessons (GET /api/calls, grouped into lessons — calls within two hours of each other) and
 * everything a recap needs from one (GET /api/calls/:id/recap: call members only). Read only: the
 * recap itself is made with compose_audio_lesson. Never the tutor's private student profile.
 */
import { z } from 'zod';
import type { ToolContext } from './context.js';
import { guard, jsonResult } from './context.js';

/** A row of GET /api/calls (services/calls/store.ts CallListItem), the fields used here. */
export interface CallListRow {
  id: string;
  relationship_id: string | null;
  title: string | null;
  status: string;
  processing_status: string;
  started_at: number | null;
  ended_at: number | null;
  created_at: string;
  lesson_id: string | null;
  has_summary: boolean;
  segment_count: number;
  other_user_name: string | null;
}

export interface MyLesson {
  lesson_id: string | null;
  /** The calls of the lesson, oldest first (get_lesson_for_recap takes any of them). */
  call_ids: string[];
  with: string | null;
  title: string | null;
  started_at: string | null;
  minutes: number | null;
  status: string;
  has_report: boolean;
  transcript_lines: number;
}

const iso = (ms: number | null): string | null => (ms && Number.isFinite(ms) ? new Date(ms).toISOString() : null);

/** Calls → lessons, newest first (a call without a lesson id is a lesson of its own). */
export function groupLessons(calls: readonly CallListRow[]): MyLesson[] {
  const byKey = new Map<string, CallListRow[]>();
  for (const c of calls) {
    const key = c.lesson_id ?? `call:${c.id}`;
    byKey.set(key, [...(byKey.get(key) ?? []), c]);
  }
  const lessons = [...byKey.values()].map((group) => {
    const sorted = [...group].sort((a, b) => (a.started_at ?? Date.parse(a.created_at)) - (b.started_at ?? Date.parse(b.created_at)));
    const start = sorted.map((c) => c.started_at).find((x) => x !== null) ?? null;
    const end = sorted.map((c) => c.ended_at).filter((x): x is number => x !== null).sort((a, b) => b - a)[0] ?? null;
    return {
      lesson_id: sorted[0].lesson_id,
      call_ids: sorted.map((c) => c.id),
      with: sorted[0].other_user_name,
      title: sorted.map((c) => c.title).find(Boolean) ?? null,
      started_at: iso(start) ?? sorted[0].created_at,
      minutes: start && end && end > start ? Math.round((end - start) / 60000) : null,
      status: sorted.some((c) => c.status === 'live') ? 'live' : 'ended',
      has_report: sorted.some((c) => c.has_summary),
      transcript_lines: sorted.reduce((n, c) => n + (c.segment_count ?? 0), 0),
      _sort: start ?? Date.parse(sorted[0].created_at),
    };
  });
  return lessons.sort((a, b) => b._sort - a._sort).map(({ _sort, ...l }) => l);
}

interface RecapResponse {
  recap: {
    call_id: string;
    lesson_id: string | null;
    title: string | null;
    started_at: number | null;
    duration_minutes: number | null;
    my_role: string;
    people: Array<{ name: string; role: string; is_me: boolean }>;
    processing_status: string;
    transcript: Array<{ at: string; speaker: string; me: boolean; text: string; pinyin: string | null; english: string | null }>;
    transcript_lines_total: number;
    board_text: string;
    chat: Array<{ from: string; text: string; at: string | null }>;
    report: unknown;
    lesson_notes: Array<{ text: string; given_at: string | null; created_at: string }>;
    homework: Array<{ title: string; kind: string; mode: string; due_date: string | null; from_this_lesson: boolean; words?: Array<{ hanzi: string; pinyin: string; english: string }>; word_count?: number }>;
  };
}

/** The recap material trimmed for a chat: one line per transcript segment. */
export function recapForChat(r: RecapResponse['recap'], opts: { pinyin: boolean }) {
  return {
    lesson_id: r.lesson_id,
    call_id: r.call_id,
    date: iso(r.started_at),
    minutes: r.duration_minutes,
    title: r.title,
    my_role: r.my_role,
    people: r.people.map((p) => `${p.name} (${p.is_me ? 'me' : p.role})`),
    ...(r.processing_status !== 'done' ? { processing_status: r.processing_status } : {}),
    transcript: r.transcript.map((t) => {
      const who = t.me ? `${t.speaker}, me` : t.speaker;
      const parts = [`${t.at} ${who}: ${t.text}`];
      if (opts.pinyin && t.pinyin) parts.push(t.pinyin);
      if (t.english) parts.push(t.english);
      return parts.join(' | ');
    }),
    ...(r.transcript_lines_total > r.transcript.length ? { transcript_note: `First ${r.transcript.length} of ${r.transcript_lines_total} lines — pass max_lines to get more.` } : {}),
    ...(r.board_text.trim() ? { board_text: r.board_text } : {}),
    ...(r.chat.length ? { chat: r.chat.map((m) => `${m.at ?? ''} ${m.from}: ${m.text}`.trim()) } : {}),
    report: r.report,
    tutor_notes: r.lesson_notes,
    homework: r.homework,
    next_step:
      'To make an audio recap: write a composed plan (compose_audio_lesson\'s block reference) anchored in this transcript, the notes and the homework words — the conversation at a high level, then the words and structures — dry-run it, then make it with source: { lesson_id } (or call_id).',
  };
}

export function registerLessonRecapTools(ctx: ToolContext): void {
  const { server, api } = ctx;

  server.tool(
    'list_my_lessons',
    "The signed-in user's VIDEO LESSONS (calls with their tutor or student; calls within two hours of each other are one lesson), newest first: lesson_id, the call ids, who with, date, minutes, whether the lesson report and a transcript exist. Use a lesson_id with get_lesson_for_recap.",
    { limit: z.number().int().min(1).max(50).optional().describe('How many lessons (default 10).') },
    async ({ limit }) =>
      guard(async () => {
        const { calls } = await api.get<{ calls: CallListRow[] }>('/api/calls');
        return jsonResult({ lessons: groupLessons(calls).slice(0, limit ?? 10) });
      }),
  );

  server.tool(
    'get_lesson_for_recap',
    "Everything needed to write an audio RECAP of one of the signed-in user's video lessons (default: the most recent one with a transcript): date, people, the merged transcript speaker by speaker with each line's time (hanzi | pinyin | English as transcribed — speech recognition, so expect small mistakes), the board text, the in-call chat, the lesson report (summary, topics, vocabulary, corrections), the tutor's notes for the lesson (as they reached the learner) and the homework sent from / around it with its words. Only lessons the user was in. Then build the recap with compose_audio_lesson.",
    {
      lesson_id: z.string().optional().describe('From list_my_lessons.'),
      call_id: z.string().optional().describe('Any call of the lesson.'),
      max_lines: z.number().int().min(20).max(2000).optional().describe('Transcript lines to return (default 400).'),
      pinyin: z.boolean().optional().describe('Include each line\'s pinyin (default true).'),
    },
    async ({ lesson_id, call_id, max_lines, pinyin }) =>
      guard(async () => {
        let callId = call_id ?? null;
        if (!callId) {
          const { calls } = await api.get<{ calls: CallListRow[] }>('/api/calls');
          const lessons = groupLessons(calls);
          const lesson = lesson_id
            ? lessons.find((l) => l.lesson_id === lesson_id)
            : lessons.find((l) => l.status !== 'live' && l.transcript_lines > 0) ?? lessons.find((l) => l.status !== 'live');
          if (!lesson) {
            return jsonResult({ error: lesson_id ? `No lesson ${lesson_id} among your video lessons.` : 'No video lessons yet.', lessons: lessons.slice(0, 5) });
          }
          callId = lesson.call_ids[0];
        }
        const { recap } = await api.get<RecapResponse>(`/api/calls/${encodeURIComponent(callId)}/recap?max_segments=${max_lines ?? 400}`);
        return jsonResult(recapForChat(recap, { pinyin: pinyin !== false }));
      }),
  );
}
