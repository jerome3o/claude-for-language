package dev.jeromeswannack.chineselearning.lab.data.claudechat

import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.CoachAsk
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable

/**
 * The words to recap of a Claude chat, kept on THIS phone per thread (core [CoachAsk.RecapWord]; the
 * web's services/claudeChatRecap.ts): every word tapped into the language explorer and every word a
 * "🎤 Read it back" found a real mistake in. Not tied to the Coach — any Claude chat keys it by its
 * thread id. JsonCache `claude-chat/recap/<thread>`; read by "Make flashcards from this chat" (the
 * default ticks) and, later, the recap pass.
 */
class ClaudeChatRecap(private val app: LabApp) {
    @Serializable
    data class Word(
        val hanzi: String,
        val sentence: String = "",
        val reasons: List<String> = emptyList(),
        val pinyin: String? = null,
        val gloss: String? = null,
        val reason_line: String? = null,
    ) {
        fun core() = CoachAsk.RecapWord(hanzi, sentence, reasons, pinyin, gloss, reason_line)

        companion object {
            fun of(w: CoachAsk.RecapWord) = Word(w.hanzi, w.sentence, w.reasons, w.pinyin, w.gloss, w.reasonLine)
        }
    }

    private val lock = Mutex()

    suspend fun words(thread: String): List<CoachAsk.RecapWord> =
        runCatching { app.cache.get<List<Word>>(key(thread)) }.getOrNull().orEmpty().map { it.core() }

    fun observe(thread: String): Flow<List<CoachAsk.RecapWord>> =
        app.cache.observe<List<Word>>(key(thread)).map { it.orEmpty().map(Word::core) }

    suspend fun record(thread: String, words: List<CoachAsk.RecapWord>) {
        if (words.isEmpty()) return
        lock.withLock {
            val next = CoachAsk.addRecapWords(words(thread), words)
            app.cache.put(key(thread), KIND, next.map(Word::of))
        }
    }

    /** A thread started on the "new" screen: its words move to the thread's id (the web's moveRecapWords). */
    suspend fun move(from: String, to: String) {
        if (from == to) return
        lock.withLock {
            val moving = words(from)
            if (moving.isEmpty()) return
            app.cache.put(key(to), KIND, CoachAsk.addRecapWords(words(to), moving).map(Word::of))
            app.cache.delete(key(from))
        }
    }

    companion object {
        const val KIND = "claude-chat-recap"
        fun key(thread: String) = "claude-chat/recap/$thread"
    }
}
