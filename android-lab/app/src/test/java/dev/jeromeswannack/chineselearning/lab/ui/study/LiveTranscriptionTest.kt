package dev.jeromeswannack.chineselearning.lab.ui.study

import dev.jeromeswannack.chineselearning.lab.data.api.LiveTranscriptionSessionDto
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.ByteString
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.util.concurrent.CopyOnWriteArrayList

/** Port of shared/transcription/soniox.test.ts + the web's LiveTranscriber tests. */
class LiveTranscriptionTest {
    private val t0 = SonioxProtocol.Transcript()

    @Test fun configIsRawPcmWithHintsAndNoContext() {
        val c = Json.parseToJsonElement(SonioxProtocol.config("temp:1", "stt-rt-v5", listOf("zh", "en"))).jsonObject
        assertEquals("pcm_s16le", c["audio_format"]!!.jsonPrimitive.content)
        assertEquals("16000", c["sample_rate"]!!.jsonPrimitive.content)
        assertEquals("1", c["num_channels"]!!.jsonPrimitive.content)
        assertEquals("[\"zh\",\"en\"]", c["language_hints"].toString())
        assertFalse(c.containsKey("context"))
    }

    @Test fun finalTokensStayProvisionalTailIsReplaced() {
        var s = SonioxProtocol.apply(t0, """{"tokens":[{"text":"我","is_final":true},{"text":"打","is_final":false}]}""")
        assertEquals("我", s.finalText); assertEquals("打", s.partialText)
        s = SonioxProtocol.apply(s, """{"tokens":[{"text":"打算","is_final":true},{"text":"明","is_final":false}]}""")
        assertEquals("我打算明", s.text)
    }

    @Test fun markersDroppedFinishedNoted() {
        var s = SonioxProtocol.apply(t0, """{"tokens":[{"text":"你好","is_final":true},{"text":"<fin>","is_final":true}]}""")
        s = SonioxProtocol.apply(s, """{"tokens":[],"finished":true}""")
        assertEquals(SonioxProtocol.Transcript("你好", "", true, null), s)
    }

    @Test fun mixedLanguageKeptAsSpoken() {
        val s = SonioxProtocol.apply(t0, """{"tokens":[{"text":"我想","is_final":true},{"text":" order","is_final":true},{"text":" 一个","is_final":true}]}""")
        assertEquals("我想 order 一个", s.text)
    }

    @Test fun errorsAndGarbage() {
        assertEquals(t0, SonioxProtocol.apply(t0, "not json"))
        assertEquals("Soniox 401: Invalid API key", SonioxProtocol.apply(t0, """{"error_code":401,"error_message":"Invalid API key"}""").error)
    }

    @Test fun keyReuseUntilAMinuteBeforeExpiry() {
        val s = LiveTranscriptionSessionDto("soniox", "k", "2026-09-27T10:30:00Z", "wss://x", "stt-rt-v5", listOf("zh"))
        val now = java.time.Instant.parse("2026-09-27T10:00:00Z").toEpochMilli()
        assertTrue(SonioxProtocol.usable(s, now))
        assertFalse(SonioxProtocol.usable(s, java.time.Instant.parse("2026-09-27T10:29:30Z").toEpochMilli()))
        assertFalse(SonioxProtocol.usable(LiveTranscriptionSessionDto("upload"), now))
        assertFalse(SonioxProtocol.usable(null, now))
    }

    @Test fun wavHeaderAndPeak() {
        val h = Wav.header(16_000, 32_000)
        assertEquals("RIFF", String(h, 0, 4)); assertEquals("WAVE", String(h, 8, 4)); assertEquals("data", String(h, 36, 4))
        val bb = java.nio.ByteBuffer.wrap(h).order(java.nio.ByteOrder.LITTLE_ENDIAN)
        assertEquals(36 + 32_000, bb.getInt(4)); assertEquals(16_000, bb.getInt(24)); assertEquals(32_000, bb.getInt(40))
        val pcm = byteArrayOf(0, 0, 0xFF.toByte(), 0x3F, 0x01, 0x80.toByte()) // 0, 16383, -32767
        assertEquals(1f, Wav.peak(pcm, pcm.size), 0.001f)
        assertEquals(0.5f, Wav.peak(pcm, 4), 0.001f)
    }

    /** A stand-in for Soniox: checks the config, collects audio, answers the empty frame. */
    private fun fakeSoniox(answer: Boolean = true): Pair<MockWebServer, MutableList<Any>> {
        val got = CopyOnWriteArrayList<Any>()
        val server = MockWebServer()
        server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) { got.add(text) }
            override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                got.add(bytes.size)
                if (bytes.size == 0 && answer) {
                    webSocket.send("""{"tokens":[{"text":"是","is_final":true},{"text":"<fin>","is_final":true}]}""")
                    webSocket.send("""{"tokens":[],"finished":true}""")
                    webSocket.close(1000, null)
                }
            }
            override fun onOpen(webSocket: WebSocket, response: Response) {}
        }))
        server.start()
        return server to got
    }

    private fun session(server: MockWebServer) = LiveTranscriptionSessionDto(
        "soniox", "temp:1", "2099-01-01T00:00:00Z", server.url("/").toString().replace("http", "ws"), "stt-rt-v5", listOf("zh", "en"),
    )

    @Test fun streamSendsConfigThenAudioThenEndAndReturnsTheText() = runBlocking {
        val (server, got) = fakeSoniox()
        val stream = SonioxStream(OkHttpClient(), session(server))
        stream.send(ByteArray(3200), 3200) // queued until the socket opens
        stream.send(ByteArray(3200), 1600)
        assertEquals("是", stream.finish())
        val config = Json.parseToJsonElement(got[0] as String).jsonObject
        assertEquals("temp:1", config["api_key"]!!.jsonPrimitive.content)
        assertEquals(listOf(3200, 1600, 0), got.drop(1))
        server.shutdown()
    }

    @Test fun noAnswerTimesOutSoTheTakeIsUploaded() = runBlocking {
        val (server, _) = fakeSoniox(answer = false)
        val stream = SonioxStream(OkHttpClient(), session(server))
        stream.send(ByteArray(320), 320)
        try {
            stream.finish(timeoutMs = 500)
            fail("expected a timeout")
        } catch (e: kotlinx.coroutines.TimeoutCancellationException) {
            // expected: the caller falls back to uploading the take
        }
        server.shutdown()
    }

    @Test fun sessionCacheFetchesOnceAndBacksOffOnFailure() = runBlocking {
        var calls = 0
        val cache = LiveSessionCache(now = { 0L }) { calls++; LiveTranscriptionSessionDto("soniox", "k", "2099-01-01T00:00:00Z", "wss://x", "stt-rt-v5") }
        assertNull(cache.usable())
        kotlinx.coroutines.coroutineScope { cache.prefetch(this) }
        assertEquals("k", cache.usable()?.api_key)
        kotlinx.coroutines.coroutineScope { cache.prefetch(this) }
        assertEquals(1, calls)

        var failing = 0
        val broken = LiveSessionCache(now = { 0L }) { failing++; error("502") }
        kotlinx.coroutines.coroutineScope { broken.prefetch(this) }
        kotlinx.coroutines.coroutineScope { broken.prefetch(this) }
        assertEquals(1, failing)
        assertNull(broken.usable())
    }
}
