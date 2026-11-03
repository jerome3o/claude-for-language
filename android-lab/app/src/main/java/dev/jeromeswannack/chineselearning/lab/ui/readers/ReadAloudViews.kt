package dev.jeromeswannack.chineselearning.lab.ui.readers

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
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
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.Stable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.alpha
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
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
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.BaselineShift
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.fx.Sounds
import dev.jeromeswannack.chineselearning.lab.core.CoachPractise
import dev.jeromeswannack.chineselearning.lab.core.ReadAloud
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.kit.rememberVoiceDictation
import dev.jeromeswannack.chineselearning.lab.ui.kit.rememberVoiceFirstActions
import dev.jeromeswannack.chineselearning.lab.ui.study.YouSaidFailed
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabColors
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
    const val LEGEND = "reader-read-aloud-legend"
    const val FOOTER = "reader-read-aloud-footer"
    const val STOP_FOOTER = "reader-read-aloud-stop-footer"
    const val CONFETTI = "reader-read-aloud-confetti"
    const val DIFFS = "reader-read-aloud-diffs"
    const val DIFF = "reader-read-aloud-diff"
    const val DIFF_PLAY = "reader-read-aloud-diff-play"
}

/**
 * The differences' wiring from the page (web: `useReadAloud` diffs / focusAt): [words] = the page's
 * word chips (the differences group by them), [focus] = (row, tick) lit by a tap on a marked word,
 * [onSpeak] = ▶ a page word (practice TTS at the reader's speed).
 */
class ReadAloudDiffEnv(
    val words: List<String>? = null,
    val focus: Pair<Int, Int>? = null,
    val onSpeak: ((String) -> Unit)? = null,
)

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

class ReadAloudActions(
    val onMic: () -> Unit = {},
    val onRetry: () -> Unit = {},
    /** Stop the take (= the ⏹ while recording; a no-op otherwise) — the footer's ■ Stop recording, back, ✕. */
    val onStop: () -> Unit = {},
)

/** [perfectTakes] counts the takes read ALL right on this page (core `ReadAloud.allRight`): a new value = one burst of confetti. */
class ReadAloudHandle(val ui: ReadAloudUi, val actions: ReadAloudActions, val perfectTakes: Int = 0)

/**
 * A 🎤 Read it aloud take under way on the reading view's page (web: ReaderView `ReaderTakeLock`).
 * The page reports its take here ([ReaderPageView]); [StudyReaderView] locks around it while
 * [locked] (core `ReadAloud.locksPage`: recording, or stopped and being checked) — the footer's
 * Previous / Next / Finish give way to ONE big red ■ Stop recording, the audio row and ▶ Play whole
 * story are disabled, and system back stops the take. A caller with its own ✕ / ← wraps it in
 * [guard] so it stops the take first instead of leaving (Jerome tapped Next mid-take and lost it).
 */
@Stable
class ReaderTakeLock {
    /** The page's dictation phase (idle | listening | finishing | failed). */
    var phase by mutableStateOf("idle")
    /** The page's perfect takes so far (confetti over the whole reading view). */
    var perfectTakes by mutableIntStateOf(0)
    internal var stopTake: () -> Unit = {}
    val locked: Boolean get() = ReadAloud.locksPage(phase)
    val recording: Boolean get() = phase == "listening"

    /** Stop the take (checked and marked as usual); a no-op unless recording. */
    fun stop() { if (recording) stopTake() }

    /** [action] — unless a take is under way: then stop the take first and do nothing else. */
    fun guard(action: () -> Unit): () -> Unit = { if (locked) stop() else action() }
}

@Composable
fun rememberReaderTakeLock(): ReaderTakeLock = remember { ReaderTakeLock() }

/**
 * The reading view's footer while a take is under way: ONE big red "■ Stop recording" in the slot
 * of Previous / Next / Finish (a thumb aimed at Next stops the take instead of losing the page),
 * then a disabled "Checking your reading…" until the result shows (web `ReadAloudStopFooter`).
 */
@Composable
fun ReadAloudStopFooter(
    recording: Boolean,
    onStop: () -> Unit,
    /** The sentence takes reuse it (ui/study `SentenceStopBar`) with their words and tags. */
    label: String = ReadAloud.STOP_RECORDING,
    checkingLabel: String = ReadAloud.CHECKING,
    footerTag: String = ReadAloudTags.FOOTER,
    stopTag: String = ReadAloudTags.STOP_FOOTER,
) {
    val pulse = rememberInfiniteTransition(label = "stopFooter")
    val glow by pulse.animateFloat(0f, if (recording) 1f else 0f, infiniteRepeatable(tween(700), RepeatMode.Reverse), label = "glow")
    val red = Palette.Again
    Row(Modifier.fillMaxWidth().background(Lab.colors.card).padding(16.dp).testTag(footerTag)) {
        Row(
            Modifier.fillMaxWidth().height(54.dp)
                .border(if (recording) (glow * 4f).dp else 0.dp, red.copy(alpha = 0.35f * (1f - glow * 0.5f)), RoundedCornerShape(27.dp))
                .clip(RoundedCornerShape(27.dp))
                .background(if (recording) red else red.copy(alpha = 0.16f))
                .bouncyClickable(recording, 0.97f, role = Role.Button, onClick = onStop)
                .semantics { contentDescription = if (recording) label else checkingLabel }
                .testTag(stopTag),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (recording) {
                Box(Modifier.size(14.dp).clip(RoundedCornerShape(3.dp)).background(Color.White))
                Spacer(Modifier.width(10.dp))
                Text(label, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 17.sp)
            } else {
                // Stopped, the transcript on its way: quiet and not tappable (red ink on a soft red tint).
                CircularProgressIndicator(Modifier.size(18.dp), color = red, strokeWidth = 2.dp)
                Spacer(Modifier.width(10.dp))
                Text(checkingLabel, color = red, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
            }
        }
    }
}

/**
 * One page's 🎤 Read it aloud (the web's components/reader/ReadAloud.tsx `useReadAloud`; rules in
 * core [ReadAloud]): records through the voice boxes' controller ([rememberVoiceDictation]: live
 * Soniox words while he reads, the upload fallback, "Couldn't transcribe — tap to retry"); tap again
 * to stop and the take is judged against [pageText]. [onStart] shows the Chinese (he reads it) and
 * stops a playing story; [onResult] shows it marked. Practice only — nothing stored or queued.
 */
@Composable
fun rememberReadAloud(
    pageText: String,
    onStart: () -> Unit,
    onResult: () -> Unit,
    /** The Claude chat's "🎤 Read it back": its own voice surface + analytics event (+ props from the result). */
    surface: String = "reader_read_aloud",
    event: String = "reader.read_aloud",
    props: (ReadAloud.Result?) -> Map<String, Any?> = { emptyMap() },
    onJudged: (ReadAloud.Result, String) -> Unit = { _, _ -> },
): ReadAloudHandle {
    val app = LocalContext.current.applicationContext as? LabApp
    val controller = rememberVoiceDictation(surface, autoSubmit = true)
    val extra by rememberUpdatedState(props)
    val judged by rememberUpdatedState(onJudged)
    val dictation by controller.ui.collectAsState()
    var result by remember(pageText) { mutableStateOf<ReadAloud.Result?>(null) }
    var said by remember(pageText) { mutableStateOf("") }
    var offlineNote by remember { mutableStateOf(false) }
    var perfectTakes by remember(pageText) { mutableIntStateOf(0) }
    val text by rememberUpdatedState(pageText)
    val start by rememberUpdatedState(onStart)
    val landed by rememberUpdatedState(onResult)
    val voice = rememberVoiceFirstActions(controller, value = "", onFill = {}) { answer ->
        val via = answer.via ?: "none"
        if (!ReadAloud.heardAnything(answer.text)) {
            app?.analytics?.track(event, mapOf("result_bucket" to "empty", "chars" to 0, "via" to via, "all_right" to false) + extra(null))
            return@rememberVoiceFirstActions
        }
        val r = ReadAloud.judge(text, answer.text)
        result = r
        said = answer.text.trim()
        val allRight = ReadAloud.allRight(r)
        app?.analytics?.track(event, mapOf("result_bucket" to ReadAloud.bucket(r.pct), "chars" to r.total, "via" to via, "all_right" to allRight) + extra(r))
        if (allRight) {
            // The whole page read right: confetti (once for this take), a sparkle and a happy buzz.
            perfectTakes++
            app?.haptics?.celebrate()
            app?.sounds?.play(Sounds.Sfx.MILESTONE, 0.6f)
        } else app?.haptics?.tick()
        judged(r, answer.text.trim())
        landed()
    }
    LaunchedEffect(dictation.phase, dictation.failure) {
        if (dictation.phase == "failed") {
            app?.analytics?.track(event, mapOf("result_bucket" to if (dictation.failure == "empty") "empty" else "failed", "chars" to 0, "via" to "none", "all_right" to false) + extra(null))
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
            onStop = { if (dictation.phase == "listening") controller.stop() },
        ),
        perfectTakes,
    )
}

/** 🎤 in the page's audio row (beside the speed chip): Read it aloud · ⏹ Stop · Say it again. */
@Composable
fun ReadAloudMic(ui: ReadAloudUi, onClick: () -> Unit, idleLabel: String = ReadAloud.LABEL, tag: String = ReadAloudTags.MIC) {
    val listening = ui.phase == "listening"
    val finishing = ui.phase == "finishing"
    val label = when {
        listening -> ReadAloud.STOP
        finishing -> ReadAloud.CHECKING
        ui.result != null -> ReadAloud.AGAIN
        else -> idleLabel
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
            .testTag(tag),
        contentAlignment = Alignment.Center,
    ) {
        if (finishing) CircularProgressIndicator(Modifier.size(18.dp), color = Violet, strokeWidth = 2.dp)
        else if (listening) Icon(Icons.Filled.Stop, contentDescription = null, tint = Color.White, modifier = Modifier.size(22.dp))
        else Text("🎤", fontSize = 18.sp, color = Lab.colors.ink)
    }
}

/** Under the audio row: the live transcript, then ONE result line (+ "You said ▸"), or why there is none. */
@Composable
fun ReadAloudPanel(ui: ReadAloudUi, actions: ReadAloudActions, diffEnv: ReadAloudDiffEnv = ReadAloudDiffEnv(), listeningText: String = ReadAloud.LISTENING) {
    val listening = ui.phase == "listening"
    val failed = ui.phase == "failed"
    AnimatedVisibility(listening, enter = fadeIn() + expandVertically()) {
        Box(
            Modifier.fillMaxWidth().heightIn(min = 44.dp).clip(RoundedCornerShape(12.dp)).background(Lab.colors.faint)
                .padding(horizontal = 12.dp, vertical = 10.dp).testTag(ReadAloudTags.LIVE),
            contentAlignment = Alignment.CenterStart,
        ) {
            if (ui.finalText.isEmpty() && ui.partialText.isEmpty()) Text(listeningText, color = Lab.colors.muted, fontSize = 14.sp)
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
        ui.result != null -> ReadAloudResultLine(ui.result, ui.said, diffEnv)
    }
}

@Composable
private fun ReadAloudResultLine(result: ReadAloud.Result, said: String, diffEnv: ReadAloudDiffEnv) {
    var open by remember(result) { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().testTag(ReadAloudTags.RESULT)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            // Small and muted: the icon (✓ ≈ ✕) and the words carry it, never a red / green colour.
            Text(ReadAloud.line(result.pct, result.toCheck), color = Lab.colors.muted, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, modifier = Modifier.testTag(ReadAloudTags.LINE))
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
        ReadAloudLegend(ReadAloud.legend(result))
        val diffs = remember(result, diffEnv.words) { ReadAloud.differences(result, diffEnv.words) }
        ReadAloudDifferences(diffs, diffEnv.focus, diffEnv.onSpeak)
        if (open) {
            // The transcript with what differs marked like the page (a homophone unmarked; extra words solid).
            val heard = result.heard
            if (heard.isNotEmpty()) MarkedChars(
                heard.map { h ->
                    ReadAloud.Char(h.char, when (h.mark) { "close" -> ReadAloud.Mark.CLOSE; "wrong", "extra" -> ReadAloud.Mark.WRONG; "plain" -> ReadAloud.Mark.PLAIN; else -> ReadAloud.Mark.OK }, "", "")
                },
                fontSize = 16.sp,
                modifier = Modifier.padding(top = 10.dp).testTag(ReadAloudTags.SAID),
            )
            else Text(said, color = Lab.colors.muted, fontSize = 15.sp, modifier = Modifier.padding(top = 2.dp).testTag(ReadAloudTags.SAID))
        }
    }
}

private const val DIFFS_SHOWN = 6

/**
 * What it heard vs the page, one row per word (web `ReadAloudDifferences`; Jerome: "what the app thought
 * I was saying versus what it should have been"): the page's word + pinyin, what was heard + pinyin, the
 * kind in words, ▶ the page's word, and a reason line per character ("都 dū → you said dù (4th tone
 * instead of 1st)"). A homophone-only word is a quieter "Sounded right" row (not to check). [focus] (a
 * tap on a marked word in the page) brings its row into view and lights it.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun ReadAloudDifferences(diffs: List<ReadAloud.Difference>, focus: Pair<Int, Int>?, onSpeak: ((String) -> Unit)?) {
    if (diffs.isEmpty()) return
    val app = LocalContext.current.applicationContext as? LabApp
    var showAll by remember(diffs) { mutableStateOf(false) }
    var lit by remember(diffs) { mutableStateOf<Int?>(null) }
    val requesters = remember(diffs) { List(diffs.size) { BringIntoViewRequester() } }
    LaunchedEffect(focus) {
        val i = focus?.first ?: return@LaunchedEffect
        if (i !in diffs.indices) return@LaunchedEffect
        if (i >= DIFFS_SHOWN) showAll = true
        lit = i
        kotlinx.coroutines.delay(60)
        runCatching { requesters[i].bringIntoView() }
        kotlinx.coroutines.delay(1_600)
        lit = null
    }
    val colors = Lab.colors
    Column(Modifier.fillMaxWidth().padding(top = 8.dp).testTag(ReadAloudTags.DIFFS), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        for ((i, d) in diffs.withIndex()) {
            if (!showAll && i >= DIFFS_SHOWN) break
            val accent = when {
                !d.toCheck -> colors.cardBorder
                d.kind == "tone" -> colors.markTone
                else -> colors.markWrong
            }
            val litBg by androidx.compose.animation.animateColorAsState(if (lit == i) Violet.copy(alpha = 0.12f) else colors.card, label = "diffLit")
            Column(
                Modifier.fillMaxWidth().bringIntoViewRequester(requesters[i])
                    .clip(RoundedCornerShape(12.dp)).background(litBg)
                    .border(if (lit == i) 2.dp else 1.dp, if (lit == i) Violet else colors.cardBorder, RoundedCornerShape(12.dp))
                    .drawBehind { drawRect(accent, size = Size(4.dp.toPx(), size.height)) }
                    .alpha(if (d.toCheck) 1f else 0.85f)
                    .padding(start = 14.dp, end = 8.dp, top = 8.dp, bottom = 8.dp)
                    .semantics(mergeDescendants = false) { contentDescription = "${d.page.ifEmpty { "—" }} vs ${d.heard.ifEmpty { "—" }}, ${ReadAloud.diffKindLabel(d.kind)}" }
                    .testTag(ReadAloudTags.DIFF),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    DiffSide("PAGE", d.page, d.pagePinyin)
                    Text("vs", color = colors.muted, fontSize = 13.sp)
                    DiffSide("YOU SAID", d.heard, d.heardPinyin)
                    Spacer(Modifier.weight(1f))
                    Text(ReadAloud.diffKindLabel(d.kind), color = colors.muted, fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
                    if (onSpeak != null && d.page.isNotEmpty()) {
                        Box(
                            Modifier.size(44.dp).clip(CircleShape).background(colors.faint).border(1.dp, colors.cardBorder, CircleShape)
                                .bouncyClickable(pressedScale = 0.9f) {
                                    app?.analytics?.track("reader.read_aloud_diff", mapOf("action" to "play", "kind" to d.kind))
                                    onSpeak(d.page)
                                }
                                .semantics { contentDescription = "Play ${d.page}" }
                                .testTag(ReadAloudTags.DIFF_PLAY),
                            contentAlignment = Alignment.Center,
                        ) { Text("▶", color = colors.ink, fontSize = 14.sp) }
                    }
                }
                for (r in d.reasons) Text(r, color = colors.ink, fontSize = 14.sp, lineHeight = 20.sp, modifier = Modifier.padding(top = 3.dp))
            }
        }
        if (!showAll && diffs.size > DIFFS_SHOWN) {
            Text(
                "Show ${diffs.size - DIFFS_SHOWN} more",
                color = colors.accent, fontWeight = FontWeight.SemiBold,
                modifier = Modifier.heightIn(min = 44.dp).bouncyClickable { showAll = true }.padding(vertical = 12.dp),
            )
        }
    }
}

@Composable
private fun DiffSide(label: String, zh: String, py: String) {
    Column {
        Text(label, color = Lab.colors.muted, fontSize = 10.sp, letterSpacing = 0.5.sp)
        Text(zh.ifEmpty { "—" }, color = Lab.colors.ink, fontSize = 22.sp, lineHeight = 28.sp)
        if (py.isNotEmpty()) Text(py, color = Lab.colors.muted, fontSize = 14.sp)
    }
}

// --- the page's own Chinese, marked in place -------------------------------------------------------

/**
 * The page's characters with their read-aloud marks (web: ReaderWords.tsx `MarkedChars` +
 * ReadAloud.css). Jerome reads them in dark mode and is red / green colour-blind, so the characters
 * keep the body ink whatever their mark and the mark is a SHAPE drawn under the character over a soft
 * tint ([LabColors.markTone] / [LabColors.markWrong]): read right (ok, a homophone) = no mark — a page
 * read well reads clean —, tone off = a wavy lemon underline, wrong = a solid thick rose one, missed =
 * a dashed rose one; a small rose ‸ where extra words were said.
 */
@Composable
fun MarkedChars(
    chars: List<ReadAloud.Char>,
    extraAtEnd: String = "",
    fontSize: TextUnit = 26.sp,
    lineHeight: TextUnit = TextUnit.Unspecified,
    modifier: Modifier = Modifier,
) {
    val colors = Lab.colors
    val (text, marks) = remember(chars, extraAtEnd, colors.markWrong) {
        val at = mutableListOf<Pair<Int, ReadAloud.Mark>>()
        val s = buildAnnotatedString {
            for (c in chars) {
                if (c.extraBefore.isNotEmpty()) caret(this, colors.markWrong)
                if (c.mark == ReadAloud.Mark.CLOSE || c.mark == ReadAloud.Mark.WRONG || c.mark == ReadAloud.Mark.MISSED) at += length to c.mark
                append(c.char)
            }
            if (extraAtEnd.isNotEmpty()) caret(this, colors.markWrong)
        }
        s to at
    }
    var layout by remember { mutableStateOf<TextLayoutResult?>(null) }
    Text(
        text,
        fontSize = fontSize,
        lineHeight = lineHeight,
        color = colors.ink,
        onTextLayout = { layout = it },
        modifier = modifier.drawBehind {
            val l = layout ?: return@drawBehind
            if (l.layoutInput.text != text) return@drawBehind
            val em = fontSize.toPx()
            for ((offset, mark) in marks) {
                val box = l.getBoundingBox(offset)
                val base = l.getLineBaseline(l.getLineForOffset(offset))
                drawReadAloudMark(mark, box.left, box.right, base - em * 0.92f, base + em * 0.24f, base + em * 0.17f, colors)
            }
        },
    )
}

/** One character's mark between [left] and [right]: the tint from [top] to [bottom], the underline centred on [lineY]. */
fun DrawScope.drawReadAloudMark(mark: ReadAloud.Mark, left: Float, right: Float, top: Float, bottom: Float, lineY: Float, colors: LabColors) {
    val wrong = mark == ReadAloud.Mark.WRONG || mark == ReadAloud.Mark.MISSED
    val tint = if (wrong) colors.markWrongTint else colors.markToneTint
    val ink = if (wrong) colors.markWrong else colors.markTone
    drawRoundRect(tint, Offset(left, top), Size(right - left, bottom - top), CornerRadius(3.dp.toPx()))
    when (mark) {
        ReadAloud.Mark.CLOSE -> {
            val amp = 1.7.dp.toPx()
            val half = 3.dp.toPx()
            val path = Path().apply {
                moveTo(left, lineY)
                var x = left
                var up = true
                while (x < right) {
                    val nx = minOf(x + half, right)
                    quadraticTo((x + nx) / 2, lineY + if (up) -amp * 2 else amp * 2, nx, lineY)
                    x = nx
                    up = !up
                }
            }
            drawPath(path, ink, style = Stroke(width = 1.6.dp.toPx(), cap = StrokeCap.Round))
        }
        ReadAloud.Mark.WRONG -> drawLine(ink, Offset(left, lineY), Offset(right, lineY), strokeWidth = 3.dp.toPx())
        ReadAloud.Mark.MISSED -> drawLine(
            ink, Offset(left, lineY), Offset(right, lineY), strokeWidth = 3.dp.toPx(),
            pathEffect = PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 2.5.dp.toPx())),
        )
        else -> Unit
    }
}

private fun caret(b: AnnotatedString.Builder, color: Color) {
    b.pushStyle(SpanStyle(color = color, fontSize = 15.sp, fontWeight = FontWeight.Bold, baselineShift = BaselineShift.Superscript))
    b.append("‸")
    b.pop()
}

/** The tiny legend under the line: a sample of each mark this page shows (core [ReadAloud.legend]). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ReadAloudLegend(keys: List<String>) {
    if (keys.isEmpty()) return
    val colors = Lab.colors
    FlowRow(Modifier.testTag(ReadAloudTags.LEGEND), horizontalArrangement = Arrangement.spacedBy(14.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        for (k in keys) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                Canvas(Modifier.size(width = 22.dp, height = 14.dp)) {
                    if (k == "extra") {
                        // The page's ‸, drawn: a small rose caret.
                        val w = 3.5.dp.toPx()
                        val path = Path().apply {
                            moveTo(size.width / 2 - w, size.height * 0.62f)
                            lineTo(size.width / 2, size.height * 0.18f)
                            lineTo(size.width / 2 + w, size.height * 0.62f)
                        }
                        drawPath(path, colors.markWrong, style = Stroke(width = 2.dp.toPx(), cap = StrokeCap.Round))
                        return@Canvas
                    }
                    val mark = when (k) {
                        "close" -> ReadAloud.Mark.CLOSE
                        "wrong" -> ReadAloud.Mark.WRONG
                        else -> ReadAloud.Mark.MISSED
                    }
                    drawReadAloudMark(mark, 0f, size.width, 0f, size.height - 3.dp.toPx(), size.height - 3.dp.toPx(), colors)
                }
                Text(ReadAloud.legendLabel(k), color = colors.muted, fontSize = 12.sp)
            }
        }
    }
}

/** A chip's content description when it carries marks ("小, 徐 — tone off (heard 许)"). */
fun markedLabel(chars: List<ReadAloud.Char>): String = chars.joinToString(", ", transform = ReadAloud::charLabel)
