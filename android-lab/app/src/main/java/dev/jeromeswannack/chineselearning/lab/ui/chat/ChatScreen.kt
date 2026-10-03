package dev.jeromeswannack.chineselearning.lab.ui.chat

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.gestures.detectTapGestures
import dev.jeromeswannack.chineselearning.lab.data.api.CLAUDE_USER_ID
import dev.jeromeswannack.chineselearning.lab.core.MessageTools
import dev.jeromeswannack.chineselearning.lab.data.api.ChatMessageDto
import dev.jeromeswannack.chineselearning.lab.data.chat.ChatMediaSizing
import dev.jeromeswannack.chineselearning.lab.ui.connections.Avatar
import dev.jeromeswannack.chineselearning.lab.ui.kit.EmptyState
import dev.jeromeswannack.chineselearning.lab.ui.kit.ErrorState
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabChip
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreenFrame
import dev.jeromeswannack.chineselearning.lab.ui.kit.LoadingState
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.OfflineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import kotlin.math.roundToInt

class ChatActions(
    val onBack: () -> Unit = {},
    val onDraft: (String) -> Unit = {},
    val onSend: () -> Unit = {},
    val onReply: (ChatMessageDto?) -> Unit = {},
    val onPlay: (ChatMessageDto) -> Unit = {},
    val onOpenSheet: (ChatSheet?) -> Unit = {},
    val onReact: (ChatMessageDto, String) -> Unit = { _, _ -> },
    val onViewCheck: (ChatMessageDto) -> Unit = {},
    val onWord: (hanzi: String, context: String) -> Unit = { _, _ -> },
    val onDismissNotice: () -> Unit = {},
    val onJoinCall: (String) -> Unit = {},
    val onRetry: () -> Unit = {},
    // ---- PR 2 ----
    val onRetryPending: (clientId: String) -> Unit = {},
    val onDiscardPending: (clientId: String) -> Unit = {},
    val onCancelEdit: () -> Unit = {},
    val onOpenSearch: () -> Unit = {},
    val onSearchQuery: (String) -> Unit = {},
    /** ↑ older = +1, ↓ newer = −1. */
    val onSearchStep: (Int) -> Unit = {},
    val onCloseSearch: () -> Unit = {},
    val onJumpTo: (String) -> Unit = {},
    val onAtBottom: (Boolean) -> Unit = {},
    val onScrollToEnd: () -> Unit = {},
    /** Hold the mic: false when the microphone permission still has to be granted. */
    val onRecordStart: (locked: Boolean) -> Boolean = { false },
    val onRecordLock: () -> Unit = {},
    val onRecordCancel: () -> Unit = {},
    val onRecordFinish: () -> Unit = {},
    val onRecordSend: () -> Unit = {},
    /** Locked recording → ➤: stop and send in one go. */
    val onRecordSendNow: () -> Unit = {},
    /** ▶ / ⏸: (playback id, message or null, local file or null, duration ms). */
    val onToggleVoice: (String, ChatMessageDto?, String?, Long) -> Unit = { _, _, _, _ -> },
    val onToggleTranslation: (String) -> Unit = {},
    /** A photo for a bubble ([maxSide] px) — the media cache (null = not available). */
    val loadImage: suspend (ChatMessageDto, Int) -> ImageBitmap? = { _, _ -> null },
    val loadLocalImage: suspend (String, Int) -> ImageBitmap? = { _, _ -> null },
    // ---- PR 3: learning tools ----
    /** A Chinese message without words came on screen (the VM asks once). */
    val onRequestWords: (ChatMessageDto) -> Unit = {},
    /** A word chip (message, index into its words). */
    val onChip: (ChatMessageDto, Int) -> Unit = { _, _ -> },
    val onTogglePinyin: (String) -> Unit = {},
    val onStartSelecting: () -> Unit = {},
    val onCancelSelecting: () -> Unit = {},
    val onToggleSelect: (String) -> Unit = {},
    val onSelectToday: () -> Unit = {},
    val onSelectLast: () -> Unit = {},
    val onPropose: () -> Unit = {},
    /** The student's "Make a card from the correction". */
    val onCorrectionCard: (ChatMessageDto) -> Unit = {},
    val onCheckDraft: () -> Unit = {},
    val onUseCheck: () -> Unit = {},
    val onSendAsIs: () -> Unit = {},
    val onDismissCheck: () -> Unit = {},
    // ---- round 2 (docs/CHAT.md "Round 2") ----
    /** A tap on a bubble shows / hides its time. */
    val onToggleTime: (String) -> Unit = {},
    /** 📹 in the header. */
    val onVideoCall: () -> Unit = {},
    val onOpenLink: (String) -> Unit = {},
    /** A bubble with a link came on screen (the VM fetches its preview once, cache-first). */
    val onRequestLinkPreview: (String) -> Unit = {},
    val loadLinkImage: suspend (String, Int) -> ImageBitmap? = { _, _ -> null },
    /** A voice bubble came on screen: (playback id, message or null, local file or null). */
    val onRequestWaveform: (String, ChatMessageDto?, String?) -> Unit = { _, _, _ -> },
    /** The voice speed chip. */
    val onCycleSpeed: () -> Unit = {},
    /** The selection bar's Copy. */
    val onCopySelection: () -> Unit = {},
)

/**
 * The chat (web: ChatPage) — chat round 2 (docs/CHAT.md "Round 2"): a normal chat app. Header
 * ← name · 📹 · ⋯, pinned bar, Signal-like bubbles grouped by person and time with day pills and
 * the "New messages" divider, ticks inside the last bubble, the one-row composer. Bubbles carry no
 * buttons: long-press opens the message menu (reactions + every tool), swipe right replies.
 */
@Composable
fun ChatScreen(ui: ChatUi, actions: ChatActions, callBanner: (@Composable () -> Unit)? = null, sheets: @Composable () -> Unit = {}) {
    var viewer by remember { mutableStateOf<ViewerTarget?>(null) }
    val colors = chatColors()
    Box(Modifier.fillMaxSize().background(colors.screen)) {
        LabScreenFrame { Column(Modifier.fillMaxSize()) {
            when {
                ui.selection != null -> SelectionHeader(ui, actions)
                ui.search != null -> SearchBar(ui.search, actions)
                else -> ChatHeader(ui, actions)
            }
            val pinned = ui.pinned
            AnimatedVisibility(pinned.isNotEmpty() && ui.search == null && ui.selection == null, enter = expandVertically() + fadeIn(), exit = shrinkVertically() + fadeOut()) {
                pinned.firstOrNull()?.let { PinnedBar(it, pinned.size, actions) }
            }
            if (ui.isAi && !ui.conversation?.scenario.isNullOrBlank()) ScenarioBanner(ui)
            // Package J: "📹 王老师 is calling — Join" while a call is live in this relationship.
            if (callBanner != null) Box(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp)) { callBanner() }
            Box(Modifier.weight(1f).fillMaxWidth()) {
                when {
                    ui.loading && ui.messages.isEmpty() && ui.pending.isEmpty() -> LoadingState()
                    ui.loadError != null && ui.messages.isEmpty() && ui.pending.isEmpty() -> ErrorState(ui.loadError, onRetry = actions.onRetry)
                    else -> MessageList(ui, actions) { viewer = it }
                }
            }
            if (ui.selection != null) SelectionFooter(ui, actions)
            else {
                EditBar(ui.editing, actions)
                ReplyBar(ui.replyingTo, actions)
                Composer(ui, actions)
            }
        } }
    }
    viewer?.let { ImageViewer(it, actions) { viewer = null } }
    sheets()
}

/** What the full-screen photo viewer shows. */
data class ViewerTarget(val message: ChatMessageDto?, val localPath: String?)

/** ← · name (+ "typing…" / the title) · 📹 · ⋯ (search, make flashcards, pinyin / translations for all, …). */
@Composable
private fun ChatHeader(ui: ChatUi, actions: ChatActions) {
    Row(Modifier.fillMaxWidth().padding(start = 4.dp, end = 4.dp, top = 6.dp, bottom = 6.dp).testTag("chat-header"), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = actions.onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back", tint = Lab.colors.ink) }
        Avatar(ui.otherName, null, size = 36.dp, isClaude = ui.isAi || ui.otherIsClaude)
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(ui.otherName.ifEmpty { "Chat" }, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                if (ui.isAi) {
                    Spacer(Modifier.width(6.dp))
                    Text("AI", style = MaterialTheme.typography.labelSmall, color = Lab.colors.accent, modifier = Modifier.clip(RoundedCornerShape(6.dp)).background(Lab.colors.accentSoft).padding(horizontal = 6.dp, vertical = 1.dp))
                }
            }
            // "typing…" takes the subtitle's place, like a messenger.
            if (ui.typing) Text("typing…", style = MaterialTheme.typography.bodySmall, color = Lab.colors.accent, maxLines = 1)
            else ui.conversation?.title?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, maxLines = 1, overflow = TextOverflow.Ellipsis) }
            if (ui.proposingCards) Text("Claude is picking cards…", style = MaterialTheme.typography.bodySmall, color = Lab.colors.accent, maxLines = 1)
        }
        if (!ui.isAi && !ui.otherIsClaude) {
            Box(
                Modifier.size(48.dp).clip(CircleShape).clickable(enabled = !ui.callBusy, onClickLabel = "Video call", onClick = actions.onVideoCall).testTag("chat-video-call"),
                contentAlignment = Alignment.Center,
            ) {
                if (ui.callBusy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = Lab.colors.accent)
                else Text("📹", fontSize = 20.sp)
            }
        }
        IconButton(onClick = { actions.onOpenSheet(ChatSheet.Menu) }, modifier = Modifier.testTag("chat-menu")) { Icon(Icons.Filled.MoreVert, "Conversation menu", tint = Lab.colors.ink) }
    }
}


@Composable
private fun SearchBar(s: ChatSearchUi, actions: ChatActions) {
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    Row(Modifier.fillMaxWidth().padding(start = 4.dp, end = 4.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = actions.onCloseSearch) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Close search", tint = Lab.colors.ink) }
        TextField(
            s.query, actions.onSearchQuery,
            placeholder = { Text("Search this chat") },
            singleLine = true,
            shape = RoundedCornerShape(22.dp),
            colors = TextFieldDefaults.colors(
                focusedContainerColor = Lab.colors.card, unfocusedContainerColor = Lab.colors.card,
                focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent,
            ),
            modifier = Modifier.weight(1f).heightIn(min = 48.dp).focusRequester(focus).testTag("chat-search"),
        )
        Text(
            s.label, style = MaterialTheme.typography.labelMedium, color = if (s.results.isEmpty()) Lab.colors.muted else Lab.colors.ink,
            modifier = Modifier.padding(horizontal = 8.dp).testTag("chat-search-count"), maxLines = 1,
        )
        IconButton(onClick = { actions.onSearchStep(1) }, enabled = s.results.size > 1) { Icon(Icons.Filled.KeyboardArrowUp, "Older match", tint = Lab.colors.ink.copy(alpha = if (s.results.size > 1) 1f else 0.3f)) }
        IconButton(onClick = { actions.onSearchStep(-1) }, enabled = s.results.size > 1) { Icon(Icons.Filled.KeyboardArrowDown, "Newer match", tint = Lab.colors.ink.copy(alpha = if (s.results.size > 1) 1f else 0.3f)) }
    }
}

@Composable
private fun PinnedBar(m: ChatMessageDto, count: Int, actions: ChatActions) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 2.dp).clip(RoundedCornerShape(14.dp)).background(Lab.colors.card)
            .border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(14.dp))
            .clickable(onClickLabel = "Jump to the pinned message") { actions.onJumpTo(m.id) }.testTag("chat-pinned-bar"),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.padding(start = 10.dp).width(3.dp).height(30.dp).clip(RoundedCornerShape(2.dp)).background(Lab.colors.accent))
        Column(Modifier.weight(1f).padding(horizontal = 10.dp, vertical = 7.dp)) {
            Text(if (count > 1) "📌 Pinned · $count" else "📌 Pinned", style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold, color = Lab.colors.accent)
            Text(previewOf(m), style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        IconButton(onClick = { actions.onOpenSheet(ChatSheet.Pins) }) { Icon(Icons.Filled.MoreVert, "All pinned messages", tint = Lab.colors.muted) }
    }
}

fun previewOf(m: ChatMessageDto): String = ChatRich.preview(m.content, m.attachment?.kind, m.deleted_at, max = 90)

@Composable
private fun ScenarioBanner(ui: ChatUi) {
    val c = ui.conversation ?: return
    Text(
        buildString {
            append("Scenario: ${c.scenario}")
            c.user_role?.takeIf { it.isNotBlank() }?.let { append(" | You: $it") }
            c.ai_role?.takeIf { it.isNotBlank() }?.let { append(" | AI: $it") }
        },
        style = MaterialTheme.typography.bodySmall, color = Lab.colors.ink,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).clip(RoundedCornerShape(12.dp)).background(Lab.colors.accentSoft).padding(10.dp),
    )
}

private fun LazyListState.isAtEnd(): Boolean {
    val info = layoutInfo
    val last = info.visibleItemsInfo.lastOrNull() ?: return true
    return last.index >= info.totalItemsCount - 1 && last.offset + last.size <= info.viewportEndOffset + 8
}


@Composable
private fun MessageList(ui: ChatUi, actions: ChatActions, onView: (ViewerTarget) -> Unit) {
    val rows = remember(ui.messages, ui.pending, ui.unreadId, ui.otherReadAt, ui.myId) { ui.rows() }
    val lead = (if (ui.offlineHistory) 1 else 0) + (if (ui.messages.isEmpty() && ui.pending.isEmpty()) 1 else 0)
    val tail = (if (ui.waitingForAi) 1 else 0) + (if (ui.typing) 1 else 0)
    val total = lead + rows.size + tail
    fun indexOf(id: String): Int = if (id == ChatViewModel.END) total - 1 else rows.indexOfFirst { it.key == id || (it is ChatRow.Pending && it.bubble.clientId == id) }.let { if (it < 0) -1 else it + lead }
    // Open at the "New messages" divider when there is one (the VM asks), else at the end.
    val initialIndex = remember { ui.scrollTo?.let { r -> indexOf(r.id).takeIf { it >= 0 }?.let { (it - 1).coerceAtLeast(0) } } ?: (total - 1).coerceAtLeast(0) }
    val state = rememberLazyListState(initialFirstVisibleItemIndex = initialIndex)
    val atEnd by remember { derivedStateOf { state.isAtEnd() } }
    val onAtBottom by rememberUpdatedState(actions.onAtBottom)
    LaunchedEffect(state) { snapshotFlow { atEnd }.collect { onAtBottom(it) } }
    // Stay at the end while pictures / previews / chips load above it and grow the rows — until
    // the reader scrolls away themselves.
    var stick by remember { mutableStateOf(initialIndex >= total - 1) }
    LaunchedEffect(state) {
        snapshotFlow { state.isScrollInProgress to atEnd }.collect { (scrolling, end) -> if (scrolling) stick = end }
    }
    LaunchedEffect(state) {
        snapshotFlow { state.layoutInfo.visibleItemsInfo.lastOrNull()?.let { it.index to it.offset + it.size } }.collect {
            if (stick && !state.isScrollInProgress && !state.isAtEnd()) state.scrollToItem((state.layoutInfo.totalItemsCount - 1).coerceAtLeast(0), Int.MAX_VALUE / 2)
        }
    }
    // New rows while I'm at the end (their message, my send, typing): follow them.
    var lastTotal by remember { mutableStateOf(total) }
    LaunchedEffect(total) {
        if (total > lastTotal && (atEnd || rows.lastOrNull() is ChatRow.Pending)) state.animateScrollToItem((total - 1).coerceAtLeast(0))
        lastTotal = total
    }
    LaunchedEffect(ui.scrollTo) {
        val r = ui.scrollTo ?: return@LaunchedEffect
        val i = indexOf(r.id)
        if (i < 0) return@LaunchedEffect
        val target = if (r.id == ChatViewModel.END) i else (i - 1).coerceAtLeast(0) // a little context above
        if (r.animate) state.animateScrollToItem(target) else state.scrollToItem(target)
    }
    Box(Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize().testTag("chat-messages"), state = state, contentPadding = PaddingValues(start = 10.dp, end = 10.dp, top = 4.dp, bottom = 12.dp)) {
            if (ui.offlineHistory) item(key = "offline") { OfflineNotice() }
            if (ui.messages.isEmpty() && ui.pending.isEmpty()) {
                item(key = "empty") { EmptyState(if (ui.isAi) "🤖" else "💬", if (ui.isAi) "Start practicing Chinese!" else "Start the conversation!") }
            }
            items(rows, key = { it.key }) { row ->
                when (row) {
                    is ChatRow.Day -> DayPill(row.label)
                    ChatRow.Unread -> UnreadDivider()
                    is ChatRow.Msg -> MessageBubbleRow(row.message, row.layout, ui, actions, onView)
                    is ChatRow.Pending -> PendingBubbleRow(row.bubble, row.layout, ui, actions, onView)
                }
            }
            if (ui.waitingForAi) item(key = "typing-ai") { TypingBubble() }
            if (ui.typing) item(key = "typing") { TypingBubble() }
        }
        androidx.compose.animation.AnimatedVisibility(
            ui.newBelow > 0 || !atEnd,
            modifier = Modifier.align(Alignment.BottomEnd).padding(12.dp),
            enter = scaleIn(spring(Spring.DampingRatioMediumBouncy)) + fadeIn(),
            exit = scaleOut() + fadeOut(),
        ) {
            JumpToLatest(ui.newBelow, actions.onScrollToEnd)
        }
    }
}


@Composable
private fun UnreadDivider() {
    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp).testTag("chat-unread-divider"), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.weight(1f).height(1.5.dp).background(Lab.colors.accent.copy(alpha = 0.5f)))
        Text("New messages", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold, color = Lab.colors.accent, modifier = Modifier.padding(horizontal = 10.dp))
        Box(Modifier.weight(1f).height(1.5.dp).background(Lab.colors.accent.copy(alpha = 0.5f)))
    }
}



@Composable
private fun ToolButton(label: String, description: String, enabled: Boolean = true, onClick: () -> Unit) {
    Box(
        Modifier.size(44.dp).clip(CircleShape).clickable(enabled = enabled, onClickLabel = description, onClick = onClick).alpha(if (enabled) 1f else 0.4f),
        contentAlignment = Alignment.Center,
    ) { Text(label, fontSize = 16.sp, color = Lab.colors.muted) }
}



@Composable
private fun EditBar(editing: ChatMessageDto?, actions: ChatActions) {
    AnimatedVisibility(editing != null, enter = expandVertically() + fadeIn(), exit = shrinkVertically() + fadeOut()) {
        val e = editing ?: return@AnimatedVisibility
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp).clip(RoundedCornerShape(12.dp)).background(Lab.colors.accentSoft).padding(start = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("✏️", fontSize = 16.sp)
            Column(Modifier.weight(1f).padding(horizontal = 10.dp, vertical = 8.dp)) {
                Text("Editing message", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold, color = Lab.colors.accent)
                Text(ChatLogic.truncate(previewOf(e), 80), style = MaterialTheme.typography.bodySmall, color = Lab.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            ToolButton("×", "Cancel edit") { actions.onCancelEdit() }
        }
    }
}

@Composable
private fun ReplyBar(replyingTo: ChatMessageDto?, actions: ChatActions) {
    AnimatedVisibility(replyingTo != null, enter = expandVertically() + fadeIn(), exit = shrinkVertically() + fadeOut()) {
        val r = replyingTo ?: return@AnimatedVisibility
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp).clip(RoundedCornerShape(12.dp)).background(Lab.colors.accentSoft).padding(start = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f).padding(vertical = 8.dp)) {
                Text(r.sender.name ?: "Unknown", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold, color = Lab.colors.accent)
                Text(ChatLogic.truncate(previewOf(r), 80), style = MaterialTheme.typography.bodySmall, color = Lab.colors.ink, maxLines = 2)
            }
            ToolButton("×", "Cancel reply") { actions.onReply(null) }
        }
    }
}

/** Tap a photo: full screen, pinch to zoom, drag when zoomed, double-tap to reset. */
@Composable
private fun ImageViewer(target: ViewerTarget, actions: ChatActions, onClose: () -> Unit) {
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        val bitmap by produceState<ImageBitmap?>(null, target) {
            value = runCatching { target.message?.let { actions.loadImage(it, 2400) } ?: target.localPath?.let { actions.loadLocalImage(it, 2400) } }.getOrNull()
        }
        var zoom by remember { mutableFloatStateOf(1f) }
        var offsetX by remember { mutableFloatStateOf(0f) }
        var offsetY by remember { mutableFloatStateOf(0f) }
        Box(Modifier.fillMaxSize().background(Color.Black), contentAlignment = Alignment.Center) {
            val b = bitmap
            if (b == null) CircularProgressIndicator(color = Color.White)
            else Image(
                b, contentDescription = "Photo",
                contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxSize()
                    .pointerInput(Unit) {
                        detectTransformGestures { _, pan, z, _ ->
                            zoom = (zoom * z).coerceIn(1f, 5f)
                            if (zoom > 1f) { offsetX += pan.x; offsetY += pan.y } else { offsetX = 0f; offsetY = 0f }
                        }
                    }
                    .pointerInput(Unit) { detectTapGestures(onDoubleTap = { zoom = if (zoom > 1f) 1f else 2.5f; offsetX = 0f; offsetY = 0f }) }
                    .graphicsLayer { scaleX = zoom; scaleY = zoom; translationX = offsetX; translationY = offsetY },
            )
            target.message?.content?.takeIf { it.isNotBlank() }?.let {
                Text(it, color = Color.White, fontSize = 16.sp, modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth().background(Color.Black.copy(alpha = 0.55f)).padding(16.dp))
            }
            IconButton(onClick = onClose, modifier = Modifier.align(Alignment.TopEnd).padding(8.dp).size(48.dp).clip(CircleShape).background(Color.Black.copy(alpha = 0.4f))) {
                Icon(Icons.Filled.Close, "Close", tint = Color.White)
            }
        }
    }
}
