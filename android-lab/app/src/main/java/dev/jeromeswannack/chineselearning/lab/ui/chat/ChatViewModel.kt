package dev.jeromeswannack.chineselearning.lab.ui.chat

import android.media.AudioAttributes
import android.media.MediaPlayer
import android.util.Base64
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.MessageMenu
import dev.jeromeswannack.chineselearning.lab.core.ChatLearning
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
import dev.jeromeswannack.chineselearning.lab.data.api.liveCalls
import dev.jeromeswannack.chineselearning.lab.data.api.startCall
import dev.jeromeswannack.chineselearning.lab.core.ChatSearch
import dev.jeromeswannack.chineselearning.lab.data.api.SendMessageBody
import dev.jeromeswannack.chineselearning.lab.data.api.chatMediaUploadPath
import dev.jeromeswannack.chineselearning.lab.data.api.chatForwardPath
import dev.jeromeswannack.chineselearning.lab.data.api.ForwardBody
import dev.jeromeswannack.chineselearning.lab.data.api.MyRelationshipsDto
import dev.jeromeswannack.chineselearning.lab.data.api.myRelationships
import dev.jeromeswannack.chineselearning.lab.core.ChatDrafts
import dev.jeromeswannack.chineselearning.lab.core.ChatFiles
import dev.jeromeswannack.chineselearning.lab.data.chat.ChatPicked
import dev.jeromeswannack.chineselearning.lab.data.chat.ChatMediaSizing
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavKeys
import dev.jeromeswannack.chineselearning.lab.data.api.chatMessagesPath
import dev.jeromeswannack.chineselearning.lab.data.api.deleteChatMessage
import dev.jeromeswannack.chineselearning.lab.data.api.editChatMessage
import dev.jeromeswannack.chineselearning.lab.data.api.pinChatMessage
import dev.jeromeswannack.chineselearning.lab.data.api.NewNoteBody
import dev.jeromeswannack.chineselearning.lab.data.api.ProposeFlashcardsBody
import dev.jeromeswannack.chineselearning.lab.data.api.ProposedCardDto
import dev.jeromeswannack.chineselearning.lab.data.api.addNotesBatch
import dev.jeromeswannack.chineselearning.lab.data.api.clearMessageCorrection
import dev.jeromeswannack.chineselearning.lab.data.api.coachDraft
import dev.jeromeswannack.chineselearning.lab.data.api.messageWords
import dev.jeromeswannack.chineselearning.lab.data.api.proposeChatFlashcards
import dev.jeromeswannack.chineselearning.lab.data.api.setMessageCorrection
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.async
import dev.jeromeswannack.chineselearning.lab.data.chat.ChatActions as ChatWrites
import dev.jeromeswannack.chineselearning.lab.data.chat.ChatMediaStore
import dev.jeromeswannack.chineselearning.lab.data.chat.ChatWaveforms
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
    data class Check(val messageId: String, val result: CheckResultDto) : ChatSheet
    data object HelpMeSayIt : ChatSheet
    data class Options(val explanation: String?, val options: List<SuggestedCard>, val selected: Set<Int>) : ChatSheet
    data class Translate(val result: TranslateCardDto) : ChatSheet
    data class Word(val hanzi: String, val context: String) : ChatSheet
    data object Rename : ChatSheet
    data object Voice : ChatSheet
    data class Discuss(val message: ChatMessageDto) : ChatSheet
    // ---- PR 2 ----
    /** + → Camera / Photos / Video / File / Help me say it. */
    data object Attach : ChatSheet
    /** Prepared photos (up to 10, round 2 PR 3) with an optional caption for the first, before they go. */
    data class Photos(val photos: List<StagedPhoto>) : ChatSheet
    /** ⋯ on the pinned bar: every pinned message. */
    data object Pins : ChatSheet
    data class ConfirmDelete(val message: ChatMessageDto) : ChatSheet
    // ---- PR 3: learning tools ----
    /** A tapped word chip → the reader word sheet. */
    data class ChatWord(val word: dev.jeromeswannack.chineselearning.lab.data.api.ReaderWordDto, val sentence: String) : ChatSheet
    /** "Make flashcards": the review sheet (its state is [ChatUi.review]). */
    data object Review : ChatSheet
    /** The tutor's "✏️ Correct this" / "Edit correction". */
    data class Correct(val message: ChatMessageDto) : ChatSheet
    // ---- round 2: the long-press menu's sheets ----
    /** Explain (the breakdown, words → cards) or, [saveCard], the whole message as one card (docs/CHAT.md "Round 2"). */
    data class Explain(val message: ChatMessageDto, val saveCard: Boolean = false) : ChatSheet
    // ---- round 2 PR 3 ----
    /** "Forward to…" (its state is [ChatUi.forward]). */
    data object Forward : ChatSheet
    /** Message info: sent, read, edited, forwarded, the attachment… */
    data class Info(val message: ChatMessageDto) : ChatSheet
    /** No app on the phone opens this file: Share… / Save to Downloads. */
    data class FileFallback(val path: String, val name: String, val mime: String) : ChatSheet
    // ---- auto-check ----
    /** ✨ How to say it better: the tutor's correction, else the background check (docs/CHAT.md "Auto-check"). */
    data class SayBetter(val message: ChatMessageDto) : ChatSheet
}

/** A photo shrunk on the phone, waiting in the compose sheet. */
data class StagedPhoto(val path: String, val width: Int, val height: Int)

/** The Explain / Save-as-flashcard sheet's data: `POST /api/sentences/explain-text`, cached by text. */
data class ExplainUi(
    val messageId: String,
    val text: String,
    val translation: String? = null,
    val loading: Boolean = true,
    val result: dev.jeromeswannack.chineselearning.lab.data.api.SentenceExplanation? = null,
    val error: String? = null,
)

/** "Make flashcards" selection mode: the picked message ids; [proposing] while Claude picks cards. */
data class SelectionUi(val selected: Set<String> = emptySet())

/** The review sheet of proposed cards (docs/CHAT.md PR 3). */
data class ReviewUi(
    val review: dev.jeromeswannack.chineselearning.lab.core.FlashcardReview,
    /** Source message id → a one-line preview ("From: …"). */
    val sources: Map<String, String> = emptyMap(),
    val title: String = "Cards from this chat",
    val deckId: String? = null,
    /** Non-null while "+ New deck" is open: the name typed so far. */
    val newDeck: String? = null,
    /** The card whose fields are open for editing. */
    val editing: Int? = null,
    val saving: Boolean = false,
    val error: String? = null,
)

/** The composer's ✓ "Check my Chinese": the draft it checked and Claude's answer. */
data class DraftCheckUi(
    val draft: String,
    val loading: Boolean = true,
    val result: dev.jeromeswannack.chineselearning.lab.data.api.CoachResultDto? = null,
    val error: String? = null,
)

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
    val preparingPhoto: Boolean = false,
    // ---- PR 3: learning tools ----
    /** Pinyin / translation toggles, remembered per conversation on this phone. */
    val aids: ChatLearning.Aids = ChatLearning.Aids(),
    /** Hanzi already in my decks (the quieter chip, "Already in your decks"). */
    val known: Set<String> = emptySet(),
    /** Non-null = "Make flashcards" selection mode. */
    val selection: SelectionUi? = null,
    val review: ReviewUi? = null,
    val draftCheck: DraftCheckUi? = null,
    /** A correction being saved / removed (its message id). */
    val correcting: String? = null,
    /** Claude is picking cards (from the selection or one message). */
    val proposingCards: Boolean = false,
    // ---- round 2 (docs/CHAT.md "Round 2") ----
    /** Bubbles whose time was tapped open (the last of a group always shows it). */
    val timeShown: Set<String> = emptySet(),
    val explain: ExplainUi? = null,
    /** Link previews by URL (absent = not asked / nothing to show). */
    val linkPreviews: Map<String, dev.jeromeswannack.chineselearning.lab.data.chat.LinkPreviewDto> = emptyMap(),
    /** Decoded voice waveforms by playback id (message id, or "p-<clientId>"). */
    val waveforms: Map<String, List<Float>> = emptyMap(),
    /** Voice playback speed: 1 → 1.5 → 2 (remembered on the phone). */
    val voiceSpeed: Float = 1f,
    /** 📹 in the header is starting / finding the call. */
    val callBusy: Boolean = false,
    // ---- round 2 PR 3 ----
    val forward: ForwardUi? = null,
    /** A file being downloaded to open (its message / pending key). */
    val openingFile: String? = null,
    /** Files whose download failed ("couldn't download, tap to retry"). */
    val fileErrors: Set<String> = emptySet(),
    /** The video bubble playing in place (message id, or "p-<clientId>"). */
    val playingVideo: String? = null,
) {
    /** "🕓 1 message waiting for a connection" / "🕓 Sending 2 messages…" while this chat's outbox holds sends. */
    val queueLabel: String? get() = ChatRound3.queueLabel(pending, online)

    val pinned: List<ChatMessageDto> get() = ChatRich.pinned(messages)

    fun rows(): List<ChatRow> = ChatRows.build(messages, pending, unreadId, myId, otherReadAt)

    val isAi: Boolean get() = conversation?.is_ai_conversation ?: false

    /** A message's check status: what we learnt here, else what the server stored. */
    fun checkStatus(m: ChatMessageDto): String? = checkStatuses[m.id] ?: m.check_status

    /** The message's word chips when they still match its text (stale ones are never shown). */
    fun words(m: ChatMessageDto): List<dev.jeromeswannack.chineselearning.lab.data.api.ReaderWordDto>? {
        val w = m.words?.takeIf { it.isNotEmpty() } ?: return null
        if (m.isDeleted) return null
        val text = ChatLearning.wordsText(m.content, m.attachment?.transcript, m.words_source)
        return w.takeIf { dev.jeromeswannack.chineselearning.lab.core.ReaderWords.matches(it.map { x -> x.text }, text) }
    }

    /** What a message's translation toggle shows: the text's translation, or the voice transcript's. */
    fun translationOf(m: ChatMessageDto): String? =
        (if (m.isVoice) m.attachment?.translation else m.translation)?.takeIf { it.isNotBlank() }

    /** The long-press menu of [m] (shared `messageMenu`, parity-tested): reactions on top + the actions in order. */
    fun menu(m: ChatMessageDto): MessageMenu.Menu = MessageMenu.messageMenu(
        MessageMenu.Message(
            senderId = m.sender_id, content = m.content, deletedAt = m.deleted_at, pending = false,
            attachmentKind = m.attachment?.kind, transcript = m.attachment?.transcript, attachmentTranslation = m.attachment?.translation,
            translation = m.translation, hasCorrection = m.correction != null, correctionText = m.correction?.text,
            checkStatus = checkStatus(m), autoCheckStatus = m.auto_check?.status, autoCheckText = m.auto_check?.text,
            hasDiscussion = m.has_discussion, pinnedAt = m.pinned_at,
        ),
        viewerRole, isAi, myId ?: "", pinyinOn = aids.pinyin(m.id), translateOn = aids.translation(m.id),
    )

    /** "corrected" | "improvable" | null — the ✎ on my own bubble and the menu's ✨ ([SayBetter.state], parity-tested). */
    fun sayBetter(m: ChatMessageDto): String? = dev.jeromeswannack.chineselearning.lab.core.SayBetter.state(
        m.sender_id, m.content, m.deleted_at, m.attachment?.kind, m.correction != null, m.correction?.text,
        m.auto_check?.status, m.auto_check?.text, myId ?: "",
    )

    /** The text the learning tools work on (the voice transcript, else the message / caption). */
    fun menuText(m: ChatMessageDto): String = MessageMenu.menuText(m.content, m.attachment?.kind, m.attachment?.transcript)

    /** The messages as the selection sees them. */
    fun pickable(): List<ChatLearning.Pickable> = messages.map { m ->
        ChatLearning.Pickable(m.id, dev.jeromeswannack.chineselearning.lab.ui.connections.Fmt.parse(m.created_at)?.toEpochMilli() ?: 0, ChatLearning.eligible(m.content, m.attachment?.kind, m.attachment?.transcript_status, m.attachment?.transcript, m.isDeleted))
    }

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
    /** Forwards queued from this screen (their failures come back as a notice). */
    private val forwards = HashSet<String>()
    /** The draft is kept per conversation only after the stored one was restored (round 2 PR 3). */
    private var draftsReady = false
    private var draftJob: Job? = null

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
                // A forward the server refused (deleted / gone / not a member): say so, drop the row.
                items.filter { it.id in forwards && it.state == dev.jeromeswannack.chineselearning.lab.data.platform.Outbox.FAILED }.forEach { f ->
                    forwards -= f.id
                    error("Couldn't forward that. ${ChatRound3.forwardError(f.lastError)}")
                    app.scope.launch { app.outbox.discard(f.id) }
                }
                val now = ChatRich.pendingFromOutbox(items, convId, api.json, ChatMediaStore::dims)
                val ids = now.mapTo(HashSet()) { it.clientId }
                for (p in outboxPending) if (p.clientId !in ids && p.clientId !in discarded && !p.failed) delivered[p.clientId] = p.copy(delivered = true)
                outboxPending = now
                refreshPending()
                if (delivered.isNotEmpty()) fetchNew()
            }
        }
        viewModelScope.launch {
            app.outbox.completed.collect { item ->
                forwards -= item.id
                if (item.kind == ChatWrites.KIND_SEND || item.kind == ChatWrites.KIND_MEDIA || item.kind == ChatWrites.KIND_FORWARD) fetchNew()
            }
        }
        viewModelScope.launch { restoreDraft() }
        // Pending sends retry while the chat is open (the outbox stops at the first network error).
        viewModelScope.launch {
            while (isActive) {
                delay(RETRY_MS)
                if (outboxPending.any { !it.failed } && app.online.value) flushOutbox()
            }
        }
        viewModelScope.launch { loadDecks() }
        viewModelScope.launch { loadAids(); loadKnown() }
        viewModelScope.launch {
            val recent = app.cache.get<List<String>>(RECENT_KEY).orEmpty()
            val speed = runCatching { app.cache.get<Float>(SPEED_KEY) }.getOrNull()?.takeIf { it in listOf(1f, 1.5f, 2f) } ?: 1f
            _ui.update { it.copy(recentEmojis = recent, voiceSpeed = speed) }
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

    /** The draft this chat had when it was left (JsonCache `chat/drafts`, the web's chatDrafts rule). */
    private suspend fun restoreDraft() {
        val saved = runCatching { ChatDrafts.load(loadDrafts(app), convId) }.getOrDefault("")
        _ui.update { if (it.draft.isEmpty() && it.editing == null && saved.isNotEmpty()) it.copy(draft = saved) else it }
        draftsReady = true
    }

    /** Keeps the box's text for this chat (not while editing a message — that text is the message's). */
    private fun persistDraft(text: String, now: Boolean = false) {
        if (!draftsReady || _ui.value.editing != null) return
        draftJob?.cancel()
        draftJob = app.scope.launch {
            if (!now) delay(DRAFT_SAVE_MS)
            saveDraft(app, convId, text)
        }
    }

    fun setDraft(text: String) {
        _ui.update { it.copy(draft = text, draftCheck = it.draftCheck?.takeIf { c -> c.draft == text.trim() }) }
        persistDraft(text)
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
        persistDraft("", now = true)
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
                persistDraft("", now = true)
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

    fun startEdit(m: ChatMessageDto) {
        draftJob?.cancel()
        // Keep what was typed (it comes back after the edit), then the box holds the message.
        val typed = _ui.value.draft
        if (_ui.value.editing == null && draftsReady) app.scope.launch { saveDraft(app, convId, typed) }
        _ui.update { it.copy(sheet = null, editing = m, draft = m.content, replyingTo = null) }
    }

    fun cancelEdit() {
        _ui.update { it.copy(editing = null, draft = "") }
        // What was typed before the edit is still in the stored draft.
        viewModelScope.launch { restoreDraft() }
    }

    private fun saveEdit() {
        val s = _ui.value
        val m = s.editing ?: return
        val content = s.draft.trim()
        if (content == m.content.trim()) { cancelEdit(); return }
        if (content.isEmpty() && m.attachment == null) return
        if (!s.online) { error("You're offline — edits need a connection."); return }
        val now = java.time.Instant.now().toString()
        replaceLocal(m.id) { it.copy(content = content, edited_at = now, translation = null) }
        _ui.update { it.copy(editing = null, draft = "") }
        viewModelScope.launch { restoreDraft() }
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

    // ---------------- photos, files, video clips ----------------

    /**
     * Photos from the camera / picker (up to [ChatPhoto.MAX_PHOTOS], round 2 PR 3): each shrunk on
     * the phone, then the compose sheet (a grid with ✕ when there are several).
     */
    fun preparePhotos(context: android.content.Context, uris: List<android.net.Uri>) {
        val list = uris.take(dev.jeromeswannack.chineselearning.lab.data.chat.ChatPhoto.MAX_PHOTOS)
        if (list.isEmpty()) return
        _ui.update { it.copy(sheet = null, preparingPhoto = true, notice = null) }
        viewModelScope.launch {
            val done = ArrayList<StagedPhoto>()
            try {
                for (uri in list) {
                    val file = app.outbox.stageFile("chat-photo.jpg")
                    val (w, h) = withContext(Dispatchers.IO) { ChatPhoto.prepare(context, uri, file) }
                    done += StagedPhoto(file.absolutePath, w, h)
                }
                _ui.update { it.copy(preparingPhoto = false, sheet = ChatSheet.Photos(done)) }
                if (uris.size > list.size) _ui.update { it.copy(notice = Notice("Up to 10 photos at a time — the first 10 are ready to send.", false)) }
            } catch (e: Exception) {
                done.forEach { java.io.File(it.path).delete() }
                _ui.update { it.copy(preparingPhoto = false) }
                error(e.message ?: "This photo couldn't be opened.")
            }
        }
    }

    fun preparePhoto(context: android.content.Context, uri: android.net.Uri) = preparePhotos(context, listOf(uri))

    /** ✕ on one photo of several (the last one closes the sheet). */
    fun removePhoto(index: Int) {
        val sheet = _ui.value.sheet as? ChatSheet.Photos ?: return
        sheet.photos.getOrNull(index)?.let { java.io.File(it.path).delete() }
        val rest = sheet.photos.filterIndexed { i, _ -> i != index }
        app.haptics.tick()
        _ui.update { it.copy(sheet = if (rest.isEmpty()) null else ChatSheet.Photos(rest)) }
    }

    /** Send: one message per photo (own client id, own outbox row), the caption and the reply with the first. */
    fun sendPhoto(caption: String) {
        val sheet = _ui.value.sheet as? ChatSheet.Photos ?: return
        val replyTo = _ui.value.replyingTo?.id
        _ui.update { it.copy(sheet = null, replyingTo = null) }
        app.sounds.play(Sounds.Sfx.POP, 0.5f)
        app.haptics.tick()
        app.scope.launch {
            sheet.photos.forEachIndexed { i, p ->
                val clientId = java.util.UUID.randomUUID().toString()
                val file = java.io.File(p.path)
                media.adopt(clientId, file, "jpg")
                val cap = if (i == 0) caption.trim().ifEmpty { null } else null
                app.outbox.enqueueRaw(ChatWrites.KIND_MEDIA, "POST", chatMediaUploadPath(convId, "image", clientId, cap, if (i == 0) replyTo else null), file, "image/jpeg", id = clientId)
            }
            flushOutbox()
        }
        requestScrollToEnd()
    }

    fun discardPhoto() {
        (_ui.value.sheet as? ChatSheet.Photos)?.photos?.forEach { java.io.File(it.path).delete() }
        _ui.update { it.copy(sheet = null) }
    }

    /**
     * A document from the system picker: checked like the web (`fileProblem`: the server's
     * extensions, ≤ 20 MB, not empty), copied into the outbox and sent as `kind=file&name=`.
     */
    fun sendFile(context: android.content.Context, uri: android.net.Uri) {
        _ui.update { it.copy(sheet = null, notice = null) }
        val replyTo = _ui.value.replyingTo
        viewModelScope.launch {
            try {
                val meta = withContext(Dispatchers.IO) { ChatPicked.meta(context, uri) }
                val name = ChatMediaSizing.safeFileName(meta.name)
                ChatFiles.fileProblem(name, meta.size.coerceAtLeast(0))?.let { error(it); return@launch }
                val clientId = java.util.UUID.randomUUID().toString()
                val ext = ChatMediaStore.extFor("file", name, null)
                val staged = app.outbox.stageFile("chat-file.$ext")
                withContext(Dispatchers.IO) { ChatPicked.copy(context, uri, staged) }
                ChatFiles.fileProblem(name, staged.length())?.let { staged.delete(); error(it); return@launch }
                _ui.update { it.copy(replyingTo = null) }
                app.sounds.play(Sounds.Sfx.POP, 0.5f)
                app.haptics.tick()
                media.adopt(clientId, staged, ext)
                val mime = ChatFiles.FILE_TYPES[ext] ?: "application/octet-stream"
                app.outbox.enqueueRaw(ChatWrites.KIND_MEDIA, "POST", chatMediaUploadPath(convId, "file", clientId, null, replyTo?.id, name = name), staged, mime, id = clientId)
                flushOutbox()
                requestScrollToEnd()
            } catch (e: Exception) {
                error("Couldn't queue the file. ${e.message ?: ""}".trim())
            }
        }
    }

    /** A video clip (≤ 25 MB): its length and shape read on the phone, sent as `kind=video&duration_ms=&width=&height=`. */
    fun sendVideo(context: android.content.Context, uri: android.net.Uri) {
        _ui.update { it.copy(sheet = null, notice = null) }
        val replyTo = _ui.value.replyingTo
        viewModelScope.launch {
            try {
                val meta = withContext(Dispatchers.IO) { ChatPicked.meta(context, uri) }
                ChatFiles.videoProblem(meta.size)?.let { error(it); return@launch }
                val ext = ChatMediaStore.extFor("video", null, meta.mime)
                val staged = app.outbox.stageFile("chat-video.$ext")
                withContext(Dispatchers.IO) { ChatPicked.copy(context, uri, staged) }
                ChatFiles.videoProblem(staged.length())?.let { staged.delete(); error(it); return@launch }
                val info = withContext(Dispatchers.IO) { ChatPicked.videoInfo(staged.absolutePath) }
                val clientId = java.util.UUID.randomUUID().toString()
                _ui.update { it.copy(replyingTo = null) }
                app.sounds.play(Sounds.Sfx.POP, 0.5f)
                app.haptics.tick()
                media.adopt(clientId, staged, ext)
                val mime = when (ext) { "webm" -> "video/webm"; "mov" -> "video/quicktime"; else -> "video/mp4" }
                app.outbox.enqueueRaw(
                    ChatWrites.KIND_MEDIA, "POST",
                    chatMediaUploadPath(convId, "video", clientId, null, replyTo?.id, info.durationMs, width = info.width, height = info.height),
                    staged, mime, id = clientId,
                )
                flushOutbox()
                requestScrollToEnd()
            } catch (e: Exception) {
                error("Couldn't queue the video. ${e.message ?: ""}".trim())
            }
        }
    }

    /**
     * A tap on a file bubble: download it (with the session's auth) the first time, then hand it to
     * [open] (an ACTION_VIEW through the FileProvider). Fails → "couldn't download, tap to retry".
     */
    fun openFile(m: ChatMessageDto, open: (java.io.File, String) -> Unit) {
        if (_ui.value.openingFile == m.id) return
        _ui.update { it.copy(openingFile = m.id, fileErrors = it.fileErrors - m.id) }
        viewModelScope.launch {
            val f = media.openable(m)
            _ui.update { it.copy(openingFile = null, fileErrors = if (f == null) it.fileErrors + m.id else it.fileErrors) }
            if (f != null) open(f, m.attachment?.mime?.takeIf { it.isNotEmpty() } ?: "application/octet-stream")
            else error(if (_ui.value.online) "Couldn't download that file." else "You're offline — the file opens once it has downloaded.")
        }
    }

    /** My pending file, opened from its staged copy. */
    fun openPendingFile(p: PendingBubble, open: (java.io.File, String) -> Unit) {
        val path = p.filePath ?: return
        val name = p.name ?: "file"
        viewModelScope.launch {
            media.openableLocal(path, "p-" + p.clientId, name)?.let { open(it, ChatFiles.FILE_TYPES[ChatMediaStore.extFor("file", name, null)] ?: "application/octet-stream") }
        }
    }

    /** A tap on a video bubble: play it in place / back to its first frame. */
    fun toggleVideo(id: String) {
        stopAudio()
        app.haptics.tick()
        _ui.update { it.copy(playingVideo = if (it.playingVideo == id) null else id) }
    }

    /** A video's bytes (cached / adopted / downloaded) for its bubble. */
    suspend fun videoFile(m: ChatMessageDto): java.io.File? = media.file(m)

    suspend fun poster(path: String, key: String, maxSide: Int) = media.poster(java.io.File(path), key, maxSide)

    // ---------------- forward / info ----------------

    /** Menu → Forward, or the selection bar's Forward: "Forward to…" for these messages (oldest first). */
    fun startForward(ids: List<String>) {
        val order = _ui.value.messages.map { it.id }
        val sorted = ids.distinct().sortedBy { order.indexOf(it) }
        if (sorted.isEmpty()) return
        _ui.update { it.copy(sheet = ChatSheet.Forward, forward = ForwardUi(sorted)) }
        viewModelScope.launch { loadForwardTargets() }
    }

    fun forwardSelection() {
        val sel = _ui.value.selection?.selected ?: return
        startForward(sel.toList())
    }

    /** Cached relationships + conversations first (instant, offline), then the network's. */
    private suspend fun loadForwardTargets() {
        val me = _ui.value.myId ?: Connections.myId(app.cache)
        suspend fun cached(): List<ForwardTarget>? {
            val rels = app.cache.get<MyRelationshipsDto>(NavKeys.RELATIONSHIPS) ?: return null
            val convs = (rels.tutors + rels.students).associate { r -> r.id to app.cache.get<List<ChatConversationDto>>(ConnectionsKeys.conversations(r.id)).orEmpty() }
            return ChatRound3.forwardTargets(rels, convs, me)
        }
        runCatching { cached() }.getOrNull()?.let { t -> _ui.update { s -> s.forward?.let { s.copy(forward = it.copy(targets = t)) } ?: s } }
        if (!app.online.value) {
            _ui.update { s -> s.forward?.let { f -> s.copy(forward = if (f.targets == null) f.copy(error = "You're offline — forwarding needs a connection.") else f) } ?: s }
            return
        }
        try {
            val rels = api.myRelationships().also { app.cache.put(NavKeys.RELATIONSHIPS, NavKeys.KIND, it) }
            val convs = kotlinx.coroutines.coroutineScope {
                (rels.tutors + rels.students).map { r ->
                    async {
                        r.id to (runCatching { api.chatConversations(r.id).also { app.cache.put(ConnectionsKeys.conversations(r.id), ConnectionsKeys.KIND, it) } }.getOrNull()
                            ?: app.cache.get<List<ChatConversationDto>>(ConnectionsKeys.conversations(r.id)).orEmpty())
                    }
                }.map { it.await() }.toMap()
            }
            val t = ChatRound3.forwardTargets(rels, convs, me)
            _ui.update { s -> s.forward?.let { s.copy(forward = it.copy(targets = t, error = null)) } ?: s }
        } catch (e: Exception) {
            _ui.update { s -> s.forward?.let { f -> s.copy(forward = if (f.targets == null) f.copy(error = "Couldn't load your conversations. ${e.userMessage()}") else f) } ?: s }
        }
    }

    /**
     * Picked a conversation: one `POST /api/messages/:id/forward` per message, oldest first, through
     * the Outbox (idempotent by client_id, so a retry never doubles it).
     */
    fun forwardTo(target: ForwardTarget) {
        val f = _ui.value.forward ?: return
        _ui.update { it.copy(sheet = null, forward = null, selection = null) }
        app.haptics.tick()
        app.sounds.play(Sounds.Sfx.POP, 0.5f)
        val ids = f.messageIds
        app.scope.launch {
            for (id in ids) {
                val clientId = java.util.UUID.randomUUID().toString()
                forwards += clientId
                app.outbox.enqueueJson(ChatWrites.KIND_FORWARD, "POST", chatForwardPath(id), ForwardBody(target.conversationId, clientId), id = clientId)
            }
            flushOutbox()
        }
        success(if (_ui.value.online) ChatRound3.forwardedNotice(ids.size, target) else "You're offline — ${if (ids.size == 1) "it forwards" else "they forward"} to ${target.label} once you're back online.")
    }

    fun closeForward() = _ui.update { it.copy(sheet = if (it.sheet == ChatSheet.Forward) null else it.sheet, forward = null) }

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

    /** Released while holding / ➤ while locked: stop and send at once (a too-short take says so). */
    fun sendRecordingNow() {
        finishRecording()
        if (_ui.value.recorder is RecorderUi.Preview) sendRecording()
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
            else {
                runCatching { mp.start(); if (_ui.value.voiceSpeed != 1f) mp.playbackParams = mp.playbackParams.setSpeed(_ui.value.voiceSpeed) }
                _ui.update { it.copy(voice = v.copy(playing = true)) }
                trackProgress(id)
            }
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
                    val speed = _ui.value.voiceSpeed
                    if (speed != 1f) runCatching { it.playbackParams = it.playbackParams.setSpeed(speed) }
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


    // ---------------- per-message tools ----------------

    fun openSheet(sheet: ChatSheet?) = _ui.update { it.copy(sheet = sheet, modalNotice = null) }

    /**
     * The long-press menu (docs/CHAT.md "Round 2", shared `messageMenu`): every action of a bubble.
     * Ids are MessageMenu's.
     */
    fun onMenuAction(id: String, m: ChatMessageDto) {
        _ui.update { it.copy(sheet = null) }
        when (id) {
            MessageMenu.SAY_BETTER -> openSheet(ChatSheet.SayBetter(m))
            MessageMenu.REPLY -> reply(m)
            MessageMenu.COPY -> copy(_ui.value.menuText(m))
            MessageMenu.TRANSLATE -> translateInline(m)
            MessageMenu.PINYIN -> togglePinyin(m.id)
            MessageMenu.EXPLAIN -> explain(m, saveCard = false)
            MessageMenu.SAVE_CARD -> explain(m, saveCard = true)
            MessageMenu.SELECT_CARDS, MessageMenu.SELECT -> startSelecting(m.id)
            MessageMenu.CHECK -> check(m)
            MessageMenu.VIEW_CORRECTIONS -> viewCheck(m)
            MessageMenu.CORRECT -> openSheet(ChatSheet.Correct(m))
            MessageMenu.REMOVE_CORRECTION -> removeCorrection(m)
            MessageMenu.CORRECTION_CARD -> proposeCorrection(m)
            MessageMenu.PLAY -> play(m)
            MessageMenu.WORD_BY_WORD -> toggleWordByWord(m)
            MessageMenu.DISCUSS -> openDiscussion(m)
            MessageMenu.PIN -> setPinned(m, true)
            MessageMenu.UNPIN -> setPinned(m, false)
            MessageMenu.FORWARD -> startForward(listOf(m.id))
            MessageMenu.INFO -> openSheet(ChatSheet.Info(m))
            MessageMenu.EDIT -> startEdit(m)
            MessageMenu.DELETE -> askDelete(m)
        }
    }

    /** A tap on a bubble shows / hides its time (the last bubble of a group always shows it). */
    fun toggleTime(id: String) = _ui.update { it.copy(timeShown = if (id in it.timeShown) it.timeShown - id else it.timeShown + id) }

    /**
     * Translate / Hide translation: the toggle; a text message not translated yet asks the server
     * first (`translate-segmented`, which stores the translation on the message for both people).
     */
    private fun translateInline(m: ChatMessageDto) {
        val s = _ui.value
        if (s.aids.translation(m.id) || s.translationOf(m) != null) { toggleTranslation(m.id); return }
        if (m.isVoice || s.translatingId != null) return
        if (!s.online) { error("You're offline — translating needs a connection."); return }
        _ui.update { it.copy(translatingId = m.id) }
        viewModelScope.launch {
            try {
                val r = api.translateSegmented(m.id)
                val t = r.translation.ifBlank { r.segmentation.english }
                if (t.isBlank()) { error("Couldn't translate that message."); return@launch }
                replaceLocal(m.id) { it.copy(translation = t) }
                _ui.update { it.copy(segmentations = it.segmentations + (m.id to r)) }
                if (!_ui.value.aids.translation(m.id)) setAids(_ui.value.aids.toggleTranslation(m.id))
                app.haptics.tick()
            } catch (e: Exception) {
                error("Couldn't translate that message.")
            } finally {
                _ui.update { it.copy(translatingId = null) }
            }
        }
    }

    // ---- Explain / Save as flashcard (the Coach's breakdown, cached by text) ----

    /**
     * Explain → the sentence, its translation and the word-by-word breakdown; Save as flashcard →
     * the same breakdown made into ONE sentence card (`breakdownSentenceCard`) in the add-card
     * sheet. `POST /api/sentences/explain-text`, cached under the Coach / study key, so a sentence
     * explained anywhere opens offline here.
     */
    fun explain(m: ChatMessageDto, saveCard: Boolean) {
        val text = _ui.value.menuText(m)
        if (text.isEmpty()) return
        val translation = _ui.value.translationOf(m)
        _ui.update { it.copy(sheet = ChatSheet.Explain(m, saveCard), explain = ExplainUi(m.id, text, translation), modalNotice = null) }
        loadExplanation(m.id, text, translation)
    }

    fun retryExplain() {
        val e = _ui.value.explain ?: return
        _ui.update { it.copy(explain = e.copy(loading = true, error = null)) }
        loadExplanation(e.messageId, e.text, e.translation)
    }

    private fun loadExplanation(id: String, text: String, translation: String?) {
        viewModelScope.launch {
            val r = runCatching {
                cards.cachedTextExplanation(text) ?: run {
                    if (!app.online.value) throw java.io.IOException("offline")
                    cards.explain(null, text, null, translation)
                }
            }
            _ui.update { s ->
                val e = s.explain?.takeIf { it.messageId == id && it.text == text } ?: return@update s
                r.fold(
                    onSuccess = { x -> s.copy(explain = e.copy(loading = false, result = x, translation = e.translation ?: x.translation)) },
                    onFailure = { x -> s.copy(explain = e.copy(loading = false, error = if (!app.online.value) "You're offline — explaining needs a connection the first time." else "Couldn't explain it. ${x.userMessage()}")) },
                )
            }
        }
    }

    fun closeExplain() = _ui.update { it.copy(sheet = if (it.sheet is ChatSheet.Explain) null else it.sheet, explain = null) }

    // ---- link previews / waveforms / speed ----

    private val linkPreviews = dev.jeromeswannack.chineselearning.lab.data.chat.ChatLinkPreviews(app)
    private val linksAsked = HashSet<String>()
    private val wavesAsked = HashSet<String>()

    /** A bubble with a link came on screen: its preview, cache-first (fails quietly). */
    fun requestLinkPreview(url: String) {
        if (!linksAsked.add(url)) return
        viewModelScope.launch {
            val p = runCatching { linkPreviews.preview(url) }.getOrNull()
            if (p == null) { if (!app.online.value) linksAsked.remove(url); return@launch }
            _ui.update { it.copy(linkPreviews = it.linkPreviews + (url to p)) }
        }
    }

    suspend fun linkImage(url: String, maxSide: Int) = linkPreviews.image(url, maxSide)

    /** A voice bubble came on screen: its real waveform (decoded once, cached per message). */
    fun requestWaveform(playId: String, m: ChatMessageDto?, localPath: String?) {
        if (playId in _ui.value.waveforms || !wavesAsked.add(playId)) return
        viewModelScope.launch {
            // Cached for this message: drawn at once, no download.
            if (m != null) runCatching { app.cache.get(ChatWaveforms.key(m.id), ChatWaveforms.Cached.serializer()) }.getOrNull()?.takeIf { it.bars.size == ChatWaveforms.BARS }?.let { c ->
                _ui.update { it.copy(waveforms = it.waveforms + (playId to c.bars)) }
                return@launch
            }
            val file = localPath?.let { java.io.File(it) }?.takeIf { it.exists() } ?: m?.let { media.file(it) }
            if (file == null) { wavesAsked.remove(playId); return@launch }
            val bars = ChatWaveforms.bars(if (m != null) app.cache else null, m?.id ?: playId, file) ?: return@launch
            _ui.update { it.copy(waveforms = it.waveforms + (playId to bars)) }
        }
    }

    /** The voice speed chip: 1× → 1.5× → 2× → 1×, remembered on the phone; applies to what is playing. */
    fun cycleSpeed() {
        val next = when (_ui.value.voiceSpeed) { 1f -> 1.5f; 1.5f -> 2f; else -> 1f }
        app.haptics.tick()
        _ui.update { it.copy(voiceSpeed = next) }
        player?.let { mp -> if (_ui.value.voice?.playing == true) runCatching { mp.playbackParams = mp.playbackParams.setSpeed(next) } }
        // Taps save in their own coroutines; under the lock each writes the CURRENT speed, so two quick
        // taps can't land out of order and leave the older value stored.
        viewModelScope.launch { speedSave.withLock { runCatching { app.cache.put(SPEED_KEY, KIND, _ui.value.voiceSpeed) } } }
    }

    private val speedSave = kotlinx.coroutines.sync.Mutex()

    /** 📹 in the header: join the live call of this relationship, else start one (web: handleVideoCall). */
    fun videoCall(go: (String) -> Unit) {
        if (_ui.value.callBusy) return
        if (!app.online.value) { error("You're offline — calls need a connection."); return }
        _ui.update { it.copy(callBusy = true) }
        viewModelScope.launch {
            try {
                val live = runCatching { api.liveCalls(relId).occupiedCallId() }.getOrNull()
                go(live ?: api.startCall(relId).call.id)
            } catch (e: Exception) {
                error("Couldn't start the call. ${e.userMessage()}")
            } finally {
                _ui.update { it.copy(callBusy = false) }
            }
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

    fun play(m: ChatMessageDto) = playText(m.id, m.content)

    /**
     * Read aloud [text] through the chat's TTS (the conversation's voice), [id] = what shows as playing
     * (a message id, or "say-better-<id>" for the corrected sentence in "How to say it better").
     */
    fun playText(id: String, text: String) {
        if (_ui.value.playingId == id) { stopAudio(); return }
        if (text.isBlank()) return
        _ui.update { it.copy(playingId = id) }
        viewModelScope.launch {
            try {
                val c = _ui.value.conversation
                val r = api.conversationTts(convId, text, c?.voice_id, c?.voice_speed)
                playBase64(r.audio_base64, id)
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

    private fun copy(text: String) {
        runCatching {
            val cm = app.getSystemService(android.content.ClipboardManager::class.java)
            cm.setPrimaryClip(android.content.ClipData.newPlainText("message", text))
        }.onSuccess { app.haptics.tick(); success("Copied.") }.onFailure { error("Couldn't copy to the clipboard.") }
    }

    /** Selection bar → Copy: the picked messages' texts, oldest first. */
    fun copySelection() {
        val sel = _ui.value.selection?.selected ?: return
        val s = _ui.value
        val text = s.messages.filter { it.id in sel }.map { s.menuText(it) }.filter { it.isNotEmpty() }.joinToString("\n")
        if (text.isEmpty()) return
        copy(text)
        _ui.update { it.copy(selection = null) }
    }

    // ---------------- header tools ----------------

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


    // ---------------- PR 3: learning tools (docs/CHAT.md) ----------------

    private val aidsKey = "chat/$convId/aids"
    /** Messages whose words were asked for this session (once each). */
    private val wordsAsked = HashSet<String>()
    private val wordsGate = kotlinx.coroutines.sync.Semaphore(2)

    private suspend fun loadAids() {
        app.cache.get<ChatAidsDto>(aidsKey)?.let { d -> _ui.update { it.copy(aids = d.toAids()) } }
    }

    private fun setAids(a: ChatLearning.Aids) {
        _ui.update { it.copy(aids = a) }
        viewModelScope.launch { runCatching { app.cache.put(aidsKey, KIND, ChatAidsDto.of(a)) } }
    }

    /** The 拼 toggle under a message. */
    fun togglePinyin(id: String) { app.haptics.tick(); setAids(_ui.value.aids.togglePinyin(id)) }

    /** The EN toggle under a message (text or voice). */
    fun toggleTranslation(id: String) { app.haptics.tick(); setAids(_ui.value.aids.toggleTranslation(id)) }

    /** Header ⋯ → "Show pinyin for all". */
    fun setPinyinAll(on: Boolean) { _ui.update { it.copy(sheet = null) }; app.haptics.tick(); setAids(_ui.value.aids.setPinyinAll(on)) }

    fun setTranslationAll(on: Boolean) { _ui.update { it.copy(sheet = null) }; app.haptics.tick(); setAids(_ui.value.aids.setTranslationAll(on)) }

    private suspend fun loadKnown() {
        val known = withContext(Dispatchers.IO) { app.repo.dao.allNotes().mapTo(HashSet()) { it.hanzi.trim() } }
        _ui.update { it.copy(known = known) }
    }

    /**
     * A Chinese message without word chips came on screen: `POST /api/messages/:id/words` once per
     * message per session (two at a time). The answer — and the `message_updated` it causes — fill
     * the chips in.
     */
    fun requestWords(m: ChatMessageDto) {
        if (!app.online.value) return
        val a = m.attachment
        if (!ChatLearning.needsWords(m.content, a?.kind, a?.transcript_status, a?.transcript, m.isDeleted, _ui.value.words(m) != null)) return
        if (!wordsAsked.add(m.id)) return
        viewModelScope.launch {
            wordsGate.withPermit {
                runCatching { api.messageWords(m.id) }.onSuccess { r ->
                    val w = r.words
                    if (!w.isNullOrEmpty()) replaceLocal(m.id) { it.copy(words = w, words_source = r.source ?: it.words_source) }
                }
            }
        }
    }

    /** A word chip: the reader word sheet with the sentence it was said in. */
    fun openChip(m: ChatMessageDto, index: Int) {
        val words = _ui.value.words(m) ?: return
        val w = words.getOrNull(index) ?: return
        val text = ChatLearning.wordsText(m.content, m.attachment?.transcript, m.words_source)
        val start = dev.jeromeswannack.chineselearning.lab.core.ReaderWords.offsets(words.map { it.text })[index]
        app.haptics.tick()
        openSheet(ChatSheet.ChatWord(w, dev.jeromeswannack.chineselearning.lab.core.ReaderWords.sentenceAround(text, start, start + w.text.length)))
    }

    /** The word sheet added a card: its chips go quiet. */
    fun wordAdded() {
        app.haptics.correct()
        viewModelScope.launch { loadKnown() }
    }

    // ---- "Make flashcards": selection → propose → review → batch ----

    /** Selection mode — from ⋯ → Make flashcards, or the menu's Select / Make flashcards from selection with [first] ticked. */
    fun startSelecting(first: String? = null) {
        val picked = first?.let { ChatLearning.toggle(emptySet(), it, _ui.value.pickable()) }.orEmpty()
        _ui.update { it.copy(sheet = null, search = null, highlightId = null, selection = SelectionUi(picked), draftCheck = null) }
        app.haptics.tick()
    }

    fun cancelSelecting() = _ui.update { it.copy(selection = null) }

    fun toggleSelect(id: String) {
        val sel = _ui.value.selection ?: return
        val next = ChatLearning.toggle(sel.selected, id, _ui.value.pickable())
        if (next == sel.selected) return
        app.haptics.tick()
        _ui.update { it.copy(selection = sel.copy(selected = next)) }
    }

    /** Quick picks: "Today" / "Last 50 messages" (a second tap clears that pick). */
    fun selectToday() {
        val sel = _ui.value.selection ?: return
        val zone = java.time.ZoneId.systemDefault()
        val dayStart = java.time.LocalDate.now(zone).atStartOfDay(zone).toInstant().toEpochMilli()
        val picked = ChatLearning.today(_ui.value.pickable(), dayStart)
        app.haptics.tick()
        _ui.update { it.copy(selection = sel.copy(selected = if (picked.isNotEmpty() && picked == sel.selected) emptySet() else picked)) }
    }

    fun selectLast() {
        val sel = _ui.value.selection ?: return
        val picked = ChatLearning.lastN(_ui.value.pickable())
        app.haptics.tick()
        _ui.update { it.copy(selection = sel.copy(selected = if (picked.isNotEmpty() && picked == sel.selected) emptySet() else picked)) }
    }

    fun proposeSelected() {
        val sel = _ui.value.selection ?: return
        val ids = ChatLearning.requestIds(sel.selected, _ui.value.pickable())
        if (ids.isEmpty()) return
        propose(ProposeFlashcardsBody(message_ids = ids), "Cards from ${ids.size} message${if (ids.size == 1) "" else "s"}")
    }

    /** ⋯ → "Make cards from this message". */
    fun proposeFor(m: ChatMessageDto) = propose(ProposeFlashcardsBody(message_ids = listOf(m.id)), "Cards from this message")

    /** The student's "Make a card from the correction" (focus 'correction'). */
    fun proposeCorrection(m: ChatMessageDto) = propose(ProposeFlashcardsBody(message_ids = listOf(m.id), focus = "correction"), "From ${_ui.value.otherName.ifEmpty { "your tutor" }}'s correction")

    private fun propose(body: ProposeFlashcardsBody, title: String) {
        if (_ui.value.proposingCards) return
        if (!app.online.value) { error("You're offline — making cards needs a connection."); return }
        _ui.update { it.copy(proposingCards = true, sheet = null, notice = null) }
        viewModelScope.launch {
            try {
                val r = api.proposeChatFlashcards(convId, body)
                if (r.cards.isEmpty()) {
                    error("Claude found nothing new to make cards from in those messages.")
                    return@launch
                }
                val cards = r.cards.map(::proposed)
                val byId = _ui.value.messages.associateBy { it.id }
                val sources = cards.mapNotNull { it.sourceMessageId }.distinct().mapNotNull { id -> byId[id]?.let { id to sourcePreview(it) } }.toMap()
                val last = app.cache.get<String>(LAST_DECK_KEY)
                val decks = _ui.value.decks
                val deckId = last?.takeIf { id -> decks.any { it.id == id } } ?: decks.firstOrNull()?.id
                app.haptics.tick()
                app.sounds.play(Sounds.Sfx.FLIP, 0.5f)
                _ui.update {
                    it.copy(
                        selection = null,
                        review = ReviewUi(dev.jeromeswannack.chineselearning.lab.core.FlashcardReview.of(cards), sources, title, deckId, newDeck = if (decks.isEmpty()) "" else null),
                        sheet = ChatSheet.Review,
                    )
                }
            } catch (e: Exception) {
                error("Couldn't make cards. ${e.userMessage()}")
            } finally {
                _ui.update { it.copy(proposingCards = false) }
            }
        }
    }

    private fun sourcePreview(m: ChatMessageDto): String {
        val text = if (m.isVoice) "🎤 " + m.attachment?.transcript.orEmpty() else m.content
        return ChatLogic.truncate(text.trim().replace('\n', ' '), 70)
    }

    private fun updateReview(f: (ReviewUi) -> ReviewUi) = _ui.update { s -> s.review?.let { s.copy(review = f(it)) } ?: s }

    fun reviewToggle(i: Int) { app.haptics.tick(); updateReview { it.copy(review = it.review.toggle(i), error = null) } }
    fun reviewEdit(i: Int, card: dev.jeromeswannack.chineselearning.lab.core.ProposedCard) = updateReview { it.copy(review = it.review.edit(i, card)) }
    fun reviewOpenEdit(i: Int?) = updateReview { it.copy(editing = if (it.editing == i) null else i) }
    fun reviewPickDeck(id: String) { app.haptics.tick(); updateReview { it.copy(deckId = id, newDeck = null, error = null) } }
    fun reviewNewDeck(name: String?) = updateReview { it.copy(newDeck = name, error = null) }

    fun closeReview() = _ui.update { it.copy(review = null, sheet = if (it.sheet == ChatSheet.Review) null else it.sheet) }

    /** "Add N cards": the checked cards in one `POST /api/decks/:id/notes/batch`. */
    fun saveReview() {
        val r = _ui.value.review ?: return
        if (r.saving) return
        val chosen = r.review.chosen()
        if (chosen.isEmpty()) return
        val local = r.review.localProblems()
        if (local.isNotEmpty()) {
            app.haptics.wrong()
            updateReview { it.copy(review = it.review.copy(problems = local), editing = local.keys.first(), error = "Fix the marked card first.") }
            return
        }
        if (!app.online.value) { updateReview { it.copy(error = "You're offline — adding cards needs a connection. Your picks stay here.") }; return }
        val newName = r.newDeck?.trim()
        if (r.deckId == null && newName.isNullOrEmpty()) { updateReview { it.copy(error = "Pick a deck (or name a new one).") }; return }
        updateReview { it.copy(saving = true, error = null) }
        viewModelScope.launch {
            try {
                val deckId: String
                val deckName: String
                if (!newName.isNullOrEmpty()) {
                    val d = api.createDeck(newName, null)
                    deckId = d.id
                    deckName = d.name.ifEmpty { newName }
                    updateReview { it.copy(deckId = d.id, newDeck = null) }
                    loadDecks()
                } else {
                    deckId = r.deckId!!
                    deckName = _ui.value.decks.firstOrNull { it.id == deckId }?.name ?: "your deck"
                }
                app.cache.put(LAST_DECK_KEY, KIND, deckId)
                val res = api.addNotesBatch(deckId, chosen.map { noteOf(it.second) })
                val failed = res.failed.associate { it.index to it.error.ifBlank { "Couldn't add this card." } }
                val added = res.created.size
                if (added > 0) {
                    app.haptics.celebrate()
                    app.sounds.play(Sounds.Sfx.MILESTONE, 0.7f)
                }
                val msg = "Added $added card${if (added == 1) "" else "s"} to $deckName ✓"
                if (failed.isEmpty()) {
                    _ui.update { it.copy(review = null, sheet = if (it.sheet == ChatSheet.Review) null else it.sheet, notice = Notice(msg, false)) }
                } else {
                    val next = r.review.afterBatch(chosen.map { it.first }, failed)
                    updateReview { it.copy(review = next, saving = false, editing = next.problems.keys.firstOrNull(), error = (if (added > 0) "$msg " else "") + "${failed.size} couldn't be added — fix and try again.") }
                }
                loadKnown()
                app.scope.launch { runCatching { app.repo.sync() } }
            } catch (e: Exception) {
                updateReview { it.copy(saving = false, error = "Couldn't add the cards. ${e.userMessage()}") }
            }
        }
    }

    // ---- corrections (the tutor) ----

    fun saveCorrection(m: ChatMessageDto, text: String, note: String) {
        val t = text.trim()
        if (t.isEmpty() || _ui.value.correcting != null) return
        if (!app.online.value) { _ui.update { it.copy(modalNotice = Notice("You're offline — corrections need a connection.", true)) }; return }
        _ui.update { it.copy(correcting = m.id, modalNotice = null) }
        viewModelScope.launch {
            try {
                val updated = api.setMessageCorrection(m.id, t, note.trim().ifEmpty { null })
                addMessages(listOf(updated))
                app.haptics.correct()
                app.sounds.play(Sounds.Sfx.POP, 0.5f)
                _ui.update { it.copy(sheet = null) }
            } catch (e: Exception) {
                _ui.update { it.copy(modalNotice = Notice("Couldn't save the correction. ${e.userMessage()}", true)) }
            } finally {
                _ui.update { it.copy(correcting = null) }
            }
        }
    }

    fun removeCorrection(m: ChatMessageDto) {
        _ui.update { it.copy(sheet = null) }
        if (!app.online.value) { error("You're offline — corrections need a connection."); return }
        val before = _ui.value.messages.firstOrNull { it.id == m.id } ?: m
        replaceLocal(m.id) { it.copy(correction = null) }
        app.haptics.tick()
        viewModelScope.launch {
            runCatching { api.clearMessageCorrection(m.id) }.onSuccess { addMessages(listOf(it)) }
                .onFailure { e -> replaceLocal(m.id) { before }; error("Couldn't remove the correction. ${e.userMessage()}") }
        }
    }

    // ---- ✓ Check my Chinese before sending ----

    fun checkDraft() {
        val d = _ui.value.draft.trim()
        if (d.isEmpty() || _ui.value.draftCheck?.loading == true) return
        if (!app.online.value) { error("You're offline — checking needs a connection."); return }
        app.haptics.tick()
        _ui.update { it.copy(draftCheck = DraftCheckUi(d), notice = null) }
        viewModelScope.launch {
            try {
                val r = api.coachDraft(d)
                if (_ui.value.draftCheck?.draft != d) return@launch
                _ui.update { it.copy(draftCheck = DraftCheckUi(d, loading = false, result = r)) }
                if (r.isCorrect) { app.haptics.correct(); app.sounds.play(Sounds.Sfx.CORRECT, 0.5f) } else app.haptics.tick()
            } catch (e: Exception) {
                if (_ui.value.draftCheck?.draft == d) _ui.update { it.copy(draftCheck = DraftCheckUi(d, loading = false, error = "Couldn't check it. ${e.userMessage()}")) }
            }
        }
    }

    /** "Use this": the corrected sentence replaces the draft. */
    fun useCheck() {
        val c = _ui.value.draftCheck?.result?.corrected?.hanzi?.takeIf { it.isNotBlank() } ?: return
        app.haptics.correct()
        _ui.update { it.copy(draft = c, draftCheck = null) }
    }

    fun sendAsIs() {
        _ui.update { it.copy(draftCheck = null) }
        send()
    }

    fun dismissCheck() = _ui.update { it.copy(draftCheck = null) }

    // ---------------- new conversation ----------------

    override fun onCleared() {
        // The last keystrokes are kept even when the chat closes within the debounce.
        if (draftsReady && _ui.value.editing == null) { draftJob?.cancel(); val d = _ui.value.draft; app.scope.launch { saveDraft(app, convId, d) } }
        stopAudio()
        recordJob?.cancel()
        recorder?.cancel()
        super.onCleared()
    }

    companion object {
        const val KIND = "chat"
        const val PINNED_KEY = "chat/pinned-decks"
        const val RECENT_KEY = "chat/recent-emojis"
        /** The voice-message speed chip (1 / 1.5 / 2). */
        const val SPEED_KEY = "chat/voice-speed"
        /** The deck the last "Make flashcards" went to (preselected next time). */
        const val LAST_DECK_KEY = "chat/last-deck"

        fun proposed(c: ProposedCardDto) = dev.jeromeswannack.chineselearning.lab.core.ProposedCard(
            hanzi = c.hanzi, pinyin = c.pinyin, english = c.english, funFacts = c.fun_facts,
            sentenceClue = c.sentence_clue.orEmpty(), sentenceCluePinyin = c.sentence_clue_pinyin.orEmpty(), sentenceClueTranslation = c.sentence_clue_translation.orEmpty(),
            alreadyHave = c.already_have, sourceMessageId = c.source_message_id,
        )

        /** A reviewed card → the content service's note input (blank optional fields left out). */
        fun noteOf(c: dev.jeromeswannack.chineselearning.lab.core.ProposedCard): NewNoteBody {
            val clue = c.sentenceClue.trim().ifEmpty { null }
            return NewNoteBody(
                hanzi = c.hanzi.trim(), pinyin = c.pinyin.trim(), english = c.english.trim(),
                fun_facts = c.funFacts.trim().ifEmpty { null },
                sentence_clue = clue,
                sentence_clue_pinyin = clue?.let { c.sentenceCluePinyin.trim().ifEmpty { null } },
                sentence_clue_translation = clue?.let { c.sentenceClueTranslation.trim().ifEmpty { null } },
            )
        }
        const val CACHE_LIMIT = 300
        /** ScrollRequest id for "the end of the list". */
        const val END = "\u0000end"
        const val RETRY_MS = 5_000L
        const val HIGHLIGHT_MS = 2_500L
        /** Drafts per conversation (round 2 PR 3): JsonCache, the web's chatDrafts rule (newest 50). */
        const val DRAFTS_KEY = "chat/drafts"
        const val DRAFT_SAVE_MS = 400L
        private val draftsLock = kotlinx.coroutines.sync.Mutex()

        suspend fun loadDrafts(app: LabApp): List<ChatDrafts.Draft> =
            app.cache.get<List<ChatDraftDto>>(DRAFTS_KEY).orEmpty().map { ChatDrafts.Draft(it.conversation_id, it.text, it.at) }

        suspend fun saveDraft(app: LabApp, conversationId: String, text: String) = draftsLock.withLock {
            val before = loadDrafts(app)
            val after = ChatDrafts.save(before, conversationId, text, System.currentTimeMillis())
            if (after != before) app.cache.put(DRAFTS_KEY, KIND, after.map { ChatDraftDto(it.conversationId, it.text, it.at) })
        }

        /** `?new=1` / `chat/new`: a fresh untitled conversation; returns its id. */
        suspend fun newConversation(app: LabApp, relId: String): String = app.repo.api.startConversation(relId, PracticeConversationBody()).id
    }
}

/** One kept draft (JsonCache `chat/drafts`, newest first). */
@kotlinx.serialization.Serializable
data class ChatDraftDto(val conversation_id: String, val text: String, val at: Long)

/** The toggles as stored on the phone (JsonCache `chat/<conv>/aids`). */
@kotlinx.serialization.Serializable
data class ChatAidsDto(
    val pinyin_all: Boolean = false,
    val translation_all: Boolean = false,
    val pinyin: List<String> = emptyList(),
    val translation: List<String> = emptyList(),
) {
    fun toAids() = ChatLearning.Aids(pinyin_all, translation_all, pinyin.toSet(), translation.toSet())

    companion object {
        /** At most this many per-message flips are kept (the newest). */
        private const val MAX = 500
        fun of(a: ChatLearning.Aids) = ChatAidsDto(a.pinyinAll, a.translationAll, a.pinyinFlipped.toList().takeLast(MAX), a.translationFlipped.toList().takeLast(MAX))
    }
}
