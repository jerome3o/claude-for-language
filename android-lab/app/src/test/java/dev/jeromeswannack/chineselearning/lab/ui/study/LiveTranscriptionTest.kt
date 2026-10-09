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

    @Test fun configIsRawPcmWithHintsAndNoContextOrKey() {
        val c = Json.parseToJsonElement(SonioxProtocol.config("stt-rt-v5", listOf("zh", "en"))).jsonObject
        assertFalse(c.containsKey("api_key")) // the key goes with the connection
        assertEquals("Bearer snx_temp_1", SonioxProtocol.authorizationHeader("snx_temp_1"))
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

    @Test fun nullErrorFieldsAreANormalResponse() {
        val s = SonioxProtocol.apply(t0, """{"tokens":[{"text":"好","is_final":true}],"error_code":null,"error_message":null}""")
        assertNull(s.error)
        assertEquals("好", s.text)
        assertEquals("Soniox 402: Balance exhausted", SonioxProtocol.apply(t0, """{"tokens":[],"error_code":402,"error_type":"organization_balance_exhausted","error_message":"Balance exhausted"}""").error)
    }

    @Test fun endOfAudioIsAnEmptyTextFrame() {
        // Soniox: "An empty binary frame is an empty audio chunk and does not end the stream."
        assertEquals("", SonioxProtocol.END_OF_AUDIO)
    }

    /** Same vectors as shared/transcription/soniox.test.ts `liveErrorKind`. */
    @Test fun liveErrorKindIsAnAnalyticsEnum() {
        assertEquals("none", SonioxProtocol.errorKind(null))
        assertEquals("none", SonioxProtocol.errorKind("  "))
        assertEquals("timeout", SonioxProtocol.errorKind("Timed out waiting for 4000 ms"))
        assertEquals("timeout", SonioxProtocol.errorKind("timeout"))
        assertEquals("soniox_402", SonioxProtocol.errorKind("Soniox 402: Balance exhausted"))
        assertEquals("soniox_401", SonioxProtocol.errorKind("Soniox 401: Invalid API key"))
        assertEquals("soniox_error", SonioxProtocol.errorKind("Soniox : error"))
        assertEquals("empty", SonioxProtocol.errorKind("live returned no text"))
        assertEquals("closed", SonioxProtocol.errorKind("closed early"))
        assertEquals("aborted", SonioxProtocol.errorKind("aborted"))
        assertEquals("no_session", SonioxProtocol.errorKind("no live session"))
        assertEquals("socket", SonioxProtocol.errorKind("socket error"))
    }

    @Test fun onlyARefusedKeyIsDropped() {
        assertTrue(SonioxProtocol.invalidatesKey("Soniox 401: Incorrect API key provided."))
        assertTrue(SonioxProtocol.invalidatesKey("Soniox 403: temp_api_key_session_expired"))
        assertFalse(SonioxProtocol.invalidatesKey("Soniox 402: Balance exhausted"))
        assertFalse(SonioxProtocol.invalidatesKey("closed early"))
    }

    // ---- TakeTranscription.outcome (frontend/src/services/takeTranscription.ts) ----

    private val cmp: (String) -> TranscriptionComparison = { TranscriptionComparison(it, "", isMatch = it == "谢谢", containsExpected = false) }
    private fun failed(reason: String) = kotlinx.coroutines.CompletableDeferred<String>().apply { completeExceptionally(IllegalStateException(reason)) }

    /** The bug: live gave nothing AND the upload failed → the card showed nothing. Now: Failed (retry). */
    @Test fun liveFailedAndUploadFailedIsAVisibleFailure() = runBlocking {
        var sentReason: String? = "unset"
        val out = TakeTranscription.outcome(failed("timeout"), online = { true }, compare = cmp) { reason -> sentReason = reason; throw java.io.IOException("HTTP 502") }
        assertEquals(TranscriptionUi.Failed, out.ui)
        assertEquals("timeout", out.liveError)
        assertEquals("timeout", sentReason) // the live reason goes up with the upload
    }

    @Test fun liveTextWinsWithoutAnUpload() = runBlocking {
        val out = TakeTranscription.outcome(kotlinx.coroutines.CompletableDeferred("谢谢"), online = { true }, compare = cmp) { fail("no upload"); "" }
        assertTrue((out.ui as TranscriptionUi.Done).result.isMatch)
        assertEquals("live", out.via)
        assertNull(out.liveError)
    }

    @Test fun blankLiveTextUploadsAndSaysWhy() = runBlocking {
        var sent: String? = null
        val out = TakeTranscription.outcome(kotlinx.coroutines.CompletableDeferred("  "), online = { true }, compare = cmp) { sent = it; "谢谢" }
        assertEquals("upload", out.via)
        assertEquals("live returned no text", sent)
    }

    @Test fun aLiveTimeoutIsAFailureNotACancellation() = runBlocking {
        // SonioxStream.finish() times out with a TimeoutCancellationException inside the deferred.
        val timedOut = kotlinx.coroutines.CompletableDeferred<String>().apply { completeExceptionally(kotlinx.coroutines.CancellationException("Timed out waiting for 4000 ms")) }
        val out = TakeTranscription.outcome(timedOut, online = { true }, compare = cmp) { "谢谢" }
        assertEquals("upload", out.via)
        assertEquals("Timed out waiting for 4000 ms", out.liveError)
    }

    @Test fun offlineSaysSo() = runBlocking {
        assertEquals(TranscriptionUi.Offline, TakeTranscription.outcome(null, online = { false }, compare = cmp) { fail("no upload"); "" }.ui)
        val o = TakeTranscription.outcome(failed("socket failure"), online = { false }, compare = cmp) { fail("no upload"); "" }
        assertEquals(TranscriptionUi.Offline, o.ui)
        assertEquals("socket failure", o.liveError)
    }

    /** End to end over a real socket: Soniox refuses the take (402) and the upload fails too. */
    @Test fun sonioxRefusesTheTakeAndTheUploadFails() = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) {
                webSocket.send("""{"tokens":[],"error_code":402,"error_type":"organization_balance_exhausted","error_message":"Balance exhausted"}""")
                webSocket.close(1000, null)
            }
        }))
        server.start()
        val stream = SonioxStream(OkHttpClient(), session(server))
        stream.send(ByteArray(3200), 3200)
        val live = kotlinx.coroutines.CompletableDeferred<String>()
        runCatching { stream.finish(timeoutMs = 2_000) }.fold({ live.complete(it) }, { live.completeExceptionally(it) })
        val out = TakeTranscription.outcome(live, online = { true }, compare = cmp) { throw java.io.IOException("HTTP 502") }
        assertEquals(TranscriptionUi.Failed, out.ui)
        assertEquals("Soniox 402: Balance exhausted", out.liveError)
        server.shutdown()
    }

    @Test fun aRefusedKeyIsForgotten() = runBlocking {
        var calls = 0
        val cache = LiveSessionCache(now = { 0L }) { calls++; LiveTranscriptionSessionDto("soniox", "k$calls", "2099-01-01T00:00:00Z", "wss://x", "stt-rt-v5") }
        kotlinx.coroutines.coroutineScope { cache.prefetch(this) }
        assertEquals("k1", cache.usable()?.api_key)
        cache.invalidate()
        assertNull(cache.usable())
        kotlinx.coroutines.coroutineScope { cache.prefetch(this) }
        assertEquals("k2", cache.usable()?.api_key)
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
            // Like the real Soniox: ONLY an empty TEXT frame ends the stream. An empty BINARY frame
            // is just an empty audio chunk ("does not end the stream", Soniox's WebSocket docs) —
            // the Lab app used to send that, so every take waited out the 4 s timeout and went
            // the slow upload way instead ("live stream failed on lab: Timed out waiting for 4000 ms").
            override fun onMessage(webSocket: WebSocket, text: String) {
                got.add(text)
                // Like Soniox since Oct 2026: the key comes WITH the connection; a config frame
                // carrying `api_key` is the deprecated way, refused here.
                if (got.size == 1 && text.contains("\"api_key\"")) {
                    webSocket.send("""{"tokens":[],"error_code":401,"error_message":"key not sent with the connection"}""")
                    webSocket.close(1000, null)
                    return
                }
                if (text.isEmpty() && answer) {
                    webSocket.send("""{"tokens":[{"text":"是","is_final":true},{"text":"<fin>","is_final":true}]}""")
                    webSocket.send("""{"tokens":[],"finished":true}""")
                    webSocket.close(1000, null)
                }
            }
            override fun onMessage(webSocket: WebSocket, bytes: ByteString) { got.add(bytes.size) }
            override fun onOpen(webSocket: WebSocket, response: Response) {}
        }))
        server.start()
        return server to got
    }

    private fun session(server: MockWebServer) = LiveTranscriptionSessionDto(
        "soniox", "snx_temp_1", "2099-01-01T00:00:00Z", server.url("/").toString().replace("http", "ws"), "stt-rt-v5", listOf("zh", "en"),
    )

    @Test fun streamSendsConfigThenAudioThenEndAndReturnsTheText() = runBlocking {
        val (server, got) = fakeSoniox()
        val stream = SonioxStream(OkHttpClient(), session(server))
        stream.send(ByteArray(3200), 3200) // queued until the socket opens
        stream.send(ByteArray(3200), 1600)
        assertEquals("是", stream.finish())
        val config = Json.parseToJsonElement(got[0] as String).jsonObject
        assertFalse(config.containsKey("api_key"))
        assertEquals("pcm_s16le", config["audio_format"]!!.jsonPrimitive.content)
        // The key rode on the WebSocket handshake as a Bearer header.
        assertEquals("Bearer snx_temp_1", server.takeRequest().getHeader("Authorization"))
        // Audio as binary frames, then the end of audio as an EMPTY TEXT frame.
        assertEquals(listOf<Any>(3200, 1600, ""), got.drop(1))
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
