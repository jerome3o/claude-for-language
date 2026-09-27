package dev.jeromeswannack.chineselearning.lab.ui.chat

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.data.api.CLAUDE_USER_ID
import dev.jeromeswannack.chineselearning.lab.data.api.ChatMessageDto
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
)

/**
 * The chat (web: ChatPage) — immersive: header, messages grouped by day, the composer.
 * Per message: Reply and Play inline, everything else under ⋯ / long-press (MessageTools).
 */
@Composable
fun ChatScreen(ui: ChatUi, actions: ChatActions, sheets: @Composable () -> Unit = {}) {
    LabScreenFrame { Column(Modifier.fillMaxSize()) {
        ChatHeader(ui, actions)
        if (ui.isAi && !ui.conversation?.scenario.isNullOrBlank()) ScenarioBanner(ui)
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when {
                ui.loading && ui.messages.isEmpty() -> LoadingState()
                ui.loadError != null && ui.messages.isEmpty() -> ErrorState(ui.loadError, onRetry = actions.onRetry)
                else -> MessageList(ui, actions)
            }
        }
        ReplyBar(ui.replyingTo, actions)
        Composer(ui, actions)
    } }
    sheets()
}

@Composable
private fun ChatHeader(ui: ChatUi, actions: ChatActions) {
    Row(Modifier.fillMaxWidth().padding(start = 4.dp, end = 8.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
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
            ui.conversation?.title?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, maxLines = 1, overflow = TextOverflow.Ellipsis) }
        }
        SmallButton(if (ui.generatingCard) "…" else "+ Card", enabled = ui.online && ui.messages.isNotEmpty() && !ui.generatingCard, busy = ui.generatingCard, onClick = actions.onGenerateCard)
        IconButton(onClick = { actions.onOpenSheet(ChatSheet.Menu) }) { Icon(Icons.Filled.MoreVert, "Conversation menu", tint = Lab.colors.muted) }
    }
}

@Composable
private fun SmallButton(label: String, enabled: Boolean, busy: Boolean = false, onClick: () -> Unit) {
    Box(
        Modifier.heightIn(min = 40.dp).clip(RoundedCornerShape(20.dp)).border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(20.dp))
            .bouncyClickable(enabled = enabled, onClick = onClick).alpha(if (enabled || busy) 1f else 0.45f).padding(horizontal = 14.dp, vertical = 9.dp),
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

@Composable
private fun MessageList(ui: ChatUi, actions: ChatActions) {
    val groups = ChatLogic.groupByDate(ui.messages)
    val state = rememberLazyListState()
    val total = (if (ui.offlineHistory) 1 else 0) + (if (ui.messages.isEmpty()) 1 else 0) + groups.size + ui.messages.size + (if (ui.waitingForAi) 1 else 0)
    LaunchedEffect(total) { if (total > 0) state.animateScrollToItem(total - 1) }
    LazyColumn(Modifier.fillMaxSize().testTag("chat-messages"), state = state, contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (ui.offlineHistory) item { OfflineNotice() }
        if (ui.messages.isEmpty()) {
            item { EmptyState(if (ui.isAi) "🤖" else "💬", if (ui.isAi) "Start practicing Chinese!" else "Start the conversation!") }
        }
        for (g in groups) {
            item(key = "d-${g.messages.first().id}") { DateDivider(g.label) }
            items(g.messages, key = { it.id }) { m -> MessageRow(m, ui, actions) }
        }
        if (ui.waitingForAi) item(key = "typing") { TypingBubble() }
    }
}

@Composable
private fun DateDivider(label: String) {
    Box(Modifier.fillMaxWidth().padding(vertical = 8.dp), contentAlignment = Alignment.Center) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted, modifier = Modifier.clip(RoundedCornerShape(10.dp)).background(Lab.colors.faint).padding(horizontal = 10.dp, vertical = 3.dp))
    }
}

@OptIn(ExperimentalFoundationApi::class, ExperimentalLayoutApi::class)
@Composable
private fun MessageRow(m: ChatMessageDto, ui: ChatUi, actions: ChatActions) {
    val isMe = m.sender_id == ui.myId
    val tools = ui.tools(m)
    val canPlay = tools.inline.any { it.id == "play" }
    val haptic = LocalHapticFeedback.current
    val bubbleColor = if (isMe) Lab.colors.accent else Lab.colors.card
    val textColor = if (isMe) Color.White else Lab.colors.ink
    Row(Modifier.fillMaxWidth().testTag("chat-message"), horizontalArrangement = if (isMe) Arrangement.End else Arrangement.Start, verticalAlignment = Alignment.Top) {
        if (!isMe) {
            Avatar(m.sender.name, null, size = 30.dp, isClaude = m.sender_id == CLAUDE_USER_ID)
            Spacer(Modifier.width(6.dp))
        }
        Column(Modifier.widthIn(max = 520.dp).fillMaxWidth(0.82f), horizontalAlignment = if (isMe) Alignment.End else Alignment.Start) {
            m.reply_to?.let { r ->
                Column(Modifier.padding(bottom = 2.dp).clip(RoundedCornerShape(10.dp)).background(Lab.colors.faint).padding(horizontal = 10.dp, vertical = 5.dp)) {
                    Text(r.sender.name ?: "Unknown", style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold, color = Lab.colors.muted)
                    Text(ChatLogic.truncate(r.content, 60), style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, maxLines = 2)
                }
            }
            Box(
                Modifier
                    .clip(RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp, bottomStart = if (isMe) 18.dp else 4.dp, bottomEnd = if (isMe) 4.dp else 18.dp))
                    .background(bubbleColor)
                    .combinedClickable(
                        onClick = {},
                        onLongClick = { haptic.performHapticFeedback(HapticFeedbackType.LongPress); actions.onOpenSheet(ChatSheet.Actions(m)) },
                    )
                    .padding(horizontal = 14.dp, vertical = 10.dp),
            ) {
                val seg = ui.segmentations[m.id]
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
                            Text(invite?.first ?: m.content, color = textColor, fontSize = 17.sp, lineHeight = 24.sp, modifier = Modifier.weight(1f, fill = false))
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
            if (m.reactions.isNotEmpty()) {
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
                Text(ChatLogic.formatTime(m.created_at), style = MaterialTheme.typography.labelSmall, color = Lab.colors.muted)
                if (m.recording_url != null) Text(" 🎤", fontSize = 12.sp)
                if (ui.checkingId == m.id) Status("Checking…")
                if (ui.translatingId == m.id) Status("Translating…")
                ToolButton("↩", "Reply") { actions.onReply(m) }
                if (canPlay) ToolButton(if (ui.playingId == m.id) "⏹" else "🔊", if (ui.playingId == m.id) "Stop audio" else "Play audio", enabled = ui.online || ui.playingId == m.id) { actions.onPlay(m) }
                ToolButton("⋯", "More actions") { actions.onOpenSheet(ChatSheet.Actions(m)) }
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

@Composable
private fun TypingBubble() {
    val t = rememberInfiniteTransition(label = "typing")
    Row(verticalAlignment = Alignment.CenterVertically) {
        Avatar("Claude", null, size = 30.dp, isClaude = true)
        Spacer(Modifier.width(6.dp))
        Row(Modifier.clip(RoundedCornerShape(18.dp)).background(Lab.colors.card).padding(horizontal = 16.dp, vertical = 14.dp), horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            repeat(3) { i ->
                val a by t.animateFloat(0.25f, 1f, infiniteRepeatable(tween(500, delayMillis = i * 150), RepeatMode.Reverse), label = "dot$i")
                Box(Modifier.size(8.dp).alpha(a).clip(CircleShape).background(Lab.colors.muted))
            }
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
                Text(ChatLogic.truncate(r.content, 80), style = MaterialTheme.typography.bodySmall, color = Lab.colors.ink, maxLines = 2)
            }
            ToolButton("×", "Cancel reply") { actions.onReply(null) }
        }
    }
}

@Composable
private fun Composer(ui: ChatUi, actions: ChatActions) {
    Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            LabChip(if (ui.generatingOptions) "💡 Thinking…" else "💡 Help me say it", enabled = ui.online && ui.messages.isNotEmpty() && !ui.generatingOptions) { actions.onOpenSheet(ChatSheet.HelpMeSayIt) }
            if (!ui.online) Text("  Chat tools need internet", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
        }
        if (!ui.online) InlineNotice("You're offline. Messages can't be sent until you're back online (nothing is queued).", kind = NoticeKind.Offline)
        ui.notice?.let { InlineNotice(it.text, kind = if (it.error) NoticeKind.Error else NoticeKind.Success, actionLabel = "×", onAction = actions.onDismissNotice) }
        Row(verticalAlignment = Alignment.Bottom) {
            OutlinedTextField(
                ui.draft, actions.onDraft,
                placeholder = { Text(if (ui.isAi) "Type in Chinese..." else "Type a message...") },
                maxLines = 5,
                shape = RoundedCornerShape(22.dp),
                colors = OutlinedTextFieldDefaults.colors(focusedContainerColor = Lab.colors.card, unfocusedContainerColor = Lab.colors.card),
                modifier = Modifier.weight(1f).testTag("chat-input"),
            )
            Spacer(Modifier.width(8.dp))
            PrimaryPill(
                if (ui.sending || ui.waitingForAi) "…" else "Send",
                Modifier.height(52.dp).testTag("chat-send"),
                enabled = ui.online && ui.draft.isNotBlank() && !ui.sending && !ui.waitingForAi,
                onClick = actions.onSend,
            )
        }
    }
}
