/**
 * Tutor tools: students, their activity, what they find hard, recordings,
 * lesson log, messages, homework decks, invites.
 *
 * Every tool goes through `ctx.api` (the main API as the signed-in tutor), so
 * access checks — "is this user the tutor of this relationship?" — are the
 * API's, never re-implemented here. Endpoints: worker/src/routes/
 * {tutor-dashboard,insights,invites,lesson-editor}.ts and worker/src/index.ts.
 *
 * Response shaping lives in ./students/shape.ts (pure, unit-tested).
 */
import { z } from 'zod';
import type { ToolContext } from './context.js';
import { guard, jsonResult, textResult } from './context.js';
import type {
  ConversationRow,
  HistoryResponse,
  InsightsResponse,
  InviteRow,
  LessonLogEntry,
  MessageRow,
  MyRelationships,
  RecordingMark,
  SharedDeckProgress,
  SharedDeckRow,
  StudentLessonRow,
  StudentOverview,
  StudentSummaryRow,
  TutorDashboard,
} from './students/types.js';
import {
  clampInt,
  compactConversation,
  compactDashboardInvite,
  compactGoingWell,
  compactHistoryEvent,
  compactInvite,
  compactMessage,
  compactMyRelationships,
  compactRecording,
  compactSharedDeckProgress,
  compactStruggling,
  compactStudentOverview,
  compactStudentRow,
  compactSummary,
  filterRecordings,
  lastMessages,
  normalizeDateParam,
} from './students/shape.js';

const RELATIONSHIP_ID = z
  .string()
  .describe('The tutor–student relationship id (`relationship_id` from list_students). Not the student\'s user id.');

const TZ_OFFSET = z
  .number()
  .int()
  .min(-840)
  .max(840)
  .optional()
  .describe(
    'The tutor\'s timezone as JavaScript `Date.getTimezoneOffset()` minutes (UTC minus local, e.g. -120 for UTC+2, 300 for New York in winter). Decides what "today" and streaks mean. Default 0 (UTC).'
  );

const RANGE_DOC =
  'Dates are ISO: a bare `YYYY-MM-DD` covers the whole day, or pass a full timestamp. When `from` is omitted the range starts at the last logged lesson (see log_lesson) if there is one, otherwise 14 days before `to`; `to` defaults to now. Ranges are capped at 400 days.';

const CARD_TYPE_DOC =
  'Card types: hanzi_to_meaning (sees the characters, says the meaning), meaning_to_hanzi (sees English, types the characters), audio_to_hanzi (hears the word, types the characters).';

const RATING_DOC = 'Ratings: 0 again (forgot), 1 hard, 2 good, 3 easy.';

const rel = (id: string) => `/api/relationships/${encodeURIComponent(id)}`;

export function registerStudentTools(ctx: ToolContext): void {
  const { server, api } = ctx;
  const apiBase = api.baseUrl;

  // ============ Who are my students ============

  server.tool(
    'list_students',
    `List the tutor's students with a one-line status each — the same cards as the in-app Students dashboard. Call this first: every other student tool needs a \`relationship_id\` from here. Each row has: \`student\` (id/name/email), \`joined_at\`, \`is_new\` (no reviews yet — then \`setup\` shows the getting-started checklist: signed in, homework received, app installed, first session), \`status\` (studied_today, streak_days, last_studied_at, today's reviews/accuracy/time), \`pills\` (struggling_words in the last 7 days, recordings_to_hear = pronunciation recordings the tutor has not marked yet, homework_percent = mastered cards + ½ started cards + completed lessons over everything the tutor sent), \`needs_attention\` (the top words with the wrong answers the student typed), a compact homework summary and \`last_conversation_id\`. Students needing a nudge come first. Also returns \`pending_invites\` (links created but not yet redeemed, with \`link_opened_at\`), \`homework_decks\` (the tutor's decks that have been shared, for share_deck_with_student), and — because a user can be a student as well as a tutor — \`my_tutors\` and pending connection requests. An empty \`students\` list means this account tutors nobody yet: use create_student_invite.`,
    { tz_offset_minutes: TZ_OFFSET },
    async ({ tz_offset_minutes }) =>
      guard(async () => {
        const [dashboard, mine] = await Promise.all([
          api.get<TutorDashboard>('/api/tutor/dashboard', { tz_offset: tz_offset_minutes ?? 0 }),
          api.get<MyRelationships>('/api/relationships'),
        ]);
        return jsonResult({
          students: dashboard.students.map((s) => compactStudentRow(s, apiBase)),
          pending_invites: dashboard.invites.map(compactDashboardInvite),
          homework_decks: dashboard.homework_decks,
          ...compactMyRelationships(mine, ctx.userId),
          generated_at: dashboard.generated_at,
        });
      })
  );

  server.tool(
    'get_student_overview',
    `One student's full status card (the student page in the app): status and streak, pills, EVERY needs-attention word from the last 7 days with the wrong answers typed and whether there is an unheard recording, homework decks with per-deck progress (cards started/mastered, words missing from the student's copy — see update_student_deck_copy), assigned lessons with completions and last rating, the setup checklist and install kind (pwa / android / browser, cached audio clips), the two most recent active days and \`last_conversation_id\`. Use get_student_insights for a longer range and ranked struggling words.`,
    { relationship_id: RELATIONSHIP_ID, tz_offset_minutes: TZ_OFFSET },
    async ({ relationship_id, tz_offset_minutes }) =>
      guard(async () => {
        const overview = await api.get<StudentOverview>(`${rel(relationship_id)}/overview`, {
          tz_offset: tz_offset_minutes ?? 0,
        });
        return jsonResult(compactStudentOverview(overview, apiBase));
      })
  );

  // ============ Insights, history, daily progress ============

  server.tool(
    'get_student_insights',
    `The pre-lesson briefing for one student over a date range: \`totals\` (reviews, unique words, days active, accuracy, again_rate, time, per-card-type stats, new words introduced), \`struggling\` (ranked worst first — each word with attempts, again/hard/forgot counts, average time, per-card-type accuracy and the actual \`wrong_answers\` the student typed, so you can see WHAT they confuse it with), \`going_well\` (consistently right or graduated to long intervals), \`activity\` (mini lessons, graded readers and quests completed), \`recordings\` (pronunciation clips with any tutor marks) and the \`range\` actually used plus \`since_lesson\` when it was anchored on the lesson log. ${RANGE_DOC} ${CARD_TYPE_DOC}`,
    {
      relationship_id: RELATIONSHIP_ID,
      from: z.string().optional().describe('Range start (ISO). Default: the last logged lesson, else 14 days before `to`.'),
      to: z.string().optional().describe('Range end (ISO). Default: now.'),
      top_n: z.number().int().min(1).max(100).optional().describe('How many struggling / going-well words to return (default 15).'),
    },
    async ({ relationship_id, from, to, top_n }) =>
      guard(async () => {
        const n = clampInt(top_n, 1, 100, 15);
        const r = await api.get<InsightsResponse>(`${rel(relationship_id)}/insights`, {
          from: normalizeDateParam(from, 'from'),
          to: normalizeDateParam(to, 'to'),
        });
        return jsonResult({
          range: r.range,
          since_lesson: r.since_lesson,
          latest_lesson: r.latest_lesson,
          totals: r.totals,
          struggling_total: r.struggling.length,
          struggling: r.struggling.slice(0, n).map(compactStruggling),
          going_well_total: r.going_well.length,
          going_well: r.going_well.slice(0, n).map(compactGoingWell),
          activity: r.activity,
          recordings_total: r.recordings.length,
          recordings: r.recordings.slice(0, n).map((rec) => compactRecording(rec, apiBase)),
        });
      })
  );

  server.tool(
    'get_student_history',
    `Every individual review the student did, newest first, with filters — the raw material behind get_student_insights. Each event: when, the word (hanzi/pinyin/english/deck), card_type, rating, what the student typed (\`user_answer\`, for the typing card types), time spent and an \`audio_url\` when they recorded themselves. Use \`q\` to follow one word (matches hanzi, pinyin or English), \`rating\` to list only failures, \`card_type\` to isolate listening vs writing. Paged: when \`next_cursor\` is non-null pass it back as \`cursor\` for the next page. The first page also lists the student's \`decks\` (id + name) for the \`deck_id\` filter. ${RANGE_DOC} ${CARD_TYPE_DOC} ${RATING_DOC}`,
    {
      relationship_id: RELATIONSHIP_ID,
      from: z.string().optional().describe('Range start (ISO). Default: the last logged lesson, else 14 days before `to`.'),
      to: z.string().optional().describe('Range end (ISO). Default: now.'),
      deck_id: z.string().optional().describe("Only reviews of cards in this deck (one of the student's decks)."),
      card_type: z.enum(['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi']).optional(),
      rating: z.number().int().min(0).max(3).optional().describe('Only reviews with this rating: 0 again, 1 hard, 2 good, 3 easy.'),
      q: z.string().optional().describe('Text filter on the word: hanzi, pinyin or English substring.'),
      cursor: z.string().optional().describe('`next_cursor` from the previous page.'),
      limit: z.number().int().min(1).max(500).optional().describe('Page size (default 100, max 500).'),
    },
    async ({ relationship_id, from, to, deck_id, card_type, rating, q, cursor, limit }) =>
      guard(async () => {
        const r = await api.get<HistoryResponse>(`${rel(relationship_id)}/history`, {
          from: normalizeDateParam(from, 'from'),
          to: normalizeDateParam(to, 'to'),
          deck_id,
          card_type,
          rating,
          q,
          cursor,
          limit: clampInt(limit, 1, 500, 100),
        });
        return jsonResult({
          range: r.range,
          ...(r.decks ? { decks: r.decks } : {}),
          events: r.events.map((e) => compactHistoryEvent(e, apiBase)),
          next_cursor: r.next_cursor,
        });
      })
  );

  server.tool(
    'get_student_daily_progress',
    `Day-by-day study activity for the last 30 days (reviews, unique cards, accuracy %, time) plus the student's headline stats (total cards, due today, studied today / this week, average accuracy) and per-deck counts (notes, due, mastered). Good for "how consistent have they been?" and for spotting the days to drill into with get_student_day. Days are UTC calendar days.`,
    {
      relationship_id: RELATIONSHIP_ID,
      days: z.number().int().min(1).max(30).optional().describe('Keep only the most recent N days with activity (default 30 = everything the API has).'),
    },
    async ({ relationship_id, days }) =>
      guard(async () => {
        const [daily, progress] = await Promise.all([
          api.get<{
            student: { id: string; name: string | null; email: string | null };
            summary: Record<string, number>;
            days: Array<Record<string, unknown>>;
          }>(`${rel(relationship_id)}/student-progress/daily`),
          api.get<{ stats: Record<string, number>; decks: Array<Record<string, unknown>> }>(
            `${rel(relationship_id)}/student-progress`
          ),
        ]);
        return jsonResult({
          student: daily.student,
          last_30_days: daily.summary,
          stats: progress.stats,
          decks: progress.decks,
          days: daily.days.slice(0, clampInt(days, 1, 30, 30)),
        });
      })
  );

  server.tool(
    'get_student_day',
    `Everything the student reviewed on one calendar day (UTC): per card — the word, card_type, how many times it came up, the ratings in order, average rating, time spent, and whether they typed answers or recorded themselves. Use after get_student_daily_progress to see what a particular session looked like; get_student_history with from=to=that day gives the individual events with typed answers. ${RATING_DOC}`,
    {
      relationship_id: RELATIONSHIP_ID,
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD').describe('The day, as YYYY-MM-DD.'),
    },
    async ({ relationship_id, date }) =>
      guard(async () => {
        const r = await api.get<Record<string, unknown>>(`${rel(relationship_id)}/student-progress/day/${date}`);
        return jsonResult(r);
      })
  );

  // ============ Narrative summaries ============

  server.tool(
    'write_student_summary',
    `Ask the app to write and save a narrative summary of the student's progress over a range — a few paragraphs in English and the same in 简体中文, generated from the structured insights (never raw events) and stored so it shows on the Student Insights page too. Use before a lesson or to share with a parent. Fails with a clear message when the server has no AI key configured or when the student did nothing in the range. ${RANGE_DOC}`,
    {
      relationship_id: RELATIONSHIP_ID,
      from: z.string().optional().describe('Range start (ISO). Default: the last logged lesson, else 14 days before `to`.'),
      to: z.string().optional().describe('Range end (ISO). Default: now.'),
    },
    async ({ relationship_id, from, to }) =>
      guard(async () => {
        const r = await api.post<{ summary: StudentSummaryRow }>(`${rel(relationship_id)}/insights/summary`, {
          from: normalizeDateParam(from, 'from'),
          to: normalizeDateParam(to, 'to'),
        });
        return jsonResult(compactSummary(r.summary));
      })
  );

  server.tool(
    'list_student_summaries',
    'Past narrative summaries written for this student (newest first, up to 20), each with its range and the English + Chinese text. Read these before writing a new one so the story stays consistent.',
    { relationship_id: RELATIONSHIP_ID },
    async ({ relationship_id }) =>
      guard(async () => {
        const r = await api.get<{ summaries: StudentSummaryRow[] }>(`${rel(relationship_id)}/insights/summaries`);
        return jsonResult({ summaries: r.summaries.map(compactSummary) });
      })
  );

  // ============ Recordings ============

  server.tool(
    'list_student_recordings',
    `The student's pronunciation recordings (they can record themselves on the "see the characters, say it" card) in a date range, each with the word, the rating they gave themselves, \`recorded_at\`, an \`audio_url\` to listen to (opens in the app; the tutor must be signed in) and the tutor's \`mark\` if any (listened / needs_work + comment). \`only_unmarked\` lists just the ones still waiting to be heard — the "recordings to hear" pill. Mark them with mark_recording. ${RANGE_DOC}`,
    {
      relationship_id: RELATIONSHIP_ID,
      from: z.string().optional().describe('Range start (ISO). Default: the last logged lesson, else 14 days before `to`.'),
      to: z.string().optional().describe('Range end (ISO). Default: now.'),
      only_unmarked: z.boolean().optional().describe('Only recordings without a tutor mark yet (default false).'),
      limit: z.number().int().min(1).max(500).optional().describe('Max recordings to return, newest first (default 50).'),
    },
    async ({ relationship_id, from, to, only_unmarked, limit }) =>
      guard(async () => {
        const r = await api.get<InsightsResponse>(`${rel(relationship_id)}/insights`, {
          from: normalizeDateParam(from, 'from'),
          to: normalizeDateParam(to, 'to'),
        });
        const filtered = filterRecordings(r.recordings, !!only_unmarked);
        const n = clampInt(limit, 1, 500, 50);
        return jsonResult({
          range: r.range,
          total: filtered.length,
          unmarked: r.recordings.filter((x) => !x.mark).length,
          recordings: filtered.slice(0, n).map((rec) => compactRecording(rec, apiBase)),
        });
      })
  );

  server.tool(
    'mark_recording',
    `Mark one of the student's recordings as \`listened\` (just clears it from the to-hear pile) or \`needs_work\` with a short comment on the pronunciation. A needs_work comment is shown to the student ONCE, on the back of that card the next time it comes up in study ("From <tutor>: …"), then it goes quiet — so write it to the student, concretely (e.g. "Second syllable is 4th tone, falling: xiè, not xiē"). Re-marking the same recording replaces the previous mark.`,
    {
      relationship_id: RELATIONSHIP_ID,
      event_id: z.string().describe('The recording\'s `event_id` from list_student_recordings / get_student_insights / get_student_history.'),
      status: z.enum(['listened', 'needs_work']),
      comment: z.string().max(2000).optional().describe('Feedback for the student (needs_work). Ignored when empty.'),
    },
    async ({ relationship_id, event_id, status, comment }) =>
      guard(async () => {
        const r = await api.put<{ mark: RecordingMark }>(
          `${rel(relationship_id)}/recordings/${encodeURIComponent(event_id)}/mark`,
          { status, comment: comment ?? null }
        );
        return jsonResult({ event_id, mark: { status: r.mark.status, comment: r.mark.comment, updated_at: r.mark.updated_at } });
      })
  );

  server.tool(
    'clear_recording_mark',
    'Remove the tutor mark from one recording so it counts as unheard again (and any needs_work note is withdrawn if the student has not seen it yet).',
    { relationship_id: RELATIONSHIP_ID, event_id: z.string().describe('The recording\'s `event_id`.') },
    async ({ relationship_id, event_id }) =>
      guard(async () => {
        await api.delete(`${rel(relationship_id)}/recordings/${encodeURIComponent(event_id)}/mark`);
        return textResult(`Cleared the mark on recording ${event_id}.`);
      })
  );

  // ============ Lesson log ============

  server.tool(
    'log_lesson',
    `Record that a lesson took place. The most recent entry anchors the default range of get_student_insights, get_student_history, list_student_recordings and write_student_summary ("since last lesson"), so log every lesson. \`notes\` (what was covered, homework set) are also copied into the STUDENT's own lesson notes prefixed "[From tutor <name>, <date>]", where the app's daily reader and other AI helpers read them — write them as facts about the student's Chinese, not private remarks.`,
    {
      relationship_id: RELATIONSHIP_ID,
      lesson_at: z.string().optional().describe('When the lesson happened (ISO timestamp, or YYYY-MM-DD for midday that day). Default: now.'),
      notes: z.string().max(10000).optional().describe('What was covered / homework set. Optional.'),
    },
    async ({ relationship_id, lesson_at, notes }) =>
      guard(async () => {
        const r = await api.post<{ entry: LessonLogEntry; student_lesson_note_id: string | null }>(
          `${rel(relationship_id)}/lesson-log`,
          { lesson_at: normalizeDateParam(lesson_at, 'lesson_at'), notes: notes ?? null }
        );
        return jsonResult({
          entry: { id: r.entry.id, lesson_at: r.entry.lesson_at, notes: r.entry.notes, created_at: r.entry.created_at },
          copied_to_student_notes: !!r.student_lesson_note_id,
        });
      })
  );

  server.tool(
    'list_lesson_log',
    'Logged lessons for this student, newest first (id, when, notes). The newest one is what "since last lesson" means in the insights tools.',
    { relationship_id: RELATIONSHIP_ID },
    async ({ relationship_id }) =>
      guard(async () => {
        const r = await api.get<{ entries: LessonLogEntry[] }>(`${rel(relationship_id)}/lesson-log`);
        return jsonResult({
          entries: r.entries.map((e) => ({ id: e.id, lesson_at: e.lesson_at, notes: e.notes, created_at: e.created_at })),
        });
      })
  );

  server.tool(
    'delete_lesson_log_entry',
    "Delete one logged lesson (e.g. logged by mistake). The copy of its notes in the student's lesson notes is not removed.",
    { relationship_id: RELATIONSHIP_ID, entry_id: z.string().describe('The lesson log entry id from list_lesson_log.') },
    async ({ relationship_id, entry_id }) =>
      guard(async () => {
        await api.delete(`${rel(relationship_id)}/lesson-log/${encodeURIComponent(entry_id)}`);
        return textResult(`Deleted lesson log entry ${entry_id}.`);
      })
  );

  // ============ Messages ============

  server.tool(
    'send_message_to_student',
    `Send a chat message to the student in the app (they get an in-app notification and, if configured, an email). Without \`conversation_id\` it goes into the most recent conversation of the relationship, creating one if there is none. Write in whatever language the tutor wants the student to read; keep it as the tutor's own voice. Read what the student wrote first with get_conversation_messages.`,
    {
      relationship_id: RELATIONSHIP_ID,
      text: z.string().min(1).max(10000).describe('The message text.'),
      conversation_id: z.string().optional().describe('A specific conversation (from list_conversations). Default: the most recent one.'),
    },
    async ({ relationship_id, text, conversation_id }) =>
      guard(async () => {
        let convId = conversation_id;
        let created = false;
        if (!convId) {
          const opened = await api.post<{ conversation_id: string; created: boolean }>(
            `${rel(relationship_id)}/conversations/open`
          );
          convId = opened.conversation_id;
          created = opened.created;
        }
        const message = await api.post<MessageRow>(`/api/conversations/${encodeURIComponent(convId)}/messages`, {
          content: text,
        });
        return jsonResult({
          conversation_id: convId,
          conversation_created: created,
          message: { message_id: message.id, content: message.content, created_at: message.created_at },
        });
      })
  );

  server.tool(
    'list_conversations',
    'The chat conversations in a tutor–student relationship, most recent first, each with its title, the last message and whether it is an AI role-play conversation. Use get_conversation_messages to read one.',
    { relationship_id: RELATIONSHIP_ID },
    async ({ relationship_id }) =>
      guard(async () => {
        const rows = await api.get<ConversationRow[]>(`${rel(relationship_id)}/conversations`);
        return jsonResult({ conversations: rows.map(compactConversation) });
      })
  );

  server.tool(
    'get_conversation_messages',
    `The messages in one conversation in chronological order (the last \`limit\`). Each: who sent it (\`from\` is "me" for the signed-in user, otherwise the sender's name), content, time, and when present the stored translation, the "check my Chinese" result on the student's messages, an \`audio_url\` for voice messages and what it replied to. Use this to see what the student asked or wrote before answering with send_message_to_student.`,
    {
      conversation_id: z.string().describe('From list_conversations or `last_conversation_id` on list_students.'),
      limit: z.number().int().min(1).max(500).optional().describe('How many of the most recent messages (default 50).'),
    },
    async ({ conversation_id, limit }) =>
      guard(async () => {
        const r = await api.get<{ messages: MessageRow[]; latest_timestamp: string | null }>(
          `/api/conversations/${encodeURIComponent(conversation_id)}/messages`
        );
        const n = clampInt(limit, 1, 500, 50);
        return jsonResult({
          conversation_id,
          total: r.messages.length,
          messages: lastMessages(r.messages, n).map((m) => compactMessage(m, ctx.userId, apiBase)),
        });
      })
  );

  server.tool(
    'send_install_howto',
    'Post the standard "how to install the app on your phone" instructions (Obtainium for the Android app, or Add to Home screen) into the chat with this student, as a message from the tutor. Use when the setup checklist shows the app is not installed or the student only uses the browser.',
    { relationship_id: RELATIONSHIP_ID },
    async ({ relationship_id }) =>
      guard(async () => {
        const r = await api.post<{ conversation_id: string; message: MessageRow }>(`${rel(relationship_id)}/send-howto`);
        return jsonResult({ conversation_id: r.conversation_id, message_id: r.message.id, sent_at: r.message.created_at });
      })
  );

  // ============ Homework: decks and lessons ============

  server.tool(
    'list_student_homework',
    `What the tutor has sent this student and how far they have got: \`decks\` shared with them (each with completion: total cards, seen, mastered and percentages, last studied, reviews in the last 7 days — call get_shared_deck_progress for the per-word view) and their mini \`lessons\` (title, exercise count, completions, last rating/score; \`assigned_by_me\` tells the tutor's own from the student's).`,
    { relationship_id: RELATIONSHIP_ID },
    async ({ relationship_id }) =>
      guard(async () => {
        const [shared, lessons] = await Promise.all([
          api.get<SharedDeckRow[]>(`${rel(relationship_id)}/shared-decks`),
          api.get<{ lessons: StudentLessonRow[] }>(`${rel(relationship_id)}/student-lessons`),
        ]);
        const progress = await Promise.all(
          shared.map((d) =>
            api
              .get<SharedDeckProgress>(`${rel(relationship_id)}/shared-decks/${encodeURIComponent(d.id)}/progress`)
              .then((p) => ({ completion: p.completion, activity: p.activity }), (err: unknown) => ({
                error: err instanceof Error ? err.message : String(err),
              }))
          )
        );
        return jsonResult({
          decks: shared.map((d, i) => ({
            shared_deck_id: d.id,
            name: d.source_deck_name,
            tutor_deck_id: d.source_deck_id,
            student_deck_id: d.target_deck_id,
            shared_at: d.shared_at,
            ...progress[i],
          })),
          lessons: lessons.lessons.map((l) => ({
            lesson_id: l.id,
            title: l.title,
            description: l.description,
            source: l.source,
            exercise_count: l.exercise_count,
            assigned_by_me: l.assigned_by_me,
            library_item_id: l.library_item_id,
            created_at: l.created_at,
            completions: l.completions,
            last_completed_at: l.last_completed_at,
            last_rating: l.last_rating,
            last_score: l.last_score,
          })),
        });
      })
  );

  server.tool(
    'get_shared_deck_progress',
    `Per-word progress on one homework deck the tutor shared: completion totals, a breakdown per card type (new / learning / familiar / mastered), last studied, and every word with its \`mastery_percent\` and the most recent ratings per card type (newest first, as again/hard/good/easy). Words are sorted most-mastered first, so read the tail for what to revise in the next lesson.`,
    {
      relationship_id: RELATIONSHIP_ID,
      shared_deck_id: z.string().describe('The `shared_deck_id` from list_student_homework / list_students homework_decks.'),
      max_words: z.number().int().min(1).max(1000).optional().describe('Cap on the words list (default 200).'),
    },
    async ({ relationship_id, shared_deck_id, max_words }) =>
      guard(async () => {
        const p = await api.get<SharedDeckProgress>(
          `${rel(relationship_id)}/shared-decks/${encodeURIComponent(shared_deck_id)}/progress`
        );
        return jsonResult({ shared_deck_id, ...compactSharedDeckProgress(p, clampInt(max_words, 1, 1000, 200)) });
      })
  );

  server.tool(
    'share_deck_with_student',
    `Send one of the tutor's own decks to the student as homework: the app copies the deck (with audio) into the student's account as "<name> (from tutor)" and it joins their homework QUEUE — the student introduces a fixed number of new words a day (their daily budget, 3 by default) from the top of the queue down, so sending more packets never adds to their daily load. \`priority\` decides where the packet lands: "core" (default) goes to the top and is studied next; "non_urgent" goes to the bottom. Deck ids come from list_decks. To add words to a deck already shared, edit the tutor's deck and call update_student_deck_copy instead of sharing again (sharing twice makes a second copy).`,
    {
      relationship_id: RELATIONSHIP_ID,
      deck_id: z.string().describe("One of the tutor's deck ids (list_decks)."),
      priority: z.enum(['core', 'non_urgent']).optional().describe('"core" (default): top of the student\'s queue, studied next. "non_urgent": bottom of the queue, after everything else.'),
    },
    async ({ relationship_id, deck_id, priority }) =>
      guard(async () => {
        const r = await api.post<SharedDeckRow>(`${rel(relationship_id)}/share-deck`, { deck_id, priority: priority ?? 'core' });
        return jsonResult({
          shared_deck_id: r.id,
          tutor_deck_id: r.source_deck_id,
          student_deck_id: r.target_deck_id,
          student_deck_name: r.target_deck_name,
          shared_at: r.shared_at,
        });
      })
  );

  server.tool(
    'move_student_deck',
    "Move one homework packet within the STUDENT's study queue: \"top\" makes it the deck they introduce new words from next, \"bottom\" puts it after everything else, \"up\" / \"down\" nudge it one place. The student's daily new-card budget is filled from the top of the queue down, so this is how a tutor says what to learn first without changing how much they study. Returns the packet's new `queue_position` of `queue_total` (the student's own decks count too). The order reaches the student's device on their next sync. Use `shared_deck_id` from list_student_homework or get_student_overview.",
    {
      relationship_id: RELATIONSHIP_ID,
      shared_deck_id: z.string().describe('The `shared_deck_id` from list_student_homework.'),
      to: z.enum(['top', 'up', 'down', 'bottom']).describe('Where to move it in the student\'s queue.'),
    },
    async ({ relationship_id, shared_deck_id, to }) =>
      guard(async () => {
        const r = await api.post<{ shared_deck_id: string; target_deck_id: string; queue_position: number; queue_total: number }>(
          `${rel(relationship_id)}/shared-decks/${encodeURIComponent(shared_deck_id)}/move`,
          { to }
        );
        return jsonResult(r);
      })
  );

  server.tool(
    'update_student_deck_copy',
    "Bring the student's copy of a shared deck up to date with the tutor's version: words the tutor added since sharing are copied over (with their cards and audio), words the student already has are matched by hanzi and left untouched so their progress and history survive. Returns how many were added / kept / got missing audio filled.",
    { relationship_id: RELATIONSHIP_ID, shared_deck_id: z.string().describe('The `shared_deck_id` from list_student_homework.') },
    async ({ relationship_id, shared_deck_id }) =>
      guard(async () => {
        const r = await api.post<Record<string, unknown>>(
          `${rel(relationship_id)}/shared-decks/${encodeURIComponent(shared_deck_id)}/update`
        );
        return jsonResult(r);
      })
  );

  // ============ Invites ============

  server.tool(
    'create_student_invite',
    `Create an invite link for a new student (sign-up is invite-only). The tutor sends the returned \`url\` (a /join link) to the student; when they open it and sign in with Google, an account is created, the tutor–student connection is made with the caller as TUTOR, the listed decks are copied to them as homework and the welcome message is posted as the tutor's first chat message. Requires the account to be allowed to invite (ask the admin otherwise). \`email\` binds the link to one Google account; \`max_uses\` > 1 makes a class link. The token in the URL is a bearer secret — share it only with the intended student.`,
    {
      share_deck_ids: z.array(z.string()).optional().describe("Tutor's deck ids to copy to the new student on sign-up (list_decks). The app's invite sheet preselects the Starter Chinese deck; include at least one deck so their first session has something to study."),
      welcome_message: z.string().max(2000).optional().describe('Posted as the first chat message from the tutor after sign-up.'),
      email: z.string().optional().describe('Bind the invite to this Google email (optional).'),
      expires_in_days: z.number().int().min(1).max(365).optional().describe('Link validity in days (default: no expiry).'),
      max_uses: z.number().int().min(1).max(1000).optional().describe('How many people may redeem it (default 1).'),
      note: z.string().max(200).optional().describe('Private note for the tutor\'s own list (who this is for).'),
    },
    async ({ share_deck_ids, welcome_message, email, expires_in_days, max_uses, note }) =>
      guard(async () => {
        const invite = await api.post<InviteRow>('/api/invites', {
          inviter_role: 'tutor',
          share_deck_ids: share_deck_ids ?? [],
          welcome_message: welcome_message ?? null,
          email: email ?? null,
          expires_in_days: expires_in_days ?? null,
          max_uses: max_uses ?? 1,
          note: note ?? null,
        });
        return jsonResult(compactInvite(invite));
      })
  );

  server.tool(
    'list_invites',
    'Invite links the signed-in user created, newest first: status (active / used / expired / revoked), who it is bound to, `link_opened_at` (the /join page was opened but nobody signed in yet — a good moment to nudge), uses, and `redemptions` (who joined through it and when). Admins can pass `all_users` to see everyone\'s invites.',
    { all_users: z.boolean().optional().describe('Admin only: list every user\'s invites.') },
    async ({ all_users }) =>
      guard(async () => {
        const rows = await api.get<InviteRow[]>('/api/invites', { all: all_users ? 1 : undefined });
        return jsonResult({ invites: rows.map(compactInvite) });
      })
  );

  server.tool(
    'revoke_invite',
    'Revoke an invite link so it can no longer be redeemed. People who already joined through it keep their accounts and connections.',
    { invite_id: z.string().describe('The `invite_id` from list_invites / create_student_invite.') },
    async ({ invite_id }) =>
      guard(async () => {
        await api.delete(`/api/invites/${encodeURIComponent(invite_id)}`);
        return textResult(`Revoked invite ${invite_id}.`);
      })
  );
}
