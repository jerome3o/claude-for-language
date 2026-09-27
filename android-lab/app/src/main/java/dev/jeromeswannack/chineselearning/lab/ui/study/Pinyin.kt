package dev.jeromeswannack.chineselearning.lab.ui.study

import android.icu.text.Transliterator

/**
 * Pinyin with tone marks for any hanzi on the device, offline — what the web gets from
 * `pinyin-pro` (`pinyin(text, { toneType: 'symbol', type: 'string' })`): under a typed
 * answer, and for comparing a transcription with the word. ICU's Han-Latin transliterator
 * ships with Android; syllables come out space-separated like pinyin-pro's. Polyphonic
 * characters can read differently from pinyin-pro's pick — only ever shown as a hint.
 */
object Pinyin {
    private val han: Transliterator? by lazy { runCatching { Transliterator.getInstance("Han-Latin") }.getOrNull() }

    fun of(hanzi: String): String {
        if (hanzi.isBlank()) return ""
        val t = han ?: return ""
        return runCatching { t.transliterate(hanzi) }.getOrDefault("").replace(Regex("\\s+"), " ").trim()
    }
}
