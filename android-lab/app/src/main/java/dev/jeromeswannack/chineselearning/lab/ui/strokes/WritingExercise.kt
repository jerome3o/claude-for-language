package dev.jeromeswannack.chineselearning.lab.ui.strokes

import android.content.Context
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import dev.jeromeswannack.chineselearning.lab.core.CharStrokeData
import dev.jeromeswannack.chineselearning.lab.core.CharacterWritingResult
import dev.jeromeswannack.chineselearning.lab.core.HintLevel
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.StrokeQuiz
import dev.jeromeswannack.chineselearning.lab.core.StrokeResult
import dev.jeromeswannack.chineselearning.lab.core.StrokeVerdict
import dev.jeromeswannack.chineselearning.lab.core.WritingExerciseResult
import dev.jeromeswannack.chineselearning.lab.core.WritingGrade
import dev.jeromeswannack.chineselearning.lab.core.WritingMode
import dev.jeromeswannack.chineselearning.lab.data.strokes.StrokeLoad
import dev.jeromeswannack.chineselearning.lab.data.strokes.StrokeStore
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme

/**
 * Write a word by hand, stroke by stroke, with feedback on every stroke — the native twin of
 * the web's `<WritingExercise>` and THE reusable piece for other packages:
 *
 *   WritingExercise(text = "你好", pinyin = "nǐ hǎo", english = "hello",
 *       initialMode = WritingMode.RECALL, allowModeSwitch = true,
 *       onComplete = { r -> val correct = StrokeQuiz.writtenFromMemory(r) })
 *
 * Loads each character's stroke data through [StrokeStore] (file cache → network; works
 * offline for every character already saved), runs the quiz per character, then shows the
 * summary. [onComplete] fires once per finished run of the word with a [WritingExerciseResult]
 * (the web's result shape). In a mini lesson only writing FROM MEMORY counts as correct —
 * use `StrokeQuiz.writtenFromMemory(result)` (Jerome's rule, docs/STROKE_ORDER.md).
 */
@Composable
fun WritingExercise(
    text: String,
    modifier: Modifier = Modifier,
    /** Prompt shown in recall mode instead of the characters. */
    pinyin: String? = null,
    english: String? = null,
    initialMode: WritingMode = WritingMode.TRACE,
    allowModeSwitch: Boolean = true,
    /** Play the stroke-order animation when a character comes up in trace mode. */
    autoDemo: Boolean = true,
    /** Recall mode hides the characters even with no pinyin / English (dictation). */
    hideCharacters: Boolean = false,
    onComplete: (WritingExerciseResult) -> Unit = {},
    /** Shows a Done button on the summary. */
    onDone: (() -> Unit)? = null,
    doneLabel: String = "Done",
    /** Where stroke data comes from (tests pass their own). */
    loader: (suspend (String) -> StrokeLoad)? = null,
) {
    val context = LocalContext.current
    val load = loader ?: remember { StrokeStore.of(context)::get }
    val chars = remember(text) { StrokeQuiz.writableCharacters(text) }
    var attempt by remember { mutableIntStateOf(0) }
    var state by remember(text) { mutableStateOf<ExerciseLoad>(ExerciseLoad.Loading) }

    LaunchedEffect(text, attempt) {
        if (chars.isEmpty()) return@LaunchedEffect
        state = ExerciseLoad.Loading
        val results = chars.distinct().associateWith { load(it) }
        val offline = results.filterValues { it == StrokeLoad.Offline }.keys.toList()
        state = if (offline.isNotEmpty()) {
            ExerciseLoad.Offline(offline)
        } else {
            val data = results.mapNotNull { (c, r) -> (r as? StrokeLoad.Ok)?.let { c to it.data } }.toMap()
            ExerciseLoad.Ready(data, results.filterValues { it == StrokeLoad.Missing }.keys.toList())
        }
    }

    Column(modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        when {
            chars.isEmpty() -> ExerciseMessage("Nothing to write", "Type a Chinese character or word.")
            state is ExerciseLoad.Loading -> ExerciseMessage(null, "Loading stroke order…")
            state is ExerciseLoad.Offline -> {
                val missing = (state as ExerciseLoad.Offline).chars
                InlineNotice(
                    "${missing.joinToString(" ")} isn't saved on this phone yet. Connect to the internet once and the stroke order is kept for offline practice.",
                    kind = NoticeKind.Offline,
                    actionLabel = "Try again",
                    onAction = { attempt++ },
                )
            }
            else -> {
                val ready = state as ExerciseLoad.Ready
                val playable = chars.filter { it in ready.data }
                if (playable.isEmpty()) {
                    ExerciseMessage("No stroke-order data for “$text”", "The stroke database covers about 9,500 common characters; this one isn't among them.")
                } else {
                    key(text) {
                        val controller = rememberWritingController(text, playable, ready.data, ready.skipped, initialMode, autoDemo, onComplete)
                        WritingRunView(
                            controller = controller,
                            pinyin = pinyin,
                            english = english,
                            allowModeSwitch = allowModeSwitch,
                            hideCharacters = hideCharacters,
                            onDone = onDone,
                            doneLabel = doneLabel,
                        )
                    }
                }
            }
        }
    }
}

private sealed interface ExerciseLoad {
    data object Loading : ExerciseLoad
    data class Offline(val chars: List<String>) : ExerciseLoad
    data class Ready(val data: Map<String, CharStrokeData>, val skipped: List<String>) : ExerciseLoad
}

/** A [WritingController] tied to this composition, with the app's sounds and haptics. */
@Composable
fun rememberWritingController(
    text: String,
    chars: List<String>,
    data: Map<String, CharStrokeData>,
    skipped: List<String> = emptyList(),
    initialMode: WritingMode = WritingMode.TRACE,
    autoDemo: Boolean = true,
    onComplete: (WritingExerciseResult) -> Unit = {},
): WritingController {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val complete by rememberUpdatedState(onComplete)
    return remember(text, chars, initialMode) {
        WritingController(text, chars, data, skipped, initialMode, autoDemo, scope, WritingFx.of(context) { WritingPrefs.muted(context) }, { complete(it) })
    }
}

/** The pad's own mute (🔊 on the pad, remembered per device like the web's). */
object WritingPrefs {
    private fun prefs(c: Context) = c.getSharedPreferences("lab-writing", Context.MODE_PRIVATE)
    fun muted(c: Context): Boolean = prefs(c).getBoolean("muted", false)
    fun setMuted(c: Context, muted: Boolean) = prefs(c).edit().putBoolean("muted", muted).apply()
}

@Composable
private fun ExerciseMessage(title: String?, body: String) {
    Column(Modifier.fillMaxWidth().padding(vertical = 28.dp, horizontal = 12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        if (title != null) Text(title, style = MaterialTheme.typography.titleMedium, color = Lab.colors.ink, textAlign = TextAlign.Center)
        Spacer(Modifier.height(6.dp))
        Text(body, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted, textAlign = TextAlign.Center)
    }
}

/**
 * The run itself (head, mode tabs, status line, pad, tools) or the summary — stateless over
 * a [WritingController], so screenshots and tests can drive a real run.
 */
@Composable
fun WritingRunView(
    controller: WritingController,
    modifier: Modifier = Modifier,
    pinyin: String? = null,
    english: String? = null,
    allowModeSwitch: Boolean = true,
    hideCharacters: Boolean = false,
    onDone: (() -> Unit)? = null,
    doneLabel: String = "Done",
    /** Freeze looping animations (screenshots). */
    still: Boolean = false,
) {
    val context = LocalContext.current
    var muted by remember { mutableStateOf(WritingPrefs.muted(context)) }
    val c = controller
    AnimatedContent(
        targetState = c.summary,
        transitionSpec = { (fadeIn(tween(220)) + scaleIn(initialScale = 0.96f)) togetherWith fadeOut(tween(150)) },
        label = "writing-phase",
        modifier = modifier.fillMaxWidth(),
    ) { showSummary ->
        if (showSummary) {
            WritingSummary(
                results = c.results,
                skipped = c.skipped,
                mode = c.mode,
                allowModeSwitch = allowModeSwitch,
                onAgain = { c.restartWord() },
                onSwitchMode = { c.toggleMode() },
                onDone = onDone,
                doneLabel = doneLabel,
            )
            return@AnimatedContent
        }
        val hasPrompt = !pinyin.isNullOrBlank() || !english.isNullOrBlank()
        val hideChars = c.mode == WritingMode.RECALL && (hasPrompt || hideCharacters)
        val level = c.hint
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                CharChips(c.chars, c.charIdx, c.results, hideChars, Modifier.weight(1f))
                Text(
                    if (muted) "🔇" else "🔊",
                    fontSize = 20.sp,
                    modifier = Modifier
                        .clip(CircleShape)
                        .clickable {
                            muted = !muted
                            WritingPrefs.setMuted(context, muted)
                        }
                        .padding(12.dp),
                )
            }
            if (hasPrompt) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Bottom) {
                    if (!pinyin.isNullOrBlank()) Text(pinyin, fontSize = 20.sp, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
                    if (!english.isNullOrBlank()) Text(english, fontSize = 16.sp, color = Lab.colors.muted, modifier = Modifier.weight(1f, fill = false))
                }
            }
            if (allowModeSwitch) ModeTabs(c.mode) { c.switchMode(it) }
            StatusLine(c.status.takeIf { it.text.isNotEmpty() } ?: WritingStatus(c.progressText))
            key(c.runKey) {
                WritingPad(
                    data = c.charData,
                    showOutline = c.mode == WritingMode.TRACE,
                    completed = c.quiz.done.map { PadStroke(it.index, it.revealed) },
                    justCompleted = c.justCompleted,
                    hint = if (!c.finished && level != HintLevel.NONE) PadHint(c.quiz.current, level) else null,
                    demoKey = c.demoKey,
                    onDemoEnd = c::onDemoEnd,
                    onPenDown = c::onPenDown,
                    celebrate = c.celebrate,
                    enabled = !c.finished,
                    onStroke = c::onStroke,
                    label = if (hideChars) "Write character ${c.charIdx + 1}" else "Write ${c.chars[c.charIdx]}",
                    still = still,
                )
            }
            Row(Modifier.fillMaxWidth().widthIn(max = 440.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ToolButton("▶ Watch", !c.finished, Modifier.weight(1f)) { c.watch() }
                ToolButton("💡 Hint", !c.finished && level != HintLevel.STROKE, Modifier.weight(1f)) { c.requestHint() }
                ToolButton("↺ Restart", !c.finished, Modifier.weight(1f)) { c.restartChar() }
            }
        }
    }
}

private object GradeColors {
    val PerfectBg = Color(0xFFDCFCE7)
    val PerfectBorder = Color(0xFF86EFAC)
    val GoodBg = Color(0xFFECFCCB)
    val GoodBorder = Color(0xFFBEF264)
    val PracticeBg = Color(0xFFFEF3C7)
    val PracticeBorder = Color(0xFFFCD34D)
    val GoodText = Color(0xFF4D7C0F)
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CharChips(chars: List<String>, current: Int, results: List<CharacterWritingResult>, hideChars: Boolean, modifier: Modifier) {
    FlowRow(modifier, horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        chars.forEachIndexed { i, ch ->
            val r = results.getOrNull(i)
            val show = !hideChars || i < results.size
            val (bg, border) = when (r?.grade) {
                WritingGrade.PERFECT -> GradeColors.PerfectBg to GradeColors.PerfectBorder
                WritingGrade.GOOD -> GradeColors.GoodBg to GradeColors.GoodBorder
                WritingGrade.PRACTICE -> GradeColors.PracticeBg to GradeColors.PracticeBorder
                null -> Lab.colors.card to (if (i == current) Lab.colors.accent else Lab.colors.cardBorder)
            }
            val borderColor by animateColorAsState(border, label = "chip-border")
            Box(
                Modifier.size(48.dp).clip(RoundedCornerShape(12.dp)).background(bg).border(2.dp, borderColor, RoundedCornerShape(12.dp)),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    if (show) ch else "${i + 1}",
                    fontSize = if (show) 26.sp else 16.sp,
                    color = if (show) (if (r != null) Color(0xFF1F2937) else Lab.colors.ink) else Lab.colors.muted,
                )
            }
        }
    }
}

@Composable
private fun ModeTabs(mode: WritingMode, onSelect: (WritingMode) -> Unit) {
    Row(
        Modifier.widthIn(max = 440.dp).fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Lab.colors.faint).padding(4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        for (m in WritingMode.entries) {
            val selected = m == mode
            val bg by animateColorAsState(if (selected) Lab.colors.card else Color.Transparent, spring(stiffness = Spring.StiffnessMediumLow), label = "mode")
            Box(
                Modifier.weight(1f).heightIn(min = 44.dp).clip(RoundedCornerShape(11.dp)).background(bg).bouncyClickable(!selected) { onSelect(m) },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    WritingController.MODE_LABEL.getValue(m),
                    color = if (selected) Lab.colors.ink else Lab.colors.muted,
                    fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                    fontSize = 15.sp,
                )
            }
        }
    }
}

@Composable
private fun StatusLine(status: WritingStatus) {
    val (fg, bg) = when (status.tone) {
        StatusTone.Bad -> Color(0xFFB45309) to Color(0xFFFFFBEB)
        StatusTone.Good -> Color(0xFF15803D) to Color(0xFFF0FDF4)
        StatusTone.Hint -> Color(0xFF1D4ED8) to Color(0xFFEFF6FF)
        StatusTone.Neutral -> Lab.colors.muted to Color.Transparent
    }
    val bgAnim by animateColorAsState(bg, label = "status-bg")
    Box(
        Modifier.widthIn(max = 440.dp).fillMaxWidth().heightIn(min = 44.dp).clip(RoundedCornerShape(12.dp)).background(bgAnim).padding(horizontal = 12.dp, vertical = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            status.text,
            color = fg,
            fontSize = 15.sp,
            fontWeight = if (status.tone == StatusTone.Good) FontWeight.SemiBold else FontWeight.Normal,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun ToolButton(label: String, enabled: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Box(
        modifier
            .heightIn(min = 48.dp)
            .bouncyClickable(enabled, 0.94f, onClick = onClick)
            .clip(RoundedCornerShape(16.dp))
            .border(1.5.dp, Lab.colors.accent.copy(alpha = if (enabled) 0.5f else 0.2f), RoundedCornerShape(16.dp))
            .padding(horizontal = 6.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = Lab.colors.accent.copy(alpha = if (enabled) 1f else 0.4f), fontWeight = FontWeight.SemiBold, fontSize = 15.sp, maxLines = 1, softWrap = false)
    }
}

private fun dotColor(s: StrokeResult): Color = when {
    s.revealed -> PadColors.Given
    s.hinted -> PadColors.Hint
    s.misses > 0 -> Color(0xFFF59E0B)
    else -> PadColors.Good
}

/** Port of the summary's `resultDetail`. */
internal fun resultDetail(r: CharacterWritingResult): String {
    val parts = mutableListOf<String>()
    parts += if (r.mistakes == 0) "no mistakes" else "${r.mistakes} mistake${if (r.mistakes == 1) "" else "s"}"
    if (r.hints > 0) parts += "${r.hints} hint${if (r.hints == 1) "" else "s"}"
    val kinds = r.strokes.flatMap { it.mistakes }.toSet()
    if (StrokeVerdict.WRONG_ORDER in kinds) parts += "order slips"
    if (StrokeVerdict.BACKWARDS in kinds) parts += "a stroke backwards"
    parts += "${Js.toFixed(r.ms / 1000.0, if (r.ms < 10_000) 1 else 0)} s"
    return parts.joinToString(" · ")
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun WritingSummary(
    results: List<CharacterWritingResult>,
    skipped: List<String>,
    mode: WritingMode,
    allowModeSwitch: Boolean,
    onAgain: () -> Unit,
    onSwitchMode: () -> Unit,
    onDone: (() -> Unit)?,
    doneLabel: String,
) {
    val grade = StrokeQuiz.gradeExercise(results).let { if (results.isEmpty()) WritingGrade.GOOD else it }
    val mistakes = results.sumOf { it.mistakes }
    val hints = results.sumOf { it.hints }
    val title = when (grade) {
        WritingGrade.PERFECT -> "完美！Perfect strokes"
        WritingGrade.GOOD -> "很好！Nicely written"
        WritingGrade.PRACTICE -> "Keep practising"
    }
    val s = { n: Int -> if (n == 1) "" else "s" }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(title, fontSize = 24.sp, fontWeight = FontWeight.Bold, color = Lab.colors.ink, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center)
        Text(
            "${results.size} character${s(results.size)} · $mistakes mistake${s(mistakes)} · $hints hint${s(hints)} · ${WritingController.MODE_LABEL.getValue(mode).lowercase()}",
            color = Lab.colors.muted,
            fontSize = 14.sp,
            modifier = Modifier.fillMaxWidth(),
            textAlign = TextAlign.Center,
        )
        results.forEach { r ->
            val charColor = when (r.grade) {
                WritingGrade.PERFECT -> PadColors.Good
                WritingGrade.GOOD -> GradeColors.GoodText
                WritingGrade.PRACTICE -> PadColors.Given
            }
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Lab.colors.card).border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(14.dp)).padding(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(r.character, fontSize = 40.sp, color = charColor, modifier = Modifier.width(60.dp), textAlign = TextAlign.Center)
                Spacer(Modifier.width(10.dp))
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(
                        when (r.grade) { WritingGrade.PERFECT -> "Perfect"; WritingGrade.GOOD -> "Good"; WritingGrade.PRACTICE -> "Needs practice" },
                        fontWeight = FontWeight.SemiBold,
                        color = Lab.colors.ink,
                    )
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        r.strokes.forEach { st -> Box(Modifier.size(10.dp).clip(CircleShape).background(dotColor(st))) }
                    }
                    Text(resultDetail(r), fontSize = 13.sp, color = Lab.colors.muted)
                }
            }
        }
        FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            for ((color, label) in listOf(PadColors.Good to "first try", Color(0xFFF59E0B) to "after a miss", PadColors.Hint to "with a hint", PadColors.Given to "shown")) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(8.dp).clip(CircleShape).background(color))
                    Spacer(Modifier.width(4.dp))
                    Text(label, fontSize = 12.sp, color = Lab.colors.muted)
                }
            }
        }
        if (skipped.isNotEmpty()) Text("No stroke data for ${skipped.joinToString(" ")} — skipped.", color = Lab.colors.muted, fontSize = 13.sp)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SecondaryPill("↺ Again", Modifier.weight(1f), onClick = onAgain)
            if (allowModeSwitch) SecondaryPill(if (mode == WritingMode.TRACE) "🧠 From memory" else "✏️ Trace it", Modifier.weight(1f), onClick = onSwitchMode)
        }
        if (onDone != null) PrimaryPill(doneLabel, Modifier.fillMaxWidth().height(56.dp), onClick = onDone)
    }
}

/**
 * Full-screen writing practice over whatever is underneath — the study card's ⋯ → "Write it"
 * (the web's `WritingSheet`), so the session keeps its place. Closes on Done, ✕ or back.
 */
@Composable
fun WritingSheet(
    text: String,
    onClose: () -> Unit,
    pinyin: String? = null,
    english: String? = null,
    onComplete: (WritingExerciseResult) -> Unit = {},
) {
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        LabTheme {
            // Edge to edge: the page colour behind the bars, the ✕ and the pad kept clear of the
            // status bar / cutout and the navigation bar.
            Box(Modifier.fillMaxSize().background(Lab.colors.background).windowInsetsPadding(WindowInsets.safeDrawing)) {
                WritingSheetBody(text, onClose, pinyin, english, onComplete)
            }
        }
    }
}

@Composable
internal fun WritingSheetBody(
    text: String,
    onClose: () -> Unit,
    pinyin: String? = null,
    english: String? = null,
    onComplete: (WritingExerciseResult) -> Unit = {},
    loader: (suspend (String) -> StrokeLoad)? = null,
) {
    Column(Modifier.fillMaxSize().background(Lab.colors.background)) {
        Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp, top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("✍️ Write it", fontSize = 20.sp, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, modifier = Modifier.weight(1f))
            Text("✕", fontSize = 22.sp, color = Lab.colors.muted, modifier = Modifier.clip(CircleShape).clickable(onClick = onClose).padding(14.dp))
        }
        SheetScroll {
            WritingExercise(text, pinyin = pinyin, english = english, onComplete = onComplete, onDone = onClose, doneLabel = "Back to the card", loader = loader)
        }
    }
}

@Composable
private fun SheetScroll(content: @Composable ColumnScope.() -> Unit) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        Column(
            Modifier.widthIn(max = 520.dp).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 8.dp),
            content = content,
        )
    }
}
