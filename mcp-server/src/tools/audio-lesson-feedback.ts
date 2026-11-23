/**
 * Feedback while listening (docs/AUDIO_LESSONS.md "Feedback while listening"; worker
 * routes/audio-lesson-feedback.ts): while an audio lesson plays — mostly from the phone's lock screen —
 * the learner presses "Too hard", goes back a section (the sentence with its repeats) or skips to the
 * next one. This tool reads those presses back per lesson, the lines he struggled with first, so Claude
 * can tune the next lesson to his level. Read only; the signed-in user's own lessons.
 */
import { z } from 'zod';
import { formatClock } from '../../../shared/audio-lesson/timeline';
import type { AudioLessonFeedbackEvent, LessonFeedbackSummary } from '../../../shared/audio-lesson/feedback';
import type { ToolContext } from './context.js';
import { guard, jsonResult } from './context.js';

interface LessonFeedbackDto {
  lesson: { id: string; title: string; format: string; status: string; duration_ms: number | null; listened_at: string | null; created_at: string };
  events: AudioLessonFeedbackEvent[];
  summary: LessonFeedbackSummary;
}

export interface FeedbackResponse {
  lessons: LessonFeedbackDto[];
  cursor: string | null;
  more: boolean;
}

const KIND_WORDS: Record<AudioLessonFeedbackEvent['kind'], string> = {
  too_hard: 'too hard',
  again: 'replayed this line',
  back_section: 'went back to the line before',
  skip: 'skipped ahead',
};

/** The line an event is about, as one short string ("他很累。 — He is tired."). */
function lineText(r: { text: string; english?: string } | null | undefined): string | null {
  if (!r) return null;
  return r.english && r.english !== r.text ? `${r.text} — ${r.english}` : r.text;
}

/** One lesson's feedback trimmed for a chat. `events`: none · recent (the last 20) · all. */
export function lessonFeedbackForChat(l: LessonFeedbackDto, events: 'none' | 'recent' | 'all', hardest = 10) {
  const { summary } = l;
  const presses = events === 'none' ? [] : events === 'recent' ? l.events.slice(-20) : l.events;
  return {
    id: l.lesson.id,
    title: l.lesson.title,
    format: l.lesson.format,
    ...(l.lesson.duration_ms ? { minutes: Math.round((l.lesson.duration_ms / 60000) * 10) / 10 } : {}),
    listened_to_the_end: !!l.lesson.listened_at,
    furthest_press_at: formatClock(summary.furthest_ms),
    listen_path: `/audio-lessons/${l.lesson.id}`,
    summary: summary.line,
    counts: { too_hard: summary.counts.too_hard, went_back: summary.counts.again + summary.counts.back_section, skipped: summary.counts.skip },
    first_press: summary.first_at,
    last_press: summary.last_at,
    // The lines he reacted to, the hardest first (too hard counts double).
    hardest_lines: summary.rows.slice(0, hardest).map((r) => ({
      at: formatClock(r.start_ms),
      text: r.text,
      ...(r.pinyin ? { pinyin: r.pinyin } : {}),
      ...(r.english ? { english: r.english } : {}),
      ...(r.too_hard ? { too_hard: r.too_hard } : {}),
      ...(r.replays ? { replayed: r.replays } : {}),
      ...(r.skips ? { skipped: r.skips } : {}),
    })),
    ...(summary.rows.length > hardest ? { more_lines: summary.rows.length - hardest } : {}),
    ...(presses.length
      ? {
          presses: presses.map((e) => ({
            when: e.created_at,
            at: formatClock(e.position_ms),
            what: KIND_WORDS[e.kind],
            from: e.where,
            playing: lineText(e.row),
            ...(e.previous_row ? { line_before: lineText(e.previous_row) } : {}),
            ...(e.speed !== 1 ? { speed: e.speed } : {}),
          })),
          ...(events === 'recent' && l.events.length > presses.length ? { earlier_presses: l.events.length - presses.length } : {}),
        }
      : {}),
  };
}

export function registerAudioLessonFeedbackTools(ctx: ToolContext): void {
  const { server, api } = ctx;
  server.tool(
    'get_audio_lesson_feedback',
    'What the signed-in learner said while LISTENING to their audio lessons: every "Too hard" press and every back a section / next section (the lock screen, notification, headset or the player — a section is one line with its repeats). Per lesson (newest feedback first): a one-line summary, counts, how far he got (`furthest_press_at`, `listened_to_the_end`), and `hardest_lines` — the lines he reacted to, ranked (too hard counts double; a press within 2 s of a new line counts for the line before, he was reacting to what he just heard) — with the text, pinyin and English, plus the presses themselves (`events`: recent by default). Use it before writing the next audio lesson or recap: lines marked too hard / replayed show the level, sentence length and words he struggles with; many skips mean too easy. Read only.',
    {
      lesson_id: z.string().optional().describe('One audio lesson (from list_audio_lessons); default every lesson with feedback.'),
      since: z.string().optional().describe('Only presses received after this ISO time (the `cursor` of a previous call).'),
      events: z.enum(['none', 'recent', 'all']).optional().describe('The individual presses: none, recent (default, the last 20 per lesson) or all.'),
      max_lessons: z.number().int().min(1).max(50).optional().describe('Default 10.'),
    },
    async ({ lesson_id, since, events, max_lessons }) =>
      guard(async () => {
        const params = new URLSearchParams();
        if (lesson_id) params.set('lesson_id', lesson_id);
        if (since) params.set('since', since);
        const qs = params.toString();
        const res = await api.get<FeedbackResponse>(`/api/me/audio-lesson-feedback${qs ? `?${qs}` : ''}`);
        const max = max_lessons ?? 10;
        const lessons = res.lessons.slice(0, max).map((l) => lessonFeedbackForChat(l, events ?? 'recent'));
        return jsonResult({
          lessons,
          ...(res.lessons.length > max ? { more_lessons: res.lessons.length - max } : {}),
          cursor: res.cursor,
          ...(lessons.length === 0 ? { note: lesson_id || since ? 'No feedback on that yet.' : 'No feedback yet — the learner presses "Too hard" / back a section while listening (lock screen, notification, headset or the player).' } : {}),
        });
      }),
  );
}
