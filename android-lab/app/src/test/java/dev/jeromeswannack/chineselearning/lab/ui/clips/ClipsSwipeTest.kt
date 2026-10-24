package dev.jeromeswannack.chineselearning.lab.ui.clips

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeUp
import androidx.compose.ui.test.swipeDown
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

/** 🎬 A normal flick on the feed goes to the next / previous clip (the bug Jerome hit on his Fold). */
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
