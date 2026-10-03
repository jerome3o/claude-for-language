package dev.jeromeswannack.chineselearning.lab.ui.chat

import android.os.Looper
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.ChatDrafts
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.Repository
import dev.jeromeswannack.chineselearning.lab.data.chat.ChatPair
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
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * One chat per pair (docs/CHAT.md), wired to the real ChatViewModel + LabApp against a fake
 * server: an old (merged-away) id is detected from the page / the lookup and swapped for the
 * primary, the swap carries the unsent draft along and is remembered for next time (offline too),
 * and THE chat of a pair comes from `/conversations/open` — cached first afterwards.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], application = LabApp::class)
class OneChatPerPairAppTest {
    private lateinit var app: LabApp
    private lateinit var server: MockWebServer
    private val paths = mutableListOf<String>()

    private val rel = """{"id":"rel1","requester_id":"me","recipient_id":"t1","requester_role":"student","status":"active","recipient":{"id":"t1","name":"Minghui"}}"""
    private val primaryList = """[{"id":"c1","relationship_id":"rel1","created_at":"2026-09-01T00:00:00Z","is_ai_conversation":false}]"""
    private val page = """{"messages":[{"id":"m1","conversation_id":"c1","sender_id":"t1","content":"你好！","created_at":"2026-10-02T09:00:00.000Z","sender":{"id":"t1","name":"Minghui"}}],"latest_timestamp":"2026-10-02T09:00:00.000Z"}"""

    private fun idle(what: String, check: () -> Boolean) {
        repeat(500) {
            shadowOf(Looper.getMainLooper()).idle()
            if (check()) return
            Thread.sleep(10)
        }
        error("timed out waiting for $what")
    }

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
                    path == "/api/relationships/rel1" -> ok(rel)
                    path == "/api/relationships/rel1/conversations" -> ok(primaryList)
                    // The server serves an old id's messages as the primary's (X-Conversation-Id).
                    path.startsWith("/api/conversations/old/messages") -> ok(page).setHeader("X-Conversation-Id", "c1")
                    path.startsWith("/api/conversations/c1/messages") -> ok(page)
                    path == "/api/conversations/c1/read" -> ok("""{"ok":true}""")
                    path.startsWith("/api/conversations/empty-old/messages") -> ok("""{"messages":[]}""")
                    path == "/api/conversations/empty-old" -> ok("""{"id":"c9","relationship_id":"rel1","is_ai_conversation":false,"merged_from":"empty-old"}""")
                    path == "/api/relationships/rel1/conversations/open" -> ok("""{"conversation_id":"c1","created":false}""")
                    else -> MockResponse().setResponseCode(404).setBody("""{"error":"not here"}""")
                }
            }
        }
        val old = app.repo
        app.repo = Repository(app, old.db, Api(server.url("").toString().removeSuffix("/")) { "test-session" }, app.prefs)
        runBlocking { app.cache.put(ConnectionsKeys.ME, ConnectionsKeys.KIND, "me") }
    }

    @After fun tearDown() = server.shutdown()

    @Test fun anOldIdIsSwappedForTheChatItWasMergedInto() {
        runBlocking { ChatViewModel.saveDraft(app, "old", "明天见") }
        val vm = ChatViewModel(app, "rel1", "old")
        idle("the merge") { vm.ui.value.mergedInto != null }
        assertEquals("c1", vm.ui.value.mergedInto)
        // The route records it (ChatNav): the draft moves, the alias is remembered.
        runBlocking { ChatPair.record(app, "old", "c1") }
        runBlocking {
            assertEquals("c1", ChatPair.primaryOf(app, "old"))
            val drafts = ChatViewModel.loadDrafts(app)
            assertEquals("明天见", ChatDrafts.load(drafts, "c1"))
            assertEquals("", ChatDrafts.load(drafts, "old"))
            assertEquals(listOf("c1", "old"), ChatPair.aliasesOf(ChatPair.merged(app), "c1"))
        }
    }

    @Test fun anEmptyOldChatIsAskedAbout() {
        val vm = ChatViewModel(app, "rel1", "empty-old")
        idle("the lookup") { vm.ui.value.mergedInto != null }
        assertEquals("c9", vm.ui.value.mergedInto)
        assertTrue(paths.any { it == "GET /api/conversations/empty-old" })
    }

    @Test fun thePrimaryLoadsNormally() {
        val vm = ChatViewModel(app, "rel1", "c1")
        idle("the page") { !vm.ui.value.loading && vm.ui.value.messages.isNotEmpty() }
        assertNull(vm.ui.value.mergedInto)
        // The person's chat: no title, rename refused locally (the server answers 410).
        assertEquals(false, vm.ui.value.isAi)
        vm.rename("Homework")
        idle("nothing") { true }
        assertTrue(paths.none { it.startsWith("PATCH /api/conversations") }, paths.toString())
    }

    @Test fun theChatOfAPairIsTheServersThenCachedFirst() = runBlocking {
        // Robolectric has no validated network: say we're online.
        @Suppress("UNCHECKED_CAST")
        (LabApp::class.java.getDeclaredField("_online").apply { isAccessible = true }.get(app) as kotlinx.coroutines.flow.MutableStateFlow<Boolean>).value = true
        assertEquals("c1", ChatPair.theChat(app, "rel1"))
        assertTrue(paths.contains("POST /api/relationships/rel1/conversations/open"))
        assertEquals("c1", app.cache.get<String>(ChatPair.pairKey("rel1")))
        // A merged id the phone knows about is followed.
        ChatPair.record(app, "c1", "c2")
        assertEquals("c2", ChatPair.theChat(app, "rel1"))
    }
}
