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
}

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
) {
    val isAi: Boolean get() = conversation?.is_ai_conversation ?: false

    /** A message's check status: what we learnt here, else what the server stored. */
    fun checkStatus(m: ChatMessageDto): String? = checkStatuses[m.id] ?: m.check_status

    fun tools(m: ChatMessageDto) = MessageTools.toolsForMessage(m.sender_id, m.content, checkStatus(m), m.has_discussion, viewerRole, isAi, myId ?: "")
}

/**
 * `/connections/:relId/chat/:convId` (web: ChatPage). New messages arrive over the live socket
 * (data/chat/ChatLive.kt) with a poll as fallback (3 s, 20 s while the socket is up); the last copy
 * is cached so the history opens offline. Sending and every tool need a connection — like
 * the web, nothing is queued (the composer says so).
 */
class ChatViewModel(private val app: LabApp, private val relId: String, private val convId: String) : ViewModel() {
    private val _ui = MutableStateFlow(ChatUi())
    val ui: StateFlow<ChatUi> = _ui
    private val api get() = app.repo.api
    private val cards = CardTools(app)
    private var lastTimestamp: String? = null
    private var pollJob: Job? = null
    private var player: MediaPlayer? = null
    private val checkResults = HashMap<String, CheckResultDto>()

    private val messagesKey = "chat/$convId/messages"

    init {
        viewModelScope.launch { app.online.collect { o -> _ui.update { it.copy(online = o) } } }
        viewModelScope.launch { load() }
        viewModelScope.launch { Connections.markConversationRead(app, convId) }
        viewModelScope.launch { readHere() }
        // The live socket (data/chat/ChatLive.kt): a new message shows at once, not at the next poll.
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
        viewModelScope.launch { loadDecks() }
        viewModelScope.launch {
            val recent = app.cache.get<List<String>>(RECENT_KEY).orEmpty()
            _ui.update { it.copy(recentEmojis = recent) }
        }
    }

    private suspend fun load() {
        val cache = app.cache
        val me = Connections.myId(cache)
        val cachedRel = cache.get<RelationshipDto>(ConnectionsKeys.relationship(relId))
        val cachedConvs = cache.get<List<ChatConversationDto>>(ConnectionsKeys.conversations(relId))
        val cachedMsgs = cache.get<List<ChatMessageDto>>(messagesKey)
        applyHeader(cachedRel, cachedConvs, me)
        if (cachedMsgs != null) _ui.update { it.copy(loading = false, messages = cachedMsgs) }
        try {
            val rel = api.relationship(relId).also { cache.put(ConnectionsKeys.relationship(relId), ConnectionsKeys.KIND, it) }
            val convs = api.chatConversations(relId).also { cache.put(ConnectionsKeys.conversations(relId), ConnectionsKeys.KIND, it) }
            applyHeader(rel, convs, me)
            val page = api.chatMessages(convId)
            lastTimestamp = page.latest_timestamp
            cache.put(messagesKey, KIND, page.messages)
            _ui.update { it.copy(loading = false, loadError = null, offlineHistory = false, messages = page.messages) }
            startPolling()
        } catch (e: Exception) {
            _ui.update {
                if (cachedMsgs != null || it.messages.isNotEmpty()) it.copy(loading = false, offlineHistory = true)
                else it.copy(loading = false, loadError = e.userMessage())
            }
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

    /** Polls every 3 s, or every 20 s while the live socket is connected (it's the doorbell then). */
    private fun startPolling() {
        if (pollJob?.isActive == true) return
        pollJob = viewModelScope.launch {
            while (isActive) {
                delay(if (app.chatLive.connected.value) ChatLogic.LIVE_POLL_MS else ChatLogic.POLL_MS)
                fetchNew()
            }
        }
    }

    private suspend fun fetchNew() {
        if (!app.online.value) return
        val since = lastTimestamp ?: return
        runCatching { api.chatMessages(convId, since) }.onSuccess { r ->
            if (r.messages.isEmpty()) return@onSuccess
            val known = _ui.value.messages.mapTo(HashSet()) { it.id }
            val fresh = r.messages.filter { it.id !in known }
            addMessages(r.messages)
            lastTimestamp = r.latest_timestamp ?: lastTimestamp
            if (fresh.any { m -> m.sender_id != _ui.value.myId }) onIncomingWhileOpen()
        }
    }

    /** docs/CHAT.md §4: a `message` event for this chat (null = a push said so: fetch). */
    private suspend fun onLive(e: LiveEvent) {
        if (e !is LiveEvent.Message || e.conversationId != convId) return
        val m = e.message ?: return fetchNew()
        if (_ui.value.messages.any { it.id == m.id }) return
        // lastTimestamp stays: the next poll re-reads from there (deduped), so nothing in between is skipped.
        addMessages(listOf(m))
        if (lastTimestamp == null) lastTimestamp = m.created_at
        if (m.sender_id != _ui.value.myId) onIncomingWhileOpen()
    }

    private suspend fun onIncomingWhileOpen() {
        app.haptics.tick()
        Connections.markConversationRead(app, convId)
        readHere()
    }

    /** This chat is read (docs/CHAT.md §2 `POST …/read`): its notification goes, on every device. */
    private suspend fun readHere() {
        ChatNotifier.cancel(app, convId)
        if (app.online.value) runCatching { api.markChatRead(convId) }
    }

    private fun addMessages(list: List<ChatMessageDto>) {
        _ui.update { it.copy(messages = ChatLogic.merge(it.messages, list)) }
        viewModelScope.launch { app.cache.put(messagesKey, KIND, _ui.value.messages.takeLast(CACHE_LIMIT)) }
    }

    /** Re-reads the whole page (reactions, has_discussion changed on the server). */
    private suspend fun refreshAll() {
        runCatching { api.chatMessages(convId) }.onSuccess { page ->
            _ui.update { it.copy(messages = ChatLogic.merge(ChatLogic.replace(it.messages, page.messages), page.messages)) }
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

    fun setDraft(text: String) = _ui.update { it.copy(draft = text) }
    fun reply(m: ChatMessageDto?) = _ui.update { it.copy(replyingTo = m, sheet = null) }
    fun dismissNotice() = _ui.update { it.copy(notice = null) }
    private fun error(text: String) = _ui.update { it.copy(notice = Notice(text, true)) }
    private fun success(text: String) = _ui.update { it.copy(notice = Notice(text, false)) }

    fun send() {
        val s = _ui.value
        val content = s.draft.trim()
        if (content.isEmpty() || s.sending || s.waitingForAi) return
        if (!s.online) { error("You're offline. Messages can't be sent until you're back online."); return }
        _ui.update { it.copy(sending = true, notice = null) }
        val clientId = java.util.UUID.randomUUID().toString()
        viewModelScope.launch {
            try {
                val msg = api.sendChatMessage(convId, content, s.replyingTo?.id, clientId)
                app.sounds.play(Sounds.Sfx.POP, 0.5f)
                app.haptics.tick()
                addMessages(listOf(msg))
                lastTimestamp = msg.created_at
                _ui.update { it.copy(sending = false, draft = "", replyingTo = null) }
                if (_ui.value.isAi) aiReply()
                else startPolling()
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
            lastTimestamp = r.message.created_at
            if (r.audio_base64 != null) playBase64(r.audio_base64, r.message.id)
        } catch (e: Exception) {
            error("Claude couldn't reply. Your message was sent — try sending another to retry.")
        } finally {
            _ui.update { it.copy(waitingForAi = false) }
            startPolling()
        }
    }

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
        player?.runCatching { release() }
        player = null
        _ui.update { it.copy(playingId = null) }
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
        super.onCleared()
    }

    companion object {
        const val KIND = "chat"
        const val PINNED_KEY = "chat/pinned-decks"
        const val RECENT_KEY = "chat/recent-emojis"
        const val CACHE_LIMIT = 300

        /** `?new=1` / `chat/new`: a fresh untitled conversation; returns its id. */
        suspend fun newConversation(app: LabApp, relId: String): String = app.repo.api.startConversation(relId, PracticeConversationBody()).id
    }
}
