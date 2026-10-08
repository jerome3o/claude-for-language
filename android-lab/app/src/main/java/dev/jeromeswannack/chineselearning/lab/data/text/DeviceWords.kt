package dev.jeromeswannack.chineselearning.lab.data.text

import android.util.LruCache
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import dev.jeromeswannack.chineselearning.lab.core.MessageTools
import dev.jeromeswannack.chineselearning.lab.core.chinese.Segmenter
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderWordDto

/**
 * Word chips made on the phone (web services/chineseSegmenter.ts): the deterministic segmenter
 * (core chinese/Segmenter.kt, parity-tested against the web) over the shipped word lists, with the
 * app's auto-pinyin per run. Ask Claude's bubbles always use it; the chat and readers use it while
 * Claude's words are missing or failed. The lists load once in the background at app start
 * ([preload]); until then [of] is null (the plain text) and composables reading it recompose as
 * soon as they are ready.
 */
object DeviceWords {
    private var ready by mutableStateOf<Segmenter.Dictionary?>(null)
    private val cache = LruCache<String, List<ReaderWordDto>>(400)

    /** Load the lists off the main thread (LabApp.onCreate → app.scope). */
    fun preload() {
        if (ready == null) ready = Segmenter.shipped
    }

    /** Tests: the lists loaded ([Segmenter.shipped]) or not (null = the plain-text path). */
    internal fun setForTests(dict: Segmenter.Dictionary?) {
        ready = dict
        cache.evictAll()
    }

    /** The text as word segments with pinyin, or null (not Chinese, or the lists aren't loaded). */
    fun of(text: String): List<ReaderWordDto>? {
        val dict = ready ?: return null
        if (text.isEmpty() || !MessageTools.looksLikeChinese(text)) return null
        cache.get(text)?.let { return it }
        val words = Segmenter.segment(text, dict, Segmenter.autoPinyin).map { ReaderWordDto(it.text, it.pinyin, it.gloss) }
        cache.put(text, words)
        return words
    }
}
