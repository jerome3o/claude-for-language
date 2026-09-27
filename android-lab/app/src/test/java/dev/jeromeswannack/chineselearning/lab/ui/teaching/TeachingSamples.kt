package dev.jeromeswannack.chineselearning.lab.ui.teaching

import dev.jeromeswannack.chineselearning.lab.data.api.ActivityDayDto
import dev.jeromeswannack.chineselearning.lab.data.api.AssignmentDto
import dev.jeromeswannack.chineselearning.lab.data.api.CardFlagDto
import dev.jeromeswannack.chineselearning.lab.data.api.CardFlagsDto
import dev.jeromeswannack.chineselearning.lab.data.api.ClaudeChatsDto
import dev.jeromeswannack.chineselearning.lab.data.api.ClaudeQuestionDto
import dev.jeromeswannack.chineselearning.lab.data.api.ConversationDto
import dev.jeromeswannack.chineselearning.lab.data.api.HomeworkDeckDto
import dev.jeromeswannack.chineselearning.lab.data.api.HomeworkDeckSummaryDto
import dev.jeromeswannack.chineselearning.lab.data.api.HomeworkLessonDto
import dev.jeromeswannack.chineselearning.lab.data.api.HomeworkLoadDto
import dev.jeromeswannack.chineselearning.lab.data.api.HomeworkSummaryDto
import dev.jeromeswannack.chineselearning.lab.data.api.InviteRefDto
import dev.jeromeswannack.chineselearning.lab.data.api.LastMessageDto
import dev.jeromeswannack.chineselearning.lab.data.api.LibraryItemSummaryDto
import dev.jeromeswannack.chineselearning.lab.data.api.LoadDayDto
import dev.jeromeswannack.chineselearning.lab.data.api.LoadFsrsDto
import dev.jeromeswannack.chineselearning.lab.data.api.LoadOneOffDto
import dev.jeromeswannack.chineselearning.lab.data.api.NeedsAttentionDto
import dev.jeromeswannack.chineselearning.lab.data.api.NoteRefDto
import dev.jeromeswannack.chineselearning.lab.data.api.PendingInviteDto
import dev.jeromeswannack.chineselearning.lab.data.api.PillsDto
import dev.jeromeswannack.chineselearning.lab.data.api.RecordingRefDto
import dev.jeromeswannack.chineselearning.lab.data.api.RelationshipHomeworkDto
import dev.jeromeswannack.chineselearning.lab.data.api.SetupAudioDto
import dev.jeromeswannack.chineselearning.lab.data.api.SetupStatusDto
import dev.jeromeswannack.chineselearning.lab.data.api.SetupStepDto
import dev.jeromeswannack.chineselearning.lab.data.api.StudentLessonDto
import dev.jeromeswannack.chineselearning.lab.data.api.StudentOverviewDto
import dev.jeromeswannack.chineselearning.lab.data.api.StudyStatusDto
import dev.jeromeswannack.chineselearning.lab.data.api.TodayStatsDto
import dev.jeromeswannack.chineselearning.lab.data.api.TutorDashboardDto
import dev.jeromeswannack.chineselearning.lab.data.api.UserSummaryDto
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import java.time.Instant

/** Realistic tutor-side data for package F's screenshots (a fixed "now" so they are stable). */
object TeachingSamples {
    val now: Instant = Instant.parse("2026-09-27T09:30:00Z")
    const val TODAY = "2026-09-27"

    val jerome = UserSummaryDto("u-jerome", "jerome@example.com", "Jerome Swannack")
    val lily = UserSummaryDto("u-lily", "lily.chen@example.com", "Lily Chen")

    private fun ref(id: String, hanzi: String, pinyin: String, english: String) = NoteRefDto(id, hanzi, pinyin, english, "d1", "第四周作业：交通")

    val needsAttention = listOf(
        NeedsAttentionDto(ref("n1", "打算", "dǎsuàn", "to plan; to intend"), attempts = 6, again_count = 3, wrong_answers = listOf("打算了", "大算"), wrong_typed_count = 2, last_reviewed_at = "2026-09-27T07:10:00Z"),
        NeedsAttentionDto(ref("n2", "地铁站", "dìtiězhàn", "subway station"), attempts = 4, hard_count = 2, recording = RecordingRefDto("e9", "recordings/u-jerome/e9.webm"), recordings_unheard = 2, last_reviewed_at = "2026-09-26T21:00:00Z"),
        NeedsAttentionDto(ref("n3", "换乘", "huànchéng", "to change (trains)"), attempts = 3, again_count = 1, wrong_answers = listOf("换成"), last_reviewed_at = "2026-09-26T20:40:00Z"),
    )

    val homeworkDecks = listOf(
        HomeworkDeckDto(
            "sd1", "d1", "t1", "第四周作业：交通", "第四周作业：交通", "2026-09-20T10:00:00Z",
            cards_total = 72, cards_started = 45, cards_mastered = 18, notes_missing = 3, percent_started = 63, percent_mastered = 25,
            notes_total = 24, notes_introduced = 15, words_to_go = 9, days_to_go = 3, queue_position = 1, queue_total = 5,
        ),
        HomeworkDeckDto(
            "sd2", "d2", "t2", "HSK 3 · Plans & time", "HSK 3 · Plans & time", "2026-09-02T10:00:00Z",
            cards_total = 120, cards_started = 110, cards_mastered = 86, percent_started = 92, percent_mastered = 72,
            notes_total = 40, notes_introduced = 40, words_to_go = 0, days_to_go = 0, queue_position = 3, queue_total = 5,
        ),
    )

    val activity = listOf(
        ActivityDayDto("2026-09-27", 42, 0.86, 11 * 60_000L),
        ActivityDayDto("2026-09-26", 57, 0.79, 16 * 60_000L),
    )

    val jeromeOverview = StudentOverviewDto(
        relationship_id = "rel-jerome",
        student = jerome,
        joined_at = "2026-06-01T08:00:00Z",
        joined_via_invite = true,
        status = StudyStatusDto("2026-09-27T07:12:00Z", studied_today = true, streak_days = 12, active_days_30 = 24, today = TodayStatsDto(42, 0.86, 11 * 60_000L)),
        pills = PillsDto(struggling_words = 5, recordings_to_hear = 2, homework_percent = 58, flags_open = 1),
        needs_attention = needsAttention,
        homework = HomeworkSummaryDto(58, homeworkDecks, listOf(HomeworkLessonDto("l1", "了 for completed actions", "🎓", "2026-09-21T10:00:00Z", 2, "2026-09-25T10:00:00Z", 2))),
        activity = activity,
        last_conversation_id = "c1",
    )

    val lilyOverview = StudentOverviewDto(
        relationship_id = "rel-lily",
        student = lily,
        joined_at = "2026-09-25T08:00:00Z",
        joined_via_invite = true,
        is_new = true,
        setup = SetupStatusDto(
            steps = listOf(
                SetupStepDto("signed_in", "Signed in", true, "2026-09-25T08:00:00Z"),
                SetupStepDto("homework", "Homework received", true, "Starter Chinese · 15 words"),
                SetupStepDto("installed", "Installed the app", false, "Using the website in a browser"),
                SetupStepDto("first_session", "First study session", false, "Not yet"),
            ),
            done_count = 2,
            install_kind = "browser",
            audio = SetupAudioDto(cached = 12, total = 30),
            last_opened_at = "2026-09-26T19:00:00Z",
            invite = InviteRefDto("inv1", "https://chinese-learning-2x9.pages.dev/join/9f2c7a1e", "active", "2026-09-25T08:00:00Z"),
        ),
    )

    val dashboard = TutorDashboardDto(
        students = listOf(jeromeOverview, lilyOverview),
        invites = listOf(PendingInviteDto("inv2", "https://chinese-learning-2x9.pages.dev/join/abc", note = "Wang Fang (Tuesday class)", created_at = "2026-09-24T08:00:00Z", share_deck_count = 1)),
        homework_decks = listOf(
            HomeworkDeckSummaryDto("d1", "第四周作业：交通", 24, 2),
            HomeworkDeckSummaryDto("d2", "HSK 3 · Plans & time", 40, 1),
        ),
    )

    val load = HomeworkLoadDto(
        one_off = LoadOneOffDto(
            items = 3, words = 18, other = 1, overdue_items = 1, overdue_words = 6, due_today_items = 1,
            by_day = listOf(
                LoadDayDto("2026-09-27", 1, 6), LoadDayDto("2026-09-28", 1, 6), LoadDayDto("2026-09-29", 0, 0), LoadDayDto("2026-09-30", 1, 0),
                LoadDayDto("2026-10-01", 0, 0), LoadDayDto("2026-10-02", 0, 0), LoadDayDto("2026-10-03", 0, 0),
            ),
        ),
        fsrs = LoadFsrsDto(9, 3, 3),
        level = "moderate",
        summary = "3 one-off items pending (18 words, 1 lesson / reader) · 1 overdue · 9 words to go in long-term review (~3 days at 3/day)",
    )

    val homework = RelationshipHomeworkDto(
        assignments = listOf(
            AssignmentDto("a1", "deck", title = "第四周作业：交通 (1/3)", mode = "one_off", due_date = "2026-09-26", item_count = 6, part_index = 0, part_count = 3, done_count = 2),
            AssignmentDto("a2", "deck", title = "第四周作业：交通 (2/3)", mode = "both", due_date = "2026-09-27", item_count = 6, part_index = 1, part_count = 3),
            AssignmentDto("a3", "lesson", title = "了 for completed actions", mode = "one_off", due_date = "2026-09-30", item_count = 1),
            AssignmentDto("a4", "reader", title = "小明在巴黎", mode = "one_off", due_date = "2026-09-22", item_count = 1, done_count = 1, status = "done", completed_at = "2026-09-21T18:00:00Z"),
        ),
        load = load,
        today = TODAY,
    )

    val flags = CardFlagsDto(
        listOf(
            CardFlagDto("f1", "n2", "Is 站 here the same as in 站起来? The audio sounds different to me.", "open", created_at = "2026-09-26T21:05:00Z", hanzi = "地铁站", pinyin = "dìtiězhàn", english = "subway station", deck_name = "第四周作业：交通", student_name = "Jerome"),
            CardFlagDto("f2", "n4", "Why 了 twice here?", "resolved", tutor_reply = "The second 了 means it is still true now — 我学了两年了 = I have been studying for two years (and still am).", replied_at = "2026-09-20T10:00:00Z", created_at = "2026-09-19T21:05:00Z", hanzi = "我学了两年了", pinyin = "wǒ xué le liǎng nián le", english = "I've been studying for two years", deck_name = "HSK 3 · Plans & time", student_name = "Jerome"),
        ),
        open = 1,
    )

    val claude = ClaudeChatsDto(
        listOf(
            ClaudeQuestionDto("q1", "n3", "What's the difference between 换乘 and 转车?", "Both mean changing trains. 换乘 is the word on signs in the metro (换乘站 = interchange station); 转车 is more everyday speech.", "2026-09-26T20:41:00Z", "换乘", "huànchéng", "to change (trains)", "第四周作业：交通"),
            ClaudeQuestionDto("q2", "n3", "Can I say 我要换乘二号线?", "Yes — 我要换乘二号线 is natural: “I need to change to Line 2.”", "2026-09-26T20:44:00Z", "换乘", "huànchéng", "to change (trains)", "第四周作业：交通"),
            ClaudeQuestionDto("q3", "n1", "Is 打算 more formal than 想?", "打算 is a plan you've thought through; 想 is just wanting. Neither is formal.", "2026-09-24T08:00:00Z", "打算", "dǎsuàn", "to plan; to intend", "HSK 3 · Plans & time"),
        ),
        total = 3,
    )

    val conversations = listOf(
        ConversationDto("c1", "Chat", "2026-09-01T10:00:00Z", "2026-09-27T08:00:00Z", LastMessageDto("好的，明天见！我会复习地铁的词。")),
        ConversationDto("c2", "Lesson questions", "2026-08-20T10:00:00Z", "2026-09-10T08:00:00Z", LastMessageDto("What does 顺便 mean in this sentence?")),
    )

    val lessons = listOf(
        StudentLessonDto("l1", "了 for completed actions", "🎓", "tutor", 8, "u-tutor", true, 2, "2026-09-25T10:00:00Z", 2, "att1"),
        StudentLessonDto("l2", "Ordering at a café", "☕", "claude", 6, null, false, 0, null, null),
    )

    val library = listOf(
        LibraryItemSummaryDto("lib1", "了 for completed actions", "🎓", 1, 8),
        LibraryItemSummaryDto("lib2", "Directions: 往…走, 左转, 右转", "🧭", 0, 10),
    )

    val deckOptions = listOf(
        DeckOption("d1", "第四周作业：交通", "Metro, bus and taxi words", 24),
        DeckOption("d2", "HSK 3 · Plans & time", null, 40),
        DeckOption("d3", "Food & ordering", "At a restaurant", 32),
    )

    fun <T> loaded(v: T) = Loadable(data = v, updatedAt = now.toEpochMilli())

    fun studentPage(o: StudentOverviewDto = jeromeOverview) = StudentPageUi(
        relId = o.relationship_id,
        name = o.student.name ?: "",
        overview = loaded(o),
        homework = loaded(homework),
        flags = loaded(flags),
        claude = loaded(claude),
        conversations = loaded(conversations),
        lessons = loaded(lessons),
        lastLessonAt = "2026-09-23T09:00:00Z",
    )
}
