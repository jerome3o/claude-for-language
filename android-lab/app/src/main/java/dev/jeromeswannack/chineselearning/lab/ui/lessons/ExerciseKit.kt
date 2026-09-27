package dev.jeromeswannack.chineselearning.lab.ui.lessons

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.scaleIn
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.LessonAnswers
import dev.jeromeswannack.chineselearning.lab.core.LessonSentence
import dev.jeromeswannack.chineselearning.lab.core.LessonWord
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

/*
 * The small pieces every exercise view shares — the Compose twins of the practice-page
 * classes the web's lesson-exercises.tsx / practice-exercises.tsx use (phase-label,
 * translate-prompt, contrast-option, result-banner, translate-ref, exercise-actions…).
 */

val Violet = Color(0xFF8B5CF6)

/** `phase-label`: the small uppercase heading of an exercise. */
@Composable
fun PhaseLabel(text: String) {
    Text(
        text.uppercase(),
        color = Violet,
        fontWeight = FontWeight.SemiBold,
        fontSize = 12.sp,
        letterSpacing = 1.sp,
        modifier = Modifier.fillMaxWidth(),
        textAlign = TextAlign.Center,
    )
}

/** `translate-prompt`: the big instruction / English to work from. */
@Composable
fun PromptText(text: String, modifier: Modifier = Modifier) {
    Text(text, style = MaterialTheme.typography.titleLarge, color = Lab.colors.ink, textAlign = TextAlign.Center, modifier = modifier.fillMaxWidth())
}

/** `contrast-context`: a situation / question in a soft box. */
@Composable
fun ContextBox(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.bodyLarge,
        color = Lab.colors.ink,
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Lab.colors.faint).padding(14.dp),
    )
}

/** `result-explanation` / `describe-task`: a muted line. */
@Composable
fun Explanation(text: String, modifier: Modifier = Modifier, center: Boolean = true) {
    Text(text, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted, textAlign = if (center) TextAlign.Center else TextAlign.Start, modifier = modifier.fillMaxWidth())
}

/** `result-banner`: ✓ Correct / ✗ Not quite, popping in with a spring. */
@Composable
fun ResultBanner(correct: Boolean, text: String) {
    AnimatedVisibility(true, enter = scaleIn(spring(dampingRatio = Spring.DampingRatioMediumBouncy)) + fadeIn()) {
        val color = if (correct) Palette.Good else Palette.Again
        Text(
            text,
            color = color,
            fontWeight = FontWeight.Bold,
            fontSize = 18.sp,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(color.copy(alpha = 0.12f)).padding(vertical = 12.dp, horizontal = 14.dp),
        )
    }
}

/** `exercise-actions`: one or two pills, full width. */
@Composable
fun ActionRow(content: @Composable RowScope.() -> Unit) {
    Row(Modifier.fillMaxWidth().padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically, content = content)
}

@Composable
fun RowScope.Primary(label: String, enabled: Boolean = true, onClick: () -> Unit) =
    PrimaryPill(label, Modifier.weight(1f).heightIn(min = 54.dp), enabled = enabled, onClick = onClick)

@Composable
fun RowScope.Secondary(label: String, enabled: Boolean = true, onClick: () -> Unit) =
    SecondaryPill(label, Modifier.weight(1f).heightIn(min = 54.dp), enabled = enabled, onClick = onClick)

/** `translate-ref`: a model sentence — tap it to hear it. */
@Composable
fun Reference(sentence: LessonSentence, env: ExerciseEnv, label: String? = null) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (label != null) Explanation(label)
        Column(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Lab.colors.card)
                .border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(18.dp))
                .bouncyClickable(pressedScale = 0.98f) { env.speak(sentence.hanzi) }
                .padding(horizontal = 16.dp, vertical = 14.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text("${sentence.hanzi} 🔊", fontSize = 24.sp, color = Lab.colors.ink, fontWeight = FontWeight.Medium, textAlign = TextAlign.Center)
            sentence.pinyin?.takeIf { it.isNotBlank() }?.let { Text(it, color = Lab.colors.accent, fontSize = 15.sp, textAlign = TextAlign.Center) }
            sentence.english?.takeIf { it.isNotBlank() }?.let { Text(it, color = Lab.colors.muted, fontSize = 15.sp, textAlign = TextAlign.Center) }
        }
    }
}

/** Two self-assessment buttons with the question above them. */
@Composable
fun SelfAssess(question: String, no: String = "✗ Not quite", yes: String = "✓ Got it", onAnswer: (Boolean) -> Unit) {
    Explanation(question)
    ActionRow {
        Secondary(no) { onAnswer(false) }
        Primary(yes) { onAnswer(true) }
    }
}

/** `contrast-option`: one choice; turns green / red once answered. */
@Composable
fun OptionButton(
    hanzi: String,
    state: OptionState,
    pinyin: String? = null,
    english: String? = null,
    enabled: Boolean = true,
    big: Boolean = true,
    onClick: () -> Unit,
) {
    val border by animateColorAsState(
        when (state) { OptionState.Correct -> Palette.Good; OptionState.Wrong -> Palette.Again; OptionState.Selected -> Lab.colors.accent; OptionState.Idle -> Lab.colors.cardBorder },
        label = "option",
    )
    val bg = when (state) { OptionState.Correct -> Palette.Good.copy(alpha = 0.10f); OptionState.Wrong -> Palette.Again.copy(alpha = 0.10f); OptionState.Selected -> Lab.colors.accentSoft; OptionState.Idle -> Lab.colors.card }
    Column(
        Modifier.fillMaxWidth().heightIn(min = 56.dp)
            .bouncyClickable(enabled, 0.97f, onClick = onClick)
            .clip(RoundedCornerShape(16.dp)).background(bg).border(2.dp, border, RoundedCornerShape(16.dp))
            .padding(horizontal = 16.dp, vertical = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(hanzi, fontSize = if (big) 22.sp else 17.sp, color = Lab.colors.ink, textAlign = TextAlign.Center)
        pinyin?.takeIf { it.isNotBlank() }?.let { Text(it, color = Lab.colors.accent, fontSize = 14.sp, textAlign = TextAlign.Center) }
        english?.takeIf { it.isNotBlank() }?.let { Text(it, color = Lab.colors.muted, fontSize = 14.sp, textAlign = TextAlign.Center) }
    }
}

enum class OptionState { Idle, Selected, Correct, Wrong }

/** A text answer box (16sp+ so the keyboard never zooms anything). */
@Composable
fun AnswerField(
    value: String,
    onChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    singleLine: Boolean = false,
    enabled: Boolean = true,
    big: Boolean = false,
    onDone: (() -> Unit)? = null,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        enabled = enabled,
        placeholder = { Text(placeholder, color = Lab.colors.muted) },
        singleLine = singleLine,
        minLines = if (singleLine) 1 else 3,
        textStyle = MaterialTheme.typography.bodyLarge.copy(fontSize = if (big) 24.sp else 18.sp, color = Lab.colors.ink),
        shape = RoundedCornerShape(16.dp),
        keyboardOptions = KeyboardOptions(imeAction = if (onDone != null) ImeAction.Done else ImeAction.Default),
        keyboardActions = KeyboardActions(onDone = { onDone?.invoke() }),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = Lab.colors.accent,
            unfocusedBorderColor = Lab.colors.cardBorder,
            focusedContainerColor = Lab.colors.card,
            unfocusedContainerColor = Lab.colors.card,
            disabledContainerColor = Lab.colors.faint,
        ),
        modifier = modifier.fillMaxWidth(),
    )
}

/** `speak-transcript`: what the learner typed, green when it matches exactly. */
@Composable
fun YourAnswer(text: String, exact: Boolean, label: String = "Your answer") {
    val tint = if (exact) Palette.Good else Lab.colors.muted
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(if (exact) Palette.Good.copy(alpha = 0.10f) else Lab.colors.faint).padding(14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(label, style = MaterialTheme.typography.labelMedium, color = tint)
            if (exact) Text("  ✓ Exact match", style = MaterialTheme.typography.labelMedium, color = Palette.Good, fontWeight = FontWeight.Bold)
        }
        Text(text, fontSize = 20.sp, color = Lab.colors.ink)
    }
}

/** `word-chips`: target words / hints; tap to hear. [marks] = used ✓ / missing ✗ after checking. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun WordChips(words: List<LessonWord>, env: ExerciseEnv, marks: List<Boolean>? = null) {
    FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        words.forEachIndexed { i, w ->
            val mark = marks?.getOrNull(i)
            val tint = when (mark) { true -> Palette.Good; false -> Palette.Again; null -> Lab.colors.cardBorder }
            Column(
                Modifier.bouncyClickable { env.speak(w.hanzi) }.clip(RoundedCornerShape(14.dp)).background(Lab.colors.card)
                    .border(1.5.dp, tint, RoundedCornerShape(14.dp)).padding(horizontal = 14.dp, vertical = 8.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text((if (mark == true) "✓ " else if (mark == false) "✗ " else "") + w.hanzi, fontSize = 20.sp, color = Lab.colors.ink)
                w.pinyin?.takeIf { it.isNotBlank() }?.let { Text(it, fontSize = 12.sp, color = Lab.colors.accent) }
                w.english?.takeIf { it.isNotBlank() }?.let { Text(it, fontSize = 12.sp, color = Lab.colors.muted) }
            }
        }
    }
}

/** `CharDiffView`: typed characters (wrong in red) and, when wrong, the answer (missed underlined). */
@Composable
fun CharDiffView(diff: LessonAnswers.HanziDiff) {
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Lab.colors.card).border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(16.dp)).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        DiffRow("You wrote", if (diff.typed.isEmpty()) null else diff.typed.map { it.ch to if (it.hit) Palette.Good else Palette.Again }, strike = true)
        if (!diff.correct) DiffRow("Answer", diff.expected.map { it.ch to if (it.hit) Lab.colors.ink else Palette.Hard }, strike = false)
    }
}

@Composable
private fun DiffRow(label: String, chars: List<Pair<String, Color>>?, strike: Boolean) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted, modifier = Modifier.padding(end = 12.dp))
        if (chars == null) {
            Text("(nothing)", color = Lab.colors.muted)
        } else {
            val muted = Lab.colors.ink
            Text(
                buildAnnotatedString {
                    for ((ch, color) in chars) {
                        val miss = color != Palette.Good && color != muted
                        withStyle(SpanStyle(color = color, textDecoration = if (miss) (if (strike) TextDecoration.LineThrough else TextDecoration.Underline) else null, fontWeight = if (miss) FontWeight.Bold else null)) { append(ch) }
                    }
                },
                fontSize = 26.sp,
            )
        }
    }
}

/**
 * `ListenPlayButton`: the big replayable 🔊. Plays once when it first appears (the exercise
 * starts in the ear); the played text is never shown next to it.
 */
@Composable
fun ListenPlayButton(text: String, env: ExerciseEnv, autoPlay: Boolean = true, onPlay: () -> Unit = {}) {
    LaunchedEffect(Unit) { if (autoPlay) { env.speak(text); onPlay() } }
    val playing = env.playing == text
    val pulse by animateFloatAsState(if (playing) 1.08f else 1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessLow), label = "pulse")
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            Modifier.size(112.dp).scale(pulse).bouncyClickable(pressedScale = 0.92f) { env.speak(text); onPlay() }.clip(CircleShape).background(Lab.colors.accentSoft),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.AutoMirrored.Filled.VolumeUp, "Play audio", Modifier.size(48.dp), tint = Lab.colors.accent)
        }
        Text("Tap to replay", style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted, modifier = Modifier.padding(top = 6.dp))
    }
}
