package dev.jeromeswannack.chineselearning.lab.ui.chat

import dev.jeromeswannack.chineselearning.lab.ui.kit.buttonBorder
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
import dev.jeromeswannack.chineselearning.lab.ui.kit.rememberVoiceFirstActions
import dev.jeromeswannack.chineselearning.lab.ui.kit.rememberVoiceDictation
import dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceTextFieldActions
import dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceDictationUi
import dev.jeromeswannack.chineselearning.lab.core.VoiceDictation
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.runtime.collectAsState
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
 * Voice first (docs/CHAT.md "Voice-first composer"; core VoiceDictation, the web's DictationComposer):
 *   idle       [ + ] [ ⌨️ ] [ 🎤 Say it ........ ] [ 〰 ]   〰 = hold to send a VOICE MESSAGE (unchanged)
 *   listening  [ ✕ ] [ 我明天… (live, grey tail) ] [ ⏹ ]
 *   review     [ 🔁 ] [ 我明天去公园  ✏️ ✓ ]      [ ➤ ]   ➤ sends it as TEXT; ✓ = Check my Chinese
 *   failed     [ ⌨️ ] [ Couldn't transcribe — tap to retry ] [ 🔁 ]
 * 🎤 Say it writes text; the round waveform records a voice message — never the same glyph. ⌨️ is the
 * typing composer below, which keeps a 🎤 in its pill to go back to speaking. A saved draft opens typing.
 *
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
    val fieldFocus = remember { FocusRequester() }
    // Voice first: the dictation controller (the same as every voice-first box).
    val voice = rememberVoiceDictation("chat", defaultMode = if (ui.draft.isNotBlank()) VoiceDictation.TYPE else null)
    val liveVoice by voice.ui.collectAsState()
    val v = ui.voicePreview ?: liveVoice
    val voiceActions = rememberVoiceFirstActions(voice, ui.draft, onFill = actions.onDraft) { answer ->
        actions.onDraft(answer.text)
        actions.onSend()
    }
    val voiceMode = v.state.mode == VoiceDictation.VOICE && ui.editing == null
    val reviewing = voiceMode && v.phase == "review"
    // On the review, Check my Chinese works on what was said; its "Use this" goes into the typing box.
    val onUseCheck: () -> Unit = { if (reviewing) voiceActions.edit(); actions.onUseCheck() }
    val onSendAsIs: () -> Unit = { if (reviewing) { actions.onDismissCheck(); voiceActions.submit() } else actions.onSendAsIs() }
    Column(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (!ui.online) Text(
            if (rich) "Offline — messages send when you're back" else "You're offline. Messages to Claude can't be sent until you're back online.",
            style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, modifier = Modifier.padding(horizontal = 8.dp),
        )
        ui.notice?.let { InlineNotice(it.text, kind = if (it.error) NoticeKind.Error else NoticeKind.Success, actionLabel = "×", onAction = actions.onDismissNotice) }
        if (ui.proposingCards) ProposingRow()
        if (ui.generatingOptions) Busy("Claude is thinking of ways to say it…")
        DraftCheckPanel(ui.draftCheck, actions, onUse = onUseCheck, onSendAsIs = onSendAsIs)
        if (ui.preparingPhoto) Busy("Preparing the photo…")
        Box {
            Row(verticalAlignment = Alignment.Bottom) {
                val rec = ui.recorder
                when (rec) {
                    is RecorderUi.Preview -> VoicePreviewBar(rec, ui, actions, Modifier.weight(1f))
                    is RecorderUi.Recording -> RecordingBar(rec, actions, Modifier.weight(1f))
                    RecorderUi.Idle -> if (voiceMode) {
                        DictationRow(
                            v, voiceActions, Modifier.weight(1f),
                            onAttach = { emojiOpen = false; actions.onOpenSheet(ChatSheet.Attach) },
                            canCheck = reviewing && ChatLearning.canCheckDraft(v.finalText, ui.viewerRole, ui.isAi, false),
                            checkBusy = ui.draftCheck?.loading == true,
                            onCheck = { actions.onDraft(v.finalText); actions.onCheckDraft() },
                            sendEnabled = !ui.sending && !ui.waitingForAi && (ui.online || rich),
                        )
                    } else {
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
                            focus = fieldFocus,
                            onDictate = if (ui.editing == null && VoiceDictation.voiceButtonShown(v.blocked)) ({ emojiOpen = false; voiceActions.say() }) else null,
                        )
                    }
                }
                Spacer(Modifier.width(6.dp))
                // ONE call site for the mic, so a hold survives the composer turning into the recording bar.
                val micIdle = rec is RecorderUi.Idle && rich && ui.editing == null && (if (voiceMode) v.phase == "idle" else ui.draft.isBlank())
                val mic = micIdle || (rec is RecorderUi.Recording && !rec.locked)
                when {
                    mic -> MicButton(rec, actions) { hint++ }
                    rec is RecorderUi.Idle && voiceMode -> Unit // the dictation row has its own buttons
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
        v.blocked?.takeIf { it != "offline" && ui.recorder is RecorderUi.Idle }?.let {
            Text(
                VoiceDictation.blockReason(it).replace("type your answer", "type your message"),
                style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, modifier = Modifier.padding(horizontal = 8.dp).testTag("chat-dictate-blocked"),
            )
        }
        // ⌨️ Type / ✏️ Edit: into the box with the keyboard up.
        var wasVoice by remember { mutableStateOf(voiceMode) }
        LaunchedEffect(voiceMode) {
            if (!voiceMode && wasVoice && v.blocked == null) {
                kotlinx.coroutines.delay(50)
                runCatching { fieldFocus.requestFocus() }
                keyboard?.show()
            }
            wasVoice = voiceMode
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
    focus: FocusRequester = remember { FocusRequester() },
    /** 🎤 in the pill: back to speaking (what is typed stays, the take is added to it). */
    onDictate: (() -> Unit)? = null,
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
                modifier = Modifier.fillMaxWidth().focusRequester(focus).onFocusChanged { onFocus(it.isFocused) }.testTag("chat-input"),
            )
        }
        onDictate?.let { dictate ->
            Box(
                Modifier.size(40.dp, 48.dp).clip(CircleShape).clickable(onClickLabel = "Say it — dictate instead of typing", onClick = dictate).testTag("chat-dictate-mic"),
                contentAlignment = Alignment.Center,
            ) { Text("🎤", fontSize = 19.sp) }
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
            "Hold to record a voice message", color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
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
                .background(if (recording != null) Palette.Again else if (c.dark) Color(0xFF2C2C2E) else Color(0xFFEDEDF0))
                .then(if (recording != null) Modifier else Modifier.buttonBorder(CircleShape))
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
            // The waveform: a VOICE MESSAGE (dictating text is the 🎤 Say it button).
            WaveformGlyph(if (recording != null) Color.White else Lab.colors.ink.copy(alpha = 0.75f))
        }
    }
}

/** Five bars: the voice-message button's glyph (never the dictation 🎤). */
@Composable
fun WaveformGlyph(color: Color, modifier: Modifier = Modifier) {
    Row(modifier.height(20.dp), horizontalArrangement = Arrangement.spacedBy(2.5.dp), verticalAlignment = Alignment.CenterVertically) {
        for (h in listOf(6, 13, 20, 11, 6)) Box(Modifier.width(2.5.dp).height(h.dp).clip(RoundedCornerShape(1.25.dp)).background(color))
    }
}

/**
 * The composer's voice side (see the top of the file): idle · listening · finishing · review · failed,
 * from the dictation controller's [ui]. The voice-message button stays outside (one call site).
 */
@Composable
private fun DictationRow(
    ui: VoiceDictationUi,
    actions: VoiceTextFieldActions,
    modifier: Modifier,
    onAttach: () -> Unit,
    canCheck: Boolean,
    checkBusy: Boolean,
    onCheck: () -> Unit,
    sendEnabled: Boolean,
) {
    val c = chatColors()
    val grey = if (c.dark) Color(0xFF26262A) else Color(0xFFF0F0F2)
    Row(modifier.testTag("chat-dictate"), verticalAlignment = Alignment.Bottom) {
        when (ui.phase) {
            "idle" -> {
                RoundIcon("+", "Attach", Modifier.testTag("chat-attach"), onClick = onAttach)
                Spacer(Modifier.width(2.dp))
                GreyCircle("⌨️", "Type a message", grey, Modifier.testTag("chat-type"), onClick = actions.type)
                Spacer(Modifier.width(6.dp))
                Box(
                    Modifier.weight(1f).height(48.dp).clip(RoundedCornerShape(24.dp)).background(c.mine)
                        .bouncyClickable(pressedScale = 0.96f, onClick = actions.say)
                        .semantics { contentDescription = "Say it — dictate a text message" }.testTag("chat-say"),
                    contentAlignment = Alignment.Center,
                ) { Text("🎤  ${VoiceDictation.Copy.SAY}", color = Color.White, fontSize = 17.sp, fontWeight = FontWeight.SemiBold) }
            }
            "listening", "finishing" -> {
                val finishing = ui.phase == "finishing"
                GreyCircle("✕", VoiceDictation.Copy.CANCEL, grey, Modifier.testTag("chat-dictate-cancel"), onClick = actions.cancel)
                Spacer(Modifier.width(6.dp))
                Box(
                    Modifier.weight(1f).heightIn(min = 48.dp).clip(RoundedCornerShape(24.dp)).background(Lab.colors.card)
                        .border(1.5.dp, Palette.Again.copy(alpha = 0.5f), RoundedCornerShape(24.dp))
                        .padding(horizontal = 16.dp, vertical = 12.dp).testTag("chat-dictate-live"),
                    contentAlignment = Alignment.CenterStart,
                ) {
                    if (ui.finalText.isEmpty() && ui.partialText.isEmpty()) {
                        Text(if (finishing) VoiceDictation.Copy.FINISHING else "Listening… say your message", color = Lab.colors.muted, fontSize = 15.sp)
                    } else {
                        Text(
                            androidx.compose.ui.text.buildAnnotatedString {
                                append(ui.finalText)
                                pushStyle(androidx.compose.ui.text.SpanStyle(color = Lab.colors.muted.copy(alpha = 0.7f)))
                                append(ui.partialText)
                                pop()
                            },
                            color = Lab.colors.ink, fontSize = 17.sp, lineHeight = 22.sp, maxLines = 6,
                        )
                    }
                }
                Spacer(Modifier.width(6.dp))
                val pulse by rememberInfiniteTransition(label = "stop").animateFloat(1f, 1.08f, infiniteRepeatable(tween(550), RepeatMode.Reverse), label = "pulse")
                Box(
                    Modifier.size(48.dp).scale(if (finishing) 1f else pulse).clip(CircleShape).background(if (finishing) grey else Palette.Again)
                        .bouncyClickable(enabled = !finishing, pressedScale = 0.9f, onClick = actions.stop)
                        .semantics { contentDescription = if (finishing) VoiceDictation.Copy.FINISHING else "Stop and use what I said" }.testTag("chat-dictate-stop"),
                    contentAlignment = Alignment.Center,
                ) {
                    if (finishing) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = Lab.colors.accent)
                    else Box(Modifier.size(15.dp).clip(RoundedCornerShape(3.dp)).background(Color.White))
                }
            }
            "review" -> {
                GreyCircle("🔁", "Say it again", grey, Modifier.testTag("chat-dictate-retake"), onClick = actions.retake)
                Spacer(Modifier.width(6.dp))
                Row(Modifier.weight(1f).heightIn(min = 48.dp).clip(RoundedCornerShape(24.dp)).background(grey).testTag("chat-dictate-review"), verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        ui.finalText, color = Lab.colors.ink, fontSize = 17.sp, lineHeight = 22.sp, maxLines = 6,
                        modifier = Modifier.weight(1f).clickable(onClickLabel = "Edit what I said", onClick = actions.edit).padding(start = 16.dp, top = 12.dp, bottom = 12.dp, end = 4.dp),
                    )
                    Box(Modifier.size(40.dp, 48.dp).clip(CircleShape).clickable(onClickLabel = "Edit what I said", onClick = actions.edit).testTag("chat-dictate-edit"), contentAlignment = Alignment.Center) {
                        Text("✏️", fontSize = 18.sp)
                    }
                    if (canCheck) CheckDraftButton(busy = checkBusy, enabled = true, onClick = onCheck) else Spacer(Modifier.width(8.dp))
                }
                Spacer(Modifier.width(6.dp))
                Box(
                    Modifier.size(48.dp).clip(CircleShape).background(if (sendEnabled) c.mine else c.mine.copy(alpha = 0.4f))
                        .bouncyClickable(enabled = sendEnabled, pressedScale = 0.88f, onClick = actions.submit)
                        .semantics { contentDescription = "Send" }.testTag("chat-dictate-send"),
                    contentAlignment = Alignment.Center,
                ) { Text("➤", color = Color.White, fontSize = 19.sp, fontWeight = FontWeight.Bold) }
            }
            else -> { // failed: typing or another take, never a dead end
                GreyCircle("⌨️", "Type a message", grey, Modifier.testTag("chat-type"), onClick = actions.type)
                Spacer(Modifier.width(6.dp))
                val retry = "retry_upload" in VoiceDictation.controls(ui.state)
                Box(
                    Modifier.weight(1f).heightIn(min = 48.dp).clip(RoundedCornerShape(24.dp))
                        .background(if (retry) Palette.Again.copy(alpha = 0.08f) else grey)
                        .border(1.dp, if (retry) Palette.Again.copy(alpha = 0.35f) else Color.Transparent, RoundedCornerShape(24.dp))
                        .clickable(enabled = retry, onClick = actions.retryUpload).padding(horizontal = 14.dp, vertical = 10.dp)
                        .testTag(if (retry) "chat-dictate-retry-upload" else "chat-dictate-empty"),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        if (!retry) VoiceDictation.Copy.EMPTY else if (ui.failure == "offline") VoiceDictation.Copy.OFFLINE else VoiceDictation.Copy.FAILED,
                        color = if (retry) Lab.colors.ink else Lab.colors.muted, fontSize = 14.sp, textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                    )
                }
                Spacer(Modifier.width(6.dp))
                GreyCircle("🔁", "Say it again", grey, Modifier.testTag("chat-dictate-retake"), onClick = actions.retake)
            }
        }
    }
}

@Composable
private fun GreyCircle(label: String, description: String, bg: Color, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(
        modifier.size(48.dp).clip(CircleShape).background(bg).buttonBorder(CircleShape).bouncyClickable(pressedScale = 0.88f, onClick = onClick).semantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) { Text(label, fontSize = 19.sp, color = Lab.colors.ink) }
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
