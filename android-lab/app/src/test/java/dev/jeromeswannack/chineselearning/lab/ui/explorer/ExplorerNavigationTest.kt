package dev.jeromeswannack.chineselearning.lab.ui.explorer

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import org.robolectric.shadows.ShadowDialog
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerItem
import dev.jeromeswannack.chineselearning.lab.ui.chars.CHAR_SHEET_TAG
import dev.jeromeswannack.chineselearning.lab.ui.chars.CHAR_WORD_ROW_TAG
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The explorer's stack in the real sheet (ExplorerHost): open a Character view → tap a word of
 * "Words with 银" → the Word view → tap one of its characters → another Character view; Android
 * back pops view by view and closes on the first one. Every step records its analytics event.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w412dp-h915dp-xxhdpi", application = android.app.Application::class)
class ExplorerNavigationTest {
    @get:Rule val compose = createComposeRule()

    private val events = ArrayList<Pair<String, Map<String, Any?>>>()

    /** Android back in the sheet's window (the dialog's own back dispatcher, like a real back gesture). */
    private fun back() {
        compose.runOnIdle {
            val dialog = ShadowDialog.getLatestDialog() as androidx.activity.ComponentDialog
            dialog.onBackPressedDispatcher.onBackPressed()
        }
    }

    private fun labels(c: ExplorerController) = c.stack.map { if (it is ExplorerItem.Char) it.char else (it as ExplorerItem.Word).hanzi }

    @Test
    fun charToWordToCharThenBackClosesTheSheet() {
        val controller = ExplorerController(track = { e, p -> events += e to p })
        compose.setContent {
            LabTheme {
                CompositionLocalProvider(LocalExplorer provides controller) {
                    ExplorerHost(controller, ExplorerSamples.env())
                }
            }
        }
        compose.runOnIdle { controller.open(ExplorerItem.Char("银"), "study", context = "银行") }
        compose.waitForIdle()
        compose.onNodeWithTag(CHAR_SHEET_TAG).assertIsDisplayed()

        // "Words with 银" → 银行 (the first row) → the Word view.
        compose.onAllNodesWithTag(CHAR_WORD_ROW_TAG)[0].performScrollTo().performClick()
        compose.waitForIdle()
        assertEquals(listOf("银", "银行"), labels(controller))
        compose.onNodeWithTag(EXPLORER_WORD_TAG).assertIsDisplayed()
        compose.onNodeWithTag(EXPLORER_BACK_TAG).assertIsDisplayed()

        // 行 (its second character chip) → another Character view.
        compose.onAllNodesWithTag(EXPLORER_WORD_CHAR_TAG)[1].performScrollTo().performClick()
        compose.waitForIdle()
        assertEquals(listOf("银", "银行", "行"), labels(controller))
        compose.onNodeWithTag(CHAR_SHEET_TAG).assertIsDisplayed()
        assertEquals(3, compose.onAllNodesWithTag(EXPLORER_CRUMB_TAG).fetchSemanticsNodes().size)

        // Back twice: 行 → 银行 → 银.
        back()
        compose.waitForIdle()
        assertEquals(listOf("银", "银行"), labels(controller))
        compose.onNodeWithTag(EXPLORER_WORD_TAG).assertIsDisplayed()
        back()
        compose.waitForIdle()
        assertEquals(listOf("银"), labels(controller))

        // Back on the first view closes the explorer.
        back()
        compose.waitForIdle()
        assertTrue(controller.stack.isEmpty())
        assertEquals(0, compose.onAllNodesWithTag(EXPLORER_SHEET_TAG).fetchSemanticsNodes().size)

        val names = events.map { it.first }
        assertEquals(listOf("explorer.open", "explorer.push", "explorer.push"), names.filter { it.startsWith("explorer.") })
        assertEquals(mapOf("source" to "study", "kind" to "char"), events.first { it.first == "explorer.open" }.second)
        assertEquals(mapOf("kind" to "word", "from" to "char", "depth" to 2), events.first { it.first == "explorer.push" }.second)
    }

    @Test
    fun breadcrumbAndPushingAViewInTheTrailGoBack() {
        val controller = ExplorerController()
        compose.setContent {
            LabTheme {
                CompositionLocalProvider(LocalExplorer provides controller) { ExplorerHost(controller, ExplorerSamples.env()) }
            }
        }
        compose.runOnIdle {
            controller.open(ExplorerSamples.item(), "reader")
            controller.push(ExplorerItem.Char("银"))
            controller.push(ExplorerItem.Word("银子"))
        }
        compose.waitForIdle()
        // The first crumb (银行) goes straight back.
        compose.onAllNodesWithTag(EXPLORER_CRUMB_TAG)[0].performClick()
        compose.waitForIdle()
        assertEquals(listOf("银行"), labels(controller))
        // Tapping 银 then the word view again (already in the trail) does not loop.
        compose.runOnIdle { controller.push(ExplorerItem.Char("银")); controller.push(ExplorerItem.Word("银行", gloss = "bank")) }
        assertEquals(listOf("银行"), labels(controller))
        // ✕ closes.
        compose.onNodeWithTag(EXPLORER_CLOSE_TAG).performClick()
        compose.waitForIdle()
        assertTrue(controller.stack.isEmpty())
    }
}
