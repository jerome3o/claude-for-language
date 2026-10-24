package dev.jeromeswannack.chineselearning.lab.ui.clips

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeUp
import androidx.compose.ui.test.swipeDown
import dev.jeromeswannack.chineselearning.lab.core.clips.ClipOrderBody
import dev.jeromeswannack.chineselearning.lab.core.clips.ClipQuizBody
import dev.jeromeswannack.chineselearning.lab.core.clips.ClipRecord
import dev.jeromeswannack.chineselearning.lab.core.clips.ClipScene
import dev.jeromeswannack.chineselearning.lab.core.clips.ClipSentenceBody
import dev.jeromeswannack.chineselearning.lab.core.clips.ClipSpec
import dev.jeromeswannack.chineselearning.lab.core.clips.ClipStyle
import dev.jeromeswannack.chineselearning.lab.core.clips.ClipTitleBody
import dev.jeromeswannack.chineselearning.lab.core.clips.ClipWord
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.assertEquals

/**
 * 🎬 A normal flick on the feed goes to the next / previous clip — the bug Jerome hit on his Fold: the
 * stage had a verticalScroll inside the VerticalPager, which took the drag (this test failed then).
 * Also over an interactive scene (quiz options, order tiles), and the rail's ⌄ Next.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w412dp-h915dp-xxhdpi", application = android.app.Application::class)
class ClipsSwipeTest {
    @get:Rule val compose = createComposeRule()

    private fun clip(id: String) = ClipRecord(
        id = id, status = "ready",
        spec = ClipSpec(
            title = "Clip $id", hook = "Hook", style = ClipStyle("neon"),
            words = listOf(ClipWord("刚才", "gāngcái", "just now")),
            scenes = listOf(
                ClipScene("sentence", 5000, sentence = ClipSentenceBody("我刚才吃了饭。", "Wǒ gāngcái chīle fàn.", "I ate a moment ago.")),
            ) + List(3) { ClipScene("title", 5000, title = ClipTitleBody(headline_en = "Scene $it")) },
        ),
    )

    private fun interactive(id: String) = ClipRecord(
        id = id, status = "ready",
        spec = ClipSpec(
            title = "Clip $id", hook = "Hook", style = ClipStyle("comic"),
            words = listOf(ClipWord("顺便", "shùnbiàn", "while you're at it")),
            scenes = listOf(
                ClipScene("quiz", 8000, quiz = ClipQuizBody(prompt_en = "Which one?", options = listOf("顺便", "随便", "方便"), answer_index = 0)),
                ClipScene("order", 7000, order = ClipOrderBody(listOf("我", "下班", "顺便", "去", "银行"), "Wǒ xiàbān shùnbiàn qù yínháng.", "After work I'll go by the bank.")),
            ) + List(2) { ClipScene("title", 5000, title = ClipTitleBody(headline_en = "Scene $it")) },
        ),
    )

    @Test
    fun flickOverInteractiveScenesAndTheNextButton() {
        val active = mutableListOf<Int>()
        compose.setContent {
            LabTheme {
                ClipsScreen(
                    ClipsUi(clips = listOf(interactive("q"), interactive("o"), clip("c")), startId = "o", startScene = 1),
                    ClipsActions(onActive = { active += it }),
                    animate = false, clock = true,
                )
            }
        }
        compose.mainClock.advanceTimeBy(800)
        // The order clip waits on its tiles: a flick down that starts on them goes back.
        compose.onNodeWithTag("clips-feed").performTouchInput { swipeDown(startY = centerY - 100f, endY = centerY + 400f, durationMillis = 180) }
        compose.mainClock.advanceTimeBy(2000)
        assertEquals(0, active.last(), "flick down from the order clip: $active")
        // Now the quiz clip waits for an answer: a flick up that starts on its options goes on.
        compose.onNodeWithTag("clips-feed").performTouchInput { swipeUp(startY = centerY + 150f, endY = centerY - 350f, durationMillis = 180) }
        compose.mainClock.advanceTimeBy(2000)
        assertEquals(1, active.last(), "flick up over the quiz options: $active")
        // The rail's ⌄ Next.
        compose.onAllNodesWithTag("clip-next")[0].performClick()
        compose.mainClock.advanceTimeBy(2000)
        assertEquals(2, active.last(), "⌄ Next: $active")
    }

    @Test
    fun slowShortSwipeStillPages() {
        val active = mutableListOf<Int>()
        compose.setContent { LabTheme { ClipsScreen(ClipsUi(clips = listOf(clip("a"), clip("b"))), ClipsActions(onActive = { active += it }), animate = false, clock = false) } }
        compose.mainClock.advanceTimeBy(500)
        // A third of the screen, slowly (no fling): past the quarter-page threshold.
        compose.onNodeWithTag("clips-feed").performTouchInput { swipeUp(startY = centerY + 150f, endY = centerY + 150f - height / 3f, durationMillis = 900) }
        compose.mainClock.advanceTimeBy(2000)
        assertEquals(1, active.last(), "slow swipe: $active")
    }

    @Test
    fun flickUpAndDown() {
        val active = mutableListOf<Int>()
        compose.setContent {
            LabTheme {
                ClipsScreen(
                    ClipsUi(clips = listOf(clip("a"), clip("b"), clip("c"))),
                    ClipsActions(onActive = { active += it }),
                    animate = false, clock = true,
                )
            }
        }
        compose.mainClock.advanceTimeBy(800)
        compose.onNodeWithTag("clips-feed").performTouchInput { swipeUp(startY = centerY + 200f, endY = centerY - 300f, durationMillis = 180) }
        compose.mainClock.advanceTimeBy(2000)
        assertEquals(1, active.last(), "after a flick up: $active")
        compose.onNodeWithTag("clips-feed").performTouchInput { swipeDown(startY = centerY - 300f, endY = centerY + 200f, durationMillis = 180) }
        compose.mainClock.advanceTimeBy(2000)
        assertEquals(0, active.last(), "after a flick down: $active")
    }
}
