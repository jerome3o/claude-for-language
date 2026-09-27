package dev.jeromeswannack.chineselearning.lab.data.calls

import dev.jeromeswannack.chineselearning.lab.core.calls.CallProtocol
import dev.jeromeswannack.chineselearning.lab.core.calls.ServerMessage
import dev.jeromeswannack.chineselearning.lab.data.HttpException
import dev.jeromeswannack.chineselearning.lab.data.api.CallJoinDto
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.TimeUnit

enum class RoomStatus { CONNECTING, OPEN, RECONNECTING, CLOSED }

/** What the call screen hears from the room. Called on the socket's threads — hop to your own. */
interface RoomHandlers {
    fun onMessage(msg: ServerMessage)
    fun onStatus(status: RoomStatus)
    fun onJoinInfo(info: CallJoinDto) {}
    /** A fatal error (the call ended, access refused, joined elsewhere) — no more reconnects. */
    fun onFatal(message: String)
}

/** One live connection to the call room (a fake in tests). */
interface CallRoom {
    /** serverTime − localTime (ms), for the recorder. */
    val clockOffset: Long
    fun connect()
    fun send(text: String): Boolean
    fun close()
}

/**
 * The WebSocket to the call room (port of frontend/src/services/calls/room.ts). Each connect asks
 * the API for a fresh one-minute join ticket ([join] = `POST /api/calls/:id/join`), then opens the
 * socket; a dropped socket reconnects with backoff until the call ends or [close]. Keeps the
 * server clock offset (welcome, then every pong) for the recorder.
 */
class CallRoomSocket(
    private val join: suspend () -> CallJoinDto,
    private val http: OkHttpClient,
    private val baseUrl: String,
    private val handlers: RoomHandlers,
    private val scope: CoroutineScope,
    private val now: () -> Long = System::currentTimeMillis,
    private val pingMs: Long = 20_000,
) : CallRoom {
    @Volatile private var ws: WebSocket? = null
    @Volatile private var open = false
    @Volatile private var closed = false
    private var attempt = 0
    private var everOpened = false
    private var ping: Job? = null
    private var retry: Job? = null

    @Volatile override var clockOffset = 0L
        private set

    override fun connect() {
        scope.launch { connectOnce() }
    }

    private suspend fun connectOnce() {
        if (closed) return
        handlers.onStatus(if (attempt == 0) RoomStatus.CONNECTING else RoomStatus.RECONNECTING)
        val info = try {
            join()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            val code = (e as? HttpException)?.code
            // Access / ended errors are final, and so is a first join that keeps failing.
            if (code == 404 || code == 409 || code == 403 || (!everOpened && attempt >= 3)) {
                closed = true
                handlers.onFatal("Could not join the call: ${e.userMessage()}")
                return
            }
            scheduleReconnect()
            return
        }
        if (closed) return
        handlers.onJoinInfo(info)
        val request = Request.Builder().url(socketUrl(baseUrl, info.ws_path, info.ticket)).build()
        ws = http.newBuilder().pingInterval(0, TimeUnit.SECONDS).build().newWebSocket(request, Listener())
    }

    private inner class Listener : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            if (webSocket !== ws) return
            attempt = 0
            everOpened = true
            open = true
            handlers.onStatus(RoomStatus.OPEN)
            ping?.cancel()
            ping = scope.launch { while (isActive) { delay(pingMs); send(CallProtocol.ping(now())) } }
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            val msg = CallProtocol.parseServer(text) ?: return
            when (msg) {
                is ServerMessage.Welcome -> clockOffset = msg.serverTime - now()
                is ServerMessage.Pong -> {
                    val rtt = now() - msg.t
                    if (rtt in 0 until 5000) clockOffset = msg.serverTime + rtt / 2 - now()
                }
                is ServerMessage.Ended, ServerMessage.Replaced -> closed = true
                else -> Unit
            }
            handlers.onMessage(msg)
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            webSocket.close(code, null)
            gone(webSocket, code)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = gone(webSocket, code)

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = gone(webSocket, null)
    }

    @Synchronized
    private fun gone(webSocket: WebSocket, code: Int?) {
        if (webSocket !== ws) return
        ws = null
        open = false
        ping?.cancel()
        if (closed) {
            handlers.onStatus(RoomStatus.CLOSED)
            return
        }
        if (code == 4000) {
            closed = true
            handlers.onFatal("You joined this call from another tab or device.")
            return
        }
        scheduleReconnect()
    }

    private fun scheduleReconnect() {
        if (closed) return
        attempt++
        handlers.onStatus(RoomStatus.RECONNECTING)
        val wait = minOf(15_000L, 500L * (1L shl minOf(attempt, 5)))
        retry?.cancel()
        retry = scope.launch { delay(wait); connectOnce() }
    }

    override fun send(text: String): Boolean {
        val socket = ws ?: return false
        if (!open) return false
        return socket.send(text)
    }

    override fun close() {
        closed = true
        retry?.cancel()
        ping?.cancel()
        ws?.close(1000, "Left the call")
        ws = null
        open = false
    }

    companion object {
        /** ws(s):// URL of the room: the API's origin + `ws_path` + `?ticket=` (web: callSocketUrl). */
        fun socketUrl(baseUrl: String, wsPath: String, ticket: String): String {
            val origin = baseUrl.trimEnd('/').replaceFirst(Regex("^https://"), "wss://").replaceFirst(Regex("^http://"), "ws://")
            val path = if (wsPath.startsWith("/")) wsPath else "/$wsPath"
            return "$origin$path?ticket=${java.net.URLEncoder.encode(ticket, "UTF-8")}"
        }
    }
}
