package dev.jeromeswannack.chineselearning.lab.core.chat

import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.NoteSearch
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.text.Normalizer
import java.time.Instant
import java.time.ZoneOffset

/** `ChatListPerson` in shared/chats/inbox.ts. */
@Serializable
data class ChatListPerson(
    val id: String = "",
    val name: String? = null,
    @SerialName("picture_url") val pictureUrl: String? = null,
)

/** `ChatListLastMessage`: the server's one-line preview of the newest message. */
@Serializable
data class ChatListLastMessage(
    val id: String,
    @SerialName("sender_id") val senderId: String,
    val preview: String = "",
    @SerialName("created_at") val createdAt: String,
    /** 'image' | 'voice' | 'file' | 'video' when the message has an attachment (listening mode leaves those visible). */
    @SerialName("attachment_kind") val attachmentKind: String? = null,
)

/** `ChatListRow`: one conversation in the Chats inbox (`GET /api/me/chats`). */
@Serializable
data class ChatListRow(
    @SerialName("conversation_id") val conversationId: String,
    @SerialName("relationship_id") val relationshipId: String,
    val title: String? = null,
    /** A Claude role-play chat (listed in its own section). */
    @SerialName("is_ai") val isAi: Boolean = false,
    @SerialName("other_user") val otherUser: ChatListPerson = ChatListPerson(),
    /** 'tutor' = they teach me, 'student' = I teach them. */
    @SerialName("other_role") val otherRole: String = "tutor",
    @SerialName("last_message") val lastMessage: ChatListLastMessage? = null,
    /** Messages from the other person after my read marker. */
    val unread: Int = 0,
    /** My read marker in this conversation (listening mode: an undecided setting hides what's unread). */
    @SerialName("my_read_at") val myReadAt: String? = null,
    /** Newest message time, else when the conversation was made. */
    @SerialName("last_activity_at") val lastActivityAt: String = "",
)

/** `ChatListResponse`. */
@Serializable
data class ChatListResponse(
    @SerialName("server_time") val serverTime: String = "",
    val conversations: List<ChatListRow> = emptyList(),
)

/** A live `message` for [ChatInbox.applyIncomingMessage]. */
data class IncomingChatMessage(val id: String, val conversationId: String, val senderId: String, val preview: String, val createdAt: String, val attachmentKind: String? = null)

/**
 * Port of shared/chats/inbox.ts — the Chats inbox rules (the Chats tab), parity-tested
 * (parity/fixtures/chat-inbox.ts → ChatInboxParityTest).
 */
object ChatInbox {
    private const val DAY_MS = 86_400_000L
    private val WEEKDAYS = listOf("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")
    private val MONTHS = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
    private val COMBINING = Regex("[̀-ͯ]")

    /** `Date.parse` → null where JS gives NaN. */
    internal fun parse(iso: String): Long? = try { Js.parseDate(iso) } catch (_: Exception) { null }

    /**
     * Port of chatMessagePreview() in shared/chats/inbox.ts. [attachmentKind]: "image" | "voice" | "file" |
     * "video" | null; [attachmentName] = a file's name ("📄 <name>", else "📄 File"); [albumCount] = a photo
     * album's photo count (2 or more → "📷 3 photos", docs/CHAT.md "Photo albums").
     */
    fun messagePreview(content: String, attachmentKind: String? = null, deleted: Boolean = false, attachmentName: String? = null, albumCount: Double? = null): String {
        if (deleted) return "Message deleted"
        val photos = if (albumCount != null && albumCount.isFinite()) maxOf(1.0, kotlin.math.floor(albumCount)) else 1.0
        val label = when (attachmentKind) {
            "image" -> if (photos > 1) "📷 ${photos.toLong()} photos" else "📷 Photo"
            "voice" -> "🎤 Voice message"
            "file" -> if (!attachmentName.isNullOrEmpty()) "📄 $attachmentName" else "📄 File"
            "video" -> "🎬 Video"
            else -> return content // none / unknown kinds: the text
        }
        val caption = NoteSearch.jsTrim(content)
        return if (caption.isNotEmpty()) "$label: $caption" else label
    }

    /** Port of sortChatList(): newest activity first; ties by conversation id. Invalid dates count as 0. */
    fun sort(rows: List<ChatListRow>): List<ChatListRow> = rows.sortedWith { a, b ->
        val ta = parse(a.lastActivityAt) ?: 0L
        val tb = parse(b.lastActivityAt) ?: 0L
        if (tb != ta) tb.compareTo(ta) else a.conversationId.compareTo(b.conversationId).coerceIn(-1, 1)
    }

    /** Port of chatPersonName(): "Someone" when the account has no name. */
    fun personName(name: String?): String = NoteSearch.jsTrim(name.orEmpty()).ifEmpty { "Someone" }

    /** Port of chatInitial(): the first code point of the name, upper-cased. */
    fun initial(name: String?): String {
        val n = personName(name)
        if (n.isEmpty()) return "?"
        val first = String(Character.toChars(n.codePointAt(0)))
        return first.uppercase(java.util.Locale.ROOT)
    }

    data class RowTitle(val name: String, val subtitle: String?)

    /**
     * Port of chatRowTitle(): the person. A chat with a person never has a title — one chat per
     * pair (docs/CHAT.md). Only Claude practice chats, which may be several, show their title
     * when there is more than one.
     */
    fun rowTitle(row: ChatListRow, rows: List<ChatListRow>): RowTitle {
        val name = personName(row.otherUser.name)
        if (!row.isAi) return RowTitle(name, null)
        val many = rows.count { it.relationshipId == row.relationshipId } > 1
        val title = NoteSearch.jsTrim(row.title.orEmpty())
        return RowTitle(name, if (many) title.ifEmpty { "Chat" } else null)
    }

    /** Port of chatRowPreview(): "You: …" for my own last message, "No messages yet" for an empty chat. */
    fun rowPreview(row: ChatListRow, myUserId: String?): String {
        val m = row.lastMessage ?: return "No messages yet"
        val text = NoteSearch.jsTrim(collapseWhitespace(m.preview))
        return if (m.senderId == myUserId) "You: $text" else text
    }

    private fun collapseWhitespace(s: String): String {
        val sb = StringBuilder(s.length)
        var inRun = false
        for (c in s) {
            if (NoteSearch.isJsWhitespace(c)) {
                if (!inRun) sb.append(' ')
                inRun = true
            } else {
                sb.append(c)
                inRun = false
            }
        }
        return sb.toString()
    }

    private fun pad2(n: Int): String = if (n < 10) "0$n" else n.toString()

    /**
     * Port of chatRelativeTime(): "14:32" today, "Yesterday", the weekday within the last 6
     * days, "28 Sep" this year, "28 Sep 2025" before. [offsetMinutes] = minutes EAST of UTC.
     * The future (clock skew) shows as today; an unparsable time is "".
     */
    fun relativeTime(iso: String, nowMs: Long, offsetMinutes: Int): String {
        val t = parse(iso) ?: return ""
        val shift = offsetMinutes * 60_000L
        val local = Instant.ofEpochMilli(t + shift).atOffset(ZoneOffset.UTC)
        val nowLocal = Instant.ofEpochMilli(nowMs + shift).atOffset(ZoneOffset.UTC)
        val days = Math.floorDiv(nowMs + shift, DAY_MS) - Math.floorDiv(t + shift, DAY_MS)
        if (days <= 0) return "${pad2(local.hour)}:${pad2(local.minute)}"
        if (days == 1L) return "Yesterday"
        if (days < 7) return WEEKDAYS[local.dayOfWeek.value % 7]
        val dm = "${local.dayOfMonth} ${MONTHS[local.monthValue - 1]}"
        return if (local.year == nowLocal.year) dm else "$dm ${local.year}"
    }

    /** `fold`: NFKD, drop U+0300–036F, lower-case. */
    private fun fold(s: String): String = NoteSearch.jsLower(COMBINING.replace(Normalizer.normalize(s, Normalizer.Form.NFKD), ""))

    /** `/\s+/` split with empty pieces dropped (JS whitespace). */
    private fun words(s: String): List<String> {
        val out = ArrayList<String>()
        val sb = StringBuilder()
        for (c in s) {
            if (NoteSearch.isJsWhitespace(c)) {
                if (sb.isNotEmpty()) { out += sb.toString(); sb.clear() }
            } else sb.append(c)
        }
        if (sb.isNotEmpty()) out += sb.toString()
        return out
    }

    /** Port of filterChatList(): every word of the query in the name, the title (Claude chats) or the last message. */
    fun filter(rows: List<ChatListRow>, query: String): List<ChatListRow> {
        val ws = words(fold(query))
        if (ws.isEmpty()) return rows.toList()
        return rows.filter { r ->
            val hay = fold(listOf(r.otherUser.name.orEmpty(), r.title.orEmpty(), r.lastMessage?.preview.orEmpty()).joinToString("\n"))
            ws.all { hay.contains(it) }
        }
    }

    /** Port of unreadConversationCount(): the Chats tab badge (people only, not Claude). */
    fun unreadConversationCount(rows: List<ChatListRow>): Int = rows.count { !it.isAi && it.unread > 0 }

    data class Groups(val people: List<ChatListRow>, val practice: List<ChatListRow>)

    /** Port of groupChatList(): people first, Claude role-play chats in their own section; each newest first. */
    fun group(rows: List<ChatListRow>): Groups {
        val sorted = sort(rows)
        return Groups(sorted.filter { !it.isAi }, sorted.filter { it.isAi })
    }

    /**
     * Port of applyIncomingMessage(): the row moves to the top with the new preview, unread goes
     * up for the other person's message (0 for mine). Unknown conversation → null (refetch).
     */
    fun applyIncomingMessage(rows: List<ChatListRow>, msg: IncomingChatMessage, myUserId: String?): List<ChatListRow>? {
        val idx = rows.indexOfFirst { it.conversationId == msg.conversationId }
        if (idx < 0) return null
        val row = rows[idx]
        val last = row.lastMessage
        if (last != null && last.id == msg.id) {
            return rows.toMutableList().also { it[idx] = row.copy(lastMessage = last.copy(preview = msg.preview)) }
        }
        val isNewer = last == null || run {
            val a = parse(msg.createdAt)
            val b = parse(last.createdAt)
            a != null && b != null && a >= b
        }
        val updated = row.copy(
            lastMessage = if (isNewer) ChatListLastMessage(msg.id, msg.senderId, msg.preview, msg.createdAt, msg.attachmentKind) else last,
            lastActivityAt = if (isNewer) msg.createdAt else row.lastActivityAt,
            unread = if (msg.senderId != myUserId) row.unread + 1 else 0,
        )
        return sort(rows.toMutableList().also { it[idx] = updated })
    }

    /** Port of applyReadMarker(): that conversation has nothing unread. */
    fun applyReadMarker(rows: List<ChatListRow>, conversationId: String): List<ChatListRow> =
        rows.map { if (it.conversationId == conversationId && it.unread != 0) it.copy(unread = 0) else it }
}
