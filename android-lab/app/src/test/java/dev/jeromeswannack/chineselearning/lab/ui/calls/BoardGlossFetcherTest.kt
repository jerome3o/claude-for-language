package dev.jeromeswannack.chineselearning.lab.ui.calls

import dev.jeromeswannack.chineselearning.lab.data.HttpException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import java.io.IOException
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

/** The board's tab-complete lookup must not be killed by the board moving on, nor go quiet for a minute (web: boardGloss.test.ts). */
class BoardGlossFetcherTest {
    @BeforeTest
    fun setUp() = BoardGlossFetcher.reset()

    @Test
    fun cancellingTheWaitNeverCancelsTheRequest() = runBlocking {
        val calls = AtomicInteger()
        val answer = CompletableDeferred<Triple<String, String, String>>()
        val call: suspend (String) -> Triple<String, String, String> = { calls.incrementAndGet(); answer.await() }
        val waiting = async { BoardGlossFetcher.fetchWith("咖啡馆", call = call) }
        delay(50)
        waiting.cancel()
        // Asked again while it runs: joins it.
        val again = async { BoardGlossFetcher.fetchWith("咖啡馆", call = call) }
        delay(50)
        answer.complete(Triple("kāfēiguǎn", "café", ""))
        val r = withTimeout(2_000) { again.await() }
        assertEquals("server", r.outcome)
        assertEquals(BoardGloss("kāfēiguǎn", "café"), r.gloss)
        assertEquals(1, calls.get())
        assertNotNull(BoardGlossCache.get("咖啡馆"))
        assertEquals("cached", BoardGlossFetcher.fetchWith("咖啡馆", call = call).outcome)
    }

    @Test
    fun aFailureMeansSecondsOfQuietNotAMinute() = runBlocking {
        var t = 1_000_000L
        val now = { t }
        val r = BoardGlossFetcher.fetchWith("你们好吗", now = now) { throw HttpException(503, "busy") }
        assertEquals("unavailable", r.outcome)
        assertEquals(503, r.status)
        assertEquals("backoff", BoardGlossFetcher.fetchWith("再见了", now = now) { Triple("zàijiàn le", "goodbye", "") }.outcome)
        t += 3_100
        assertEquals("server", BoardGlossFetcher.fetchWith("再见了", now = now) { Triple("zàijiàn le", "goodbye", "") }.outcome)
    }

    @Test
    fun aRateLimitWaitsForItsRetryAfter() = runBlocking {
        var t = 2_000_000L
        val now = { t }
        val r = BoardGlossFetcher.fetchWith("多少钱呀", now = now) { throw HttpException(429, "slow down", "{\"error\":\"x\",\"retry_after\":5}") }
        assertEquals("rate_limited", r.outcome)
        t += 4_000
        assertEquals("backoff", BoardGlossFetcher.fetchWith("谢谢您", now = now) { Triple("xièxie nín", "thank you", "") }.outcome)
        t += 1_100
        assertEquals("server", BoardGlossFetcher.fetchWith("谢谢您", now = now) { Triple("xièxie nín", "thank you", "") }.outcome)
    }

    @Test
    fun offlineAndNetworkFailures() = runBlocking {
        assertEquals("offline", BoardGlossFetcher.fetchWith("飞机场", online = { false }) { Triple("fēijīchǎng", "airport", "") }.outcome)
        val r = BoardGlossFetcher.fetchWith("火车站", now = { 3_000_000L }) { throw IOException("reset") }
        assertEquals("offline", r.outcome)
        assertNull(r.gloss)
        assertEquals(0, r.status)
    }

    @Test
    fun englishGivesChinese() = runBlocking {
        val r = BoardGlossFetcher.fetchWith("to take a bath") { d -> assertEquals("en", d); Triple("xǐzǎo", "", "洗 澡") }
        assertEquals(BoardGloss("xǐzǎo", "", "洗澡"), r.gloss)
        assertEquals(" - nǐ hǎo", BoardGloss("nǐ hǎo", "", local = true).text)
    }
}
