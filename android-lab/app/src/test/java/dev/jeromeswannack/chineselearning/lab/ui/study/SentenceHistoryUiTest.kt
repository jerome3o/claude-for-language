package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.mutableStateOf
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
 * this sentence" → a reason hides it (Undo), fresh sentences first with the buffer refilled quietly, "✨ New
 * sentences coming" only when the round is short, the answer side's list without the hidden ones and ⋯ → Show
 * hidden (N) → Show again; screenshots.
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

    private fun round(
        stats: Map<String, SentenceHistory.Stats>,
        onHide: (String, String) -> Unit = { _, _ -> },
        onWantMore: (String, Int) -> Unit = { _, _ -> },
        dark: Boolean = false,
        roundRows: List<SentenceRow> = rows,
    ) = roundWith(mutableStateOf(stats), onHide, onWantMore, dark, roundRows)

    private fun roundWith(
        stats: androidx.compose.runtime.State<Map<String, SentenceHistory.Stats>>,
        onHide: (String, String) -> Unit = { _, _ -> },
        onWantMore: (String, Int) -> Unit = { _, _ -> },
        dark: Boolean = false,
        roundRows: List<SentenceRow> = rows,
    ) {
        compose.setContent {
            LabTheme(dark = dark) {
                Box(Modifier.fillMaxSize().padding(12.dp)) {
                    SentenceRoundPage("银行", true, roundRows, previewSentencePractise(), null, { _, _ -> }, {}, {}, stats = stats.value, onWantMore = onWantMore, onHide = onHide)
                }
            }
        }
        compose.mainClock.advanceTimeBy(1_000)
    }

    @Test fun roundLeavesHiddenOutAndPrefersTheLeastKnown() {
        val wanted = mutableListOf<Pair<String, Int>>()
        // The clue was read right 3×; s3 is hidden → three left: s1 / s2, never practised, take the first
        // slots (s1 read, s2 translate); the clue, no longer fresh, is read last.
        round(mapOf("clue" to read(3), "s3" to hiddenS3), onWantMore = { r, n -> wanted += r to n })
        compose.onNodeWithText("我哥哥在银行工作了十年。", useUnmergedTree = true).assertDoesNotExist()
        assertEquals(1, count("${SentenceRoundTags.EXERCISE}-0-read-open"))
        assertEquals(1, count("${SentenceRoundTags.EXERCISE}-1-read-open"))
        assertEquals(1, count("${SentenceRoundTags.EXERCISE}-2-translate-open"))
        // Fewer than four left in rotation: more sentences asked for (two fresh → six, back to a buffer of eight).
        assertEquals(listOf("few" to 6), wanted)
        compose.onNodeWithTag(SentenceHideTags.COMING, useUnmergedTree = true).assertExists()
    }

    // Eight sentences: the card's own + seven in the set.
    private val many = listOf("我在银行工作。", "银行几点开门？", "这家银行很大。", "你去哪个银行？", "银行旁边有超市。", "我把钱存在银行。", "银行今天关门。")
        .mapIndexed { i, h -> SentenceEntity("m$i", "n1", i, h, null, "Sentence $i.", null, "core", null) }
    private fun used(mode: String) = if (mode == "read") read(1)
        else SentenceHistory.Stats(translate = SentenceHistory.ModeStats(1, 0, 1, "2026-11-01T08:00:00.000Z"))

    @Test fun asksOnlyFreshSentencesAndQuietlyRefillsTheBuffer() {
        val wanted = mutableListOf<Pair<String, Int>>()
        // The card's sentence was read, m0 translated (wrong), m1 read: five of the eight are fresh.
        round(mapOf("clue" to used("read"), "m0" to used("translate"), "m1" to used("read")), onWantMore = { r, n -> wanted += r to n }, roundRows = sentenceRows(note, many))
        for (old in listOf("我去银行取钱。", "I go to the bank to get money.", "我在银行工作。", "Sentence 0.", "银行几点开门？", "Sentence 1.")) {
            assertEquals(0, compose.onAllNodesWithText(old, substring = true, useUnmergedTree = true).fetchSemanticsNodes().size, old)
        }
        assertEquals(4, (0 until 8).sumOf { i -> listOf("read", "translate").sumOf { m -> count("${SentenceRoundTags.EXERCISE}-$i-$m-open") } })
        // Fewer than six fresh left: three more asked for, in the background — no note, this round is fine.
        assertEquals(listOf("fresh" to 3), wanted)
        assertEquals(0, count(SentenceHideTags.COMING))
    }

    @Test fun aTakeThatUsesUpTheBufferAsksAgainSilently() {
        val wanted = mutableListOf<Pair<String, Int>>()
        val stats = mutableStateOf(mapOf<String, SentenceHistory.Stats>("clue" to used("read")))
        // Seven fresh of eight: enough, nothing asked.
        roundWith(stats, onWantMore = { r, n -> wanted += r to n }, roundRows = sentenceRows(note, many))
        assertEquals(emptyList(), wanted)
        // Two takes later only five are fresh: the buffer is refilled at once, still without the note.
        compose.runOnIdle { stats.value = stats.value + mapOf("m0" to used("read"), "m1" to used("translate")) }
        compose.mainClock.advanceTimeBy(500)
        compose.waitForIdle()
        assertEquals(listOf("fresh" to 3), wanted)
        assertEquals(0, count(SentenceHideTags.COMING))
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
        round(mapOf("clue" to read(3), "s3" to hiddenS3))
        compose.onRoot().captureRoboImage("screenshots/sentence-history-01-coming.png")
    }

    @Test fun shotHideSheet() = shoot("sentence-history-02-hide-sheet") {
        Column(Modifier.padding(vertical = 24.dp)) {
            androidx.compose.material3.Text("🙈 ${SentenceHistory.HIDE_TITLE}", color = dev.jeromeswannack.chineselearning.lab.ui.theme.Lab.colors.ink, style = androidx.compose.material3.MaterialTheme.typography.titleLarge, modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp))
            SentenceHideBody("这家银行几点开门？", "What time does this bank open?", {}, {})
        }
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
