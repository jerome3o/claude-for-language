package dev.jeromeswannack.chineselearning.lab.ui.study

import dev.jeromeswannack.chineselearning.lab.data.api.LiveTranscriptionSessionDto
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
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
 *
 * Authentication: the temporary key goes WITH THE CONNECTION as `Authorization: Bearer <key>`
 * on the WebSocket request ([authorizationHeader]; soniox.com/docs/guides/websocket-authentication)
 * — never in the config frame (deprecated, refused with 401 from 15 January 2027). The web app,
 * which can't set headers, uses the subprotocols `soniox-api-key` + key instead.
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

    /** `sonioxAuthorizationHeader`: the handshake header (works for `snx_temp_` and old `temp:` keys). */
    fun authorizationHeader(apiKey: String): String = "Bearer $apiKey"

    /**
     * `buildSonioxConfig` — no `api_key` (it goes with the connection, [authorizationHeader]) and
     * no `context`: biasing towards the answer would hide mistakes.
     */
    fun config(model: String, languageHints: List<String>, sampleRate: Int = SAMPLE_RATE, channels: Int = 1): String =
        buildJsonObject {
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

    /** [marginMs]: how long the key must still live (a lesson's speaking take needs minutes). */
    fun usable(marginMs: Long = 60_000): LiveTranscriptionSessionDto? = session?.takeIf { SonioxProtocol.usable(it, now(), marginMs) }

    /** The key was refused: forget it so the next read card mints a fresh one. */
    fun invalidate() {
        session = null
        retryAfter = 0L
    }

    fun prefetch(scope: CoroutineScope, marginMs: Long = 60_000) {
        if (session?.provider == "upload" || usable(marginMs) != null || now() < retryAfter || job?.isActive == true) return
        job = scope.launch {
            runCatching { fetch() }
                .onSuccess { session = it }
                .onFailure { retryAfter = now() + 60_000 }
        }
    }

    /**
     * A usable key now, else one fetched (sharing a prefetch in flight); null when the server has
     * no live provider, a mint failed in the last minute, or this mint fails.
     */
    suspend fun get(marginMs: Long = 60_000): LiveTranscriptionSessionDto? {
        usable(marginMs)?.let { return it }
        if (session?.provider == "upload" || now() < retryAfter) return null
        job?.takeIf { it.isActive }?.join()
        usable(marginMs)?.let { return it }
        if (session?.provider == "upload" || now() < retryAfter) return null
        return runCatching { fetch() }
            .onSuccess { session = it }
            .onFailure { retryAfter = now() + 60_000 }
            .getOrNull()
            ?.takeIf { SonioxProtocol.usable(it, now(), marginMs) }
    }

    /**
     * The live stream for one take (the web's `new LiveTranscriber(getLiveSession())`): at once with a
     * usable key, else a [DeferredLiveStream] that fetches a fresh key while the take records — so a key
     * that expired while a card sat on screen (Nov 2026: a card left open for an hour sent every take the
     * 4 s upload way) or was never fetched (the first card came up before the phone was online) still
     * streams. Null only when live can't happen (the server has no live provider, a mint just failed).
     */
    fun stream(scope: CoroutineScope, marginMs: Long = 60_000, open: (LiveTranscriptionSessionDto) -> LiveStream): LiveStream? {
        usable(marginMs)?.let { s -> return runCatching { open(s) }.getOrNull() }
        if (session?.provider == "upload" || now() < retryAfter) return null
        return DeferredLiveStream(scope.async { get(marginMs) }, open)
    }
}

/**
 * A take's live stream whose key is still being fetched: the microphone's audio is kept until the key
 * arrives, then the real stream opens and gets it all (it queues audio until its socket is open, like
 * [SonioxStream]). No key → [finish] throws "no_session" (the analytics' live_error) and the take is
 * uploaded as before.
 */
@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class DeferredLiveStream(
    private val key: kotlinx.coroutines.Deferred<LiveTranscriptionSessionDto?>,
    private val open: (LiveTranscriptionSessionDto) -> LiveStream,
) : LiveStream {
    private val lock = Any()
    private val pending = ArrayList<ByteArray>()
    private var inner: LiveStream? = null
    private var aborted = false
    private var failed: String? = null

    init {
        key.invokeOnCompletion { error ->
            val session = if (error == null) runCatching { key.getCompleted() }.getOrNull() else null
            synchronized(lock) {
                if (aborted) return@invokeOnCompletion
                val stream = session?.let { runCatching { open(it) }.getOrNull() }
                if (stream == null) {
                    failed = "no_session"
                    pending.clear()
                    return@invokeOnCompletion
                }
                pending.forEach { stream.send(it, it.size) }
                pending.clear()
                inner = stream
            }
        }
    }

    override fun send(pcm: ByteArray, length: Int) {
        if (length <= 0) return
        synchronized(lock) {
            if (aborted || failed != null) return
            inner?.let { return it.send(pcm, length) }
            // ~20 s of 16 kHz mono PCM at most while the key comes (it takes well under a second).
            if (pending.sumOf { it.size } + length <= MAX_PENDING_BYTES) pending.add(pcm.copyOf(length))
        }
    }

    override suspend fun finish(timeoutMs: Long): String {
        val start = System.currentTimeMillis()
        withTimeout(timeoutMs) { key.join() }
        val stream = synchronized(lock) { inner } ?: throw IllegalStateException(synchronized(lock) { failed } ?: "no_session")
        return stream.finish((timeoutMs - (System.currentTimeMillis() - start)).coerceAtLeast(1_000))
    }

    override fun abort() {
        val stream = synchronized(lock) {
            aborted = true
            pending.clear()
            inner
        }
        key.cancel()
        stream?.abort()
    }

    private companion object {
        const val MAX_PENDING_BYTES = 16_000 * 2 * 20
    }
}

/** One take's live stream ([SonioxStream]); fakeable in tests. */
interface LiveStream {
    /** 16-bit little-endian mono PCM from the microphone. */
    fun send(pcm: ByteArray, length: Int)
    /** End of audio: the final text, or throws (→ the upload). */
    suspend fun finish(timeoutMs: Long = 4_000): String
    fun abort()
}

/**
 * Where a typing card's spoken answer is transcribed (StudyViewModel's "say the answer"): a live
 * stream for the take ([open], null = no key / offline → upload only; [onUpdate] gets the running
 * transcript off the main thread) and the upload path. Tests pass a fake.
 */
interface SpokenTranscription {
    fun open(onUpdate: (SonioxProtocol.Transcript) -> Unit): LiveStream?
    suspend fun upload(take: java.io.File, mime: String, liveError: String?): String
}

/**
 * One take streamed to Soniox (the web's LiveTranscriber). Audio sent before the socket
 * opens is queued; [finish] sends the end of audio (an EMPTY TEXT frame) and returns the final text,
 * or throws (error, early close, timeout) so the caller uploads the take instead. [onUpdate] gets
 * every response folded in (the web's `onUpdate`: a typing card shows the words as they come).
 */
class SonioxStream(
    http: OkHttpClient,
    private val session: LiveTranscriptionSessionDto,
    private val onUpdate: ((SonioxProtocol.Transcript) -> Unit)? = null,
) : LiveStream {
    private val lock = Any()
    private var open = false
    private var ended = false
    private val queue = ArrayList<ByteString>()
    private var transcript = SonioxProtocol.Transcript()
    private val result = CompletableDeferred<String>()
    private val socket: WebSocket

    init {
        val request = Request.Builder()
            .url(session.websocket_url!!)
            .header("Authorization", SonioxProtocol.authorizationHeader(session.api_key!!))
            .build()
        socket = http.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                synchronized(lock) {
                    webSocket.send(SonioxProtocol.config(session.model ?: "stt-rt-v5", session.language_hints.ifEmpty { listOf("zh", "en") }))
                    queue.forEach { webSocket.send(it) }
                    queue.clear()
                    open = true
                    if (ended) webSocket.send(SonioxProtocol.END_OF_AUDIO)
                }
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                val t = synchronized(lock) { SonioxProtocol.apply(transcript, text).also { transcript = it } }
                if (t.error == null) runCatching { onUpdate?.invoke(t) }
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

    override fun send(pcm: ByteArray, length: Int) {
        if (length <= 0 || result.isCompleted) return
        val bytes = pcm.toByteString(0, length)
        synchronized(lock) {
            if (ended) return
            if (open) socket.send(bytes) else queue.add(bytes)
        }
    }

    override suspend fun finish(timeoutMs: Long): String {
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

    override fun abort() {
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
