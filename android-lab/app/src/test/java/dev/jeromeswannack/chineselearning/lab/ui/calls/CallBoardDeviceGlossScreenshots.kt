package dev.jeromeswannack.chineselearning.lab.ui.calls

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.ui.Modifier
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import org.junit.Test

/**
 * Board tab-complete when the server's gloss is slow or can't come (23 Oct 2026): the device's own
 * gloss — a dictionary word with its meaning, or a phrase's pinyin alone (" - wǒ xiǎng qù yínháng").
 */
class CallBoardDeviceGlossScreenshots : LabScreenshotTest() {
    @Test fun deviceWordWithMeaning() = shoot("lab-calls-gloss-device-01-word") {
        val notes = "第六课 · 在银行\n存钱 - cúnqián - to deposit money\n银行"
        val board = TextBoardUi(text = notes, version = 2)
        val offer = GlossSuggestion("银行", notes.codePointCount(0, notes.length), BoardGloss("yínháng", "bank", local = true))
        Column(Modifier.fillMaxSize()) {
            TextBoardPanel(board, { _, _, _, _ -> }, { _, _ -> }, {}, Modifier.fillMaxWidth().weight(1f), gloss = { BoardGlossFetcher.Result(null, "failed") }, previewSuggestion = offer)
        }
    }

    @Test fun devicePhrasePinyinOnly() = shoot("lab-calls-gloss-device-02-pinyin-only") {
        val notes = "第六课 · 在银行\n存钱 - cúnqián - to deposit money\n我想去银行"
        val board = TextBoardUi(text = notes, version = 2)
        val offer = GlossSuggestion("我想去银行", notes.codePointCount(0, notes.length), BoardGloss("wǒ xiǎng qù yínháng", "", local = true))
        Column(Modifier.fillMaxSize()) {
            TextBoardPanel(board, { _, _, _, _ -> }, { _, _ -> }, {}, Modifier.fillMaxWidth().weight(1f), gloss = { BoardGlossFetcher.Result(null, "failed") }, previewSuggestion = offer)
        }
    }
}
