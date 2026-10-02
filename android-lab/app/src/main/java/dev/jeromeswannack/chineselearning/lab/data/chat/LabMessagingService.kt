package dev.jeromeswannack.chineselearning.lab.data.chat

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.ui.connections.Connections
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull

/**
 * FCM (only when configured — PushRegistration): `chat_message` → the conversation's
 * notification (and a nudge for an open chat); `chat_correction` (PR 3) → a "✏️ <tutor> corrected
 * your message" line in that conversation's notification; `chat_read` → drop that conversation's
 * notification (read on another device). Data-only messages, so this runs for every push.
 */
class LabMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        val app = application as? LabApp ?: return
        app.scope.launch { runCatching { PushRegistration.register(app, token) } }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val app = application as? LabApp ?: return
        when (val event = ChatPushData.parse(message.data)) {
            is PushEvent.Message -> {
                app.chatLive.nudge(event.chat.conversationId)
                // onMessageReceived has ~10 s; the avatar download is the only slow part.
                runBlocking {
                    withTimeoutOrNull(8_000) {
                        runCatching { ChatNotifier.notifyIncoming(app, event.chat, Connections.myId(app.cache)) }
                    }
                }
            }
            is PushEvent.Read -> ChatNotifier.cancel(app, event.conversationId)
            is PushEvent.Correction -> {
                // The open chat gets the corrected message over the socket (message_updated); nudge it anyway.
                app.chatLive.nudge(event.chat.conversationId)
                runBlocking {
                    withTimeoutOrNull(8_000) {
                        runCatching { ChatNotifier.notifyIncoming(app, event.chat, Connections.myId(app.cache)) }
                    }
                }
            }
            null -> Unit
        }
    }
}
