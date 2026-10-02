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
    val onGenerateCard: () -> Unit = {},
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
    /** Hold or tap the mic: false when the microphone permission still has to be granted. */
    val onRecordStart: (locked: Boolean) -> Boolean = { false },
    val onRecordLock: () -> Unit = {},
    val onRecordCancel: () -> Unit = {},
    val onRecordFinish: () -> Unit = {},
    val onRecordSend: () -> Unit = {},
    /** ▶ / ⏸: (playback id, message or null, local file or null, duration ms). */
    val onToggleVoice: (String, ChatMessageDto?, String?, Long) -> Unit = { _, _, _, _ -> },
    val onToggleTranslation: (String) -> Unit = {},
    /** A photo for a bubble ([maxSide] px) — the media cache (null = not available). */
    val loadImage: suspend (ChatMessageDto, Int) -> ImageBitmap? = { _, _ -> null },
    val loadLocalImage: suspend (String, Int) -> ImageBitmap? = { _, _ -> null },
)

/**
 * The chat (web: ChatPage) — immersive: header (🔍 search), pinned bar, messages grouped by day with
 * the "New messages" divider, receipts and typing, the composer (📎 photos, hold-to-record voice).
 * Per message: Reply and Play inline, everything else under ⋯ / long-press (MessageTools).
 */
@Composable
fun ChatScreen(ui: ChatUi, actions: ChatActions, callBanner: (@Composable () -> Unit)? = null, sheets: @Composable () -> Unit = {}) {
    var viewer by remember { mutableStateOf<ViewerTarget?>(null) }
    LabScreenFrame { Column(Modifier.fillMaxSize()) {
        if (ui.search != null) SearchBar(ui.search, actions) else ChatHeader(ui, actions)
        val pinned = ui.pinned
        AnimatedVisibility(pinned.isNotEmpty() && ui.search == null, enter = expandVertically() + fadeIn(), exit = shrinkVertically() + fadeOut()) {
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
        EditBar(ui.editing, actions)
        ReplyBar(ui.replyingTo, actions)
        Composer(ui, actions)
    } }
    viewer?.let { ImageViewer(it, actions) { viewer = null } }
    sheets()
}

/** What the full-screen photo viewer shows. */
data class ViewerTarget(val message: ChatMessageDto?, val localPath: String?)

@Composable
private fun ChatHeader(ui: ChatUi, actions: ChatActions) {
    Row(Modifier.fillMaxWidth().padding(start = 4.dp, end = 4.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = actions.onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back", tint = Lab.colors.ink) }
        Avatar(ui.otherName, null, size = 38.dp, isClaude = ui.isAi || ui.otherIsClaude)
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
        }
        SmallButton(if (ui.generatingCard) "…" else "+ Card", enabled = ui.online && ui.messages.isNotEmpty() && !ui.generatingCard, busy = ui.generatingCard, onClick = actions.onGenerateCard)
        IconButton(onClick = actions.onOpenSearch, modifier = Modifier.testTag("chat-search-open")) { Icon(Icons.Filled.Search, "Search this chat", tint = Lab.colors.muted) }
        IconButton(onClick = { actions.onOpenSheet(ChatSheet.Menu) }) { Icon(Icons.Filled.MoreVert, "Conversation menu", tint = Lab.colors.muted) }
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
private fun SmallButton(label: String, enabled: Boolean, busy: Boolean = false, onClick: () -> Unit) {
    Box(
        Modifier.heightIn(min = 40.dp).clip(RoundedCornerShape(20.dp)).border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(20.dp))
            .bouncyClickable(enabled = enabled, onClick = onClick).alpha(if (enabled || busy) 1f else 0.45f).padding(horizontal = 12.dp, vertical = 9.dp),
        contentAlignment = Alignment.Center,
    ) {
        if (busy) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = Lab.colors.accent)
        else Text(label, color = Lab.colors.accent, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
    }
}

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
        LazyColumn(Modifier.fillMaxSize().testTag("chat-messages"), state = state, contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if (ui.offlineHistory) item(key = "offline") { OfflineNotice() }
            if (ui.messages.isEmpty() && ui.pending.isEmpty()) {
                item(key = "empty") { EmptyState(if (ui.isAi) "🤖" else "💬", if (ui.isAi) "Start practicing Chinese!" else "Start the conversation!") }
            }
            items(rows, key = { it.key }) { row ->
                when (row) {
                    is ChatRow.Day -> DateDivider(row.label)
                    ChatRow.Unread -> UnreadDivider()
                    is ChatRow.Msg -> MessageRow(row.message, row.receipt, ui, actions, onView)
                    is ChatRow.Pending -> PendingRow(row.bubble, ui, actions, onView)
                }
            }
            if (ui.waitingForAi) item(key = "typing-ai") { TypingBubble("Claude", true, label = null) }
            if (ui.typing) item(key = "typing") { TypingBubble(ui.otherName, ui.otherIsClaude, label = "${ui.otherName.ifEmpty { "They" }} is typing…") }
        }
        androidx.compose.animation.AnimatedVisibility(
            ui.newBelow > 0 || !atEnd,
            modifier = Modifier.align(Alignment.BottomEnd).padding(12.dp),
            enter = scaleIn(spring(Spring.DampingRatioMediumBouncy)) + fadeIn(),
            exit = scaleOut() + fadeOut(),
        ) {
            NewPill(ui.newBelow, actions.onScrollToEnd)
        }
    }
}

@Composable
private fun NewPill(count: Int, onClick: () -> Unit) {
    Row(
        Modifier.heightIn(min = 44.dp).clip(RoundedCornerShape(22.dp)).background(if (count > 0) Lab.colors.accent else Lab.colors.card)
            .border(1.dp, if (count > 0) Lab.colors.accent else Lab.colors.cardBorder, RoundedCornerShape(22.dp))
            .bouncyClickable(onClick = onClick).padding(horizontal = 14.dp, vertical = 10.dp).testTag("chat-new-pill"),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(if (count > 0) "↓ $count new" else "↓", color = if (count > 0) Color.White else Lab.colors.ink, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
    }
}

@Composable
private fun DateDivider(label: String) {
    Box(Modifier.fillMaxWidth().padding(vertical = 8.dp), contentAlignment = Alignment.Center) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted, modifier = Modifier.clip(RoundedCornerShape(10.dp)).background(Lab.colors.faint).padding(horizontal = 10.dp, vertical = 3.dp))
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

/** The bubble column: my messages right, theirs left with the avatar; capped for the unfolded Fold. */
@Composable
private fun BubbleColumn(isMe: Boolean, sender: String?, isClaude: Boolean, content: @Composable () -> Unit) {
    Row(Modifier.fillMaxWidth().testTag("chat-message"), horizontalArrangement = if (isMe) Arrangement.End else Arrangement.Start, verticalAlignment = Alignment.Top) {
        if (!isMe) {
            Avatar(sender, null, size = 30.dp, isClaude = isClaude)
            Spacer(Modifier.width(6.dp))
        }
        Column(Modifier.fillMaxWidth(if (isMe) 0.86f else 0.84f).widthIn(max = MAX_BUBBLE), horizontalAlignment = if (isMe) Alignment.End else Alignment.Start) { content() }
    }
}

private val MAX_BUBBLE = 480.dp

private fun bubbleShape(isMe: Boolean) = RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp, bottomStart = if (isMe) 18.dp else 4.dp, bottomEnd = if (isMe) 4.dp else 18.dp)

@OptIn(ExperimentalFoundationApi::class, ExperimentalLayoutApi::class)
@Composable
private fun MessageRow(m: ChatMessageDto, receipt: ChatRich.Receipt?, ui: ChatUi, actions: ChatActions, onView: (ViewerTarget) -> Unit) {
    val isMe = m.sender_id == ui.myId
    val tools = ui.tools(m)
    val canPlay = !m.isDeleted && !m.isVoice && tools.inline.any { it.id == "play" }
    val haptic = LocalHapticFeedback.current
    val highlighted = ui.highlightId == m.id
    val ring by animateColorAsState(if (highlighted) Palette.Gold else Color.Transparent, tween(250), label = "hl")
    val bubbleColor = if (m.isDeleted) Lab.colors.faint else if (isMe) Lab.colors.accent else Lab.colors.card
    val textColor = if (m.isDeleted) Lab.colors.muted else if (isMe) Color.White else Lab.colors.ink
    val searchQuery = ui.search?.query?.takeIf { it.isNotBlank() && highlighted }
    BubbleColumn(isMe, m.sender.name, m.sender_id == CLAUDE_USER_ID) {
        m.reply_to?.let { r ->
            Column(Modifier.padding(bottom = 2.dp).clip(RoundedCornerShape(10.dp)).background(Lab.colors.faint).clickable { actions.onJumpTo(r.id) }.padding(horizontal = 10.dp, vertical = 5.dp)) {
                Text(r.sender.name ?: "Unknown", style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold, color = Lab.colors.muted)
                Text(if (!r.deleted_at.isNullOrEmpty()) "Message deleted" else ChatLogic.truncate(r.content.ifEmpty { "📎 Attachment" }, 60), style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, maxLines = 2)
            }
        }
        Box(
            Modifier
                .border(2.dp, ring, bubbleShape(isMe))
                .clip(bubbleShape(isMe))
                .background(bubbleColor)
                .combinedClickable(
                    enabled = !m.isDeleted,
                    onClick = { if (m.isImage) onView(ViewerTarget(m, null)) },
                    onLongClick = { haptic.performHapticFeedback(HapticFeedbackType.LongPress); actions.onOpenSheet(ChatSheet.Actions(m)) },
                ),
        ) {
            when {
                m.isDeleted -> Text("Message deleted", color = textColor, fontStyle = FontStyle.Italic, fontSize = 16.sp, modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp))
                m.isImage -> Column {
                    val a = m.attachment!!
                    ChatPhoto(key = m.id, width = a.width, height = a.height) { side -> actions.loadImage(m, side) }
                    if (m.content.isNotBlank()) Text(highlight(m.content, searchQuery), color = textColor, fontSize = 17.sp, lineHeight = 24.sp, modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp))
                }
                m.isVoice -> VoiceBubble(m.id, m, null, m.attachment!!.duration_ms, isMe, ui, actions)
                else -> TextBody(m, isMe, textColor, searchQuery, ui, actions)
            }
        }
        if (m.isVoice) Transcript(m, isMe, ui, actions)
        if (m.reactions.isNotEmpty() && !m.isDeleted) {
            Row(Modifier.padding(top = 2.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                m.reactions.forEach { r ->
                    val mine = r.users.any { it.id == ui.myId }
                    Text(
                        r.emoji + if (r.count > 1) " ${r.count}" else "",
                        fontSize = 14.sp,
                        modifier = Modifier.clip(RoundedCornerShape(12.dp)).background(if (mine) Lab.colors.accentSoft else Lab.colors.card)
                            .border(1.dp, if (mine) Lab.colors.accent else Lab.colors.cardBorder, RoundedCornerShape(12.dp))
                            .bouncyClickable { actions.onReact(m, r.emoji) }.padding(horizontal = 8.dp, vertical = 3.dp),
                    )
                }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (!m.pinned_at.isNullOrEmpty() && !m.isDeleted) Text("📌 ", fontSize = 11.sp)
            Text(ChatLogic.formatTime(m.created_at), style = MaterialTheme.typography.labelSmall, color = Lab.colors.muted)
            if (!m.edited_at.isNullOrEmpty() && !m.isDeleted) Text(" · edited", style = MaterialTheme.typography.labelSmall, color = Lab.colors.muted)
            if (m.recording_url != null) Text(" 🎤", fontSize = 12.sp)
            if (ui.checkingId == m.id) Status("Checking…")
            if (ui.translatingId == m.id) Status("Translating…")
            if (!m.isDeleted) {
                ToolButton("↩", "Reply") { actions.onReply(m) }
                if (canPlay) ToolButton(if (ui.playingId == m.id) "⏹" else "🔊", if (ui.playingId == m.id) "Stop audio" else "Play audio", enabled = ui.online || ui.playingId == m.id) { actions.onPlay(m) }
                ToolButton("⋯", "More actions") { actions.onOpenSheet(ChatSheet.Actions(m)) }
            }
        }
        receipt?.let { ReceiptLine(it) }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TextBody(m: ChatMessageDto, isMe: Boolean, textColor: Color, query: String?, ui: ChatUi, actions: ChatActions) {
    val tools = ui.tools(m)
    val seg = ui.segmentations[m.id]
    Box(Modifier.padding(horizontal = 14.dp, vertical = 10.dp)) {
        if (!isMe && tools.hasChinese && m.id in ui.wordByWord && seg != null) {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    seg.segmentation.chunks.forEach { chunk ->
                        Text(
                            chunk.hanzi, fontSize = 18.sp, color = Lab.colors.ink,
                            modifier = Modifier.clip(RoundedCornerShape(6.dp)).background(Lab.colors.accentSoft).clickable { actions.onWord(chunk.hanzi, m.content) }.padding(horizontal = 5.dp, vertical = 2.dp),
                        )
                    }
                }
                Text(m.translation ?: seg.translation.ifEmpty { seg.segmentation.english }, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted)
            }
        } else {
            val invite = ChatLogic.callInvite(m.content)
            Column {
                Row(verticalAlignment = Alignment.Bottom) {
                    Text(highlight(invite?.first ?: m.content, query), color = textColor, fontSize = 17.sp, lineHeight = 24.sp, modifier = Modifier.weight(1f, fill = false))
                    val status = ui.checkStatus(m)
                    if (isMe && status != null) {
                        Spacer(Modifier.width(6.dp))
                        Text(
                            if (status == "correct") "✓" else "⚠",
                            color = if (status == "correct") Palette.Good else Palette.Hard,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier.clip(CircleShape).background(Color.White).clickable { actions.onViewCheck(m) }.padding(horizontal = 6.dp, vertical = 1.dp),
                        )
                    }
                }
                invite?.let { (_, callId) ->
                    Spacer(Modifier.height(6.dp))
                    Text("📹 Join the call", color = if (isMe) Color.White else Lab.colors.accent, fontWeight = FontWeight.Bold, modifier = Modifier.clip(RoundedCornerShape(10.dp)).clickable { actions.onJoinCall(callId) }.padding(vertical = 4.dp))
                }
            }
        }
    }
}

/** The search query marked in the text (case-insensitive). */
@Composable
private fun highlight(text: String, query: String?) = buildAnnotatedString {
    val q = query?.trim()?.lowercase()
    if (q.isNullOrEmpty()) { append(text); return@buildAnnotatedString }
    val lower = text.lowercase()
    var i = 0
    while (i < text.length) {
        val j = lower.indexOf(q, i)
        if (j < 0 || lower.length != text.length) { append(text.substring(i)); break }
        append(text.substring(i, j))
        withStyle(SpanStyle(background = Palette.Gold.copy(alpha = 0.55f), color = Color.Black)) { append(text.substring(j, j + q.length)) }
        i = j + q.length
    }
}

@Composable
private fun ReceiptLine(r: ChatRich.Receipt) {
    Text(
        r.label,
        style = MaterialTheme.typography.labelSmall,
        fontWeight = if (r == ChatRich.Receipt.SEEN) FontWeight.SemiBold else FontWeight.Normal,
        color = if (r == ChatRich.Receipt.SEEN) Lab.colors.accent else Lab.colors.muted,
        modifier = Modifier.padding(end = 4.dp).testTag("chat-receipt"),
    )
}

/** My unconfirmed send: the outbox row — a clock while it goes, "Not sent · Tap to retry" when it gave up. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun PendingRow(p: PendingBubble, ui: ChatUi, actions: ChatActions, onView: (ViewerTarget) -> Unit) {
    val reply = p.replyToId?.let { id -> ui.messages.firstOrNull { it.id == id } }
    BubbleColumn(isMe = true, sender = null, isClaude = false) {
        reply?.let { r ->
            Column(Modifier.padding(bottom = 2.dp).clip(RoundedCornerShape(10.dp)).background(Lab.colors.faint).padding(horizontal = 10.dp, vertical = 5.dp)) {
                Text(r.sender.name ?: "Unknown", style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold, color = Lab.colors.muted)
                Text(ChatLogic.truncate(previewOf(r), 60), style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, maxLines = 2)
            }
        }
        Box(
            Modifier.clip(bubbleShape(true)).background(if (p.failed) Lab.colors.accent.copy(alpha = 0.55f) else Lab.colors.accent.copy(alpha = if (p.delivered) 1f else 0.82f))
                .combinedClickable(onClick = { if (p.failed) actions.onRetryPending(p.clientId) else if (p.kind == "image") onView(ViewerTarget(null, p.filePath)) }, onLongClick = { if (p.failed) actions.onDiscardPending(p.clientId) })
                .testTag("chat-pending"),
        ) {
            when (p.kind) {
                "image" -> Column {
                    ChatPhoto(key = "p-" + p.clientId, width = p.width, height = p.height) { side -> p.filePath?.let { actions.loadLocalImage(it, side) } }
                    if (p.content.isNotBlank()) Text(p.content, color = Color.White, fontSize = 17.sp, lineHeight = 24.sp, modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp))
                }
                "voice" -> VoiceBubble("p-" + p.clientId, null, p.filePath, p.durationMs ?: 0, true, ui, actions)
                else -> Text(p.content, color = Color.White, fontSize = 17.sp, lineHeight = 24.sp, modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp))
            }
        }
        if (p.failed) {
            Text(
                "Not sent · Tap to retry", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold, color = Palette.Again,
                modifier = Modifier.heightIn(min = 32.dp).clip(RoundedCornerShape(8.dp)).clickable { actions.onRetryPending(p.clientId) }.padding(horizontal = 4.dp, vertical = 6.dp).testTag("chat-not-sent"),
            )
        } else {
            Text(if (p.delivered) "Sent ✓" else "🕓 Sending…", style = MaterialTheme.typography.labelSmall, color = Lab.colors.muted, modifier = Modifier.padding(end = 4.dp, top = 2.dp))
        }
    }
}

/** A photo sized by its aspect ratio; a soft placeholder until the cache / download has it. */
@Composable
private fun ChatPhoto(key: String, width: Int, height: Int, load: suspend (Int) -> ImageBitmap?) {
    val (w, h) = ChatMediaSizing.bubbleSize(width, height)
    val bitmap by produceState<ImageBitmap?>(null, key) { value = runCatching { load(720) }.getOrNull() }
    Box(Modifier.size(w.dp, h.dp).background(Lab.colors.faint), contentAlignment = Alignment.Center) {
        val b = bitmap
        if (b != null) Image(b, contentDescription = "Photo", contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        else Text("📷", fontSize = 28.sp, modifier = Modifier.alpha(0.5f))
    }
}

/** ▶/⏸, a progress bar that fills as it plays, and the duration. */
@Composable
private fun VoiceBubble(playId: String, m: ChatMessageDto?, localPath: String?, durationMs: Long, isMe: Boolean, ui: ChatUi, actions: ChatActions) {
    val v = ui.voice?.takeIf { it.id == playId }
    val fg = if (isMe) Color.White else Lab.colors.accent
    val track = if (isMe) Color.White.copy(alpha = 0.35f) else Lab.colors.accentSoft
    val total = (v?.durationMs ?: durationMs).coerceAtLeast(1)
    val progress by animateFloatAsState(((v?.positionMs ?: 0).toFloat() / total).coerceIn(0f, 1f), tween(80), label = "voice")
    Row(Modifier.width(236.dp).padding(horizontal = 8.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier.size(44.dp).clip(CircleShape).background(if (isMe) Color.White.copy(alpha = 0.22f) else Lab.colors.accentSoft)
                .bouncyClickable(pressedScale = 0.88f) { actions.onToggleVoice(playId, m, localPath, durationMs) }.testTag("chat-voice-play"),
            contentAlignment = Alignment.Center,
        ) {
            if (v?.loading == true) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = fg)
            else Text(if (v?.playing == true) "⏸" else "▶", color = fg, fontSize = 18.sp, fontWeight = FontWeight.Bold)
        }
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            VoiceWave(progress, fg, track, seed = playId.hashCode())
            Spacer(Modifier.height(4.dp))
            Text(
                if (v != null && (v.playing || v.positionMs > 0)) ChatRich.duration(v.positionMs) + " / " + ChatRich.duration(total) else ChatRich.duration(durationMs),
                style = MaterialTheme.typography.labelSmall, color = if (isMe) Color.White.copy(alpha = 0.85f) else Lab.colors.muted,
            )
        }
    }
}

/** A "waveform-ish" bar: fixed per message (seeded), filled up to [progress]. */
@Composable
private fun VoiceWave(progress: Float, fg: Color, track: Color, seed: Int) {
    val bars = remember(seed) { val r = java.util.Random(seed.toLong()); List(28) { 0.3f + r.nextFloat() * 0.7f } }
    Row(Modifier.fillMaxWidth().height(24.dp), horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.CenterVertically) {
        bars.forEachIndexed { i, f ->
            val on = (i + 0.5f) / bars.size <= progress
            Box(Modifier.weight(1f).fillMaxHeight(f).clip(RoundedCornerShape(2.dp)).background(if (on) fg else track))
        }
    }
}

/** Under a voice bubble: "Transcribing…", the transcript (hanzi), then the translation behind a toggle. */
@Composable
private fun Transcript(m: ChatMessageDto, isMe: Boolean, ui: ChatUi, actions: ChatActions) {
    val a = m.attachment ?: return
    Column(Modifier.padding(top = 4.dp).widthIn(max = 300.dp).clip(RoundedCornerShape(12.dp)).background(Lab.colors.card).border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(12.dp)).padding(horizontal = 12.dp, vertical = 8.dp)) {
        when (a.transcript_status) {
            "done" -> {
                val t = a.transcript?.trim().orEmpty()
                if (t.isEmpty()) Text("No speech heard", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, fontStyle = FontStyle.Italic)
                else Text(highlight(t, ui.search?.query?.takeIf { ui.highlightId == m.id }), fontSize = 17.sp, lineHeight = 24.sp, color = Lab.colors.ink)
                val tr = a.translation?.takeIf { it.isNotBlank() }
                if (tr != null) {
                    val open = m.id in ui.translationsShown
                    AnimatedVisibility(open) { Text(tr, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted, modifier = Modifier.padding(top = 4.dp)) }
                    Text(
                        if (open) "Hide translation" else "Translate", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold, color = Lab.colors.accent,
                        modifier = Modifier.padding(top = 2.dp).heightIn(min = 36.dp).clip(RoundedCornerShape(8.dp)).clickable { actions.onToggleTranslation(m.id) }.wrapContentHeight(Alignment.CenterVertically).testTag("chat-voice-translate"),
                    )
                }
            }
            "failed" -> Text("Couldn't transcribe this one", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, fontStyle = FontStyle.Italic)
            else -> Row(verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(12.dp), strokeWidth = 1.5.dp, color = Lab.colors.accent)
                Text("  Transcribing…", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
            }
        }
    }
}

@Composable
private fun Status(text: String) {
    Spacer(Modifier.width(6.dp))
    CircularProgressIndicator(Modifier.size(12.dp), strokeWidth = 1.5.dp, color = Lab.colors.accent)
    Text(" $text", style = MaterialTheme.typography.labelSmall, color = Lab.colors.muted)
}

@Composable
private fun ToolButton(label: String, description: String, enabled: Boolean = true, onClick: () -> Unit) {
    Box(
        Modifier.size(44.dp).clip(CircleShape).clickable(enabled = enabled, onClickLabel = description, onClick = onClick).alpha(if (enabled) 1f else 0.4f),
        contentAlignment = Alignment.Center,
    ) { Text(label, fontSize = 16.sp, color = Lab.colors.muted) }
}

/** Three bouncing dots (Claude thinking, or "<name> is typing…"). */
@Composable
private fun TypingBubble(name: String, isClaude: Boolean, label: String?) {
    val t = rememberInfiniteTransition(label = "typing")
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.testTag("chat-typing")) {
        Avatar(name, null, size = 30.dp, isClaude = isClaude)
        Spacer(Modifier.width(6.dp))
        Row(Modifier.clip(RoundedCornerShape(18.dp)).background(Lab.colors.card).padding(horizontal = 16.dp, vertical = 14.dp), horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            repeat(3) { i ->
                val y by t.animateFloat(0f, -5f, infiniteRepeatable(tween(380, delayMillis = i * 130), RepeatMode.Reverse), label = "dot$i")
                val a by t.animateFloat(0.35f, 1f, infiniteRepeatable(tween(380, delayMillis = i * 130), RepeatMode.Reverse), label = "dota$i")
                Box(Modifier.graphicsLayer { translationY = y * density }.size(8.dp).alpha(a).clip(CircleShape).background(Lab.colors.muted))
            }
        }
        label?.let {
            Spacer(Modifier.width(8.dp))
            Text(it, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, fontStyle = FontStyle.Italic)
        }
    }
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

@Composable
private fun Composer(ui: ChatUi, actions: ChatActions) {
    val rich = !ui.isAi
    Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (ui.recorder is RecorderUi.Idle && ui.editing == null) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                LabChip(if (ui.generatingOptions) "💡 Thinking…" else "💡 Help me say it", enabled = ui.online && ui.messages.isNotEmpty() && !ui.generatingOptions) { actions.onOpenSheet(ChatSheet.HelpMeSayIt) }
                if (!ui.online) Text(if (rich) "  Offline — sends when you're back" else "  Chat tools need internet", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
            }
        }
        if (!ui.online && ui.isAi) InlineNotice("You're offline. Messages to Claude can't be sent until you're back online.", kind = NoticeKind.Offline)
        ui.notice?.let { InlineNotice(it.text, kind = if (it.error) NoticeKind.Error else NoticeKind.Success, actionLabel = "×", onAction = actions.onDismissNotice) }
        if (ui.preparingPhoto) Row(verticalAlignment = Alignment.CenterVertically) {
            CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp, color = Lab.colors.accent)
            Text("  Preparing the photo…", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
        }
        Row(verticalAlignment = Alignment.Bottom) {
            when (val r = ui.recorder) {
                is RecorderUi.Preview -> VoicePreviewBar(r, ui, actions, Modifier.weight(1f))
                is RecorderUi.Recording -> RecordingBar(r, actions, Modifier.weight(1f))
                RecorderUi.Idle -> {
                    if (rich && ui.editing == null) {
                        RoundIcon("📎", "Attach a photo", Modifier.testTag("chat-attach")) { actions.onOpenSheet(ChatSheet.Attach) }
                        Spacer(Modifier.width(4.dp))
                    }
                    OutlinedTextField(
                        ui.draft, actions.onDraft,
                        placeholder = { Text(if (ui.isAi) "Type in Chinese..." else if (ui.editing != null) "Edit your message" else "Message") },
                        maxLines = 5,
                        shape = RoundedCornerShape(22.dp),
                        colors = OutlinedTextFieldDefaults.colors(focusedContainerColor = Lab.colors.card, unfocusedContainerColor = Lab.colors.card),
                        modifier = Modifier.weight(1f).testTag("chat-input"),
                    )
                }
            }
            Spacer(Modifier.width(8.dp))
            val showMic = rich && ui.editing == null && ui.draft.isBlank() && ui.recorder !is RecorderUi.Preview
            if (showMic) MicButton(ui.recorder, actions)
            else if (ui.recorder is RecorderUi.Preview) PrimaryPill("Send", Modifier.height(52.dp).testTag("chat-voice-send"), onClick = actions.onRecordSend)
            else PrimaryPill(
                if (ui.sending || ui.waitingForAi) "…" else if (ui.editing != null) "Save" else "Send",
                Modifier.height(52.dp).testTag("chat-send"),
                enabled = ui.draft.isNotBlank() && !ui.sending && !ui.waitingForAi && (ui.online || rich && ui.editing == null),
                onClick = actions.onSend,
            )
        }
    }
}

@Composable
private fun RoundIcon(label: String, description: String, modifier: Modifier = Modifier, enabled: Boolean = true, onClick: () -> Unit) {
    Box(
        modifier.size(48.dp).clip(CircleShape).bouncyClickable(enabled = enabled, pressedScale = 0.85f, onClick = onClick).alpha(if (enabled) 1f else 0.4f),
        contentAlignment = Alignment.Center,
    ) { Text(label, fontSize = 22.sp, color = Lab.colors.muted, modifier = Modifier.semantics { contentDescription = description }) }
}

/**
 * The mic: press and hold to record (slide left to cancel, up to lock), or tap to record hands-free;
 * while hands-free it is the ■ stop button. One element for every state, so the gesture survives
 * the composer changing around it.
 */
@Composable
private fun MicButton(recorder: RecorderUi, actions: ChatActions) {
    val state by rememberUpdatedState(recorder)
    val acts by rememberUpdatedState(actions)
    val density = LocalDensity.current
    val cancelPx = with(density) { 110.dp.toPx() }
    val lockPx = with(density) { 80.dp.toPx() }
    var drag by remember { mutableFloatStateOf(0f) }
    val recording = recorder as? RecorderUi.Recording
    val holding = recording != null && !recording.locked
    val scale by animateFloatAsState(if (holding) 1.35f + (recording?.level ?: 0f) * 0.25f else 1f, spring(Spring.DampingRatioMediumBouncy), label = "mic")
    Box(contentAlignment = Alignment.Center) {
        if (holding) {
            // The lock hint above the finger.
            Text("🔒\n↑", fontSize = 13.sp, color = Lab.colors.muted, lineHeight = 15.sp, modifier = Modifier.offset(y = (-64).dp).clip(RoundedCornerShape(14.dp)).background(Lab.colors.card).padding(horizontal = 8.dp, vertical = 6.dp))
        }
        Box(
            Modifier.offset { IntOffset(drag.roundToInt().coerceAtMost(0), 0) }
                .size(52.dp).scale(scale).clip(CircleShape)
                .background(if (recording != null) Palette.Again else Lab.colors.accent)
                .testTag("chat-mic")
                .pointerInput(Unit) {
                    awaitEachGesture {
                        val down = awaitFirstDown()
                        val now = state
                        if (now is RecorderUi.Recording && now.locked) { acts.onRecordFinish(); return@awaitEachGesture }
                        if (now !is RecorderUi.Idle) return@awaitEachGesture
                        if (!acts.onRecordStart(false)) return@awaitEachGesture
                        val t0 = down.uptimeMillis
                        var cancelled = false
                        var locked = false
                        var upAt = t0
                        while (true) {
                            val ev = awaitPointerEvent()
                            val c = ev.changes.firstOrNull { it.id == down.id } ?: break
                            val dx = c.position.x - down.position.x
                            val dy = c.position.y - down.position.y
                            if (!locked) drag = dx
                            if (!locked && dx < -cancelPx) { cancelled = true; acts.onRecordCancel(); break }
                            if (!locked && dy < -lockPx) { locked = true; drag = 0f; acts.onRecordLock() }
                            if (!c.pressed) { upAt = c.uptimeMillis; break }
                            c.consume()
                        }
                        drag = 0f
                        if (!cancelled && !locked) {
                            // A quick tap = hands-free; a hold released = the preview.
                            if (upAt - t0 < TAP_MS) acts.onRecordLock() else acts.onRecordFinish()
                        }
                    }
                },
            contentAlignment = Alignment.Center,
        ) {
            Text(if (recording?.locked == true) "■" else "🎤", fontSize = if (recording?.locked == true) 20.sp else 22.sp, color = Color.White)
        }
    }
}

private const val TAP_MS = 280L

@Composable
private fun RecordingBar(r: RecorderUi.Recording, actions: ChatActions, modifier: Modifier) {
    val t = rememberInfiniteTransition(label = "rec")
    val blink by t.animateFloat(1f, 0.25f, infiniteRepeatable(tween(600), RepeatMode.Reverse), label = "blink")
    Row(modifier.heightIn(min = 52.dp).clip(RoundedCornerShape(26.dp)).background(Lab.colors.card).padding(horizontal = 14.dp).testTag("chat-recording"), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(10.dp).alpha(blink).clip(CircleShape).background(Palette.Again))
        Spacer(Modifier.width(8.dp))
        Text(ChatRich.duration(r.elapsedMs), fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, fontSize = 16.sp)
        Spacer(Modifier.width(10.dp))
        // A live level meter.
        val lv by animateFloatAsState(r.level, tween(90), label = "lv")
        Box(Modifier.width(40.dp).height(6.dp).clip(RoundedCornerShape(3.dp)).background(Lab.colors.faint)) {
            Box(Modifier.fillMaxHeight().fillMaxWidth(lv.coerceIn(0.05f, 1f)).background(Palette.Again.copy(alpha = 0.7f)))
        }
        Spacer(Modifier.weight(1f))
        if (r.locked) {
            Text(
                "Cancel", color = Palette.Again, fontWeight = FontWeight.SemiBold,
                modifier = Modifier.heightIn(min = 44.dp).clip(RoundedCornerShape(10.dp)).clickable { actions.onRecordCancel() }.padding(horizontal = 8.dp, vertical = 12.dp),
            )
        } else {
            Text("‹ Slide to cancel", color = Lab.colors.muted, style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun VoicePreviewBar(p: RecorderUi.Preview, ui: ChatUi, actions: ChatActions, modifier: Modifier) {
    Row(modifier.heightIn(min = 52.dp).clip(RoundedCornerShape(26.dp)).background(Lab.colors.card).border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(26.dp)), verticalAlignment = Alignment.CenterVertically) {
        RoundIcon("🗑", "Discard the recording") { actions.onRecordCancel() }
        Box(Modifier.weight(1f)) { VoiceBubble(PREVIEW_ID, null, p.path, p.durationMs, false, ui, actions) }
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
