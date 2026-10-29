package dev.jeromeswannack.chineselearning.lab.ui.readers

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
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.BaselineShift
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.CoachPractise
import dev.jeromeswannack.chineselearning.lab.core.ReadAloud
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.kit.rememberVoiceDictation
import dev.jeromeswannack.chineselearning.lab.ui.kit.rememberVoiceFirstActions
import dev.jeromeswannack.chineselearning.lab.ui.study.YouSaidFailed
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

/** Test tags of 🎤 Read it aloud. */
object ReadAloudTags {
    const val MIC = "reader-read-aloud"
    const val LIVE = "reader-read-aloud-live"
    const val RESULT = "reader-read-aloud-result"
    const val LINE = "reader-read-aloud-line"
    const val SAID_TOGGLE = "reader-read-aloud-said-toggle"
    const val SAID = "reader-read-aloud-said"
    const val RETRY = "reader-read-aloud-retry"
    const val EMPTY = "reader-read-aloud-empty"
    const val OFFLINE = "reader-read-aloud-offline"
}

/** What a page's 🎤 Read it aloud shows (stateless, so every state renders in screenshot tests). */
data class ReadAloudUi(
    /** idle | listening | finishing | failed */
    val phase: String = "idle",
    val failure: String? = null,
    val blocked: String? = null,
    val finalText: String = "",
    val partialText: String = "",
    val result: ReadAloud.Result? = null,
    /** What was heard (the take's transcript). */
    val said: String = "",
    /** 🎤 was tapped offline: say why. */
    val offlineNote: Boolean = false,
)

class ReadAloudActions(val onMic: () -> Unit = {}, val onRetry: () -> Unit = {})

class ReadAloudHandle(val ui: ReadAloudUi, val actions: ReadAloudActions)

/**
 * One page's 🎤 Read it aloud (the web's components/reader/ReadAloud.tsx `useReadAloud`; rules in
 * core [ReadAloud]): records through the voice boxes' controller ([rememberVoiceDictation]: live
 * Soniox words while he reads, the upload fallback, "Couldn't transcribe — tap to retry"); tap again
 * to stop and the take is judged against [pageText]. [onStart] shows the Chinese (he reads it) and
 * stops a playing story; [onResult] shows it marked. Practice only — nothing stored or queued.
 */
@Composable
fun rememberReadAloud(pageText: String, onStart: () -> Unit, onResult: () -> Unit): ReadAloudHandle {
    val app = LocalContext.current.applicationContext as? LabApp
    val controller = rememberVoiceDictation("reader_read_aloud", autoSubmit = true)
    val dictation by controller.ui.collectAsState()
    var result by remember(pageText) { mutableStateOf<ReadAloud.Result?>(null) }
    var said by remember(pageText) { mutableStateOf("") }
    var offlineNote by remember { mutableStateOf(false) }
    val text by rememberUpdatedState(pageText)
    val start by rememberUpdatedState(onStart)
    val landed by rememberUpdatedState(onResult)
    val voice = rememberVoiceFirstActions(controller, value = "", onFill = {}) { answer ->
        val via = answer.via ?: "none"
        if (!ReadAloud.heardAnything(answer.text)) {
            app?.analytics?.track("reader.read_aloud", mapOf("result_bucket" to "empty", "chars" to 0, "via" to via))
            return@rememberVoiceFirstActions
        }
        val r = ReadAloud.judge(text, answer.text)
        result = r
        said = answer.text.trim()
        app?.analytics?.track("reader.read_aloud", mapOf("result_bucket" to ReadAloud.bucket(r.pct), "chars" to r.total, "via" to via))
        if (r.toCheck == 0) app?.haptics?.correct() else app?.haptics?.tick()
        landed()
    }
    LaunchedEffect(dictation.phase, dictation.failure) {
        if (dictation.phase == "failed") {
            app?.analytics?.track("reader.read_aloud", mapOf("result_bucket" to if (dictation.failure == "empty") "empty" else "failed", "chars" to 0, "via" to "none"))
        }
    }
    LaunchedEffect(dictation.blocked) { if (dictation.blocked != "offline") offlineNote = false }
    val ui = ReadAloudUi(dictation.phase, dictation.failure, dictation.blocked, dictation.finalText, dictation.partialText, result, said, offlineNote)
    return ReadAloudHandle(
        ui,
        ReadAloudActions(
            onMic = {
                when {
                    dictation.phase == "listening" -> controller.stop()
                    dictation.phase == "finishing" -> Unit
                    dictation.blocked == "offline" -> { offlineNote = true; app?.haptics?.tick() }
                    else -> {
                        result = null
                        said = ""
                        start()
                        voice.say()
                    }
                }
            },
            onRetry = controller::retryUpload,
        ),
    )
}

/** 🎤 in the page's audio row (beside the speed chip): Read it aloud · ⏹ Stop · Say it again. */
@Composable
fun ReadAloudMic(ui: ReadAloudUi, onClick: () -> Unit) {
    val listening = ui.phase == "listening"
    val finishing = ui.phase == "finishing"
    val label = when {
        listening -> ReadAloud.STOP
        finishing -> ReadAloud.CHECKING
        ui.result != null -> ReadAloud.AGAIN
        else -> ReadAloud.LABEL
    }
    val pulse = rememberInfiniteTransition(label = "readAloud")
    val s by pulse.animateFloat(1f, if (listening) 1.08f else 1f, infiniteRepeatable(tween(700), RepeatMode.Reverse), label = "pulse")
    val bg = when {
        listening -> Palette.Again
        ui.result != null -> Violet.copy(alpha = 0.12f)
        else -> Lab.colors.faint
    }
    val border = when {
        listening -> Palette.Again
        ui.result != null -> Violet.copy(alpha = 0.45f)
        else -> Lab.colors.cardBorder
    }
    Box(
        Modifier.size(44.dp).scale(s).clip(CircleShape).background(bg).border(1.dp, border, CircleShape)
            .bouncyClickable(!finishing, 0.9f, role = Role.Button, onClick = onClick)
            .semantics { contentDescription = label; selected = listening }
            .testTag(ReadAloudTags.MIC),
        contentAlignment = Alignment.Center,
    ) {
        if (finishing) CircularProgressIndicator(Modifier.size(18.dp), color = Violet, strokeWidth = 2.dp)
        else if (listening) Icon(Icons.Filled.Stop, contentDescription = null, tint = Color.White, modifier = Modifier.size(22.dp))
        else Text("🎤", fontSize = 18.sp, color = Lab.colors.ink)
    }
}

private val GoodInk = Color(0xFF15803D)
private val SomeInk = Color(0xFFB45309)
private val LowInk = Color(0xFFB91C1C)

/** Under the audio row: the live transcript, then ONE result line (+ "You said ▸"), or why there is none. */
@Composable
fun ReadAloudPanel(ui: ReadAloudUi, actions: ReadAloudActions) {
    val listening = ui.phase == "listening"
    val failed = ui.phase == "failed"
    AnimatedVisibility(listening, enter = fadeIn() + expandVertically()) {
        Box(
            Modifier.fillMaxWidth().heightIn(min = 44.dp).clip(RoundedCornerShape(12.dp)).background(Lab.colors.faint)
                .padding(horizontal = 12.dp, vertical = 10.dp).testTag(ReadAloudTags.LIVE),
            contentAlignment = Alignment.CenterStart,
        ) {
            if (ui.finalText.isEmpty() && ui.partialText.isEmpty()) Text(ReadAloud.LISTENING, color = Lab.colors.muted, fontSize = 14.sp)
            else Text(
                buildAnnotatedString {
                    append(ui.finalText)
                    pushStyle(SpanStyle(color = Lab.colors.muted))
                    append(ui.partialText)
                    pop()
                },
                color = Lab.colors.ink, fontSize = 18.sp,
            )
        }
    }
    val blockNote = ui.blocked?.takeIf { it != "offline" }?.let(CoachPractise::blockNote)
    when {
        listening -> Unit
        ui.phase == "finishing" -> Text(ReadAloud.CHECKING, color = Lab.colors.muted, fontSize = 14.sp)
        failed && ui.failure != "empty" -> Box(Modifier.testTag(ReadAloudTags.RETRY)) { YouSaidFailed("Or record it again", actions.onRetry) }
        failed -> Text(ReadAloud.EMPTY, color = Lab.colors.muted, fontSize = 14.sp, modifier = Modifier.testTag(ReadAloudTags.EMPTY))
        ui.offlineNote && ui.blocked == "offline" -> Text(ReadAloud.OFFLINE, color = Lab.colors.muted, fontSize = 14.sp, modifier = Modifier.testTag(ReadAloudTags.OFFLINE))
        blockNote != null -> Text(blockNote, color = Lab.colors.muted, fontSize = 14.sp)
        ui.result != null -> ReadAloudResultLine(ui.result, ui.said)
    }
}

@Composable
private fun ReadAloudResultLine(result: ReadAloud.Result, said: String) {
    var open by remember(result) { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().testTag(ReadAloudTags.RESULT)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            val ink = when (ReadAloud.tone(result.pct, result.toCheck)) {
                "good" -> GoodInk
                "some" -> SomeInk
                else -> LowInk
            }
            Text(ReadAloud.line(result.pct, result.toCheck), color = ink, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, modifier = Modifier.testTag(ReadAloudTags.LINE))
            Text(
                "${ReadAloud.YOU_SAID} ${if (open) "▾" else "▸"}",
                color = Lab.colors.muted,
                fontSize = 13.sp,
                modifier = Modifier.heightIn(min = 40.dp).clip(RoundedCornerShape(8.dp))
                    .bouncyClickable(pressedScale = 0.95f, role = Role.Button) { open = !open }
                    .padding(horizontal = 6.dp, vertical = 10.dp)
                    .testTag(ReadAloudTags.SAID_TOGGLE),
            )
        }
        if (open) Text(said, color = Lab.colors.muted, fontSize = 15.sp, modifier = Modifier.padding(top = 2.dp).testTag(ReadAloudTags.SAID))
    }
}

// --- the page's own Chinese, marked in place -------------------------------------------------------

private val OkInk = Color(0xFF166534)
private val CloseBg = Color(0xFFFEF3C7)
private val CloseInk = Color(0xFF92400E)
private val WrongBg = Color(0xFFFEE2E2)
private val WrongInk = Color(0xFFB91C1C)

/**
 * The page's characters with their read-aloud marks (never colour alone): ok green; sound green +
 * underline (a homophone — right); close amber on amber; wrong red on red + underline; missed red,
 * faded + underline; a red ‸ where extra words were said.
 */
fun markedText(chars: List<ReadAloud.Char>, extraAtEnd: String = ""): AnnotatedString = buildAnnotatedString {
    for (c in chars) {
        if (c.extraBefore.isNotEmpty()) caret(this)
        val style = when (c.mark) {
            ReadAloud.Mark.OK -> SpanStyle(color = OkInk)
            ReadAloud.Mark.SOUND -> SpanStyle(color = OkInk, textDecoration = TextDecoration.Underline)
            ReadAloud.Mark.CLOSE -> SpanStyle(color = CloseInk, background = CloseBg)
            ReadAloud.Mark.WRONG -> SpanStyle(color = WrongInk, background = WrongBg, textDecoration = TextDecoration.Underline)
            ReadAloud.Mark.MISSED -> SpanStyle(color = WrongInk.copy(alpha = 0.6f), textDecoration = TextDecoration.Underline)
            ReadAloud.Mark.PLAIN -> null
        }
        if (style == null) append(c.char) else {
            pushStyle(style)
            append(c.char)
            pop()
        }
    }
    if (extraAtEnd.isNotEmpty()) caret(this)
}

private fun caret(b: AnnotatedString.Builder) {
    b.pushStyle(SpanStyle(color = Palette.Again, fontSize = 14.sp, fontWeight = FontWeight.Bold, baselineShift = BaselineShift.Superscript))
    b.append("‸")
    b.pop()
}

/** A chip's content description when it carries marks ("小, 徐 — tone off (heard 许)"). */
fun markedLabel(chars: List<ReadAloud.Char>): String = chars.joinToString(", ", transform = ReadAloud::charLabel)
