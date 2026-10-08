package dev.jeromeswannack.chineselearning.lab.ui.study

import dev.jeromeswannack.chineselearning.lab.data.api.LiveTranscriptionSessionDto
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString
import java.time.Instant

/**
 * Port of shared/transcription/soniox.ts: the Soniox real-time protocol the take is
 * streamed over, so "You said: …" is ready right after Stop instead of after an upload to
 * Whisper. The phone streams raw 16 kHz mono PCM (AudioRecord) → `pcm_s16le`.
 */
object SonioxProtocol {
    const val SAMPLE_RATE = 16_000

    /**
     * `SONIOX_END_OF_AUDIO`: the end of audio is an EMPTY TEXT frame. An empty BINARY frame
     * (`ByteString.EMPTY`) is only an empty audio chunk to Soniox and does NOT end the stream —
     * sending that made every Lab take wait out the 4 s timeout and fall back to the upload.
     */
    const val END_OF_AUDIO = ""

    /** `liveErrorKind`: why live gave nothing, as an analytics enum (never the raw message). */
    fun errorKind(reason: String?): String {
        val r = reason?.trim().orEmpty()
        if (r.isEmpty()) return "none"
        Regex("^Soniox (\\d{3})\\b").find(r)?.let { return "soniox_${it.groupValues[1]}" }
        if (r.startsWith("Soniox")) return "soniox_error"
        val l = r.lowercase()
        return when {
            "timed out" in l || "timeout" in l -> "timeout"
            "no text" in l -> "empty"
            "closed early" in l -> "closed"
            "aborted" in l -> "aborted"
            "no live session" in l -> "no_session"
            else -> "socket"
        }
    }

    /** `buildSonioxConfig` — no `context`: biasing towards the answer would hide mistakes. */
    fun config(apiKey: String, model: String, languageHints: List<String>, sampleRate: Int = SAMPLE_RATE, channels: Int = 1): String =
        buildJsonObject {
            put("api_key", apiKey)
            put("model", model)
            put("language_hints", buildJsonArray { languageHints.forEach { add(JsonPrimitive(it)) } })
            put("audio_format", "pcm_s16le")
            put("sample_rate", sampleRate)
            put("num_channels", channels)
        }.toString()

    data class Transcript(val finalText: String = "", val partialText: String = "", val finished: Boolean = false, val error: String? = null) {
        /** `transcriptText`: everything confirmed plus any provisional tail. */
        val text: String get() = (finalText + partialText).trim()
    }

    private val MARKERS = setOf("<fin>", "<end>")

    /** `applySonioxMessage`: folds one server message into the running transcript. */
    fun apply(state: Transcript, raw: String): Transcript {
        val msg = runCatching { Json.parseToJsonElement(raw) as? JsonObject }.getOrNull() ?: return state
        // Only a real error: a null / absent `error_code` next to tokens is a normal response.
        val errCode = msg["error_code"]?.takeUnless { it is kotlinx.serialization.json.JsonNull }
        val errMessage = msg["error_message"]?.takeUnless { it is kotlinx.serialization.json.JsonNull }
        if (errCode != null || errMessage != null) {
            val code = (msg["error_code"] as? JsonPrimitive)?.contentOrNull.orEmpty()
            val message = (msg["error_message"] as? JsonPrimitive)?.contentOrNull ?: "error"
            return state.copy(error = "Soniox $code: $message".trim())
        }
        var finalText = state.finalText
        val partial = StringBuilder()
        for (t in (msg["tokens"] as? JsonArray).orEmpty()) {
            val o = t as? JsonObject ?: continue
            val text = (o["text"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: continue
            if (text in MARKERS) continue
            if ((o["is_final"] as? JsonPrimitive)?.booleanOrNull == true) finalText += text else partial.append(text)
        }
        val finished = state.finished || (msg["finished"] as? JsonPrimitive)?.booleanOrNull == true
        return Transcript(finalText, partial.toString(), finished, state.error)
    }

    /**
     * `liveFailureInvalidatesKey`: Soniox refused the key itself (401 / 403), so drop the cached
     * one and mint a fresh key for the next take instead of failing until it expires.
     */
    fun invalidatesKey(reason: String): Boolean = Regex("^Soniox (401|403)\\b").containsMatchIn(reason.trim())

    /** `liveKeyUsable`: reuse a temporary key until a minute before it expires. */
    fun usable(session: LiveTranscriptionSessionDto?, nowMs: Long, marginMs: Long = 60_000): Boolean {
        if (session == null || session.provider != "soniox" || session.api_key.isNullOrBlank() || session.websocket_url.isNullOrBlank()) return false
        val expires = runCatching { Instant.parse(session.expires_at).toEpochMilli() }.getOrNull() ?: return false
        return expires - marginMs > nowMs
    }
}

/**
 * The temporary key, fetched ahead of time (when a read card shows) so Record never waits
 * on it: [usable] is synchronous — no key yet means this take goes the upload way.
 */
class LiveSessionCache(private val now: () -> Long = System::currentTimeMillis, private val fetch: suspend () -> LiveTranscriptionSessionDto) {
    @Volatile private var session: LiveTranscriptionSessionDto? = null
    @Volatile private var retryAfter = 0L
    private var job: Job? = null

    fun usable(): LiveTranscriptionSessionDto? = session?.takeIf { SonioxProtocol.usable(it, now()) }

    /** The key was refused: forget it so the next read card mints a fresh one. */
    fun invalidate() {
        session = null
        retryAfter = 0L
    }

    fun prefetch(scope: CoroutineScope) {
        if (session?.provider == "upload" || usable() != null || now() < retryAfter || job?.isActive == true) return
        job = scope.launch {
            runCatching { fetch() }
                .onSuccess { session = it }
                .onFailure { retryAfter = now() + 60_000 }
        }
    }
}

/**
 * One take streamed to Soniox (the web's LiveTranscriber). Audio sent before the socket
 * opens is queued; [finish] sends the end of audio (an EMPTY TEXT frame) and returns the final text,
 * or throws (error, early close, timeout) so the caller uploads the take instead.
 */
class SonioxStream(http: OkHttpClient, private val session: LiveTranscriptionSessionDto) {
    private val lock = Any()
    private var open = false
    private var ended = false
    private val queue = ArrayList<ByteString>()
    private var transcript = SonioxProtocol.Transcript()
    private val result = CompletableDeferred<String>()
    private val socket: WebSocket

    init {
        socket = http.newWebSocket(Request.Builder().url(session.websocket_url!!).build(), object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                synchronized(lock) {
                    webSocket.send(SonioxProtocol.config(session.api_key!!, session.model ?: "stt-rt-v5", session.language_hints.ifEmpty { listOf("zh", "en") }))
                    queue.forEach { webSocket.send(it) }
                    queue.clear()
                    open = true
                    if (ended) webSocket.send(SonioxProtocol.END_OF_AUDIO)
                }
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                val t = synchronized(lock) { SonioxProtocol.apply(transcript, text).also { transcript = it } }
                when {
                    t.error != null -> fail(t.error)
                    t.finished -> succeed()
                }
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(1000, null)
                if (synchronized(lock) { ended }) succeed() else fail("closed early")
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                if (synchronized(lock) { ended }) succeed() else fail("closed early")
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = fail(t.message ?: "socket failure")
        })
    }

    /** 16-bit little-endian mono PCM from the microphone. */
    fun send(pcm: ByteArray, length: Int) {
        if (length <= 0 || result.isCompleted) return
        val bytes = pcm.toByteString(0, length)
        synchronized(lock) {
            if (ended) return
            if (open) socket.send(bytes) else queue.add(bytes)
        }
    }

    suspend fun finish(timeoutMs: Long = 4_000): String {
        synchronized(lock) {
            if (!ended) {
                ended = true
                if (open) socket.send(SonioxProtocol.END_OF_AUDIO)
            }
        }
        return try {
            withTimeout(timeoutMs) { result.await() }
        } finally {
            socket.cancel()
        }
    }

    fun abort() {
        fail("aborted")
        socket.cancel()
    }

    private fun succeed() {
        val text = synchronized(lock) { transcript.text }
        result.complete(text)
    }

    private fun fail(reason: String) {
        result.completeExceptionally(IllegalStateException(reason))
    }
}
