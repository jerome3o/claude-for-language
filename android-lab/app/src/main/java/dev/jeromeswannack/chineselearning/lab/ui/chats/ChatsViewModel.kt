package dev.jeromeswannack.chineselearning.lab.ui.chats

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.chat.ChatInbox
import dev.jeromeswannack.chineselearning.lab.core.chat.ChatListRow
import dev.jeromeswannack.chineselearning.lab.data.api.CLAUDE_USER_ID
import dev.jeromeswannack.chineselearning.lab.data.api.MyRelationshipsDto
import dev.jeromeswannack.chineselearning.lab.data.api.other
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.data.chat.ChatPair
import dev.jeromeswannack.chineselearning.lab.ui.connections.Connections
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavKeys
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.TimeZone

/**
 * The Chats inbox: the cached list (rendered at once, also offline), refetched when the screen
 * opens / resumes. Live socket events patch the same cache (Chats.unreadBadge, collected by the
 * shell), so the list follows without this screen doing anything.
 */
class ChatsViewModel(private val app: LabApp) : ViewModel() {
    private val local = MutableStateFlow(Local())
    private data class Local(val query: String = "", val picker: Boolean = false, val error: String? = null, val myId: String? = null, val now: Long = System.currentTimeMillis())

    private val _ui = MutableStateFlow(ChatsUi())
    val ui: StateFlow<ChatsUi> = _ui

    init {
        viewModelScope.launch { val me = Connections.myId(app.cache); local.update { it.copy(myId = me) } }
        viewModelScope.launch { while (true) { delay(30_000); local.update { it.copy(now = System.currentTimeMillis()) } } }
        viewModelScope.launch {
            combine(Chats.observe(app.cache), app.cache.observe<MyRelationshipsDto>(NavKeys.RELATIONSHIPS), local, app.online) { list, rels, l, online ->
                val rows = list?.conversations.orEmpty()
                ChatsUi(
                    loaded = list != null,
                    rows = rows,
                    myId = l.myId,
                    query = l.query,
                    nowMs = l.now,
                    offsetMinutes = TimeZone.getDefault().getOffset(l.now) / 60_000,
                    error = l.error,
                    offline = !online,
                    people = peopleFor(rows, rels, l.myId),
                    pickerOpen = l.picker,
                )
            }.collect { _ui.value = it }
        }
        refresh()
    }

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
    }

    fun setQuery(q: String) = local.update { it.copy(query = q) }

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

    /** ✏️: one person → straight into THE chat with them; several → the picker; nobody → Connections. */
    fun newChatTarget(): NewChat {
        val people = _ui.value.people
        return when (people.size) {
            0 -> NewChat.Connect
            1 -> NewChat.Open(people[0].relationshipId)
            else -> { local.update { it.copy(picker = true) }; NewChat.Picking }
        }
    }

    fun closePicker() = local.update { it.copy(picker = false) }

    sealed interface NewChat {
        data object Connect : NewChat
        data object Picking : NewChat
        data class Open(val relationshipId: String) : NewChat
    }

    companion object {
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
