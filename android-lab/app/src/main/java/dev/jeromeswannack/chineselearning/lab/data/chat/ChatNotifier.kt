package dev.jeromeswannack.chineselearning.lab.data.chat

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.app.RemoteInput
import androidx.core.content.ContextCompat
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import dev.jeromeswannack.chineselearning.lab.R
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.data.Prefs
import dev.jeromeswannack.chineselearning.lab.shell.ShellLinks

/**
 * Chat notifications (docs/CHAT.md §5 Lab): channel `lab_messages` "Messages" (high importance),
 * ONE notification per conversation — MessagingStyle with the sender as a Person (name + round
 * avatar), the last few lines of that conversation (each with a pinyin line when it has hanzi),
 * **Reply** (RemoteInput → outbox `POST …/messages` with a client_id, my reply appended here) and
 * **Mark as read** (outbox `POST …/read`). Tapping opens `/connections/<rel>/chat/<conv>`.
 * Nothing is posted while that chat is on screen (ChatPresence).
 */
object ChatNotifier {
    const val CHANNEL = "lab_messages"
    const val TAG = "lab_chat"
    const val KEY_REPLY = "lab_chat_reply"

    /** Stable per conversation (String.hashCode is specified), clear of the shell's 31xx ids. */
    fun notificationId(conversationId: String): Int = 0x4C000000 or (conversationId.hashCode() and 0x00FFFFFF)

    fun ensureChannel(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
        if (nm.getNotificationChannel(CHANNEL) != null) return
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL, ctx.getString(R.string.chat_channel_messages), NotificationManager.IMPORTANCE_HIGH)
                .apply { description = ctx.getString(R.string.chat_channel_messages_desc) },
        )
    }

    /**
     * Shows [chat] (appended to its conversation's notification). False when it was mine, is
     * already shown (dedupe by message id), or that chat is on screen.
     */
    suspend fun notifyIncoming(
        ctx: Context,
        chat: IncomingChat,
        myId: String? = null,
        avatar: suspend (IncomingChat) -> Bitmap? = { ChatAvatars.load(ctx, it.senderPicture, it.senderName) },
    ): Boolean {
        if (myId != null && chat.senderId == myId) return false
        val store = ChatNotificationStore(ctx)
        if (ChatPresence.isShowing(chat.conversationId)) {
            store.markNotified(chat.messageId)
            return false
        }
        if (!store.markNotified(chat.messageId)) return false
        val prev = store.get(chat.conversationId)
        val line = ChatNotificationStore.Line(chat.messageId, chat.content, chat.createdAt, timeMs(chat.createdAt))
        val c = ChatNotificationStore.Conversation(
            conversationId = chat.conversationId,
            relationshipId = chat.relationshipId.ifEmpty { prev?.relationshipId.orEmpty() },
            senderId = chat.senderId,
            senderName = chat.senderName,
            senderPicture = chat.senderPicture ?: prev?.senderPicture,
            lines = (prev?.lines.orEmpty().filter { it.id != line.id } + line).sortedBy { it.timeMs }.takeLast(ChatNotificationStore.MAX_LINES),
        )
        store.put(c)
        post(ctx, c, runCatching { avatar(chat) }.getOrNull(), alert = true)
        return true
    }

    /** My reply from the notification: appended as a "me" line, quietly (docs/CHAT.md §5). */
    suspend fun appendMyReply(ctx: Context, conversationId: String, text: String, clientId: String, avatar: suspend (ChatNotificationStore.Conversation) -> Bitmap? = { ChatAvatars.load(ctx, it.senderPicture, it.senderName) }) {
        val store = ChatNotificationStore(ctx)
        val prev = store.get(conversationId) ?: return
        val now = System.currentTimeMillis()
        val c = prev.copy(lines = (prev.lines + ChatNotificationStore.Line(clientId, text, Js.toIsoString(now), now, fromMe = true)).takeLast(ChatNotificationStore.MAX_LINES))
        store.put(c)
        post(ctx, c, runCatching { avatar(c) }.getOrNull(), alert = false)
    }

    /** Posts the conversation's notification again unchanged (quietly). */
    suspend fun repost(ctx: Context, conversationId: String) {
        val c = ChatNotificationStore(ctx).get(conversationId) ?: return
        post(ctx, c, runCatching { ChatAvatars.load(ctx, c.senderPicture, c.senderName) }.getOrNull(), alert = false)
    }

    /** Read here or elsewhere (chat opened, `chat_read` push, `read` event, Mark as read). */
    fun cancel(ctx: Context, conversationId: String) {
        ChatNotificationStore(ctx).remove(conversationId)
        NotificationManagerCompat.from(ctx).cancel(TAG, notificationId(conversationId))
    }

    /** Sign-out: every chat notification and what they remembered. */
    fun cancelAll(ctx: Context) {
        val store = ChatNotificationStore(ctx)
        store.conversationIds().forEach { NotificationManagerCompat.from(ctx).cancel(TAG, notificationId(it)) }
        store.clear()
    }

    /** The text of one line: the message, then its pinyin when it has hanzi (not for my own replies). */
    fun lineText(l: ChatNotificationStore.Line): String {
        if (l.fromMe) return l.text
        val p = ChatPinyin.line(l.text) ?: return l.text
        return "${l.text}\n$p"
    }

    fun build(ctx: Context, c: ChatNotificationStore.Conversation, avatar: Bitmap?, alert: Boolean): Notification {
        val myName = runCatching { Prefs(ctx).userName }.getOrNull()?.takeIf { it.isNotBlank() } ?: "You"
        val me = Person.Builder().setName(myName).setKey("me").build()
        val icon = avatar?.let { IconCompat.createWithBitmap(it) }
        val other = Person.Builder().setName(c.senderName).setKey(c.senderId.ifEmpty { c.senderName }).apply { if (icon != null) setIcon(icon) }.build()
        val style = NotificationCompat.MessagingStyle(me)
        c.lines.forEach { l -> style.addMessage(NotificationCompat.MessagingStyle.Message(lineText(l), l.timeMs, if (l.fromMe) null else other)) }
        val id = notificationId(c.conversationId)
        val route = dev.jeromeswannack.chineselearning.lab.ui.nav.Routes.chat(c.relationshipId, c.conversationId)
        val shortcutId = pushShortcut(ctx, c, other, icon, route)
        val unread = c.lines.count { !it.fromMe }
        val reply = NotificationCompat.Action.Builder(0, ctx.getString(R.string.chat_action_reply), actionIntent(ctx, ChatActionReceiver.ACTION_REPLY, c, id + 1, mutable = true))
            .addRemoteInput(RemoteInput.Builder(KEY_REPLY).setLabel(ctx.getString(R.string.chat_reply_hint, c.senderName)).build())
            .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
            .setShowsUserInterface(false)
            .setAllowGeneratedReplies(true)
            .build()
        val read = NotificationCompat.Action.Builder(0, ctx.getString(R.string.chat_action_mark_read), actionIntent(ctx, ChatActionReceiver.ACTION_MARK_READ, c, id + 2, mutable = false))
            .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_MARK_AS_READ)
            .setShowsUserInterface(false)
            .build()
        return NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_lab)
            .setColor(ContextCompat.getColor(ctx, R.color.shell_accent))
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setStyle(style)
            .setContentTitle(c.senderName)
            .setContentText(c.lines.lastOrNull()?.text.orEmpty())
            .setWhen(c.lines.lastOrNull()?.timeMs ?: System.currentTimeMillis())
            .setShowWhen(true)
            .setNumber(unread)
            .setContentIntent(ShellLinks.pending(ctx, id, route))
            .setDeleteIntent(actionIntent(ctx, ChatActionReceiver.ACTION_DISMISSED, c, id + 3, mutable = false))
            .addAction(reply)
            .addAction(read)
            .setAutoCancel(true)
            .setOnlyAlertOnce(!alert)
            .setSilent(!alert)
            .apply { if (shortcutId != null) setShortcutId(shortcutId) }
            .build()
    }

    private fun post(ctx: Context, c: ChatNotificationStore.Conversation, avatar: Bitmap?, alert: Boolean) {
        ensureChannel(ctx)
        try {
            NotificationManagerCompat.from(ctx).notify(TAG, notificationId(c.conversationId), build(ctx, c, avatar, alert))
        } catch (_: SecurityException) {
            // No POST_NOTIFICATIONS permission: stay silent.
        }
    }

    /** A long-lived conversation shortcut → the notification lands in Android's Conversations section. */
    private fun pushShortcut(ctx: Context, c: ChatNotificationStore.Conversation, person: Person, icon: IconCompat?, route: String): String? = runCatching {
        val id = "chat-${c.conversationId}"
        ShortcutManagerCompat.pushDynamicShortcut(
            ctx,
            ShortcutInfoCompat.Builder(ctx, id)
                .setShortLabel(c.senderName)
                .setLongLived(true)
                .setPerson(person)
                .setIcon(icon ?: IconCompat.createWithResource(ctx, R.mipmap.ic_launcher))
                .setIntent(ShellLinks.intent(ctx, route))
                .build(),
        )
        id
    }.getOrNull()

    private fun actionIntent(ctx: Context, action: String, c: ChatNotificationStore.Conversation, requestCode: Int, mutable: Boolean): PendingIntent {
        val intent = Intent(ctx, ChatActionReceiver::class.java).setAction(action)
            .putExtra(ChatActionReceiver.EXTRA_CONVERSATION, c.conversationId)
            .putExtra(ChatActionReceiver.EXTRA_RELATIONSHIP, c.relationshipId)
        // RemoteInput fills the intent in, so Reply's must be mutable on Android 12+.
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or if (mutable && Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else PendingIntent.FLAG_IMMUTABLE
        return PendingIntent.getBroadcast(ctx, requestCode, intent, flags)
    }

    fun timeMs(iso: String): Long = runCatching { Js.parseDate(iso) }.getOrNull()?.takeIf { it > 0 } ?: System.currentTimeMillis()
}
