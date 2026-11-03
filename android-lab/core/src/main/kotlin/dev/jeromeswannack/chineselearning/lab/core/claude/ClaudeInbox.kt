package dev.jeromeswannack.chineselearning.lab.core.claude

import dev.jeromeswannack.chineselearning.lab.core.NoteSearch
import dev.jeromeswannack.chineselearning.lab.core.chat.ChatInbox
import dev.jeromeswannack.chineselearning.lab.core.chat.ChatListRow

/**
 * The unified Chats tab (docs/CHAT.md "Chats tab — one list for people and Claude"): port of
 * shared/claude/inbox.ts — `mergeInbox` (people + Claude threads in one list, a learner's unread tutor
 * chats pinned, an old practice chat shown once, archived threads out), the kind in words (screen
 * readers), a Claude row's status (waiting / writing / failed — the rows have no preview line), the
 * context emoji's "Open …" action, search and the sections (people, a thin divider, Claude).
 * Parity-tested (parity/fixtures/claude-chats.ts → ClaudeChatsParityTest).
 *
 * Kinds are the TypeScript strings: tutor · student · claude.
 */
object ClaudeInbox {
    const val TUTOR = "tutor"
    const val STUDENT = "student"
    const val CLAUDE = "claude"

    /** `InboxThread`: a Claude thread as the inbox needs it. */
    data class Thread(
        val id: String,
        val title: String,
        val context: ClaudeChats.Context,
        val firstIntent: String? = null,
        val preview: String? = null,
        val lastMessageAt: String? = null,
        val createdAt: String,
        val unread: Int = 0,
        val pending: Boolean = false,
        val failed: Boolean = false,
        val archived: Boolean = false,
        /** Started on this device without a connection. */
        val local: Boolean = false,
    )

    /** `InboxItem`. */
    data class Item(
        val key: String,
        val kind: String,
        val activityAt: String,
        val unread: Int,
        val pinned: Boolean,
        val badge: ClaudeChats.Badge?,
        val human: ChatListRow?,
        val thread: Thread?,
    )

    private fun timeOf(iso: String?): Long = if (iso.isNullOrEmpty()) 0L else ChatInbox.parse(iso) ?: 0L

    /** Port of threadActivityAt: the last message, else when the thread was made. */
    fun threadActivityAt(t: Thread): String = t.lastMessageAt?.takeIf { it.isNotEmpty() } ?: t.createdAt

    private val ORDER = Comparator<Item> { a, b ->
        if (a.pinned != b.pinned) return@Comparator if (a.pinned) -1 else 1
        val ta = timeOf(a.activityAt)
        val tb = timeOf(b.activityAt)
        if (tb != ta) return@Comparator tb.compareTo(ta)
        a.key.compareTo(b.key).coerceIn(-1, 1)
    }

    /** Port of mergeInbox. */
    fun merge(humans: List<ChatListRow>, threads: List<Thread>, pinUnreadTutors: Boolean = false): List<Item> {
        val practice = threads.filter { it.context.kind == ClaudeChats.PRACTICE }.mapNotNull { it.context.conversationId }.toSet()
        val items = ArrayList<Item>()
        for (h in humans) {
            val unread = maxOf(0, h.unread)
            if (h.isAi) {
                if (h.conversationId in practice) continue
                val title = NoteSearch.jsTrim(h.title.orEmpty())
                val badge = ClaudeChats.contextBadge(ClaudeChats.Context(ClaudeChats.PRACTICE, conversationId = h.conversationId, label = title.ifEmpty { null }))
                items += Item("h:${h.conversationId}", CLAUDE, h.lastActivityAt, unread, false, badge, h, null)
                continue
            }
            val kind = if (h.otherRole == STUDENT) STUDENT else TUTOR
            items += Item("h:${h.conversationId}", kind, h.lastActivityAt, unread, pinUnreadTutors && kind == TUTOR && unread > 0, null, h, null)
        }
        for (t in threads) {
            if (t.archived) continue
            items += Item("c:${t.id}", CLAUDE, threadActivityAt(t), maxOf(0, t.unread), false, ClaudeChats.contextBadge(t.context, t.firstIntent), null, t)
        }
        return items.sortedWith(ORDER)
    }

    // ---------- Labels ----------

    data class RowLabel(val icon: String, val text: String)

    /** Port of inboxRowLabel: the kind in words for screen readers — 🧑‍🏫 Tutor · 🎓 Student · ✦ Claude. */
    fun rowLabel(kind: String): RowLabel = when (kind) {
        TUTOR -> RowLabel("🧑‍🏫", "Tutor")
        STUDENT -> RowLabel("🎓", "Student")
        else -> RowLabel("✦", "Claude")
    }

    /** Port of inboxRowName. */
    fun rowName(item: Item): String {
        item.thread?.let { return NoteSearch.jsTrim(it.title).ifEmpty { "Chat with Claude" } }
        val h = item.human!!
        if (item.kind == CLAUDE) return NoteSearch.jsTrim(h.title.orEmpty()).ifEmpty { "Practice with Claude" }
        return ChatInbox.personName(h.otherUser.name)
    }

    /** Port of ClaudeRowStatus: [short] goes where the time goes, [text] for screen readers. */
    data class RowStatus(val icon: String, val short: String, val text: String)

    val ROW_QUEUED = RowStatus("🕓", "Waiting", "Waiting for a connection")
    val ROW_WRITING = RowStatus("✦", "Writing…", "Claude is writing a reply")
    val ROW_FAILED = RowStatus("⚠", "Failed", "The reply failed — open to retry")

    /** Port of claudeRowStatus: waiting (started offline), writing, failed — else null (the time shows). */
    fun claudeRowStatus(pending: Boolean, failed: Boolean, local: Boolean = false): RowStatus? = when {
        local -> ROW_QUEUED
        pending -> ROW_WRITING
        failed -> ROW_FAILED
        else -> null
    }

    /** Port of contextOpenLabel: the context emoji's action, by headerChipFor's link kind. */
    fun contextOpenLabel(linkKind: String?): String? = when (linkKind) {
        "card" -> "Open card"
        "reader" -> "Open story"
        "exercise" -> "Open lesson"
        else -> null
    }

    /** Port of filterInbox: every word in the name, the preview or the context chip. */
    fun search(items: List<Item>, query: String): List<Item> {
        val ws = ChatInbox.words(ChatInbox.fold(query))
        if (ws.isEmpty()) return items.toList()
        return items.filter { i ->
            val parts = mutableListOf(rowName(i), i.badge?.text.orEmpty())
            i.thread?.let { parts += it.preview.orEmpty() }
            i.human?.let { parts += listOf(it.otherUser.name.orEmpty(), it.title.orEmpty(), it.lastMessage?.preview.orEmpty()) }
            val hay = ChatInbox.fold(parts.joinToString("\n"))
            ws.all { hay.contains(it) }
        }
    }

    // ---------- Sections ----------

    data class Sections(val people: List<Item>, val claude: List<Item>)

    /** Port of inboxSections: the people (as merged — a learner's unread tutors first), then the Claude chats. */
    fun sections(items: List<Item>): Sections =
        Sections(items.filter { it.kind != CLAUDE }, items.filter { it.kind == CLAUDE })
}
