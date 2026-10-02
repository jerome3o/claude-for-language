package dev.jeromeswannack.chineselearning.lab.data.chat

import android.app.NotificationManager
import android.content.Intent
import android.os.Bundle
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.RemoteInput
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.MainActivity
import dev.jeromeswannack.chineselearning.lab.data.platform.OutboxEntity
import kotlinx.coroutines.runBlocking
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The real app: notification Reply / Mark as read through the outbox, and the tap opening the chat. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = LabApp::class)
class ChatDeliveryAppTest {
    private lateinit var app: LabApp
    private lateinit var nm: NotificationManager

    @Before
    fun setUp() {
        app = ApplicationProvider.getApplicationContext()
        app.prefs.sessionToken = "test-session"
        app.prefs.accountRole = "student"
        nm = app.getSystemService(NotificationManager::class.java)
        ChatPresence.setForeground(false)
        ChatPresence.visibleConversation.value?.let(ChatPresence::chatClosed)
    }

    private fun incoming() = runBlocking {
        ChatNotifier.notifyIncoming(app, IncomingChat("m1", "c1", "r1", "u-tutor", "Minghui", null, "明天上课吗？", "2026-10-02T10:00:00.000Z"), "u-me") { null }
    }

    private fun notification() = shadowOf(nm).getNotification(ChatNotifier.TAG, ChatNotifier.notificationId("c1"))

    private fun outbox(): List<OutboxEntity> = runBlocking { app.outbox.all() }

    private fun waitFor(what: String, check: () -> Boolean) {
        repeat(200) {
            shadowOf(Looper.getMainLooper()).idle()
            if (check()) return
            Thread.sleep(10)
        }
        throw AssertionError("timed out waiting for $what")
    }

    @Test
    fun replyFromTheNotificationQueuesAnIdempotentSendAndShowsIt() {
        incoming()
        val reply = notification()!!.actions[0]
        val intent = Intent(shadowOf(reply.actionIntent).savedIntent)
        RemoteInput.addResultsToIntent(reply.remoteInputs.map { androidx.core.app.RemoteInput.Builder(it.resultKey).build() }.toTypedArray(), intent, Bundle().apply { putCharSequence(ChatNotifier.KEY_REPLY, "对，三点见") })
        ChatActionReceiver().onReceive(app, intent)
        waitFor("the outbox send") { outbox().any { it.kind == ChatActions.KIND_SEND } }
        val item = outbox().single { it.kind == ChatActions.KIND_SEND }
        assertEquals("POST", item.method)
        assertEquals("/api/conversations/c1/messages", item.path)
        val body = app.repo.api.json.parseToJsonElement(item.bodyJson!!).let { it as kotlinx.serialization.json.JsonObject }
        assertEquals("对，三点见", body["content"].toString().trim('"'))
        assertEquals(item.id, body["client_id"].toString().trim('"'), "the outbox id IS the client_id (idempotent replays)")
        waitFor("my reply in the notification") {
            NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(notification()!!)!!.messages.size == 2
        }
        val last = NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(notification()!!)!!.messages.last()
        assertEquals("对，三点见", last.text.toString())
        assertNull(last.person, "a null person = me")
    }

    @Test
    fun markAsReadQueuesTheReadMarkerAndCancels() {
        incoming()
        runBlocking { ChatActions.markRead(app, "c1") }
        val item = outbox().single { it.kind == ChatActions.KIND_READ }
        assertEquals("/api/conversations/c1/read", item.path)
        assertTrue(item.bodyJson!!.contains("\"up_to\":\"2026-10-02T10:00:00.000Z\""), item.bodyJson)
        assertNull(notification())
    }

    @Test
    fun theNotificationOpensTheChatFromAColdStart() {
        incoming()
        val intent = shadowOf(notification()!!.contentIntent).savedIntent
        val controller = Robolectric.buildActivity(MainActivity::class.java, intent).setup()
        println("DEBUG finishing=${controller.get().isFinishing} next=${shadowOf(app).nextStartedActivity}")
        waitFor("the chat screen") { ChatPresence.visibleConversation.value == "c1" }
        controller.pause().stop().destroy()
    }

    @Test
    fun theNotificationOpensTheChatWhenTheAppIsAlreadyOpen() {
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        repeat(20) { shadowOf(Looper.getMainLooper()).idle(); Thread.sleep(10) }
        assertNull(ChatPresence.visibleConversation.value)
        incoming()
        controller.newIntent(shadowOf(notification()!!.contentIntent).savedIntent)
        waitFor("the chat screen") { ChatPresence.visibleConversation.value == "c1" }
        assertNotNull(controller.get())
        controller.pause().stop().destroy()
    }
}
