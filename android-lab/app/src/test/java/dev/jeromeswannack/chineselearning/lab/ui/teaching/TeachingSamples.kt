package dev.jeromeswannack.chineselearning.lab.ui.teaching

import dev.jeromeswannack.chineselearning.lab.data.api.ActivityDayDto
import dev.jeromeswannack.chineselearning.lab.data.api.AssignmentDto
import dev.jeromeswannack.chineselearning.lab.data.api.TeachFlagDto
import dev.jeromeswannack.chineselearning.lab.data.api.TeachFlagsDto
import dev.jeromeswannack.chineselearning.lab.data.api.ClaudeContextDto
import dev.jeromeswannack.chineselearning.lab.data.api.TutorClaudeBadgeDto
import dev.jeromeswannack.chineselearning.lab.data.api.TutorClaudeMessageDto
import dev.jeromeswannack.chineselearning.lab.data.api.TutorClaudeThreadDetailDto
import dev.jeromeswannack.chineselearning.lab.data.api.TutorClaudeThreadDto
import dev.jeromeswannack.chineselearning.lab.data.api.TutorClaudeThreadsDto
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
import dev.jeromeswannack.chineselearning.lab.data.api.OneOffSummaryDto
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
            mode = "both", long_term = true,
        ),
        HomeworkDeckDto(
            "sd2", "d2", "t2", "HSK 3 · Plans & time", "HSK 3 · Plans & time", "2026-09-02T10:00:00Z",
            cards_total = 120, cards_started = 110, cards_mastered = 86, percent_started = 92, percent_mastered = 72,
            notes_total = 40, notes_introduced = 40, words_to_go = 0, days_to_go = 0, queue_position = 3, queue_total = 5,
            mode = "fsrs", long_term = true,
        ),
        // Sent one-off only: its copy lives in the pass (caps 0 + 0), so it stays with the homework.
        HomeworkDeckDto(
            "sd3", "d3", "t3", "天气 · this week only", "天气 · this week only", "2026-09-25T10:00:00Z",
            cards_total = 24, cards_started = 6, cards_mastered = 0, percent_started = 25, percent_mastered = 0,
            notes_total = 8, notes_introduced = 2, words_to_go = 6, days_to_go = 0, queue_position = 5, queue_total = 5,
            mode = "one_off", long_term = false,
        ),
    )

    /** The server's one-off headline for [homework] below (shared/homework/summary.ts). */
    val oneOff = OneOffSummaryDto(
        state = "overdue", total = 4, done = 1, open = 3, overdue = 1, due_today = 1, percent = 25,
        label = "1 overdue · 1 of 4 done", pill = "Homework 1 overdue",
    )
    val oneOffAllDone = OneOffSummaryDto(
        state = "all_done", total = 3, done = 3, open = 0, percent = 100, label = "✓ All done this week", pill = "Homework ✓ all done this week",
    )
    val oneOffOpen = OneOffSummaryDto(state = "open", total = 3, done = 2, open = 1, percent = 67, label = "2 of 3 done", pill = "Homework 2 of 3 done")

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
        pills = PillsDto(struggling_words = 5, recordings_to_hear = 4, recordings_need_ear = 2, homework_percent = 25, homework = oneOff, flags_open = 1),
        needs_attention = needsAttention,
        homework = HomeworkSummaryDto(25, oneOff, homeworkDecks, listOf(HomeworkLessonDto("l1", "了 for completed actions", "🎓", "2026-09-21T10:00:00Z", 2, "2026-09-25T10:00:00Z", 2))),
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

    val flags = TeachFlagsDto(
        listOf(
            TeachFlagDto("f1", "n2", "Is 站 here the same as in 站起来? The audio sounds different to me.", "open", created_at = "2026-09-26T21:05:00Z", hanzi = "地铁站", pinyin = "dìtiězhàn", english = "subway station", deck_name = "第四周作业：交通", student_name = "Jerome"),
            TeachFlagDto("f2", "n4", "Why 了 twice here?", "resolved", tutor_reply = "The second 了 means it is still true now — 我学了两年了 = I have been studying for two years (and still am).", replied_at = "2026-09-20T10:00:00Z", created_at = "2026-09-19T21:05:00Z", hanzi = "我学了两年了", pinyin = "wǒ xué le liǎng nián le", english = "I've been studying for two years", deck_name = "HSK 3 · Plans & time", student_name = "Jerome"),
        ),
        open = 1,
    )

    /** Jerome's chats with Claude Minghui may read: a card question (the default) and a role-play he shared. */
    val claude = TutorClaudeThreadsDto(
        listOf(
            TutorClaudeThreadDto(
                "nq-q1", "换乘和转车有什么不一样？", "card",
                ClaudeContextDto("card", note_id = "n3", label = "换乘", sublabel = "第四周作业：交通"),
                TutorClaudeBadgeDto("📇", "Asked on card · 换乘"),
                "两个都是换车。换乘站是地铁里的说法，转车更口语。", "2026-09-26T20:44:00Z", "2026-09-26T20:41:00Z", 4,
            ),
            TutorClaudeThreadDto(
                "th-p", "两位，谢谢。", "practice",
                ClaudeContextDto("practice", scenario = "在饭店点菜", ai_role = "服务员"),
                TutorClaudeBadgeDto("🎭", "Practice · 在饭店点菜"),
                "好的，这边请。这是菜单。", "2026-09-26T19:10:00Z", "2026-09-26T19:00:00Z", 6, shared = true,
            ),
            TutorClaudeThreadDto(
                "nq-q3", "打算比想正式吗？", "card",
                ClaudeContextDto("card", note_id = "n1", label = "打算", sublabel = "HSK 3 · Plans & time"),
                TutorClaudeBadgeDto("📇", "Asked on card · 打算"),
                "打算是想好了的计划；想只是想要。都不正式。", "2026-09-24T08:01:00Z", "2026-09-24T08:00:00Z", 2,
            ),
        ),
        visibility = "card_only",
        total = 3,
    )

    /** One of them, read-only (the tutor opened it). */
    val claudeThread = TutorClaudeThreadDetailDto(
        claude.threads[0],
        listOf(
            TutorClaudeMessageDto("m1", "user", content = "换乘和转车有什么不一样？", created_at = "2026-09-26T20:41:00Z"),
            TutorClaudeMessageDto("m2", "assistant", content = "两个都是换车。\n「换乘」是地铁里的说法：换乘站。\n「转车」更口语，坐公共汽车也常说。", answer_lang = "zh", created_at = "2026-09-26T20:41:05Z"),
            TutorClaudeMessageDto("m3", "user", content = "我可以说我要换乘二号线吗？", created_at = "2026-09-26T20:44:00Z"),
            TutorClaudeMessageDto("m4", "assistant", content = "可以！「我要换乘二号线」很自然。", answer_lang = "zh", created_at = "2026-09-26T20:44:04Z"),
        ),
    )

    val conversations = listOf(
        ConversationDto("c1", null, "2026-09-01T10:00:00Z", "2026-09-27T08:00:00Z", LastMessageDto("好的，明天见！我会复习地铁的词。"), unread = 1),
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
