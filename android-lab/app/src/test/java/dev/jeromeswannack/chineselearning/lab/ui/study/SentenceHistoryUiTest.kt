package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import com.github.takahirom.roborazzi.captureRoboImage
import dev.jeromeswannack.chineselearning.lab.core.SentenceHistory
import dev.jeromeswannack.chineselearning.lab.data.SentenceEntity
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.testing.Samples
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Test
import kotlin.test.assertEquals

/**
 * Practice per example sentence in the Lab app (docs/STUDY_SESSION.md "Sentence practice history"; core
 * SentenceHistory): the round prefers what he knows least and leaves hidden sentences out, ⋯ → "Stop showing
 * this sentence" → a reason hides it (Undo), "✨ New sentences coming", the answer side's list without the
 * hidden ones and ⋯ → Show hidden (N) → Show again; screenshots.
 */
class SentenceHistoryUiTest : LabScreenshotTest() {
    private val note = Samples.note.copy(
        id = "n1", hanzi = "银行", pinyin = "yínháng", english = "bank",
        sentenceClue = "我去银行取钱。", sentenceCluePinyin = "Wǒ qù yínháng qǔ qián.", sentenceClueTranslation = "I go to the bank to get money.",
    )
    private val set = listOf(
        SentenceEntity("s1", "n1", 0, "银行在哪儿？", "Yínháng zài nǎr?", "Where is the bank?", null, "core", null),
        SentenceEntity("s2", "n1", 1, "这家银行几点开门？", "Zhè jiā yínháng jǐ diǎn kāimén?", "What time does this bank open?", null, "core", null),
        SentenceEntity("s3", "n1", 2, "我哥哥在银行工作了十年。", "Wǒ gēge zài yínháng gōngzuòle shí nián.", "My older brother has worked at a bank for ten years.", null, "complex", null),
    )
    private val rows get() = sentenceRows(note, set)

    private fun read(n: Int) = SentenceHistory.Stats(read = SentenceHistory.ModeStats(n, n, 0, "2026-10-20T08:00:00.000Z"))
    private val hiddenS3 = SentenceHistory.Stats(hidden = SentenceHistory.Hidden("2026-10-21T08:00:00.000Z", "too_rare"))

    private fun count(tag: String) = compose.onAllNodesWithTag(tag, useUnmergedTree = true).fetchSemanticsNodes().size

    private fun round(stats: Map<String, SentenceHistory.Stats>, coming: Boolean = false, onHide: (String, String) -> Unit = { _, _ -> }, onWantMore: (String) -> Unit = {}, dark: Boolean = false) {
        compose.setContent {
            LabTheme(dark = dark) {
                Box(Modifier.fillMaxSize().padding(12.dp)) {
                    SentenceRoundPage("银行", true, rows, previewSentencePractise(), null, { _, _ -> }, {}, {}, stats = stats, coming = coming, onWantMore = onWantMore, onHide = onHide)
                }
            }
        }
        compose.mainClock.advanceTimeBy(1_000)
    }

    @Test fun roundLeavesHiddenOutAndPrefersTheLeastKnown() {
        val wanted = mutableListOf<String>()
        // The clue was read right 3×; s3 is hidden → three left: s1 / s2 never read come first.
        round(mapOf("clue" to read(3), "s3" to hiddenS3), onWantMore = { wanted += it })
        compose.onNodeWithText("我哥哥在银行工作了十年。", useUnmergedTree = true).assertDoesNotExist()
        assertEquals(1, count("${SentenceRoundTags.EXERCISE}-0-translate-open"))
        assertEquals(1, count("${SentenceRoundTags.EXERCISE}-1-read-open"))
        // Fewer than four left in rotation: more sentences asked for.
        assertEquals(listOf("few"), wanted)
        compose.onNodeWithTag(SentenceHideTags.COMING, useUnmergedTree = true).assertExists()
    }

    @Test fun moreHidesWithAReason() {
        val hidden = mutableListOf<Pair<String, String>>()
        round(emptyMap(), onHide = { k, r -> hidden += k to r })
        compose.onAllNodesWithTag(SentenceRoundTags.MORE, useUnmergedTree = true)[0].performClick()
        compose.mainClock.advanceTimeBy(800)
        compose.onNodeWithTag("${SentenceHideTags.REASON}-weird", useUnmergedTree = true).performClick()
        compose.mainClock.advanceTimeBy(500)
        assertEquals(listOf(clueRowKey("n1") to "weird"), hidden)
        compose.onNodeWithTag(SentenceHideTags.UNDO, useUnmergedTree = true).assertExists()
    }

    private fun list(stats: Map<String, SentenceHistory.Stats>, onUnhide: (String) -> Unit = {}) {
        compose.setContent {
            LabTheme {
                Column(Modifier.padding(16.dp)) {
                    SentenceList(note, set, 1, true, null, SentenceActions(), { _, _ -> }, history = SentenceListHistory(stats, { _, _ -> }, onUnhide))
                }
            }
        }
        compose.mainClock.advanceTimeBy(1_000)
    }

    @Test fun listLeavesHiddenOutUntilShowHidden() {
        val unhidden = mutableListOf<String>()
        list(mapOf("s3" to hiddenS3), onUnhide = { unhidden += it })
        assertEquals(3, compose.onAllNodesWithTag(SENTENCE_ROW_TAG).fetchSemanticsNodes().size)
        compose.onNodeWithText("⋯").performClick()
        compose.mainClock.advanceTimeBy(500)
        compose.onNodeWithText(SentenceHistory.showHiddenLabel(1)).performClick()
        compose.mainClock.advanceTimeBy(500)
        compose.onNodeWithTag(SentenceHideTags.UNHIDE, useUnmergedTree = true).performClick()
        assertEquals(listOf("s3"), unhidden)
    }

    // ---- screenshots

    @Test fun shotComing() {
        round(mapOf("clue" to read(3), "s3" to hiddenS3), coming = true)
        compose.onRoot().captureRoboImage("screenshots/sentence-history-01-coming.png")
    }

    @Test fun shotHideSheet() {
        round(emptyMap())
        compose.onAllNodesWithTag(SentenceRoundTags.MORE, useUnmergedTree = true)[1].performClick()
        compose.mainClock.advanceTimeBy(1_000)
        compose.onRoot().captureRoboImage("screenshots/sentence-history-02-hide-sheet.png")
    }

    @Test fun shotShowHidden() {
        list(mapOf("s3" to hiddenS3))
        compose.onNodeWithText("⋯").performClick()
        compose.mainClock.advanceTimeBy(500)
        compose.onNodeWithText(SentenceHistory.showHiddenLabel(1)).performClick()
        compose.mainClock.advanceTimeBy(800)
        compose.onRoot().captureRoboImage("screenshots/sentence-history-03-show-hidden.png")
    }
}
