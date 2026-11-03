package dev.jeromeswannack.chineselearning.lab.ui.chats

import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.claude.ClaudeInbox
import dev.jeromeswannack.chineselearning.lab.data.api.ClaudeContextDto
import dev.jeromeswannack.chineselearning.lab.data.api.ClaudeThreadDto
import dev.jeromeswannack.chineselearning.lab.data.claude.ClaudeThreadList
import dev.jeromeswannack.chineselearning.lab.data.claude.ClaudeThreads
import dev.jeromeswannack.chineselearning.lab.testing.awaitOnMain
import dev.jeromeswannack.chineselearning.lab.ui.chat.ChatViewModel
import dev.jeromeswannack.chineselearning.lab.ui.claude.FakeClaudeServer
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The Claude half of the Chats tab against a fake `/api/claude/threads` (docs/CHAT.md "Chats tab — one
 * list for people and Claude"): the list fetched whole once, then `?since=` with deletions; a thread
 * opened here clears its unread; the real ViewModel lists the threads offline from the phone, marks a
 * reply starting as "Writing…", starts a thread from the box (offline: queued, shown at once) and hands
 * a tutor the text as her chat's draft.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], application = LabApp::class)
class ChatsInboxAppTest {
    private lateinit var app: LabApp
    private lateinit var fake: FakeClaudeServer

    @Before fun setUp() {
        app = ApplicationProvider.getApplicationContext()
        app.prefs.sessionToken = "test-session"
        fake = FakeClaudeServer().start(app)
    }

    @After fun tearDown() = fake.shutdown()

    private fun list() = runBlocking { ClaudeThreadList.get(app.cache) }

    @Test fun theListIsFetchedWholeOnceThenSinceWithDeletions() = runBlocking {
        FakeClaudeServer.setOnline(app, true)
        val store = ClaudeThreads.of(app)
        store.start(ClaudeContextDto(), "成都有什么好吃的？", "ask", "zh", online = true)
        store.start(ClaudeContextDto(), "我昨天去了商店买东西了", "check", "zh", online = true)
        // A fresh install: nothing listed yet but what this phone started (its thread responses).
        app.cache.delete(ClaudeThreadList.KEY)
        ClaudeThreadList.sync(app.repo.api, app.cache)
        assertEquals(listOf<String?>(null), fake.listSince)
        assertEquals(setOf("t1", "t4"), list()!!.threads.map { it.id }.toSet())
        val cursor = list()!!.cursor!!

        fake.finish("t1", "火锅！")
        fake.delete("t4")
        ClaudeThreadList.sync(app.repo.api, app.cache)
        assertEquals(cursor, fake.listSince.last())
        val rows = list()!!.threads
        assertEquals(listOf("t1"), rows.map { it.id })
        assertEquals(1, rows.single().unread)
        assertEquals("火锅！", rows.single().preview)

        // Opening the thread: the thread response clears its unread on the row.
        store.refresh("t1", full = true)
        assertEquals(0, list()!!.threads.single().unread)
    }

    @Test fun pureListRules() {
        val a = ClaudeThreadDto("a", title = "A")
        val b = ClaudeThreadDto("b", title = "B")
        assertEquals(listOf("a", "b"), ClaudeThreadList.apply(listOf(a), listOf(b), emptyList()).map { it.id })
        assertEquals(listOf("A2"), ClaudeThreadList.apply(listOf(a, b), listOf(a.copy(title = "A2")), listOf("b")).map { it.title })
        // A thread started offline that the server already lists (by its client id) shows once.
        val local = ClaudeThreadDto("client-1", client_id = "client-1", title = "你好")
        val server = ClaudeThreadDto("t9", client_id = "client-1", title = "你好")
        assertEquals(listOf("t9"), ClaudeThreadList.inboxThreads(listOf(server), listOf(local)).map { it.id })
        assertEquals(listOf(true), ClaudeThreadList.inboxThreads(emptyList(), listOf(local)).map { it.local })
    }

    @Test fun theViewModelListsThreadsOfflineMarksWritingAndQueuesASend() {
        FakeClaudeServer.setOnline(app, true)
        runBlocking {
            ClaudeThreads.of(app).start(ClaudeContextDto(), "成都有什么好吃的？", "ask", "zh", online = true)
            fake.finish("t1", "火锅！")
            ClaudeThreadList.sync(app.repo.api, app.cache, full = true)
        }
        FakeClaudeServer.setOnline(app, false)
        val vm = ChatsViewModel(app)
        val first = awaitOnMain(describe = { "the cached threads: ${vm.ui.value.threads}" }) { vm.ui.value.threads.takeIf { it.isNotEmpty() } }
        assertEquals("t1", first.single().id)
        assertTrue(vm.ui.value.offline)
        assertTrue(vm.ui.value.items.any { it.key == "c:t1" && it.kind == ClaudeInbox.CLAUDE })

        // A reply starting (another device asked): "Writing a reply…" at once.
        runBlocking { app.chatLive.handle("""{"type":"claude_turn","thread_id":"t1","message_id":"x","seq":1,"status":"thinking"}""") }
        awaitOnMain(describe = { "pending: ${vm.ui.value.threads}" }) { vm.ui.value.threads.firstOrNull { it.id == "t1" && it.pending } }

        // The box, offline: the thread is kept here and queued, shown in the list at once, and opened.
        var opened: String? = null
        vm.sendToClaude("银行的行怎么读？", "ask", spoken = true) { opened = it }
        val id = awaitOnMain(describe = { "the queued thread" }) { opened }
        val row = awaitOnMain(describe = { "listed: ${vm.ui.value.threads}" }) { vm.ui.value.threads.firstOrNull { it.id == id } }
        assertTrue(row.local)
        assertEquals("🕓 Waiting for a connection", ClaudeInbox.claudeRowPreview(row.preview, row.pending, row.failed, row.local, row.title))
        assertEquals(listOf("/api/claude/threads"), runBlocking { app.outbox.all() }.filter { it.kind == ClaudeThreads.OUTBOX_KIND }.map { it.path })
        assertEquals("", vm.ui.value.draft)
        val events = app.analytics.recentEventNames()
        assertTrue("chats.compose_send" in events, events.toString())
        assertTrue("claude.message_send" in events, events.toString())
    }

    @Test fun toATutorKeepsTheTextAsHerChatsDraft() {
        val vm = ChatsViewModel(app)
        var opened: String? = null
        vm.sendToPerson(ClaudeInbox.Recipient("rel-minghui", "c-hw", "Minghui"), "  老师，明天几点上课？ ") { opened = it }
        assertEquals("/connections/rel-minghui/chat/c-hw", awaitOnMain(describe = { "opened" }) { opened })
        val drafts = runBlocking { ChatViewModel.loadDrafts(app) }
        assertEquals("老师，明天几点上课？", drafts.single { it.conversationId == "c-hw" }.text)
        assertTrue("chats.compose_to_person" in app.analytics.recentEventNames())
    }

    @Test fun filtersAndOpeningAreCounted() {
        val vm = ChatsViewModel(app)
        vm.setFilter(ClaudeInbox.CLAUDE)
        assertEquals(ClaudeInbox.CLAUDE, awaitOnMain(describe = { "filter" }) { vm.ui.value.filter.takeIf { it == ClaudeInbox.CLAUDE } })
        val item = ClaudeInbox.merge(emptyList(), listOf(ClaudeThreadList.toInbox(ClaudeThreadDto("t5", title = "你好", created_at = "2026-10-01T00:00:00Z"), local = false))).single()
        assertEquals("/chats/claude/t5?source=chats", vm.open(item))
        val events = app.analytics.recentEventNames()
        assertTrue("chats.filter" in events && "chats.open" in events, events.toString())
        assertFalse(vm.ui.value.teacher)
        vm.setTeacher(true)
        awaitOnMain(describe = { "teacher" }) { vm.ui.value.teacher.takeIf { it } }
        assertNull(vm.ui.value.sendError)
    }
}
