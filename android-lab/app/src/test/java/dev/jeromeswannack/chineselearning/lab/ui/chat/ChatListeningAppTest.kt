package dev.jeromeswannack.chineselearning.lab.ui.chat

import android.os.Looper
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.chat.ChatListLastMessage
import dev.jeromeswannack.chineselearning.lab.core.chat.ChatListPerson
import dev.jeromeswannack.chineselearning.lab.core.chat.ChatListRow
import dev.jeromeswannack.chineselearning.lab.core.chat.ChatListening
import dev.jeromeswannack.chineselearning.lab.data.api.ChatMessageDto
import dev.jeromeswannack.chineselearning.lab.data.api.ChatSenderDto
import dev.jeromeswannack.chineselearning.lab.data.api.ListeningRowDto
import dev.jeromeswannack.chineselearning.lab.data.api.ListeningStateDto
import dev.jeromeswannack.chineselearning.lab.data.api.RelationshipDto
import dev.jeromeswannack.chineselearning.lab.data.chat.ChatListeningStore
import dev.jeromeswannack.chineselearning.lab.data.chat.IncomingChat
import dev.jeromeswannack.chineselearning.lab.data.lessons.LessonRuntime
import dev.jeromeswannack.chineselearning.lab.ui.connections.ConnectionsKeys
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.io.File
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Listening mode wired to the real ChatViewModel + LabApp (JsonCache, Outbox, the read-aloud clip
 * cache): the cached setting hides the other person's new message; a tap plays the SAME cached
 * clip Read aloud would (voice by ChatReadAloud); a reveal survives a new screen; the menu toggle
 * and Hide all are cached at once and queued as idempotent PUTs; the inbox / notifications say
 * "🎧 New message".
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], application = LabApp::class)
class ChatListeningAppTest {
    private lateinit var app: LabApp
    private val tutor = ChatSenderDto("t1", "Minghui")
    private val me = ChatSenderDto("me", "Jerome")
    private val old = ChatMessageDto("m1", "c1", "t1", "你今天去哪儿了？", "2026-10-02T09:00:00.000Z", sender = tutor)
    private val mine = ChatMessageDto("m2", "c1", "me", "我去图书馆了。", "2026-10-02T09:01:00.000Z", sender = me)
    private val fresh = ChatMessageDto("m3", "c1", "t1", "图书馆人多吗？", "2026-10-02T09:05:00.000Z", sender = tutor)
    private val since = "2026-10-02T09:02:00.000Z"

    private val played = mutableListOf<String>()
    private var restarts = 0

    private fun idle(what: String = "", check: () -> Boolean = { true }) {
        repeat(500) {
            shadowOf(Looper.getMainLooper()).idle()
            if (check()) return
            Thread.sleep(10)
        }
        error("timed out waiting for $what")
    }

    @Before
    fun setUp() {
        app = ApplicationProvider.getApplicationContext()
        app.prefs.sessionToken = "test-session"
        ListeningPlayer.factory = {
            object : ListeningPlayer {
                override fun play(file: File, speed: Float, onDone: () -> Unit) { played += "${file.name}@$speed" }
                override fun restart() { restarts++ }
                override fun setSpeed(speed: Float) { played += "speed $speed" }
                override fun stop() {}
            }
        }
        runBlocking {
            app.cache.put(ConnectionsKeys.ME, ConnectionsKeys.KIND, "me")
            app.cache.put(ConnectionsKeys.relationship("rel1"), ConnectionsKeys.KIND, RelationshipDto("rel1", "me", "t1", "student", "active"))
            app.cache.put("chat/c1/messages", ChatViewModel.KIND, listOf(old, mine, fresh))
            app.cache.put(ChatListeningStore.STATE, ChatListeningStore.KIND, ListeningStateDto(false, listOf(ListeningRowDto("c1", true, since))))
        }
    }

    @After
    fun tearDown() {
        ListeningPlayer.factory = { MediaListeningPlayer() }
    }

    private fun open(): ChatViewModel {
        val vm = ChatViewModel(app, "rel1", "c1")
        idle("the cached chat + setting") { vm.ui.value.myId == "me" && vm.ui.value.messages.size == 3 && vm.ui.value.listening.setting.on }
        return vm
    }

    @Test fun newMessageFromTheOtherPersonIsHidden() {
        val vm = open()
        val ui = vm.ui.value
        assertTrue(ui.isHidden(fresh))
        assertFalse(ui.isHidden(old), "history before `since` stays")
        assertFalse(ui.isHidden(mine), "my own never hide")
    }

    @Test fun tapPlaysTheReadAloudClipAndATapWhilePlayingReplays() {
        val vm = open()
        // The clip Read aloud would play (same voice rule, same device cache), already on the phone.
        val (voice, speed) = runBlocking { vm.readAloudVoice(fresh) }
        val media = LessonRuntime.of(app).media
        val key = media.ttsKey(fresh.content, speed, voice)
        val file = File(app.filesDir, "lesson-tts/" + key.replace(Regex("[^A-Za-z0-9._-]"), "_")).apply { parentFile!!.mkdirs(); writeBytes(ByteArray(64) { 1 }) }
        assertEquals(file.absolutePath, media.cachedTts(key)!!.absolutePath)

        vm.listening.tap(fresh)
        idle("playing") { vm.ui.value.listening.playing == "m3" }
        assertEquals(listOf("${file.name}@1.0"), played)
        vm.listening.tap(fresh)
        assertEquals(1, restarts, "a tap while playing starts it again")
        vm.listening.toggleSlow()
        assertEquals("speed ${ChatListeningMode.SLOW}", played.last())
    }

    @Test fun revealPersistsAcrossScreens() {
        val vm = open()
        vm.listening.reveal(fresh)
        assertFalse(vm.ui.value.isHidden(fresh))
        idle("stored") { runBlocking { ChatListeningStore.revealed(app.cache, "c1") } == listOf("m3") }
        val again = open()
        idle("revealed restored") { "m3" in again.ui.value.listening.revealed }
        assertFalse(again.ui.value.isHidden(fresh))
    }

    @Test fun toggleAndHideAllAreCachedAndQueued() {
        val vm = open()
        vm.listening.toggle()
        assertFalse(vm.ui.value.listening.setting.on)
        assertFalse(vm.ui.value.isHidden(fresh))
        vm.listening.toggle()
        // On again: what is on screen stays, only newer hides.
        assertEquals(ChatListening.Setting(true, fresh.created_at), vm.ui.value.listening.setting)
        vm.listening.hideAll()
        assertEquals(ChatListening.HIDE_ALL_SINCE, vm.ui.value.listening.setting.since)
        assertTrue(vm.ui.value.isHidden(old))
        idle("three PUTs") { runBlocking { app.outbox.all() }.count { it.kind == ChatListeningStore.KIND_SET } == 3 }
        val rows = runBlocking { app.outbox.all() }.filter { it.kind == ChatListeningStore.KIND_SET }
        assertTrue(rows.all { it.method == "PUT" && it.path == "/api/conversations/c1/listening" })
        val last = app.repo.api.json.parseToJsonElement(rows.last().bodyJson!!).jsonObject
        assertTrue(last["on"]!!.jsonPrimitive.boolean)
        assertEquals(ChatListening.HIDE_ALL_SINCE, last["since"]!!.jsonPrimitive.content)
        idle("cached") { runBlocking { ChatListeningStore.setting(app.cache, "c1") }.since == ChatListening.HIDE_ALL_SINCE }
    }

    /**
     * Many changes at once (several threads): the PUTs are queued in the same order as the cache
     * writes, so the last PUT the server gets is the setting the phone ends on.
     */
    @Test fun outboxOrderFollowsTheCacheWrites() {
        runBlocking {
            kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Default) {
                (0 until 24).map { i ->
                    launch { ChatListeningStore.setConversation(app, "c1", i % 2 == 0, "2026-10-02T09:${(10 + i).toString().padStart(2, '0')}:00.000Z") }
                }.forEach { it.join() }
            }
        }
        val rows = runBlocking { app.outbox.all() }.filter { it.kind == ChatListeningStore.KIND_SET }
        assertEquals(24, rows.size)
        val last = app.repo.api.json.parseToJsonElement(rows.last().bodyJson!!).jsonObject
        val cached = runBlocking { ChatListeningStore.setting(app.cache, "c1") }
        assertEquals(cached.on, last["on"]!!.jsonPrimitive.boolean)
        assertEquals(cached.since, last["since"]!!.jsonPrimitive.content)
    }

    @Test fun inboxAndNotificationsSayNewMessage() = runBlocking {
        val state = ChatListeningStore.state(app.cache)
        val row = ChatListRow(
            "c1", "rel1", null, false, ChatListPerson("t1", "Minghui"), "tutor",
            ChatListLastMessage("m3", "t1", fresh.content, fresh.created_at), unread = 1, myReadAt = "2026-10-02T09:01:00.000Z",
        )
        assertEquals(ChatListening.LISTENING_PREVIEW, ChatListeningStore.inboxPreview(row, "me", state, emptyList()))
        assertNull(ChatListeningStore.inboxPreview(row, "me", state, listOf("m3")), "revealed → the text")
        assertNull(ChatListeningStore.inboxPreview(row.copy(lastMessage = row.lastMessage!!.copy(attachmentKind = "image")), "me", state, emptyList()))
        val chat = IncomingChat.fromMessage(fresh, "rel1")
        assertEquals(ChatListening.LISTENING_PREVIEW, ChatListeningStore.masked(app.cache, chat, fresh.content, null, null, "me").content)
        assertEquals(fresh.content, ChatListeningStore.masked(app.cache, chat.copy(conversationId = "c9"), fresh.content, null, null, "me").content, "no row, default off")
    }
}
