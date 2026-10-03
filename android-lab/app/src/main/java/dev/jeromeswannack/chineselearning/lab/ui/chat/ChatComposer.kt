package dev.jeromeswannack.chineselearning.lab.ui.chat

import androidx.compose.animation.AnimatedVisibility
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
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.ChatLearning
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import kotlinx.coroutines.delay
import kotlin.math.roundToInt

/*
 * The composer as one row (docs/CHAT.md "Round 2"):  [ + ]  [ 😊  Message…  ✓ ]  [ 🎤 | ➤ ]
 * + = the attach sheet (Camera · Photo · 💡 Help me say it); 😊 = the emoji panel (inserts at the
 * caret); ✓ = Check my Chinese (the learner's draft has Chinese); the mic becomes ➤ once there is
 * text. Hold the mic to record — release sends, slide left ≥ 100 dp cancels, slide up ≥ 80 dp
 * locks (then ■ stop → preview, ➤ send, 🗑); a quick tap only says "Hold to record".
 */

/** How far the finger slides before a recording is cancelled / locked. */
val CANCEL_SLIDE = 100.dp
val LOCK_SLIDE = 80.dp
/** Shorter than this is a tap: "Hold to record", nothing starts. */
const val HOLD_MS = 250L

/** Inserts [insert] over the selection [start]..[end] of [text]; the caret lands after it. */
fun insertAtCaret(text: String, start: Int, end: Int, insert: String): Pair<String, Int> {
    val a = start.coerceIn(0, text.length)
    val b = end.coerceIn(0, text.length)
    val lo = minOf(a, b)
    val hi = maxOf(a, b)
    return (text.substring(0, lo) + insert + text.substring(hi)) to lo + insert.length
}

@Composable
fun Composer(ui: ChatUi, actions: ChatActions) {
    val rich = !ui.isAi
    var emojiOpen by remember { mutableStateOf(false) }
    var hint by remember { mutableStateOf(0) }
    var field by remember { mutableStateOf(TextFieldValue(ui.draft, TextRange(ui.draft.length))) }
    // The draft changed from outside (sent, "Use this", edit): the field follows, caret at the end.
    val value = if (field.text == ui.draft) field else TextFieldValue(ui.draft, TextRange(ui.draft.length)).also { field = it }
    val keyboard = LocalSoftwareKeyboardController.current
    Column(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (!ui.online) Text(
            if (rich) "Offline — messages send when you're back" else "You're offline. Messages to Claude can't be sent until you're back online.",
            style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, modifier = Modifier.padding(horizontal = 8.dp),
        )
        ui.notice?.let { InlineNotice(it.text, kind = if (it.error) NoticeKind.Error else NoticeKind.Success, actionLabel = "×", onAction = actions.onDismissNotice) }
        if (ui.proposingCards) ProposingRow()
        if (ui.generatingOptions) Busy("Claude is thinking of ways to say it…")
        DraftCheckPanel(ui.draftCheck, actions)
        if (ui.preparingPhoto) Busy("Preparing the photo…")
        Box {
            Row(verticalAlignment = Alignment.Bottom) {
                val rec = ui.recorder
                when (rec) {
                    is RecorderUi.Preview -> VoicePreviewBar(rec, ui, actions, Modifier.weight(1f))
                    is RecorderUi.Recording -> RecordingBar(rec, actions, Modifier.weight(1f))
                    RecorderUi.Idle -> {
                        if (ui.editing == null) {
                            RoundIcon("+", "Attach", Modifier.testTag("chat-attach")) { emojiOpen = false; actions.onOpenSheet(ChatSheet.Attach) }
                            Spacer(Modifier.width(2.dp))
                        }
                        Field(
                            value, ui, actions,
                            onValue = { v -> field = v; if (v.text != ui.draft) actions.onDraft(v.text) },
                            emojiOpen = emojiOpen,
                            onEmoji = { emojiOpen = !emojiOpen; if (emojiOpen) keyboard?.hide() },
                            onFocus = { if (it) emojiOpen = false },
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
                Spacer(Modifier.width(6.dp))
                // ONE call site for the mic, so a hold survives the composer turning into the recording bar.
                val mic = (rec is RecorderUi.Idle && rich && ui.editing == null && ui.draft.isBlank()) || (rec is RecorderUi.Recording && !rec.locked)
                when {
                    mic -> MicButton(rec, actions) { hint++ }
                    rec is RecorderUi.Preview -> SendCircle("Send the voice message", Modifier.testTag("chat-voice-send"), onClick = actions.onRecordSend)
                    rec is RecorderUi.Recording -> SendCircle("Send the voice message", Modifier.testTag("chat-voice-send-now"), onClick = actions.onRecordSendNow)
                    else -> SendCircle(
                        if (ui.editing != null) "Save the edit" else "Send",
                        Modifier.testTag("chat-send"),
                        label = if (ui.sending || ui.waitingForAi) "…" else if (ui.editing != null) "✓" else "➤",
                        enabled = ui.draft.isNotBlank() && !ui.sending && !ui.waitingForAi && (ui.online || rich && ui.editing == null),
                        onClick = actions.onSend,
                    )
                }
            }
            HoldHint(hint, Modifier.align(Alignment.TopEnd).offset(y = (-44).dp))
        }
        AnimatedVisibility(emojiOpen && ui.recorder is RecorderUi.Idle, enter = expandVertically() + fadeIn(), exit = shrinkVertically() + fadeOut()) {
            EmojiPanel(ui.recentEmojis) { e ->
                val (text, caret) = insertAtCaret(value.text, value.selection.start, value.selection.end, e)
                field = TextFieldValue(text, TextRange(caret))
                actions.onDraft(text)
            }
        }
    }
}

@Composable
private fun Busy(text: String) {
    Row(Modifier.padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp, color = Lab.colors.accent)
        Text("  $text", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
    }
}

/** [ 😊  Message…  ✓ ] — the rounded field. */
@Composable
private fun Field(
    value: TextFieldValue,
    ui: ChatUi,
    actions: ChatActions,
    onValue: (TextFieldValue) -> Unit,
    emojiOpen: Boolean,
    onEmoji: () -> Unit,
    onFocus: (Boolean) -> Unit,
    modifier: Modifier,
) {
    val c = chatColors()
    val bg = if (c.dark) Color(0xFF26262A) else Color(0xFFF0F0F2)
    Row(modifier.heightIn(min = 48.dp).clip(RoundedCornerShape(24.dp)).background(bg), verticalAlignment = Alignment.Bottom) {
        Box(
            Modifier.size(44.dp, 48.dp).clip(CircleShape).clickable(onClickLabel = if (emojiOpen) "Keyboard" else "Emoji", onClick = onEmoji).testTag("chat-emoji"),
            contentAlignment = Alignment.Center,
        ) { Text(if (emojiOpen) "⌨️" else "😊", fontSize = 20.sp, modifier = Modifier.alpha(0.8f)) }
        Box(Modifier.weight(1f).heightIn(min = 48.dp).padding(vertical = 13.dp), contentAlignment = Alignment.CenterStart) {
            if (value.text.isEmpty()) Text(
                if (ui.isAi) "Type in Chinese..." else if (ui.editing != null) "Edit your message" else "Message",
                color = Lab.colors.ink.copy(alpha = 0.45f), fontSize = 17.sp,
            )
            BasicTextField(
                value, onValue,
                textStyle = TextStyle(fontSize = 17.sp, lineHeight = 22.sp, color = Lab.colors.ink),
                cursorBrush = SolidColor(c.mine),
                maxLines = 6,
                modifier = Modifier.fillMaxWidth().onFocusChanged { onFocus(it.isFocused) }.testTag("chat-input"),
            )
        }
        // ✓ Check my Chinese before sending (the learner's draft has Chinese).
        if (ChatLearning.canCheckDraft(ui.draft, ui.viewerRole, ui.isAi, ui.editing != null)) {
            CheckDraftButton(busy = ui.draftCheck?.loading == true, enabled = ui.online, onClick = actions.onCheckDraft)
        } else Spacer(Modifier.width(12.dp))
    }
}

/** The emoji panel under the composer: recent, then all; a tap inserts at the caret. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun EmojiPanel(recent: List<String>, onPick: (String) -> Unit) {
    Column(Modifier.fillMaxWidth().height(260.dp).verticalScroll(rememberScrollState()).padding(horizontal = 6.dp).testTag("chat-emoji-panel")) {
        if (recent.isNotEmpty()) {
            Text("Recent", style = MaterialTheme.typography.labelSmall, color = Lab.colors.muted, modifier = Modifier.padding(start = 6.dp, top = 4.dp))
            FlowRow { recent.forEach { e -> EmojiKey(e, onPick) } }
        }
        Text("All", style = MaterialTheme.typography.labelSmall, color = Lab.colors.muted, modifier = Modifier.padding(start = 6.dp, top = 4.dp))
        FlowRow { ChatLogic.FULL_EMOJIS.forEach { e -> EmojiKey(e, onPick) } }
    }
}

@Composable
private fun EmojiKey(e: String, onPick: (String) -> Unit) {
    Box(Modifier.size(46.dp).clip(CircleShape).bouncyClickable(pressedScale = 0.8f) { onPick(e) }, contentAlignment = Alignment.Center) {
        Text(e, fontSize = 24.sp)
    }
}

@Composable
fun RoundIcon(label: String, description: String, modifier: Modifier = Modifier, enabled: Boolean = true, onClick: () -> Unit) {
    Box(
        modifier.size(48.dp).clip(CircleShape).bouncyClickable(enabled = enabled, pressedScale = 0.85f, onClick = onClick).alpha(if (enabled) 1f else 0.4f),
        contentAlignment = Alignment.Center,
    ) { Text(label, fontSize = 26.sp, fontWeight = FontWeight.Light, color = Lab.colors.ink.copy(alpha = 0.7f), modifier = Modifier.semantics { contentDescription = description }) }
}

/** The round ➤ (accent blue). */
@Composable
private fun SendCircle(description: String, modifier: Modifier = Modifier, label: String = "➤", enabled: Boolean = true, onClick: () -> Unit) {
    val c = chatColors()
    Box(
        modifier.size(48.dp).clip(CircleShape).background(if (enabled) c.mine else c.mine.copy(alpha = 0.4f))
            .bouncyClickable(enabled = enabled, pressedScale = 0.88f, onClick = onClick).semantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) { Text(label, color = Color.White, fontSize = 19.sp, fontWeight = FontWeight.Bold) }
}

/** "Hold to record" after a quick tap on the mic. */
@Composable
private fun HoldHint(nonce: Int, modifier: Modifier) {
    var show by remember { mutableStateOf(false) }
    LaunchedEffect(nonce) {
        if (nonce == 0) return@LaunchedEffect
        show = true
        delay(1_600)
        show = false
    }
    AnimatedVisibility(show, modifier = modifier, enter = fadeIn(), exit = fadeOut()) {
        Text(
            "Hold to record", color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
            modifier = Modifier.clip(RoundedCornerShape(12.dp)).background(Color(0xE6202024)).padding(horizontal = 12.dp, vertical = 7.dp).testTag("chat-hold-hint"),
        )
    }
}

/**
 * The mic: hold to record (release = send, slide left = cancel, slide up = lock); a tap shorter
 * than [HOLD_MS] starts nothing and asks [onTap] to show "Hold to record".
 */
@Composable
private fun MicButton(recorder: RecorderUi, actions: ChatActions, onTap: () -> Unit) {
    val state by rememberUpdatedState(recorder)
    val acts by rememberUpdatedState(actions)
    val tap by rememberUpdatedState(onTap)
    val density = LocalDensity.current
    val cancelPx = with(density) { CANCEL_SLIDE.toPx() }
    val lockPx = with(density) { LOCK_SLIDE.toPx() }
    var dragX by remember { mutableFloatStateOf(0f) }
    var dragY by remember { mutableFloatStateOf(0f) }
    val recording = recorder as? RecorderUi.Recording
    val holding = recording != null && !recording.locked
    val scale by animateFloatAsState(if (holding) 1.35f + (recording?.level ?: 0f) * 0.25f else 1f, spring(Spring.DampingRatioMediumBouncy), label = "mic")
    val c = chatColors()
    Box(contentAlignment = Alignment.Center) {
        if (holding) {
            // The lock above the finger, rising as it slides up.
            val up = (-dragY / lockPx).coerceIn(0f, 1f)
            Text(
                "🔒\n↑", fontSize = 13.sp, color = Lab.colors.muted, lineHeight = 15.sp,
                modifier = Modifier.offset(y = (-70).dp - (up * 16).dp).clip(RoundedCornerShape(14.dp)).background(Lab.colors.card)
                    .border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(14.dp)).padding(horizontal = 8.dp, vertical = 6.dp).testTag("chat-lock-hint"),
            )
        }
        Box(
            Modifier.offset { IntOffset(dragX.roundToInt().coerceAtMost(0), 0) }
                .size(48.dp).scale(scale).clip(CircleShape)
                .background(if (recording != null) Palette.Again else c.mine)
                .testTag("chat-mic")
                .semantics { contentDescription = "Hold to record a voice message" }
                .pointerInput(Unit) {
                    awaitEachGesture {
                        val down = awaitFirstDown()
                        if (state !is RecorderUi.Idle) return@awaitEachGesture
                        // A quick tap only says "Hold to record".
                        var released = false
                        val upEarly = withTimeoutOrNull(HOLD_MS) { waitForUpOrCancellation().also { released = true } }
                        if (released) { if (upEarly != null) tap(); return@awaitEachGesture }
                        if (!acts.onRecordStart(false)) return@awaitEachGesture
                        var cancelled = false
                        var locked = false
                        while (true) {
                            val ev = awaitPointerEvent()
                            val ch = ev.changes.firstOrNull { it.id == down.id } ?: break
                            val dx = ch.position.x - down.position.x
                            val dy = ch.position.y - down.position.y
                            if (!locked) { dragX = dx; dragY = dy }
                            if (!locked && dx <= -cancelPx) { cancelled = true; acts.onRecordCancel(); break }
                            if (!locked && dy <= -lockPx) { locked = true; dragX = 0f; dragY = 0f; acts.onRecordLock() }
                            if (!ch.pressed) break
                            ch.consume()
                        }
                        dragX = 0f
                        dragY = 0f
                        // Released while holding = send.
                        if (!cancelled && !locked) acts.onRecordSendNow()
                    }
                },
            contentAlignment = Alignment.Center,
        ) {
            Text("🎤", fontSize = 21.sp, color = Color.White)
        }
    }
}

/** Recording: ● timer + level, "‹ Slide to cancel" while held; locked: 🗑 · ● timer · ■ stop (→ preview). */
@Composable
private fun RecordingBar(r: RecorderUi.Recording, actions: ChatActions, modifier: Modifier) {
    val t = rememberInfiniteTransition(label = "rec")
    val blink by t.animateFloat(1f, 0.25f, infiniteRepeatable(tween(600), RepeatMode.Reverse), label = "blink")
    val c = chatColors()
    val bg = if (c.dark) Color(0xFF26262A) else Color(0xFFF0F0F2)
    Row(modifier.heightIn(min = 48.dp).clip(RoundedCornerShape(24.dp)).background(bg).padding(start = if (r.locked) 0.dp else 16.dp, end = 4.dp).testTag("chat-recording"), verticalAlignment = Alignment.CenterVertically) {
        if (r.locked) Box(
            Modifier.size(44.dp).clip(CircleShape).clickable(onClickLabel = "Discard the recording") { actions.onRecordCancel() }.testTag("chat-record-discard"),
            contentAlignment = Alignment.Center,
        ) { Text("🗑", fontSize = 19.sp) }
        Box(Modifier.size(10.dp).alpha(blink).clip(CircleShape).background(Palette.Again))
        Spacer(Modifier.width(8.dp))
        Text(ChatRich.duration(r.elapsedMs), fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, fontSize = 16.sp)
        Spacer(Modifier.width(10.dp))
        val lv by animateFloatAsState(r.level, tween(90), label = "lv")
        Box(Modifier.width(40.dp).height(6.dp).clip(RoundedCornerShape(3.dp)).background(Lab.colors.ink.copy(alpha = 0.1f))) {
            Box(Modifier.fillMaxHeight().fillMaxWidth(lv.coerceIn(0.05f, 1f)).background(Palette.Again.copy(alpha = 0.7f)))
        }
        Spacer(Modifier.weight(1f))
        if (r.locked) {
            Box(
                Modifier.size(44.dp).clip(CircleShape).clickable(onClickLabel = "Stop and listen") { actions.onRecordFinish() }.testTag("chat-record-stop"),
                contentAlignment = Alignment.Center,
            ) { Box(Modifier.size(16.dp).clip(RoundedCornerShape(3.dp)).background(Palette.Again)) }
        } else {
            Text("‹ Slide to cancel", color = Lab.colors.muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(end = 10.dp))
        }
    }
}

@Composable
private fun VoicePreviewBar(p: RecorderUi.Preview, ui: ChatUi, actions: ChatActions, modifier: Modifier) {
    val c = chatColors()
    val bg = if (c.dark) Color(0xFF26262A) else Color(0xFFF0F0F2)
    LaunchedEffect(p.path) { actions.onRequestWaveform(PREVIEW_ID, null, p.path) }
    Row(modifier.heightIn(min = 48.dp).clip(RoundedCornerShape(24.dp)).background(bg).testTag("chat-voice-preview"), verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier.size(44.dp).clip(CircleShape).clickable(onClickLabel = "Discard the recording") { actions.onRecordCancel() },
            contentAlignment = Alignment.Center,
        ) { Text("🗑", fontSize = 19.sp) }
        Box(Modifier.weight(1f)) { VoiceContent(PREVIEW_ID, null, p.path, p.durationMs, false, null, ui, actions, width = 260.dp) }
    }
}
