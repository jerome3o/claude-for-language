package dev.jeromeswannack.chineselearning.lab.data.chat

import dev.jeromeswannack.chineselearning.lab.core.Pinyin
import dev.jeromeswannack.chineselearning.lab.data.api.ChatMessageDto
import dev.jeromeswannack.chineselearning.lab.data.api.InboxMessageDto
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import kotlinx.serialization.Serializable

/**
 * One chat message to me, whichever way it arrived (docs/CHAT.md §5): an FCM data message,
 * the live socket (ChatHub) or the background inbox check. Notifications dedupe on [messageId].
 */
@Serializable
data class IncomingChat(
    val messageId: String,
    val conversationId: String,
    val relationshipId: String,
    val senderId: String,
    val senderName: String,
    val senderPicture: String? = null,
    val content: String,
    val createdAt: String,
) {
    /** The web route the notification opens (`/connections/<rel>/chat/<conv>`). */
    val route: String get() = Routes.chat(relationshipId, conversationId)

    companion object {
        fun fromInbox(m: InboxMessageDto) = IncomingChat(
            messageId = m.id,
            conversationId = m.conversation_id,
            relationshipId = m.relationship_id,
            senderId = m.sender.id,
            senderName = m.sender.name?.takeIf { it.isNotBlank() } ?: "New message",
            senderPicture = m.sender.picture_url,
            content = m.content,
            createdAt = m.created_at,
        )

        fun fromMessage(m: ChatMessageDto, relationshipId: String) = IncomingChat(
            messageId = m.id,
            conversationId = m.conversation_id,
            relationshipId = relationshipId,
            senderId = m.sender_id.ifEmpty { m.sender.id },
            senderName = m.sender.name?.takeIf { it.isNotBlank() } ?: "New message",
            senderPicture = m.sender.picture_url,
            content = m.content,
            createdAt = m.created_at,
        )
    }
}

/** What an FCM data message asks for (docs/CHAT.md §3 / §2 `chat_read`). */
sealed interface PushEvent {
    data class Message(val chat: IncomingChat) : PushEvent
    data class Read(val conversationId: String, val lastReadAt: String?) : PushEvent
}

object ChatPushData {
    /** FCM data (all values strings) → the event, or null for anything this app doesn't handle. */
    fun parse(data: Map<String, String>): PushEvent? = when (data["type"]) {
        "chat_message" -> {
            val conv = data["conversation_id"].orEmpty()
            val id = data["message_id"].orEmpty()
            val rel = data["relationship_id"].orEmpty().ifEmpty { relFromUrl(data["url"]).orEmpty() }
            if (conv.isEmpty() || id.isEmpty() || rel.isEmpty()) null
            else PushEvent.Message(
                IncomingChat(
                    messageId = id,
                    conversationId = conv,
                    relationshipId = rel,
                    senderId = data["sender_id"].orEmpty(),
                    senderName = data["sender_name"]?.takeIf { it.isNotBlank() } ?: "New message",
                    senderPicture = data["sender_picture_url"]?.takeIf { it.isNotBlank() },
                    content = data["content"].orEmpty(),
                    createdAt = data["created_at"].orEmpty(),
                ),
            )
        }
        "chat_read" -> data["conversation_id"]?.takeIf { it.isNotEmpty() }?.let { PushEvent.Read(it, data["last_read_at"]) }
        else -> null
    }

    private fun relFromUrl(url: String?): String? =
        url?.let { Regex("^/connections/([^/]+)/chat/").find(it)?.groupValues?.get(1) }
}

/** The pinyin line under a message with hanzi in it (docs/CHAT.md §5); null when there's no hanzi. */
object ChatPinyin {
    private const val MAX = 300

    fun isHan(cp: Int): Boolean = Character.UnicodeScript.of(cp) == Character.UnicodeScript.HAN

    fun line(text: String): String? {
        val t = text.take(MAX)
        if (t.codePoints().noneMatch(::isHan)) return null
        val out = StringBuilder()
        val run = StringBuilder()
        fun flush() {
            if (run.isEmpty()) return
            val p = runCatching { Pinyin.toPinyin(run.toString()) }.getOrNull() ?: return run.setLength(0)
            if (out.isNotEmpty() && !out.endsWith(" ")) out.append(' ')
            out.append(p)
            run.setLength(0)
        }
        var i = 0
        while (i < t.length) {
            val cp = t.codePointAt(i)
            val s = String(Character.toChars(cp))
            if (isHan(cp)) run.append(s) else {
                flush()
                val mapped = PUNCT[s] ?: s
                if (mapped.isBlank()) { if (out.isNotEmpty() && !out.endsWith(" ")) out.append(' ') } else out.append(mapped)
            }
            i += Character.charCount(cp)
        }
        flush()
        return out.toString().replace(Regex(" +"), " ").trim().takeIf { it.isNotEmpty() }
    }

    private val PUNCT = mapOf(
        "，" to ", ", "。" to ". ", "！" to "! ", "？" to "? ", "、" to ", ", "：" to ": ", "；" to "; ",
        "“" to "\"", "”" to "\"", "（" to " (", "）" to ") ", "《" to "«", "》" to "»", "～" to "~", "…" to "…", "\n" to " ",
    )
}
