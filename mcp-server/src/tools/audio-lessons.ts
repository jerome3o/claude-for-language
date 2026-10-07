/**
 * Audio lessons (worker routes/audio-lessons.ts, docs/AUDIO_LESSONS.md): an
 * agent writes a listening lesson and the app renders it to one audio file the
 * learner plays (offline, with chapters and a sleep timer) at /audio-lessons/<id>.
 * These tools start one through the API and read its status / transcript —
 * nothing here writes D1, and nothing is ever sent to a student: a tutor's
 * `for_relationship_id` is only a label on the tutor's own lesson.
 */
import { z } from 'zod';
import type { AudioLessonDetail, AudioLessonSummary, PodcastFeedInfo } from '../../../shared/audio-lesson/types';
import type { ToolContext } from './context.js';
import { guard, jsonResult } from './context.js';

export function trimLesson(l: AudioLessonSummary) {
  return {
    id: l.id,
    format: l.format,
    title: l.title,
    status: l.status,
    ...(l.status !== 'ready' && l.status !== 'failed' ? { progress: l.progress, clips_done: l.progress_done, clips_total: l.progress_total } : {}),
    ...(l.status === 'failed' ? { error: l.error } : {}),
    ...(l.duration_ms ? { minutes: Math.round((l.duration_ms / 60000) * 10) / 10 } : {}),
    word_count: l.word_count,
    created_at: l.created_at,
    listen_path: `/audio-lessons/${l.id}`,
  };
}

export function lessonForChat(l: AudioLessonDetail, transcript: 'none' | 'chinese' | 'full') {
  return {
    ...trimLesson(l),
    input: l.input,
    words: l.words,
    chapters: l.chapters.map((c) => ({ title: c.title, at: `${Math.floor(c.start_ms / 60000)}:${String(Math.floor((c.start_ms % 60000) / 1000)).padStart(2, '0')}` })),
    ...(l.speakers.length ? { speakers: l.speakers } : {}),
    ...(transcript === 'none'
      ? {}
      : {
          transcript: l.transcript
            .filter((t) => transcript === 'full' || t.lang === 'zh')
            // A repeated line is said several times; list it once in a row.
            .filter((t, i, all) => i === 0 || all[i - 1].text !== t.text)
            .map((t) => (t.english ? `${t.text} — ${t.english}` : t.text)),
        }),
    usage: l.usage,
    ...(l.for_relationship_id ? { for_relationship_id: l.for_relationship_id } : {}),
  };
}

export function feedForChat(feed: PodcastFeedInfo) {
  return {
    feed_url: feed.url,
    open_in_podcast_app: feed.podcast_url,
    open_in_apple_podcasts: feed.apple_url,
    last_fetched_by_a_podcast_app: feed.last_fetched_at,
    ...(feed.url
      ? { how_to: 'Copy feed_url into the podcast app ("Add podcast by URL"), or open open_in_podcast_app on the phone. Private: anyone with the link can listen. Settings → Audio lessons → Podcast feed shows it again, and Reset link replaces it.' }
      : { how_to: 'The link can no longer be shown: press Reset link in Settings → Audio lessons → Podcast feed to make a new one.' }),
  };
}

export function registerAudioLessonTools(ctx: ToolContext): void {
  const { server, api } = ctx;

  server.tool(
    'create_audio_lesson',
    'Make an AUDIO LESSON for the signed-in user: an agent (Claude Opus) writes it against their flashcards (what they know / are learning), every line is spoken by the TTS voices and the whole lesson becomes ONE audio file with chapters, played in the app (offline, sleep timer) at listen_path. Two formats: "dialogue" = ChinesePod-style — English host, a short Chinese dialogue for the `description` situation (optionally built on a pasted `dialogue`) played three times, then line-by-line translation, then the new words and structures related to words they know, then a final replay. "sleep" = slow Chinese immersion to fall asleep to — finds the words in the pasted Chinese `text` they don\'t know and, for each, says it three times, gives each character\'s tone, explains what it MEANS in 5–8 very simple Chinese sentences with words they know (comprehensible input, slowly), one short English recap line ("The word was 银行: bank, as in the place where you keep your money…"), then three simple sentences each said three times followed by its English translation. The players add a soft music bed (on by default for sleep). Takes a few minutes to tens of minutes in the background (voices are rate-limited): poll get_audio_lesson. A tutor may pass for_relationship_id as a LABEL only — the lesson stays in the tutor\'s own account; nothing is sent to a student.',
    {
      format: z.enum(['dialogue', 'sleep']),
      description: z.string().max(1000).optional().describe('dialogue: the situation to practise, e.g. "ordering at a Lanzhou noodle shop".'),
      dialogue: z.string().max(4000).optional().describe('dialogue (optional): a dialogue to build the lesson on.'),
      text: z.string().max(20000).optional().describe('sleep: the raw Chinese text to learn new words from.'),
      title: z.string().max(120).optional(),
      target_minutes: z.number().int().min(5).max(40).optional().describe('Rough length (default 12 for dialogue, 20 for sleep).'),
      for_relationship_id: z.string().optional().describe('Tutor only: which student this is meant for — a label, nothing is sent.'),
    },
    async (args) =>
      guard(async () => {
        const { lesson } = await api.post<{ lesson: AudioLessonSummary }>('/api/audio-lessons', args);
        return jsonResult({
          lesson: trimLesson(lesson),
          sent: false,
          note: 'Being made in the background — check get_audio_lesson in a few minutes. It is in the signed-in account only.',
        });
      }),
  );

  server.tool(
    'get_audio_lesson',
    "One audio lesson: status (queued / writing / speaking with clips made so far / rendering / ready / failed + error), length, the words it teaches, chapters with their start times, and the transcript (`transcript`: none, chinese (default) or full with the English host's lines), plus usage (Claude tokens + estimated cost, TTS characters, which voice providers).",
    {
      id: z.string(),
      transcript: z.enum(['none', 'chinese', 'full']).optional(),
    },
    async ({ id, transcript }) =>
      guard(async () => {
        const { lesson } = await api.get<{ lesson: AudioLessonDetail }>(`/api/audio-lessons/${encodeURIComponent(id)}`);
        return jsonResult({ lesson: lessonForChat(lesson, transcript ?? 'chinese') });
      }),
  );

  server.tool(
    'get_audio_lesson_feed',
    "The signed-in user's PRIVATE podcast feed of their audio lessons: an RSS link to paste into any podcast app (AntennaPod, Pocket Casts: \"Add podcast by URL\"; Apple Podcasts: \"Follow a show by URL\") — every ready lesson arrives as an episode with chapters. Made on first use. The link is the only credential: give it to the user only, never post it anywhere else. To make a new one (the old one stops working), the user presses Reset link in Settings → Audio lessons → Podcast feed.",
    {},
    async () =>
      guard(async () => {
        const { feed } = await api.get<{ feed: PodcastFeedInfo }>('/api/me/podcast-feed');
        return jsonResult(feedForChat(feed));
      }),
  );

  server.tool(
    'list_audio_lessons',
    "The signed-in user's audio lessons, newest first: format, title, status (with progress while being made), minutes, word count and listen_path.",
    {},
    async () =>
      guard(async () => {
        const { lessons } = await api.get<{ lessons: AudioLessonSummary[] }>('/api/audio-lessons');
        return jsonResult({ lessons: lessons.map(trimLesson) });
      }),
  );
}
