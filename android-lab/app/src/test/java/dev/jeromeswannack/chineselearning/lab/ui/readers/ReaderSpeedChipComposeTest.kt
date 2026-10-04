package dev.jeromeswannack.chineselearning.lab.ui.readers

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertContentDescriptionEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import dev.jeromeswannack.chineselearning.lab.core.ReaderSpeed
import dev.jeromeswannack.chineselearning.lab.data.api.GradedReaderDto
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderPageDto
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.assertEquals

/** The reading page's speed chip: each tap moves 1× → 0.75× → 0.5× → 1× and says so. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class, qualifiers = "w412dp-h915dp-xxhdpi")
class ReaderSpeedChipComposeTest {
    @get:Rule val compose = createComposeRule()

    private val page = ReaderPageDto("p1", 1, "早上好。", "Zǎoshang hǎo.", "Good morning.", null, null)
    private val reader = GradedReaderDto("r1", "早上", "Morning", "beginner", null, emptyList(), "ready", null, "2026-09-25T09:47:33Z", listOf(page))

    @Test
    fun tappingTheChipCyclesTheSpeed() {
        val seen = mutableListOf<Double>()
        // Manual clock, like ReaderWordsComposeTest: the reader page has running animations
        compose.mainClock.autoAdvance = false
        compose.setContent {
            var speed by remember { mutableDoubleStateOf(1.0) }
            LabTheme {
                ReaderScreen(
                    reader, null,
                    ReaderEnv(speed = speed, onSpeed = { speed = ReaderSpeed.next(speed); seen += speed }),
                    onBack = {}, onEdit = {}, onFinish = {},
                )
            }
        }
        compose.mainClock.advanceTimeBy(2_000)
        val chip = compose.onNodeWithTag("reader-speed-chip")
        chip.assertContentDescriptionEquals("Playback speed 1× — tap for 0.75×")
        tap(chip)
        chip.assertContentDescriptionEquals("Playback speed 0.75× — tap for 0.5×")
        tap(chip)
        tap(chip)
        assertEquals(listOf(0.75, 0.5, 1.0), seen)
    }

    private fun tap(node: androidx.compose.ui.test.SemanticsNodeInteraction) {
        node.performClick()
        compose.mainClock.advanceTimeBy(1_000)
    }
}
