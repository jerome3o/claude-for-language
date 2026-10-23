package dev.jeromeswannack.chineselearning.lab.ui.lessons

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.ExerciseAnswer
import dev.jeromeswannack.chineselearning.lab.core.GapChoiceExercise
import dev.jeromeswannack.chineselearning.lab.core.ItemAnswer
import dev.jeromeswannack.chineselearning.lab.core.JudgeExercise
import dev.jeromeswannack.chineselearning.lab.core.JudgeGap
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

/*
 * The two per-sentence exercises — the Compose twins of the web's judge-gap-exercises.tsx
 * (rules in core/…/JudgeGap.kt, parity-tested): "Judge each sentence" (✓ Correct / ✗ Incorrect
 * per sentence) and "Choose the word" (one gap per sentence, 2–4 words). Checked on the phone.
 * Jerome is somewhat red / green colour-blind: every state is an icon + words; the chosen button
 * is FILLED (ink on white flips), a missed row gets a thick left bar — colour only backs it up.
 */

/** One judge / gap row: the card that turns ✓ / ✗ after Check. */
@Composable
private fun ItemCard(checked: Boolean, right: Boolean?, content: @Composable () -> Unit) {
    val tint = when {
        !checked || right == null -> Lab.colors.cardBorder
        right -> Palette.Good
        else -> Palette.Again
    }
    val bar = if (checked && right == false) 8.dp else 4.dp
    Row(
        Modifier.fillMaxWidth().height(IntrinsicSize.Min).clip(RoundedCornerShape(16.dp))
            .background(if (checked && right != null) tint.copy(alpha = 0.08f) else Lab.colors.card)
            .border(1.5.dp, tint, RoundedCornerShape(16.dp)),
    ) {
        Box(Modifier.width(bar).fillMaxHeight().background(tint))
        Column(Modifier.weight(1f).padding(horizontal = 12.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            content()
        }
    }
}

@Composable
private fun SentenceLine(index: Int, text: @Composable RowScope.() -> Unit, play: String?, env: ExerciseEnv) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("${index + 1}.", color = Lab.colors.muted, fontSize = 15.sp)
        text()
        if (!play.isNullOrEmpty()) PlayDot(play, env)
    }
}

@Composable
private fun PlayDot(text: String, env: ExerciseEnv) {
    Box(
        Modifier.size(44.dp).bouncyClickable(pressedScale = 0.9f) { env.speak(text) }.clip(CircleShape)
            .border(1.dp, Lab.colors.outline, CircleShape).semantics { contentDescription = "Play the sentence"; role = Role.Button },
        contentAlignment = Alignment.Center,
    ) { Text("▶", color = Lab.colors.ink, fontSize = 15.sp) }
}

/** A segmented toggle button: chosen = filled (ink background, card-coloured words) — never colour alone. */
@Composable
private fun RowScope.ToggleButton(label: String, on: Boolean, enabled: Boolean, answer: Boolean = false, big: Boolean = false, onClick: () -> Unit) {
    val bg by animateColorAsState(if (on) Lab.colors.ink else Lab.colors.card, label = "toggle")
    val fg = if (on) Lab.colors.card else if (!enabled && !answer) Lab.colors.muted else Lab.colors.ink
    val border = if (answer) Palette.Good else if (on) Lab.colors.ink else Lab.colors.outline
    Box(
        Modifier.weight(1f).heightIn(min = 52.dp)
            .bouncyClickable(enabled, 0.96f, onClick = onClick)
            .clip(RoundedCornerShape(12.dp)).background(bg)
            .border(if (answer) 3.dp else 1.dp, border, RoundedCornerShape(12.dp))
            .semantics { selected = on; role = Role.RadioButton }
            .padding(horizontal = 8.dp, vertical = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = fg, fontWeight = FontWeight.SemiBold, fontSize = if (big) 21.sp else 16.sp, textAlign = TextAlign.Center)
    }
}

@Composable
private fun ItemResult(right: Boolean, text: String) {
    Text(text, color = if (right) Palette.Good else Palette.Again, fontWeight = FontWeight.Bold, fontSize = 15.sp)
}

@Composable
private fun Details(pinyin: String?, english: String?) {
    pinyin?.takeIf { it.isNotBlank() }?.let { Text(it, color = Lab.colors.accent, fontSize = 14.sp) }
    english?.takeIf { it.isNotBlank() }?.let { Text(it, color = Lab.colors.muted, fontSize = 14.sp) }
}

@Composable
private fun CheckFooter(results: List<Boolean?>, checked: Boolean, onCheck: () -> Unit, onContinue: () -> Unit) {
    if (!checked) {
        val ready = JudgeGap.allAnswered(results)
        val left = results.count { it == null }
        ActionRow { Primary(if (ready) "Check" else "Check · $left to go", enabled = ready, onClick = onCheck) }
    } else {
        ResultBanner(results.all { it == true }, JudgeGap.scoreLine(results))
        ActionRow { Primary("Continue", onClick = onContinue) }
    }
}

// ============ Judge each sentence ============

@Composable
fun JudgeView(ex: JudgeExercise, env: ExerciseEnv, onNext: (Boolean, ExerciseAnswer?) -> Unit) {
    val judged = remember { mutableStateListOf<Boolean?>().apply { repeat(ex.sentences.size) { add(null) } } }
    var checked by remember { mutableStateOf(false) }
    val results = JudgeGap.judgeResults(ex, judged.toList())

    PhaseLabel("Correct or incorrect? ⚖️")
    ContextBox(ex.question?.takeIf { it.isNotBlank() } ?: JudgeGap.JUDGE_DEFAULT_QUESTION)
    ex.sentences.forEachIndexed { i, s ->
        val r = results[i]
        ItemCard(checked, r) {
            SentenceLine(i, { Text(s.hanzi, fontSize = 21.sp, color = Lab.colors.ink, modifier = Modifier.weight(1f)) }, if (checked && s.correct) s.hanzi else null, env)
            if (checked && s.correct) Details(s.pinyin, s.english)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ToggleButton(JudgeGap.JUDGE_CORRECT_LABEL, judged[i] == true, !checked) { env.onTap(); judged[i] = true }
                ToggleButton(JudgeGap.JUDGE_INCORRECT_LABEL, judged[i] == false, !checked) { env.onTap(); judged[i] = false }
            }
            if (checked && r != null) ItemResult(r, JudgeGap.judgeFeedback(s.correct, r))
            val fix = s.correction
            if (checked && !s.correct && fix != null) {
                Column(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Lab.colors.card)
                        .border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(12.dp)).padding(10.dp),
                    verticalArrangement = Arrangement.spacedBy(2.dp),
                ) {
                    Text("CORRECT VERSION", style = MaterialTheme.typography.labelSmall, color = Lab.colors.muted, fontWeight = FontWeight.Bold)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(fix.hanzi, fontSize = 21.sp, color = Lab.colors.ink, modifier = Modifier.weight(1f))
                        PlayDot(fix.hanzi, env)
                    }
                    Details(fix.pinyin, fix.english?.takeIf { it.isNotEmpty() } ?: s.english)
                }
            }
            if (checked) s.explanation?.takeIf { it.isNotBlank() }?.let { Explanation(it, center = false) }
        }
    }
    CheckFooter(
        results, checked,
        onCheck = {
            checked = true
            if (results.all { it == true }) env.onCorrect() else env.onWrong()
        },
        onContinue = {
            onNext(results.all { it == true }, ExerciseAnswer(items = ex.sentences.indices.map { ItemAnswer(judged = judged[it], correct = results[it]) }))
        },
    )
}

// ============ Choose the word for the gap ============

@Composable
fun GapChoiceView(ex: GapChoiceExercise, env: ExerciseEnv, onNext: (Boolean, ExerciseAnswer?) -> Unit) {
    val picks = remember { mutableStateListOf<String?>().apply { repeat(ex.items.size) { add(null) } } }
    var checked by remember { mutableStateOf(false) }
    val results = JudgeGap.gapResults(ex, picks.toList())

    PhaseLabel("Choose the word 🔀")
    ContextBox(ex.question?.takeIf { it.isNotBlank() } ?: JudgeGap.GAP_DEFAULT_QUESTION)
    ex.items.forEachIndexed { i, item ->
        val r = results[i]
        val pick = picks[i]
        val shown = if (checked) item.answer else pick
        val (before, after) = JudgeGap.gapParts(item.sentence)
        val full = JudgeGap.fillGap(item.sentence, item.answer)
        ItemCard(checked, r) {
            SentenceLine(i, {
                Text(
                    buildAnnotatedString {
                        append(before)
                        withStyle(SpanStyle(fontWeight = FontWeight.Bold, textDecoration = TextDecoration.Underline, color = if (shown != null) Lab.colors.ink else Lab.colors.muted)) {
                            append(if (shown.isNullOrEmpty()) "　　　" else " $shown ")
                        }
                        append(after)
                    },
                    fontSize = 21.sp, color = Lab.colors.ink, modifier = Modifier.weight(1f),
                )
            }, if (checked) full else null, env)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (word in JudgeGap.optionsFor(ex, item)) {
                    val on = pick == word
                    val answer = checked && word == item.answer
                    val label = if (answer) "✓ $word" else if (checked && on) "✗ $word" else word
                    ToggleButton(label, on, !checked, answer = answer, big = true) { env.onTap(); picks[i] = word }
                }
            }
            if (checked && r != null) ItemResult(r, JudgeGap.gapFeedback(item.answer, pick))
            if (checked) Details(item.pinyin, item.english)
            if (checked) item.explanation?.takeIf { it.isNotBlank() }?.let { Explanation(it, center = false) }
        }
    }
    CheckFooter(
        results, checked,
        onCheck = {
            checked = true
            if (results.all { it == true }) env.onCorrect() else env.onWrong()
        },
        onContinue = {
            onNext(results.all { it == true }, ExerciseAnswer(items = ex.items.indices.map { ItemAnswer(pick = picks[it], correct = results[it]) }))
        },
    )
}
