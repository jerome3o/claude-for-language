package dev.jeromeswannack.chineselearning.lab.core.explorer

import dev.jeromeswannack.chineselearning.lab.core.Known

/*
 * Port of shared/explorer/segments.ts — which parts of a text are tappable and what each opens:
 * by WORD when the place has word segments that line up with the text (reader words, chat
 * words, a breakdown), by CHARACTER otherwise. Parity-tested (ExplorerParityTest).
 */

/** Port of `WordSegmentInput`. */
data class WordSegmentInput(val text: String, val pinyin: String? = null, val gloss: String? = null)

/** Port of `ExplorableSegment`: [item] null = plain text (punctuation, spaces, Latin, line breaks). */
data class ExplorableSegment(val text: String, val item: ExplorerItem?)

object ExplorableSegments {
    private fun hasHan(text: String): Boolean = text.codePoints().anyMatch { Known.isHan(it) }

    /** Port of `segmentsMatch`: the segments' texts concatenate to the text exactly. */
    fun segmentsMatch(text: String, segments: List<WordSegmentInput>?): Boolean =
        !segments.isNullOrEmpty() && segments.joinToString("") { it.text } == text

    /** Port of `charSegments`: one segment per Han character; runs of anything else stay together. */
    fun charSegments(text: String): List<ExplorableSegment> {
        val out = ArrayList<ExplorableSegment>()
        val plain = StringBuilder()
        for (cp in text.codePoints().toArray()) {
            val ch = String(Character.toChars(cp))
            if (Known.isHan(cp)) {
                if (plain.isNotEmpty()) out += ExplorableSegment(plain.toString(), null)
                plain.setLength(0)
                out += ExplorableSegment(ch, ExplorerItem.Char(ch))
            } else plain.append(ch)
        }
        if (plain.isNotEmpty()) out += ExplorableSegment(plain.toString(), null)
        return out
    }

    /**
     * Port of `explorableSegments`: word segments when they match the text (a one-character word
     * opens the Character view, a longer one the Word view with its pinyin / gloss and the
     * sentence it sits in — [sentenceOf] gets UTF-16 offsets, like the TS), else one per character.
     */
    fun explorableSegments(
        text: String,
        segments: List<WordSegmentInput>?,
        sentenceOf: ((start: Int, end: Int) -> String)? = null,
    ): List<ExplorableSegment> {
        if (!segmentsMatch(text, segments)) return charSegments(text)
        val out = ArrayList<ExplorableSegment>()
        var offset = 0
        for (s in segments!!) {
            val start = offset
            offset += s.text.length
            if (!hasHan(s.text)) {
                out += ExplorableSegment(s.text, null)
                continue
            }
            val item = ExplorerStack.itemForText(
                s.text,
                pinyin = s.pinyin?.ifEmpty { null },
                gloss = s.gloss?.ifEmpty { null },
                sentence = sentenceOf?.invoke(start, offset),
            )
            out += ExplorableSegment(s.text, item)
        }
        return out
    }
}
