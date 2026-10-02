package dev.jeromeswannack.chineselearning.lab.data.chat

import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.data.HttpException
import dev.jeromeswannack.chineselearning.lab.data.UnauthorizedException
import dev.jeromeswannack.chineselearning.lab.data.api.ChatMessageDto
import dev.jeromeswannack.chineselearning.lab.data.api.liveTicket
import dev.jeromeswannack.chineselearning.lab.ui.connections.Connections
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.TimeUnit

/** What the ChatHub says (docs/CHAT.md §4), for the open chat and the notifier. */
sealed interface LiveEvent {
    /** A new message in [conversationId] ([message] null when only a push said so: refetch). */
    data class Message(val conversationId: String, val message: ChatMessageDto?, val relationshipId: String?) : LiveEvent
    data class Read(val conversationId: String, val userId: String, val lastReadAt: String?) : LiveEvent
    data class Typing(val conversationId: String, val userId: String) : LiveEvent
}

/**
 * The foreground live socket (docs/CHAT.md §2 / §4): while the app is in the foreground, signed
 * in and online, `POST /api/live/ticket` → WebSocket `wss://<api>/api/live/ws?ticket=` into my
 * ChatHub; ping every 25 s; reconnect with backoff; after each connect, catch up through the
 * inbox. A `message` for me → notification (unless that chat is on screen — the chat collects
 * [events] and shows it at once); a `read` by me → drop that conversation's notification.
 * The socket is a doorbell: the REST API stays the source of truth, and the open chat keeps
 * polling (slowly while [connected], every 3 s when not).
 */
class ChatLive(private val app: LabApp) {
    private val _events = MutableSharedFlow<LiveEvent>(extraBufferCapacity = 64)
    val events: SharedFlow<LiveEvent> = _events.asSharedFlow()

    private val _connected = MutableStateFlow(false)
    val connected: StateFlow<Boolean> = _connected

    private val signedIn = MutableStateFlow(false)
    private var job: Job? = null
    private var myId: String? = null

    private val client by lazy {
        app.repo.api.http.newBuilder().readTimeout(0, TimeUnit.MILLISECONDS).pingInterval(0, TimeUnit.SECONDS).build()
    }

    /** Starts following foreground / network / sign-in (LabApp start). */
    @OptIn(ExperimentalCoroutinesApi::class)
    fun start() {
        if (job != null) return
        signedIn.value = app.repo.isSignedIn
        job = app.scope.launch {
            combine(ChatPresence.foreground, app.online, signedIn) { fg, online, s -> fg && online && s }
                .distinctUntilChanged()
                .collectLatest { run -> if (run) loop() else _connected.value = false }
        }
    }

    /** After sign-in / before sign-out. */
    fun setSignedIn(value: Boolean) { signedIn.value = value }

    /** An FCM push for a conversation: an open chat refetches at once. */
    fun nudge(conversationId: String) { _events.tryEmit(LiveEvent.Message(conversationId, null, null)) }

    private suspend fun loop() {
        var backoff = MIN_BACKOFF_MS
        while (true) {
            val startedAt = System.currentTimeMillis()
            val wait = try {
                session()
                if (System.currentTimeMillis() - startedAt > STABLE_MS) MIN_BACKOFF_MS else backoff
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: UnauthorizedException) {
                LONG_BACKOFF_MS
            } catch (e: HttpException) {
                // 404 / 503 until the worker has the ChatHub ("not set up"); other 5xx: try again soon.
                if (e.code in 400..499 || e.code == 503) LONG_BACKOFF_MS else backoff
            } catch (e: Exception) {
                backoff
            } finally {
                _connected.value = false
            }
            delay(wait + (Math.random() * 500).toLong())
            backoff = (backoff * 2).coerceAtMost(MAX_BACKOFF_MS)
        }
    }

    /** One socket, until it closes or fails (or the coroutine is cancelled → close). */
    private suspend fun session() {
        if (myId == null) myId = Connections.myId(app.cache)
        val ticket = app.repo.api.liveTicket()
        val url = wsUrl(app.repo.api.baseUrl, ticket.ws_path, ticket.ticket)
        val closed = CompletableDeferred<Throwable?>()
        val ws = client.newWebSocket(Request.Builder().url(url).build(), object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                _connected.value = true
                app.scope.launch { ChatInboxCheck.runFor(app) } // catch up on what came while away
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                app.scope.launch { runCatching { handle(text) } }
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(1000, null)
                closed.complete(null)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { closed.complete(null) }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) { closed.complete(t) }
        })
        try {
            coroutineScope {
                val ping = launch {
                    while (true) {
                        delay(PING_MS)
                        ws.send("""{"type":"ping"}""")
                    }
                }
                closed.await()
                ping.cancel()
            }
        } finally {
            ws.close(1000, null)
            ws.cancel()
        }
    }

    internal suspend fun handle(text: String) {
        val obj = runCatching { app.repo.api.json.parseToJsonElement(text).jsonObject }.getOrNull() ?: return
        when (obj.str("type")) {
            "hello" -> obj.str("user_id")?.let { myId = it }
            "message" -> {
                val m = obj["message"]?.let { runCatching { app.repo.api.json.decodeFromJsonElement(ChatMessageDto.serializer(), it) }.getOrNull() } ?: return
                val rel = obj.str("relationship_id")
                _events.emit(LiveEvent.Message(m.conversation_id, m, rel))
                val me = myId ?: Connections.myId(app.cache)
                if (m.sender_id == me || m.sender.id == me) {
                    // Sent from my other device: I've seen this chat.
                    ChatNotifier.cancel(app, m.conversation_id)
                } else if (rel != null) {
                    ChatNotifier.notifyIncoming(app, IncomingChat.fromMessage(m, rel), me)
                }
            }
            "read" -> {
                val conv = obj.str("conversation_id") ?: return
                val user = obj.str("user_id").orEmpty()
                _events.emit(LiveEvent.Read(conv, user, obj.str("last_read_at")))
                if (user == (myId ?: Connections.myId(app.cache))) ChatNotifier.cancel(app, conv)
            }
            "typing" -> {
                val conv = obj.str("conversation_id") ?: return
                _events.emit(LiveEvent.Typing(conv, obj.str("user_id").orEmpty()))
            }
        }
    }

    private fun JsonObject.str(key: String): String? = runCatching { this[key]?.jsonPrimitive?.contentOrNull }.getOrNull()

    companion object {
        const val PING_MS = 25_000L
        const val MIN_BACKOFF_MS = 1_000L
        const val MAX_BACKOFF_MS = 30_000L
        const val LONG_BACKOFF_MS = 5 * 60_000L
        const val STABLE_MS = 30_000L

        /** `https://host` + `/api/live/ws` → `wss://host/api/live/ws?ticket=…`. */
        fun wsUrl(baseUrl: String, wsPath: String, ticket: String): String {
            val base = when {
                baseUrl.startsWith("https://") -> "wss://" + baseUrl.removePrefix("https://")
                baseUrl.startsWith("http://") -> "ws://" + baseUrl.removePrefix("http://")
                else -> baseUrl
            }.trimEnd('/')
            val path = if (wsPath.startsWith("/")) wsPath else "/$wsPath"
            return "$base$path?ticket=" + java.net.URLEncoder.encode(ticket, "UTF-8")
        }
    }
}
