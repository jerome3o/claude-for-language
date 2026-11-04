package dev.jeromeswannack.chineselearning.lab.ui.study

import dev.jeromeswannack.chineselearning.lab.data.api.LiveTranscriptionSessionDto
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.time.Instant

/**
 * Nov 2026: a card left on screen for an hour had an expired live key, and every take on it went
 * the 4 s upload way. A take with no usable key now fetches one while it records (the web's
 * `getLiveSession()` promise), and only goes to upload — live_error "no_session" — when none comes.
 */
class LiveKeyAtTakeTest {
    private val now = Instant.parse("2026-11-04T19:00:00Z").toEpochMilli()

    private fun session(key: String, expires: String = "2026-11-04T19:30:00Z") =
        LiveTranscriptionSessionDto("soniox", key, expires, "wss://x", "stt-rt-v5")

    private class FakeStream(val key: String) : LiveStream {
        val got = ArrayList<Int>()
        var aborted = false
        override fun send(pcm: ByteArray, length: Int) { got += length }
        override suspend fun finish(timeoutMs: Long) = "你好 ($key)"
        override fun abort() { aborted = true }
    }

    @Test fun anExpiredKeyIsReplacedDuringTheTakeAndTheAudioIsKept() = runBlocking {
        var calls = 0
        val cache = LiveSessionCache(now = { now }) { calls++; if (calls == 1) session("old", "2026-11-04T18:20:00Z") else session("fresh") }
        coroutineScope { cache.prefetch(this) }
        assertNull("the card sat on screen past the key's life", cache.usable())
        val gate = CompletableDeferred<Unit>()
        var opened: FakeStream? = null
        val stream = coroutineScope {
            val s = cache.stream(this) { gate.complete(Unit); FakeStream(it.api_key!!).also { f -> opened = f } }
            assertNotNull("a take still streams live", s)
            s!!.send(ByteArray(3200), 3200) // spoken before the key arrived
            s.send(ByteArray(1600), 1600)
            s
        }
        assertEquals("你好 (fresh)", stream.finish(4_000))
        assertEquals(listOf(3200, 1600), opened!!.got)
        assertEquals(2, calls)
    }

    @Test fun aUsableKeyOpensAtOnce() = runBlocking {
        val cache = LiveSessionCache(now = { now }) { session("k") }
        coroutineScope { cache.prefetch(this) }
        val s = coroutineScope { cache.stream(this) { FakeStream(it.api_key!!) } }
        assertTrue(s is FakeStream)
    }

    @Test fun noKeyMeansNoSessionThenTheUpload() = runBlocking {
        val cache = LiveSessionCache(now = { now }) { throw java.io.IOException("HTTP 502") }
        val s = coroutineScope { cache.stream(this) { FakeStream(it.api_key!!) } }!!
        s.send(ByteArray(3200), 3200)
        try {
            s.finish(4_000)
            fail("no key must not give a live transcript")
        } catch (e: IllegalStateException) {
            assertEquals("no_session", e.message)
        }
        // The mint just failed: the next take goes straight to the upload, no second wait.
        assertNull(coroutineScope { cache.stream(this) { FakeStream(it.api_key!!) } })
    }

    @Test fun theServerWithoutLiveNeverWaits() = runBlocking {
        val cache = LiveSessionCache(now = { now }) { LiveTranscriptionSessionDto("upload") }
        coroutineScope { cache.prefetch(this) }
        assertNull(coroutineScope { cache.stream(this) { FakeStream(it.api_key!!) } })
    }

    @Test fun anAbortedTakeOpensNothing() = runBlocking {
        val release = CompletableDeferred<Unit>()
        var openedCount = 0
        val cache = LiveSessionCache(now = { now }) { release.await(); session("k") }
        coroutineScope {
            val s = cache.stream(this) { openedCount++; FakeStream("k") }!!
            s.abort()
            release.complete(Unit)
        }
        assertEquals(0, openedCount)
    }
}
