package dev.jeromeswannack.chineselearning.lab.data.calls

import dev.jeromeswannack.chineselearning.lab.core.calls.CallGoals
import dev.jeromeswannack.chineselearning.lab.data.api.LiveTranscriptionSessionDto
import dev.jeromeswannack.chineselearning.lab.data.calls.rtc.MicTap
import dev.jeromeswannack.chineselearning.lab.ui.study.SonioxProtocol
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString.Companion.toByteString
import java.time.Instant

/** The structure listener as the call controller sees it (fakeable in tests). */
interface GoalListening {
    /** Listen (again): every finished utterance → [onUtterance]; state "connecting" | "listening" | "unavailable" → [onState]. */
    fun start(onUtterance: (String) -> Unit, onState: (String) -> Unit)
    fun stop()
}

/**
 * Port of frontend/src/services/calls/goalListener.ts — 🎯 the call's structure listener (docs/VIDEO_CALLS.md
 * "Structures to use"): streams the STUDENT's own mic (the call's [MicTap], 48 kHz mono, as `pcm_s16le`) to
 * Soniox real-time with endpoint detection while the call has goals, and hands back each finished utterance
 * ([CallGoals.foldGoalSpeech]). One SEGMENT = one socket on one key; a new segment starts before the key runs out
 * (or [ROTATE_MS] in) and the old one is ended (end of audio — its last words still arrive) once the new one is open.
 * A dropped segment reconnects with a backoff; [MAX_FAILURES] in a row, or no live provider → "unavailable" and one
 * more try after [UNAVAILABLE_RETRY_MS]. Only text comes back; no audio goes anywhere new.
 */
class CallGoalListener(
    private val http: OkHttpClient,
    private val mic: MicTap,
    private val scope: CoroutineScope,
    private val mint: suspend () -> LiveTranscriptionSessionDto,
    private val now: () -> Long = System::currentTimeMillis,
) : GoalListening {
    private inner class Segment {
        var socket: WebSocket? = null
        var open = false
        var ending = false
        var dead = false
        var pending = ""
        val queue = ArrayList<okio.ByteString>()
        var rotate: Job? = null
    }

    private val lock = Any()
    private var running = false
    private var current: Segment? = null
    private val live = HashSet<Segment>()
    private var failures = 0
    private var retry: Job? = null
    private var onUtterance: (String) -> Unit = {}
    private var onState: (String) -> Unit = {}

    override fun start(onUtterance: (String) -> Unit, onState: (String) -> Unit) {
        synchronized(lock) {
            this.onUtterance = onUtterance
            this.onState = onState
            if (running) return
            running = true
            failures = 0
        }
        onState("connecting")
        mic.setListener { pcm -> feed(pcm) }
        scope.launch { openSegment() }
    }

    override fun stop() {
        val ending: List<Segment>
        synchronized(lock) {
            if (!running) return
            running = false
            retry?.cancel()
            retry = null
            current = null
            ending = live.toList()
        }
        mic.setListener(null)
        ending.forEach(::endSegment)
    }

    private fun feed(pcm: ShortArray) {
        val bytes = ByteArray(pcm.size * 2)
        for (i in pcm.indices) {
            bytes[2 * i] = (pcm[i].toInt() and 0xff).toByte()
            bytes[2 * i + 1] = (pcm[i].toInt() shr 8 and 0xff).toByte()
        }
        val chunk = bytes.toByteString()
        synchronized(lock) {
            val seg = current ?: return
            if (seg.dead || seg.ending) return
            if (seg.open) seg.socket?.send(chunk)
            else if (seg.queue.sumOf { it.size } < MAX_QUEUE_BYTES) seg.queue.add(chunk)
        }
    }

    private fun emit(list: List<String>) = list.forEach { runCatching { onUtterance(it) } }

    private suspend fun openSegment() {
        if (!synchronized(lock) { running }) return
        val session = runCatching { mint() }.getOrNull()
        if (!synchronized(lock) { running }) return
        if (session == null || session.provider != "soniox" || session.api_key.isNullOrBlank() || session.websocket_url.isNullOrBlank()) {
            unavailable()
            return
        }
        val seg = Segment()
        synchronized(lock) {
            current = seg
            live += seg
        }
        val request = Request.Builder()
            .url(session.websocket_url)
            .header("Authorization", SonioxProtocol.authorizationHeader(session.api_key))
            .build()
        seg.socket = http.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                val older: List<Segment>
                synchronized(lock) {
                    webSocket.send(config(session))
                    seg.queue.forEach { webSocket.send(it) }
                    seg.queue.clear()
                    seg.open = true
                    failures = 0
                    older = live.filter { it !== seg }
                }
                onState("listening")
                older.forEach(::endSegment)
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                val utterances = synchronized(lock) {
                    val (p, u) = CallGoals.foldGoalSpeech(seg.pending, text)
                    seg.pending = p
                    u
                }
                emit(utterances)
                val msg = runCatching { Json.parseToJsonElement(text) as? JsonObject }.getOrNull() ?: return
                val err = msg["error_code"]?.takeUnless { it is kotlinx.serialization.json.JsonNull } ?: msg["error_message"]?.takeUnless { it is kotlinx.serialization.json.JsonNull }
                if (err != null) failed(seg, "soniox")
                else if ((msg["finished"] as? JsonPrimitive)?.booleanOrNull == true && seg.ending) close(seg)
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(1000, null)
                if (seg.ending) close(seg) else failed(seg, "closed")
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                if (seg.ending) close(seg) else failed(seg, "closed")
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = failed(seg, "socket")
        })
        val expires = runCatching { Instant.parse(session.expires_at).toEpochMilli() }.getOrNull()
        val until = maxOf(30_000L, minOf(ROTATE_MS, (expires?.minus(now()) ?: ROTATE_MS) - ROTATE_BEFORE_EXPIRY_MS))
        seg.rotate = scope.launch {
            delay(until)
            if (synchronized(lock) { running && current === seg }) openSegment()
        }
    }

    private fun config(session: LiveTranscriptionSessionDto): String = buildJsonObject {
        put("model", session.model ?: "stt-rt-v5")
        put("language_hints", buildJsonArray { session.language_hints.ifEmpty { listOf("zh", "en") }.forEach { add(JsonPrimitive(it)) } })
        put("audio_format", "pcm_s16le")
        put("sample_rate", SAMPLE_RATE)
        put("num_channels", 1)
        put("enable_endpoint_detection", true)
    }.toString()

    /** End of audio: Soniox finalises what it has and closes (or we close after [END_WAIT_MS]). */
    private fun endSegment(seg: Segment) {
        synchronized(lock) {
            if (seg.dead || seg.ending) return
            seg.ending = true
            seg.rotate?.cancel()
            if (!seg.open) { close(seg); return }
            seg.socket?.send(SonioxProtocol.END_OF_AUDIO)
        }
        scope.launch {
            delay(END_WAIT_MS)
            close(seg)
        }
    }

    private fun close(seg: Segment) {
        val flushed: List<String>
        synchronized(lock) {
            if (seg.dead) return
            seg.dead = true
            live -= seg
            seg.rotate?.cancel()
            flushed = CallGoals.flushGoalSpeech(seg.pending)
            seg.pending = ""
        }
        emit(flushed)
        seg.socket?.cancel()
    }

    private fun failed(seg: Segment, reason: String) {
        val wasCurrent = synchronized(lock) { current === seg && !seg.dead }
        close(seg)
        if (!wasCurrent || !synchronized(lock) { running }) return
        val n = synchronized(lock) { ++failures }
        if (n >= MAX_FAILURES) {
            unavailable()
            return
        }
        onState("connecting")
        val wait = RECONNECT_MS[minOf(n - 1, RECONNECT_MS.size - 1)]
        synchronized(lock) {
            retry = scope.launch {
                delay(wait)
                openSegment()
            }
        }
    }

    private fun unavailable() {
        onState("unavailable")
        synchronized(lock) {
            retry?.cancel()
            retry = scope.launch {
                delay(UNAVAILABLE_RETRY_MS)
                if (!synchronized(lock) { running }) return@launch
                synchronized(lock) { failures = 0 }
                onState("connecting")
                openSegment()
            }
        }
    }

    companion object {
        const val SAMPLE_RATE = 48_000
        const val ROTATE_BEFORE_EXPIRY_MS = 90_000L
        const val ROTATE_MS = 25 * 60_000L
        val RECONNECT_MS = listOf(2_000L, 4_000L, 8_000L, 15_000L, 30_000L)
        const val MAX_FAILURES = 5
        const val UNAVAILABLE_RETRY_MS = 120_000L
        const val END_WAIT_MS = 3_000L
        /** ~10 s of 48 kHz mono PCM while a segment's socket opens. */
        const val MAX_QUEUE_BYTES = 48_000 * 2 * 10
    }
}
