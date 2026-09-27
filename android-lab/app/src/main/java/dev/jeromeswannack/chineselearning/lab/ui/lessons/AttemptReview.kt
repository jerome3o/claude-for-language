package dev.jeromeswannack.chineselearning.lab.ui.lessons

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.ChoiceExercise
import dev.jeromeswannack.chineselearning.lab.core.ConversationExercise
import dev.jeromeswannack.chineselearning.lab.core.DescribeImageExercise
import dev.jeromeswannack.chineselearning.lab.core.DictationExercise
import dev.jeromeswannack.chineselearning.lab.core.ExerciseAttempt
import dev.jeromeswannack.chineselearning.lab.core.ExerciseTypes
import dev.jeromeswannack.chineselearning.lab.core.LessonAnswers
import dev.jeromeswannack.chineselearning.lab.core.LessonAttempts
import dev.jeromeswannack.chineselearning.lab.core.LessonExercise
import dev.jeromeswannack.chineselearning.lab.core.LessonSentence
import dev.jeromeswannack.chineselearning.lab.core.ListenChoiceExercise
import dev.jeromeswannack.chineselearning.lab.core.ListenTranslateExercise
import dev.jeromeswannack.chineselearning.lab.core.MatchExercise
import dev.jeromeswannack.chineselearning.lab.core.NoteExercise
import dev.jeromeswannack.chineselearning.lab.core.OralExpressionExercise
import dev.jeromeswannack.chineselearning.lab.core.ScrambleExercise
import dev.jeromeswannack.chineselearning.lab.core.SentenceMakingExercise
import dev.jeromeswannack.chineselearning.lab.core.SpeakExercise
import dev.jeromeswannack.chineselearning.lab.core.TranslateExercise
import dev.jeromeswannack.chineselearning.lab.core.UnknownExercise
import dev.jeromeswannack.chineselearning.lab.core.WritingInput
import dev.jeromeswannack.chineselearning.lab.core.WriteHandwritingExercise
import dev.jeromeswannack.chineselearning.lab.core.WriteTypedExercise
import dev.jeromeswannack.chineselearning.lab.data.api.AttemptDetailDto
import dev.jeromeswannack.chineselearning.lab.data.api.AttemptMediaDto
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

private val RATING = listOf("Again", "Hard", "Good", "Easy")

/**
 * One lesson attempt, exercise by exercise (the web's AttemptReview): what was asked, what
 * was answered (wrong characters marked, options picked, handwriting re-drawn, recordings
 * with their transcript, Claude's feedback, conversation answers), whether it was right
 * and the time per exercise and section. Read-only; package F's tutor review can reuse it.
 */
@Composable
fun AttemptReview(attempt: AttemptDetailDto, onPlayRecording: (AttemptMediaDto) -> Unit, playingKey: String? = null) {
    val spec = attempt.spec
    val data = attempt.data
    val sections = LessonAttempts.sectionTimes(data)
    val media = attempt.media.associateBy { it.mediaKey }
    val longest = maxOf(1L, sections.maxOfOrNull { it.durationMs } ?: 1L)
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Stat(attempt.total?.takeIf { it > 0 }?.let { "${attempt.correct}/$it" } ?: "—", "score", Modifier.weight(1f))
            Stat(LessonAttempts.formatDuration(attempt.durationMs), "total time", Modifier.weight(1f))
            Stat(attempt.rating?.let { RATING.getOrNull(it) } ?: "—", "rating", Modifier.weight(1f))
        }
        if (sections.size > 1) {
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Lab.colors.card).padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                for (s in sections) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(spec.sections.getOrNull(s.section)?.title?.takeIf { it.isNotBlank() } ?: "Section ${s.section + 1}", fontSize = 13.sp, color = Lab.colors.ink, modifier = Modifier.width(110.dp), maxLines = 1)
                        Box(Modifier.weight(1f).height(8.dp).clip(CircleShape).background(Lab.colors.faint)) {
                            Box(Modifier.fillMaxHeight().fillMaxWidth(s.durationMs.toFloat() / longest).clip(CircleShape).background(Violet))
                        }
                        Text(LessonAttempts.formatDuration(s.durationMs) + if (s.scored > 0) " · ${s.correct}/${s.scored}" else "", fontSize = 12.sp, color = Lab.colors.muted, modifier = Modifier.padding(start = 8.dp))
                    }
                }
            }
        }
        for ((si, list) in data.exercises.groupBy { it.section }.toSortedMap()) {
            spec.sections.getOrNull(si)?.title?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = Lab.colors.ink) }
            for (ex in list) {
                val exercise = spec.sections.getOrNull(ex.section)?.exercises?.getOrNull(ex.index)
                val m = ex.answer?.recording?.let { media[it.mediaKey] }
                val tint = when (ex.correct) { true -> Palette.Good; false -> Palette.Again; null -> Lab.colors.cardBorder }
                Column(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Lab.colors.card).border(1.5.dp, tint.copy(alpha = 0.5f), RoundedCornerShape(16.dp)).padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(ExerciseTypes.label(ex.type), fontWeight = FontWeight.SemiBold, color = Violet, fontSize = 14.sp, modifier = Modifier.weight(1f))
                        Verdict(ex)
                        Text("  ⏱ ${LessonAttempts.formatDuration(ex.durationMs)}", fontSize = 12.sp, color = Lab.colors.muted)
                    }
                    AnswerBody(exercise, ex, m, onPlayRecording, playingKey)
                }
            }
        }
    }
}

@Composable
private fun Stat(value: String, label: String, modifier: Modifier) {
    Column(modifier.clip(RoundedCornerShape(16.dp)).background(Lab.colors.card).padding(vertical = 12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Lab.colors.ink)
        Text(label, style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted)
    }
}

@Composable
private fun Verdict(a: ExerciseAttempt) {
    if (a.correct == null) { Text("not scored", fontSize = 12.sp, color = Lab.colors.muted); return }
    val pts = if (a.maxPoints > 1) " ${a.points}/${a.maxPoints}" else ""
    val self = if (a.answer?.selfAssessed == true) " · self-assessed" else ""
    val ok = a.correct == true
    Text((if (ok) "✓" else "✗") + pts + self, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = if (ok) Palette.Good else Palette.Again)
}

@Composable
private fun AttRow(label: String, value: String) {
    Row {
        Text(label, fontSize = 13.sp, color = Lab.colors.muted, modifier = Modifier.width(92.dp))
        Text(value, fontSize = 15.sp, color = Lab.colors.ink, modifier = Modifier.weight(1f))
    }
}

private fun LessonSentence.line() = hanzi + (pinyin?.let { " $it" } ?: "") + (english?.let { " — $it" } ?: "")

@Composable
private fun TypedDiff(text: String?, expected: String, alternatives: List<String>) {
    if (text.isNullOrEmpty()) { AttRow("Answered", "(nothing typed)"); return }
    val d = LessonAnswers.diffHanzi(text, expected, alternatives)
    Row {
        Text("Typed", fontSize = 13.sp, color = Lab.colors.muted, modifier = Modifier.width(92.dp))
        Text(buildAnnotatedString { d.typed.forEach { withStyle(SpanStyle(color = if (it.hit) Palette.Good else Palette.Again)) { append(it.ch) } } }, fontSize = 20.sp)
    }
    if (!d.correct) Row {
        Text("Answer", fontSize = 13.sp, color = Lab.colors.muted, modifier = Modifier.width(92.dp))
        Text(buildAnnotatedString { d.expected.forEach { withStyle(SpanStyle(color = if (it.hit) Lab.colors.ink else Palette.Hard, fontWeight = if (it.hit) null else FontWeight.Bold)) { append(it.ch) } } }, fontSize = 20.sp)
    }
}

@Composable
private fun Handwritten(a: ExerciseAttempt, model: String) {
    val run = dev.jeromeswannack.chineselearning.lab.core.StrokeRunReview.parse(a.answer?.handwriting?.writing)
    if (run != null) return StrokeRunView(run)
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        val strokes = a.answer?.handwriting?.strokes
        Box(Modifier.weight(1f)) { if (strokes != null) StrokesView(strokes, "Wrote", maxHeight = 120.dp) else Text("(nothing)", color = Lab.colors.muted) }
        Text(model, fontSize = 30.sp, color = Lab.colors.ink, textAlign = TextAlign.Center, modifier = Modifier.weight(1f))
    }
}

@Composable
private fun AnswerBody(exercise: LessonExercise?, attempt: ExerciseAttempt, media: AttemptMediaDto?, onPlay: (AttemptMediaDto) -> Unit, playingKey: String?) {
    val a = attempt.answer
    when (exercise) {
        null, is UnknownExercise -> Text("This exercise is no longer in the lesson.", color = Lab.colors.muted)
        is NoteExercise -> Text("${exercise.title?.takeIf { it.isNotBlank() } ?: "Teaching note"} — read.", color = Lab.colors.muted)
        is ScrambleExercise -> {
            AttRow("Task", exercise.english)
            AttRow("Built", a?.order?.takeIf { it.isNotEmpty() }?.joinToString(" ") ?: "—")
            if (attempt.correct != true) AttRow("Answer", exercise.correctOrder.joinToString(" "))
            if (a?.hintUsed == true) AttRow("Hint", "looked at the English")
        }
        is ChoiceExercise -> {
            AttRow("Question", exercise.question)
            AttRow("Picked", a?.choice?.let { exercise.options.getOrNull(it)?.line() } ?: "—")
            if (attempt.correct != true) exercise.options.getOrNull(exercise.correct)?.let { AttRow("Answer", it.line()) }
        }
        is ListenChoiceExercise -> {
            AttRow("Played", exercise.audio.line())
            AttRow("Picked", a?.choice?.let { exercise.options.getOrNull(it)?.line() } ?: "—")
            if (attempt.correct != true) exercise.options.getOrNull(exercise.correct)?.let { AttRow("Answer", it.line()) }
            a?.plays?.let { AttRow("Listened", "$it×") }
        }
        is TranslateExercise -> {
            AttRow("English", exercise.english)
            AttRow("Typed", a?.text ?: "(said it / no text)")
            AttRow("Reference", exercise.referenceHanzi)
        }
        is ListenTranslateExercise -> {
            AttRow("Played", exercise.audio.line())
            AttRow("Their answer", a?.text ?: "(in their head)")
            a?.plays?.let { AttRow("Listened", "$it×") }
        }
        is MatchExercise -> AttRow("Wrong taps", "${a?.mistakes ?: 0}")
        is DescribeImageExercise -> AttRow("Reference", exercise.referenceHanzi)
        is SpeakExercise -> AttRow("Prompt", exercise.prompt)
        is SentenceMakingExercise -> {
            AttRow("Words", exercise.words.joinToString("、") { it.hanzi })
            exercise.task?.takeIf { it.isNotBlank() }?.let { AttRow("Task", it) }
            a?.text?.takeIf { it.isNotBlank() }?.let { AttRow("Wrote", it) }
            a?.handwriting?.strokes?.let { StrokesView(it, "Handwritten", maxHeight = 120.dp) }
            a?.feedback?.let { f ->
                val v = when (f.verdict) { "correct" -> "correct"; "minor" -> "almost"; else -> "not quite" }
                Text("Claude: $v" + (if (!f.usesAllWords) " · missed a target word" else ""), fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
                f.corrected?.let { Text(it.line(), color = Lab.colors.ink) }
                Text(f.comment, color = Lab.colors.muted)
            }
        }
        is WriteTypedExercise -> {
            AttRow("Cue", exercise.answer.english ?: exercise.answer.pinyin ?: "🔊")
            TypedDiff(a?.text, exercise.answer.hanzi, exercise.alternatives.orEmpty())
        }
        is WriteHandwritingExercise -> {
            AttRow("Cue", exercise.answer.english ?: exercise.answer.pinyin ?: "🔊")
            Handwritten(attempt, exercise.answer.hanzi)
        }
        is DictationExercise -> {
            AttRow("Played", exercise.audio.line())
            if (exercise.input == WritingInput.HANDWRITE) Handwritten(attempt, exercise.audio.hanzi)
            else TypedDiff(a?.text, exercise.audio.hanzi, exercise.alternatives.orEmpty())
            a?.plays?.let { AttRow("Listened", "$it×") }
        }
        is OralExpressionExercise -> {
            AttRow("Prompt", exercise.prompt)
            when {
                media != null -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    SecondaryPill(if (playingKey == media.audioKey) "■ Playing" else "▶ Recording") { onPlay(media) }
                    a?.recording?.let { Text(LessonAttempts.formatDuration(it.durationMs), color = Lab.colors.muted) }
                }
                a?.recording != null -> Text("Recording made — it uploads the next time the device syncs.", color = Lab.colors.muted)
                else -> Text("No recording (said it without recording).", color = Lab.colors.muted)
            }
            media?.transcript?.let { Text(it + (media.transcriptTranslation?.let { t -> " — $t" } ?: ""), color = Lab.colors.ink) }
            if (media?.transcriptStatus == "pending") Text("Transcribing…", color = Lab.colors.muted)
        }
        is ConversationExercise -> {
            AttRow("Situation", exercise.situation)
            a?.plays?.let { AttRow("Listened", "$it×" + if (a.hintUsed == true) " · read the transcript" else "") }
            exercise.questions.forEachIndexed { i, q ->
                val qa = a?.questions?.getOrNull(i)
                val options = q.options
                val choice = qa?.choice
                val right = q.correct
                val picked = if (choice != null && options != null) options.getOrNull(choice) else qa?.text
                val mark = when (qa?.correct) { true -> "✓ "; false -> "✗ "; null -> "" }
                Column {
                    Text("${i + 1}. ${q.question}", color = Lab.colors.ink)
                    Text(
                        mark + (picked ?: "—") + if (qa?.correct == false && options != null && right != null) " (answer: ${options.getOrNull(right)})" else "",
                        color = when (qa?.correct) { true -> Palette.Good; false -> Palette.Again; null -> Lab.colors.muted },
                    )
                }
            }
        }
    }
}
