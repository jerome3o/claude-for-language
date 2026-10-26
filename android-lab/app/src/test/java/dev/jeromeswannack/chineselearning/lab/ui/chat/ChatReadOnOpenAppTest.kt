package dev.jeromeswannack.chineselearning.lab.ui.chat

import android.os.Looper
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.Repository
import dev.jeromeswannack.chineselearning.lab.ui.connections.ConnectionsKeys
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.util.concurrent.TimeUnit
import kotlin.test.assertTrue

/**
 * Opening a chat reads it up to the newest message — a system row included — wired to the real
 * ChatViewModel against a fake server. Jerome (Oct 2026): the newest message of his chat with
 * Minghui was her "📹 started a video call" line; he glanced at the chat for ~1 s, the load (three
 * requests) never reached its read, and the Chats badge said 1 for days.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], application = LabApp::class)
class ChatReadOnOpenAppTest {
    private lateinit var app: LabApp
    private lateinit var server: MockWebServer
    private val paths = mutableListOf<String>()
    @Volatile private var slowRelationship = false

    private val rel = """{"id":"rel1","requester_id":"me","recipient_id":"t1","requester_role":"student","status":"active","recipient":{"id":"t1","name":"明慧"}}"""
    private val list = """[{"id":"c1","relationship_id":"rel1","created_at":"2026-09-01T00:00:00Z","is_ai_conversation":false}]"""
    private val page = """{"messages":[
        {"id":"m1","conversation_id":"c1","sender_id":"t1","content":"好的，我们可以慢慢改进","created_at":"2026-10-21T15:41:01.584Z","sender":{"id":"t1","name":"明慧"}},
        {"id":"sys","conversation_id":"c1","sender_id":"t1","content":"📹 明慧 started a video call — join here: https://app.test/calls/k1","created_at":"2026-10-23T14:00:46.462Z","system_kind":"call_started","system_data":{"call_id":"k1","ended":true},"sender":{"id":"t1","name":"明慧"}}
      ],"latest_timestamp":"2026-10-23T14:53:42.399Z","read_state":{"me":"2026-10-21T15:41:01.584Z","other":null}}"""

    private fun idle(what: String, check: () -> Boolean) {
        repeat(500) {
            shadowOf(Looper.getMainLooper()).idle()
            if (check()) return
            Thread.sleep(10)
        }
        error("timed out waiting for $what: $paths")
    }

    private fun reads() = synchronized(paths) { paths.filter { it == "POST /api/conversations/c1/read" } }

    @Before fun setUp() {
        app = ApplicationProvider.getApplicationContext()
        app.prefs.sessionToken = "test-session"
        server = MockWebServer().apply { start() }
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.path.orEmpty()
                synchronized(paths) { paths += "${request.method} $path" }
                fun ok(body: String) = MockResponse().setBody(body).setHeader("Content-Type", "application/json")
                return when {
                    path == "/api/relationships/rel1" -> ok(rel).also { if (slowRelationship) it.setBodyDelay(4, TimeUnit.SECONDS) }
                    path == "/api/relationships/rel1/conversations" -> ok(list)
                    path.startsWith("/api/conversations/c1/messages") -> ok(page)
                    path == "/api/conversations/c1/read" -> ok("""{"conversation_id":"c1","last_read_at":"2026-10-23T14:00:46.462Z","unread":0}""")
                    else -> MockResponse().setResponseCode(404).setBody("""{"error":"not here"}""")
                }
            }
        }
        val old = app.repo
        app.repo = Repository(app, old.db, Api(server.url("").toString().removeSuffix("/")) { "test-session" }, app.prefs)
        runBlocking { app.cache.put(ConnectionsKeys.ME, ConnectionsKeys.KIND, "me") }
        // Robolectric has no validated network: say we're online.
        @Suppress("UNCHECKED_CAST")
        (LabApp::class.java.getDeclaredField("_online").apply { isAccessible = true }.get(app) as kotlinx.coroutines.flow.MutableStateFlow<Boolean>).value = true
    }

    @After fun tearDown() = server.shutdown()

    private fun open(store: ViewModelStore): ChatViewModel =
        ViewModelProvider(store, object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T = ChatViewModel(app, "rel1", "c1") as T
        })[ChatViewModel::class.java]

    @Test fun openingReadsUpToTheNewestEvenWhenItIsASystemRow() {
        val store = ViewModelStore()
        val vm = open(store)
        idle("the page") { !vm.ui.value.loading && vm.ui.value.messages.any { it.id == "sys" } }
        idle("the read") { reads().isNotEmpty() }
        store.clear()
        Thread.sleep(200)
        shadowOf(Looper.getMainLooper()).idle()
        // Already read: leaving sends nothing more.
        assertTrue(reads().size == 1, paths.toString())
    }

    @Test fun closingBeforeTheLoadFinishedStillReadsTheChat() {
        slowRelationship = true
        val store = ViewModelStore()
        open(store)
        idle("the load to start") { synchronized(paths) { paths.any { it == "GET /api/relationships/rel1" } } }
        assertTrue(reads().isEmpty())
        store.clear() // back to the Chats tab within a second
        idle("the read on leave") { reads().isNotEmpty() }
        assertTrue(synchronized(paths) { paths.none { it.startsWith("GET /api/conversations/c1/messages") } }, paths.toString())
    }
}
