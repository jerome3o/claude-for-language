package dev.jeromeswannack.chineselearning.lab.data.chat

import android.app.Application
import android.app.Notification
import android.app.NotificationManager
import androidx.core.app.NotificationCompat
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.data.Api
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Chat notifications (docs/CHAT.md §5 Lab): parsing, MessagingStyle, actions, dedupe, inbox check. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class ChatNotificationsTest {
    private lateinit var ctx: Application
    private lateinit var nm: NotificationManager

    @Before
    fun setUp() {
        ctx = ApplicationProvider.getApplicationContext()
        nm = ctx.getSystemService(NotificationManager::class.java)
        ChatPresence.setForeground(false)
        ChatPresence.visibleConversation.value?.let(ChatPresence::chatClosed)
    }

    private fun chat(id: String, content: String, at: String, conv: String = "c1", sender: String = "u-tutor") =
        IncomingChat(id, conv, "r1", sender, "Minghui", null, content, at)

    private fun notification(conv: String = "c1"): Notification? = shadowOf(nm).getNotification(ChatNotifier.TAG, ChatNotifier.notificationId(conv))

    private fun post(c: IncomingChat, myId: String? = "u-me") = runBlocking { ChatNotifier.notifyIncoming(ctx, c, myId) { null } }

    // ---------------- FCM data ----------------

    @Test fun parsesAChatMessagePush() {
        val e = ChatPushData.parse(
            mapOf(
                "type" to "chat_message", "conversation_id" to "c1", "relationship_id" to "r1", "message_id" to "m1",
                "sender_id" to "u-tutor", "sender_name" to "Minghui", "sender_picture_url" to "https://x/p.jpg",
                "content" to "你好！", "created_at" to "2026-10-02T10:00:00.000Z", "url" to "/connections/r1/chat/c1",
            ),
        )
        val m = (e as PushEvent.Message).chat
        assertEquals(IncomingChat("m1", "c1", "r1", "u-tutor", "Minghui", "https://x/p.jpg", "你好！", "2026-10-02T10:00:00.000Z"), m)
        assertEquals("/connections/r1/chat/c1", m.route)
    }

    @Test fun pushWithoutRelationshipTakesItFromTheUrl_andIncompleteOnesAreIgnored() {
        val e = ChatPushData.parse(mapOf("type" to "chat_message", "conversation_id" to "c9", "message_id" to "m", "url" to "/connections/r9/chat/c9"))
        assertEquals("r9", (e as PushEvent.Message).chat.relationshipId)
        assertEquals("New message", e.chat.senderName)
        assertNull(ChatPushData.parse(mapOf("type" to "chat_message", "conversation_id" to "c9")))
        assertEquals(PushEvent.Read("c2", null), ChatPushData.parse(mapOf("type" to "chat_read", "conversation_id" to "c2")))
        assertNull(ChatPushData.parse(mapOf("type" to "something_else")))
        assertNull(ChatPushData.parse(emptyMap()))
    }

    // ---------------- PR 3: chat_correction ----------------

    private val correctionPush = mapOf(
        "type" to "chat_correction", "conversation_id" to "c1", "relationship_id" to "r1", "message_id" to "m7",
        "sender_name" to "Minghui", "content" to "✏️ Minghui corrected your message", "url" to "/connections/r1/chat/c1",
    )

    @Test fun parsesACorrectionPush() {
        val e = ChatPushData.parse(correctionPush) as PushEvent.Correction
        assertEquals("m7", e.messageId)
        assertEquals(ChatPushData.correctionKey("m7"), e.chat.messageId)
        assertEquals("✏️ Minghui corrected your message", e.chat.content)
        assertEquals("Minghui", e.chat.senderName)
        assertEquals("/connections/r1/chat/c1", e.chat.route)
        // No relationship id → from the url; no content → the worker's wording; incomplete → ignored.
        val bare = ChatPushData.parse(mapOf("type" to "chat_correction", "conversation_id" to "c2", "message_id" to "m", "url" to "/connections/r2/chat/c2")) as PushEvent.Correction
        assertEquals("r2", bare.chat.relationshipId)
        assertEquals("✏️ Your tutor corrected your message", bare.chat.content)
        assertNull(ChatPushData.parse(mapOf("type" to "chat_correction", "conversation_id" to "c2")))
    }

    @Test fun aCorrectionIsALineInTheConversationsNotification() {
        post(chat("m1", "你好！我昨天去商店买东西了。", "2026-01-02T10:00:00.000Z"))
        val e = ChatPushData.parse(correctionPush) as PushEvent.Correction
        assertTrue(post(e.chat))
        val style = NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(notification("c1")!!)!!
        assertEquals(2, style.messages.size)
        assertEquals("✏️ Minghui corrected your message", style.messages.last().text.toString())
        assertEquals("Minghui", style.messages.last().person?.name.toString())
        assertFalse(post(e.chat), "the same correction pushed twice shows once")
    }

    @Test fun pinyinLineOnlyForHanzi() {
        assertEquals("nǐ hǎo!", ChatPinyin.line("你好！"))
        assertEquals("OK, míng tiān jiàn", ChatPinyin.line("OK，明天见"))
        assertNull(ChatPinyin.line("See you tomorrow"))
    }

    // ---------------- the notification ----------------

    @Test fun oneMessagingStyleNotificationPerConversationThatAppends() {
        assertTrue(post(chat("m1", "你好！", "2026-10-02T10:00:00.000Z")))
        assertTrue(post(chat("m2", "Ready for tomorrow?", "2026-10-02T10:01:00.000Z")))
        val n = assertNotNull(notification())
        assertEquals(ChatNotifier.CHANNEL, n.channelId)
        assertEquals(Notification.CATEGORY_MESSAGE, n.category)
        val style = assertNotNull(NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(n))
        assertEquals(listOf("你好！\nnǐ hǎo!", "Ready for tomorrow?"), style.messages.map { it.text.toString() })
        assertEquals(listOf("Minghui", "Minghui"), style.messages.map { it.person?.name?.toString() })
        // Only one chat notification is showing.
        assertEquals(1, shadowOf(nm).allNotifications.count { it.channelId == ChatNotifier.CHANNEL })
    }

    @Test fun tappingOpensTheChatRoute() {
        post(chat("m1", "你好", "2026-10-02T10:00:00.000Z"))
        val n = assertNotNull(notification())
        val intent = shadowOf(n.contentIntent).savedIntent
        assertEquals("chineselearning-lab:///connections/r1/chat/c1", intent.data.toString())
        assertEquals(dev.jeromeswannack.chineselearning.lab.MainActivity::class.java.name, intent.component?.className)
    }

    @Test fun replyAndMarkAsReadActions() {
        post(chat("m1", "你好", "2026-10-02T10:00:00.000Z"))
        val n = assertNotNull(notification())
        assertEquals(listOf("Reply", "Mark as read"), n.actions.map { it.title.toString() })
        val reply = n.actions[0]
        assertEquals(ChatNotifier.KEY_REPLY, reply.remoteInputs.single().resultKey)
        assertEquals(ChatActionReceiver.ACTION_REPLY, shadowOf(reply.actionIntent).savedIntent.action)
        assertEquals("c1", shadowOf(reply.actionIntent).savedIntent.getStringExtra(ChatActionReceiver.EXTRA_CONVERSATION))
        assertEquals(ChatActionReceiver.ACTION_MARK_READ, shadowOf(n.actions[1].actionIntent).savedIntent.action)
        assertEquals(Notification.Action.SEMANTIC_ACTION_MARK_AS_READ, n.actions[1].semanticAction)
    }

    @Test fun dedupesByMessageId_skipsMine_andTheChatOnScreen() {
        assertTrue(post(chat("m1", "你好", "2026-10-02T10:00:00.000Z")))
        assertFalse(post(chat("m1", "你好", "2026-10-02T10:00:00.000Z")), "the same message from a second source")
        assertFalse(post(chat("m2", "my own", "2026-10-02T10:00:30.000Z", sender = "u-me")), "my own message")
        ChatPresence.setForeground(true)
        ChatPresence.chatOpened("c2")
        assertFalse(post(chat("m3", "on screen", "2026-10-02T10:01:00.000Z", conv = "c2")))
        assertNull(notification("c2"))
        // Backgrounded with the chat still on top: notify.
        ChatPresence.setForeground(false)
        assertTrue(post(chat("m4", "now away", "2026-10-02T10:02:00.000Z", conv = "c2")))
        val style = NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(notification("c1")!!)!!
        assertEquals(1, style.messages.size)
    }

    @Test fun cancelOnRead() {
        post(chat("m1", "你好", "2026-10-02T10:00:00.000Z"))
        assertNotNull(notification())
        ChatNotifier.cancel(ctx, "c1")
        assertNull(notification())
        assertNull(ChatNotificationStore(ctx).get("c1"))
        // A later message starts a fresh notification.
        post(chat("m2", "再见", "2026-10-02T11:00:00.000Z"))
        assertEquals(1, NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(notification()!!)!!.messages.size)
    }

    @Test fun keepsTheLastFewLines() {
        (1..9).forEach { i -> post(chat("m$i", "line $i", "2026-10-02T10:0$i:00.000Z")) }
        val texts = NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(notification()!!)!!.messages.map { it.text.toString() }
        assertEquals((4..9).map { "line $it" }, texts)
    }

    // ---------------- inbox check (ChatCheckWorker / socket catch-up) ----------------

    private fun inbox(serverTime: String, vararg messages: Pair<String, String>, unread: List<String> = listOf("c1")) = """
        {"server_time":"$serverTime","messages":[${messages.joinToString(",") { (id, at) ->
            """{"id":"$id","conversation_id":"c1","relationship_id":"r1","content":"消息 $id","created_at":"$at","sender":{"id":"u-tutor","name":"Minghui","picture_url":null}}"""
        }}],"conversations":[${unread.joinToString(",") { """{"conversation_id":"$it","relationship_id":"r1","unread":2,"other_user":{"id":"u-tutor","name":"Minghui"}}""" }}]}
    """.trimIndent()

    @Test fun inboxCheckNotifiesOncePerMessage_movesItsCursor_andClearsWhatWasReadElsewhere() {
        val server = MockWebServer()
        server.enqueue(MockResponse().setBody(inbox("2026-10-02T10:05:00.000Z", "m1" to "2026-10-02T10:00:00.000Z")))
        server.enqueue(MockResponse().setBody(inbox("2026-10-02T10:20:00.000Z", "m1" to "2026-10-02T10:00:00.000Z", "m2" to "2026-10-02T10:10:00.000Z")))
        server.enqueue(MockResponse().setBody(inbox("2026-10-02T10:35:00.000Z", unread = emptyList())))
        server.start()
        try {
            val api = Api(server.url("").toString().trimEnd('/')) { "token" }
            val now = dev.jeromeswannack.chineselearning.lab.core.Js.parseDate("2026-10-02T10:05:00.000Z")
            runBlocking {
                assertEquals(1, ChatInboxCheck.run(ctx, api, "u-me", now) { null }.posted)
                assertEquals(1, ChatInboxCheck.run(ctx, api, "u-me", now) { null }.posted, "m1 again is deduped, m2 is new")
            }
            val first = server.takeRequest()
            assertEquals("/api/me/chat-inbox?since=2026-10-01T10%3A05%3A00.000Z", first.path, "first run looks back a day")
            assertEquals("Bearer token", first.getHeader("Authorization"))
            assertEquals("/api/me/chat-inbox?since=2026-10-02T10%3A03%3A00.000Z", server.takeRequest().path, "server_time minus the overlap")
            val style = NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(notification()!!)!!
            assertEquals(listOf("消息 m1", "消息 m2"), style.messages.map { it.text.toString().substringBefore("\n") })
            // Read on another device: no longer unread → the notification goes.
            val r = runBlocking { ChatInboxCheck.run(ctx, api, "u-me", now) { null } }
            assertEquals(1, r.cleared)
            assertNull(notification())
        } finally {
            server.shutdown()
        }
    }

    @Test fun webSocketUrl() {
        assertEquals("wss://api.example.dev/api/live/ws?ticket=a%2Bb", ChatLive.wsUrl("https://api.example.dev", "/api/live/ws", "a+b"))
        assertEquals("ws://localhost:8787/api/live/ws?ticket=t", ChatLive.wsUrl("http://localhost:8787/", "api/live/ws", "t"))
    }
}
