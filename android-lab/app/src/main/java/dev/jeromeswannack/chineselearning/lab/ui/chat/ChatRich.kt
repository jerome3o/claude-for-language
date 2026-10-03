package dev.jeromeswannack.chineselearning.lab.ui.chat

import dev.jeromeswannack.chineselearning.lab.core.ChatBubbles
import dev.jeromeswannack.chineselearning.lab.core.ChatSearch
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.data.api.ChatMessageDto
import dev.jeromeswannack.chineselearning.lab.data.api.SendMessageBody
import dev.jeromeswannack.chineselearning.lab.data.api.chatMessagesPath
import dev.jeromeswannack.chineselearning.lab.data.api.enc
import dev.jeromeswannack.chineselearning.lab.data.chat.ChatActions as ChatWrites
import dev.jeromeswannack.chineselearning.lab.data.platform.Outbox
import dev.jeromeswannack.chineselearning.lab.data.platform.OutboxEntity
import kotlinx.serialization.json.Json
import java.net.URLDecoder
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * A message I sent that the server hasn't confirmed yet — read from the Outbox, so it survives
 * leaving the chat and process death (docs/CHAT.md PR 2 "Optimistic send"). The server's message
 * replaces it by [clientId].
 */
data class PendingBubble(
    val clientId: String,
    /** text | image | voice | file | video */
    val kind: String,
    /** The text, or a photo's caption. */
    val content: String,
    val createdAtMs: Long,
    val failed: Boolean = false,
    /** Sent: the outbox delivered it, the server copy hasn't arrived in the list yet. */
    val delivered: Boolean = false,
    val replyToId: String? = null,
    /** The staged photo / recording (shown and played while it uploads). */
    val filePath: String? = null,
    val width: Int = 0,
    val height: Int = 0,
    val durationMs: Long? = null,
    /** A file's name (kind file). */
    val name: String? = null,
    /** The staged file's size (files / videos: the bubble's "840 KB · PDF"). */
    val bytes: Long = 0,
)

/** The chat's rich-message rules (docs/CHAT.md PR 2), pure — unit-tested in ChatRichTest. */
object ChatRich {
    const val TYPING_SHOW_MS = 4_000L
    const val TYPING_SEND_EVERY_MS = 2_500L

    /** The outbox rows that are messages of [conversationId] → bubbles, oldest first. */
    fun pendingFromOutbox(items: List<OutboxEntity>, conversationId: String, json: Json, dims: (String) -> Pair<Int, Int>? = { null }): List<PendingBubble> {
        val textPath = chatMessagesPath(conversationId)
        val mediaPrefix = "/api/conversations/${enc(conversationId)}/media?"
        return items.mapNotNull { item ->
            when {
                item.kind == ChatWrites.KIND_SEND && item.path == textPath -> {
                    val body = item.bodyJson?.let { runCatching { json.decodeFromString(SendMessageBody.serializer(), it) }.getOrNull() } ?: return@mapNotNull null
                    PendingBubble(body.client_id ?: item.id, "text", body.content, item.createdAt, failed = item.state == Outbox.FAILED, replyToId = body.reply_to_message_id)
                }
                item.kind == ChatWrites.KIND_MEDIA && item.path.startsWith(mediaPrefix) -> {
                    val q = query(item.path.substringAfter('?'))
                    val kind = q["kind"] ?: return@mapNotNull null
                    val size = when (kind) {
                        "image" -> item.filePath?.let(dims)
                        // A video's shape rides in the query (the device measured it before queueing).
                        "video" -> (q["width"]?.toIntOrNull() ?: 0) to (q["height"]?.toIntOrNull() ?: 0)
                        else -> null
                    }
                    PendingBubble(
                        clientId = q["client_id"] ?: item.id,
                        kind = kind,
                        content = q["caption"].orEmpty(),
                        createdAtMs = item.createdAt,
                        failed = item.state == Outbox.FAILED,
                        replyToId = q["reply_to_message_id"],
                        filePath = item.filePath,
                        width = size?.first ?: 0,
                        height = size?.second ?: 0,
                        durationMs = q["duration_ms"]?.toLongOrNull(),
                        name = q["name"],
                        bytes = if (kind == "file" || kind == "video") item.filePath?.let { runCatching { java.io.File(it).length() }.getOrNull() } ?: 0 else 0,
                    )
                }
                else -> null
            }
        }
    }

    private fun query(q: String): Map<String, String> = q.split('&').filter { it.isNotEmpty() }.associate { part ->
        val k = part.substringBefore('=')
        val v = part.substringAfter('=', "")
        URLDecoder.decode(k, "UTF-8") to URLDecoder.decode(v, "UTF-8")
    }

    /** Pending bubbles the list still has to show: those whose server message hasn't arrived. */
    fun visiblePending(pending: List<PendingBubble>, messages: List<ChatMessageDto>): List<PendingBubble> {
        if (pending.isEmpty()) return pending
        val confirmed = messages.mapNotNullTo(HashSet()) { it.client_id }
        return pending.filter { it.clientId !in confirmed }.sortedBy { it.createdAtMs }
    }

    enum class Receipt(val label: String) { SEEN("Seen"), SENT("Sent ✓") }

    /**
     * "Seen" / "Sent ✓" under my newest message (docs/CHAT.md PR 2 "Read receipts"): Seen when the
     * other person's read marker reached it. Null while I have a message pending (that bubble shows
     * its own clock / "Not sent") or when I haven't sent anything.
     */
    fun receipt(messages: List<ChatMessageDto>, myId: String?, otherReadAt: String?, pending: List<PendingBubble>): Pair<String, Receipt>? {
        if (myId == null || pending.isNotEmpty()) return null
        val mine = messages.lastOrNull { (it.sender_id == myId) && !it.isDeleted } ?: return null
        val seen = otherReadAt != null && otherReadAt >= mine.created_at
        return mine.id to if (seen) Receipt.SEEN else Receipt.SENT
    }

    /** The read marker only moves forward. */
    fun laterOf(a: String?, b: String?): String? = when {
        a == null -> b
        b == null -> a
        else -> if (b > a) b else a
    }

    /** `?since=` cursor: the page's latest_timestamp, never moving back. */
    fun nextCursor(current: String?, latest: String?): String? = laterOf(current, latest)

    /**
     * "New messages" divider: the first message from the other person after my read marker as it
     * was BEFORE opening the chat (null marker = never read: their first message).
     */
    fun firstUnreadId(messages: List<ChatMessageDto>, myId: String?, markerBeforeOpen: String?): String? =
        messages.firstOrNull { it.sender_id != myId && !it.isDeleted && (markerBeforeOpen == null || it.created_at > markerBeforeOpen) }?.id

    /** Pinned messages, newest pin first (the bar shows the first). */
    fun pinned(messages: List<ChatMessageDto>): List<ChatMessageDto> =
        messages.filter { !it.pinned_at.isNullOrEmpty() && !it.isDeleted }.sortedByDescending { it.pinned_at }

    /** The shared search input for one message. */
    fun searchable(m: ChatMessageDto) = ChatSearch.Message(
        id = m.id,
        content = m.content,
        translation = m.translation,
        deletedAt = m.deleted_at,
        transcript = m.attachment?.transcript,
        attachmentTranslation = m.attachment?.translation,
        // PR 3: pinyin search (with or without tones) once the message has words.
        words = m.words?.map { ChatSearch.Word(it.text, it.pinyin) },
    )

    /** The one-line preview — the worker's wording (📷 Photo[: caption] / 🎤 Voice message / 📄 name / 🎬 Video / Message deleted). */
    fun preview(content: String, attachmentKind: String?, deletedAt: String?, max: Int = 50, fileName: String? = null): String {
        if (!deletedAt.isNullOrEmpty()) return "Message deleted"
        return ChatLogic.truncate(dev.jeromeswannack.chineselearning.lab.data.chat.IncomingChat.previewText(content, attachmentKind, fileName).trim(), max)
    }

    fun duration(ms: Long): String {
        val s = (ms / 1000).coerceAtLeast(0)
        return "${s / 60}:${(s % 60).toString().padStart(2, '0')}"
    }
}

/** "Minghui is typing…": shown for [ChatRich.TYPING_SHOW_MS] after the last typing event, cleared by their message. */
class TypingIndicator(private val showMs: Long = ChatRich.TYPING_SHOW_MS) {
    private var until = Long.MIN_VALUE

    fun onTyping(nowMs: Long) { until = nowMs + showMs }
    fun onMessage() { until = Long.MIN_VALUE }
    fun visible(nowMs: Long): Boolean = nowMs < until
    /** Ms until it hides (0 when hidden). */
    fun remaining(nowMs: Long): Long = if (visible(nowMs)) until - nowMs else 0
}

/** My typing frames: at most every 2.5 s, only while the box is non-empty AND changing. */
class TypingThrottle(private val everyMs: Long = ChatRich.TYPING_SEND_EVERY_MS) {
    private var lastSent = Long.MIN_VALUE / 2
    private var lastDraft = ""

    fun shouldSend(draft: String, nowMs: Long): Boolean {
        val changed = draft != lastDraft
        lastDraft = draft
        if (!changed || draft.isBlank()) return false
        if (nowMs - lastSent < everyMs) return false
        lastSent = nowMs
        return true
    }

    /** After sending a message: the next keystroke may say "typing" at once. */
    fun reset() { lastSent = Long.MIN_VALUE / 2; lastDraft = "" }
}

/** One row of the message list. */
sealed interface ChatRow {
    val key: String
    data class Day(val label: String, override val key: String) : ChatRow
    data object Unread : ChatRow { override val key = "unread" }
    /** A message and where it sits in its group (chat round 2: ChatBubbles, parity-tested). */
    data class Msg(val message: ChatMessageDto, val layout: ChatBubbles.Layout) : ChatRow { override val key = message.id }
    data class Pending(val bubble: PendingBubble, val layout: ChatBubbles.Layout) : ChatRow { override val key = "p-" + bubble.clientId }
}

object ChatRows {
    private val dayLabel = DateTimeFormatter.ofPattern("EEE d MMM", Locale.US)

    /** The device's offset now, minutes EAST of UTC (the web's `-Date#getTimezoneOffset()`). */
    fun offsetMinutes(zone: ZoneId = ZoneId.systemDefault(), now: Instant = Instant.now()): Int = zone.rules.getOffset(now).totalSeconds / 60

    /** The day pill: "Today" / "Yesterday" / "Mon 28 Sep" (docs/CHAT.md "Round 2"). */
    fun dayLabel(day: String, today: String): String {
        if (day.isEmpty()) return ""
        if (day == today) return "Today"
        val d = runCatching { LocalDate.parse(day) }.getOrNull() ?: return day
        val t = runCatching { LocalDate.parse(today) }.getOrNull()
        if (t != null && d == t.minusDays(1)) return "Yesterday"
        return dayLabel.format(d)
    }

    /** A pending bubble as the layout sees it: its outbox state as `pending`. */
    fun bubbleOf(p: PendingBubble, myId: String?) = ChatBubbles.Message(
        "p-" + p.clientId, myId ?: "", Js.toIsoString(p.createdAtMs), null,
        when { p.failed -> "failed"; p.delivered -> null; else -> "sending" },
    )

    /**
     * Day pills, the unread divider, messages and my pending bubbles last — each bubble with its
     * group position and tick (`layoutBubbles`, shared with the web).
     */
    fun build(
        messages: List<ChatMessageDto>,
        pending: List<PendingBubble>,
        unreadId: String?,
        myId: String?,
        otherReadAt: String?,
        nowMs: Long = System.currentTimeMillis(),
        offsetMinutes: Int = offsetMinutes(),
    ): List<ChatRow> {
        val bubbles = messages.map { ChatBubbles.Message(it.id, it.sender_id, it.created_at, it.deleted_at, null) } + pending.map { bubbleOf(it, myId) }
        val layouts = ChatBubbles.layoutBubbles(bubbles, myId ?: "", otherReadAt, offsetMinutes)
        val today = Js.toIsoString(nowMs + offsetMinutes * 60_000L).take(10)
        val rows = ArrayList<ChatRow>(bubbles.size + 8)
        layouts.forEachIndexed { i, l ->
            if (l.newDay) rows += ChatRow.Day(dayLabel(l.day, today), "d-" + l.id)
            if (i < messages.size) {
                val m = messages[i]
                if (m.id == unreadId) rows += ChatRow.Unread
                rows += ChatRow.Msg(m, l)
            } else {
                rows += ChatRow.Pending(pending[i - messages.size], l)
            }
        }
        return rows
    }
}
