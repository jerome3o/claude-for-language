package dev.jeromeswannack.chineselearning.lab.ui.lessons

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.LessonFeedback
import dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics
import dev.jeromeswannack.chineselearning.lab.ui.coach.PractiseLabels
import dev.jeromeswannack.chineselearning.lab.ui.coach.PractiseSentenceRow
import dev.jeromeswannack.chineselearning.lab.ui.coach.PractiseUi
import dev.jeromeswannack.chineselearning.lab.ui.fx.ConfettiBurst
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

/*
 * The answer screen's feedback pieces (core LessonFeedback = shared/lesson/feedback.ts; web
 * components/lessons/LessonFeedback.tsx; docs/STUDY_SESSION.md "Mini lessons" → "Feedback"):
 * a felt right answer with a SMALL confetti burst, and 🎤 Say it again — practice only, never scored.
 */

object LessonFeedbackTags {
    const val BURST = "lesson-feel-burst"
    fun sayAgain(kind: String) = "lesson-say-again-$kind"
}

/**
 * [content] with a moment's feel played once (per [key]) and its small burst over it. Wrap the verdict
 * itself (the banner, "You said", Claude's card) so the burst comes from there.
 */
@Composable
fun FeelBox(moment: String?, env: ExerciseEnv, celebrated: Boolean = false, key: Any = Unit, content: @Composable () -> Unit) {
    val f = moment?.let { LessonFeedback.feel(it, celebrated) }
    LaunchedEffect(moment, key) { f?.feel?.let { env.feel(it) } }
    Box(Modifier.fillMaxWidth()) {
        content()
        if (f?.confetti == true) ConfettiBurst(key = "$moment:$key", colors = Palette.Confetti, modifier = Modifier.matchParentSize().testTag(LessonFeedbackTags.BURST))
    }
}

/**
 * 🎤 Say it again over [hanzi]: the coach's "Practise saying it" row (live transcription, the "You said" row),
 * its own words so it never reads as the official 🔁 Try again, and "Practice — doesn't change your score".
 * kind = answer | example | fix (Claude's corrected sentence). [preview] = a fixed state (screenshots).
 */
@Composable
fun SayItAgainRow(hanzi: String, exerciseType: String, kind: String = "answer", env: ExerciseEnv, preview: PractiseUi? = null) {
    var bursts by remember(hanzi) { mutableIntStateOf(0) }
    val label = if (kind == "fix") LessonFeedback.SAY_AGAIN_FIX_LABEL else LessonFeedback.SAY_AGAIN_LABEL
    Box(Modifier.fillMaxWidth().testTag(LessonFeedbackTags.sayAgain(kind))) {
        Column(Modifier.fillMaxWidth()) {
            PractiseSentenceRow(
                hanzi = hanzi,
                tag = "lesson-say-$kind",
                preview = preview,
                labels = PractiseLabels(label = label, listening = "Listening… say it", showListen = false, again = "🎤  $label"),
                surface = "lesson_say_again",
                haptics = false,
                onOutcome = { o -> Analytics.track("lesson.say_again", mapOf("exercise_type" to exerciseType, "target" to kind, "result" to o)) },
                onPractised = { p ->
                    val f = LessonFeedback.feel(if (p.result.accepted) LessonFeedback.SAY_AGAIN_RIGHT else LessonFeedback.SAY_AGAIN_MISS)
                    f.feel?.let { env.feel(it) }
                    if (f.confetti) bursts++
                },
            )
            Text(
                LessonFeedback.SAY_AGAIN_NOTE,
                color = Lab.colors.muted,
                fontSize = 13.sp,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
            )
        }
        if (bursts > 0) ConfettiBurst(key = "say-$hanzi-$bursts", colors = Palette.Confetti, modifier = Modifier.matchParentSize())
    }
}
