package dev.jeromeswannack.chineselearning.lab.ui.coach

import dev.jeromeswannack.chineselearning.lab.data.HttpException
import dev.jeromeswannack.chineselearning.lab.data.api.serverMessage
import kotlinx.coroutines.delay
import java.io.IOException

/** A deck a words picker offers (the podcast episode's "➕ Add new words"). */
data class CoachDeck(val id: String, val name: String)

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
