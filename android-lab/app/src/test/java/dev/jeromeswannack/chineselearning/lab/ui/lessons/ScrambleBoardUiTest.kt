package dev.jeromeswannack.chineselearning.lab.ui.lessons

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.filterToOne
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.unit.dp
import com.github.takahirom.roborazzi.captureRoboImage
import dev.jeromeswannack.chineselearning.lab.core.ExerciseAnswer
import dev.jeromeswannack.chineselearning.lab.core.ScrambleExercise
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Test
import kotlin.random.Random
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Word order rearranged by hand (core ScrambleOrder; Jerome: "it would be nice if I could click and drag and rearrange
 * stuff so that the order that I click them in isn't final"): tiles tapped in → one dragged to a new place (the gap
 * and the copy under the finger mid-drag) → a pool tile dragged in → a placed tile dragged out → Move left (a11y) →
 * Check grades the final order. Dark, phone size — the screenshots in the PR.
 */
class ScrambleBoardUiTest : LabScreenshotTest() {
    // Jerome's exercise: 他离开了工作了十五年的公司。
    private val company = ScrambleExercise(
        "He left the company he had worked at for fifteen years.",
        listOf("他", "工作了", "的", "十五年", "公司", "离开了"),
        listOf("他", "离开了", "工作了", "十五年", "的", "公司"),
    )

    private fun placedOrder(): List<String> =
        // By where they are on screen (lines top to bottom, left to right), not the tree's order.
        compose.onAllNodesWithTag(ScrambleTags.PLACED).fetchSemanticsNodes()
            .sortedWith(compareBy({ Math.round(it.boundsInRoot.top / 20f) }, { it.boundsInRoot.left }))
            .map { n -> n.config[SemanticsProperties.Text].joinToString("") { it.text } }

    private fun placed(text: String): SemanticsNodeInteraction = compose.onAllNodesWithTag(ScrambleTags.PLACED).filterToOne(hasText(text))
    private fun pool(text: String): SemanticsNodeInteraction = compose.onAllNodesWithTag(ScrambleTags.POOL_TILE).filterToOne(hasText(text))
    private fun SemanticsNodeInteraction.centre(): Offset = fetchSemanticsNode().boundsInRoot.center
    private fun SemanticsNodeInteraction.leftEdge(): Offset = fetchSemanticsNode().boundsInRoot.let { Offset(it.left + 10f, it.center.y) }

    /** Runs the tile's TalkBack custom action ("Move left" / "Move right"). */
    private fun SemanticsNodeInteraction.a11yAction(label: String) {
        val action = fetchSemanticsNode().config[SemanticsActions.CustomActions].first { it.label == label }
        val ok = compose.runOnIdle { action.action() }
        assertTrue(ok)
    }

    private fun shot(name: String) = compose.onRoot().captureRoboImage("screenshots/$name.png")

    /** A finger drag from [from] to [to] in small steps; [mid] runs before the finger lifts. */
    private fun drag(from: Offset, to: Offset, mid: () -> Unit = {}) {
        compose.onRoot().performTouchInput {
            down(from)
            for (k in 1..12) moveTo(from + (to - from) * (k / 12f))
        }
        compose.mainClock.advanceTimeBy(300)
        mid()
        compose.onRoot().performTouchInput { up() }
        compose.mainClock.advanceTimeBy(400)
    }

    @Test
    fun dragToRearrangeDragInDragOutAndMoveLeft() {
        var result: Pair<Boolean?, ExerciseAnswer?>? = null
        compose.setContent {
            LabTheme(dark = true) {
                Column(Modifier.fillMaxSize().background(Lab.colors.background).padding(16.dp)) {
                    ExerciseView(company, ExerciseEnv(random = Random(7)), null) { c, a, _ -> result = c to a }
                }
            }
        }
        compose.mainClock.advanceTimeBy(500)
        for (t in listOf("他", "工作了", "十五年", "的", "公司")) {
            pool(t).performClick()
            compose.mainClock.advanceTimeBy(200)
        }
        assertEquals(listOf("他", "工作了", "十五年", "的", "公司"), placedOrder())
        shot("lesson-scramble-drag-01-placed")

        // Drag 离开了 IN from the pool, to just before 工作了 — mid-drag: the copy and the gap.
        drag(pool("离开了").centre(), placed("工作了").leftEdge()) {
            assertEquals(1, compose.onAllNodesWithTag(ScrambleTags.GAP).fetchSemanticsNodes().size)
            assertTrue(compose.onAllNodesWithTag(ScrambleTags.FLOATING, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty())
            shot("lesson-scramble-drag-02-mid-drag")
        }
        assertEquals(0, compose.onAllNodesWithTag(ScrambleTags.GAP).fetchSemanticsNodes().size)
        assertEquals(listOf("他", "离开了", "工作了", "十五年", "的", "公司"), placedOrder())
        shot("lesson-scramble-drag-03-dropped")

        // Drag 的 out to the pool; drag 公司 to before 十五年 (a move inside the answer).
        drag(placed("的").centre(), compose.onAllNodesWithTag(ScrambleTags.POOL).onFirst().centre())
        assertEquals(listOf("他", "离开了", "工作了", "十五年", "公司"), placedOrder())
        drag(placed("公司").centre(), placed("十五年").leftEdge())
        assertEquals(listOf("他", "离开了", "工作了", "公司", "十五年"), placedOrder())

        // A plain tap still places at the end; Move left (the a11y action) moves one place.
        pool("的").performClick()
        compose.mainClock.advanceTimeBy(200)
        assertEquals(listOf("他", "离开了", "工作了", "公司", "十五年", "的"), placedOrder())
        placed("公司").a11yAction("Move right")
        compose.mainClock.advanceTimeBy(200)
        assertEquals(listOf("他", "离开了", "工作了", "十五年", "公司", "的"), placedOrder())
        placed("的").a11yAction("Move left")
        compose.mainClock.advanceTimeBy(200)
        assertEquals(company.correctOrder, placedOrder())
        assertTrue(compose.onAllNodes(hasTestTag(ScrambleTags.PLACED) and hasText("的")).fetchSemanticsNodes().isNotEmpty())

        // A tap on a placed tile still takes it out.
        placed("他").performClick()
        compose.mainClock.advanceTimeBy(200)
        assertEquals(listOf("离开了", "工作了", "十五年", "的", "公司"), placedOrder())
        drag(pool("他").centre(), placed("离开了").leftEdge())
        assertEquals(company.correctOrder, placedOrder())

        // Check grades the final order.
        compose.onAllNodesWithText("Check").onFirst().performClick()
        compose.mainClock.advanceTimeBy(800)
        compose.onAllNodesWithText("Continue").onFirst().performClick()
        compose.mainClock.advanceTimeBy(300)
        assertEquals(true, result?.first)
        assertEquals(company.correctOrder, result?.second?.order)
    }
}
