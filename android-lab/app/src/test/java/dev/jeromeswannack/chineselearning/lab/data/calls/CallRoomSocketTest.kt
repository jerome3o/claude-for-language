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

    private fun socket(join: suspend () -> CallJoinDto, now: () -> Long = System::currentTimeMillis, pingMs: Long = 20_000) =
        CallRoomSocket(join, OkHttpClient(), server.url("/").toString().removeSuffix("/"), handlers, scope, now, pingMs)

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
    }
}
