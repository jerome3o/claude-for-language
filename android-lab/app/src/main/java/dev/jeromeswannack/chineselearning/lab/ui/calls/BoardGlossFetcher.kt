package dev.jeromeswannack.chineselearning.lab.ui.calls

import dev.jeromeswannack.chineselearning.lab.core.ToneChange
import dev.jeromeswannack.chineselearning.lab.core.calls.CallGloss
import dev.jeromeswannack.chineselearning.lab.core.calls.CallTextDoc
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.HttpException
import dev.jeromeswannack.chineselearning.lab.data.api.glossBoardText
import dev.jeromeswannack.chineselearning.lab.data.chars.CharDict
import dev.jeromeswannack.chineselearning.lab.data.chars.WordDict
import dev.jeromeswannack.chineselearning.lab.data.text.DeviceWords
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.withTimeoutOrNull
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap

/**
 * The text board's tab-complete lookup (web: services/calls/boardGloss.ts fetchBoardGloss). The
 * direction follows the segment (CallGloss.directionOf): a Chinese run → pinyin + meaning, an
 * English run → the Chinese + its pinyin. The reply is flattened to one line again here.
 *
 * Reliability (23 Oct 2026: it worked now and then for Jerome, not at all for Minghui):
 * - the request runs in this object's own scope: the board cancelling its wait (the text moved
 *   on, the other person typed) never cancels the request, so its answer still lands in
 *   [BoardGlossCache], and the same text asked again joins the request already running;
 * - after a failure only NEW lookups wait, for seconds (CallGloss.backoffMs; a 429's
 *   Retry-After) — it used to be a minute of silence after any 429 / 502 / 503;
 * - every lookup says what happened ([Result.outcome], for the `call.board_gloss_lookup` event).
 */
object BoardGlossFetcher {
    /** [outcome]: server | cached | rate_limited | unavailable | failed | offline | backoff (CallGloss.outcomeForStatus). */
    data class Result(val gloss: BoardGloss?, val outcome: String, val status: Int = 0)

    private const val REQUEST_TIMEOUT_MS = 15_000L
    private val RETRY_AFTER = Regex("\"retry_after\"\\s*:\\s*(\\d+(?:\\.\\d+)?)")

    @Volatile private var quietUntil = 0L
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val inflight = ConcurrentHashMap<String, Deferred<Result>>()

    suspend fun fetch(api: Api, callId: String, segment: String, online: () -> Boolean = { true }, now: () -> Long = System::currentTimeMillis): Result =
        fetchWith(segment, online, now) { direction -> api.glossBoardText(callId, CallGloss.cacheKey(segment), direction).let { Triple(it.pinyin, it.english, it.chinese) } }

    /** [call] = the request (test seam): (pinyin, english, chinese) for the direction given. */
    internal suspend fun fetchWith(
        segment: String,
        online: () -> Boolean = { true },
        now: () -> Long = System::currentTimeMillis,
        call: suspend (direction: String) -> Triple<String, String, String>,
    ): Result {
        BoardGlossCache.get(segment)?.let { return Result(it, "cached") }
        val direction = CallGloss.directionOf(segment)
        val key = CallGloss.storeKey(segment, direction)
        val running = inflight[key]
        if (running == null) {
            if (!online()) return Result(null, "offline")
            if (now() < quietUntil) return Result(null, "backoff")
        }
        val job = running ?: start(key) { request(segment, direction, now, call) }
        // Cancelling this await (the board's effect restarted) leaves the request running.
        return job.await()
    }

    private fun start(key: String, block: suspend () -> Result): Deferred<Result> {
        val fresh = scope.async(start = CoroutineStart.LAZY) { block() }
        val existing = inflight.putIfAbsent(key, fresh)
        if (existing != null) return existing
        fresh.invokeOnCompletion { inflight.remove(key, fresh) }
        fresh.start()
        return fresh
    }

    private suspend fun request(segment: String, direction: String, now: () -> Long, call: suspend (String) -> Triple<String, String, String>): Result {
        return try {
            val (rawPinyin, rawEnglish, rawChinese) = withTimeoutOrNull(REQUEST_TIMEOUT_MS) { call(direction) }
                ?: return failed(null, null, now)
            val pinyin = CallGloss.oneLine(rawPinyin)
            val gloss = if (direction == CallGloss.EN) {
                val chinese = CallGloss.oneLine(rawChinese).replace(" ", "")
                if (pinyin.isEmpty() || CallTextDoc.splitChars(chinese).none { CallGloss.isHan(it) }) null else BoardGloss(pinyin, "", chinese)
            } else {
                val english = CallGloss.oneLine(rawEnglish)
                if (pinyin.isEmpty() || english.isEmpty()) null else BoardGloss(pinyin, english)
            }
            if (gloss != null) {
                BoardGlossCache.put(segment, gloss)
                Result(gloss, "server")
            } else Result(null, "failed", 200)
        } catch (e: CancellationException) {
            throw e
        } catch (e: HttpException) {
            failed(e.code, e.body?.let { b -> RETRY_AFTER.find(b)?.groupValues?.get(1)?.toDoubleOrNull() }, now)
        } catch (e: IOException) {
            failed(null, null, now)
        } catch (e: Exception) {
            Result(null, "failed")
        }
    }

    private fun failed(status: Int?, retryAfter: Double?, now: () -> Long): Result {
        val wait = CallGloss.backoffMs(status, retryAfter)
        if (wait > 0) quietUntil = maxOf(quietUntil, now() + wait)
        return Result(null, CallGloss.outcomeForStatus(status), status ?: 0)
    }

    /** Tests. */
    internal fun reset() {
        quietUntil = 0L
        inflight.clear()
    }
}

/**
 * The device's own gloss for Chinese (web: localBoardGloss): the segmenter's pinyin (ToneChange's
 * auto-pinyin, 一 / 不) and, when the segment is one word the dictionary knows (on the device, else
 * its static file), its pinyin and first meaning. Shown while the server's contextual gloss is on
 * its way, or when it can't come. null when the word lists aren't loaded.
 */
object LocalBoardGloss {
    private const val LOOKUP_TIMEOUT_MS = 1_500L

    suspend fun of(segment: String, words: WordDict?, chars: CharDict?): BoardGloss? {
        val parts = DeviceWords.of(CallGloss.cacheKey(segment)) ?: return null
        val list = parts.map { CallGloss.Word(it.text, it.pinyin) }
        val word = CallGloss.lookupWord(list)
        var dictPinyin: String? = null
        var dictEnglish: String? = null
        if (word != null) {
            withTimeoutOrNull(LOOKUP_TIMEOUT_MS) {
                try {
                    if (CallTextDoc.splitChars(word).size == 1) {
                        val r = chars?.lookup(word)
                        if (r is CharDict.Lookup.Ok) {
                            val p = ToneChange.autoPinyin(word).trim()
                            val reading = r.record.readings.firstOrNull { it.pinyin == p } ?: r.record.readings.firstOrNull()
                            dictEnglish = reading?.english?.takeIf { it.isNotEmpty() } ?: r.record.meaning
                        }
                    } else {
                        val r = words?.lookup(word)
                        if (r is WordDict.Lookup.Ok) {
                            dictPinyin = r.record.pinyin
                            dictEnglish = r.record.english
                        }
                    }
                } catch (e: CancellationException) {
                    throw e
                } catch (_: Exception) {
                    // No dictionary entry: the segmenter's pinyin alone.
                }
            }
        }
        val g = CallGloss.localGloss(list, dictPinyin, dictEnglish) ?: return null
        return BoardGloss(g.pinyin, g.english, local = true)
    }
}
