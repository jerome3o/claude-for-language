package dev.jeromeswannack.chineselearning.lab.ui.cardcontrols

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.jeromeswannack.chineselearning.lab.core.Leech
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Leeches + "Forget this card" (docs/STUDY_SESSION.md): the Forget sheet shows the warning BEFORE
 * anything happens and forgets this card or the whole word; the leech pill is an icon AND words, only
 * from 8 lapses; the leech sheet offers its actions.
 */
class ForgetLeechUiTest : LabScreenshotTest() {
    private val types = listOf("hanzi_to_meaning", "meaning_to_hanzi", "audio_to_hanzi")

    @Test fun forgetSheetWarnsFirstAndForgetsTheCardOrTheWord() {
        val applied = mutableListOf<Boolean>()
        compose.setContent { LabTheme { ForgetSheet("银行", "hanzi_to_meaning", types, onApply = { applied += it }, onDismiss = {}) } }
        compose.onNodeWithText(Leech.FORGET_WARNING, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("↺ Forget card", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithTag("forget-scope-word").performClick()
        compose.onNodeWithText("↺ Forget 3 cards", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(Leech.forgetWarning(3), useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithTag("forget-confirm").performClick()
        assertEquals(listOf(true), applied)
    }

    @Test fun leechPillOnlyFromEightLapsesWithIconAndWords() {
        compose.setContent { LabTheme { androidx.compose.foundation.layout.Column { LeechPill(7, onOpen = {}); LeechPill(8, onOpen = {}) } } }
        assertEquals(1, compose.onAllNodes(hasTestTag("leech-pill")).fetchSemanticsNodes().size)
        compose.onNodeWithText("⚠️ Missed 8×", useUnmergedTree = true).assertIsDisplayed()
    }

    @Test fun leechSheetShowsHowItWentAndWhatHelps() {
        var forgot = false
        val info = Leech.Info(9, true, listOf("2026-10-20T08:00:00.000Z"), 30, listOf(Leech.Recent("2026-10-20T08:00:00.000Z", 0, true)), null)
        compose.setContent { LabTheme { LeechSheet(9, load = { info }, actions = LeechSheetActions(onEdit = {}, onMemoryHook = {}, onForget = { forgot = true }), onDismiss = {}) } }
        compose.mainClock.advanceTimeBy(500)
        compose.onNodeWithText("⚠️ " + Leech.headline(9), useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("✗ Again — missed", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithTag("leech-hook").assertIsDisplayed()
        assertEquals(0, compose.onAllNodes(hasTestTag("leech-suspend")).fetchSemanticsNodes().size)
        compose.onNodeWithTag("leech-forget").performClick()
        assertEquals(true, forgot)
    }
}
