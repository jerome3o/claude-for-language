package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The "You said" box's three verdicts never rely on colour alone (Jerome is red / green colour-blind):
 * each has its own tag, icon and words — ✓ Match, ≈ Contains the answer (yellow), ✕ Didn't match — and
 * the typing card's "Close — the tones are off" is the same yellow with ≈. Screenshots:
 * YouSaidBoxScreenshots (study-yousaid-*).
 */
class YouSaidBoxUiTest : LabScreenshotTest() {
    private fun count(tag: String) =
        compose.onAllNodes(hasTestTag(tag), useUnmergedTree = true).fetchSemanticsNodes().size

    private fun box(said: String, answer: String, dark: Boolean) {
        compose.setContent { LabTheme(dark = dark) { YouSaidBox(Transcription.compare(said, answer), onCoach = {}, onPlay = {}) } }
        compose.mainClock.advanceTimeBy(500)
    }

    private fun assertState(state: String, icon: String, words: String) {
        compose.onNodeWithTag("$YOU_SAID_TAG-$state", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithTag("$YOU_SAID_VERDICT_TAG-$icon", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(words, useUnmergedTree = true).assertIsDisplayed()
        listOf("check", "approx", "close").filter { it != icon }.forEach { assertEquals(0, count("$YOU_SAID_VERDICT_TAG-$it")) }
    }

    @Test fun matchIsACheck() { box("救", "救", dark = false); assertState("match", "check", "Match") }

    @Test fun jeromesSentenceIsTheYellowContainsWithApprox() {
        box("一生救了他的命", "救", dark = false)
        assertState("contains", "approx", "Contains the answer")
        assertEquals(1, count(YOU_SAID_COACH_TAG))
    }

    @Test fun containsInTheDarkThemeToo() { box("一生救了他的命", "救", dark = true); assertState("contains", "approx", "Contains the answer") }

    @Test fun missIsAnX() { box("已经", "救", dark = false); assertState("miss", "close", "Didn’t match") }

    @Test fun iconsAndWordsDifferPerState() {
        val states = listOf("match", "contains", "miss")
        assertEquals(3, states.map { youSaidVerdictIcon(it) }.toSet().size)
        assertEquals(3, states.map { youSaidVerdictLabel(it) }.toSet().size)
    }

    @Test fun closeIsAYellowRowWithTheApproxIcon() {
        compose.setContent { LabTheme { SpokenResultRow("朗", "狼", dev.jeromeswannack.chineselearning.lab.core.AnswerKey.Verdict.CLOSE, onPlay = {}, onCoach = {}) } }
        compose.onNodeWithTag("$SPOKEN_RESULT_TAG-close", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("Close — tones off", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithTag("$YOU_SAID_VERDICT_TAG-approx", useUnmergedTree = true).assertIsDisplayed()
    }
}
