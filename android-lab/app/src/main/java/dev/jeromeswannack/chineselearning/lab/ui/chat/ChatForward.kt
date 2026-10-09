package dev.jeromeswannack.chineselearning.lab.ui.chat

import dev.jeromeswannack.chineselearning.lab.core.ChatDrafts
import dev.jeromeswannack.chineselearning.lab.core.ChatFiles
import dev.jeromeswannack.chineselearning.lab.data.api.ChatConversationDto
import dev.jeromeswannack.chineselearning.lab.data.api.ChatMessageDto
import dev.jeromeswannack.chineselearning.lab.data.api.MyRelationshipsDto
import dev.jeromeswannack.chineselearning.lab.data.api.displayName
import dev.jeromeswannack.chineselearning.lab.data.api.other
import dev.jeromeswannack.chineselearning.lab.ui.connections.Fmt
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** One row of "Forward to…" (web ForwardSheet's ForwardTarget). */
data class ForwardTarget(val conversationId: String, val relationshipId: String, val label: String, val sub: String?)

/** "Forward to…": the messages going (oldest first) and the conversations to pick from. */
data class ForwardUi(
    val messageIds: List<String>,
    /** Null while loading with nothing cached. */
    val targets: List<ForwardTarget>? = null,
    val error: String? = null,
    /** "Forward all" of a photo album: the photos go with one new album id, so they stay one album there. */
    val album: Boolean = false,
)

/** Round 2 PR 3 (docs/CHAT.md): forward, message info, the queue line — pure, unit-tested in ChatRound3Test. */
object ChatRound3 {
    /**
     * Port of ForwardSheet's list: every conversation I have with a person (my tutors and my
     * students; not the Claude practice chats), newest first by last message (else creation).
     */
    fun forwardTargets(rels: MyRelationshipsDto, conversations: Map<String, List<ChatConversationDto>>, myId: String?): List<ForwardTarget> {
        data class Row(val t: ForwardTarget, val at: String)
        val rows = (rels.tutors + rels.students).flatMap { rel ->
            val label = rel.other(myId).displayName("Someone")
            conversations[rel.id].orEmpty().filter { !it.is_ai_conversation }.map { cv ->
                // One chat per pair: the person is the whole label (a chat with a person has no title).
                Row(ForwardTarget(cv.id, rel.id, label, null), cv.last_message_at?.takeIf { it.isNotEmpty() } ?: cv.created_at)
            }
        }
        // The web's `sort((a, b) => (a.at < b.at ? 1 : -1))`: newest first.
        // One chat per pair: a person is one target (the newest chat, should a stale list hold more).
        return rows.sortedWith { a, b -> if (a.at < b.at) 1 else if (a.at > b.at) -1 else 0 }.map { it.t }.distinctBy { it.relationshipId }
    }

    /** "Forwarded the message to Minghui · Weekly chat." / "Forwarded 3 messages to …". */
    fun forwardedNotice(count: Int, t: ForwardTarget): String =
        "Forwarded ${if (count == 1) "the message" else "$count messages"} to ${t.label}${t.sub?.let { " · $it" } ?: ""}."

    private val ERROR_FIELD = Regex("\"error\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"")

    /**
     * The server's reason for a refused forward, from the outbox's "HTTP 410: {"error":"The file is
     * gone"}" ("The file is gone."); '' when there is none to show.
     */
    fun forwardError(lastError: String?): String {
        val e = lastError ?: return ""
        val msg = ERROR_FIELD.find(e)?.groupValues?.get(1)?.replace("\\\"", "\"")?.trim().orEmpty()
        return if (msg.isEmpty()) "" else if (msg.endsWith(".")) msg else "$msg."
    }

    /** The header's "🕓 …" line: my sends still in this chat's outbox (not the failed ones). */
    fun queueLabel(pending: List<PendingBubble>, online: Boolean): String? =
        ChatDrafts.queueLabel(pending.count { !it.failed && !it.delivered }, online)

    private val whenFmt = DateTimeFormatter.ofPattern("EEE d MMM, h:mm a", Locale.US)

    /** The web's `toLocaleString(…weekday short, day, month short, hour, minute)`: "Sat 3 Oct, 9:41 AM" (the bubbles' h:mm a). */
    fun whenLabel(iso: String?, zone: ZoneId = ZoneId.systemDefault()): String? =
        iso?.takeIf { it.isNotEmpty() }?.let { Fmt.parse(it) }?.let { whenFmt.format(it.atZone(zone)) }

    /** Port of MessageInfoSheet's rows: from, sent, edited, read by, forwarded, pinned, corrected, the attachment, characters, reactions. */
    fun infoRows(m: ChatMessageDto, myId: String?, otherName: String, otherReadAt: String?, zone: ZoneId = ZoneId.systemDefault()): List<Pair<String, String>> {
        val mine = m.sender_id == myId
        val a = m.attachment
        val rows = ArrayList<Pair<String, String>>()
        rows += "From" to (if (mine) "You" else m.sender.name?.takeIf { it.isNotEmpty() } ?: "Unknown")
        rows += "Sent" to (whenLabel(m.created_at, zone) ?: "—")
        if (!m.edited_at.isNullOrEmpty()) rows += "Edited" to (whenLabel(m.edited_at, zone) ?: "yes")
        if (mine) rows += "Read by $otherName" to (if (!otherReadAt.isNullOrEmpty() && m.created_at <= otherReadAt) "Yes ✓✓" else "Not yet")
        if (!m.forwarded_from.isNullOrEmpty()) rows += "Forwarded" to "Yes"
        if (!m.pinned_at.isNullOrEmpty()) rows += "Pinned" to (whenLabel(m.pinned_at, zone) ?: "yes")
        m.correction?.let { rows += "Corrected" to (whenLabel(it.at, zone) ?: "yes") }
        when (a?.kind) {
            "image" -> rows += "Photo" to "${a.width} × ${a.height} · ${ChatFiles.formatBytes(a.bytes)}"
            "voice" -> rows += "Voice" to "${ChatRich.duration(a.duration_ms)} · ${ChatFiles.formatBytes(a.bytes)} · transcript ${a.transcript_status ?: "pending"}"
            "file" -> rows += "File" to "${a.name ?: "file"} · ${ChatFiles.formatBytes(a.bytes)}"
            "video" -> rows += "Video" to "${if (a.duration_ms > 0) ChatRich.duration(a.duration_ms) + " · " else ""}${ChatFiles.formatBytes(a.bytes)}"
        }
        val text = dev.jeromeswannack.chineselearning.lab.core.NoteSearch.jsTrim(m.content)
        if (text.isNotEmpty()) rows += "Characters" to text.codePointCount(0, text.length).toString()
        if (m.reactions.isNotEmpty()) rows += "Reactions" to m.reactions.joinToString(" · ") { r -> "${r.emoji} ${r.users.joinToString(", ") { it.name?.takeIf { n -> n.isNotEmpty() } ?: "?" }}" }
        return rows
    }
}
