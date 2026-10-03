package dev.jeromeswannack.chineselearning.lab.data.chat

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.RemoteInput
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.data.api.ChatReadBody
import dev.jeromeswannack.chineselearning.lab.data.api.SendMessageBody
import dev.jeromeswannack.chineselearning.lab.data.api.chatMessagesPath
import dev.jeromeswannack.chineselearning.lab.data.api.chatReadPath
import kotlinx.coroutines.launch
import java.util.UUID

/** A chat notification's Reply / Mark as read, and its swipe-away (forgets the shown lines). */
class ChatActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val app = context.applicationContext as? LabApp ?: return
        val conv = intent.getStringExtra(EXTRA_CONVERSATION) ?: return
        val pending = goAsync()
        app.scope.launch {
            try {
                when (intent.action) {
                    ACTION_REPLY -> {
                        val text = RemoteInput.getResultsFromIntent(intent)?.getCharSequence(ChatNotifier.KEY_REPLY)?.toString()
                        ChatActions.reply(app, conv, text.orEmpty())
                    }
                    ACTION_MARK_READ -> ChatActions.markRead(app, conv)
                    ACTION_DISMISSED -> ChatNotificationStore(app).remove(conv)
                }
            } catch (e: Exception) {
                android.util.Log.w("ChatActionReceiver", "${intent.action} failed", e)
            } finally {
                pending.finish()
            }
        }
    }

    companion object {
        const val ACTION_REPLY = "dev.jeromeswannack.chineselearning.lab.chat.REPLY"
        const val ACTION_MARK_READ = "dev.jeromeswannack.chineselearning.lab.chat.MARK_READ"
        const val ACTION_DISMISSED = "dev.jeromeswannack.chineselearning.lab.chat.DISMISSED"
        const val EXTRA_CONVERSATION = "conversation_id"
        const val EXTRA_RELATIONSHIP = "relationship_id"
    }
}

/**
 * The writes behind the notification actions — through the outbox, so a reply typed on the
 * train goes when the signal comes back (idempotent: the send carries a client_id, `/read` only
 * moves forward).
 */
object ChatActions {
    const val KIND_SEND = "chat_message"
    const val KIND_READ = "chat_read"
    /** A photo / voice message: raw `POST /api/conversations/:id/media?…&client_id=` (docs/CHAT.md PR 2). */
    const val KIND_MEDIA = "chat_media"
    /** Round 2 PR 3: `POST /api/messages/:id/forward { conversation_id, client_id }` (idempotent by client_id). */
    const val KIND_FORWARD = "chat_forward"

    /** Queues [text] for [conversationId]; returns the client id (null for an empty reply). */
    suspend fun reply(app: LabApp, conversationId: String, text: String): String? {
        val content = text.trim()
        if (content.isEmpty()) {
            ChatNotifier.repost(app, conversationId) // clears the reply field's spinner
            return null
        }
        val clientId = UUID.randomUUID().toString()
        app.outbox.enqueueJson(KIND_SEND, "POST", chatMessagesPath(conversationId), SendMessageBody(content, null, clientId), id = clientId)
        ChatNotifier.appendMyReply(app, conversationId, content, clientId)
        flush(app)
        return clientId
    }

    /** Mark as read up to the newest message the notification shows, and drop it. */
    suspend fun markRead(app: LabApp, conversationId: String) {
        val upTo = ChatNotificationStore(app).get(conversationId)?.newestIncoming?.createdAt?.takeIf { it.isNotEmpty() }
        app.outbox.enqueueJson(KIND_READ, "POST", chatReadPath(conversationId), ChatReadBody(upTo), id = "chat-read-$conversationId-${upTo ?: System.currentTimeMillis()}")
        ChatNotifier.cancel(app, conversationId)
        flush(app)
    }

    /** Send now when online; the upload worker otherwise (and as a backstop). */
    fun flush(app: LabApp) {
        runCatching { app.scheduleBackgroundUpload() }
        if (app.online.value) app.scope.launch { runCatching { app.outbox.drain() } }
    }
}
