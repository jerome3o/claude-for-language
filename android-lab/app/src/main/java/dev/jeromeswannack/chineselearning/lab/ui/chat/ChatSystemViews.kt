package dev.jeromeswannack.chineselearning.lab.ui.chat

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.chat.SystemMessages
import dev.jeromeswannack.chineselearning.lab.data.api.ChatMessageDto
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/**
 * A system message (docs/CHAT.md "System messages", core SystemMessages — parity-tested): a line the
 * app posted on someone's behalf ("Minghui set your new cards to 2 a day (+5 extra)", "Minghui started
 * a video call · Join", "Jerome flagged 银行 for you"). A centred, muted row like the day pills — never
 * a bubble: no ticks, reactions, listening-mode hiding, read-aloud or word chips. Long press = Copy.
 */
@Composable
fun SystemMessageRow(m: ChatMessageDto, ui: ChatUi, actions: ChatActions) {
    val view = ui.systemView(m) ?: return
    SystemMessageView(
        view, ChatLogic.formatTime(m.created_at),
        onAction = { path -> actions.onOpenPath(path, view.kind) },
        onLongPress = { actions.onOpenSheet(ChatSheet.Actions(m)) },
        modifier = Modifier.testTag("chat-system-${m.id}"),
    )
}

/** The row itself (stateless; screenshot-tested). */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun SystemMessageView(
    view: SystemMessages.View,
    time: String,
    onAction: (String) -> Unit = {},
    onLongPress: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val c = chatColors()
    val haptic = LocalHapticFeedback.current
    var open by rememberSaveable { mutableStateOf(false) }
    val bg = if (view.quiet) Color.Transparent else c.dayPill
    val ink = if (view.quiet) c.dayText.copy(alpha = 0.75f) else c.dayText
    Box(modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp).testTag("chat-system"), contentAlignment = Alignment.Center) {
        Column(
            Modifier.widthIn(max = 420.dp).clip(RoundedCornerShape(14.dp)).background(bg)
                .combinedClickable(onClick = {}, onLongClick = {
                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                    onLongPress()
                })
                .padding(horizontal = 14.dp, vertical = 7.dp)
                .animateContentSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(
                buildAnnotatedString {
                    if (view.icon.isNotEmpty() && view.kind != "unknown") append(view.icon + " ")
                    withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(view.text) }
                    withStyle(SpanStyle(fontSize = 11.sp, color = ink.copy(alpha = 0.7f))) { append("  " + time.replace(' ', ' ')) }
                },
                style = MaterialTheme.typography.bodySmall, color = ink, textAlign = TextAlign.Center,
            )
            view.quote?.let {
                Text("“$it”", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink, textAlign = TextAlign.Center, modifier = Modifier.testTag("chat-system-quote"))
            }
            view.body?.let { body ->
                if (open) Text(body, style = MaterialTheme.typography.bodySmall, color = ink, modifier = Modifier.fillMaxWidth())
                Text(
                    if (open) "Hide" else if (view.kind == "install_howto") "Show the steps" else "More",
                    style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold, color = c.mine,
                    modifier = Modifier.clip(RoundedCornerShape(16.dp)).bouncyClickable { open = !open }.heightIn(min = 36.dp).padding(horizontal = 10.dp, vertical = 8.dp),
                )
            }
            view.action?.let { a ->
                Row(
                    Modifier.heightIn(min = 40.dp).clip(RoundedCornerShape(20.dp)).background(c.mine)
                        .bouncyClickable { onAction(a.path) }.padding(horizontal = 18.dp, vertical = 9.dp).testTag("chat-system-action"),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(a.label, color = c.onMine, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.labelLarge)
                }
            }
        }
    }
}
