package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.State
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
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
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.AnswerCheck
import dev.jeromeswannack.chineselearning.lab.core.CoachPractise
import dev.jeromeswannack.chineselearning.lab.core.SentencePractise
import dev.jeromeswannack.chineselearning.lab.data.api.checkLessonAnswer
import dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceDictationController
import dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceDictationUi
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.kit.rememberVoiceDictation
import dev.jeromeswannack.chineselearning.lab.ui.kit.rememberVoiceFirstActions
import dev.jeromeswannack.chineselearning.lab.ui.lessons.AnswerCheckBody
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import kotlinx.coroutines.launch

/** Test tags of a sentence row's 🎤 and its result. */
object SentencePractiseTags {
    const val MIC = "sentence-practise-mic"
    const val LIVE = "sentence-practise-live"
    const val RESULT = "sentence-practise-result"
    const val CHECKING = "sentence-practise-checking"
    const val CHECK_ONLINE = "sentence-practise-check-online"
    const val VERDICT = "sentence-practise-verdict"
    const val RETRY = "sentence-practise-retry"
    const val EMPTY = "sentence-practise-empty"
    const val GATE = "sentence-gate"
}

/** Claude's check of a translate take that wasn't the row's sentence. */
sealed interface SentenceClaude {
    data object Checking : SentenceClaude
    data class Done(val check: AnswerCheck) : SentenceClaude
    data object Unavailable : SentenceClaude
}

data class SentenceRowTake(val mode: String, val take: SentencePractise.Take, val claude: SentenceClaude?)

/**
 * One list's 🎤 (the web's `useSentencePractise`, components/study/SentencePractise.tsx; rules in core
 * [SentencePractise]): ONE microphone for every row of the list — the active row and its mode, the
 * takes per row, Claude's check of a translate take. A press anywhere on the card while listening
 * stops the take ([sentencePractiseWatch]); 🎤 on another row only stops it (the take lands on its
 * own row first). Practice only: nothing is stored; [onRight] gets each row said right.
 */
@Stable
class SentencePractiseState internal constructor(
    internal val controller: VoiceDictationController?,
    private val dictationState: State<VoiceDictationUi>?,
    /** Screenshot tests: a fixed dictation state, no microphone. */
    private val preview: VoiceDictationUi? = null,
) {
    var activeKey by mutableStateOf<String?>(null)
        internal set
    var activeMode by mutableStateOf<String?>(null)
        internal set
    internal var activeRow: SentenceRow? = null
    val takes = mutableStateMapOf<String, SentenceRowTake>()
    internal var say: () -> Unit = {}

    /** Brings the sentence list into view (the gate line's tap, a locked Good / Easy). */
    @OptIn(ExperimentalFoundationApi::class)
    val bringIntoView = BringIntoViewRequester()

    /** Scrolls the sentence list into view. */
    @OptIn(ExperimentalFoundationApi::class)
    suspend fun showList() = bringIntoView.bringIntoView()

    val dictation: VoiceDictationUi get() = preview ?: dictationState?.value ?: VoiceDictationUi()
    val listening: Boolean get() = dictation.phase == "listening"
    val finishing: Boolean get() = dictation.phase == "finishing"

    /** 🎤 on [row] in [mode]: stop this take, or start one (another row's take is only stopped). */
    fun onMic(row: SentenceRow, mode: String) {
        if (listening) { controller?.stop(); return }
        if (finishing) return
        takes.remove(row.key)
        activeRow = row
        activeKey = row.key
        activeMode = mode
        say()
    }

    /** A press anywhere while recording stops the take; true when it did. */
    fun stopIfListening(): Boolean {
        if (!listening) return false
        controller?.stop()
        return true
    }

    /** Something to show under [key]'s row: the live words, a failed take, or a result. */
    fun hasOutcome(key: String): Boolean =
        (activeKey == key && (listening || dictation.phase == "failed")) || takes.containsKey(key)

    /** A row hidden again: its result goes too. */
    fun clear(key: String) {
        takes.remove(key)
    }
}

/** The list's 🎤 state, wired to the app (recorder, live transcription, the answer check, analytics). [key] = one showing of the card. */
@Composable
fun rememberSentencePractise(key: Any?, onRight: (String) -> Unit = {}): SentencePractiseState {
    val context = LocalContext.current
    val app = context.applicationContext as? LabApp
    val scope = rememberCoroutineScope()
    val controller = rememberVoiceDictation("sentence_practise", autoSubmit = true)
    val ui = controller.ui.collectAsState()
    val state = remember(key, controller) { SentencePractiseState(controller, ui) }
    val right by rememberUpdatedState(onRight)
    fun finish(rowKey: String, mode: String, take: SentencePractise.Take, claude: AnswerCheck?) {
        val result = SentencePractise.result(take.practised, claude?.verdict)
        app?.analytics?.track("study.sentence_practise", mapOf("mode" to mode, "result" to result, "via" to SentencePractise.via(take, claude != null)))
        if (result == "right") {
            app?.haptics?.correct()
            right(rowKey)
        } else app?.haptics?.tick()
    }
    val voice = rememberVoiceFirstActions(controller, value = "", onFill = {}) { answer ->
        val row = state.activeRow ?: return@rememberVoiceFirstActions
        val mode = state.activeMode ?: return@rememberVoiceFirstActions
        val take = SentencePractise.take(mode, answer.text, row.hanzi)
        state.takes[row.key] = SentenceRowTake(mode, take, if (take.askClaude) SentenceClaude.Checking else null)
        if (!take.askClaude) {
            finish(row.key, mode, take, null)
            return@rememberVoiceFirstActions
        }
        scope.launch {
            val check = runCatching {
                val input = SentencePractise.checkInput(row.hanzi, row.pinyin, row.translation, take.practised.said)
                app!!.repo.api.checkLessonAnswer(input, app.cache, app.online.value).check
            }.getOrNull()
            if (state.takes[row.key]?.take !== take) return@launch
            state.takes[row.key] = SentenceRowTake(mode, take, check?.let { SentenceClaude.Done(it) } ?: SentenceClaude.Unavailable)
            finish(row.key, mode, take, check)
        }
    }
    state.say = voice.say
    // A take that gave nothing is reported once.
    val phase = ui.value.phase
    val failure = ui.value.failure
    LaunchedEffect(phase, failure) {
        val mode = state.activeMode
        if (phase == "failed" && mode != null) {
            app?.analytics?.track("study.sentence_practise", mapOf("mode" to mode, "result" to SentencePractise.result(null, null, failure), "via" to "local"))
        }
    }
    // Another showing: nothing carries over.
    DisposableEffect(key) { onDispose { controller.cancel() } }
    return state
}

/** Screenshot tests: the state drawn as given, no microphone. */
fun previewSentencePractise(dictation: VoiceDictationUi = VoiceDictationUi(), activeKey: String? = null, activeMode: String? = null, takes: Map<String, SentenceRowTake> = emptyMap()): SentencePractiseState =
    SentencePractiseState(null, null, dictation).apply {
        this.activeKey = activeKey
        this.activeMode = activeMode
        this.takes.putAll(takes)
    }

/** Watches every press on the card without consuming it: a press while recording stops the take. */
fun Modifier.sentencePractiseWatch(state: SentencePractiseState?): Modifier =
    if (state == null) this else pointerInput(state) {
        awaitEachGesture {
            awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
            state.stopIfListening()
        }
    }

/** 🎤 left of ▶ (40dp like ▶, a 44dp target). Red with ⏹ while recording (shape + colour). */
@Composable
fun SentenceMicButton(state: SentencePractiseState, row: SentenceRow, mode: String) {
    val mine = state.activeKey == row.key
    val listening = mine && state.listening
    val finishing = mine && state.finishing
    val enabled = CoachPractise.micEnabled(state.dictation.blocked) && !(state.finishing && !mine)
    val pulse = rememberInfiniteTransition(label = "sentence-mic")
    val s by pulse.animateFloat(1f, if (listening) 1.08f else 1f, infiniteRepeatable(tween(650), RepeatMode.Reverse), label = "pulse")
    val label = if (listening) SentencePractise.STOP else "${SentencePractise.LABEL[mode]}: ${if (mode == SentencePractise.READ) row.hanzi else row.translation.orEmpty()}"
    Box(
        Modifier.size(44.dp).bouncyClickable(enabled, 0.9f, role = Role.Button) { state.onMic(row, mode) }
            .semantics { contentDescription = label }
            .testTag(SentencePractiseTags.MIC),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier.size(40.dp).scale(s).clip(CircleShape)
                .background(if (listening) Palette.Again else Lab.colors.card)
                .then(if (listening) Modifier else Modifier.border(1.dp, Lab.colors.cardBorder, CircleShape)),
            contentAlignment = Alignment.Center,
        ) {
            when {
                finishing -> CircularProgressIndicator(Modifier.size(16.dp), color = Lab.colors.accent, strokeWidth = 2.dp)
                listening -> Text("⏹", color = Color.White, fontSize = 15.sp)
                else -> Text("🎤", fontSize = 16.sp, color = if (enabled) Lab.colors.ink else Lab.colors.muted)
            }
        }
    }
}

/** Under the row's text: the live words while listening, then the result. */
@Composable
fun SentencePractiseOutcome(state: SentencePractiseState, row: SentenceRow) {
    val mine = state.activeKey == row.key
    val d = state.dictation
    if (mine && state.listening) {
        Box(
            Modifier.fillMaxWidth().padding(top = 6.dp).heightIn(min = 40.dp).clip(RoundedCornerShape(12.dp)).background(Lab.colors.card)
                .padding(horizontal = 12.dp, vertical = 8.dp).testTag(SentencePractiseTags.LIVE),
            contentAlignment = Alignment.CenterStart,
        ) {
            if (d.finalText.isEmpty() && d.partialText.isEmpty()) Text(SentencePractise.LISTENING[state.activeMode].orEmpty(), color = Lab.colors.muted, fontSize = 14.sp)
            else Text(
                buildAnnotatedString {
                    append(d.finalText)
                    withStyle(SpanStyle(color = Lab.colors.muted)) { append(d.partialText) }
                },
                color = Lab.colors.ink, fontSize = 18.sp,
            )
        }
        return
    }
    if (mine && d.phase == "failed") {
        Box(Modifier.padding(top = 6.dp)) {
            if (d.failure == "empty") Text(CoachPractise.EMPTY, color = Lab.colors.muted, fontSize = 14.sp, modifier = Modifier.testTag(SentencePractiseTags.EMPTY))
            else Box(Modifier.testTag(SentencePractiseTags.RETRY)) { YouSaidFailed("Or record it again", { state.controller?.retryUpload() }) }
        }
        return
    }
    val t = state.takes[row.key] ?: return
    if (mine && state.finishing) return
    val claude = t.claude
    val result = SentencePractise.result(t.take.practised, (claude as? SentenceClaude.Done)?.check?.verdict)
    Column(Modifier.fillMaxWidth().padding(top = 6.dp).testTag("${SentencePractiseTags.RESULT}-$result"), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (claude is SentenceClaude.Done) {
            Column(Modifier.testTag(SentencePractiseTags.VERDICT)) {
                Text(
                    buildAnnotatedString {
                        withStyle(SpanStyle(color = Lab.colors.muted, fontSize = 12.sp)) { append("You said  ") }
                        append(t.take.practised.said)
                    },
                    color = Lab.colors.ink, fontSize = 17.sp,
                )
                // Compact: the chip, the headline and the fix of what was said (no tips / alternatives).
                AnswerCheckBody(claude.check.copy(tips = emptyList(), alternative = null), t.take.practised.said, compact = true)
            }
        } else {
            SpokenResultRow(t.take.practised.said, row.hanzi, t.take.practised.verdict)
        }
        if (claude == SentenceClaude.Checking) {
            Text("  ${SentencePractise.CHECKING}", color = Lab.colors.muted, fontSize = 14.sp, modifier = Modifier.testTag(SentencePractiseTags.CHECKING))
        }
        if (SentencePractise.showCheckOnline(t.take, claude is SentenceClaude.Done, claude == SentenceClaude.Checking)) {
            Text(SentencePractise.CHECK_ONLINE, color = Lab.colors.muted, fontSize = 13.sp, modifier = Modifier.testTag(SentencePractiseTags.CHECK_ONLINE))
        }
    }
}

/**
 * "Get two sentences right before Good / Easy": the line above the ratings ("🎤 Get 2 sentences
 * right to unlock Good · 1/2"; the blocked note after a locked tap). A tap brings the sentences into view.
 */
@Composable
fun SentenceGateLine(gate: SentencePractise.Gate, showNote: Boolean, onTap: () -> Unit) {
    val text = if (showNote && gate.locked) SentencePractise.blockedNote(gate) else SentencePractise.label(gate) ?: return
    val shape = RoundedCornerShape(14.dp)
    Box(
        Modifier.fillMaxWidth().padding(bottom = 8.dp).heightIn(min = 44.dp).clip(shape)
            .background(if (gate.locked) Lab.colors.faint else Palette.Good.copy(alpha = 0.12f))
            .border(1.dp, if (gate.locked) Lab.colors.cardBorder else Palette.Good.copy(alpha = 0.6f), shape)
            .bouncyClickable(true, 0.98f, role = Role.Button, onClick = onTap)
            .padding(horizontal = 12.dp, vertical = 8.dp)
            .testTag(SentencePractiseTags.GATE),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, color = if (gate.locked) Lab.colors.ink else Palette.Good, fontSize = 14.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
    }
}
