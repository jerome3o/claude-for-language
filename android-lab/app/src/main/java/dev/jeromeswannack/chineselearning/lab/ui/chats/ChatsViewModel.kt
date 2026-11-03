package dev.jeromeswannack.chineselearning.lab.ui.chats

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.chat.ChatInbox
import dev.jeromeswannack.chineselearning.lab.core.chat.ChatListRow
import dev.jeromeswannack.chineselearning.lab.core.claude.ClaudeChats
import dev.jeromeswannack.chineselearning.lab.core.claude.ClaudeInbox
import dev.jeromeswannack.chineselearning.lab.data.api.CLAUDE_USER_ID
import dev.jeromeswannack.chineselearning.lab.data.api.ClaudeContextDto
import dev.jeromeswannack.chineselearning.lab.data.api.MyRelationshipsDto
import dev.jeromeswannack.chineselearning.lab.data.api.other
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.data.chat.ChatPair
import dev.jeromeswannack.chineselearning.lab.data.claude.ClaudeThreadList
import dev.jeromeswannack.chineselearning.lab.data.claude.ClaudeThreads
import dev.jeromeswannack.chineselearning.lab.ui.claude.ClaudeThreadViewModel
import dev.jeromeswannack.chineselearning.lab.ui.claude.claudeThread
import dev.jeromeswannack.chineselearning.lab.ui.connections.Connections
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavKeys
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.TimeZone

/**
 * The Chats tab (docs/CHAT.md "Chats tab — one list for people and Claude"): the cached chats with
 * people (`/api/me/chats`, [Chats]) and the cached Claude threads ([ClaudeThreadList]) in ONE list,
 * both rendered at once (also offline) and refreshed when the screen opens / resumes, every minute,
 * on a socket reconnect and when a Claude reply finishes (a reply starting marks its row "Writing a
 * reply…" at once). The box at the bottom starts a Claude thread (offline: queued).
 */
class ChatsViewModel(private val app: LabApp) : ViewModel() {
    private val local = MutableStateFlow(
        Local(language = app.prefs.askClaudeLanguage),
    )

    private data class Local(
        val query: String = "",
        val picker: Boolean = false,
        /** "🎭 Practice a situation" (ui/claude/PracticeSheet.kt) is open. */
        val practice: Boolean = false,
        val error: String? = null,
        val myId: String? = null,
        val now: Long = System.currentTimeMillis(),
        val teacher: Boolean = false,
        /** The Claude row whose context popover is open. */
        val contextInfo: String? = null,
        val draft: String = "",
        val sending: Boolean = false,
        val sendError: String? = null,
        val composeRequest: Int = 0,
        val language: String = "zh",
    )

    private val _ui = MutableStateFlow(ChatsUi())
    val ui: StateFlow<ChatsUi> = _ui

    init {
        viewModelScope.launch { val me = Connections.myId(app.cache); local.update { it.copy(myId = me) } }
        // chat.inbox_open once, when both lists are in (cached or fetched) — both kinds counted.
        viewModelScope.launch {
            val ready = _ui.filter { it.loaded && it.threadsLoaded }.first()
            val items = ready.items
            app.analytics.track("chat.inbox_open", mapOf("conversations" to items.size, "unread" to items.count { it.unread > 0 }))
        }
        viewModelScope.launch { while (true) { delay(30_000); local.update { it.copy(now = System.currentTimeMillis()) } } }
        val humans = combine(Chats.observe(app.cache), app.cache.observe<MyRelationshipsDto>(NavKeys.RELATIONSHIPS)) { list, rels -> list to rels }
        viewModelScope.launch {
            // The tutor's Students rows: "✦ Asked Claude 3× today" from the cached dashboard (core claude.TutorVisibility).
            val claudeToday = app.cache.observe<dev.jeromeswannack.chineselearning.lab.data.api.TutorDashboardDto>(dev.jeromeswannack.chineselearning.lab.ui.teaching.TeachingKeys.DASHBOARD)
            combine(humans, ClaudeThreadList.observeInbox(app.cache), local, app.online, claudeToday) { (list, rels), threads, l, online, dash ->
                val rows = list?.conversations.orEmpty()
                ChatsUi(
                    loaded = list != null,
                    rows = rows,
                    threads = threads.orEmpty(),
                    threadsLoaded = threads != null || !online,
                    myId = l.myId,
                    query = l.query,
                    nowMs = l.now,
                    offsetMinutes = TimeZone.getDefault().getOffset(l.now) / 60_000,
                    error = l.error,
                    offline = !online,
                    people = peopleFor(rows, rels, l.myId),
                    pickerOpen = l.picker,
                    practiceOpen = l.practice,
                    teacher = l.teacher,
                    contextInfo = l.contextInfo,
                    draft = l.draft,
                    sending = l.sending,
                    sendError = l.sendError,
                    composeRequest = l.composeRequest,
                    language = l.language,
                    claudeToday = dash?.students.orEmpty().associate { it.relationship_id to it.claude_today },
                )
            }.collect { _ui.value = it }
        }
        // Claude replies: one starting → "Writing a reply…" on its row; finished / failed → the list again.
        viewModelScope.launch {
            app.chatLive.claudeTurns.collect { e ->
                if (e.status == "done" || e.status == "failed") refreshThreads()
                else runCatching { ClaudeThreadList.markPending(app.cache, e.thread_id) }
            }
        }
        viewModelScope.launch {
            var first = true
            app.chatLive.connected.collect { up -> if (up && !first) refreshThreads(); first = false }
        }
        viewModelScope.launch {
            while (true) {
                delay(REFRESH_MS)
                refreshThreads()
            }
        }
        refresh()
    }

    /** Both lists again (open / resume / Retry). */
    fun refresh() {
        viewModelScope.launch {
            try {
                Chats.refresh(app)
                local.update { it.copy(error = null, now = System.currentTimeMillis()) }
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                local.update { it.copy(error = "Couldn't load your chats. ${e.userMessage()}") }
            }
        }
        viewModelScope.launch { refreshThreads() }
    }

    private suspend fun refreshThreads() {
        if (!app.online.value || app.prefs.sessionToken == null) return
        try {
            ClaudeThreadList.sync(app.repo.api, app.cache)
        } catch (e: Exception) {
            if (e is kotlinx.coroutines.CancellationException) throw e
            // offline / server error: the cached list stays
        }
    }

    /** A tutor account / an account with students: the student-centric view (from the shell's role). */
    fun setTeacher(teacher: Boolean) = local.update { if (it.teacher == teacher) it else it.copy(teacher = teacher) }

    fun setQuery(q: String) = local.update { it.copy(query = q) }

    /** A Claude row's context emoji: its popover (analytics `chats.context_info` show), or null to close it. */
    fun setContextInfo(key: String?) {
        local.update { it.copy(contextInfo = key) }
        if (key == null) return
        val kind = _ui.value.items.firstOrNull { it.key == key }?.thread?.context?.kind ?: ClaudeChats.PRACTICE
        app.analytics.track("chats.context_info", mapOf("context_kind" to kind, "action" to "show"))
    }

    /** The popover's "Open card / story / lesson ›" (analytics `chats.context_info` open). */
    fun contextOpened(key: String) {
        val kind = _ui.value.items.firstOrNull { it.key == key }?.thread?.context?.kind ?: ClaudeChats.PRACTICE
        app.analytics.track("chats.context_info", mapOf("context_kind" to kind, "action" to "open"))
        local.update { it.copy(contextInfo = null) }
    }

    fun setDraft(s: String) = local.update { it.copy(draft = s, sendError = null) }

    /** `?compose=1` / `?text=` (More → Ask Claude, `/coach`, a sentence handed over) or ✏️ → ✦ Claude: the box, typing. */
    fun compose(text: String? = null) = local.update {
        it.copy(draft = text?.takeIf { t -> t.isNotBlank() } ?: it.draft, composeRequest = it.composeRequest + 1, picker = false)
    }

    /** A row opened (analytics `chats.open`; a Claude row's unread drops at once). Returns where it goes. */
    fun open(item: ClaudeInbox.Item): String {
        app.analytics.track("chats.open", mapOf("kind" to item.kind))
        app.haptics.tick()
        item.thread?.let { t -> viewModelScope.launch { runCatching { ClaudeThreadList.markOpened(app.cache, t.id) } } }
        return pathFor(item)
    }

    /**
     * The box → Claude: a new general thread with that intent (offline: kept here and queued), then
     * [onStarted] with its id (the thread screen opens it; the reply streams there).
     */
    fun sendToClaude(text: String, intent: String, spoken: Boolean, onStarted: (String) -> Unit) {
        val msg = text.trim()
        if (msg.isEmpty() || local.value.sending) return
        local.update { it.copy(sending = true, sendError = null) }
        val language = local.value.language
        viewModelScope.launch {
            try {
                val res = ClaudeThreads.of(app).start(ClaudeContextDto(ClaudeChats.GENERAL), msg, intent, language, app.online.value)
                app.analytics.track("chats.compose_send", mapOf("intent" to intent, "offline" to res.queued, "spoken" to spoken))
                app.analytics.track("claude.message_send", mapOf("context_kind" to ClaudeChats.GENERAL, "intent" to intent, "offline" to res.queued, "chip" to false, "spoken" to spoken))
                if (res.queued) app.scheduleBackgroundUpload()
                app.haptics.tick()
                local.update { it.copy(sending = false, draft = "") }
                onStarted(res.threadId)
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                local.update { it.copy(sending = false, sendError = ClaudeThreadViewModel.sendErrorText(e)) }
            }
        }
    }

    /**
     * THE chat with the person of [relId] (one chat per pair): their inbox row when it's listed
     * (instant, offline), else `POST …/conversations/open` (get-or-create).
     */
    fun openChat(relId: String, go: (String) -> Unit) {
        _ui.value.rows.firstOrNull { it.relationshipId == relId && !it.isAi }?.let { go(it.conversationId); return }
        viewModelScope.launch {
            try {
                go(ChatPair.theChat(app, relId))
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                local.update { it.copy(error = "Couldn't open that chat. ${e.userMessage()}") }
            }
        }
    }

    /** ✏️: "New chat with…" — ✦ Claude first, then the people. */
    fun openPicker() = local.update { it.copy(picker = true) }

    fun closePicker() = local.update { it.copy(picker = false) }

    /** The picker's "🎭 Practice a situation…" (or an old "new chat with Claude" link): the situation sheet. */
    fun openPractice() = local.update { it.copy(picker = false, practice = true) }

    fun closePractice() = local.update { it.copy(practice = false) }

    companion object {
        const val REFRESH_MS = 60_000L

        /** Where a row goes: a thread → its screen; a chat with a person (or an old practice chat with no thread) → that chat. */
        fun pathFor(item: ClaudeInbox.Item): String {
            item.thread?.let { return Routes.claudeThread(it.id) + "?source=chats" }
            val h = item.human!!
            return Routes.chat(h.relationshipId, h.conversationId)
        }

        /**
         * Who a new conversation can be with: the people of the listed (non-Claude) chats, then
         * any other active relationship from the cached relationships (one with no chat yet).
         */
        fun peopleFor(rows: List<ChatListRow>, rels: MyRelationshipsDto?, myId: String?): List<ChatPerson> {
            val out = LinkedHashMap<String, ChatPerson>()
            for (r in ChatInbox.sort(rows)) {
                if (r.isAi || r.relationshipId in out) continue
                out[r.relationshipId] = ChatPerson(r.relationshipId, ChatInbox.personName(r.otherUser.name), r.otherUser.pictureUrl, if (r.otherRole == "tutor") "Your tutor" else "Your student")
            }
            if (rels != null) {
                for ((list, role) in listOf(rels.tutors to "Your tutor", rels.students to "Your student")) for (rel in list) {
                    if (rel.status != "active" || rel.id in out) continue
                    val other = rel.other(myId) ?: continue
                    if (other.id == CLAUDE_USER_ID) continue
                    out[rel.id] = ChatPerson(rel.id, ChatInbox.personName(other.name ?: other.email), other.picture_url, role)
                }
            }
            return out.values.toList()
        }
    }
}
