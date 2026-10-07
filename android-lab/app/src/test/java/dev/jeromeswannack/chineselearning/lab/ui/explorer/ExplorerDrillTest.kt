package dev.jeromeswannack.chineselearning.lab.ui.explorer

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.core.explorer.Drill
import dev.jeromeswannack.chineselearning.lab.core.explorer.DrillKind
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerItem
import dev.jeromeswannack.chineselearning.lab.data.LabDatabase
import dev.jeromeswannack.chineselearning.lab.ui.chars.CHAR_SHEET_TAG
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * A quick drill in the real explorer sheet: Word view 银行 → 🎯 Quick drill → every question
 * answered (the listening one autoplays, Write it skipped) → the score screen → Keep exploring.
 * Practice only: the device's review events stay untouched; drill_start / drill_finish are tracked.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w412dp-h915dp-xxhdpi", application = android.app.Application::class)
class ExplorerDrillTest {
    @get:Rule val compose = createComposeRule()

    private lateinit var db: LabDatabase
    private val events = ArrayList<Pair<String, Map<String, Any?>>>()
    private val played = ArrayList<String>()
    private var rights = 0
    private var wrongs = 0
    private var celebrations = 0

    @Before fun setUp() {
        db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), LabDatabase::class.java).allowMainThreadQueries().build()
    }

    @After fun tearDown() = db.close()

    private fun env() = ExplorerSamples.env(
        // The explorer reads the learner's cards from the device database…
        myWord = { h -> db.dao().allNotes().firstOrNull { it.hanzi == h }; MyWord() },
        play = { played += it },
        drillFx = DrillFx(right = { rights++ }, wrong = { wrongs++ }, celebrate = { celebrations++ }),
    )

    @Test
    fun drillFromAWordViewToTheScoreWritesNoReviewEvents() {
        val controller = ExplorerController(track = { e, p -> events += e to p })
        compose.setContent {
            LabTheme { CompositionLocalProvider(LocalExplorer provides controller) { ExplorerHost(controller, env()) } }
        }
        compose.runOnIdle { controller.open(ExplorerSamples.item(), "reader") }
        compose.waitForIdle()

        compose.onNodeWithTag(EXPLORER_DRILL_START_TAG).performScrollTo().performClick()
        compose.waitForIdle()
        val run = controller.drill ?: error("no drill started")
        val questions = run.questions
        assertTrue(questions.size in Drill.MIN..Drill.MAX)
        assertEquals(DrillKind.WRITE, questions.last().kind)
        compose.onNodeWithTag(EXPLORER_DRILL_TAG).assertIsDisplayed()
        // The view's own footer actions are hidden while drilling.
        assertEquals(0, compose.onAllNodesWithTag("explorer-add").fetchSemanticsNodes().size)
        assertEquals(0, compose.onAllNodesWithTag("explorer-bump").fetchSemanticsNodes().size)

        var expectedCorrect = 0
        questions.forEachIndexed { i, q ->
            compose.onNodeWithText("🎯 ${i + 1} / ${questions.size}").assertIsDisplayed()
            if (q.kind == DrillKind.WRITE) {
                compose.onNodeWithTag(EXPLORER_DRILL_SKIP_TAG).performClick()
            } else {
                compose.onNodeWithTag(EXPLORER_DRILL_NEXT_TAG).assertIsNotEnabled()
                if (q.kind == DrillKind.LISTEN) assertTrue("the listening question autoplays", q.prompt in played)
                // The first question wrong, the rest right.
                val pick = if (i == 0) (q.answer + 1) % q.options.size else q.answer
                if (pick == q.answer) expectedCorrect++
                compose.onAllNodesWithTag(EXPLORER_DRILL_OPTION_TAG)[pick].performClick()
                compose.waitForIdle()
                if (!q.pinyin.isNullOrEmpty()) compose.onNodeWithText(q.pinyin!!).assertIsDisplayed()
            }
            compose.waitForIdle()
            compose.onNodeWithTag(EXPLORER_DRILL_NEXT_TAG).assertIsEnabled().performClick()
            compose.waitForIdle()
        }

        compose.onNodeWithTag(EXPLORER_DRILL_DONE_TAG).assertIsDisplayed()
        compose.onNodeWithText(Drill.scoreLine(expectedCorrect, questions.size)).assertIsDisplayed()
        compose.onNodeWithText("Practice only — your cards’ schedule isn’t touched.").assertIsDisplayed()
        assertEquals(1, wrongs)
        assertEquals(expectedCorrect, rights)
        assertEquals(if (expectedCorrect.toDouble() / questions.size >= 0.6) 1 else 0, celebrations)

        // Analytics: start + finish, ids / counts only.
        val start = events.single { it.first == "explorer.drill_start" }.second
        assertEquals(mapOf("kind" to "word", "items" to questions.size), start)
        val finish = events.single { it.first == "explorer.drill_finish" }.second
        assertEquals("word", finish["kind"])
        assertEquals(questions.size, finish["items"])
        assertEquals(expectedCorrect, finish["correct"])
        assertTrue((finish["duration_ms"] as Long) >= 0)

        // Practice only: no review event on the device.
        assertTrue(runBlocking { db.dao().allEvents() }.isEmpty())

        // Keep exploring → back to the Word view.
        compose.onNodeWithTag(EXPLORER_DRILL_EXIT_TAG).performClick()
        compose.waitForIdle()
        assertNull(controller.drill)
        compose.onNodeWithTag(EXPLORER_WORD_TAG).assertIsDisplayed()
    }

    @Test
    fun aCharacterViewDrillAndMovingInTheStackEndsIt() {
        val controller = ExplorerController(track = { e, p -> events += e to p })
        compose.setContent {
            LabTheme { CompositionLocalProvider(LocalExplorer provides controller) { ExplorerHost(controller, env()) } }
        }
        compose.runOnIdle {
            controller.open(ExplorerSamples.item(), "reader")
            controller.push(ExplorerItem.Char("银"))
        }
        compose.waitForIdle()
        compose.onNodeWithTag(CHAR_SHEET_TAG).assertIsDisplayed()
        compose.onNodeWithTag(EXPLORER_DRILL_START_TAG).performScrollTo().performClick()
        compose.waitForIdle()
        val run = controller.drill ?: error("no drill started")
        assertEquals("char", events.single { it.first == "explorer.drill_start" }.second["kind"])
        assertEquals(DrillKind.WRITE, run.questions.last().kind)
        assertEquals("银", run.questions.last().prompt)
        // ✍️ Write it (the view's footer) is hidden while drilling.
        assertEquals(0, compose.onAllNodesWithTag("explorer-write").fetchSemanticsNodes().size)

        // ← (moving in the stack) ends the drill.
        compose.onNodeWithTag(EXPLORER_BACK_TAG).performClick()
        compose.waitForIdle()
        assertNull(controller.drill)
        compose.onNodeWithTag(EXPLORER_WORD_TAG).assertIsDisplayed()
        assertTrue(events.none { it.first == "explorer.drill_finish" })
    }
}
