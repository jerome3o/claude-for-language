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
import { errorResult, guard, jsonResult, textResult } from './context.js';
import { CONFIRM_SEND, NEEDS_CONFIRM, SEND_DUE_DATE, SEND_MODE, SEND_RULE, SEND_TODAY, STUDENT_NAME, assignmentSummary, describeSend, resolveStudent, sendAsHomework, sentTo } from './homework-send.js';
import type { StudyBudgetInfo } from '../../../shared/decks/tutor-budget';
import type {
  CardFlagRow,
  ClaudeChatQuestionRow,
  ConversationRow,
  HistoryResponse,
  InsightsResponse,
  InviteRow,
  LessonLogEntry,
  MessageRow,
  MyRelationships,
  RecordingMark,
  SessionNotesJobRow,
  SharedDeckProgress,
  SharedDeckRow,
  SharedReaderListRow,
  StudentLessonRow,
  StudentOverview,
  StudentSummaryRow,
  TutorDashboard,
} from './students/types.js';
import {
  STUDENT_PROFILE_MAX_CHARS,
  STUDENT_PROFILE_MAX_WORDS_PER_LESSON,
  parseStudentProfileInput,
  type StudentProfile,
} from '../../../shared/students/profile';
import { STUDY_BUDGET_MAX, pickStudyBudgetUpdate } from '../../../shared/decks/budget';
import { budgetSummary } from '../../../shared/decks/tutor-budget';
import {
  clampInt,
  mergeStudentProfile,
  compactCardFlag,
  compactClaudeThreads,
  compactConversation,
  compactDashboardInvite,
  compactGoingWell,
  compactHistoryEvent,
  compactInvite,
  compactMessage,
  compactMyRelationships,
  compactRecording,
  compactSessionNotesJob,
  compactSharedDeckProgress,
  compactStruggling,
  compactStudentOverview,
  compactStudentRow,
  compactStudyBudget,
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

const PROFILE_DOC =
  "The student profile is the tutor's PRIVATE note on this student (the student never sees it): what kind of learner they are and what homework suits them — level, whether they write characters by hand, how many new words per lesson, which kinds of homework work (listening, radicals, own sentences, grammar mini lessons, readers, writing in formats, oral recordings…), interests for reader topics, weak spots, pace. Read it before making homework, lessons, readers or cards for the student and follow it; never quote it to the student.";

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
    `One student's full status card (the student page in the app): status and streak, pills, EVERY needs-attention word from the last 7 days with the wrong answers typed and whether there is an unheard recording, homework decks with per-deck progress (cards started/mastered, words missing from the student's copy — see update_student_deck_copy), assigned lessons with completions and last rating, the setup checklist and install kind (pwa / android / browser, cached audio clips), the two most recent active days, \`last_conversation_id\` and \`student_profile\` (the tutor's private notes on what suits this student — follow it when making anything for them; null when not written yet). Use get_student_insights for a longer range and ranked struggling words.`,
    { relationship_id: RELATIONSHIP_ID, tz_offset_minutes: TZ_OFFSET },
    async ({ relationship_id, tz_offset_minutes }) =>
      guard(async () => {
        const [overview, profile] = await Promise.all([
          api.get<StudentOverview>(`${rel(relationship_id)}/overview`, { tz_offset: tz_offset_minutes ?? 0 }),
          api.get<{ profile: StudentProfile | null }>(`${rel(relationship_id)}/student-profile`).catch(() => ({ profile: null })),
        ]);
        return jsonResult({ ...compactStudentOverview(overview, apiBase), student_profile: profile.profile });
      })
  );

  // ============ The tutor's private profile of a student ============

  server.tool(
    'get_student_profile',
    `The tutor's private profile of one student: \`body\` (markdown), \`level\` (beginner / elementary / intermediate / advanced or null), \`handwriting\` (writes characters by hand: true / false / null), \`words_per_lesson\` (or null) and \`updated_at\`; \`profile: null\` when nothing is written yet. ${PROFILE_DOC} The in-app homework assistant (session notes, lesson-note drafts, video-call homework) and the lesson co-editor already read it.`,
    { relationship_id: RELATIONSHIP_ID },
    async ({ relationship_id }) =>
      guard(async () => {
        const r = await api.get<{ profile: StudentProfile | null }>(`${rel(relationship_id)}/student-profile`);
        return jsonResult(r);
      })
  );

  server.tool(
    'update_student_profile',
    `Write or change the tutor's private profile of one student (tutor only; the student never sees it). Only the fields you pass change: \`body\` replaces the whole text (markdown, max ${STUDENT_PROFILE_MAX_CHARS} characters — to add a line, get_student_profile first and send the full new text), \`level\` / \`handwriting\` / \`words_per_lesson\` set the short structured part (null clears one). An empty profile is deleted. ${PROFILE_DOC} Write it the way the tutor would — goals, what homework works, how much, handwriting or not, interests, weak spots, pace — and only with what the tutor told you.`,
    {
      relationship_id: RELATIONSHIP_ID,
      body: z.string().max(STUDENT_PROFILE_MAX_CHARS).optional().describe('The whole profile text (markdown). Replaces the current text.'),
      level: z.enum(['beginner', 'elementary', 'intermediate', 'advanced']).nullable().optional().describe('Level; null clears it.'),
      handwriting: z.boolean().nullable().optional().describe('Writes characters by hand (handwriting practice, dictation by hand); false = typed only; null = not said.'),
      words_per_lesson: z.number().int().min(1).max(STUDENT_PROFILE_MAX_WORDS_PER_LESSON).nullable().optional().describe('New words (cards) a lesson\'s homework aims for; null clears it.'),
    },
    async ({ relationship_id, body, level, handwriting, words_per_lesson }) =>
      guard(async () => {
        const current = await api.get<{ profile: StudentProfile | null }>(`${rel(relationship_id)}/student-profile`);
        const next = mergeStudentProfile(current.profile, { body, level, handwriting, words_per_lesson });
        const { problems } = parseStudentProfileInput(next);
        if (problems.length) return errorResult(`The profile is not valid:\n- ${problems.join('\n- ')}`);
        const r = await api.put<{ profile: StudentProfile | null }>(`${rel(relationship_id)}/student-profile`, next);
        return jsonResult({ ...r, deleted: r.profile === null });
      })
  );

  // ============ The student's daily new-card budget ============

  server.tool(
    'set_student_study_budget',
    `Change how many NEW cards the student gets a day (tutor only). The student has ONE daily budget for all their decks — \`new_cards_per_day\` brand-new words (blue) + \`secondary_cards_per_day\` extra cards (purple: the other card types of words already started) — filled from the top of their deck queue down. Homework decks never add to it, so this is the lever for their daily load and for how fast a homework deck gets introduced. Default 3 + 6. Pass a number (0–${STUDY_BUDGET_MAX}) to set one, \`null\` to put it back to the default, omit it to leave it. The student's devices pick it up on their next sync; the student gets a short chat message from the tutor ("I've set your new cards to 5 a day (+10 extra) 📚") and can still change it in their Settings (their Settings shows "Set by <tutor>"). The current values are \`study_budget\` in list_students / get_student_overview. Their own decks' per-deck caps are not changed.`,
    {
      relationship_id: RELATIONSHIP_ID,
      new_cards_per_day: z.number().int().min(0).max(STUDY_BUDGET_MAX).nullable().optional().describe('Brand-new words a day across all decks; null = default (3).'),
      secondary_cards_per_day: z.number().int().min(0).max(STUDY_BUDGET_MAX).nullable().optional().describe('Extra cards a day (other card types of words already started); null = default (6).'),
    },
    async ({ relationship_id, new_cards_per_day, secondary_cards_per_day }) =>
      guard(async () => {
        const body: Record<string, number | null> = {};
        if (new_cards_per_day !== undefined) body.new_cards_per_day = new_cards_per_day;
        if (secondary_cards_per_day !== undefined) body.secondary_cards_per_day = secondary_cards_per_day;
        const { problems } = pickStudyBudgetUpdate(body);
        if (problems.length) return errorResult(problems.join('; '));
        if (!Object.keys(body).length) return errorResult('Pass new_cards_per_day and/or secondary_cards_per_day (a number, or null for the default).');
        const r = await api.put<{ budget: StudyBudgetInfo; changed: boolean; message_sent: boolean }>(`${rel(relationship_id)}/student-study-budget`, body);
        return jsonResult({
          study_budget: compactStudyBudget(r.budget),
          summary: budgetSummary(r.budget),
          changed: r.changed,
          chat_message_sent: r.message_sent,
        });
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

  // ============ Flagged cards & Ask-Claude history ============

  server.tool(
    'list_card_flags',
    `Cards the student flagged for the tutor from the study screen (⋯ → Flag for tutor), each with the word, the student's note ("I keep mixing this up with 很行"), when, and the tutor's reply if any. \`open\` = still waiting for a reply. Reply with reply_to_card_flag; the reply is shown to the student once on the back of that card and posted into the chat.`,
    {
      relationship_id: RELATIONSHIP_ID,
      status: z.enum(['open', 'resolved', 'all']).optional().describe('Default open.'),
      limit: z.number().int().min(1).max(500).optional().describe('Max flags, newest first (default 50).'),
    },
    async ({ relationship_id, status, limit }) =>
      guard(async () => {
        const r = await api.get<{ flags: CardFlagRow[]; open: number }>(`${rel(relationship_id)}/card-flags`, {
          status: status ?? 'open',
          limit: String(clampInt(limit, 1, 500, 50)),
        });
        return jsonResult({
          open: r.open,
          total: r.flags.length,
          flags: r.flags.map((f) => compactCardFlag(f, relationship_id)),
        });
      })
  );

  server.tool(
    'reply_to_card_flag',
    `Answer a flagged card. The reply resolves the flag, is shown to the student ONCE on the back of that card the next time it comes up in study ("<tutor> replied to your flag: …"), and is posted into the chat as the tutor. Write it to the student, concretely, in the language they should read.`,
    {
      flag_id: z.string().describe('The flag\'s `flag_id` from list_card_flags.'),
      reply: z.string().min(1).max(2000),
    },
    async ({ flag_id, reply }) =>
      guard(async () => {
        const r = await api.post<{ flag: CardFlagRow }>(`/api/card-flags/${encodeURIComponent(flag_id)}/reply`, { reply });
        return jsonResult(compactCardFlag(r.flag, r.flag.relationship_id));
      })
  );

  server.tool(
    'list_student_claude_chats',
    `What the student has been asking Claude about their cards (the in-app "Ask Claude" on the card back), newest first, grouped into conversations per card — a window on what they find confusing. Each conversation: the word, when, and the questions with Claude's answers (answers trimmed to \`answer_chars\`). \`note_id\` narrows to one card.`,
    {
      relationship_id: RELATIONSHIP_ID,
      limit: z.number().int().min(1).max(500).optional().describe('Max questions to fetch, newest first (default 60).'),
      note_id: z.string().optional().describe('Only conversations about this card.'),
      answer_chars: z.number().int().min(50).max(5000).optional().describe('Trim each answer to this many characters (default 400).'),
    },
    async ({ relationship_id, limit, note_id, answer_chars }) =>
      guard(async () => {
        const r = await api.get<{ questions: ClaudeChatQuestionRow[]; next_cursor: string | null; total: number }>(
          `${rel(relationship_id)}/claude-chats`,
          { limit: String(clampInt(limit, 1, 500, 60)), ...(note_id ? { note_id } : {}) }
        );
        const chars = clampInt(answer_chars, 50, 5000, 400);
        return jsonResult({
          total_questions: r.total,
          more_before: r.next_cursor,
          conversations: compactClaudeThreads(r.questions, chars, relationship_id),
        });
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

  // One chat per pair (docs/CHAT.md "One chat per pair"): a tutor and a student
  // have exactly one conversation, opened (created on first use) by …/conversations/open.
  const openChat = (relationship_id: string) =>
    api.post<{ conversation_id: string; created: boolean }>(`${rel(relationship_id)}/conversations/open`);

  server.tool(
    'send_message_to_student',
    `Send a chat message to the student in the app — into THE chat with them (there is one chat per tutor–student pair; it is created on first use). They get a push / in-app notification and, if they have not turned it off, an email. Write in whatever language the tutor wants the student to read; keep it as the tutor's own voice. Read what the student wrote first with get_conversation_messages.`,
    {
      relationship_id: RELATIONSHIP_ID,
      text: z.string().min(1).max(10000).describe('The message text.'),
    },
    async ({ relationship_id, text }) =>
      guard(async () => {
        const opened = await openChat(relationship_id);
        const message = await api.post<MessageRow>(`/api/conversations/${encodeURIComponent(opened.conversation_id)}/messages`, {
          content: text,
        });
        return jsonResult({
          conversation_id: opened.conversation_id,
          conversation_created: opened.created,
          message: { message_id: message.id, content: message.content, created_at: message.created_at },
        });
      })
  );

  server.tool(
    'list_conversations',
    'The chat with the other person of a relationship — one conversation per pair — with the last message. (A relationship with Claude lists its role-play practice chats, which may be several.) Usually you want get_conversation_messages with the relationship_id directly.',
    { relationship_id: RELATIONSHIP_ID },
    async ({ relationship_id }) =>
      guard(async () => {
        const rows = await api.get<ConversationRow[]>(`${rel(relationship_id)}/conversations`);
        return jsonResult({ conversations: rows.map(compactConversation) });
      })
  );

  server.tool(
    'get_conversation_messages',
    `The messages of the chat with a student, in chronological order (the last \`limit\`). Pass \`relationship_id\` (the one chat of that pair) or a \`conversation_id\` (old ids of merged chats still work). Each message: who sent it (\`from\` is "me" for the signed-in user, otherwise the sender's name), content, time, and when present the stored translation, the "check my Chinese" result on the student's messages, an \`audio_url\` for voice messages and what it replied to. Use this to see what the student asked or wrote before answering with send_message_to_student.`,
    {
      relationship_id: RELATIONSHIP_ID.optional(),
      conversation_id: z.string().optional().describe('Instead of relationship_id: a conversation id (e.g. `last_conversation_id` on list_students).'),
      limit: z.number().int().min(1).max(500).optional().describe('How many of the most recent messages (default 50).'),
    },
    async ({ relationship_id, conversation_id, limit }) =>
      guard(async () => {
        let convId = conversation_id;
        if (!convId) {
          if (!relationship_id) throw new Error('Pass relationship_id (or a conversation_id).');
          convId = (await openChat(relationship_id)).conversation_id;
        }
        const r = await api.get<{ messages: MessageRow[]; latest_timestamp: string | null }>(
          `/api/conversations/${encodeURIComponent(convId)}/messages`
        );
        const n = clampInt(limit, 1, 500, 50);
        return jsonResult({
          conversation_id: r.messages[0]?.conversation_id ?? convId,
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
    `What the tutor has sent this student and how far they have got: \`decks\` shared with them (each with completion: total cards, seen, mastered and percentages, last studied, reviews in the last 7 days — call get_shared_deck_progress for the per-word view), their mini \`lessons\` (title, exercise count, completions, last rating/score; \`assigned_by_me\` tells the tutor's own from the student's) and the graded \`readers\` the tutor shared (read count). To TAKE HOMEWORK BACK (sent by mistake, e.g. an agent sent the wrong deck): remove_student_deck (shared_deck_id), remove_student_lesson (lesson_id, assigned_by_me only), remove_student_reader (shared_reader_id) — each deletes only the student's copy, never their own decks.`,
    { relationship_id: RELATIONSHIP_ID },
    async ({ relationship_id }) =>
      guard(async () => {
        const [shared, lessons, readers] = await Promise.all([
          api.get<SharedDeckRow[]>(`${rel(relationship_id)}/shared-decks`),
          api.get<{ lessons: StudentLessonRow[] }>(`${rel(relationship_id)}/student-lessons`),
          api.get<SharedReaderListRow[]>(`${rel(relationship_id)}/shared-readers`).catch(() => [] as SharedReaderListRow[]),
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
          readers: readers.map((r) => ({
            shared_reader_id: r.id,
            title: r.source_title_chinese || r.target_title_chinese,
            title_english: r.source_title_english || r.target_title_english,
            student_reader_id: r.target_reader_id,
            student_deleted_copy: !!r.target_deleted,
            shared_at: r.shared_at,
            page_count: r.page_count,
            read_count: r.read_count,
            last_read_at: r.last_read_at,
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
    `${SEND_RULE} Send one of the tutor's own decks to the student as homework — a real homework assignment, like the app's Send homework sheet. The app copies the deck (with audio) into the student's account as "<name> (from tutor)", leaving out words they already have (skip_known, default true). By default (\`mode: "both"\`) it is a one-off pass due by \`due_date\` (default: the student's next logged lesson, else in two days) — it shows on their Homework list with the date — AND it joins their long-term review queue, where the student introduces a fixed number of new words a day (their daily budget, 3 by default) from the top of the queue down, so sending more never adds to their daily load. \`mode: "one_off"\` = the pass only (never enters daily review); \`"fsrs"\` = long-term only, no date. \`priority\` decides where the long-term copy lands: "core" (default) top, studied next; "non_urgent" bottom. Deck ids come from list_decks. To add words to a deck already shared, edit the tutor's deck and call update_student_deck_copy instead (sending twice makes a second copy). Returns shared_deck_id and the assignments created.`,
    {
      relationship_id: RELATIONSHIP_ID,
      deck_id: z.string().describe("One of the tutor's deck ids (list_decks)."),
      mode: SEND_MODE,
      due_date: SEND_DUE_DATE,
      priority: z.enum(['core', 'non_urgent']).optional().describe('Long-term part (mode both / fsrs): "core" (default) = top of the student\'s queue, studied next; "non_urgent" = bottom, after everything else.'),
      skip_known: z.boolean().optional().describe('Leave out words the student already has (default true; `skipped` lists them).'),
      today: SEND_TODAY,
      student_name: STUDENT_NAME,
      confirm: CONFIRM_SEND,
    },
    async ({ relationship_id, deck_id, mode, due_date, priority, skip_known, today, student_name, confirm }) =>
      guard(async () => {
        if (confirm !== true) return errorResult(NEEDS_CONFIRM);
        const student = await resolveStudent(api, ctx.userId, relationship_id, student_name);
        const sent = await sendAsHomework(api, relationship_id, 'deck', deck_id, { mode, due_date, priority: priority ?? 'core', skip_known, today });
        const first = sent.result.assignments[0];
        return jsonResult({
          sent: true,
          sent_to: student,
          shared_deck_id: sent.copy?.share_id ?? null,
          tutor_deck_id: deck_id,
          student_deck_id: sent.copy?.target_id ?? first.target_id,
          student_deck_name: sent.copy?.target_name ?? first.title,
          shared_at: first.created_at,
          mode: sent.mode,
          due_date: sent.due_date,
          assignments: assignmentSummary(sent.result.assignments),
          skipped_known: sent.result.skipped.flatMap((s) => s.hanzi),
          message: sentTo(student.name, `"${sent.copy?.target_name ?? first.title}" ${describeSend(sent.mode, sent.due_date)}.`),
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

  // ============ Take homework back (worker routes/homework-removal.ts) ============

  const DRY_RUN = z
    .boolean()
    .optional()
    .describe('true = only report what the student would lose (nothing is deleted). Do this first and tell the tutor.');

  server.tool(
    'remove_student_deck',
    "Take back a homework deck the tutor sent (e.g. an agent sent the wrong deck by accident): deletes the STUDENT's copy from their account — gone from every device of theirs on the next sync, their progress on it deleted — and drops it from the tutor's Homework list and the student's homework. It can only reach a copy of a deck this tutor shared in this relationship, never the student's own decks. Pass `shared_deck_id` (from list_student_homework) or `deck_id` (the student's copy id, `student_deck_id`). Call with `dry_run: true` first and tell the tutor what would be lost (`words_met` of `words_total`, `reviews`); then call again without it. `delete_source: true` also deletes the tutor's own source deck, only when no other student still has a copy (`can_delete_source` in the dry run). Returns `{ removed, words_met, reviews, source_deleted }`.",
    {
      relationship_id: RELATIONSHIP_ID,
      shared_deck_id: z.string().optional().describe('The `shared_deck_id` from list_student_homework.'),
      deck_id: z.string().optional().describe("Or the student's copy id (`student_deck_id` in list_student_homework, `target_deck_id` in a session-notes job result)."),
      delete_source: z.boolean().optional().describe("Also delete the tutor's source deck (only if no other student has a copy). Default false."),
      dry_run: DRY_RUN,
    },
    async ({ relationship_id, shared_deck_id, deck_id, delete_source, dry_run }) =>
      guard(async () => {
        const id = shared_deck_id || deck_id;
        if (!id) throw new Error('Pass shared_deck_id or deck_id (from list_student_homework).');
        const path = `${rel(relationship_id)}/shared-decks/${encodeURIComponent(id)}`;
        if (dry_run) return jsonResult({ dry_run: true, ...(await api.get<Record<string, unknown>>(`${path}/removal`)) });
        return jsonResult(await api.delete<Record<string, unknown>>(delete_source ? `${path}?delete_source=1` : path));
      })
  );

  server.tool(
    'remove_student_lesson',
    "Take back a mini lesson the tutor assigned: deletes the STUDENT's copy (and its completion history) from their account; the tutor's library item stays. Only lessons this tutor assigned (`assigned_by_me` in list_student_homework) — never lessons the student made or another tutor assigned. `dry_run: true` first reports `completions` (times the student did it); tell the tutor, then call without it.",
    {
      relationship_id: RELATIONSHIP_ID,
      lesson_id: z.string().describe("The student's lesson id (`lesson_id` in list_student_homework / a session-notes job result)."),
      dry_run: DRY_RUN,
    },
    async ({ relationship_id, lesson_id, dry_run }) =>
      guard(async () => {
        const path = `${rel(relationship_id)}/student-lessons/${encodeURIComponent(lesson_id)}`;
        if (dry_run) return jsonResult({ dry_run: true, ...(await api.get<Record<string, unknown>>(`${path}/removal`)) });
        return jsonResult(await api.delete<Record<string, unknown>>(path));
      })
  );

  server.tool(
    'remove_student_reader',
    "Take back a graded reader the tutor shared: deletes the STUDENT's copy (pictures the tutor's reader still uses are kept); the tutor's reader stays. Pass `shared_reader_id` (from list_student_homework `readers`) or `reader_id` (the student's copy, `student_reader_id` / a job result's `target_reader_id`). `dry_run: true` first reports `readings`; tell the tutor, then call without it.",
    {
      relationship_id: RELATIONSHIP_ID,
      shared_reader_id: z.string().optional().describe('The `shared_reader_id` from list_student_homework.'),
      reader_id: z.string().optional().describe("Or the student's copy id."),
      dry_run: DRY_RUN,
    },
    async ({ relationship_id, shared_reader_id, reader_id, dry_run }) =>
      guard(async () => {
        const id = shared_reader_id || reader_id;
        if (!id) throw new Error('Pass shared_reader_id or reader_id (from list_student_homework).');
        const path = `${rel(relationship_id)}/shared-readers/${encodeURIComponent(id)}`;
        if (dry_run) return jsonResult({ dry_run: true, ...(await api.get<Record<string, unknown>>(`${path}/removal`)) });
        return jsonResult(await api.delete<Record<string, unknown>>(path));
      })
  );

  server.tool(
    'update_student_deck_copy',
    `${SEND_RULE} Bring the student's copy of a shared deck up to date with the tutor's version: words the tutor added since sharing are copied over (with their cards and audio), words the student already has are matched by hanzi and left untouched so their progress and history survive. Returns how many were added / kept / got missing audio filled.`,
    {
      relationship_id: RELATIONSHIP_ID,
      shared_deck_id: z.string().describe('The `shared_deck_id` from list_student_homework.'),
      student_name: STUDENT_NAME,
      confirm: CONFIRM_SEND,
    },
    async ({ relationship_id, shared_deck_id, student_name, confirm }) =>
      guard(async () => {
        if (confirm !== true) return errorResult(NEEDS_CONFIRM);
        const student = await resolveStudent(api, ctx.userId, relationship_id, student_name);
        const r = await api.post<{ added?: number; kept?: number; audio_filled?: number; updated?: number }>(
          `${rel(relationship_id)}/shared-decks/${encodeURIComponent(shared_deck_id)}/update`
        );
        return jsonResult({ sent: true, sent_to: student, ...r, message: sentTo(student.name, `their copy gained ${r.added ?? 0} new word(s), took your newer text on ${r.updated ?? 0}, kept ${r.kept ?? 0}.`) });
      })
  );

  // ============ Session notes → homework (the agent) ============

  server.tool(
    'submit_session_notes',
    `Hand the tutor's raw notes from a lesson — or the transcript of a recorded video lesson — to the in-app assistant, which works in the background (a minute or a few): it checks the words against the student's existing cards and struggles, builds a deck of standard cards for the words taught in the lesson, writes a mini lesson ONLY when the notes show a grammar point with example sentences and a graded reader only when the notes call for one. Everything it makes stays in the TUTOR's account — NOTHING is sent to the student (the result lists each item with \`sent: false\`); send them afterwards with send_session_notes_items when the tutor asks (or the tutor uses "Send to <student>" on the job in the app). Pass \`notes\` verbatim (any length and format; do not pre-process them into cards), OR \`call_id\` for a video call whose transcript, whiteboard text, chat and report become the notes (the call must belong to the relationship and be ended). Returns the job; poll get_session_notes_job for progress and the result. Also logs the lesson (anchors "since last lesson" in Insights) unless \`log_lesson\` is false.`,
    {
      relationship_id: RELATIONSHIP_ID.optional().describe('Required with `notes`. Ignored with `call_id` (the call knows its relationship).'),
      notes: z.string().min(20).max(120_000).optional().describe('The raw session notes, verbatim. Omit when passing call_id.'),
      call_id: z.string().optional().describe('A recorded video call (from the app\'s Calls page) whose transcript should become the notes.'),
      title: z.string().max(120).optional().describe('Optional title for the lesson / deck ("Restaurant ordering"). Ignored with call_id (the call\'s title is used).'),
      lesson_at: z.string().optional().describe('When the lesson happened (YYYY-MM-DD or ISO). Default: now (or the call\'s start).'),
      priority: z.enum(['core', 'non_urgent']).optional().describe('Where the deck lands in the student\'s study queue when sent: core = top (default), non_urgent = bottom.'),
      auto_share: z.boolean().optional().describe('Default false: everything stays in the tutor\'s account to review first. true sends it all to the student automatically when the job finishes — ONLY when the tutor explicitly asked for that in this conversation; then confirm: true is required too.'),
      confirm: z.boolean().optional().describe('With auto_share: must be true — only after the tutor explicitly asked to send the results to this student without reviewing them.'),
      log_lesson: z.boolean().optional().describe('Also add a lesson-log entry with these notes (default true).'),
    },
    async ({ relationship_id, notes, call_id, title, lesson_at, priority, auto_share, confirm, log_lesson }) =>
      guard(async () => {
        if (auto_share && confirm !== true) {
          return errorResult('auto_share sends everything to the student without review: it needs confirm: true, and only when the tutor explicitly asked for that. Nothing was submitted. Call again without auto_share to make the homework in the tutor\'s account first.');
        }
        const options = { priority: priority ?? 'core', auto_share: auto_share === true, log_lesson: log_lesson ?? true };
        if (call_id) {
          const r = await api.post<{ job: SessionNotesJobRow; existing?: boolean }>(`/api/calls/${encodeURIComponent(call_id)}/homework`, options);
          return jsonResult({
            ...compactSessionNotesJob(r.job),
            ...(r.existing ? { note: "Homework for this call's lesson (calls within 20 minutes of each other count as one lesson) was already made or is being made; this is that job — no new one was started." } : {}),
            hint: 'Poll get_session_notes_job until status is done (or failed); a job usually takes one to three minutes.',
          });
        }
        if (!relationship_id || !notes) return errorResult('Pass relationship_id and notes, or call_id.');
        const r = await api.post<{ job: SessionNotesJobRow }>(`${rel(relationship_id)}/session-notes`, {
          notes,
          title: title ?? undefined,
          lesson_at: lesson_at ?? undefined,
          ...options,
        });
        return jsonResult({ ...compactSessionNotesJob(r.job), hint: 'Poll get_session_notes_job until status is done (or failed); a job usually takes one to three minutes.' });
      })
  );

  server.tool(
    'get_session_notes_job',
    'Progress and result of one session-notes job: status (queued / running / done / failed / cancelled), the latest progress line, the steps taken so far, and when done what was made (deck with card count, lessons, reader — each with whether it was sent to the student) plus the assistant\'s summary and the words it left out with reasons.',
    {
      relationship_id: RELATIONSHIP_ID,
      job_id: z.string().describe('The `job_id` from submit_session_notes / list_session_notes_jobs.'),
    },
    async ({ relationship_id, job_id }) =>
      guard(async () => {
        const r = await api.get<{ job: SessionNotesJobRow }>(`${rel(relationship_id)}/session-notes/${encodeURIComponent(job_id)}`);
        return jsonResult(compactSessionNotesJob(r.job, { steps: true }));
      })
  );

  server.tool(
    'list_session_notes_jobs',
    'Session-notes jobs for a student, newest first, each with status and what it produced. Use it to see what earlier lessons already turned into homework before submitting new notes.',
    {
      relationship_id: RELATIONSHIP_ID,
      limit: z.number().int().min(1).max(200).optional().describe('Default 20.'),
    },
    async ({ relationship_id, limit }) =>
      guard(async () => {
        const r = await api.get<{ jobs: SessionNotesJobRow[] }>(`${rel(relationship_id)}/session-notes`, { limit: String(clampInt(limit, 1, 200, 20)) });
        return jsonResult({ jobs: r.jobs.map((j) => compactSessionNotesJob(j)) });
      })
  );

  server.tool(
    'send_session_notes_items',
    `${SEND_RULE} Send what a finished session-notes job made (its deck, mini lessons and reader, which wait in the tutor's account) to the job's student as homework — the same as "Send to <student>" on the job in the app, a real assignment like share_deck_with_student. \`items\` picks which ("deck", "lesson:<library_item_id>", "reader" — the keys in get_session_notes_job's \`not_sent\`); omit it to send everything not sent yet. Not for drafts (those use assign_homework_draft).`,
    {
      relationship_id: RELATIONSHIP_ID,
      job_id: z.string().describe('The `job_id` from submit_session_notes / list_session_notes_jobs.'),
      items: z.array(z.string()).optional().describe('Keys from `not_sent`: "deck", "lesson:<library_item_id>", "reader". Omit = all of them.'),
      mode: SEND_MODE,
      due_date: SEND_DUE_DATE,
      today: SEND_TODAY,
      student_name: STUDENT_NAME,
      confirm: CONFIRM_SEND,
    },
    async ({ relationship_id, job_id, items, mode, due_date, today, student_name, confirm }) =>
      guard(async () => {
        if (confirm !== true) return errorResult(NEEDS_CONFIRM);
        const student = await resolveStudent(api, ctx.userId, relationship_id, student_name);
        const r = await api.post<{ job: SessionNotesJobRow; sent: Array<{ key: string; title: string }>; errors: Array<{ source_id: string; error: string }>; skipped: Array<{ hanzi: string[] }> }>(
          `${rel(relationship_id)}/session-notes/${encodeURIComponent(job_id)}/send`,
          { items, mode, due_date, today },
        );
        return jsonResult({
          sent: r.sent.length > 0,
          sent_to: student,
          items_sent: r.sent,
          errors: r.errors,
          skipped_known: r.skipped.flatMap((s) => s.hanzi),
          job: compactSessionNotesJob(r.job),
          message: r.sent.length ? sentTo(student.name, r.sent.map((i) => `"${i.title}"`).join(', ') + ` ${describeSend(mode ?? 'both', due_date ?? null)}.`) : `Nothing was sent to ${student.name}.`,
        });
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
