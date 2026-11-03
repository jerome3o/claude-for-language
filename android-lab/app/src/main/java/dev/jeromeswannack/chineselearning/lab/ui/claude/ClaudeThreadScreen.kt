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
) {
    val core: ClaudeChats.Context get() = context.core()
    val readOnly: Boolean get() = context.kind == ClaudeChats.PRACTICE || threadReadOnly
    val replyPending: Boolean get() = messages.any { it.role == "assistant" && it.status == "pending" && it.content_type != CoachMistakeLesson.CONTENT_TYPE }
    val busy: Boolean get() = sending != null || replyPending
    val started: Boolean get() = messages.isNotEmpty() || sending != null
    val replies: Int get() = messages.count { it.role == "assistant" && it.status == null }

    /** The suggestion chips (none while Claude answers / in a read-only chat); a chip already asked is used. */
    val chips: List<ClaudeChats.Chip> get() {
        if (readOnly || busy) return emptyList()
        val all = ClaudeChats.chipsFor(core, language, hasSentence = hasSentence)
        val asked = messages.filter { it.role == "user" }.mapTo(HashSet()) { NoteSearch.jsTrim(it.content) }
        val used = usedChips + all.filter { it.question in asked }.map { it.id }
        return ClaudeChats.chipsFor(core, language, hasSentence = hasSentence, replies = replies, used = used)
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

class ClaudeThreadActions(
    val onBack: () -> Unit = {},
    /** The sheet variant's ✕. */
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
    const val INTENTS = "claude-composer-intents"
    const val MORE = "claude-thread-more"
    const val CLOSE = "claude-thread-close"
    const val MENU = "claude-thread-menu"
    const val MAKE_CARDS = "claude-thread-make-cards"
    const val RECAP = "claude-thread-recap"
    fun chip(id: String) = "claude-thread-chip-$id"
    fun intent(id: String) = "claude-composer-$id"
}

/**
 * One Claude thread, whatever its context (`/chats/claude/{id}`; the web's
 * components/claude/ClaudeThreadView.tsx, docs/CHAT.md "Claude thread view"): a plain chat
 * (`general` — the Coach's "💬 Ask Claude", a `/coach?text=&action=` link), Ask Claude on a card,
 * Discuss with Claude about a chat message, or a practice chat (read-only for now).
 *
 * - Header: ← (or ✕ in the [sheet] variant), the title, 🎧, 中文 | EN, ⋯ (Make flashcards from this
 *   chat, 📝 words to recap); under it the context chip ("📇 Asked on card · 银行" → the card hub,
 *   "💬 From a chat message" → that chat, "🎭 Practice · 点菜" + a read-only banner).
 * - The thread ([ClaudeChatThread]): word chips → explorer, ▶, 拼 / EN, 🎧, 🎤 Read it back; a reply
 *   STREAMS in; the Coach's result cards ([CoachMessageItem]); tool results as chips.
 * - Suggestion chips ([ClaudeChats.chipsFor]) above the composer while empty and after each reply (≤ 3).
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
    // A spoken message that failed to send: into the box (typing) so it can be fixed or sent again.
    LaunchedEffect(ui.sendError) {
        if (ui.sendError != null && ui.draft.isNotBlank() && liveVoice.state.mode == VoiceDictation.VOICE && liveVoice.phase == "idle") voice.type()
    }
    val lastLen = ui.messages.lastOrNull()?.content?.length ?: 0
    val count = ui.messages.size + (if (ui.sending != null) 2 else 0)
    LaunchedEffect(count, lastLen) { if (count > 1) listState.animateScrollToItem(maxOf(0, listState.layoutInfo.totalItemsCount - 1)) }
    val thinking = if (ui.language == AskClaude.ZH) CoachAsk.THINKING_ZH else CoachAsk.THINKING_EN
    val chip = ClaudeChats.headerChipFor(ui.core)
    val general = ui.context.kind == ClaudeChats.GENERAL
    val title = ui.title.ifBlank { if (general) CoachAsk.LABEL else chip?.text ?: CoachAsk.LABEL }
    val coachUi = ui.coachView()
    val firstAnalysisId = ui.messages.firstOrNull { it.content_type == "analysis" && it.status == null }?.id
    val chatMessages = ui.messages.map { m ->
        ClaudeChatMsg(
            m.id, m.role, m.content, m.answer_lang, m.status, m.error ?: ui.queueFailed[m.id], m.translation,
            contentType = m.content_type, streaming = m.streaming, queued = m.queued, queueFailed = m.id in ui.queueFailed,
        )
    }
    val threadActions = ClaudeChatThreadActions(
        onWord = actions.thread.onWord, translate = actions.thread.translate, retry = actions.thread.retry, play = actions.thread.play,
        listen = actions.thread.listen, reveal = actions.thread.reveal, toggleSlow = actions.thread.toggleSlow, audioBusy = actions.thread.audioBusy,
        onReadBackWords = actions.thread.onReadBackWords, stopAudio = actions.thread.stopAudio, track = actions.thread.track,
        statusLine = { m -> ui.liveTool?.takeIf { it.messageId == m.id }?.let { ClaudeChats.turnStatusLine(it.status, it.tool, ui.language) } },
        onDiscardQueued = actions.thread.onDiscardQueued,
    )
    val offlineNoCache = !ui.isNew && !ui.hasThread && !ui.loading && ui.loadError != null
    val empty = ui.messages.isEmpty() && ui.sending == null

    LabScreenFrame(Modifier.testTag(ClaudeThreadTags.SCREEN)) {
        Column(Modifier.fillMaxSize()) {
            ScreenTitle("${if (general) CoachAsk.ICON + " " else ""}$title", onBack = if (sheet) null else actions.onBack) {
                ListenToggle(ui.listening, actions.onListening)
                Spacer(Modifier.width(4.dp))
                LanguageToggle(ui.language, actions.onLanguage)
                HeaderButton("⋯", enabled = ui.threadId != null, tag = ClaudeThreadTags.MORE) { menu = true }
                if (sheet) HeaderButton("✕", enabled = true, tag = ClaudeThreadTags.CLOSE, onClick = actions.onClose)
            }
            chip?.let { c -> ContextChip(c, actions.onContext) }
            LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = listState, contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (!ui.online && ui.hasThread) item("offline") {
                    Text(
                        "You're offline — this is the copy on this phone. New messages send when you're back.",
                        color = Lab.colors.muted, fontSize = 13.sp, modifier = Modifier.testTag(ClaudeThreadTags.OFFLINE),
                    )
                }
                if (ui.readOnly && ui.hasThread) item("read-only") {
                    Text(
                        ClaudeChats.PRACTICE_READ_ONLY_NOTE,
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
                            val raw = ui.messages.firstOrNull { it.id == m.id }?.tool_results
                            if (!raw.isNullOrBlank()) Column { CoachToolResults(raw) }
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
            if (!ui.readOnly) {
                Column(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp)).background(Lab.colors.card)
                        .border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp)).padding(12.dp)
                        .testTag(ClaudeThreadTags.COMPOSER),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    val chips = ui.chips
                    if (chips.isNotEmpty()) {
                        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).testTag(ClaudeThreadTags.CHIPS), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            for (c in chips) SuggestionChip(c.label, ClaudeThreadTags.chip(c.id)) { actions.onSend(c.question, false, "ask", c.id) }
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
                val hasClaude = ui.messages.any { it.role == "assistant" && it.status == null && it.content_type == "text" }
                MenuRow("🃏 Make flashcards from this chat", enabled = hasClaude && ui.online, tag = ClaudeThreadTags.MAKE_CARDS) {
                    menu = false
                    actions.onMakeCards()
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

@Composable
private fun HeaderButton(label: String, enabled: Boolean, tag: String, onClick: () -> Unit) {
    Text(
        label, fontSize = 22.sp, color = Lab.colors.ink,
        modifier = Modifier.heightIn(min = 44.dp).clip(RoundedCornerShape(12.dp)).alpha(if (enabled) 1f else 0.4f)
            .clickable(enabled = enabled, onClick = onClick).padding(horizontal = 12.dp, vertical = 8.dp).testTag(tag),
    )
}

/** "📇 Asked on card · 银行 ›" — orange outline (Claude's colour in the Chats tab), tappable when it leads somewhere. */
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
