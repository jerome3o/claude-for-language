package dev.jeromeswannack.chineselearning.lab.ui.calls

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.ui.Modifier
import dev.jeromeswannack.chineselearning.lab.core.calls.RemoteCaret
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import org.junit.Test

/**
 * Video calls round 4 (PR 1) on the text board: the other person's caret is a thin line with a
 * small dot (nothing over the text), their name and compose preview live in the people row under
 * the board (lit up after a tap near their dot), and a long tab-complete offer wraps instead of
 * being cut off — ghost and chip.
 */
class CallBoardRound4Screenshots : LabScreenshotTest() {
    private val notes = "第五课 · 点菜\n服务员 - fúwùyuán - waiter\n我想要一杯咖啡。\n微辣 wēi là = a little spicy\n不要放香菜。"

    @Test fun caretDotAndLitChipWhileTheyCompose() = shoot("lab-calls-r4-01-caret-dot-compose-chip") {
        // Minghui's caret right after 一杯 (she is composing "kafei"); her chip lit up as after a tap near the dot.
        val at = notes.indexOf("咖啡")
        val board = TextBoardUi(
            text = notes, version = 3,
            remote = listOf(RemoteCaret("c-a", CallsSamples.TUTOR, "Minghui", "#e11d48", at, at, at, compose = "你kafei")),
        )
        Column(Modifier.fillMaxSize()) {
            TextBoardPanel(board, { _, _, _, _ -> }, { _, _ -> }, {}, Modifier.fillMaxWidth().weight(1f), gloss = { null }, previewHighlight = "c-a")
        }
    }

    @Test fun caretDotWithSelectionNotComposing() = shoot("lab-calls-r4-02-caret-dot-selection") {
        val s = notes.indexOf("微辣")
        val board = TextBoardUi(
            text = notes, version = 3,
            remote = listOf(RemoteCaret("c-a", CallsSamples.TUTOR, "Minghui", "#2563eb", s, s + 2, s + 2)),
        )
        Column(Modifier.fillMaxSize()) {
            TextBoardPanel(board, { _, _, _, _ -> }, { _, _ -> }, {}, Modifier.fillMaxWidth().weight(1f), gloss = { null })
        }
    }

    @Test fun longGlossWrapsGhostAndChip() = shoot("lab-calls-r4-03-long-gloss-wraps") {
        val text = "第五课 · 点菜\n服务员，我想要一杯不加糖的热牛奶咖啡"
        val board = TextBoardUi(text = text, version = 4)
        val offer = GlossSuggestion(
            "服务员，我想要一杯不加糖的热牛奶咖啡", text.codePointCount(0, text.length),
            BoardGloss("fúwùyuán, wǒ xiǎng yào yì bēi bù jiā táng de rè niúnǎi kāfēi", "Waiter, I would like a cup of hot milk coffee without any sugar, please"),
        )
        Column(Modifier.fillMaxSize()) {
            TextBoardPanel(board, { _, _, _, _ -> }, { _, _ -> }, {}, Modifier.fillMaxWidth().weight(1f), gloss = { null }, previewSuggestion = offer)
        }
    }
}
