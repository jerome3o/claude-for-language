package dev.jeromeswannack.chineselearning.lab.ui.calls

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.ui.Modifier
import dev.jeromeswannack.chineselearning.lab.core.calls.CallGloss
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import org.junit.Test
import kotlin.test.assertEquals

/**
 * Board tab-complete after ENGLISH (web: shared/calls/gloss.ts direction "en"): the grey offer is
 * " - 中文 - pīnyīn" and the chip "⇥ 中文 - pīnyīn"; a tap types it in after the English.
 */
class CallBoardEnglishGlossScreenshots : LabScreenshotTest() {
    private val notes = "第五课 · 生活\n洗手间 - xǐshǒujiān - toilet\nto take a shower"

    @Test fun englishOfferGhostAndChip() = shoot("lab-calls-gloss-en-01-chinese-offer") {
        val board = TextBoardUi(text = notes, version = 2)
        val offer = GlossSuggestion("to take a shower", notes.codePointCount(0, notes.length), BoardGloss("xǐzǎo", "", "洗澡"))
        Column(Modifier.fillMaxSize()) {
            TextBoardPanel(board, { _, _, _, _ -> }, { _, _ -> }, {}, Modifier.fillMaxWidth().weight(1f), gloss = { null }, previewSuggestion = offer)
        }
    }

    @Test fun englishOfferText() {
        val g = BoardGloss("xǐzǎo", "", "洗澡")
        assertEquals(" - 洗澡 - xǐzǎo", g.text)
        assertEquals("⇥ 洗澡 - xǐzǎo", g.chip)
        assertEquals(" - nǐ hǎo - hello", BoardGloss("nǐ hǎo", "hello").text)
        assertEquals(CallGloss.Check.Ok("to take a shower", 35, 51, CallGloss.EN), CallGloss.findSegment(notes, 51, 51))
    }
}
