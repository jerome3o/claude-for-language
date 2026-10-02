package dev.jeromeswannack.chineselearning.lab.data.chat

import android.content.Context
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json

/**
 * What each chat notification shows (the last few lines of that conversation, so a second
 * message appends instead of replacing), the message ids already notified (FCM, the socket and
 * the inbox check all deliver the same message) and the inbox check's cursor.
 * SharedPreferences, so a notification can be rebuilt from a BroadcastReceiver in a cold process.
 */
class ChatNotificationStore(context: Context) {
    private val sp = context.applicationContext.getSharedPreferences("lab_chat_notifications", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }

    @Serializable
    data class Line(val id: String, val text: String, val createdAt: String, val timeMs: Long, val fromMe: Boolean = false)

    @Serializable
    data class Conversation(
        val conversationId: String,
        val relationshipId: String,
        val senderId: String,
        val senderName: String,
        val senderPicture: String? = null,
        val lines: List<Line> = emptyList(),
    ) {
        /** The newest message from the other person (Mark as read reads up to it). */
        val newestIncoming: Line? get() = lines.lastOrNull { !it.fromMe }
    }

    @Synchronized
    fun get(conversationId: String): Conversation? =
        sp.getString(KEY_CONV + conversationId, null)?.let { runCatching { json.decodeFromString(Conversation.serializer(), it) }.getOrNull() }

    @Synchronized
    fun put(c: Conversation) {
        sp.edit().putString(KEY_CONV + c.conversationId, json.encodeToString(Conversation.serializer(), c.copy(lines = c.lines.takeLast(MAX_LINES)))).apply()
    }

    @Synchronized
    fun remove(conversationId: String) {
        sp.edit().remove(KEY_CONV + conversationId).apply()
    }

    @Synchronized
    fun conversationIds(): List<String> = sp.all.keys.filter { it.startsWith(KEY_CONV) }.map { it.removePrefix(KEY_CONV) }

    /** True the first time [messageId] is seen; remembers the last [MAX_IDS]. */
    @Synchronized
    fun markNotified(messageId: String): Boolean {
        val ids = notifiedIds()
        if (messageId in ids) return false
        val next = (ids + messageId).takeLast(MAX_IDS)
        sp.edit().putString(KEY_IDS, json.encodeToString(ListSerializer(String.serializer()), next)).apply()
        return true
    }

    @Synchronized
    fun notifiedIds(): List<String> =
        sp.getString(KEY_IDS, null)?.let { runCatching { json.decodeFromString(ListSerializer(String.serializer()), it) }.getOrNull() }.orEmpty()

    /** The inbox check's `since` (ISO, server clock). */
    var inboxSince: String?
        @Synchronized get() = sp.getString(KEY_SINCE, null)
        @Synchronized set(v) { sp.edit().putString(KEY_SINCE, v).apply() }

    @Synchronized
    fun clear() {
        sp.edit().clear().apply()
    }

    companion object {
        const val MAX_LINES = 6
        const val MAX_IDS = 300
        private const val KEY_CONV = "conv:"
        private const val KEY_IDS = "notified_ids"
        private const val KEY_SINCE = "inbox_since"
    }
}
