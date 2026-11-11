package dev.jeromeswannack.chineselearning.lab.ui.explorer

import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerItem
import dev.jeromeswannack.chineselearning.lab.core.explorer.WordSource
import dev.jeromeswannack.chineselearning.lab.data.chars.WordDict
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The Word view's pinyin on the phone (docs/LANGUAGE_EXPLORER.md "Pinyin per character"): a reader
 * chip's pinyin is checked per character with the phone's own readings (`Pinyin.readings`) and its
 * auto-pinyin — Jerome's 吴侬软语 "wúnóngkuǎnyǔ" showed wún · óng · kuǎn · yǔ.
 */
class ExplorerPinyinTest {
    private fun ui(pinyin: String?) = WordViewUi(
        item = ExplorerItem.Word("吴侬软语", pinyin, "soft Wu dialect", null),
        lookup = WordDict.Lookup.Missing,
    )

    @Test
    fun aReaderChipsImpossibleSyllableIsReplaced() {
        val ui = ui("wúnóngkuǎnyǔ")
        assertEquals("wúnóngruǎnyǔ", ui.resolved.pinyin)
        assertEquals(WordSource.CONTEXT, ui.resolved.source)
        assertEquals(listOf("wú", "nóng", "ruǎn", "yǔ"), ui.wordChars.map { it.syllable })
        assertEquals(listOf(2, 2, 3, 3), ui.wordChars.map { it.tone })
    }

    @Test
    fun pinyinThatCantBeLinedUpTakesThePhonesReading() {
        assertEquals(listOf("wú", "nóng", "ruǎn", "yǔ"), ui("wún óng").wordChars.map { it.syllable })
        assertEquals("wúnóngruǎnyǔ", ui(null).resolved.pinyin)
    }

    @Test
    fun rightPinyinStaysAsWritten() {
        assertEquals("wú nóng ruǎn yǔ", ui("wú nóng ruǎn yǔ").resolved.pinyin)
    }
}
