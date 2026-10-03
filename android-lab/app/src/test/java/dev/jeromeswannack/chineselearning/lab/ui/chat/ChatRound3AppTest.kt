package dev.jeromeswannack.chineselearning.lab.ui.chat

import android.os.Looper
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.MessageMenu
import dev.jeromeswannack.chineselearning.lab.data.api.ChatAttachmentDto
import dev.jeromeswannack.chineselearning.lab.data.api.ChatConversationDto
import dev.jeromeswannack.chineselearning.lab.data.api.ChatMessageDto
import dev.jeromeswannack.chineselearning.lab.data.api.ChatSenderDto
import dev.jeromeswannack.chineselearning.lab.data.api.MyRelationshipsDto
import dev.jeromeswannack.chineselearning.lab.data.api.RelationshipDto
import dev.jeromeswannack.chineselearning.lab.data.api.UserSummaryDto
import dev.jeromeswannack.chineselearning.lab.data.api.chatMediaUploadPath
import dev.jeromeswannack.chineselearning.lab.data.api.SendMessageBody
import dev.jeromeswannack.chineselearning.lab.data.api.chatMessagesPath
import dev.jeromeswannack.chineselearning.lab.data.chat.ChatActions
import dev.jeromeswannack.chineselearning.lab.data.platform.OutboxEntity
import dev.jeromeswannack.chineselearning.lab.ui.connections.ConnectionsKeys
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavKeys
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Round 2 PR 3 wired to the real ChatViewModel + LabApp (outbox, JsonCache): Forward → one
 * idempotent outbox row per message (oldest first, client id = row id), the "Forward to…" list from
 * the cached relationships, Info from the menu, drafts kept per conversation and restored, the
 * queue line from this chat's outbox, several photos → one message each.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], application = LabApp::class)
class ChatRound3AppTest {
    private lateinit var app: LabApp

    private val tutor = ChatSenderDto("t1", "Minghui")
    private val me = ChatSenderDto("me", "Jerome")
    private val m1 = ChatMessageDto("m1", "c1", "t1", "周末你做了什么？", "2026-10-02T09:00:00.000Z", sender = tutor)
    private val m2 = ChatMessageDto("m2", "c1", "me", "我去商店了。", "2026-10-02T09:01:00.000Z", sender = me)
    private val pdf = ChatMessageDto("f1", "c1", "t1", "", "2026-10-02T09:02:00.000Z", sender = tutor, attachment = ChatAttachmentDto("file", name = "HSK3 词汇.pdf", bytes = 860_000, mime = "application/pdf"), media_url = "/api/chat-media/f1")

    private fun idle(what: String = "", check: () -> Boolean = { true }) {
        repeat(500) {
            shadowOf(Looper.getMainLooper()).idle()
            if (check()) return
            Thread.sleep(10)
        }
        error("timed out waiting for $what")
    }

    private fun outbox(): List<OutboxEntity> = runBlocking { app.outbox.all() }

    @Before
    fun setUp() {
        app = ApplicationProvider.getApplicationContext()
        app.prefs.sessionToken = "test-session"
        runBlocking {
            app.cache.put(ConnectionsKeys.ME, ConnectionsKeys.KIND, "me")
            app.cache.put(ConnectionsKeys.relationship("rel1"), ConnectionsKeys.KIND, RelationshipDto("rel1", "me", "t1", "student", "active"))
            app.cache.put("chat/c1/messages", ChatViewModel.KIND, listOf(m1, m2, pdf))
            // "Forward to…" reads these first (the same caches the Connections screens fill).
            val rel1 = RelationshipDto("rel1", "me", "t1", "student", "active", recipient = UserSummaryDto("t1", name = "Minghui Li"))
            val rel2 = RelationshipDto("rel2", "s2", "me", "student", "active", requester = UserSummaryDto("s2", name = "Anna"))
            app.cache.put(NavKeys.RELATIONSHIPS, NavKeys.KIND, MyRelationshipsDto(tutors = listOf(rel1), students = listOf(rel2)))
            app.cache.put(
                ConnectionsKeys.conversations("rel1"), ConnectionsKeys.KIND,
                listOf(
                    ChatConversationDto("c1", "rel1", "Weekly chat", "2026-09-01T00:00:00Z", last_message_at = "2026-10-02T09:02:00Z"),
                    ChatConversationDto("ai", "rel1", "Ordering food", "2026-09-05T00:00:00Z", last_message_at = "2026-10-03T00:00:00Z", is_ai_conversation = true),
                ),
            )
            app.cache.put(ConnectionsKeys.conversations("rel2"), ConnectionsKeys.KIND, listOf(ChatConversationDto("c2", "rel2", null, "2026-09-10T00:00:00Z", last_message_at = "2026-10-01T10:00:00Z")))
        }
    }

    private fun open(conv: String = "c1"): ChatViewModel {
        val vm = ChatViewModel(app, "rel1", conv)
        idle("the cached chat") { vm.ui.value.myId == "me" && (conv != "c1" || vm.ui.value.messages.size == 3) }
        return vm
    }

    @Test fun forwardQueuesOneIdempotentRowPerMessageOldestFirst() {
        val vm = open()
        vm.onMenuAction(MessageMenu.FORWARD, m2)
        idle("the forward list") { vm.ui.value.forward?.targets != null }
        assertIs<ChatSheet.Forward>(vm.ui.value.sheet)
        // Every person-conversation, newest first; the Claude practice chat is not offered.
        assertEquals(listOf("c1", "c2"), vm.ui.value.forward!!.targets!!.map { it.conversationId })
        assertEquals("Minghui Li", vm.ui.value.forward!!.targets!![0].label)
        vm.closeForward()
        assertNull(vm.ui.value.sheet)

        // Select → Forward: two messages, picked newest first, go oldest first.
        vm.startSelecting("m2")
        vm.toggleSelect("m1")
        vm.forwardSelection()
        idle("targets") { vm.ui.value.forward?.targets != null }
        assertEquals(listOf("m1", "m2"), vm.ui.value.forward!!.messageIds)
        val anna = vm.ui.value.forward!!.targets!!.single { it.conversationId == "c2" }
        vm.forwardTo(anna)
        assertNull(vm.ui.value.selection, "the selection ends")
        idle("the outbox rows") { outbox().count { it.kind == ChatActions.KIND_FORWARD } == 2 }
        val rows = outbox().filter { it.kind == ChatActions.KIND_FORWARD }
        assertEquals(listOf("/api/messages/m1/forward", "/api/messages/m2/forward"), rows.map { it.path })
        for (r in rows) {
            val body = app.repo.api.json.parseToJsonElement(r.bodyJson!!).jsonObject
            assertEquals("c2", body["conversation_id"]!!.jsonPrimitive.content)
            assertEquals(r.id, body["client_id"]!!.jsonPrimitive.content, "the row id IS the client_id")
            assertEquals("POST", r.method)
        }
        assertTrue(vm.ui.value.notice?.text.orEmpty().contains("Anna"), vm.ui.value.notice?.text)
    }

    @Test fun infoFromTheMenu() {
        val vm = open()
        vm.onMenuAction(MessageMenu.INFO, pdf)
        val s = vm.ui.value.sheet
        assertIs<ChatSheet.Info>(s)
        val rows = ChatRound3.infoRows(s.message, "me", "Minghui", null).toMap()
        assertEquals("Minghui", rows["From"])
        assertEquals("HSK3 词汇.pdf · 840 KB", rows["File"])
    }

    @Test fun theDraftIsKeptPerConversationAndRestored() {
        val vm = open()
        vm.setDraft("我明天去")
        idle("saved") { runBlocking { ChatViewModel.loadDrafts(app) }.any { it.conversationId == "c1" } }
        val other = open("c9")
        assertEquals("", other.ui.value.draft, "another chat's box is its own")
        val again = open()
        idle("restored") { again.ui.value.draft == "我明天去" }
        // Sending clears it — here and in the store.
        again.setDraft("")
        idle("cleared") { runBlocking { ChatViewModel.loadDrafts(app) }.none { it.conversationId == "c1" } }
    }

    @Test fun editingDoesNotOverwriteTheDraft() {
        val vm = open()
        vm.setDraft("还没写完")
        idle("saved") { runBlocking { ChatViewModel.loadDrafts(app) }.any { it.text == "还没写完" } }
        vm.startEdit(m2)
        vm.setDraft("我去商店了！")
        vm.cancelEdit()
        idle("the typed draft is back") { vm.ui.value.draft == "还没写完" }
        assertEquals("还没写完", runBlocking { ChatViewModel.loadDrafts(app) }.single { it.conversationId == "c1" }.text)
    }

    @Test fun theHeaderSaysWhatIsWaiting() {
        val vm = open()
        assertNull(vm.ui.value.queueLabel)
        runBlocking {
            app.outbox.enqueueJson(ChatActions.KIND_SEND, "POST", chatMessagesPath("c1"), SendMessageBody("你好", null, "cid-1"), id = "cid-1")
            app.outbox.enqueueJson(ChatActions.KIND_SEND, "POST", chatMessagesPath("c1"), SendMessageBody("再见", null, "cid-2"), id = "cid-2")
            // Another chat's send doesn't count.
            app.outbox.enqueueJson(ChatActions.KIND_SEND, "POST", chatMessagesPath("c9"), SendMessageBody("x", null, "cid-3"), id = "cid-3")
        }
        idle("the pending bubbles") { vm.ui.value.pending.size == 2 }
        val label = vm.ui.value.queueLabel
        assertNotNull(label)
        assertTrue(label == "🕓 Sending 2 messages…" || label == "🕓 2 messages waiting for a connection", label)
    }

    @Test fun pendingFilesAndVideosComeFromTheOutboxQuery() {
        val file = java.io.File(app.cacheDir, "f.pdf").apply { writeBytes(ByteArray(2048)) }
        val vid = java.io.File(app.cacheDir, "v.mp4").apply { writeBytes(ByteArray(4096)) }
        runBlocking {
            app.outbox.enqueueRaw(ChatActions.KIND_MEDIA, "POST", chatMediaUploadPath("c1", "file", "p1", name = "课文 第3课.pdf"), file, "application/pdf", id = "p1")
            app.outbox.enqueueRaw(ChatActions.KIND_MEDIA, "POST", chatMediaUploadPath("c1", "video", "p2", durationMs = 12_400, width = 720, height = 1280), vid, "video/mp4", id = "p2")
        }
        val vm = open()
        idle("pending") { vm.ui.value.pending.size == 2 }
        val (f, v) = vm.ui.value.pending
        assertEquals("file", f.kind)
        assertEquals("课文 第3课.pdf", f.name)
        assertEquals(2048, f.bytes)
        assertEquals("video", v.kind)
        assertEquals(12_400L, v.durationMs)
        assertEquals(720 to 1280, v.width to v.height)
    }

    @Test fun severalPhotosOneMessageEachCaptionWithTheFirst() {
        val vm = open()
        val staged = (1..3).map { i ->
            val f = app.outbox.stageFile("chat-photo.jpg")
            val bmp = android.graphics.Bitmap.createBitmap(40, 30, android.graphics.Bitmap.Config.ARGB_8888)
            f.outputStream().use { bmp.compress(android.graphics.Bitmap.CompressFormat.JPEG, 80, it) }
            StagedPhoto(f.absolutePath, 40, 30).also { if (i == 0) Unit }
        }
        vm.openSheet(ChatSheet.Photos(staged))
        vm.removePhoto(1)
        assertEquals(2, (vm.ui.value.sheet as ChatSheet.Photos).photos.size)
        assertTrue(!java.io.File(staged[1].path).exists(), "the dropped photo is deleted")
        vm.sendPhoto("  我们的周末  ")
        idle("two uploads") { outbox().count { it.kind == ChatActions.KIND_MEDIA } == 2 }
        val rows = outbox().filter { it.kind == ChatActions.KIND_MEDIA }
        assertTrue(rows[0].path.contains("kind=image") && rows[0].path.contains("caption="), rows[0].path)
        assertTrue(!rows[1].path.contains("caption="), "the caption goes with the first only")
        assertEquals(2, rows.map { it.id }.toSet().size, "each its own client id")
        assertEquals(listOf(staged[0].path, staged[2].path), rows.map { it.filePath })
    }
}
