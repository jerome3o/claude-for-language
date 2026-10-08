package dev.jeromeswannack.chineselearning.lab.data.calls

import dev.jeromeswannack.chineselearning.lab.core.calls.ServerMessage
import dev.jeromeswannack.chineselearning.lab.data.HttpException
import dev.jeromeswannack.chineselearning.lab.data.api.CallJoinDto
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import okhttp3.OkHttpClient
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/** The room WebSocket (port of services/calls/room.ts) against a real WebSocket server. */
class CallRoomSocketTest {
    private lateinit var server: MockWebServer
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val events = LinkedBlockingQueue<String>()
    private val serverSockets = CopyOnWriteArrayList<WebSocket>()
    private val received = LinkedBlockingQueue<String>()
    /** Server-side sockets that finished closing — teardown waits for all of them before shutting the server down. */
    private val serverClosed = java.util.concurrent.atomic.AtomicInteger()

    private val handlers = object : RoomHandlers {
        override fun onMessage(msg: ServerMessage) { events += "msg:${msg::class.simpleName}" }
        override fun onStatus(status: RoomStatus) { events += "status:$status" }
        override fun onJoinInfo(info: CallJoinDto) { events += "join:${info.ticket}" }
        override fun onFatal(message: String) { events += "fatal:$message" }
    }

    private fun upgrade(onOpen: (WebSocket) -> Unit = {}) = MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) { serverSockets += webSocket; onOpen(webSocket) }
        override fun onMessage(webSocket: WebSocket, text: String) { received += text }
        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) { webSocket.close(1000, null) }
        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { serverClosed.incrementAndGet() }
        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) { serverClosed.incrementAndGet() }
    })

    @Before fun setUp() { server = MockWebServer().apply { start() } }

    @After fun tearDown() {
        scope.cancel()
        serverSockets.forEach { runCatching { it.close(1001, null) } }
        // Shutting the server down mid close-handshake times out on a slow runner: wait for every socket to finish.
        val deadline = System.currentTimeMillis() + 15_000
        while (serverClosed.get() < serverSockets.size && System.currentTimeMillis() < deadline) Thread.sleep(20)
        server.shutdown()
    }

    private fun next(prefix: String): String {
        while (true) {
            val e = events.poll(10, TimeUnit.SECONDS) ?: error("no event starting with $prefix")
            if (e.startsWith(prefix)) return e
        }
    }

    private fun socket(join: suspend () -> CallJoinDto, now: () -> Long = System::currentTimeMillis, pingMs: Long = 20_000, instance: String? = null, pongTimeoutMs: Long = 8_000, http: OkHttpClient = OkHttpClient()) =
        CallRoomSocket(join, http, server.url("/").toString().removeSuffix("/"), handlers, scope, now, pingMs, instance, pongTimeoutMs)

    /**
     * An OkHttp that runs the call on the caller's thread: the handshake finishes and onOpen fires
     * INSIDE newWebSocket(), before it returns the socket — what a fast network or a descheduled
     * thread does now and then for real. The room used to throw that socket away (it wasn't `ws`
     * yet): no OPEN, no pings, a test waiting 10 s for "status:OPEN" (CI flakes on main).
     */
    private fun openBeforeReturnClient() = OkHttpClient.Builder().dispatcher(okhttp3.Dispatcher(object : java.util.concurrent.AbstractExecutorService() {
        @Volatile private var down = false
        override fun execute(command: Runnable) = command.run()
        override fun shutdown() { down = true }
        override fun shutdownNow(): MutableList<Runnable> { down = true; return mutableListOf() }
        override fun isShutdown() = down
        override fun isTerminated() = down
        override fun awaitTermination(timeout: Long, unit: TimeUnit) = true
    })).build()

    @Test fun joinsWithATicketTracksTheClockAndSends() {
        server.enqueue(upgrade { it.send("""{"type":"welcome","client_id":"c1","server_time":5000,"started_at":1,"peers":[],"board":[],"chat":[]}""") })
        val room = socket({ CallJoinDto("tick et/1", "/api/calls/c9/ws") }, now = { 1_000L }, pingMs = 200)
        room.connect()
        assertEquals("status:CONNECTING", next("status"))
        assertEquals("join:tick et/1", next("join"))
        assertEquals("status:OPEN", next("status"))
        assertEquals("msg:Welcome", next("msg"))
        assertEquals(4_000L, room.clockOffset)
        val req = server.takeRequest()
        assertEquals("/api/calls/c9/ws?ticket=tick+et%2F1", req.path)
        assertTrue(room.send("""{"type":"chat","text":"你好"}"""))
        assertEquals("""{"type":"chat","text":"你好"}""", received.poll(5, TimeUnit.SECONDS))
        // Pings every [pingMs].
        assertTrue(received.poll(5, TimeUnit.SECONDS)!!.contains("\"type\":\"ping\""))
        room.close()
    }

    @Test fun sendsTheInstanceAndReconnectsWhenPongsStop() {
        // The first server never answers pings (a dead socket TCP hasn't noticed): the watchdog reconnects.
        server.enqueue(upgrade())
        server.enqueue(upgrade())
        val joins = AtomicInteger()
        val room = socket({ CallJoinDto("t${joins.incrementAndGet()}", "/api/calls/c9/ws") }, pingMs = 150, instance = "k3j9x0ab12cd", pongTimeoutMs = 200)
        room.connect()
        assertEquals("join:t1", next("join"))
        assertEquals("status:OPEN", next("status:OPEN"))
        assertEquals("/api/calls/c9/ws?ticket=t1&instance=k3j9x0ab12cd", server.takeRequest().path)
        assertEquals("status:RECONNECTING", next("status:RECONNECTING"))
        assertEquals("join:t2", next("join"))
        assertEquals("status:OPEN", next("status:OPEN"))
        // Same instance on every reconnect: the other side keeps our WebRTC link.
        assertEquals("/api/calls/c9/ws?ticket=t2&instance=k3j9x0ab12cd", server.takeRequest().path)
        room.close()
    }

    @Test fun aSocketThatOpensBeforeNewWebSocketReturnsIsKept() {
        server.enqueue(upgrade { it.send("""{"type":"welcome","client_id":"c1","server_time":5000,"started_at":1,"peers":[],"board":[],"chat":[]}""") })
        server.enqueue(upgrade())
        val joins = AtomicInteger()
        val room = socket({ CallJoinDto("t${joins.incrementAndGet()}", "/ws") }, http = openBeforeReturnClient())
        room.connect()
        assertEquals("status:CONNECTING", next("status"))
        assertEquals("status:OPEN", next("status"))
        assertEquals("msg:Welcome", next("msg"))
        assertTrue(room.send("""{"type":"chat","text":"你好"}"""))
        assertEquals("""{"type":"chat","text":"你好"}""", received.poll(5, TimeUnit.SECONDS))
        // A replacement that opens before it is returned is kept too.
        room.reconnectNow()
        assertEquals("status:RECONNECTING", next("status"))
        assertEquals("status:OPEN", next("status:OPEN"))
        assertEquals(2, joins.get())
        room.close()
    }

    @Test fun pongsKeepTheSocketAndReconnectNowReplacesIt() {
        val pongs = object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) { serverSockets += webSocket }
            override fun onMessage(webSocket: WebSocket, text: String) {
                received += text
                if (text.contains("\"ping\"")) webSocket.send("""{"type":"pong","t":1,"server_time":2}""")
            }
            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) { webSocket.close(1000, null) }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { serverClosed.incrementAndGet() }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) { serverClosed.incrementAndGet() }
        }
        server.enqueue(MockResponse().withWebSocketUpgrade(pongs))
        server.enqueue(upgrade())
        val joins = AtomicInteger()
        // A generous pong timeout: on a busy CI runner a 400 ms round trip over the loopback socket was missed now and then.
        val room = socket({ CallJoinDto("t${joins.incrementAndGet()}", "/ws") }, pingMs = 100, pongTimeoutMs = 3_000)
        room.connect()
        assertEquals("status:OPEN", next("status:OPEN"))
        Thread.sleep(1_000) // ~10 pings, every one answered
        assertTrue(events.toString(), events.none { it == "status:RECONNECTING" })
        assertEquals(1, joins.get())
        // The network changed: drop it and connect again at once.
        room.reconnectNow()
        assertEquals("status:RECONNECTING", next("status:RECONNECTING"))
        assertEquals("status:OPEN", next("status:OPEN"))
        assertEquals(2, joins.get())
        room.close()
    }

    @Test fun reconnectsWithAFreshTicketWhenTheSocketDrops() {
        server.enqueue(upgrade { it.close(1011, "restart") })
        server.enqueue(upgrade())
        val joins = AtomicInteger()
        val room = socket({ CallJoinDto("t${joins.incrementAndGet()}", "/ws") })
        room.connect()
        assertEquals("join:t1", next("join"))
        assertEquals("status:RECONNECTING", next("status:RECONNECTING"))
        assertEquals("join:t2", next("join"))
        assertEquals("status:OPEN", next("status:OPEN"))
        room.close()
    }

    @Test fun joinedElsewhereIsFatal() {
        server.enqueue(upgrade { it.close(4000, "replaced") })
        val room = socket({ CallJoinDto("t", "/ws") })
        room.connect()
        assertEquals("fatal:You joined this call from another tab or device.", next("fatal"))
        room.close()
    }

    @Test fun anEndedCallIsFatalAtJoin() {
        val room = socket({ throw HttpException(409, "This call has ended", """{"error":"This call has ended"}""") })
        room.connect()
        assertEquals("fatal:Could not join the call: This call has ended", next("fatal"))
    }

    @Test fun socketUrlFollowsTheApiOrigin() {
        assertEquals("wss://api.example.com/api/calls/x/ws?ticket=a%2Bb", CallRoomSocket.socketUrl("https://api.example.com/", "/api/calls/x/ws", "a+b"))
        assertEquals("ws://10.0.2.2:8787/ws?ticket=t", CallRoomSocket.socketUrl("http://10.0.2.2:8787", "ws", "t"))
        assertEquals("ws://h/ws?ticket=t&instance=abcd1234", CallRoomSocket.socketUrl("http://h", "/ws", "t", "abcd1234"))
        assertEquals("ws://h/ws?ticket=t", CallRoomSocket.socketUrl("http://h", "/ws", "t", "no good!"))
    }
}
