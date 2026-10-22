package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.jeromeswannack.chineselearning.lab.core.AnswerKey
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The spoken answer's ONE compact "You said" row (SpokenResultRow; the web's `YouSaidRow`): per state
 * its tag, chip words + icon, ▶ / ✎ and the one sentence a screen reader hears.
 */
class SpokenResultRowTest : LabScreenshotTest() {
    private fun count(tag: String) = compose.onAllNodes(hasTestTag(tag), useUnmergedTree = true).fetchSemanticsNodes().size

    private fun row(transcript: String, correct: String, verdict: AnswerKey.Verdict, calls: MutableList<String> = mutableListOf()) {
        compose.setContent { LabTheme { SpokenResultRow(transcript, correct, verdict, onPlay = { calls += "play" }, onCoach = { calls += "coach" }) } }
    }

    @Test fun exactIsAMatchWithPlayAndNoCoach() {
        val calls = mutableListOf<String>()
        row("狼", "狼", AnswerKey.Verdict.EXACT, calls)
        compose.onNodeWithTag("$SPOKEN_RESULT_TAG-match", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("Match", useUnmergedTree = true).assertIsDisplayed()
        assertEquals(1, count("$YOU_SAID_VERDICT_TAG-check"))
        assertEquals(0, count(YOU_SAID_COACH_TAG))
        compose.onNodeWithTag(YOU_SAID_PLAY_TAG, useUnmergedTree = true).performClick()
        assertEquals(listOf("play"), calls)
        compose.onNodeWithContentDescription("You said 狼 (láng). Match.").assertExists()
    }

    @Test fun soundIsStillATick() {
        row("友", "有", AnswerKey.Verdict.SOUND)
        compose.onNodeWithTag("$SPOKEN_RESULT_TAG-sound", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("Sounded right — written differently", useUnmergedTree = true).assertIsDisplayed()
        assertEquals(1, count("$YOU_SAID_VERDICT_TAG-check"))
        compose.onNodeWithContentDescription("You said 友 (yǒu). Sounded right — written differently (友); the card writes 有.").assertExists()
    }

    @Test fun closeIsJeromesWolf() {
        val calls = mutableListOf<String>()
        row("朗", "狼", AnswerKey.Verdict.CLOSE, calls)
        compose.onNodeWithTag("$SPOKEN_RESULT_TAG-close", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("Close — tones off", useUnmergedTree = true).assertIsDisplayed()
        assertEquals(1, count("$YOU_SAID_VERDICT_TAG-approx"))
        compose.onNodeWithTag(SPOKEN_RESULT_HANZI_TAG, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("You said 朗 (lǎng). Close — the tones are off. Not in the answer: 朗.").assertExists()
        compose.onNodeWithTag(YOU_SAID_COACH_TAG, useUnmergedTree = true).performClick()
        assertEquals(listOf("coach"), calls)
    }

    @Test fun wrongSaysDidntMatch() {
        row("猫", "狼", AnswerKey.Verdict.WRONG)
        compose.onNodeWithTag("$SPOKEN_RESULT_TAG-wrong", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("Didn’t match", useUnmergedTree = true).assertIsDisplayed()
        assertEquals(1, count("$YOU_SAID_VERDICT_TAG-close"))
    }

    @Test fun containsIsYellowApprox() {
        row("他长得很好", "长得", AnswerKey.Verdict.CONTAINS)
        compose.onNodeWithTag("$SPOKEN_RESULT_TAG-contains", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("Contains the answer", useUnmergedTree = true).assertIsDisplayed()
        assertEquals(1, count("$YOU_SAID_VERDICT_TAG-approx"))
        assertEquals(1, count(YOU_SAID_COACH_TAG))
    }
}
