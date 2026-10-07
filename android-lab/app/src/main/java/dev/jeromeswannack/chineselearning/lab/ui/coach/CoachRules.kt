package dev.jeromeswannack.chineselearning.lab.ui.coach

import dev.jeromeswannack.chineselearning.lab.data.HttpException
import dev.jeromeswannack.chineselearning.lab.data.api.serverMessage
import kotlinx.coroutines.delay
import java.io.IOException

/** A deck the "Cards go to" picker offers. */
data class CoachDeck(val id: String, val name: String)

/** One tap → a prepared message into the follow-up chat (the web's QUICK_ACTIONS). */
data class CoachQuickAction(val key: String, val label: String, val needsDeck: Boolean, val message: (hanzi: String, deck: CoachDeck?) -> String)

private fun deckClause(deck: CoachDeck?) = if (deck != null) " Put it in my deck \"${deck.name}\" (deck_id ${deck.id})." else ""

/** Word for word the web's prompts, so both apps get the same cards from Claude. */
val COACH_QUICK_ACTIONS = listOf(
    CoachQuickAction("card-word", "🃏 Make a card", true) { hanzi, deck ->
        "Make a flashcard for the key word or phrase in \"$hanzi\" — the one most worth learning from this sentence.${deckClause(deck)} Check search_cards first so you don't duplicate a card I already have (if I have it, tell me and offer to improve it instead). Follow the card standard fully: one clean hanzi form, pinyin with tone marks, one clear English meaning, a fun_facts explanation (each character, then usage, the common mistake or contrast), and a short natural example sentence with pinyin and translation as the sentence_clue."
    },
    CoachQuickAction("card-sentence", "📝 Card for the whole sentence", true) { hanzi, deck ->
        "Make a flashcard for the whole sentence \"$hanzi\".${deckClause(deck)} Follow the card standard: hanzi is the clean sentence, pinyin with tone marks, one natural English meaning, and fun_facts that gloss every word in order (汉字 (pīnyīn) meaning) then explain the structure and the common mistake. Check search_cards first so it is not a duplicate."
    },
    CoachQuickAction("examples", "💬 More examples", false) { hanzi, _ ->
        "Give me 3 more example sentences using the key word or pattern from \"$hanzi\", easiest first, each with pinyin (tone marks) and English."
    },
    CoachQuickAction("alternatives", "🔀 Other ways to say it", false) { hanzi, _ ->
        "Show me 2–3 other natural ways to say \"$hanzi\" — more casual, more formal, more idiomatic — each with pinyin and English, and when you would use each."
    },
    CoachQuickAction("grammar", "🔍 Explain the grammar", false) { hanzi, _ ->
        "Explain \"$hanzi\" word by word: each word with pinyin and its meaning here, then the structure and any grammar pattern in it, briefly."
    },
)

object CoachRules {
    /** The offline notice (the typed text is kept). */
    const val OFFLINE = "You're offline — the coach needs a connection. Your text is kept; try again when you're back online."

    /** Port of `containsChinese` (utils/textLanguage.ts): any Han character → treat as Chinese. */
    fun containsChinese(text: String): Boolean = text.any { c -> c in '㐀'..'䶿' || c in '一'..'鿿' || c in '豈'..'﫿' }

    /** Port of `isRetryableCoachError`: a dropped connection, or a 5xx other than 502 (= Claude declined). */
    fun isRetryable(e: Throwable): Boolean = when (e) {
        is HttpException -> e.code >= 500 && e.code != 502
        is IOException -> true
        else -> false
    }

    /** Port of `coachErrorText`: offline vs. the server's own reason. */
    fun errorText(e: Throwable, fallback: String, online: Boolean): String = when (e) {
        is HttpException -> e.serverMessage()?.takeIf { it.isNotBlank() } ?: "$fallback — something went wrong on our side. Try again."
        is IOException -> if (!online) "You're offline — the coach needs a connection. Your text is kept; try again when you're back online." else "$fallback — the connection dropped. Try again."
        else -> "$fallback — something went wrong on our side. Try again."
    }

    /**
     * Starting a conversation only analyses and saves, so a retry is safe: once more after
     * 1.5 s on a retryable failure (the web's react-query `retry` for startMutation).
     */
    suspend fun <T> retryOnce(delayMs: Long = 1500, block: suspend () -> T): T = try {
        block()
    } catch (e: Exception) {
        if (e is kotlinx.coroutines.CancellationException || !isRetryable(e)) throw e
        delay(delayMs)
        block()
    }
}
