package dev.jeromeswannack.chineselearning.lab.ui.coach

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.CoachPractise
import dev.jeromeswannack.chineselearning.lab.ui.editor.LessonSpeaker
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.kit.rememberVoiceDictation
import dev.jeromeswannack.chineselearning.lab.ui.kit.rememberVoiceFirstActions
import dev.jeromeswannack.chineselearning.lab.ui.study.SpokenResultRow
import dev.jeromeswannack.chineselearning.lab.ui.study.YouSaidFailed
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

/** Test tags of the practise row (suffixed with the row's own tag). */
object CoachPractiseTags {
    const val ROOT = "coach-practise"
    fun listen(tag: String) = "$tag-listen"
    fun mic(tag: String) = "$tag-mic"
    fun live(tag: String) = "$tag-live"
    fun result(tag: String) = "$tag-result"
    fun retry(tag: String) = "$tag-retry"
    fun empty(tag: String) = "$tag-empty"
    fun blocked(tag: String) = "$tag-blocked"
}

/** What the practise row shows (stateless, so every state renders in screenshot tests). */
data class PractiseUi(
    /** idle | listening | finishing | failed */
    val phase: String = "idle",
    val failure: String? = null,
    val blocked: String? = null,
    val finalText: String = "",
    val partialText: String = "",
    val result: CoachPractise.Practised? = null,
)

data class PractiseActions(
    val onListen: () -> Unit = {},
    val onMic: () -> Unit = {},
    val onRetryUpload: () -> Unit = {},
)

/**
 * A stop handle the card holds: a tap anywhere on the card stops a take (the web's "tap the card").
 * The practise row registers itself; the card's [practiseTapToStop] modifier calls it.
 */
class PractiseStop {
    internal var stop: (() -> Boolean)? = null
    fun stopIfListening(): Boolean = stop?.invoke() == true
}

/** Watches every press on the card without consuming it (word taps still open the explorer). */
fun Modifier.practiseTapToStop(stop: PractiseStop): Modifier = pointerInput(stop) {
    awaitEachGesture {
        awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
        stop.stopIfListening()
    }
}

/**
 * "🎤 Practise saying it" beside a coach answer's sentence (the web's PractiseSentence; core
 * [CoachPractise]): ▶ plays the sentence (the lessons' cache-first practice TTS, [LessonSpeaker]),
 * 🎤 records a take through the voice boxes' pipeline (live Soniox words while speaking, the upload
 * fallback, "Couldn't transcribe — tap to retry"); 🎤 again, Enter or a tap on the card stops; the
 * take is checked against the sentence and shown in the compact "You said" row
 * ([SpokenResultRow]), then 🔁 Try again. Nothing is stored.
 */
@Composable
fun PractiseSentenceRow(
    hanzi: String,
    tag: String = CoachPractiseTags.ROOT,
    stop: PractiseStop? = null,
    preview: PractiseUi? = null,
    /** Told about every checked take (a clip's speak scene settles on it). */
    onPractised: ((CoachPractise.Practised) -> Unit)? = null,
) {
    if (preview != null) return PractiseRowContent(hanzi, preview, PractiseActions(), tag)
    val context = LocalContext.current
    val app = context.applicationContext as? LabApp
    val scope = rememberCoroutineScope()
    val speaker = remember(app) { app?.let { LessonSpeaker(it, scope) } }
    DisposableEffect(speaker) { onDispose { speaker?.stop() } }
    val controller = rememberVoiceDictation("coach_practise", autoSubmit = true)
    val dictation by controller.ui.collectAsState()
    var result by remember(hanzi) { mutableStateOf<CoachPractise.Practised?>(null) }
    val target by rememberUpdatedState(hanzi)
    val voice = rememberVoiceFirstActions(controller, value = "", onFill = {}) { answer ->
        val p = CoachPractise.practise(answer.text, target)
        result = p
        onPractised?.invoke(p)
        app?.analytics?.track("coach.practise_say", mapOf("result" to CoachPractise.outcome(p, null)))
        if (p.result.accepted) app?.haptics?.correct() else app?.haptics?.tick()
    }
    // A take that gave nothing is reported once (a result is reported when it lands).
    LaunchedEffect(dictation.phase, dictation.failure) {
        if (dictation.phase == "failed") app?.analytics?.track("coach.practise_say", mapOf("result" to CoachPractise.outcome(null, dictation.failure)))
    }
    val listening by rememberUpdatedState(dictation.phase == "listening")
    DisposableEffect(stop, controller) {
        stop?.stop = { if (listening) { controller.stop(); true } else false }
        onDispose { stop?.stop = null }
    }
    PractiseRowContent(
        hanzi,
        PractiseUi(dictation.phase, dictation.failure, dictation.blocked, dictation.finalText, dictation.partialText, result),
        PractiseActions(
            onListen = { speaker?.speak(hanzi) },
            onMic = {
                when (dictation.phase) {
                    "listening" -> controller.stop()
                    "finishing" -> Unit
                    else -> { result = null; voice.say() }
                }
            },
            onRetryUpload = controller::retryUpload,
        ),
        tag,
    )
}

@Composable
fun PractiseRowContent(hanzi: String, ui: PractiseUi, actions: PractiseActions, tag: String = CoachPractiseTags.ROOT) {
    val listening = ui.phase == "listening"
    val finishing = ui.phase == "finishing"
    val failed = ui.phase == "failed"
    val micEnabled = CoachPractise.micEnabled(ui.blocked) && !finishing
    val note = CoachPractise.blockNote(ui.blocked)
    Column(Modifier.fillMaxWidth().padding(top = 6.dp).testTag(tag), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            // ▶ the sentence.
            Box(
                Modifier.size(44.dp).clip(CircleShape).border(1.5.dp, Lab.colors.accent.copy(alpha = 0.5f), CircleShape)
                    .bouncyClickable(true, 0.9f, role = Role.Button, onClick = actions.onListen)
                    .semantics { contentDescription = "${CoachPractise.LISTEN}: $hanzi" }
                    .testTag(CoachPractiseTags.listen(tag)),
                contentAlignment = Alignment.Center,
            ) { Text("▶", color = Lab.colors.accent, fontSize = 16.sp) }
            // 🎤 Practise saying it / ⏹ Stop / 🔁 Try again.
            val bg = if (listening) Palette.Again else Color.Transparent
            val fg = if (listening) Color.White else Lab.colors.accent
            val pulse = rememberInfiniteTransition(label = "practise")
            val s by pulse.animateFloat(1f, if (listening) 1.03f else 1f, infiniteRepeatable(tween(700), RepeatMode.Reverse), label = "pulse")
            val shape = RoundedCornerShape(22.dp)
            Row(
                Modifier.weight(1f).heightIn(min = 44.dp).scale(s).clip(shape).background(bg)
                    .then(if (listening) Modifier else Modifier.border(1.5.dp, Lab.colors.accent.copy(alpha = if (micEnabled) 0.5f else 0.2f), shape))
                    .bouncyClickable(micEnabled, 0.96f, role = Role.Button, onClick = actions.onMic)
                    .onPreviewKeyEvent { e -> if (listening && e.type == KeyEventType.KeyUp && (e.key == Key.Enter || e.key == Key.NumPadEnter)) { actions.onMic(); true } else false }
                    .semantics { contentDescription = if (listening) "${CoachPractise.STOP} — check what I said" else "${CoachPractise.LABEL}: $hanzi" }
                    .testTag(CoachPractiseTags.mic(tag))
                    .padding(horizontal = 14.dp, vertical = 10.dp),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (finishing) {
                    CircularProgressIndicator(Modifier.size(16.dp), color = Lab.colors.accent, strokeWidth = 2.dp, trackColor = Lab.colors.accent.copy(alpha = 0.2f))
                    Spacer(Modifier.width(8.dp))
                }
                val label = when {
                    finishing -> CoachPractise.CHECKING
                    listening -> "⏹  ${CoachPractise.STOP}"
                    ui.result != null || failed -> "🔁  ${CoachPractise.AGAIN}"
                    else -> "🎤  ${CoachPractise.LABEL}"
                }
                Text(label, color = if (micEnabled || listening) fg else Lab.colors.muted, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
            }
        }
        AnimatedVisibility(listening, enter = fadeIn() + expandVertically()) {
            Box(
                Modifier.fillMaxWidth().heightIn(min = 44.dp).clip(RoundedCornerShape(12.dp)).background(Lab.colors.faint)
                    .padding(horizontal = 12.dp, vertical = 10.dp).testTag(CoachPractiseTags.live(tag)),
                contentAlignment = Alignment.CenterStart,
            ) {
                if (ui.finalText.isEmpty() && ui.partialText.isEmpty()) Text(CoachPractise.LISTENING, color = Lab.colors.muted, fontSize = 14.sp)
                else Text(
                    androidx.compose.ui.text.buildAnnotatedString {
                        append(ui.finalText)
                        pushStyle(androidx.compose.ui.text.SpanStyle(color = Lab.colors.muted))
                        append(ui.partialText)
                        pop()
                    },
                    color = Lab.colors.ink, fontSize = 18.sp,
                )
            }
        }
        val r = ui.result
        if (r != null && !listening && !finishing) {
            Box(Modifier.testTag(CoachPractiseTags.result(tag))) { SpokenResultRow(r.said, hanzi, r.verdict) }
        }
        if (failed && ui.failure != "empty") Box(Modifier.testTag(CoachPractiseTags.retry(tag))) { YouSaidFailed("Or record it again", actions.onRetryUpload) }
        if (failed && ui.failure == "empty") Text(CoachPractise.EMPTY, color = Lab.colors.muted, fontSize = 14.sp, modifier = Modifier.testTag(CoachPractiseTags.empty(tag)))
        if (note != null && !listening) Text(note, color = Lab.colors.muted, fontSize = 14.sp, modifier = Modifier.testTag(CoachPractiseTags.blocked(tag)))
    }
}
