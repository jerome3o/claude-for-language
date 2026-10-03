package dev.jeromeswannack.chineselearning.lab.ui.checks

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.CheckEstimate
import dev.jeromeswannack.chineselearning.lab.core.CardCheck
import dev.jeromeswannack.chineselearning.lab.core.DeckCheckProposal
import dev.jeromeswannack.chineselearning.lab.core.ImportPlanner
import dev.jeromeswannack.chineselearning.lab.core.NoteCheckIssue
import dev.jeromeswannack.chineselearning.lab.data.api.DeckCheckJobDto
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.decks.DeckActions
import dev.jeromeswannack.chineselearning.lab.ui.decks.DeckScreen
import dev.jeromeswannack.chineselearning.lab.ui.decks.DecksSamples
import dev.jeromeswannack.chineselearning.lab.ui.decks.NoteRowUi
import dev.jeromeswannack.chineselearning.lab.ui.decks.PasteActions
import dev.jeromeswannack.chineselearning.lab.ui.decks.PasteInputs
import dev.jeromeswannack.chineselearning.lab.ui.decks.PasteIssue
import dev.jeromeswannack.chineselearning.lab.ui.decks.PasteUi
import dev.jeromeswannack.chineselearning.lab.ui.decks.PasteWordsModel
import dev.jeromeswannack.chineselearning.lab.ui.decks.PasteWordsScreen
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import org.junit.Test

/** Word checks: ⚠ on the deck page, the Check-for-errors sheet, the Paste preview warning, the setting. */
class CardCheckScreenshots : LabScreenshotTest() {
    @Composable
    private fun Sheet(content: @Composable () -> Unit) {
        Column(Modifier.fillMaxSize().background(Lab.colors.background).padding(top = 80.dp)) {
            Column(Modifier.fillMaxSize().clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)).background(Lab.colors.card).padding(top = 20.dp)) { content() }
        }
    }

    private val deckWithIssue = DecksSamples.deck.copy(
        notes = listOf(
            NoteRowUi(
                "n0", "一样", "yī yàng", "the same", "我们的想法一样。", "z.mp3", emptyMap(), 0,
                issues = listOf(NoteCheckIssue("i1", "pinyin", "tone_change", "yī yàng", "yí yàng", "一 changes tone: yí before a 4th tone, yì before the others, yī alone / as a number")),
            ),
            NoteRowUi(
                "n9", "银行", "yínxíng", "bank", "我去银行取钱。", "y.mp3", emptyMap(), 0,
                issues = listOf(NoteCheckIssue("i2", "pinyin", "reading", "yínxíng", "yínháng", "行 reads háng in 银行 (a row, a business), xíng only as \"to walk / OK\"")),
            ),
        ) + DecksSamples.deck.notes,
    )

    @Test fun deckIssue() = shoot("checks-01-deck-possible-issue") { DeckScreen(deckWithIssue, DeckActions()) }

    private val proposals = listOf(
        DeckCheckProposal("p1", "pinyin", "tone_change", "yī gè", "yí gè", "一 changes tone: yí before a 4th tone", note_id = "a", hanzi = "一个"),
        DeckCheckProposal("p2", "pinyin", "reading", "yínxíng", "yínháng", "行 reads háng in 银行", note_id = "b", hanzi = "银行"),
        DeckCheckProposal("p3", "english", "gloss", "to see", "to watch (a film, a game)", "看 here means watching something, not just seeing", note_id = "c", hanzi = "看电影"),
        DeckCheckProposal("p4", "pinyin", "tones", "bù cuò", "búcuò", "不 is bú before a 4th tone", note_id = "d", hanzi = "不错", applied = true),
    )
    private val doneJob = DeckCheckJobDto("j1", "d1", "HSK 3 · Plans & time", relationship_id = "r1", status = "done", total = 319, checked = 319, proposals = proposals)
    private val estimate = CardCheck.estimateCheckCost(319)

    @Test fun sheetIntro() = shoot("checks-02-sheet-intro") {
        Sheet { DeckCheckContent(DeckCheckUi(stage = DeckCheckStage.INTRO, deckName = "HSK 3 · Plans & time", estimate = estimate), DeckCheckActions()) }
    }

    @Test fun sheetRunning() = shoot("checks-03-sheet-running") {
        Sheet {
            DeckCheckContent(
                DeckCheckUi(stage = DeckCheckStage.RUNNING, deckName = "HSK 3 · Plans & time", estimate = estimate, job = doneJob.copy(status = "running", checked = 120, proposals = emptyList())),
                DeckCheckActions(),
            )
        }
    }

    @Test fun sheetResults() = shoot("checks-04-sheet-results-source") {
        Sheet {
            DeckCheckContent(
                DeckCheckUi(
                    stage = DeckCheckStage.RESULTS, deckName = "小明's copy of HSK 3", estimate = estimate, canFixSource = true,
                    job = doneJob, selected = setOf("p1", "p2"),
                ),
                DeckCheckActions(),
            )
        }
    }

    @Test fun pasteWarning() = shoot("checks-05-paste-preview-warning") {
        val text = "一样\tyī yàng\tthe same\n银行\tyínháng\tbank\n不客气\tbù kèqi\tyou're welcome"
        val inputs = PasteInputs(text = text)
        val derived = PasteWordsModel.derive(inputs, listOf(ImportPlanner.Existing("n2", "银行", "yínháng", "bank")), { it })
        PasteWordsScreen(
            PasteUi(
                inputs = inputs, derived = derived, deckName = "HSK 3 · Plans & time", cardCheck = true,
                issues = mapOf(
                    "一样" to listOf(PasteIssue("x1", "pinyin", "tone_change", "yī yàng", "yí yàng", "一 changes tone: yí before a 4th tone, yì before the others, yī alone / as a number")),
                    "不客气" to listOf(PasteIssue("x2", "pinyin", "tone_change", "bù kèqi", "bú kèqi", "不 changes tone: bú before a 4th tone, otherwise bù")),
                ),
            ),
            PasteActions(),
        )
    }

    @Test fun setting() = shoot("checks-06-settings-switch") {
        Column(Modifier.fillMaxSize().background(Lab.colors.background).padding(16.dp)) { CardCheckSection(true, null) {} }
    }
}
