package dev.jeromeswannack.chineselearning.lab.ui.claudechat

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.AskClaude
import dev.jeromeswannack.chineselearning.lab.core.CoachAsk
import dev.jeromeswannack.chineselearning.lab.core.VoiceDictation
import dev.jeromeswannack.chineselearning.lab.ui.chat.DeckChoice
import dev.jeromeswannack.chineselearning.lab.ui.chat.ListeningUi
import dev.jeromeswannack.chineselearning.lab.ui.chat.ReviewActions
import dev.jeromeswannack.chineselearning.lab.ui.chat.ReviewPanel
import dev.jeromeswannack.chineselearning.lab.ui.chat.ReviewUi
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabFooterSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreenFrame
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.ScreenTitle
import dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceDictationUi
import dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceTextFieldContent
import dev.jeromeswannack.chineselearning.lab.ui.kit.rememberVoiceDictation
import dev.jeromeswannack.chineselearning.lab.ui.kit.rememberVoiceFirstActions
import dev.jeromeswannack.chineselearning.lab.ui.readers.ReadAloudHandle
import dev.jeromeswannack.chineselearning.lab.ui.study.LanguageToggle
import dev.jeromeswannack.chineselearning.lab.ui.study.ListenToggle
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/** What the "💬 Ask Claude" chat screen shows (stateless, so every state renders in screenshot tests). */
data class ClaudeChatUi(
    val title: String = "",
    val messages: List<ClaudeChatMsg> = emptyList(),
    val loading: Boolean = false,
    val loadError: String? = null,
    val draft: String = "",
    /** My message on its way (shown until the server has it). */
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
    /** "Make flashcards from this chat": Claude is proposing. */
    val proposing: Boolean = false,
    val review: ReviewUi? = null,
    val decks: List<DeckChoice> = emptyList(),
    val notice: String? = null,
) {
    val replyPending: Boolean get() = messages.any { it.status == "pending" }
    val busy: Boolean get() = sending != null || replyPending
}

class ClaudeChatActions(
    val onBack: () -> Unit = {},
    val onDraft: (String) -> Unit = {},
    val onSend: (String, Boolean) -> Unit = { _, _ -> },
    val onLanguage: (String) -> Unit = {},
    val onListening: (Boolean) -> Unit = {},
    val onMakeCards: () -> Unit = {},
    /** "📝 N words to recap" → `/coach/chat/{id}/recap` (the readers' word recap pass). */
    val onRecap: () -> Unit = {},
    val onRetryLoad: () -> Unit = {},
    val thread: ClaudeChatThreadActions = ClaudeChatThreadActions(),
    val review: ReviewActions = ReviewActions(),
)

object ClaudeChatScreenTags {
    const val SCREEN = "claude-chat-page"
    const val EMPTY = "claude-chat-empty"
    const val MORE = "claude-chat-more"
    const val MENU = "claude-chat-menu"
    const val MAKE_CARDS = "claude-chat-make-cards"
    const val RECAP = "claude-chat-recap"
}

/**
 * "💬 Ask Claude" (`/coach/chat/{id}`, `new` for a fresh one; the web's pages/ClaudeChatPage.tsx): the
 * header (← · the title · 🎧 · 中文 | EN · ⋯), the thread ([ClaudeChatThread]) and the voice-first
 * composer — nothing else around the box. ⋯ → Make flashcards from this chat (the tapped words
 * ticked) and "📝 N words to recap" (only with words not yet recapped) → the readers' word recap pass.
 */
@Composable
fun ClaudeChatScreen(
    ui: ClaudeChatUi,
    actions: ClaudeChatActions,
    voicePreview: VoiceDictationUi? = null,
    readBackPreview: Map<String, ReadAloudHandle> = emptyMap(),
    pinyinPreview: Set<String> = emptySet(),
    translatePreview: Set<String> = emptySet(),
    menuPreview: Boolean = false,
) {
    val listState = rememberLazyListState()
    var menu by remember { mutableStateOf(menuPreview) }
    val voiceLang = if (ui.language == AskClaude.ZH) "zh" else "en"
    val voice = androidx.compose.runtime.key(voiceLang) { rememberVoiceDictation("claude_chat", voiceLang) }
    val voiceUi by voice.ui.collectAsState()
    val voiceActions = rememberVoiceFirstActions(voice, ui.draft, onFill = actions.onDraft) { a ->
        actions.onDraft(a.text)
        actions.onSend(a.text, a.source == "spoken")
    }
    // A spoken message that failed to send: into the box (typing) so it can be fixed or sent again.
    LaunchedEffect(ui.sendError) {
        if (ui.sendError != null && ui.draft.isNotBlank() && voiceUi.state.mode == VoiceDictation.VOICE && voiceUi.phase == "idle") voice.type()
    }
    val count = ui.messages.size + (if (ui.sending != null) 2 else 0)
    LaunchedEffect(count) { if (count > 0) listState.animateScrollToItem(maxOf(0, count)) }
    val thinking = if (ui.language == AskClaude.ZH) CoachAsk.THINKING_ZH else CoachAsk.THINKING_EN

    LabScreenFrame(Modifier.testTag(ClaudeChatScreenTags.SCREEN)) {
        Column(Modifier.fillMaxSize()) {
            ScreenTitle("${CoachAsk.ICON} ${ui.title.ifBlank { CoachAsk.LABEL }}", onBack = actions.onBack) {
                ListenToggle(ui.listening, actions.onListening)
                Spacer(Modifier.width(4.dp))
                LanguageToggle(ui.language, actions.onLanguage)
                Text(
                    "⋯", fontSize = 22.sp, color = Lab.colors.ink,
                    modifier = Modifier.heightIn(min = 44.dp).clip(RoundedCornerShape(12.dp))
                        .alpha(if (ui.messages.isEmpty()) 0.4f else 1f)
                        .clickable(enabled = ui.messages.isNotEmpty()) { menu = true }
                        .padding(horizontal = 12.dp, vertical = 8.dp).testTag(ClaudeChatScreenTags.MORE),
                )
            }
            LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = listState, contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (ui.messages.isEmpty() && ui.sending == null) {
                    item("empty") {
                        Column(Modifier.testTag(ClaudeChatScreenTags.EMPTY), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            if (ui.loading) Text("Loading…", color = Lab.colors.muted)
                            else if (ui.loadError != null) InlineNotice(ui.loadError, kind = if (ui.online) NoticeKind.Error else NoticeKind.Offline, actionLabel = "Retry", onAction = actions.onRetryLoad)
                            else {
                                Text("${CoachAsk.ICON} ${CoachAsk.LABEL}", style = MaterialTheme.typography.titleLarge, color = Lab.colors.ink)
                                Text(if (ui.language == AskClaude.ZH) CoachAsk.HINT else CoachAsk.EMPTY_EN, color = Lab.colors.muted)
                                Text("Under each answer: ▶ listen · 拼 pinyin · EN translation · 🎤 read it back and see how you did.", color = Lab.colors.muted, style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                }
                item("thread") {
                    ClaudeChatThread(
                        ui.messages, ui.listening, ui.listen, ui.listenNotice, ui.playingText, thinking, ui.known, actions.thread,
                        readBackPreview = readBackPreview, pinyinPreview = pinyinPreview, translatePreview = translatePreview,
                    )
                }
                ui.sending?.let { s ->
                    item("sending") {
                        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                                Text(s, color = androidx.compose.ui.graphics.Color.White, fontSize = 17.sp, modifier = Modifier.clip(RoundedCornerShape(18.dp)).background(dev.jeromeswannack.chineselearning.lab.ui.chat.chatColors().mine.copy(alpha = 0.7f)).padding(horizontal = 14.dp, vertical = 9.dp))
                            }
                            ClaudeChatThread(listOf(ClaudeChatMsg("sending-reply", "assistant", "", status = "pending")), false, ListeningUi(), null, null, thinking, emptySet(), ClaudeChatThreadActions())
                        }
                    }
                }
                ui.sendError?.let { item("err") { InlineNotice(it, kind = if (!ui.online) NoticeKind.Offline else NoticeKind.Error) } }
                ui.notice?.let { item("notice") { InlineNotice(it, kind = NoticeKind.Success) } }
                if (ui.proposing) item("proposing") { Text("Claude is reading this chat…", color = Lab.colors.muted) }
            }
            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp)).background(Lab.colors.card)
                    .border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp)).padding(12.dp)
                    .testTag("claude-chat-composer"),
            ) {
                VoiceTextFieldContent(
                    ui = voicePreview ?: voiceUi,
                    value = ui.draft,
                    onValueChange = actions.onDraft,
                    actions = voiceActions,
                    submitLabel = if (ui.busy) "…" else "Send",
                    placeholder = if (ui.language == AskClaude.ZH) CoachAsk.PLACEHOLDER_ZH else CoachAsk.PLACEHOLDER_EN,
                    multiline = true,
                    lang = voiceLang,
                    enabled = !ui.busy,
                )
            }
        }
    }
    if (menu) {
        LabBottomSheet(onDismiss = { menu = false }) {
            Column(Modifier.fillMaxWidth().testTag(ClaudeChatScreenTags.MENU)) {
                MenuRow("🃏 Make flashcards from this chat", enabled = ui.messages.any { !it.mine && it.status == null }, tag = ClaudeChatScreenTags.MAKE_CARDS) {
                    menu = false
                    actions.onMakeCards()
                }
                if (ui.recapCount > 0) {
                    MenuRow(CoachAsk.recapCountLabel(ui.recapCount), enabled = true, tag = ClaudeChatScreenTags.RECAP) {
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
}

@Composable
private fun MenuRow(label: String, enabled: Boolean, tag: String, badge: String? = null, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 52.dp).clickable(enabled = enabled, onClick = onClick).alpha(if (enabled) 1f else 0.55f)
            .padding(horizontal = 20.dp).testTag(tag),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, color = Lab.colors.ink, fontSize = 16.sp, modifier = Modifier.weight(1f))
        badge?.let {
            Text(it, color = Lab.colors.muted, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.clip(RoundedCornerShape(50)).background(Lab.colors.faint).padding(horizontal = 8.dp, vertical = 3.dp))
        }
    }
}
