package dev.jeromeswannack.chineselearning.lab.ui.explorer

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.scaleIn
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.WritingGrade
import dev.jeromeswannack.chineselearning.lab.core.WritingMode
import dev.jeromeswannack.chineselearning.lab.core.explorer.DictWord
import dev.jeromeswannack.chineselearning.lab.core.explorer.Drill
import dev.jeromeswannack.chineselearning.lab.core.explorer.DrillKind
import dev.jeromeswannack.chineselearning.lab.core.explorer.DrillQuestion
import dev.jeromeswannack.chineselearning.lab.core.explorer.DrillTarget
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerItem
import dev.jeromeswannack.chineselearning.lab.data.api.CharWordDto
import dev.jeromeswannack.chineselearning.lab.data.strokes.StrokeLoad
import dev.jeromeswannack.chineselearning.lab.ui.fx.ConfettiRain
import dev.jeromeswannack.chineselearning.lab.ui.fx.ShakeState
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.strokes.WritingExercise
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import kotlin.math.roundToInt

/*
 * Quick drills in the explorer (docs/LANGUAGE_EXPLORER.md "Mini drills"; the native twin of the
 * web's DrillView): the drill replaces the view's body — one question at a time, instant
 * right / wrong feedback (colour, pop / shake, Haptics + Sounds), the pinyin revealed after
 * answering, a score at the end. The questions come from core Drill (port of
 * shared/explorer/drill.ts, parity-tested). Practice only: nothing here writes a review event;
 * the controller logs explorer.drill_start / drill_finish.
 */

const val EXPLORER_DRILL_TAG = "explorer-drill"
const val EXPLORER_DRILL_START_TAG = "explorer-drill-start"
const val EXPLORER_DRILL_OPTION_TAG = "explorer-drill-option"
const val EXPLORER_DRILL_NEXT_TAG = "explorer-drill-next"
const val EXPLORER_DRILL_SKIP_TAG = "explorer-drill-skip"
const val EXPLORER_DRILL_END_TAG = "explorer-drill-end"
const val EXPLORER_DRILL_DONE_TAG = "explorer-drill-done"
const val EXPLORER_DRILL_EXIT_TAG = "explorer-drill-exit"
const val EXPLORER_DRILL_AGAIN_TAG = "explorer-drill-again"

/** Right / wrong / a good score: the app's sounds and haptics (no-ops in previews). */
class DrillFx(val right: () -> Unit = {}, val wrong: () -> Unit = {}, val celebrate: () -> Unit = {})

/** Where the drill is: question [index], the option [picked] / whether the writing counted, the score so far. */
data class DrillUiState(val index: Int = 0, val picked: Int? = null, val wrote: Boolean? = null, val correct: Int = 0, val done: Boolean = false)

private val TONE_LABELS = listOf("1st ā", "2nd á", "3rd ǎ", "4th à", "neutral a")

/** The question line (web PROMPTS). */
fun drillAsk(q: DrillQuestion): String = when (q.kind) {
    DrillKind.MEANING -> "What does it mean?"
    DrillKind.LISTEN -> "Which word do you hear?"
    DrillKind.REVERSE -> "Which word means this?"
    DrillKind.TONE -> "Which tone is ${q.prompt} here?"
    DrillKind.WRITE -> "Write it"
}

/** The Character view's drill: the character, its "Words with 字" as the pool. */
fun charDrill(char: String, words: List<CharWordDto>?): Pair<DrillTarget, List<DictWord>>? {
    words ?: return null
    val target = DrillTarget.Char(char)
    val pool = words.map { DictWord(it.hanzi, it.pinyin, it.english) }
    return if (Drill.buildDrill(target, pool, 1).isNotEmpty()) target to pool else null
}

/** The Word view's drill: the word (with its syllables), its related words as the pool. */
fun wordDrill(ui: WordViewUi): Pair<DrillTarget, List<DictWord>>? {
    val r = ui.resolved
    if (r.english.isEmpty()) return null
    val target = DrillTarget.Word(DictWord(ui.hanzi, r.pinyin, r.english), r.syllables)
    val pool = ui.related.map { DictWord(it.related.word.hanzi, it.related.word.pinyin, it.related.word.english) }
    return if (Drill.buildDrill(target, pool, 1).isNotEmpty()) target to pool else null
}

/** "🎯 Quick drill" (shown only when a drill can be built). */
@Composable
fun QuickDrillButton(onClick: () -> Unit, modifier: Modifier = Modifier) {
    SecondaryPill("🎯 Quick drill", modifier.heightIn(min = 46.dp).testTag(EXPLORER_DRILL_START_TAG), onClick = onClick)
}

/**
 * The drill in the explorer frame (header kept: ← / a crumb ends it): the question in the body,
 * End + Next → / See score (Skip on an unanswered writing question) pinned in the footer.
 */
@Composable
fun DrillView(
    stack: List<ExplorerItem>,
    questions: List<DrillQuestion>,
    initial: DrillUiState = DrillUiState(),
    fx: DrillFx = DrillFx(),
    play: (String) -> Unit = {},
    strokeLoader: (suspend (String) -> StrokeLoad)? = null,
    onBack: () -> Unit = {},
    onCrumb: (Int) -> Unit = {},
    onClose: () -> Unit = {},
    onFinish: (correct: Int) -> Unit = {},
    onAgain: () -> Unit = {},
    onExit: () -> Unit = {},
) {
    var s by remember(questions) { mutableStateOf(initial) }
    val total = questions.size
    val good = total > 0 && s.correct.toDouble() / total >= 0.6

    if (s.done) {
        Box {
            ExplorerFrame(
                stack, onBack, onCrumb, onClose,
                footer = {
                    SecondaryPill("Again", Modifier.weight(1f).height(52.dp).testTag(EXPLORER_DRILL_AGAIN_TAG), onClick = onAgain)
                    PrimaryPill("Keep exploring", Modifier.weight(1.3f).height(52.dp).testTag(EXPLORER_DRILL_EXIT_TAG), onClick = onExit)
                },
            ) { DrillDone(s.correct, total, good) }
            if (good) ConfettiRain(key = "drill-done", colors = Palette.Confetti, modifier = Modifier.matchParentSize())
        }
        return
    }

    val q = questions[s.index]
    val answered = if (q.kind == DrillKind.WRITE) s.wrote != null else s.picked != null
    val last = s.index + 1 >= total

    LaunchedEffect(questions, s.index) { if (q.kind == DrillKind.LISTEN) play(q.prompt) }

    fun pick(i: Int) {
        if (s.picked != null) return
        val right = i == q.answer
        s = s.copy(picked = i, correct = s.correct + if (right) 1 else 0)
        if (right) fx.right() else fx.wrong()
    }

    fun next() {
        if (last) {
            s = s.copy(done = true)
            onFinish(s.correct)
            if (s.correct.toDouble() / total >= 0.6) fx.celebrate()
        } else {
            s = s.copy(index = s.index + 1, picked = null, wrote = null)
        }
    }

    ExplorerFrame(
        stack, onBack, onCrumb, onClose,
        footer = {
            SecondaryPill("End", Modifier.weight(1f).height(52.dp).testTag(EXPLORER_DRILL_END_TAG), onClick = onExit)
            if (q.kind == DrillKind.WRITE && !answered) {
                SecondaryPill("Skip", Modifier.weight(1.3f).height(52.dp).testTag(EXPLORER_DRILL_SKIP_TAG)) { s = s.copy(wrote = false) }
            } else {
                PrimaryPill(if (last) "See score" else "Next →", Modifier.weight(1.3f).height(52.dp).testTag(EXPLORER_DRILL_NEXT_TAG), enabled = answered, onClick = ::next)
            }
        },
    ) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).testTag(EXPLORER_DRILL_TAG), horizontalAlignment = Alignment.CenterHorizontally) {
            DrillProgress(s.index, total)
            Spacer(Modifier.height(18.dp))
            Text(drillAsk(q), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = Lab.colors.muted, textAlign = TextAlign.Center)
            Spacer(Modifier.height(10.dp))
            DrillPrompt(q, play)
            if (answered && q.kind != DrillKind.WRITE && !q.pinyin.isNullOrEmpty()) {
                AnimatedVisibility(true, enter = fadeIn() + scaleIn(initialScale = 0.9f)) {
                    Text(q.pinyin!!, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold, color = Lab.colors.accent, modifier = Modifier.padding(top = 4.dp).testTag("explorer-drill-pinyin"))
                }
            }
            Spacer(Modifier.height(18.dp))
            if (q.kind == DrillKind.WRITE) {
                WritingExercise(
                    text = q.prompt,
                    initialMode = WritingMode.TRACE,
                    loader = strokeLoader,
                    onComplete = { r ->
                        if (s.wrote == null) {
                            val ok = r.grade != WritingGrade.PRACTICE
                            s = s.copy(wrote = ok, correct = s.correct + if (ok) 1 else 0)
                        }
                    },
                )
            } else {
                DrillOptions(q, s.picked, ::pick)
            }
            Spacer(Modifier.height(12.dp))
        }
    }
}

@Composable
private fun DrillProgress(index: Int, total: Int) {
    Row(Modifier.fillMaxWidth().padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text("🎯 ${index + 1} / $total", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, modifier = Modifier.testTag("explorer-drill-progress"))
        Spacer(Modifier.weight(1f))
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            for (i in 0 until total) {
                val w by animateDpAsState(if (i == index) 22.dp else 8.dp, spring(Spring.DampingRatioMediumBouncy, Spring.StiffnessMedium), label = "dot")
                Box(
                    Modifier.height(8.dp).width(w).clip(CircleShape)
                        .background(if (i <= index) Lab.colors.accent.copy(alpha = if (i < index) 0.55f else 1f) else Lab.colors.cardBorder),
                )
            }
        }
    }
}

@Composable
private fun DrillPrompt(q: DrillQuestion, play: (String) -> Unit) {
    when (q.kind) {
        DrillKind.MEANING -> Text(q.prompt, fontSize = 52.sp, lineHeight = 62.sp, fontWeight = FontWeight.Medium, color = Lab.colors.ink, textAlign = TextAlign.Center)
        DrillKind.REVERSE -> Text("“${q.prompt}”", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, textAlign = TextAlign.Center)
        DrillKind.LISTEN -> Box(
            Modifier.size(84.dp).bouncyClickable(pressedScale = 0.88f) { play(q.prompt) }.clip(CircleShape).background(Lab.colors.accentSoft).testTag("explorer-drill-listen"),
            contentAlignment = Alignment.Center,
        ) { Text("🔊", fontSize = 36.sp) }
        DrillKind.TONE -> {
            val word = q.context ?: q.prompt
            Text(
                buildAnnotatedString {
                    for (cp in word.codePoints().toArray()) {
                        val c = String(Character.toChars(cp))
                        if (c == q.prompt) withStyle(SpanStyle(color = Lab.colors.accent, background = Lab.colors.accentSoft, fontWeight = FontWeight.SemiBold)) { append(c) }
                        else withStyle(SpanStyle(color = Lab.colors.muted.copy(alpha = 0.7f))) { append(c) }
                    }
                },
                fontSize = 52.sp, lineHeight = 62.sp, textAlign = TextAlign.Center,
            )
        }
        DrillKind.WRITE -> Unit
    }
}

@Composable
private fun DrillOptions(q: DrillQuestion, picked: Int?, onPick: (Int) -> Unit) {
    val perRow = when (q.kind) {
        DrillKind.MEANING -> 1
        DrillKind.TONE -> 3
        else -> 2
    }
    val chinese = q.kind == DrillKind.LISTEN || q.kind == DrillKind.REVERSE
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        q.options.indices.chunked(perRow).forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                for (i in row) {
                    val label = if (q.kind == DrillKind.TONE) TONE_LABELS.getOrElse((q.options[i].toIntOrNull() ?: 5) - 1) { q.options[i] } else q.options[i]
                    DrillOption(label, chinese, i, q.answer, picked, Modifier.weight(1f)) { onPick(i) }
                }
                repeat(perRow - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
private fun DrillOption(label: String, chinese: Boolean, index: Int, answer: Int, picked: Int?, modifier: Modifier, onClick: () -> Unit) {
    val dark = Lab.colors.card.luminance() < 0.4f
    val isRight = picked != null && index == answer
    val isWrong = picked != null && index == picked && index != answer
    val scale = remember { Animatable(1f) }
    val shake = remember { ShakeState() }
    LaunchedEffect(picked) {
        if (isRight) {
            scale.animateTo(1.07f, spring(Spring.DampingRatioMediumBouncy, Spring.StiffnessHigh))
            scale.animateTo(1f, spring(Spring.DampingRatioMediumBouncy, Spring.StiffnessMedium))
        } else if (isWrong) shake.shake()
    }
    val (bg, border, fg) = when {
        isRight -> Triple(Palette.Good.copy(alpha = if (dark) 0.25f else 0.16f), Palette.Good, if (dark) Color(0xFF86EFAC) else Color(0xFF166534))
        isWrong -> Triple(Palette.Again.copy(alpha = if (dark) 0.25f else 0.14f), Palette.Again, if (dark) Color(0xFFFCA5A5) else Color(0xFF991B1B))
        else -> Triple(Lab.colors.faint, Lab.colors.cardBorder, Lab.colors.ink)
    }
    Box(
        modifier
            .offset { IntOffset(shake.offset.value.roundToInt(), 0) }
            .scale(scale.value)
            .heightIn(min = if (chinese) 60.dp else 52.dp)
            .alpha(if (picked != null && !isRight && !isWrong) 0.45f else 1f)
            .bouncyClickable(enabled = picked == null, pressedScale = 0.96f, onClick = onClick)
            .clip(RoundedCornerShape(16.dp))
            .background(bg)
            .border(if (isRight || isWrong) 2.dp else 1.dp, border, RoundedCornerShape(16.dp))
            .testTag(EXPLORER_DRILL_OPTION_TAG)
            .padding(horizontal = 14.dp, vertical = 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label + if (isRight) "  ✓" else if (isWrong) "  ✗" else "",
            fontSize = if (chinese) 24.sp else 17.sp,
            fontWeight = if (isRight || isWrong) FontWeight.SemiBold else FontWeight.Medium,
            color = fg, textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun DrillDone(correct: Int, total: Int, good: Boolean) {
    val pop = remember { Animatable(0.4f) }
    LaunchedEffect(Unit) { pop.animateTo(1f, spring(Spring.DampingRatioMediumBouncy, Spring.StiffnessLow)) }
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 28.dp).testTag(EXPLORER_DRILL_DONE_TAG),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(if (good) "🎉" else "💪", fontSize = 64.sp, modifier = Modifier.scale(pop.value))
        Spacer(Modifier.height(14.dp))
        Text(Drill.scoreLine(correct, total), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, textAlign = TextAlign.Center, modifier = Modifier.testTag("explorer-drill-score"))
        Spacer(Modifier.height(10.dp))
        Text("Practice only — your cards’ schedule isn’t touched.", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted, textAlign = TextAlign.Center)
    }
}
