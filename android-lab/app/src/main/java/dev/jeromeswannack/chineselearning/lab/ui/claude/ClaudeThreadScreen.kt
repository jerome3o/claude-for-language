package dev.jeromeswannack.chineselearning.lab.ui.claude

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.AskClaude
import dev.jeromeswannack.chineselearning.lab.core.CoachAction
import dev.jeromeswannack.chineselearning.lab.core.CoachActions
import dev.jeromeswannack.chineselearning.lab.core.CoachAsk
import dev.jeromeswannack.chineselearning.lab.core.CoachMistakeLesson
import dev.jeromeswannack.chineselearning.lab.core.NoteSearch
import dev.jeromeswannack.chineselearning.lab.core.VoiceDictation
import dev.jeromeswannack.chineselearning.lab.core.claude.ClaudeChats
import dev.jeromeswannack.chineselearning.lab.core.claude.TutorVisibility
import dev.jeromeswannack.chineselearning.lab.data.api.ClaudeContextDto
import dev.jeromeswannack.chineselearning.lab.data.api.ClaudeMessageDto
import dev.jeromeswannack.chineselearning.lab.data.api.CoachConversationDto
import dev.jeromeswannack.chineselearning.lab.data.api.CoachThreadDto
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.ui.chat.DeckChoice
import dev.jeromeswannack.chineselearning.lab.ui.chat.ListeningUi
import dev.jeromeswannack.chineselearning.lab.ui.chat.ReviewActions
import dev.jeromeswannack.chineselearning.lab.ui.chat.ReviewPanel
import dev.jeromeswannack.chineselearning.lab.ui.chat.ReviewUi
import dev.jeromeswannack.chineselearning.lab.ui.chat.chatColors
import dev.jeromeswannack.chineselearning.lab.ui.claudechat.ClaudeChatMsg
import dev.jeromeswannack.chineselearning.lab.ui.claudechat.ClaudeChatThread
import dev.jeromeswannack.chineselearning.lab.ui.claudechat.ClaudeChatThreadActions
import dev.jeromeswannack.chineselearning.lab.ui.coach.CoachChatActions
import dev.jeromeswannack.chineselearning.lab.ui.coach.CoachChatUi
import dev.jeromeswannack.chineselearning.lab.ui.coach.CoachMessageItem
import dev.jeromeswannack.chineselearning.lab.ui.coach.CoachToolResults
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabFooterSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreenFrame
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.ScreenTitle
import dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceDictationUi
import dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceTextFieldContent
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.kit.rememberVoiceDictation
import dev.jeromeswannack.chineselearning.lab.ui.kit.rememberVoiceFirstActions
import dev.jeromeswannack.chineselearning.lab.ui.readers.ReadAloudHandle
import dev.jeromeswannack.chineselearning.lab.ui.study.AddChunkSheet
import dev.jeromeswannack.chineselearning.lab.ui.study.Chunk
import dev.jeromeswannack.chineselearning.lab.ui.study.LanguageToggle
import dev.jeromeswannack.chineselearning.lab.ui.study.ListenToggle
import dev.jeromeswannack.chineselearning.lab.ui.study.SentenceActions
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/** What Claude is doing right now (a live frame with status tool / thinking). */
data class LiveTool(val messageId: String, val status: String, val tool: String?)

/** An extra ⋯ item of a thread in a sheet (the card's "🕘 Earlier about 银行 · 2 chats", "＋ New chat"), first in the menu. */
data class ThreadMenuItem(val label: String, val tag: String, val enabled: Boolean = true, val onClick: () -> Unit)

/** What a Claude thread shows (stateless, so every state renders in screenshot tests). */
data class ClaudeThreadUi(
    /** A fresh thread (`/chats/claude/new`): nothing on the server yet. */
    val isNew: Boolean = false,
    val threadId: String? = null,
    val title: String = "",
    val context: ClaudeContextDto = ClaudeContextDto(),
    val threadReadOnly: Boolean = false,
    /** The thread is on this phone (cached). */
    val hasThread: Boolean = false,
    /** The messages, my queued ones marked ([ClaudeMessageDto.queued]). */
    val messages: List<ClaudeMessageDto> = emptyList(),
    /** My messages the outbox couldn't send: id → why. */
    val queueFailed: Map<String, String> = emptyMap(),
    val loading: Boolean = false,
    val loadError: String? = null,
    val draft: String = "",
    /** My message on its way (shown until the server — or the outbox — has it). */
    val sending: String? = null,
    val sendError: String? = null,
    val language: String = AskClaude.DEFAULT_LANGUAGE,
    val listening: Boolean = false,
    val listen: ListeningUi = ListeningUi(),
    val listenNotice: Pair<String, String>? = null,
    val playingText: String? = null,
    val known: Set<String> = emptySet(),
    val recapCount: Int = 0,
    val online: Boolean = true,
    val liveTool: LiveTool? = null,
    val usedChips: Set<String> = emptySet(),
    /** A card thread: the card has an example sentence (the "Explain sentence" chip). */
    val hasSentence: Boolean = false,
    val retryingId: String? = null,
    val lessonRequesting: Boolean = false,
    val lessonSaving: String? = null,
    val lessonError: String? = null,
    /** "Make flashcards from this chat": Claude is proposing. */
    val proposing: Boolean = false,
    val review: ReviewUi? = null,
    val decks: List<DeckChoice> = emptyList(),
    val notice: String? = null,
    /** A reader / exercise thread: its context's fields on this showing (the chips read them; sent with each question). */
    val fields: dev.jeromeswannack.chineselearning.lab.data.claude.ContextFields? = null,
    /** The chat's own "Share with my tutor" choice (null = the account's) and the account's "Your tutor can see". */
    val tutorVisible: Boolean? = null,
    val shareSetting: String = TutorVisibility.DEFAULT,
    /** ⋯ → Share with my tutor / Hide from my tutor is offered (a learner's own chat, on the server). */
    val canShare: Boolean = false,
    val sharing: Boolean = false,
    /** The tutor's read-only view of her student's chat: his name (null = a learner's own chat). */
    val tutorView: TutorThreadView? = null,
) {
    /** The tutor can read this chat (the learner's view: the quiet "👁 … can read this chat" line). */
    val sharedWithTutor: Boolean get() = TutorVisibility.tutorCanSee(context.kind, tutorVisible, shareSetting)
    val core: ClaudeChats.Context get() = context.core().let { c -> fields?.let { withFields(c, it) } ?: c }
    /** An old practice chat copied in from the tutor-chat tables is read-only; a new role-play is not. */
    val readOnly: Boolean get() = tutorView != null || threadReadOnly || (context.kind == ClaudeChats.PRACTICE && context.conversation_id != null)
    val replyPending: Boolean get() = messages.any { it.role == "assistant" && it.status == "pending" && it.content_type != CoachMistakeLesson.CONTENT_TYPE }
    val busy: Boolean get() = sending != null || replyPending
    val started: Boolean get() = messages.isNotEmpty() || sending != null
    /** The suggestion chips: only before the thread's first message (a role-play's help chips every time); none while Claude answers / in a read-only chat. */
    val chips: List<ClaudeChats.Chip> get() {
        if (readOnly || busy) return emptyList()
        val all = ClaudeChats.chipsFor(core, language, hasSentence = hasSentence)
        val asked = messages.filter { it.role == "user" }.mapTo(HashSet()) { NoteSearch.jsTrim(it.content) }
        val used = usedChips + all.filter { it.question in asked }.map { it.id }
        return ClaudeChats.chipsFor(core, language, hasSentence = hasSentence, started = started, used = used)
    }

    /** The thread as the Coach's screens see it (its result cards). */
    fun coachView(): CoachChatUi = CoachChatUi(
        thread = Loadable(CoachThreadDto(CoachConversationDto(threadId ?: ""), messages.map { it.asCoach() })),
        online = online,
        retrying = retryingId != null,
        lessonRequesting = lessonRequesting,
        lessonSaving = lessonSaving,
        lessonError = lessonError,
    )

    /** What a pending first Coach reply is doing: the first message's intent (a Check / Explain / Translate chat). */
    val coachAction: CoachAction get() =
        CoachAction.of(messages.firstOrNull { it.role == "user" }?.intent?.takeIf { it != "ask" }) ?: CoachActions.conversationAction(null, null)
}

/** The tutor reading one of her student's chats with Claude (`/connections/{relId}/claude/{id}`). */
data class TutorThreadView(val relId: String, val studentName: String?)

class ClaudeThreadActions(
    val onBack: () -> Unit = {},
    /** The sheet variant's close (its grab handle lives in [dev.jeromeswannack.chineselearning.lab.ui.kit.LabTallSheet]). */
    val onClose: () -> Unit = {},
    val onDraft: (String) -> Unit = {},
    /** text, spoken, intent (ask | check | explain | translate), the chip it came from. */
    val onSend: (String, Boolean, String, String?) -> Unit = { _, _, _, _ -> },
    val onLanguage: (String) -> Unit = {},
    val onListening: (Boolean) -> Unit = {},
    /** The header's context chip (card → its hub, a chat message → that chat). */
    val onContext: (ClaudeChats.Link) -> Unit = {},
    val onMakeCards: () -> Unit = {},
    val onRecap: () -> Unit = {},
    val onRetryLoad: () -> Unit = {},
    val thread: ClaudeChatThreadActions = ClaudeChatThreadActions(),
    val review: ReviewActions = ReviewActions(),
    /** The Coach's result cards: 🎯 mini lesson, Retry, add a word as a card. */
    val coach: CoachChatActions = CoachChatActions(),
    val cards: SentenceActions = SentenceActions(),
    /** "Open in Coach" from a bubble (menu | chip | sheet): my Chinese checked there, Claude's explained. */
    val onOpenCoach: ((ClaudeChatMsg, String) -> Unit)? = null,
    /** ⋯ → Share with my tutor / Hide from my tutor. */
    val onShare: () -> Unit = {},
)

object ClaudeThreadTags {
    const val SCREEN = "claude-thread"
    const val TITLE = "claude-thread-title"
    const val CONTEXT_CHIP = "claude-thread-context-chip"
    const val EMPTY = "claude-thread-empty"
    const val READ_ONLY = "claude-thread-readonly"
    const val OFFLINE = "claude-thread-offline"
    const val LOAD_ERROR = "claude-thread-load-error"
    const val CHIPS = "claude-thread-chips"
    const val SENDING = "claude-thread-sending"
    const val ERROR = "claude-thread-error"
    const val COMPOSER = "claude-thread-composer"
    const val LIST = "claude-thread-list"
    const val INTENTS = "claude-composer-intents"
    const val MORE = "claude-thread-more"
    const val CLOSE = "claude-thread-close"
    const val MENU = "claude-thread-menu"
    const val MAKE_CARDS = "claude-thread-make-cards"
    const val RECAP = "claude-thread-recap"
    const val CLOSED = "claude-thread-closed"
    const val ROLES = "claude-thread-roles"
    const val SHARE = "claude-thread-share"
    const val SHARED = "claude-thread-shared"
    fun chip(id: String) = "claude-thread-chip-$id"
    fun intent(id: String) = "claude-composer-$id"
}

/**
 * One Claude thread, whatever its context (`/chats/claude/{id}`; the web's
 * components/claude/ClaudeThreadView.tsx, docs/CHAT.md "Claude thread view"): a plain chat
 * (`general` — the Coach's "💬 Ask Claude", a `/coach?text=&action=` link), Ask Claude on a card,
 * Discuss with Claude about a chat message, or a role-play (practice — Claude plays someone; the old
 * copied practice chats are read-only).
 *
 * - Header: ← (the page), the title, 🎧, 中文 | EN, ⋯ ([menuItems] first, then Make flashcards from
 *   this chat, 📝 words to recap); on the page, under it the context chip ("📇 Asked on card · 银行" →
 *   the card hub, "💬 From a chat message" → that chat, "🎭 Practice · 点菜" + a read-only banner) and
 *   "👁 Your tutor can read this chat". The [sheet] variant is compact (Jerome, Nov 2026): one tight
 *   header row, no ✕ (the sheet's grab handle / back / the scrim close it), no context chip, no
 *   tutor line, the thread nearly edge to edge.
 * - The thread ([ClaudeChatThread]): word chips → explorer, ▶, 拼 / EN, 🎧, 🎤 Read it back; a reply
 *   STREAMS in; the Coach's result cards ([CoachMessageItem]); tool results as chips.
 * - Suggestion chips ([ClaudeChats.chipsFor]) above the composer only before the first message.
 * - The composer ([ClaudeChats.composerFor]): a new general chat offers Ask + ✏️ Check / 🔍 Explain or
 *   🔤 Translate; everything else Ask only. Offline, a message waits in the outbox and shows at once.
 */
@Composable
fun ClaudeThreadScreen(
    ui: ClaudeThreadUi,
    actions: ClaudeThreadActions,
    sheet: Boolean = false,
    voicePreview: VoiceDictationUi? = null,
    readBackPreview: Map<String, ReadAloudHandle> = emptyMap(),
    menuPreview: Boolean = false,
    /** Under the header (the card sheet's list of earlier chats, Discuss's quoted message). */
    headerExtra: (@Composable () -> Unit)? = null,
    /** Extra ⋯ items, first (the card sheet's Earlier / ＋ New chat). */
    menuItems: List<ThreadMenuItem> = emptyList(),
    /** A finished reply's tool results, drawn by the caller (default: the Coach's chips). */
    toolResults: (@Composable (ClaudeMessageDto) -> Unit)? = null,
    /** No composer, this line instead (the card was deleted). */
    closedNote: String? = null,
    /**
     * The Claude tab (`/claude`): 🎤 starts at once, ready for any question — once per screen; the
     * microphone permission is asked the first time, and offline / no microphone / refused fall back
     * to typing with the box's reason. ✏️ Type stays one tap away.
     */
    autoListen: Boolean = false,
    /** ← is hidden (a tab's root has nowhere to go back to). */
    showBack: Boolean = true,
    /** [autoListen] ran: true = 🎤 started, false = it stayed on typing (offline, no microphone). */
    onAutoListen: (Boolean) -> Unit = {},
) {
    val listState = rememberLazyListState()
    var menu by remember { mutableStateOf(menuPreview) }
    var adding by remember { mutableStateOf<Chunk?>(null) }
    val voiceLang = if (ui.language == AskClaude.ZH) "zh" else "en"
    val voice = androidx.compose.runtime.key(voiceLang) { rememberVoiceDictation("claude_thread", voiceLang) }
    val liveVoice by voice.ui.collectAsState()
    val voiceUi = voicePreview ?: liveVoice
    val voiceActions = rememberVoiceFirstActions(voice, ui.draft, onFill = actions.onDraft) { a ->
        actions.onDraft(a.text)
        actions.onSend(a.text, a.source == "spoken", "ask", null)
    }
    var autoListened by androidx.compose.runtime.saveable.rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(autoListen, voice) {
        if (!autoListen || autoListened || voicePreview != null) return@LaunchedEffect
        autoListened = true
        val v = voice.ui.value
        val listening = v.state.mode == VoiceDictation.VOICE && v.phase == "idle" && v.blocked == null
        if (listening) voiceActions.say()
        onAutoListen(listening)
    }
    // A spoken message that failed to send: into the box (typing) so it can be fixed or sent again.
    LaunchedEffect(ui.sendError) {
        if (ui.sendError != null && ui.draft.isNotBlank() && liveVoice.state.mode == VoiceDictation.VOICE && liveVoice.phase == "idle") voice.type()
    }
    // Follow the end of the thread only while the reader is at it, and after my own new message
    // (ThreadScroll). The whole conversation is ONE lazy item ("thread"), so the old
    // animateScrollToItem(last item) put the TOP of the conversation on screen on every poll that
    // grew the reply (Jerome, Nov 2026: "it scrolls me back up to the top immediately").
    val mine = ui.messages.count { it.role == "user" } + (if (ui.sending != null) 1 else 0)
    FollowThreadEnd(listState, mine)
    val thinking = if (ui.language == AskClaude.ZH) CoachAsk.THINKING_ZH else CoachAsk.THINKING_EN
    val chip = ClaudeChats.headerChipFor(ui.core)
    val general = ui.context.kind == ClaudeChats.GENERAL
    val title = ui.title.ifBlank {
        when {
            general -> CoachAsk.LABEL
            ui.context.kind == ClaudeChats.CARD && !ui.context.label.isNullOrBlank() -> "Ask about ${ui.context.label}"
            ui.context.kind == ClaudeChats.READER -> "Ask about this page"
            ui.context.kind == ClaudeChats.EXERCISE -> "Ask about this exercise"
            else -> chip?.text ?: CoachAsk.LABEL
        }
    }
    val coachUi = ui.coachView()
    val firstAnalysisId = ui.messages.firstOrNull { it.content_type == "analysis" && it.status == null }?.id
    val chatMessages = ui.messages.map { m ->
        ClaudeChatMsg(
            m.id, m.role, m.content, m.answer_lang, m.status, m.error ?: ui.queueFailed[m.id], m.translation,
            contentType = m.content_type, streaming = m.streaming, queued = m.queued, queueFailed = m.id in ui.queueFailed, autoCheck = m.auto_check,
        )
    }
    val threadActions = ClaudeChatThreadActions(
        onWord = actions.thread.onWord, translate = actions.thread.translate, retry = actions.thread.retry, play = actions.thread.play,
        listen = actions.thread.listen, reveal = actions.thread.reveal, toggleSlow = actions.thread.toggleSlow, audioBusy = actions.thread.audioBusy,
        onReadBackWords = actions.thread.onReadBackWords, stopAudio = actions.thread.stopAudio, track = actions.thread.track,
        statusLine = { m -> ui.liveTool?.takeIf { it.messageId == m.id }?.let { ClaudeChats.turnStatusLine(it.status, it.tool, ui.language) } },
        onDiscardQueued = actions.thread.onDiscardQueued,
        cards = actions.cards,
        openCoach = actions.onOpenCoach,
        onAskWhy = { q -> actions.onDraft(q); voice.type() },
        language = ui.language,
        online = ui.online,
    )
    val offlineNoCache = !ui.isNew && !ui.hasThread && !ui.loading && ui.loadError != null
    val empty = ui.messages.isEmpty() && ui.sending == null

    val headerTitle = "${if (general) CoachAsk.ICON + " " else ""}$title"
    val headerActions: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit = {
        if (ui.tutorView == null) {
            ListenToggle(ui.listening, actions.onListening)
            Spacer(Modifier.width(4.dp))
            LanguageToggle(ui.language, actions.onLanguage)
            HeaderButton("⋯", enabled = ui.threadId != null || menuItems.isNotEmpty(), tag = ClaudeThreadTags.MORE) { menu = true }
        }
    }
    ThreadFrame(sheet) {
        Column(Modifier.fillMaxSize()) {
            if (sheet) SheetHeader(headerTitle, headerActions)
            else ScreenTitle(headerTitle, onBack = if (showBack) actions.onBack else null, actions = headerActions)
            // The tutor: only the card chip leads somewhere (her view of the student's card). The sheet
            // is open over what it is about: no chip saying so.
            if (!sheet) chip?.let { c -> if (ui.tutorView != null && c.link?.kind != ClaudeChats.CARD) ContextChip(c.copy(link = null), actions.onContext) else ContextChip(c, actions.onContext) }
            if (!sheet && ui.canShare && ui.sharedWithTutor) {
                Text(
                    TutorVisibility.sharedLine(ui.context.kind, ui.tutorVisible, ui.shareSetting),
                    color = Lab.colors.muted, fontSize = 13.sp,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp).testTag(ClaudeThreadTags.SHARED),
                )
            }
            if (ui.context.kind == ClaudeChats.PRACTICE) PracticeRoles(ui.context.ai_role, ui.context.user_role)
            headerExtra?.invoke()
            LazyColumn(
                Modifier.weight(1f).fillMaxWidth().testTag(ClaudeThreadTags.LIST), state = listState,
                contentPadding = if (sheet) PaddingValues(horizontal = 10.dp, vertical = 8.dp) else PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (!ui.online && ui.hasThread) item("offline") {
                    Text(
                        "You're offline — this is the copy on this phone. New messages send when you're back.",
                        color = Lab.colors.muted, fontSize = 13.sp, modifier = Modifier.testTag(ClaudeThreadTags.OFFLINE),
                    )
                }
                if (ui.readOnly && ui.hasThread) item("read-only") {
                    Text(
                        ui.tutorView?.let { TutorVisibility.tutorReadOnlyLine(it.studentName) } ?: ClaudeChats.PRACTICE_READ_ONLY_NOTE,
                        color = Lab.colors.muted, fontSize = 14.sp,
                        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Lab.colors.faint)
                            .border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(12.dp)).padding(12.dp).testTag(ClaudeThreadTags.READ_ONLY),
                    )
                }
                if (empty) item("empty") {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        when {
                            ui.loading -> Text("Loading…", color = Lab.colors.muted)
                            offlineNoCache -> InlineNotice(
                                ui.loadError ?: "",
                                modifier = Modifier.testTag(ClaudeThreadTags.LOAD_ERROR),
                                kind = if (ui.online) NoticeKind.Error else NoticeKind.Offline,
                                actionLabel = "Retry", onAction = actions.onRetryLoad,
                            )
                            general -> Column(Modifier.testTag(ClaudeThreadTags.EMPTY), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                Text("${CoachAsk.ICON} ${CoachAsk.LABEL}", style = MaterialTheme.typography.titleLarge, color = Lab.colors.ink)
                                Text(if (ui.language == AskClaude.ZH) CoachAsk.HINT else CoachAsk.EMPTY_EN, color = Lab.colors.muted)
                                Text("Write a sentence and ✏️ Check it, 🔍 Explain one, or just ask. Under each answer: ▶ listen · 拼 pinyin · EN · 🎤 read it back.", color = Lab.colors.muted, style = MaterialTheme.typography.bodySmall)
                            }
                            ui.context.kind == ClaudeChats.CARD -> Text(
                                when {
                                    ui.listening -> "🎧 Listen first: Claude’s Chinese answers arrive hidden and play by themselves. Tap to hear again · hold to reveal."
                                    ui.language == AskClaude.ZH -> "Claude answers in simple Chinese. Tap any word to look it up · hold a message to translate it. Ask anything about this card — or tap a suggestion below."
                                    else -> "Ask Claude anything about this card — or tap a suggestion below."
                                },
                                color = Lab.colors.muted, modifier = Modifier.testTag(ClaudeThreadTags.EMPTY),
                            )
                            ui.context.kind == ClaudeChats.READER -> Text(
                                "Ask Claude about this page — what a sentence means, a word, the grammar — or tap a suggestion below. Claude can see the page and the words you looked up.",
                                color = Lab.colors.muted, modifier = Modifier.testTag(ClaudeThreadTags.EMPTY),
                            )
                            ui.context.kind == ClaudeChats.EXERCISE -> Text(
                                "Ask Claude about this exercise — why the answer is what it is, another example, one more to try — or tap a suggestion below.",
                                color = Lab.colors.muted, modifier = Modifier.testTag(ClaudeThreadTags.EMPTY),
                            )
                            ui.context.kind == ClaudeChats.PRACTICE -> Text(
                                "Claude is setting the scene… Answer in Chinese. Stuck? 💡 a hint, 🆘 how to say something, ✏️ a correction.",
                                color = Lab.colors.muted, modifier = Modifier.testTag(ClaudeThreadTags.EMPTY),
                            )
                            else -> Text("Ask Claude anything about it — tap a suggestion below to start.", color = Lab.colors.muted, modifier = Modifier.testTag(ClaudeThreadTags.EMPTY))
                        }
                    }
                }
                item("thread") {
                    ClaudeChatThread(
                        chatMessages, ui.listening, ui.listen, ui.listenNotice, ui.playingText, thinking, ui.known, threadActions,
                        readBackPreview = readBackPreview,
                        special = { m ->
                            ui.messages.firstOrNull { it.id == m.id }?.let { row ->
                                CoachMessageItem(row.asCoach(), coachUi, actions.coach, ui.coachAction, isFirstAnalysis = row.id == firstAnalysisId) { adding = it }
                            }
                        },
                        after = { m ->
                            val row = ui.messages.firstOrNull { it.id == m.id }
                            val raw = row?.tool_results
                            if (row != null && toolResults != null) toolResults(row)
                            else if (!raw.isNullOrBlank()) Column { CoachToolResults(raw) }
                        },
                    )
                }
                ui.sending?.takeIf { s -> ui.messages.none { it.role == "user" && it.queued && it.content == s } }?.let { s ->
                    item("sending") {
                        Column(verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.testTag(ClaudeThreadTags.SENDING)) {
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                                Text(s, color = Color.White, fontSize = 17.sp, modifier = Modifier.widthIn(max = 320.dp).clip(RoundedCornerShape(18.dp)).background(chatColors().mine.copy(alpha = 0.7f)).padding(horizontal = 14.dp, vertical = 9.dp))
                            }
                            ClaudeChatThread(listOf(ClaudeChatMsg("sending-reply", "assistant", "", status = "pending")), false, ListeningUi(), null, null, "…", emptySet(), ClaudeChatThreadActions())
                        }
                    }
                }
                ui.sendError?.takeIf { !ui.busy }?.let { item("err") { InlineNotice(it, modifier = Modifier.testTag(ClaudeThreadTags.ERROR), kind = if (!ui.online) NoticeKind.Offline else NoticeKind.Error) } }
                ui.lessonError?.let { item("lesson-err") { InlineNotice(it, kind = if (!ui.online) NoticeKind.Offline else NoticeKind.Error) } }
                ui.notice?.let { item("notice") { InlineNotice(it, kind = NoticeKind.Success) } }
                if (ui.proposing) item("proposing") { Text("Claude is reading this chat…", color = Lab.colors.muted) }
            }
            closedNote?.let {
                Text(it, color = Lab.colors.muted, fontSize = 14.sp, modifier = Modifier.fillMaxWidth().padding(16.dp).testTag(ClaudeThreadTags.CLOSED))
            }
            if (!ui.readOnly && closedNote == null) {
                Column(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp)).background(Lab.colors.card)
                        .border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp))
                        .padding(horizontal = if (sheet) 10.dp else 12.dp, vertical = if (sheet) 8.dp else 12.dp)
                        .testTag(ClaudeThreadTags.COMPOSER),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    val chips = ui.chips
                    if (chips.isNotEmpty()) {
                        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).testTag(ClaudeThreadTags.CHIPS), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            for (c in chips) SuggestionChip(c.label, ClaudeThreadTags.chip(c.id)) {
                                // 🆘 How do I say…: into the box, to be finished.
                                if (c.fill) {
                                    actions.onDraft(c.question)
                                    voice.type()
                                } else actions.onSend(c.question, false, "ask", c.id)
                            }
                        }
                    }
                    VoiceTextFieldContent(
                        ui = voiceUi,
                        value = ui.draft,
                        onValueChange = actions.onDraft,
                        actions = voiceActions,
                        submitLabel = if (ui.busy) "…" else "Send",
                        placeholder = if (ui.language == AskClaude.ZH) CoachAsk.PLACEHOLDER_ZH else CoachAsk.PLACEHOLDER_EN,
                        multiline = true,
                        lang = voiceLang,
                        enabled = !ui.busy,
                        compact = true,
                        sendInRow = true,
                    )
                    // What a Check / Explain / Translate button would send: the take under review, else the box.
                    val current = NoteSearch.jsTrim(if (voiceUi.state.mode == VoiceDictation.VOICE) voiceUi.finalText.ifEmpty { ui.draft } else ui.draft)
                    val composer = ClaudeChats.composerFor(ui.context.kind, current, ui.started)
                    val others = composer.intents.filter { it != "ask" }
                    if (others.isNotEmpty()) {
                        Row(Modifier.fillMaxWidth().testTag(ClaudeThreadTags.INTENTS), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            for (intent in others) {
                                val enabled = composer.enabled && !ui.busy && current.isNotEmpty()
                                IntentButton(ClaudeChats.INTENT_LABELS.getValue(intent), enabled, ClaudeThreadTags.intent(intent), Modifier.weight(1f)) {
                                    actions.onDraft(current)
                                    actions.onSend(current, voiceUi.state.mode == VoiceDictation.VOICE && voiceUi.finalText.isNotEmpty(), intent, null)
                                }
                            }
                        }
                    }
                    composer.hint?.takeIf { current.isNotEmpty() }?.let { Text(it, fontSize = 13.sp, color = Lab.colors.muted) }
                }
            }
        }
    }
    if (menu) {
        LabBottomSheet(onDismiss = { menu = false }) {
            Column(Modifier.fillMaxWidth().testTag(ClaudeThreadTags.MENU)) {
                for (item in menuItems) {
                    MenuRow(item.label, enabled = item.enabled, tag = item.tag) {
                        menu = false
                        item.onClick()
                    }
                }
                val hasClaude = ui.messages.any { it.role == "assistant" && it.status == null && it.content_type == "text" }
                MenuRow("🃏 Make flashcards from this chat", enabled = hasClaude && ui.online, tag = ClaudeThreadTags.MAKE_CARDS) {
                    menu = false
                    actions.onMakeCards()
                }
                if (ui.canShare) {
                    MenuRow(TutorVisibility.shareMenuLabel(ui.context.kind, ui.tutorVisible, ui.shareSetting), enabled = ui.online && !ui.sharing, tag = ClaudeThreadTags.SHARE) {
                        menu = false
                        actions.onShare()
                    }
                }
                if (ui.recapCount > 0 && ui.threadId != null) {
                    MenuRow(CoachAsk.recapCountLabel(ui.recapCount), enabled = true, tag = ClaudeThreadTags.RECAP) {
                        menu = false
                        actions.onRecap()
                    }
                }
            }
        }
    }
    ui.review?.let { r ->
        LabFooterSheet(onDismiss = actions.review.onClose) { ReviewPanel(r, ui.decks, ui.online, actions.review) }
    }
    adding?.let { c ->
        AddChunkSheet(
            c, preferredDeck = "", actions.cards, onDismiss = { adding = null },
            bumpSource = "coach", bump = actions.coach.bump ?: dev.jeromeswannack.chineselearning.lab.ui.bumps.rememberBumpHanzi("coach"),
        )
    }
}

/** The page: the usual screen frame (system bar insets); the sheet: just the sheet's own colour. */
@Composable
private fun ThreadFrame(sheet: Boolean, content: @Composable () -> Unit) {
    if (!sheet) return LabScreenFrame(Modifier.testTag(ClaudeThreadTags.SCREEN), content)
    Box(Modifier.fillMaxSize().background(Lab.colors.card).testTag(ClaudeThreadTags.SCREEN)) { content() }
}

/** The sheet's one compact header row: title (ellipsis) · 🎧 · 中文 | EN · ⋯ — no ✕, no big top padding. */
@Composable
private fun SheetHeader(title: String, actions: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(start = 16.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(
            title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink,
            maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f).testTag(ClaudeThreadTags.TITLE),
        )
        actions()
    }
}

@Composable
private fun HeaderButton(label: String, enabled: Boolean, tag: String, onClick: () -> Unit) {
    Text(
        label, fontSize = 22.sp, color = Lab.colors.ink,
        modifier = Modifier.heightIn(min = 44.dp).clip(RoundedCornerShape(12.dp)).alpha(if (enabled) 1f else 0.4f)
            .clickable(enabled = enabled, onClick = onClick).padding(horizontal = 12.dp, vertical = 8.dp).testTag(tag),
    )
}

/** "📇 Asked on card · 银行 ›" — orange outline (Claude's colour in the Chats tab), tappable when it leads somewhere. */
/** A role-play: who Claude plays and who he is, under the context chip. */
@Composable
private fun PracticeRoles(aiRole: String?, userRole: String?) {
    val parts = listOfNotNull(aiRole?.takeIf { it.isNotBlank() }?.let { "✦ Claude plays $it" }, userRole?.takeIf { it.isNotBlank() }?.let { "You: $it" })
    if (parts.isEmpty()) return
    Text(
        parts.joinToString(" · "),
        color = Lab.colors.muted, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 6.dp).testTag(ClaudeThreadTags.ROLES),
    )
}

@Composable
private fun ContextChip(c: ClaudeChats.HeaderChip, onOpen: (ClaudeChats.Link) -> Unit) {
    val orange = Color(0xFFD97706)
    val link = c.link
    Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 8.dp)) {
        Row(
            Modifier.heightIn(min = 40.dp).clip(RoundedCornerShape(50)).background(orange.copy(alpha = 0.08f)).border(1.dp, orange, RoundedCornerShape(50))
                .then(if (link != null) Modifier.bouncyClickable(pressedScale = 0.96f, role = Role.Button) { onOpen(link) } else Modifier)
                .padding(horizontal = 14.dp).testTag(ClaudeThreadTags.CONTEXT_CHIP),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("${c.icon} ${c.text}", color = Lab.colors.ink, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
            if (link != null) Text(" ›", color = Lab.colors.muted, fontSize = 15.sp)
        }
    }
}

@Composable
private fun SuggestionChip(label: String, tag: String, onClick: () -> Unit) {
    Box(
        Modifier.heightIn(min = 44.dp).clip(RoundedCornerShape(50)).background(Lab.colors.faint).border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(50))
            .bouncyClickable(pressedScale = 0.95f, role = Role.Button, onClick = onClick).padding(horizontal = 14.dp).testTag(tag),
        contentAlignment = Alignment.Center,
    ) { Text(label, color = Lab.colors.ink, fontSize = 14.sp, maxLines = 1) }
}

@Composable
private fun IntentButton(label: String, enabled: Boolean, tag: String, modifier: Modifier, onClick: () -> Unit) {
    val shape = RoundedCornerShape(20.dp)
    Box(
        modifier.heightIn(min = 48.dp).clip(shape).border(1.5.dp, Lab.colors.accent.copy(alpha = 0.5f), shape).alpha(if (enabled) 1f else 0.45f)
            .bouncyClickable(enabled, 0.95f, onClick = onClick).padding(horizontal = 10.dp).testTag(tag),
        contentAlignment = Alignment.Center,
    ) { Text(label, color = Lab.colors.accent, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, maxLines = 1) }
}

@Composable
private fun MenuRow(label: String, enabled: Boolean, tag: String, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 52.dp).clickable(enabled = enabled, onClick = onClick).alpha(if (enabled) 1f else 0.55f)
            .padding(horizontal = 20.dp).testTag(tag),
        verticalAlignment = Alignment.CenterVertically,
    ) { Text(label, color = Lab.colors.ink, fontSize = 16.sp, modifier = Modifier.weight(1f)) }
}

/**
 * A reader / exercise thread's context with the fields of this showing (the web's chips read
 * `{ ...ctx, ...contextFields }`): a page's looked-up / misread words, an exercise's answer + verdict.
 */
internal fun withFields(c: ClaudeChats.Context, f: dev.jeromeswannack.chineselearning.lab.data.claude.ContextFields): ClaudeChats.Context {
    fun words(e: kotlinx.serialization.json.JsonElement?, keep: List<String>): List<String> = when (e) {
        null -> keep
        is kotlinx.serialization.json.JsonArray -> e.mapNotNull { (it as? kotlinx.serialization.json.JsonPrimitive)?.takeIf { p -> p.isString }?.content }
        else -> emptyList()
    }
    return when (c.kind) {
        ClaudeChats.READER -> c.copy(lookedUp = words(f.lookedUp, c.lookedUp), saidWrong = words(f.saidWrong, c.saidWrong))
        ClaudeChats.EXERCISE -> {
            val a = f.answer ?: return c
            val obj = a as? kotlinx.serialization.json.JsonObject
            c.copy(hasAnswer = obj != null, answerVerdict = (obj?.get("verdict") as? kotlinx.serialization.json.JsonPrimitive)?.takeIf { it.isString }?.content)
        }
        else -> c
    }
}

/**
 * Keeps a thread's end on screen while the reader is there — a reply streaming in (live frames or
 * the poll), a check card growing as it lays out, the keyboard opening — and never moves it once they
 * have scrolled away themselves; [mine] going up (my own new message) brings it back to the end.
 * Only a finger moves [stick]: our own scrolls are ignored while they run (a programmatic scroll
 * reports "in progress" before the list has measured the new position).
 */
@Composable
internal fun FollowThreadEnd(listState: androidx.compose.foundation.lazy.LazyListState, mine: Int) {
    val follow = remember(listState) { ThreadScroll() }
    LaunchedEffect(listState) {
        androidx.compose.runtime.snapshotFlow { listState.isScrollInProgress to !listState.canScrollForward }
            .collect { (scrolling, atEnd) -> if (scrolling && !follow.auto) follow.stick = atEnd }
    }
    var lastMine by remember(listState) { mutableStateOf(mine) }
    LaunchedEffect(mine) {
        if (mine > lastMine) follow.stick = true
        lastMine = mine
    }
    LaunchedEffect(listState) {
        androidx.compose.runtime.snapshotFlow {
            val info = listState.layoutInfo
            Triple(info.totalItemsCount, info.visibleItemsInfo.lastOrNull()?.let { it.index to it.offset + it.size }, info.viewportEndOffset to follow.stickVersion)
        }.collect {
            if (follow.stick && !listState.isScrollInProgress && listState.canScrollForward) {
                follow.auto = true
                try {
                    // Past the last item's end: the list stops at its very bottom.
                    listState.scrollToItem((listState.layoutInfo.totalItemsCount - 1).coerceAtLeast(0), Int.MAX_VALUE / 2)
                    androidx.compose.runtime.withFrameNanos { }
                } finally {
                    follow.auto = false
                }
            }
        }
    }
}

/** [FollowThreadEnd]'s state: [stick] = follow the end; [auto] = our own scroll is running. */
internal class ThreadScroll {
    private val _stick = mutableStateOf(true)
    var stickVersion by mutableStateOf(0)
        private set
    var stick: Boolean
        get() = _stick.value
        set(v) {
            if (v && !_stick.value) stickVersion++
            _stick.value = v
        }
    var auto = false
}
