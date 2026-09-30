package dev.jeromeswannack.chineselearning.lab.ui.today

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.jeromeswannack.chineselearning.lab.core.QueueCounts
import dev.jeromeswannack.chineselearning.lab.ui.study.EXTRAS_BREAK_TAG
import dev.jeromeswannack.chineselearning.lab.ui.study.EXTRAS_CONTINUE_TAG
import dev.jeromeswannack.chineselearning.lab.ui.study.StudyActions
import dev.jeromeswannack.chineselearning.lab.ui.study.StudyPhase
import dev.jeromeswannack.chineselearning.lab.ui.study.StudyScreen
import dev.jeromeswannack.chineselearning.lab.ui.study.StudyUi
import dev.jeromeswannack.chineselearning.lab.ui.study.TodaySummary
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.assertEquals

/** Home's three "Today" rows and the session's "Flashcards done" pause, as a user taps them. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class, qualifiers = "w412dp-h915dp-xxhdpi")
class TodayComposeTest {
    @get:Rule val compose = createComposeRule()

    /** Render, then let the springs settle on a manual clock (animations never hold up idling). */
    private fun show(content: @androidx.compose.runtime.Composable () -> Unit) {
        compose.mainClock.autoAdvance = false
        compose.setContent { LabTheme { content() } }
        compose.mainClock.advanceTimeBy(2_000)
    }

    @Test
    fun homeRowsShowTheThreeKindsAndOpenEach() {
        val opened = mutableListOf<String>()
        show { TodaySection(TodaySamples.midDay, TodayActions(onFlashcards = { opened += "cards" }, onLessons = { opened += "lessons" }, onReader = { opened += "reader" })) }
        compose.onNodeWithText("Flashcards").assertIsDisplayed()
        compose.onNodeWithText("24 due · about 8 min").assertIsDisplayed()
        compose.onNodeWithText("把 sentences · 有 vs 又").assertIsDisplayed()
        compose.onNodeWithText("2 to do · 1 done").assertIsDisplayed()
        compose.onNodeWithText("小明在巴黎 · 6 pages").assertIsDisplayed()
        compose.onNodeWithText("3 to go").assertIsDisplayed()
        compose.onNodeWithTag(TAG_CARDS).performClick()
        compose.onNodeWithTag(TAG_LESSONS).performClick()
        compose.onNodeWithTag(TAG_READER).performClick()
        assertEquals(listOf("cards", "lessons", "reader"), opened)
    }

    @Test
    fun doneRowsShowTicks() {
        show { TodaySection(TodaySamples.allDone, TodayActions()) }
        compose.onNodeWithText("All done ✓").assertIsDisplayed()
        compose.onNodeWithText("142 reviews today").assertIsDisplayed()
        compose.onNodeWithText("Read today · 小明在巴黎").assertIsDisplayed()
    }

    @Test
    fun thePauseContinuesOrLeaves() {
        var continued = 0
        var closed = 0
        show {
                StudyScreen(
                    StudyUi(StudyPhase.Extras(2, true, TodaySamples.pauseTitles), QueueCounts(0, 0, 0, 0), today = TodaySummary(23 * 60_000L, 142, 120, celebrate = false)),
                    playingKey = null,
                    actions = StudyActions(onContinueExtras = { continued++ }, onClose = { closed++ }),
                    autoplay = false,
                )
        }
        compose.onNodeWithTag(EXTRAS_BREAK_TAG).assertIsDisplayed()
        compose.onNodeWithText("Flashcards done ✓").assertIsDisplayed()
        compose.onNodeWithText("2 mini lessons and today's story left").assertIsDisplayed()
        compose.onNodeWithTag(EXTRAS_CONTINUE_TAG).performClick()
        compose.onNodeWithText("Later").performClick()
        assertEquals(1, continued)
        assertEquals(1, closed)
    }

    @Test
    fun lessonListOpensALesson() {
        val opened = mutableListOf<String>()
        show { TodayLessonsScreen(TodaySamples.midDay, onBack = {}, onOpen = { opened += it }, onAllLessons = {}) }
        compose.onNodeWithText("2 to do · 1 done").assertIsDisplayed()
        compose.onNodeWithText("Continue ›").assertIsDisplayed() // the half-done one
        compose.onNodeWithTag("today-lesson-L2").performClick()
        compose.onNodeWithTag("today-lesson-L3").performClick() // done today: not tappable
        assertEquals(listOf("L2"), opened)
    }
}

/** Realistic "today" states for tests and screenshots. */
object TodaySamples {
    val midDay = TodayHome(
        cardsDue = 24,
        cardsReviewed = 38,
        lessonsToDo = listOf(
            TodayLessonRow("L1", "把 sentences", "🧱", "New", inProgress = true),
            TodayLessonRow("L2", "有 vs 又", "👂", "Review"),
        ),
        lessonsDone = listOf(TodayLessonRow("L3", "Ordering at a café", "☕", "Done", done = true)),
        reader = TodayReaderRow(TodayReaderRow.State.TO_READ, "小明在巴黎", 6),
    )
    val cardsDone = midDay.copy(cardsDue = 0, cardsReviewed = 142)
    val someDone = midDay.copy(
        cardsDue = 0, cardsReviewed = 142,
        lessonsToDo = listOf(TodayLessonRow("L2", "有 vs 又", "👂", "Review")),
        lessonsDone = listOf(TodayLessonRow("L1", "把 sentences", "🧱", "Done", done = true), TodayLessonRow("L3", "Ordering at a café", "☕", "Done", done = true)),
    )
    val allDone = midDay.copy(
        cardsDue = 0, cardsReviewed = 142, lessonsToDo = emptyList(),
        lessonsDone = someDone.lessonsDone + TodayLessonRow("L2", "有 vs 又", "👂", "Done", done = true),
        reader = TodayReaderRow(TodayReaderRow.State.READ, "小明在巴黎"),
    )
    val pauseTitles = listOf("🧱 把 sentences", "👂 有 vs 又", "📖 小明在巴黎")
}
