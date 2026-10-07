package dev.jeromeswannack.chineselearning.lab.ui.homework

import dev.jeromeswannack.chineselearning.lab.core.Homework
import dev.jeromeswannack.chineselearning.lab.core.HomeworkAssignment
import dev.jeromeswannack.chineselearning.lab.core.HomeworkEvent
import dev.jeromeswannack.chineselearning.lab.core.HwMessage
import dev.jeromeswannack.chineselearning.lab.data.api.ExplainedWord
import dev.jeromeswannack.chineselearning.lab.data.api.OnboardingDeckDto
import dev.jeromeswannack.chineselearning.lab.data.api.SentenceExplanation
import dev.jeromeswannack.chineselearning.lab.ui.study.SentenceRow
import dev.jeromeswannack.chineselearning.lab.data.api.OnboardingDto
import dev.jeromeswannack.chineselearning.lab.data.api.UserSummaryDto
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.nav.TabId
import dev.jeromeswannack.chineselearning.lab.ui.onboarding.FirstOpenActions
import dev.jeromeswannack.chineselearning.lab.ui.onboarding.FirstOpenScreen
import dev.jeromeswannack.chineselearning.lab.ui.onboarding.FirstOpenUi
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import com.github.takahirom.roborazzi.captureRoboImage
import dev.jeromeswannack.chineselearning.lab.data.api.GradedReaderDto
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderPageDto
import dev.jeromeswannack.chineselearning.lab.ui.lessons.ExerciseEnv
import dev.jeromeswannack.chineselearning.lab.ui.lessons.LessonSamples
import dev.jeromeswannack.chineselearning.lab.ui.readers.ReaderEnv
import dev.jeromeswannack.chineselearning.lab.ui.readers.SessionReader
import org.junit.Test
import org.robolectric.annotation.Config

/** Package E screenshots: homework list, the one-off pass, Home's homework cards, first open. */
class HomeworkScreenshots : LabScreenshotTest() {
    companion object {
        const val TODAY = "2026-09-27"

        private fun a(id: String, title: String, kind: String = "deck", mode: String = "one_off", due: String? = TODAY, items: Int = 12, part: Int = 0, parts: Int = 1, status: String = "active") =
            HomeworkAssignment(
                id = id, kind = kind, target_id = "t-$id", title = title, mode = mode, due_date = due,
                item_ids = if (kind == "deck") (1..items).map { "$id-n$it" } else null, item_count = items,
                part_index = part, part_count = parts, status = status, created_at = "2026-09-2${part}T10:00:00Z",
                updated_at = "2026-09-26T10:00:00Z", completed_at = if (status == "done") "2026-09-26T10:00:00Z" else null, tutor_name = "王老师",
            )

        val assignments = listOf(
            a("a1", "餐厅点菜 · day 1 of 2", due = "2026-09-25", parts = 2),
            a("a2", "餐厅点菜 · day 2 of 2", due = "2026-09-28", part = 1, parts = 2),
            a("a3", "天气和季节", mode = "both", due = TODAY, items = 8),
            a("a4", "把字句", kind = "lesson", due = "2026-10-01"),
            a("a5", "小明在巴黎", kind = "reader", due = "2026-09-30"),
            a("a6", "Week 2 · 家人", status = "done", due = "2026-09-20"),
        )
        val events = (1..5).map { HomeworkEvent("e$it", "a1", "a1-n$it", "right", "2026-09-26T10:0$it:00Z") } +
            listOf(HomeworkEvent("e9", "a1", "a1-n6", "wrong", "2026-09-26T10:09:00Z"))
        val sorted = Homework.sortHomeworkItems(Homework.toHomeworkItems(assignments, events, TODAY))
        val listUi = HomeworkListUi(true, sorted.todo, sorted.done, TODAY)

        val clueRow = SentenceRow("clue:n1", null, "服务员，我们要点菜。", "fúwùyuán, wǒmen yào diǎn cài.", "Waiter, we'd like to order.", null, "From the card", fromCard = true)
        val setRows = listOf(
            SentenceRow("s1", "s1", "那个服务员很热情。", "nàge fúwùyuán hěn rèqíng.", "That waiter is very friendly.", null, null),
            SentenceRow("s2", "s2", "我姐姐在饭店当服务员。", "wǒ jiějie zài fàndiàn dāng fúwùyuán.", "My older sister works as a waitress in a restaurant.", null, "Collocation"),
        )
        val note = PassNote("n1", "服务员", "fúwùyuán", "waiter; waitress", null, listOf(clueRow) + setRows, "d1")
        val breakdown = SentenceExplanation(
            words = listOf(
                ExplainedWord("服务员", "fúwùyuán", "waiter"),
                ExplainedWord("我们", "wǒmen", "we"),
                ExplainedWord("要", "yào", "want to"),
                ExplainedWord("点菜", "diǎn cài", "order food"),
            ),
            construction = "Calling someone by their role (服务员，…) then **要 + verb** for what you want to do.",
        )
        val deckAssignment = assignments[0]
        val progress = Homework.passProgress(Homework.passItemIds(deckAssignment), events)
        fun deckPass(revealed: Boolean) = PassUi.Deck("餐厅点菜", "day 1 of 2", Homework.dueLabel("2026-09-25", TODAY), progress, note, revealed, "d1", oneOffOnly = true)

        val homeUi = HomeHomeworkUi(
            card = dev.jeromeswannack.chineselearning.lab.core.HomeHomework.build(
                sorted.todo,
                listOf(dev.jeromeswannack.chineselearning.lab.core.LongTermHomework("deck", "d-hsk3", "第三周作业：天气", "王老师", "2026-09-26T10:00:00Z", 7, 18)),
            ),
            unread = HwMessage("c1", "rel1", "明天上课前把这些词复习一下，好吗？", "2026-09-27T08:00:00Z"),
            unreadRelId = "rel1",
            unreadFrom = "王老师",
            notesLine = "3 new notes from 王老师",
        )

        val onboarding = OnboardingDto(
            invited = true, redeemed_at = "2026-09-27 08:00:00", inviter = UserSummaryDto("t1", name = "王老师"), inviter_role = "tutor",
            relationship_id = "rel1", welcome_message = "欢迎！Welcome — start with the starter deck and message me any questions.", welcome_conversation_id = "c1",
            decks = listOf(OnboardingDeckDto("d1", "Starter Chinese (from tutor)", 15)),
        )
    }

    @Test fun list() = shootInShell("homework-01-list", active = TabId.STUDY) { HomeworkListScreen(listUi, onBack = {}, onOpen = {}) }

    @Test fun listEmpty() = shoot("homework-02-list-empty") { HomeworkListScreen(HomeworkListUi(true), onBack = {}, onOpen = {}) }

    @Test fun passFront() = shoot("homework-03-pass-front") { HomeworkPassScreen(deckPass(false), PassActions()) }

    @Test fun passRevealed() = shoot("homework-04-pass-revealed") { HomeworkPassScreen(deckPass(true), PassActions()) }

    @Test fun passDone() = shoot("homework-05-pass-done") {
        HomeworkPassScreen(deckPass(false).copy(progress = progress.copy(done = 12, total = 12, remaining = emptyList(), retrying = 0, complete = true)), PassActions())
    }

    @Test fun passDoneAdded() = shoot("homework-06-pass-done-added", dark = true) {
        HomeworkPassScreen(deckPass(false).copy(progress = progress.copy(done = 12, total = 12, remaining = emptyList(), retrying = 0, complete = true), addState = AddState.Done), PassActions())
    }

    // "Add to my long-term review" (docs/HOMEWORK.md §3a).
    private fun bothPass(n: PassNote) = deckPass(true).copy(note = n, oneOffOnly = false, deckInReview = true)

    @Test fun passLongTermOff() = shoot("homework-26-pass-longterm-off") { HomeworkPassScreen(bothPass(note.copy(longTerm = 0)), PassActions()) }

    @Test fun passLongTermOnOneOff() = shoot("homework-27-pass-longterm-on-oneoff", dark = true) {
        HomeworkPassScreen(deckPass(true).copy(note = note.copy(longTerm = 1)), PassActions())
    }

    @Test fun passLongTermStarted() = shoot("homework-28-pass-longterm-started") { HomeworkPassScreen(bothPass(note.copy(started = true)), PassActions()) }

    @Test fun passDoneLongTerm() = shoot("homework-29-pass-done-longterm") {
        HomeworkPassScreen(
            bothPass(note).copy(
                progress = progress.copy(done = 16, total = 16, remaining = emptyList(), retrying = 0, complete = true),
                longTermSummary = dev.jeromeswannack.chineselearning.lab.core.LongTerm.Summary(12, 4),
            ),
            PassActions(),
        )
    }

    @Test fun passDoneOneOffSomeAdded() = shoot("homework-30-pass-done-oneoff-some-added") {
        HomeworkPassScreen(
            deckPass(false).copy(
                progress = progress.copy(done = 12, total = 12, remaining = emptyList(), retrying = 0, complete = true),
                longTermSummary = dev.jeromeswannack.chineselearning.lab.core.LongTerm.Summary(3, 9),
            ),
            PassActions(),
        )
    }

    // Lesson / reader items play in the Lab's own players (package K).
    private val previews = dev.jeromeswannack.chineselearning.lab.core.CardScheduler.intervalPreviews(
        dev.jeromeswannack.chineselearning.lab.core.CardScheduler.initialCardState(), java.time.Instant.parse("2026-09-27T09:00:00Z").toEpochMilli(),
    )
    private val lessonSpec = LessonSamples.lesson(LessonSamples.choice, LessonSamples.scramble)
    private val passLesson = PassLesson("t-a4", lessonSpec.title, lessonSpec.icon, lessonSpec, previews)
    private val env = ExerciseEnv(random = kotlin.random.Random(7))
    private val reader = GradedReaderDto(
        "t-a5", "小明在巴黎", "Xiaoming in Paris", "beginner", "travel", emptyList(), "ready", null, "2026-09-26T08:00:00Z",
        listOf(
            ReaderPageDto("p1", 1, "小明今天第一次去巴黎。他很兴奋。", "Xiǎomíng jīntiān dì yī cì qù Bālí. Tā hěn xīngfèn.", "Today Xiaoming is going to Paris for the first time. He is very excited.", null, null),
            ReaderPageDto("p2", 2, "他在咖啡店点了一杯咖啡和一个面包。", "Tā zài kāfēidiàn diǎnle yì bēi kāfēi hé yí ge miànbāo.", "At a café he ordered a coffee and a croissant.", null, null),
        ),
    )

    @Test fun passLesson() = shoot("homework-07-pass-lesson") {
        HomeworkPassScreen(PassUi.Player("lesson", "把字句", complete = false, lesson = passLesson), PassActions(), env)
    }

    @Test fun passLessonRating() {
        compose.setContent {
            dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme {
                HomeworkPassScreen(PassUi.Player("lesson", "把字句", complete = false, lesson = passLesson.copy(spec = LessonSamples.lesson(LessonSamples.choice))), PassActions(), env)
            }
        }
        compose.mainClock.advanceTimeBy(1_500)
        compose.onNodeWithText("请把窗户关上。").performClick()
        compose.mainClock.advanceTimeBy(300)
        compose.onAllNodesWithText("Continue").onFirst().performClick()
        compose.mainClock.advanceTimeBy(2_000)
        compose.onRoot().captureRoboImage("screenshots/homework-12-pass-lesson-rating.png")
    }

    @Test fun passLessonMissing() = shoot("homework-13-pass-lesson-missing") {
        HomeworkPassScreen(PassUi.Player("lesson", "把字句", complete = false, lesson = null), PassActions(), env)
    }

    @Test fun passReader() = shoot("homework-14-pass-reader") {
        HomeworkPassScreen(PassUi.Player("reader", "小明在巴黎", complete = false, reader = SessionReader(reader, 1)), PassActions(), env, ReaderEnv())
    }

    @Test fun passLessonDone() = shoot("homework-15-pass-lesson-done") {
        HomeworkPassScreen(PassUi.Player("lesson", "把字句", complete = true, lesson = passLesson), PassActions(), env)
    }

    @Test fun passMissing() = shoot("homework-08-pass-missing") { HomeworkPassScreen(PassUi.Missing, PassActions()) }

    @Test fun homeCards() = shootInShell("homework-09-home-cards", active = TabId.STUDY) {
        dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen("Home") {
            item { HomeHomeworkSection(homeUi, HomeHomeworkActions()) }
        }
    }

    @Test fun firstOpen() = shoot("homework-10-first-open") {
        FirstOpenScreen(FirstOpenUi(onboarding, "Jerome Swannack", totalDue = 15, hasSyncedOnce = true, online = true), FirstOpenActions())
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun passUnfolded() = shoot("homework-11-pass-unfolded") { HomeworkPassScreen(deckPass(true), PassActions()) }

    // The pass laid out like a study card (card fills the space, answer bar at the bottom):
    // dark, font scale 1.3 and the unfolded Fold.
    @Test fun passFrontDark() = shoot("homework-16-pass-front-dark", dark = true) { HomeworkPassScreen(deckPass(false), PassActions()) }

    @Test fun passRevealedDark() = shoot("homework-17-pass-revealed-dark", dark = true) { HomeworkPassScreen(deckPass(true), PassActions()) }

    @Test fun passFrontLargeFont() = shoot("homework-18-pass-front-font130") { LargeFont { HomeworkPassScreen(deckPass(false), PassActions()) } }

    @Test fun passRevealedLargeFont() = shoot("homework-19-pass-revealed-font130", dark = true) { LargeFont { HomeworkPassScreen(deckPass(true), PassActions()) } }

    @Config(qualifiers = UNFOLDED)
    @Test fun passFrontUnfolded() = shoot("homework-20-pass-front-unfolded") { HomeworkPassScreen(deckPass(false), PassActions()) }

    // The answer side's example sentence, as on the study card (folded, dark, font 1.3): the
    // Chinese up; tapped open (pinyin + English + the tools); "What's going on here?" open;
    // the generated set under "+ N more sentences".
    @Test fun passSentenceClosed() = shoot("homework-22-pass-sentence-closed", dark = true) { LargeFont { HomeworkPassScreen(deckPass(true), PassActions()) } }

    @Test fun passSentenceOpen() = shoot("homework-23-pass-sentence-open", dark = true) {
        LargeFont { HomeworkPassScreen(deckPass(true), PassActions(), sentences = PassSentencesStart(steps = mapOf(clueRow.key to 3))) }
    }

    @Test fun passSentenceBreakdown() = shoot("homework-24-pass-sentence-breakdown", dark = true) {
        LargeFont {
            HomeworkPassScreen(deckPass(true), PassActions(), sentences = PassSentencesStart(explained = mapOf(clueRow.key to breakdown), steps = mapOf(clueRow.key to 3)))
        }
    }

    @Test fun passSentenceMore() = shoot("homework-25-pass-sentence-more") {
        HomeworkPassScreen(deckPass(true), PassActions(), sentences = PassSentencesStart(steps = mapOf("s2" to 2), more = true))
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun passRevealedUnfoldedLargeFont() = shoot("homework-21-pass-revealed-unfolded-font130") { LargeFont { HomeworkPassScreen(deckPass(true), PassActions()) } }
}

/** Android's font size setting at 130 %. */
@androidx.compose.runtime.Composable
private fun LargeFont(content: @androidx.compose.runtime.Composable () -> Unit) {
    val d = androidx.compose.ui.platform.LocalDensity.current
    androidx.compose.runtime.CompositionLocalProvider(androidx.compose.ui.platform.LocalDensity provides androidx.compose.ui.unit.Density(d.density, 1.3f), content = content)
}
