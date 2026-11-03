package dev.jeromeswannack.chineselearning.lab.ui.claude

import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.claude.ClaudeChats
import dev.jeromeswannack.chineselearning.lab.data.api.ClaudeContextDto
import dev.jeromeswannack.chineselearning.lab.data.api.ClaudeMessageDto
import dev.jeromeswannack.chineselearning.lab.data.api.ClaudeTurnEvent
import dev.jeromeswannack.chineselearning.lab.data.claude.ClaudeThreads
import dev.jeromeswannack.chineselearning.lab.data.platform.Outbox
import dev.jeromeswannack.chineselearning.lab.testing.awaitOnMain
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Claude threads on the phone, against a fake `/api/claude/threads*` (docs/CHAT.md "Claude thread
 * view"): a thread started offline waits in the outbox and moves to its server id once sent, a
 * follow-up written meanwhile goes after it with the real path, a 409 ("still answering") keeps it
 * waiting; live `claude_turn` frames stream the reply (highest seq wins, a poll never shortens it);
 * the real ViewModel shows it, says what a tool is doing and opens the card from the chip.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], application = LabApp::class)
class ClaudeThreadAppTest {
    private lateinit var app: LabApp
    private lateinit var fake: FakeClaudeServer

    @Before fun setUp() {
        app = ApplicationProvider.getApplicationContext()
        app.prefs.sessionToken = "test-session"
        fake = FakeClaudeServer().start(app)
    }

    @After fun tearDown() = fake.shutdown()

    private fun claudeItems() = runBlocking { app.outbox.all().filter { it.kind == ClaudeThreads.OUTBOX_KIND } }

    // ---------------- offline outbox ----------------

    @Test fun aThreadStartedOfflineIsSentThenMovesToItsServerId() = runBlocking {
        FakeClaudeServer.setOnline(app, false)
        val store = ClaudeThreads.of(app)
        val started = store.start(ClaudeContextDto(), "我昨天去了商店买苹果", "check", "zh", online = false)
        assertTrue(started.queued)
        val local = store.get(started.threadId)!!
        assertTrue(local.local)
        assertEquals("我昨天去了商店买苹果", local.thread.title)
        assertTrue(local.messages.single().queued)
        // A follow-up while the thread isn't on the server: kept here (its path needs the server id).
        val follow = store.send(started.threadId, "为什么不是「去了」？", "zh", online = false)
        assertTrue(follow.queued)
        assertEquals(listOf("/api/claude/threads"), claudeItems().map { it.path })
        assertEquals(true, store.get(started.threadId)!!.messages.last().held)

        // Back online: the outbox sends the create, the sync step resolves the thread.
        FakeClaudeServer.setOnline(app, true)
        app.outbox.drain()
        assertEquals(listOf("t1"), fake.threadIds())
        assertEquals(1, store.resolveLocal())
        assertEquals("t1", store.resolve(started.threadId))
        assertNull(store.get(started.threadId))
        val moved = store.get("t1")!!
        assertFalse(moved.local)
        assertEquals(listOf("user", "assistant", "user"), moved.messages.map { it.role })
        assertFalse(moved.messages[0].queued) // the server's row replaced my optimistic one
        assertEquals("pending", moved.messages[1].status)
        assertTrue(moved.messages[2].queued)
        assertFalse(moved.messages[2].held)
        assertEquals(listOf("/api/claude/threads/t1/messages"), claudeItems().map { it.path })

        // Claude is still answering: 409 keeps it waiting (not "done").
        app.outbox.drain()
        assertEquals(Outbox.PENDING, claudeItems().single().state)
        fake.finish("t1", "「了」跟在「买」后面。")
        app.outbox.drain()
        assertTrue(claudeItems().isEmpty())
        assertEquals(listOf("我昨天去了商店买苹果", "为什么不是「去了」？"), fake.userTexts("t1"))
        // Fetching again replaces my queued bubble with the server's row (matched by client id).
        store.refresh("t1", full = true)
        assertEquals(1, store.get("t1")!!.messages.count { it.content == "为什么不是「去了」？" })
        assertTrue(store.get("t1")!!.messages.none { it.queued })
    }

    @Test fun aSendThatDoesntGetThroughIsQueuedAndARefusalIsThrown() = runBlocking {
        FakeClaudeServer.setOnline(app, true)
        val store = ClaudeThreads.of(app)
        val t = store.start(ClaudeContextDto(), "你好", "ask", "zh", online = true)
        assertFalse(t.queued)
        assertEquals("t1", t.threadId)
        fake.finish("t1", "你好！")
        fake.down = true
        val r = store.send("t1", "今天天气怎么样？", "zh", online = true)
        assertTrue(r.queued)
        assertEquals(listOf("/api/claude/threads/t1/messages"), claudeItems().map { it.path })
        fake.down = false
        app.outbox.drain()
        assertTrue(claudeItems().isEmpty())
        // A follow-up while a reply is pending: 409 is a refusal for a direct send (the screen says why).
        val e = runCatching { store.send("t1", "还有呢？", "zh", online = true) }.exceptionOrNull()
        assertEquals(409, (e as dev.jeromeswannack.chineselearning.lab.data.HttpException).code)
        assertEquals("Claude is still answering your last message.", ClaudeThreadViewModel.sendErrorText(e))
    }

    @Test fun aRefusedQueuedMessageCanBeDiscarded() = runBlocking {
        val store = ClaudeThreads.of(app)
        val t = store.start(ClaudeContextDto(), "你好", "ask", "zh", online = false)
        val id = store.get(t.threadId)!!.messages.single().id
        store.discard(t.threadId, id)
        assertNull(store.get(t.threadId))
        assertTrue(claudeItems().isEmpty())
    }

    // ---------------- live frames ----------------

    @Test fun liveFramesStreamTheReplyAndAPollNeverShortensIt() = runBlocking {
        val store = ClaudeThreads.of(app)
        store.start(ClaudeContextDto(), "成都有什么好吃的？", "ask", "zh", online = true)
        val reply = fake.pendingReplyId("t1")!!
        assertTrue(store.applyTurn(ClaudeTurnEvent("t1", reply, seq = 2, status = "streaming", text = "成都的菜很有名，")))
        // An older frame is ignored.
        assertFalse(store.applyTurn(ClaudeTurnEvent("t1", reply, seq = 1, status = "streaming", text = "成都")))
        // The server's row is written less often: a poll with less text keeps what streamed.
        fake.partial("t1", "成都")
        store.refresh("t1")
        val row = store.get("t1")!!.messages.first { it.id == reply }
        assertEquals("成都的菜很有名，", row.content)
        assertTrue(row.streaming)
        // Done: the whole reply wins.
        fake.finish("t1", "成都的菜很有名，特别是火锅。")
        store.refresh("t1")
        val done = store.get("t1")!!.messages.first { it.id == reply }
        assertEquals("成都的菜很有名，特别是火锅。", done.content)
        assertNull(done.status)
    }

    @Test fun mergeKeepsTheLongerStreamedText() {
        val local = ClaudeMessageDto("m1", status = "pending", content = "你好，我", seq = 4)
        val server = ClaudeMessageDto("m1", status = "pending", content = "你好")
        assertEquals("你好，我", ClaudeThreads.mergeMessage(local, server).content)
        assertEquals(4, ClaudeThreads.mergeMessage(local, server).seq)
        assertEquals("你好，我们", ClaudeThreads.mergeMessage(local, server.copy(status = null, content = "你好，我们")).content)
        // Not a prefix (rewritten): the server wins.
        assertEquals("您好", ClaudeThreads.mergeMessage(local, server.copy(content = "您好")).content)
    }

    @Test fun theViewModelStreamsFromTheSocketAndSaysWhatAToolDoes() {
        FakeClaudeServer.setOnline(app, true)
        runBlocking { ClaudeThreads.of(app).start(ClaudeContextDto(ClaudeChats.CARD, note_id = "n1", label = "银行"), "银行的行怎么读？", "ask", "zh", online = true) }
        val reply = fake.pendingReplyId("t1")!!
        val vm = ClaudeThreadViewModel(app, "t1", null, "test", hasSentence = false)
        awaitOnMain(describe = { "the thread: ${vm.ui.value}" }) { vm.ui.value.messages.takeIf { it.size == 2 } }
        assertEquals(ClaudeChats.CARD, vm.ui.value.context.kind)

        runBlocking { app.chatLive.handle("""{"type":"claude_turn","thread_id":"t1","message_id":"$reply","seq":1,"status":"tool","tool":"search_cards"}""") }
        awaitOnMain(describe = { "the tool" }) { vm.ui.value.liveTool }
        assertEquals("search_cards", vm.ui.value.liveTool!!.tool)

        runBlocking { app.chatLive.handle("""{"type":"claude_turn","thread_id":"t1","message_id":"$reply","seq":2,"status":"streaming","text":"「银行」的「行」读 háng，"}""") }
        awaitOnMain(describe = { "the streamed text: ${vm.ui.value.messages}" }) { vm.ui.value.messages.lastOrNull()?.content?.takeIf { it.isNotEmpty() } }
        assertNull(vm.ui.value.liveTool)
        assertTrue(vm.ui.value.replyPending)
        assertTrue(vm.ui.value.busy)

        // Done: the final row over REST.
        fake.finish("t1", "「银行」的「行」读 háng，意思是做生意的地方。")
        runBlocking { app.chatLive.handle("""{"type":"claude_turn","thread_id":"t1","message_id":"$reply","seq":3,"status":"done","text":"「银行」的「行」读 háng，意思是做生意的地方。"}""") }
        awaitOnMain(describe = { "the finished reply: ${vm.ui.value.messages}" }) { vm.ui.value.messages.lastOrNull()?.takeIf { it.status == null && it.role == "assistant" } }
        assertFalse(vm.ui.value.busy)
        // A frame for another thread changes nothing.
        runBlocking { app.chatLive.handle("""{"type":"claude_turn","thread_id":"t9","message_id":"x","seq":9,"status":"tool"}""") }
        assertNull(vm.ui.value.liveTool)

        // The card chip leads to the card's hub.
        var opened: String? = null
        vm.contextPath(ClaudeChats.headerChipFor(vm.ui.value.core)!!.link!!) { opened = it }
        assertEquals(Routes.cardHub("n1"), opened)
        val events = app.analytics.recentEventNames()
        assertTrue("claude.thread_open" in events, events.toString())
        assertTrue("claude.reply_shown" in events, events.toString())
    }

    @Test fun anOfflineSendShowsAtOnceAsWaiting() {
        FakeClaudeServer.setOnline(app, true)
        runBlocking { ClaudeThreads.of(app).start(ClaudeContextDto(), "你好", "ask", "zh", online = true) }
        fake.finish("t1", "你好！有什么可以帮你？")
        val vm = ClaudeThreadViewModel(app, "t1", null, "test", hasSentence = false)
        awaitOnMain(describe = { "the reply" }) { vm.ui.value.messages.takeIf { it.size == 2 && it.last().status == null } }
        FakeClaudeServer.setOnline(app, false)
        vm.send("「买单」是什么意思？", spoken = false)
        val mine = awaitOnMain(describe = { "my queued bubble: ${vm.ui.value.messages}" }) { vm.ui.value.messages.lastOrNull()?.takeIf { it.role == "user" && it.queued } }
        assertEquals("「买单」是什么意思？", mine.content)
        assertNull(vm.ui.value.sending)
        assertEquals(listOf("/api/claude/threads/t1/messages"), claudeItems().map { it.path })
        assertTrue("claude.message_send" in app.analytics.recentEventNames(), app.analytics.recentEventNames().toString())

        // Back online: the outbox sends it and the screen fetches the server's row.
        FakeClaudeServer.setOnline(app, true)
        runBlocking { app.outbox.drain() }
        awaitOnMain(describe = { "sent: ${vm.ui.value.messages}" }) { vm.ui.value.messages.takeIf { ms -> ms.none { it.queued } && ms.any { it.content == "「买单」是什么意思？" } } }
        assertNotNull(fake.pendingReplyId("t1"))
    }
}
