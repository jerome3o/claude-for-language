package dev.jeromeswannack.chineselearning.lab.ui.clips

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.click
import androidx.compose.ui.test.doubleClick
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import dev.jeromeswannack.chineselearning.lab.core.clips.ClipRecord
import dev.jeromeswannack.chineselearning.lab.core.clips.ClipSpec
import dev.jeromeswannack.chineselearning.lab.core.clips.ClipStyle
import dev.jeromeswannack.chineselearning.lab.core.clips.ClipScene
import dev.jeromeswannack.chineselearning.lab.core.clips.ClipTitleBody
import dev.jeromeswannack.chineselearning.lab.core.clips.ClipWord
import dev.jeromeswannack.chineselearning.lab.data.clips.ClipStore
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.assertEquals

/** 🎬 The player's gestures and rail: tap pauses, double tap = ❤️ + like + Learn more, the rail calls back. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w412dp-h915dp-xxhdpi", application = android.app.Application::class)
class ClipsGestureTest {
    @get:Rule val compose = createComposeRule()

    private val spec = ClipSpec(
        title = "Test clip", hook = "Hook", style = ClipStyle("neon"),
        words = listOf(ClipWord("刚才", "gāngcái", "just now")),
        scenes = List(4) { ClipScene("title", 5000, title = ClipTitleBody(headline_en = "Scene $it")) },
    )
    private val clip = ClipRecord(id = "c1", status = "ready", spec = spec)

    @Test
    fun gesturesAndRail() {
        val likes = mutableListOf<String>()
        val learn = mutableListOf<String>()
        val prefs = mutableListOf<String>()
        compose.setContent {
            LabTheme {
                ClipPlayer(
                    clip, active = true, prefs = ClipStore.CaptionPrefs(),
                    actions = ClipPlayerActions(onLike = { likes += it }, onLearnMore = { learn += it }, onPrefs = { _, t -> prefs += t }),
                    animate = false, clock = false,
                )
            }
        }
        compose.mainClock.advanceTimeBy(500)
        compose.onNodeWithTag("clip-player").performTouchInput { click(Offset(60f * density, 640f * density)) }
        compose.mainClock.advanceTimeBy(500)
        compose.onNodeWithContentDescription("Paused").assertExists()
        compose.onNodeWithTag("clip-player").performTouchInput { doubleClick(Offset(60f * density, 640f * density)) }
        compose.mainClock.advanceTimeBy(100)
        assertEquals(1, compose.onAllNodesWithTag("clip-heart", useUnmergedTree = true).fetchSemanticsNodes().size)
        assertEquals(listOf("double_tap"), likes)
        compose.mainClock.advanceTimeBy(700)
        assertEquals(listOf("double_tap"), learn)
        compose.onNodeWithTag("clip-like").performClick()
        compose.onNodeWithTag("clip-toggle-mute").performClick()
        compose.onNodeWithTag("clip-learn-more").performClick()
        assertEquals(listOf("double_tap", "button"), likes)
        assertEquals(listOf("mute"), prefs)
        assertEquals(listOf("double_tap", "button"), learn)
    }

    @Test
    fun doubleTapInsideTheFeed() {
        val likes = mutableListOf<String>()
        compose.setContent {
            LabTheme {
                ClipsScreen(
                    ClipsUi(clips = listOf(clip, clip.copy(id = "c2")), startId = "c1"),
                    ClipsActions(player = { ClipPlayerActions(onLike = { v -> likes += v }) }),
                    animate = true, clock = false,
                )
            }
        }
        compose.mainClock.advanceTimeBy(1500)
        compose.onAllNodesWithTag("clip-player")[0].performTouchInput { doubleClick(Offset(80f * density, 640f * density)) }
        compose.mainClock.advanceTimeBy(200)
        assertEquals(listOf("double_tap"), likes)
        assertEquals(1, compose.onAllNodesWithTag("clip-heart", useUnmergedTree = true).fetchSemanticsNodes().size)
    }
}
