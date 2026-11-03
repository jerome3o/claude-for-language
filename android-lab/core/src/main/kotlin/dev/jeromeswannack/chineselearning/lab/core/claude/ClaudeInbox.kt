package dev.jeromeswannack.chineselearning.lab.core.claude

import dev.jeromeswannack.chineselearning.lab.core.NoteSearch
import dev.jeromeswannack.chineselearning.lab.core.chat.ChatInbox
import dev.jeromeswannack.chineselearning.lab.core.chat.ChatListRow

/**
 * The unified Chats tab (docs/CHAT.md "Chats tab — one list for people and Claude"): port of
 * shared/claude/inbox.ts — `mergeInbox` (people + Claude threads in one list, a learner's unread tutor
 * chats pinned, an old practice chat shown once, archived threads out), the row labels (icon + word,
 * never colour alone), Claude previews, the filter chips, search, the tutor's sections and the
 * composer's "To:" recipients. Parity-tested (parity/fixtures/claude-chats.ts → ClaudeChatsParityTest).
 *
 * Kinds are the TypeScript strings: tutor · student · claude; filters all · people · claude.
 */
object ClaudeInbox {
    const val TUTOR = "tutor"
    const val STUDENT = "student"
    const val CLAUDE = "claude"

    const val ALL = "all"
    const val PEOPLE = "people"

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

    private fun matches(kind: String, filter: String): Boolean = when (filter) {
        PEOPLE -> kind != CLAUDE
        CLAUDE -> kind == CLAUDE
        else -> true
    }

    private val ORDER = Comparator<Item> { a, b ->
        if (a.pinned != b.pinned) return@Comparator if (a.pinned) -1 else 1
        val ta = timeOf(a.activityAt)
        val tb = timeOf(b.activityAt)
        if (tb != ta) return@Comparator tb.compareTo(ta)
        a.key.compareTo(b.key).coerceIn(-1, 1)
    }

    /** Port of mergeInbox. */
    fun merge(humans: List<ChatListRow>, threads: List<Thread>, pinUnreadTutors: Boolean = false, filter: String = ALL): List<Item> {
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
        return items.filter { matches(it.kind, filter) }.sortedWith(ORDER)
    }

    // ---------- Labels ----------

    data class RowLabel(val icon: String, val text: String)

    /** Port of inboxRowLabel: 🧑‍🏫 Tutor · 🎓 Student · ✦ Claude. */
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

    const val ROW_WRITING = "✦ Writing a reply…"
    const val ROW_FAILED = "⚠ The reply failed — open to retry"
    const val ROW_QUEUED = "🕓 Waiting for a connection"

    /** Port of claudeRowPreview: nothing when the line only repeats the [title] (a Check chat). */
    fun claudeRowPreview(preview: String?, pending: Boolean, failed: Boolean, local: Boolean = false, title: String? = null): String {
        if (local) return ROW_QUEUED
        if (pending) return ROW_WRITING
        if (failed) return ROW_FAILED
        val line = NoteSearch.jsTrim(ChatInbox.collapseWhitespace(preview.orEmpty()))
        return if (title != null && line == NoteSearch.jsTrim(ChatInbox.collapseWhitespace(title))) "" else line
    }

    // ---------- Filters ----------

    data class FilterChip(val id: String, val label: String)

    /** Port of inboxFilters: All · <people> · ✦ Claude, only when there are both. */
    fun filters(items: List<Item>): List<FilterChip> {
        val tutors = items.count { it.kind == TUTOR }
        val students = items.count { it.kind == STUDENT }
        val claude = items.any { it.kind == CLAUDE }
        if (!claude || tutors + students == 0) return emptyList()
        val people = when {
            students == 0 -> if (tutors == 1) "🧑‍🏫 Tutor" else "🧑‍🏫 Tutors"
            tutors == 0 -> "🎓 Students"
            else -> "People"
        }
        return listOf(FilterChip(ALL, "All"), FilterChip(PEOPLE, people), FilterChip(CLAUDE, "✦ Claude"))
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

    // ---------- The tutor's view ----------

    data class TeacherSections(val people: List<Item>, val claude: List<Item>)

    /** Port of teacherSections: the people (newest first, as merged), then her Claude chats. */
    fun teacherSections(items: List<Item>): TeacherSections =
        TeacherSections(items.filter { it.kind != CLAUDE }, items.filter { it.kind == CLAUDE })

    // ---------- The composer's "To:" ----------

    data class Recipient(val relationshipId: String, val conversationId: String, val name: String)

    /** Port of composeRecipients: each tutor once, newest chat first. */
    fun composeRecipients(humans: List<ChatListRow>): List<Recipient> {
        val sorted = humans.sortedWith { a, b ->
            val d = timeOf(b.lastActivityAt).compareTo(timeOf(a.lastActivityAt))
            if (d != 0) d else if (a.conversationId < b.conversationId) -1 else 1
        }
        val seen = HashSet<String>()
        val out = ArrayList<Recipient>()
        for (h in sorted) {
            if (h.isAi || h.otherRole != TUTOR || !seen.add(h.relationshipId)) continue
            out += Recipient(h.relationshipId, h.conversationId, ChatInbox.personName(h.otherUser.name))
        }
        return out
    }
}
