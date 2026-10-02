package dev.jeromeswannack.chineselearning.lab.ui.chat

import android.media.AudioAttributes
import android.media.MediaPlayer
import android.util.Base64
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.MessageTools
import dev.jeromeswannack.chineselearning.lab.data.api.CLAUDE_USER_ID
import dev.jeromeswannack.chineselearning.lab.data.api.ChatMessageDto
import dev.jeromeswannack.chineselearning.lab.data.api.ChatNoteBody
import dev.jeromeswannack.chineselearning.lab.data.api.CheckResultDto
import dev.jeromeswannack.chineselearning.lab.data.api.ChatConversationDto
import dev.jeromeswannack.chineselearning.lab.data.api.DiscussionTurn
import dev.jeromeswannack.chineselearning.lab.data.api.PracticeConversationBody
import dev.jeromeswannack.chineselearning.lab.data.api.RelationshipDto
import dev.jeromeswannack.chineselearning.lab.data.api.SegmentedDto
import dev.jeromeswannack.chineselearning.lab.data.api.SuggestedCard
import dev.jeromeswannack.chineselearning.lab.data.api.TranslateCardDto
import dev.jeromeswannack.chineselearning.lab.data.api.addChatNote
import dev.jeromeswannack.chineselearning.lab.data.api.aiRespond
import dev.jeromeswannack.chineselearning.lab.data.api.chatMessages
import dev.jeromeswannack.chineselearning.lab.data.api.checkChatMessage
import dev.jeromeswannack.chineselearning.lab.data.api.conversationTts
import dev.jeromeswannack.chineselearning.lab.data.api.chatConversations
import dev.jeromeswannack.chineselearning.lab.data.api.createDeck
import dev.jeromeswannack.chineselearning.lab.data.api.discussMessage
import dev.jeromeswannack.chineselearning.lab.data.api.displayName
import dev.jeromeswannack.chineselearning.lab.data.api.flashcardFromChat
import dev.jeromeswannack.chineselearning.lab.data.api.messageDiscussion
import dev.jeromeswannack.chineselearning.lab.data.api.other
import dev.jeromeswannack.chineselearning.lab.data.api.relationship
import dev.jeromeswannack.chineselearning.lab.data.api.renameConversation
import dev.jeromeswannack.chineselearning.lab.data.api.responseOptions
import dev.jeromeswannack.chineselearning.lab.data.api.saveMessageDiscussion
import dev.jeromeswannack.chineselearning.lab.data.api.sendChatMessage
import dev.jeromeswannack.chineselearning.lab.data.api.setVoiceSettings
import dev.jeromeswannack.chineselearning.lab.data.api.startConversation
import dev.jeromeswannack.chineselearning.lab.data.api.toggleReaction
import dev.jeromeswannack.chineselearning.lab.data.api.translateMessageCard
import dev.jeromeswannack.chineselearning.lab.data.api.translateSegmented
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.data.api.markChatRead
import dev.jeromeswannack.chineselearning.lab.core.ChatSearch
import dev.jeromeswannack.chineselearning.lab.data.api.SendMessageBody
import dev.jeromeswannack.chineselearning.lab.data.api.chatMediaUploadPath
import dev.jeromeswannack.chineselearning.lab.data.api.chatMessagesPath
import dev.jeromeswannack.chineselearning.lab.data.api.deleteChatMessage
import dev.jeromeswannack.chineselearning.lab.data.api.editChatMessage
import dev.jeromeswannack.chineselearning.lab.data.api.pinChatMessage
import dev.jeromeswannack.chineselearning.lab.data.chat.ChatActions as ChatWrites
import dev.jeromeswannack.chineselearning.lab.data.chat.ChatMediaStore
import dev.jeromeswannack.chineselearning.lab.data.chat.ChatPhoto
import dev.jeromeswannack.chineselearning.lab.data.chat.ChatVoiceRecorder
import dev.jeromeswannack.chineselearning.lab.data.chat.ChatNotifier
import dev.jeromeswannack.chineselearning.lab.data.chat.ChatPresence
import dev.jeromeswannack.chineselearning.lab.data.chat.LiveEvent
import dev.jeromeswannack.chineselearning.lab.fx.Sounds
import dev.jeromeswannack.chineselearning.lab.ui.connections.Connections
import dev.jeromeswannack.chineselearning.lab.ui.connections.ConnectionsKeys
import dev.jeromeswannack.chineselearning.lab.ui.study.CardTools
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

data class Notice(val text: String, val error: Boolean)

data class DeckChoice(val id: String, val name: String, val pinned: Boolean)

/** A bottom sheet the chat has open (web: the page's modals + the per-message sheet). */
sealed interface ChatSheet {
    data class Actions(val message: ChatMessageDto) : ChatSheet
    data object Menu : ChatSheet
    data class Card(val card: SuggestedCard) : ChatSheet
    data class Check(val messageId: String, val result: CheckResultDto) : ChatSheet
    data object HelpMeSayIt : ChatSheet
    data class Options(val explanation: String?, val options: List<SuggestedCard>, val selected: Set<Int>) : ChatSheet
    data class Translate(val result: TranslateCardDto) : ChatSheet
    data class Word(val hanzi: String, val context: String) : ChatSheet
    data object Rename : ChatSheet
    data object Voice : ChatSheet
    data class Discuss(val message: ChatMessageDto) : ChatSheet
    // ---- PR 2 ----
    /** 📎 → Take a photo / Choose from gallery. */
    data object Attach : ChatSheet
    /** A prepared photo with an optional caption, before it goes. */
    data class Photo(val path: String, val width: Int, val height: Int) : ChatSheet
    /** ⋯ on the pinned bar: every pinned message. */
    data object Pins : ChatSheet
    data class ConfirmDelete(val message: ChatMessageDto) : ChatSheet
}

/** The voice message being recorded / previewed in the composer. */
sealed interface RecorderUi {
    data object Idle : RecorderUi
    /** [locked] = tapped (or slid up): it keeps recording without a finger on the mic. */
    data class Recording(val elapsedMs: Long, val locked: Boolean, val level: Float) : RecorderUi
    data class Preview(val path: String, val durationMs: Long) : RecorderUi
}

/** A voice message (or the preview, id [PREVIEW_ID]) playing. */
data class VoicePlayback(val id: String, val positionMs: Long, val durationMs: Long, val playing: Boolean, val loading: Boolean = false)

const val PREVIEW_ID = "preview"

/** 🔍 in the header: the query, the matches (newest first, shared ChatSearch) and which one is shown. */
data class ChatSearchUi(val query: String = "", val results: List<String> = emptyList(), val index: Int = 0) {
    val current: String? get() = results.getOrNull(index)
    /** "3 of 12" (1 = the newest match). */
    val label: String get() = if (query.isBlank()) "" else if (results.isEmpty()) "No results" else "${index + 1} of ${results.size}"
}

/** Ask the list to bring a message into view ([nonce] makes a repeat request count). */
data class ScrollRequest(val id: String, val nonce: Int, val animate: Boolean = true)

data class DiscussState(
    val loading: Boolean = true,
    val turns: List<DiscussionTurn> = emptyList(),
    val thinking: Boolean = false,
    val cards: List<SuggestedCard>? = null,
    val selected: Set<Int> = emptySet(),
    val saving: Boolean = false,
    val saved: String? = null,
)

data class ChatUi(
    val loading: Boolean = true,
    val loadError: String? = null,
    val otherName: String = "",
    val otherIsClaude: Boolean = false,
    val conversation: ChatConversationDto? = null,
    val myId: String? = null,
    /** 'tutor' | 'student' — my role in the relationship (toolsForMessage). */
    val viewerRole: String = "student",
    val messages: List<ChatMessageDto> = emptyList(),
    /** Showing the copy on this phone (from when?) because the refresh couldn't run. */
    val offlineHistory: Boolean = false,
    val online: Boolean = true,
    val draft: String = "",
    val replyingTo: ChatMessageDto? = null,
    val sending: Boolean = false,
    val waitingForAi: Boolean = false,
    val playingId: String? = null,
    val checkingId: String? = null,
    val translatingId: String? = null,
    val checkStatuses: Map<String, String> = emptyMap(),
    val wordByWord: Set<String> = emptySet(),
    val segmentations: Map<String, SegmentedDto> = emptyMap(),
    val generatingCard: Boolean = false,
    val generatingOptions: Boolean = false,
    val notice: Notice? = null,
    val sheet: ChatSheet? = null,
    val modalNotice: Notice? = null,
    val saving: Boolean = false,
    val decks: List<DeckChoice> = emptyList(),
    val recentEmojis: List<String> = emptyList(),
    val discuss: DiscussState = DiscussState(),
    // ---- PR 2: live chat & rich messages ----
    /** My sends the server hasn't confirmed (from the outbox; failed ones say "Not sent"). */
    val pending: List<PendingBubble> = emptyList(),
    /** The other person's read marker ("Seen"). */
    val otherReadAt: String? = null,
    /** "<name> is typing…". */
    val typing: Boolean = false,
    /** The "New messages" divider sits above this message (fixed when the chat opened). */
    val unreadId: String? = null,
    /** New messages that arrived while scrolled up (the "↓ N new" pill). */
    val newBelow: Int = 0,
    val editing: ChatMessageDto? = null,
    val search: ChatSearchUi? = null,
    /** A message flashed after a jump (search / pinned bar). */
    val highlightId: String? = null,
    val scrollTo: ScrollRequest? = null,
    val voice: VoicePlayback? = null,
    val recorder: RecorderUi = RecorderUi.Idle,
    /** Voice messages whose translation is open. */
    val translationsShown: Set<String> = emptySet(),
    val preparingPhoto: Boolean = false,
) {
    val pinned: List<ChatMessageDto> get() = ChatRich.pinned(messages)

    fun rows(): List<ChatRow> = ChatRows.build(messages, pending, unreadId, ChatRich.receipt(messages, myId, otherReadAt, pending))

    val isAi: Boolean get() = conversation?.is_ai_conversation ?: false

    /** A message's check status: what we learnt here, else what the server stored. */
    fun checkStatus(m: ChatMessageDto): String? = checkStatuses[m.id] ?: m.check_status

    fun tools(m: ChatMessageDto) = MessageTools.toolsForMessage(m.sender_id, m.content, checkStatus(m), m.has_discussion, viewerRole, isAi, myId ?: "")
}

/**
 * `/connections/:relId/chat/:convId` (web: ChatPage). Live (docs/CHAT.md PR 2): the ChatHub socket
 * (data/chat/ChatLive.kt) delivers `message` / `message_updated` / `read` / `typing`; REST polling
 * (`?since=`, which also returns edited messages — merged by id) runs only while the socket is down
 * (3 s) and once after every reconnect. Sends are optimistic and go through the Outbox with a
 * client_id (text, photos, voice), so they survive leaving the chat, offline and process death;
 * the server's copy replaces the bubble by client_id. The last copy is cached so the history
 * opens offline.
 */
class ChatViewModel(private val app: LabApp, private val relId: String, private val convId: String) : ViewModel() {
    private val _ui = MutableStateFlow(ChatUi())
    val ui: StateFlow<ChatUi> = _ui
    private val api get() = app.repo.api
    private val cards = CardTools(app)
    private val media = ChatMediaStore.of(app)
    private var lastTimestamp: String? = null
    private var pollJob: Job? = null
    private var player: MediaPlayer? = null
    private var progressJob: Job? = null
    private val checkResults = HashMap<String, CheckResultDto>()
    private val typingIn = TypingIndicator()
    private val typingOut = TypingThrottle()
    private var typingJob: Job? = null
    private var highlightJob: Job? = null
    private var scrollNonce = 0
    private var atBottom = true
    private var recorder: ChatVoiceRecorder? = null
    private var recordJob: Job? = null

    /** Outbox rows for this chat, and the ones it delivered whose server copy hasn't arrived yet. */
    private var outboxPending: List<PendingBubble> = emptyList()
    private val delivered = LinkedHashMap<String, PendingBubble>()
    private val discarded = HashSet<String>()

    private val messagesKey = "chat/$convId/messages"

    init {
        viewModelScope.launch { app.online.collect { o -> _ui.update { it.copy(online = o) }; if (o) flushOutbox() } }
        viewModelScope.launch { load() }
        viewModelScope.launch { Connections.markConversationRead(app, convId) }
        // The live socket (data/chat/ChatLive.kt): new / changed messages, read receipts, typing.
        viewModelScope.launch { app.chatLive.events.collect(::onLive) }
        // Back from the background onto this chat: drop its notification, fetch what came meanwhile.
        viewModelScope.launch {
            ChatPresence.foreground.collect { fg ->
                if (fg && ChatPresence.visibleConversation.value == convId && lastTimestamp != null) {
                    ChatNotifier.cancel(app, convId)
                    fetchNew()
                }
            }
        }
        // Reconnected: one catch-up (?since=), then the socket carries it again.
        viewModelScope.launch {
            var first = true
            app.chatLive.connected.collect { up -> if (up && !first) fetchNew(); first = false }
        }
        // Pending bubbles are the outbox (survive process death), delivered ones until the server copy shows.
        viewModelScope.launch {
            app.outbox.observe().collect { items ->
                val now = ChatRich.pendingFromOutbox(items, convId, api.json, ChatMediaStore::dims)
                val ids = now.mapTo(HashSet()) { it.clientId }
                for (p in outboxPending) if (p.clientId !in ids && p.clientId !in discarded && !p.failed) delivered[p.clientId] = p.copy(delivered = true)
                outboxPending = now
                refreshPending()
                if (delivered.isNotEmpty()) fetchNew()
            }
        }
        viewModelScope.launch { app.outbox.completed.collect { item -> if (item.kind == ChatWrites.KIND_SEND || item.kind == ChatWrites.KIND_MEDIA) fetchNew() } }
        // Pending sends retry while the chat is open (the outbox stops at the first network error).
        viewModelScope.launch {
            while (isActive) {
                delay(RETRY_MS)
                if (outboxPending.any { !it.failed } && app.online.value) flushOutbox()
            }
        }
        viewModelScope.launch { loadDecks() }
        viewModelScope.launch {
            val recent = app.cache.get<List<String>>(RECENT_KEY).orEmpty()
            _ui.update { it.copy(recentEmojis = recent) }
        }
    }

    private fun refreshPending() {
        val messages = _ui.value.messages
        val confirmed = messages.mapNotNullTo(HashSet()) { it.client_id }
        delivered.keys.removeAll(confirmed)
        val all = outboxPending.filter { it.clientId !in discarded } + delivered.values.filter { d -> outboxPending.none { it.clientId == d.clientId } }
        _ui.update { it.copy(pending = ChatRich.visiblePending(all, it.messages)) }
    }

    private suspend fun load() {
        val cache = app.cache
        val me = Connections.myId(cache)
        val cachedRel = cache.get<RelationshipDto>(ConnectionsKeys.relationship(relId))
        val cachedConvs = cache.get<List<ChatConversationDto>>(ConnectionsKeys.conversations(relId))
        val cachedMsgs = cache.get<List<ChatMessageDto>>(messagesKey)
        applyHeader(cachedRel, cachedConvs, me)
        if (cachedMsgs != null) {
            _ui.update { it.copy(loading = false, messages = cachedMsgs) }
            refreshPending()
        }
        try {
            val rel = api.relationship(relId).also { cache.put(ConnectionsKeys.relationship(relId), ConnectionsKeys.KIND, it) }
            val convs = api.chatConversations(relId).also { cache.put(ConnectionsKeys.conversations(relId), ConnectionsKeys.KIND, it) }
            applyHeader(rel, convs, me)
            val page = api.chatMessages(convId)
            lastTimestamp = ChatRich.nextCursor(lastTimestamp, page.latest_timestamp)
            cache.put(messagesKey, KIND, page.messages.takeLast(CACHE_LIMIT))
            val myId = _ui.value.myId
            // The divider uses my read marker as it was BEFORE this visit (read below, after the page).
            val unread = ChatRich.firstUnreadId(page.messages, myId, page.read_state?.me)
            _ui.update {
                it.copy(
                    loading = false, loadError = null, offlineHistory = false,
                    messages = ChatLogic.merge(page.messages, it.messages.filter { m -> page.messages.none { p -> p.id == m.id } && (lastTimestamp == null || m.created_at > lastTimestamp!!) }),
                    otherReadAt = ChatRich.laterOf(it.otherReadAt, page.read_state?.other),
                    unreadId = unread,
                    scrollTo = if (unread != null) ScrollRequest(unread, ++scrollNonce, animate = false) else it.scrollTo,
                )
            }
            refreshPending()
            readHere()
            startPolling()
        } catch (e: Exception) {
            ChatNotifier.cancel(app, convId)
            _ui.update {
                if (cachedMsgs != null || it.messages.isNotEmpty()) it.copy(loading = false, offlineHistory = true)
                else it.copy(loading = false, loadError = e.userMessage())
            }
            startPolling()
        }
    }

    private fun applyHeader(rel: RelationshipDto?, convs: List<ChatConversationDto>?, me: String?) {
        rel ?: return
        val other = rel.other(me)
        val tutorId = if (rel.requester_role == "tutor") rel.requester_id else rel.recipient_id
        _ui.update {
            it.copy(
                myId = me,
                otherName = other.displayName(),
                otherIsClaude = other?.id == CLAUDE_USER_ID,
                viewerRole = if (me != null && tutorId == me) "tutor" else "student",
                conversation = convs?.firstOrNull { c -> c.id == convId } ?: it.conversation,
            )
        }
    }

    /** Polls `?since=` every 3 s, but only while the live socket is down (it's the doorbell otherwise). */
    private fun startPolling() {
        if (pollJob?.isActive == true) return
        pollJob = viewModelScope.launch {
            while (isActive) {
                delay(ChatLogic.POLL_MS)
                if (!app.chatLive.connected.value) fetchNew()
            }
        }
    }

    private suspend fun fetchNew() {
        if (!app.online.value) return
        val since = lastTimestamp
        if (since == null) {
            // Never loaded (offline at open): the full page instead.
            runCatching { api.chatMessages(convId) }.onSuccess { page ->
                lastTimestamp = ChatRich.nextCursor(lastTimestamp, page.latest_timestamp)
                // The history, not news: no haptics / "new" counts for it.
                _ui.update { it.copy(offlineHistory = false, loadError = null, loading = false, messages = ChatLogic.merge(it.messages, page.messages), otherReadAt = ChatRich.laterOf(it.otherReadAt, page.read_state?.other)) }
                refreshPending()
                app.cache.put(messagesKey, KIND, _ui.value.messages.takeLast(CACHE_LIMIT))
                readHere()
            }
            return
        }
        runCatching { api.chatMessages(convId, since) }.onSuccess { r ->
            r.read_state?.other?.let { o -> _ui.update { it.copy(otherReadAt = ChatRich.laterOf(it.otherReadAt, o)) } }
            lastTimestamp = ChatRich.nextCursor(lastTimestamp, r.latest_timestamp)
            if (r.messages.isEmpty()) return@onSuccess
            addMessages(r.messages)
        }
    }

    /** docs/CHAT.md §4 + PR 2: the hub's events for this chat. */
    private suspend fun onLive(e: LiveEvent) {
        when (e) {
            is LiveEvent.Message -> {
                if (e.conversationId != convId) return
                val m = e.message ?: return fetchNew()
                // lastTimestamp stays: a catch-up re-reads from there (merged by id), so nothing in between is skipped.
                addMessages(listOf(m))
            }
            is LiveEvent.Updated -> if (e.conversationId == convId) addMessages(listOf(e.message))
            is LiveEvent.Read -> if (e.conversationId == convId && e.userId != _ui.value.myId && e.userId.isNotEmpty()) {
                _ui.update { it.copy(otherReadAt = ChatRich.laterOf(it.otherReadAt, e.lastReadAt)) }
            }
            is LiveEvent.Typing -> if (e.conversationId == convId && e.userId != _ui.value.myId) showTyping()
        }
    }

    private fun showTyping() {
        typingIn.onTyping(System.currentTimeMillis())
        _ui.update { it.copy(typing = true) }
        typingJob?.cancel()
        typingJob = viewModelScope.launch {
            while (true) {
                val left = typingIn.remaining(System.currentTimeMillis())
                if (left <= 0) break
                delay(left)
            }
            _ui.update { it.copy(typing = false) }
        }
    }

    private suspend fun onIncomingWhileOpen(count: Int) {
        app.haptics.tick()
        typingIn.onMessage()
        typingJob?.cancel()
        _ui.update { it.copy(typing = false, newBelow = if (atBottom) 0 else it.newBelow + count) }
        Connections.markConversationRead(app, convId)
        readHere()
    }

    /** This chat is read (docs/CHAT.md §2 `POST …/read`): its notification goes, on every device. */
    private suspend fun readHere() {
        ChatNotifier.cancel(app, convId)
        // The conversation list's badge clears at once (its next refresh agrees).
        runCatching {
            val key = ConnectionsKeys.conversations(relId)
            app.cache.get<List<ChatConversationDto>>(key)?.takeIf { l -> l.any { it.id == convId && it.unread > 0 } }?.let { l ->
                app.cache.put(key, ConnectionsKeys.KIND, l.map { if (it.id == convId) it.copy(unread = 0) else it })
            }
        }
        if (app.online.value) runCatching { api.markChatRead(convId) }
    }

    /** Merges [list] by id (new copies replace old ones); counts what's new from the other person. */
    private suspend fun addMessages(list: List<ChatMessageDto>) {
        if (list.isEmpty()) return
        val before = _ui.value.messages.mapTo(HashSet()) { it.id }
        val myId = _ui.value.myId
        _ui.update { it.copy(messages = ChatLogic.merge(it.messages, list)) }
        refreshPending()
        // Keep the open search / edit in step with the new copies.
        _ui.value.search?.let { s -> if (s.query.isNotBlank()) setSearchResults(s.query, keepCurrent = true) }
        _ui.value.editing?.let { ed -> _ui.value.messages.firstOrNull { it.id == ed.id }?.takeIf { it.isDeleted }?.let { cancelEdit() } }
        viewModelScope.launch { app.cache.put(messagesKey, KIND, _ui.value.messages.takeLast(CACHE_LIMIT)) }
        val fresh = list.filter { it.id !in before && it.sender_id != myId }
        if (fresh.isNotEmpty()) onIncomingWhileOpen(fresh.size)
    }

    /** Re-reads the whole page (reactions, has_discussion changed on the server). */
    private suspend fun refreshAll() {
        runCatching { api.chatMessages(convId) }.onSuccess { page ->
            _ui.update { it.copy(messages = ChatLogic.merge(it.messages, page.messages)) }
            refreshPending()
            app.cache.put(messagesKey, KIND, _ui.value.messages.takeLast(CACHE_LIMIT))
        }
    }

    private suspend fun loadDecks() {
        val pinned = app.cache.get<List<String>>(PINNED_KEY).orEmpty()
        val decks = withContext(Dispatchers.IO) { app.repo.dao.decks() }
            .sortedWith(compareByDescending<dev.jeromeswannack.chineselearning.lab.data.DeckEntity> { it.id in pinned }.thenBy { it.name.lowercase() })
            .map { DeckChoice(it.id, it.name, it.id in pinned) }
        _ui.update { it.copy(decks = decks) }
    }

    // ---------------- composer ----------------

    fun setDraft(text: String) {
        _ui.update { it.copy(draft = text) }
        val s = _ui.value
        if (!s.isAi && s.editing == null && typingOut.shouldSend(text, System.currentTimeMillis())) app.chatLive.sendTyping(convId)
    }

    fun reply(m: ChatMessageDto?) = _ui.update { it.copy(replyingTo = m, sheet = null) }
    fun dismissNotice() = _ui.update { it.copy(notice = null) }
    private fun error(text: String) = _ui.update { it.copy(notice = Notice(text, true)) }
    private fun success(text: String) = _ui.update { it.copy(notice = Notice(text, false)) }

    fun send() {
        val s = _ui.value
        if (s.editing != null) return saveEdit()
        val content = s.draft.trim()
        if (content.isEmpty() || s.sending || s.waitingForAi) return
        if (s.isAi) return sendToClaude(content)
        // Optimistic: the bubble is the outbox row (it shows at once, offline too, and survives a restart).
        val clientId = java.util.UUID.randomUUID().toString()
        _ui.update { it.copy(draft = "", replyingTo = null, notice = null) }
        typingOut.reset()
        app.sounds.play(Sounds.Sfx.POP, 0.5f)
        app.haptics.tick()
        app.scope.launch {
            app.outbox.enqueueJson(ChatWrites.KIND_SEND, "POST", chatMessagesPath(convId), SendMessageBody(content, s.replyingTo?.id, clientId), id = clientId)
            flushOutbox()
        }
        requestScrollToEnd()
    }

    /** The outbox now (when online), the upload worker as the backstop. */
    private fun flushOutbox() {
        runCatching { app.scheduleBackgroundUpload() }
        if (app.online.value) app.scope.launch { runCatching { app.outbox.drain() } }
    }

    /** "Not sent · Tap to retry". */
    fun retryPending(clientId: String) {
        app.haptics.tick()
        app.scope.launch { app.outbox.retry(clientId); flushOutbox() }
    }

    /** Drops a message that couldn't be sent. */
    fun discardPending(clientId: String) {
        discarded += clientId
        delivered.remove(clientId)
        refreshPending()
        app.scope.launch { app.outbox.discard(clientId) }
    }

    /** Claude role-play conversations reply to the sent message, so that send stays direct (online). */
    private fun sendToClaude(content: String) {
        val s = _ui.value
        if (!s.online) { error("You're offline. Messages to Claude can't be sent until you're back online."); return }
        _ui.update { it.copy(sending = true, notice = null) }
        val clientId = java.util.UUID.randomUUID().toString()
        viewModelScope.launch {
            try {
                val msg = api.sendChatMessage(convId, content, s.replyingTo?.id, clientId)
                app.sounds.play(Sounds.Sfx.POP, 0.5f)
                app.haptics.tick()
                addMessages(listOf(msg))
                lastTimestamp = ChatRich.nextCursor(lastTimestamp, msg.created_at)
                _ui.update { it.copy(sending = false, draft = "", replyingTo = null) }
                aiReply()
            } catch (e: Exception) {
                _ui.update { it.copy(sending = false) }
                error("Couldn't send your message. It's still in the box below — try again.")
            }
        }
    }

    private suspend fun aiReply() {
        _ui.update { it.copy(waitingForAi = true) }
        try {
            val r = api.aiRespond(convId)
            addMessages(listOf(r.message))
            lastTimestamp = ChatRich.nextCursor(lastTimestamp, r.message.created_at)
            if (r.audio_base64 != null) playBase64(r.audio_base64, r.message.id)
        } catch (e: Exception) {
            error("Claude couldn't reply. Your message was sent — try sending another to retry.")
        } finally {
            _ui.update { it.copy(waitingForAi = false) }
            startPolling()
        }
    }

    // ---------------- list position ----------------

    /** The list reports whether its end is on screen (the "↓ N new" pill). */
    fun setAtBottom(value: Boolean) {
        atBottom = value
        if (value && _ui.value.newBelow != 0) _ui.update { it.copy(newBelow = 0) }
    }

    fun scrollToEnd() {
        _ui.update { it.copy(newBelow = 0) }
        requestScrollToEnd()
    }

    private fun requestScrollToEnd() = _ui.update { it.copy(scrollTo = ScrollRequest(END, ++scrollNonce)) }

    /** Bring [id] into view and flash it (search, pinned bar). */
    fun jumpTo(id: String) {
        _ui.update { it.copy(sheet = if (it.sheet == ChatSheet.Pins) null else it.sheet, highlightId = id, scrollTo = ScrollRequest(id, ++scrollNonce)) }
        highlightJob?.cancel()
        highlightJob = viewModelScope.launch {
            delay(HIGHLIGHT_MS)
            _ui.update { if (it.highlightId == id && it.search == null) it.copy(highlightId = null) else it }
        }
    }

    // ---------------- search ----------------

    fun openSearch() = _ui.update { it.copy(search = ChatSearchUi(), sheet = null) }

    fun closeSearch() = _ui.update { it.copy(search = null, highlightId = null) }

    fun setSearchQuery(q: String) = setSearchResults(q, keepCurrent = false)

    private fun setSearchResults(q: String, keepCurrent: Boolean) {
        val results = ChatSearch.search(_ui.value.messages.map(ChatRich::searchable), q)
        val old = _ui.value.search
        val index = if (keepCurrent && old?.current != null) results.indexOf(old.current).coerceAtLeast(0) else 0
        _ui.update { it.copy(search = ChatSearchUi(q, results, index)) }
        val target = results.getOrNull(index)
        if (!keepCurrent) {
            if (target != null) _ui.update { it.copy(highlightId = target, scrollTo = ScrollRequest(target, ++scrollNonce)) }
            else _ui.update { it.copy(highlightId = null) }
        }
    }

    /** ↑ = older (+1), ↓ = newer (−1); wraps around. */
    fun searchStep(delta: Int) {
        val s = _ui.value.search ?: return
        if (s.results.isEmpty()) return
        val i = Math.floorMod(s.index + delta, s.results.size)
        val id = s.results[i]
        app.haptics.tick()
        _ui.update { it.copy(search = s.copy(index = i), highlightId = id, scrollTo = ScrollRequest(id, ++scrollNonce)) }
    }

    // ---------------- edit / delete / pin ----------------

    fun startEdit(m: ChatMessageDto) = _ui.update { it.copy(sheet = null, editing = m, draft = m.content, replyingTo = null) }

    fun cancelEdit() = _ui.update { it.copy(editing = null, draft = "") }

    private fun saveEdit() {
        val s = _ui.value
        val m = s.editing ?: return
        val content = s.draft.trim()
        if (content == m.content.trim()) { cancelEdit(); return }
        if (content.isEmpty() && !m.isImage) return
        if (!s.online) { error("You're offline — edits need a connection."); return }
        val now = java.time.Instant.now().toString()
        replaceLocal(m.id) { it.copy(content = content, edited_at = now, translation = null) }
        _ui.update { it.copy(editing = null, draft = "") }
        viewModelScope.launch {
            runCatching { api.editChatMessage(m.id, content) }
                .onSuccess { addMessages(listOf(it)) }
                .onFailure { e -> replaceLocal(m.id) { m }; error("Couldn't edit that message. ${e.userMessage()}") }
        }
    }

    fun askDelete(m: ChatMessageDto) = _ui.update { it.copy(sheet = ChatSheet.ConfirmDelete(m)) }

    fun delete(m: ChatMessageDto) {
        _ui.update { it.copy(sheet = null) }
        if (!_ui.value.online) { error("You're offline — deleting needs a connection."); return }
        val now = java.time.Instant.now().toString()
        replaceLocal(m.id) { it.copy(deleted_at = now, content = "", attachment = null, media_url = null, pinned_at = null) }
        app.haptics.tick()
        viewModelScope.launch {
            runCatching { api.deleteChatMessage(m.id) }.onSuccess { addMessages(listOf(it)) }.onFailure { e -> replaceLocal(m.id) { m }; error("Couldn't delete that message. ${e.userMessage()}") }
        }
    }

    fun setPinned(m: ChatMessageDto, pinned: Boolean) {
        _ui.update { it.copy(sheet = null) }
        if (!_ui.value.online) { error("You're offline — pinning needs a connection."); return }
        replaceLocal(m.id) { it.copy(pinned_at = if (pinned) java.time.Instant.now().toString() else null, pinned_by = if (pinned) _ui.value.myId else null) }
        app.haptics.tick()
        viewModelScope.launch {
            runCatching { api.pinChatMessage(m.id, pinned) }.onSuccess { addMessages(listOf(it)) }.onFailure { e -> replaceLocal(m.id) { m }; error("Couldn't ${if (pinned) "pin" else "unpin"} that message. ${e.userMessage()}") }
        }
    }

    private fun replaceLocal(id: String, f: (ChatMessageDto) -> ChatMessageDto) {
        _ui.update { s -> s.copy(messages = s.messages.map { if (it.id == id) f(it) else it }) }
        viewModelScope.launch { app.cache.put(messagesKey, KIND, _ui.value.messages.takeLast(CACHE_LIMIT)) }
    }

    // ---------------- photos ----------------

    /** A photo from the camera / picker: shrunk on the phone, then the caption sheet. */
    fun preparePhoto(context: android.content.Context, uri: android.net.Uri) {
        _ui.update { it.copy(sheet = null, preparingPhoto = true) }
        viewModelScope.launch {
            try {
                val file = app.outbox.stageFile("chat-photo.jpg")
                val (w, h) = withContext(Dispatchers.IO) { ChatPhoto.prepare(context, uri, file) }
                _ui.update { it.copy(preparingPhoto = false, sheet = ChatSheet.Photo(file.absolutePath, w, h)) }
            } catch (e: Exception) {
                _ui.update { it.copy(preparingPhoto = false) }
                error(e.message ?: "This photo couldn't be opened.")
            }
        }
    }

    fun sendPhoto(caption: String) {
        val sheet = _ui.value.sheet as? ChatSheet.Photo ?: return
        val clientId = java.util.UUID.randomUUID().toString()
        val replyTo = _ui.value.replyingTo?.id
        _ui.update { it.copy(sheet = null, replyingTo = null) }
        app.sounds.play(Sounds.Sfx.POP, 0.5f)
        app.haptics.tick()
        app.scope.launch {
            val file = java.io.File(sheet.path)
            media.adopt(clientId, file, "jpg")
            app.outbox.enqueueRaw(ChatWrites.KIND_MEDIA, "POST", chatMediaUploadPath(convId, "image", clientId, caption.trim().ifEmpty { null }, replyTo), file, "image/jpeg", id = clientId)
            flushOutbox()
        }
        requestScrollToEnd()
    }

    fun discardPhoto() {
        (_ui.value.sheet as? ChatSheet.Photo)?.let { java.io.File(it.path).delete() }
        _ui.update { it.copy(sheet = null) }
    }

    suspend fun image(m: ChatMessageDto, maxSide: Int) = media.image(m, maxSide)
    suspend fun localImage(path: String, maxSide: Int) = media.localImage(path, maxSide)

    // ---------------- voice messages ----------------

    /** Hold / tap the mic (the route has checked RECORD_AUDIO). */
    fun startRecording(locked: Boolean = false) {
        if (_ui.value.recorder !is RecorderUi.Idle) return
        stopAudio()
        val r = recorder ?: ChatVoiceRecorder(app).also { recorder = it }
        val file = java.io.File(app.cacheDir, "chat-rec").apply { mkdirs() }.let { java.io.File(it, "voice-${System.currentTimeMillis()}.m4a") }
        try {
            r.start(file)
        } catch (e: Exception) {
            error("Couldn't start recording. Is another app using the microphone?")
            return
        }
        app.haptics.tick()
        _ui.update { it.copy(recorder = RecorderUi.Recording(0, locked, 0f)) }
        recordJob?.cancel()
        recordJob = viewModelScope.launch {
            while (isActive) {
                delay(100)
                val el = r.elapsedMs()
                _ui.update { s -> (s.recorder as? RecorderUi.Recording)?.let { s.copy(recorder = it.copy(elapsedMs = el, level = r.level())) } ?: s }
                if (el >= ChatVoiceRecorder.MAX_MS) { finishRecording(); break }
            }
        }
    }

    /** Slid up (or a quick tap): keep recording hands-free. */
    fun lockRecording() {
        val rec = _ui.value.recorder as? RecorderUi.Recording ?: return
        if (rec.locked) return
        app.haptics.tick()
        _ui.update { it.copy(recorder = rec.copy(locked = true)) }
    }

    /** Slid left (or 🗑): nothing is kept. */
    fun cancelRecording() {
        if (_ui.value.recorder is RecorderUi.Idle) return
        recordJob?.cancel()
        recorder?.cancel()
        (_ui.value.recorder as? RecorderUi.Preview)?.let { java.io.File(it.path).delete() }
        if (_ui.value.voice?.id == PREVIEW_ID) stopAudio()
        app.haptics.wrong()
        _ui.update { it.copy(recorder = RecorderUi.Idle) }
    }

    /** Released / ■: the preview (▶ to listen, Send, 🗑). */
    fun finishRecording() {
        if (_ui.value.recorder !is RecorderUi.Recording) return
        recordJob?.cancel()
        val result = recorder?.stop()
        if (result == null) {
            _ui.update { it.copy(recorder = RecorderUi.Idle, notice = Notice("Hold the mic to record — that was too short.", true)) }
            return
        }
        app.haptics.tick()
        _ui.update { it.copy(recorder = RecorderUi.Preview(result.first.absolutePath, result.second)) }
    }

    fun sendRecording() {
        val p = _ui.value.recorder as? RecorderUi.Preview ?: return
        if (_ui.value.voice?.id == PREVIEW_ID) stopAudio()
        val clientId = java.util.UUID.randomUUID().toString()
        val replyTo = _ui.value.replyingTo?.id
        _ui.update { it.copy(recorder = RecorderUi.Idle, replyingTo = null) }
        app.sounds.play(Sounds.Sfx.POP, 0.5f)
        app.haptics.tick()
        app.scope.launch {
            val staged = app.outbox.stageFile("voice.m4a")
            val src = java.io.File(p.path)
            if (!src.renameTo(staged)) { src.copyTo(staged, overwrite = true); src.delete() }
            media.adopt(clientId, staged, "m4a")
            app.outbox.enqueueRaw(ChatWrites.KIND_MEDIA, "POST", chatMediaUploadPath(convId, "voice", clientId, null, replyTo, p.durationMs), staged, "audio/mp4", id = clientId)
            flushOutbox()
        }
        requestScrollToEnd()
    }

    /** ▶ / ⏸ on a voice bubble, a pending one ([localPath]) or the preview. */
    fun toggleVoice(id: String, m: ChatMessageDto?, localPath: String?, durationMs: Long) {
        val v = _ui.value.voice
        if (v != null && v.id == id) {
            val mp = player ?: return
            if (v.playing) { runCatching { mp.pause() }; _ui.update { it.copy(voice = v.copy(playing = false)) } }
            else { runCatching { mp.start() }; _ui.update { it.copy(voice = v.copy(playing = true)) }; trackProgress(id) }
            return
        }
        stopAudio()
        _ui.update { it.copy(voice = VoicePlayback(id, 0, durationMs, playing = false, loading = true)) }
        viewModelScope.launch {
            val file = localPath?.let { java.io.File(it) }?.takeIf { it.exists() } ?: m?.let { media.file(it) }
            if (file == null) {
                _ui.update { it.copy(voice = null) }
                error(if (_ui.value.online) "Couldn't load that voice message." else "That voice message isn't on this phone yet — it downloads when you're online.")
                return@launch
            }
            if (_ui.value.voice?.id != id) return@launch
            val mp = MediaPlayer()
            player = mp
            runCatching {
                mp.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                mp.setDataSource(file.absolutePath)
                mp.setOnPreparedListener {
                    it.start()
                    val d = it.duration.toLong().takeIf { d -> d > 0 } ?: durationMs
                    _ui.update { s -> s.copy(voice = VoicePlayback(id, 0, d, playing = true)) }
                    trackProgress(id)
                }
                mp.setOnCompletionListener { if (player === it) stopAudio() }
                mp.setOnErrorListener { _, _, _ -> stopAudio(); true }
                mp.prepareAsync()
            }.onFailure { stopAudio() }
        }
    }

    private fun trackProgress(id: String) {
        progressJob?.cancel()
        progressJob = viewModelScope.launch {
            while (isActive) {
                val mp = player ?: break
                val v = _ui.value.voice ?: break
                if (v.id != id || !v.playing) break
                val pos = runCatching { mp.currentPosition.toLong() }.getOrDefault(v.positionMs)
                _ui.update { it.copy(voice = v.copy(positionMs = pos)) }
                delay(50)
            }
        }
    }

    fun toggleTranslation(id: String) = _ui.update { it.copy(translationsShown = if (id in it.translationsShown) it.translationsShown - id else it.translationsShown + id) }

    // ---------------- per-message tools ----------------

    fun openSheet(sheet: ChatSheet?) = _ui.update { it.copy(sheet = sheet, modalNotice = null) }

    fun onTool(id: String, m: ChatMessageDto) {
        _ui.update { it.copy(sheet = null) }
        when (id) {
            "reply" -> reply(m)
            "play" -> play(m)
            "check" -> check(m)
            "view_corrections" -> viewCheck(m)
            "translate" -> translate(m)
            "word_by_word" -> toggleWordByWord(m)
            "discuss" -> openDiscussion(m)
            "copy" -> copy(m)
        }
    }

    fun react(m: ChatMessageDto, emoji: String) {
        _ui.update { it.copy(sheet = null, recentEmojis = ChatLogic.pushRecent(it.recentEmojis, emoji)) }
        app.haptics.tick()
        viewModelScope.launch {
            app.cache.put(RECENT_KEY, KIND, _ui.value.recentEmojis)
            try {
                api.toggleReaction(m.id, emoji)
                refreshAll()
            } catch (e: Exception) {
                error("Couldn't add your reaction.")
            }
        }
    }

    fun play(m: ChatMessageDto) {
        if (_ui.value.playingId == m.id) { stopAudio(); return }
        _ui.update { it.copy(playingId = m.id) }
        viewModelScope.launch {
            try {
                val c = _ui.value.conversation
                val r = api.conversationTts(convId, m.content, c?.voice_id, c?.voice_speed)
                playBase64(r.audio_base64, m.id)
            } catch (e: Exception) {
                _ui.update { it.copy(playingId = null) }
                error("Couldn't play that message.")
            }
        }
    }

    private suspend fun playBase64(base64: String, messageId: String) {
        stopAudio()
        val file = withContext(Dispatchers.IO) {
            File(app.cacheDir, "chat-tts.mp3").apply { writeBytes(Base64.decode(base64, Base64.DEFAULT)) }
        }
        _ui.update { it.copy(playingId = messageId) }
        val mp = MediaPlayer()
        player = mp
        runCatching {
            mp.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
            mp.setDataSource(file.absolutePath)
            mp.setOnPreparedListener { it.start() }
            mp.setOnCompletionListener { if (player === it) stopAudio() }
            mp.setOnErrorListener { _, _, _ -> stopAudio(); true }
            mp.prepareAsync()
        }.onFailure { stopAudio() }
    }

    fun stopAudio() {
        progressJob?.cancel()
        player?.runCatching { release() }
        player = null
        _ui.update { it.copy(playingId = null, voice = null) }
    }

    private fun check(m: ChatMessageDto) {
        if (_ui.value.checkingId != null) return
        _ui.update { it.copy(checkingId = m.id) }
        viewModelScope.launch {
            try {
                val r = api.checkChatMessage(m.id)
                _ui.update { it.copy(checkStatuses = it.checkStatuses + (m.id to r.status)) }
                checkResults[m.id] = r
                if (r.status == "needs_improvement" && r.corrections != null) openSheet(ChatSheet.Check(m.id, r))
                else if (r.status == "correct") { app.haptics.correct(); success("Looks good — no corrections needed.") }
            } catch (e: Exception) {
                error("Couldn't check that message.")
            } finally {
                _ui.update { it.copy(checkingId = null) }
            }
        }
    }

    fun viewCheck(m: ChatMessageDto) {
        val result = checkResults[m.id] ?: _ui.value.checkStatus(m)?.let { CheckResultDto(it, m.check_feedback.orEmpty(), null) } ?: return
        openSheet(ChatSheet.Check(m.id, result))
    }

    private fun translate(m: ChatMessageDto) {
        if (_ui.value.translatingId != null) return
        _ui.update { it.copy(translatingId = m.id) }
        viewModelScope.launch {
            try {
                openSheet(ChatSheet.Translate(api.translateMessageCard(m.id)))
            } catch (e: Exception) {
                error("Couldn't translate that message.")
            } finally {
                _ui.update { it.copy(translatingId = null) }
            }
        }
    }

    private fun toggleWordByWord(m: ChatMessageDto) {
        val on = m.id !in _ui.value.wordByWord
        _ui.update { it.copy(wordByWord = if (on) it.wordByWord + m.id else it.wordByWord - m.id) }
        if (!on || _ui.value.segmentations.containsKey(m.id)) return
        viewModelScope.launch {
            val cached = m.segmentation?.let { runCatching { app.cache.json.decodeFromString(dev.jeromeswannack.chineselearning.lab.data.api.ChatBreakdownDto.serializer(), it) }.getOrNull() }
            if (cached != null && m.translation != null) {
                _ui.update { it.copy(segmentations = it.segmentations + (m.id to SegmentedDto(m.translation, cached))) }
                return@launch
            }
            _ui.update { it.copy(translatingId = m.id) }
            try {
                val r = api.translateSegmented(m.id)
                _ui.update { it.copy(segmentations = it.segmentations + (m.id to r)) }
            } catch (e: Exception) {
                _ui.update { it.copy(wordByWord = it.wordByWord - m.id) }
                error("Couldn't load the word-by-word translation.")
            } finally {
                _ui.update { it.copy(translatingId = null) }
            }
        }
    }

    fun openWord(hanzi: String, context: String) = openSheet(ChatSheet.Word(hanzi, context))

    private fun copy(m: ChatMessageDto) {
        runCatching {
            val cm = app.getSystemService(android.content.ClipboardManager::class.java)
            cm.setPrimaryClip(android.content.ClipData.newPlainText("message", m.content))
        }.onSuccess { success("Copied.") }.onFailure { error("Couldn't copy to the clipboard.") }
    }

    // ---------------- header tools ----------------

    fun generateCard() {
        _ui.update { it.copy(generatingCard = true, notice = null) }
        viewModelScope.launch {
            try {
                openSheet(ChatSheet.Card(api.flashcardFromChat(convId).flashcard))
            } catch (e: Exception) {
                error("Couldn't make a card from this conversation — it needs some Chinese vocabulary to work from.")
            } finally {
                _ui.update { it.copy(generatingCard = false) }
            }
        }
    }

    fun helpMeSayIt(intended: String, guess: String) {
        _ui.update { it.copy(sheet = null, generatingOptions = true) }
        viewModelScope.launch {
            try {
                val r = api.responseOptions(convId, intended.trim(), guess.trim().ifEmpty { null })
                openSheet(ChatSheet.Options(r.explanation, r.options, r.options.indices.toSet()))
            } catch (e: Exception) {
                error("Couldn't come up with suggestions.")
            } finally {
                _ui.update { it.copy(generatingOptions = false) }
            }
        }
    }

    fun toggleOption(i: Int) = _ui.update { s ->
        val sheet = s.sheet as? ChatSheet.Options ?: return@update s
        s.copy(sheet = sheet.copy(selected = if (i in sheet.selected) sheet.selected - i else sheet.selected + i))
    }

    fun rename(title: String) {
        _ui.update { it.copy(saving = true, modalNotice = null) }
        viewModelScope.launch {
            try {
                val c = api.renameConversation(convId, title.trim())
                _ui.update { it.copy(saving = false, sheet = null, conversation = (it.conversation ?: c).copy(title = c.title ?: title.trim())) }
                runCatching { app.cache.put(ConnectionsKeys.conversations(relId), ConnectionsKeys.KIND, api.chatConversations(relId)) }
            } catch (e: Exception) {
                _ui.update { it.copy(saving = false, modalNotice = Notice("Couldn't save the title.", true)) }
            }
        }
    }

    fun setVoice(voiceId: String? = null, speed: Double? = null) {
        _ui.update { s -> s.copy(conversation = s.conversation?.copy(voice_id = voiceId ?: s.conversation.voice_id, voice_speed = speed ?: s.conversation.voice_speed)) }
        viewModelScope.launch {
            runCatching { api.setVoiceSettings(convId, voiceId, speed) }.onFailure {
                _ui.update { it.copy(modalNotice = Notice(if (voiceId != null) "Couldn't change the voice." else "Couldn't change the speed.", true)) }
            }
        }
    }

    // ---------------- saving cards ----------------

    /** Saves [cards] to [deckId] (or a new deck named [newDeck]); closes the sheet with "Saved …". */
    fun saveCards(cards: List<SuggestedCard>, deckId: String?, newDeck: String?, context: String? = null, closeSheet: Boolean = true, onSaved: (String) -> Unit = {}) {
        if (cards.isEmpty()) return
        _ui.update { it.copy(saving = true, modalNotice = null) }
        viewModelScope.launch {
            try {
                val (id, name) = if (newDeck != null) api.createDeck(newDeck.trim(), null).let { it.id to it.name.ifEmpty { newDeck.trim() } }
                else deckId!! to (_ui.value.decks.firstOrNull { it.id == deckId }?.name ?: "your deck")
                for (c in cards) api.addChatNote(id, ChatNoteBody(c.hanzi, c.pinyin, c.english, c.fun_facts, context ?: c.context))
                val what = if (cards.size == 1) cards[0].hanzi else "${cards.size} flashcards"
                val msg = "Saved $what to $name."
                app.haptics.correct()
                app.sounds.play(Sounds.Sfx.CORRECT, 0.6f)
                _ui.update { it.copy(saving = false, sheet = if (closeSheet) null else it.sheet, notice = if (closeSheet) Notice(msg, false) else it.notice) }
                onSaved(msg)
                app.scope.launch { runCatching { app.repo.sync() } }
                if (newDeck != null) loadDecks()
            } catch (e: Exception) {
                _ui.update { it.copy(saving = false, modalNotice = Notice(e.userMessage(), true)) }
            }
        }
    }

    fun togglePin(deckId: String) {
        viewModelScope.launch {
            val pinned = app.cache.get<List<String>>(PINNED_KEY).orEmpty()
            app.cache.put(PINNED_KEY, KIND, if (deckId in pinned) pinned - deckId else pinned + deckId)
            loadDecks()
        }
    }

    // word definition (reuses the study card's cache-first lookup)
    suspend fun define(hanzi: String, context: String, refresh: Boolean) = cards.define(hanzi, context, refresh)
    suspend fun deckHolding(hanzi: String) = cards.deckHolding(hanzi)

    // ---------------- Discuss with Claude ----------------

    private fun openDiscussion(m: ChatMessageDto) {
        _ui.update { it.copy(sheet = ChatSheet.Discuss(m), discuss = DiscussState()) }
        viewModelScope.launch {
            val turns = runCatching { api.messageDiscussion(m.id).messages }.getOrDefault(emptyList())
            _ui.update { it.copy(discuss = it.discuss.copy(loading = false, turns = turns)) }
        }
    }

    fun ask(m: ChatMessageDto, question: String) {
        val q = question.trim()
        val d = _ui.value.discuss
        if (q.isEmpty() || d.thinking) return
        val history = d.turns
        val withQ = history + DiscussionTurn("user", q)
        _ui.update { it.copy(discuss = it.discuss.copy(turns = withQ, thinking = true, cards = null, saved = null)) }
        viewModelScope.launch {
            try {
                val r = api.discussMessage(m.id, q, history.ifEmpty { null })
                val all = withQ + DiscussionTurn("assistant", r.response)
                _ui.update { it.copy(discuss = it.discuss.copy(turns = all, thinking = false, cards = r.flashcards?.takeIf { c -> c.isNotEmpty() }, selected = r.flashcards?.indices?.toSet().orEmpty())) }
                runCatching { api.saveMessageDiscussion(m.id, all) }.onSuccess {
                    if (!m.has_discussion) _ui.update { s -> s.copy(messages = s.messages.map { x -> if (x.id == m.id) x.copy(has_discussion = true) else x }) }
                }
            } catch (e: Exception) {
                _ui.update { it.copy(discuss = it.discuss.copy(turns = withQ + DiscussionTurn("assistant", "Sorry, I had trouble responding. Please try again."), thinking = false)) }
            }
        }
    }

    fun toggleDiscussCard(i: Int) = _ui.update { s -> s.copy(discuss = s.discuss.copy(selected = if (i in s.discuss.selected) s.discuss.selected - i else s.discuss.selected + i)) }

    fun saveDiscussCards(m: ChatMessageDto, deckId: String?, newDeck: String?) {
        val d = _ui.value.discuss
        val chosen = d.cards.orEmpty().filterIndexed { i, _ -> i in d.selected }
        _ui.update { it.copy(discuss = it.discuss.copy(saving = true)) }
        saveCards(chosen, deckId, newDeck, context = m.content, closeSheet = false) {
            _ui.update { s -> s.copy(discuss = s.discuss.copy(saving = false, cards = null, selected = emptySet(), saved = "${chosen.size} flashcard${if (chosen.size != 1) "s" else ""} saved!")) }
        }
    }

    // ---------------- new conversation ----------------

    override fun onCleared() {
        stopAudio()
        recordJob?.cancel()
        recorder?.cancel()
        super.onCleared()
    }

    companion object {
        const val KIND = "chat"
        const val PINNED_KEY = "chat/pinned-decks"
        const val RECENT_KEY = "chat/recent-emojis"
        const val CACHE_LIMIT = 300
        /** ScrollRequest id for "the end of the list". */
        const val END = "\u0000end"
        const val RETRY_MS = 5_000L
        const val HIGHLIGHT_MS = 2_500L

        /** `?new=1` / `chat/new`: a fresh untitled conversation; returns its id. */
        suspend fun newConversation(app: LabApp, relId: String): String = app.repo.api.startConversation(relId, PracticeConversationBody()).id
    }
}
