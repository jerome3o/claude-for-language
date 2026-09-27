package dev.jeromeswannack.chineselearning.lab.ui.editor

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.LessonExercise
import dev.jeromeswannack.chineselearning.lab.core.LessonExerciseSerializer
import dev.jeromeswannack.chineselearning.lab.core.LessonJson
import dev.jeromeswannack.chineselearning.lab.core.Lessons
import dev.jeromeswannack.chineselearning.lab.core.spec.LessonCatalogue
import dev.jeromeswannack.chineselearning.lab.core.spec.LessonDiff
import dev.jeromeswannack.chineselearning.lab.core.spec.LessonValidator
import dev.jeromeswannack.chineselearning.lab.ui.kit.ErrorState
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreenFrame
import dev.jeromeswannack.chineselearning.lab.ui.kit.LoadingState
import dev.jeromeswannack.chineselearning.lab.ui.kit.NavRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.ScreenTitle
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.lessons.ExerciseEnv
import dev.jeromeswannack.chineselearning.lab.ui.lessons.LessonPlayer
import dev.jeromeswannack.chineselearning.lab.ui.lessons.PlayerContext
import dev.jeromeswannack.chineselearning.lab.ui.lessons.flattenSpec
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject

/**
 * "Try it" (`/library/:id/try`) and the catalogue trials (`/library/catalogue/:sampleId`):
 * the REAL lesson player in preview mode (web: LessonTryPage → StudyCustomLesson `preview`) —
 * no counts, no rating, no completion event, no attempt, no recording kept. A spec that
 * doesn't decode shows its validation problems instead.
 */
@Composable
fun LessonTrialScreen(title: String, spec: JsonObject?, error: String?, env: ExerciseEnv, onBack: () -> Unit, onFinished: () -> Unit, onRetry: (() -> Unit)? = null) {
    val decoded = remember(spec) { Lessons.decodeSpec(spec) }
    if (decoded != null) {
        LessonPlayer(
            title = decoded.title.ifBlank { title },
            icon = decoded.icon,
            spec = decoded,
            env = env,
            context = PlayerContext.Preview,
            previews = null,
            onComplete = {},
            onEnd = onFinished,
        )
        return
    }
    LabScreenFrame {
        ScreenTitle(title, subtitle = "Try it — nothing is recorded", onBack = onBack)
        when {
            spec != null -> SpecProblems(LessonValidator.validate(spec))
            error != null -> ErrorState(error, onRetry = onRetry)
            else -> LoadingState(text = "Loading lesson…")
        }
    }
}

/** A spec the player can't take: the validator's problems (never a crash). */
@Composable
fun SpecProblems(problems: List<String>, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp).testTag("lesson-spec-problems"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        InlineNotice("This lesson can't be played until these are fixed:", kind = NoticeKind.Warning)
        for (p in problems.ifEmpty { listOf("The lesson isn't in a shape the player understands.") }) {
            Text("• $p", color = Lab.colors.ink, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

/**
 * The editor's Preview (web: components/editor/LessonPreview.tsx): the real player in preview
 * mode, with ‹ › / restart and a jump list over the exercises, so an author can check any
 * exercise exactly as the learner sees it. An incomplete exercise says so instead of rendering;
 * a spec that doesn't decode lists its problems.
 */
@Composable
fun LessonPreviewPane(spec: JsonObject, env: ExerciseEnv, errors: List<String> = emptyList(), modifier: Modifier = Modifier) {
    val decoded = remember(spec) { Lessons.decodeSpec(spec) }
    if (decoded == null) {
        SpecProblems(errors.ifEmpty { LessonValidator.validate(spec) }, modifier)
        return
    }
    val items = remember(decoded) { flattenSpec(decoded) }
    if (items.isEmpty()) {
        Box(modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
            Text("Add an exercise to preview it.", color = Lab.colors.muted)
        }
        return
    }
    var start by rememberSaveable { mutableIntStateOf(0) }
    var attempt by remember { mutableIntStateOf(0) }
    var current by remember { mutableIntStateOf(0) }
    var jumping by remember { mutableStateOf(false) }
    val last = items.size - 1
    val shown = current.coerceIn(0, last)
    fun go(next: Int) {
        start = next.coerceIn(0, last)
        current = start
        attempt++
    }
    val finished = current > last

    Column(modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            MiniButton("‹", { go(if (finished) last else shown - 1) }, enabled = finished || shown > 0, description = "Previous exercise")
            Box(
                Modifier.weight(1f).heightIn(min = 44.dp).clip(RoundedCornerShape(12.dp)).border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(12.dp))
                    .bouncyClickable { jumping = true }.padding(horizontal = 12.dp),
                contentAlignment = Alignment.CenterStart,
            ) {
                Text(if (finished) "Finished · ${items.size} exercises" else jumpLabel(shown, items[shown].exercise, 30), maxLines = 1, color = Lab.colors.ink, style = MaterialTheme.typography.bodyMedium)
            }
            MiniButton("›", { go(shown + 1) }, enabled = !finished && shown < last, description = "Next exercise")
            MiniButton("↺", { go(if (finished) 0 else shown) }, description = "Restart this exercise")
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            key(start, attempt) {
                LessonPlayer(
                    title = decoded.title,
                    icon = decoded.icon,
                    spec = decoded,
                    env = env,
                    context = PlayerContext.Preview,
                    previews = null,
                    onComplete = {},
                    onEnd = { go(0) },
                    startAt = start,
                    showTopBar = false,
                    onIndex = { current = it },
                )
            }
        }
    }
    if (jumping) {
        LabBottomSheet({ jumping = false }, title = "Jump to exercise") {
            items.forEachIndexed { i, it ->
                NavRow(
                    LessonCatalogue.icon(it.exercise.type),
                    "${i + 1}. ${LessonCatalogue.name(it.exercise.type)}",
                    desc = primaryText(it.exercise).take(60).ifEmpty { "(empty)" },
                    onClick = { jumping = false; go(i) },
                )
            }
        }
    }
}

private fun primaryText(ex: LessonExercise): String =
    runCatching { LessonDiff.primaryText(LessonJson.encodeToJsonElement(LessonExerciseSerializer, ex).jsonObject) }.getOrDefault("")

private fun jumpLabel(i: Int, ex: LessonExercise, max: Int): String =
    "${i + 1}. ${LessonCatalogue.icon(ex.type)} ${LessonCatalogue.name(ex.type)} — ${primaryText(ex).take(max).ifEmpty { "(empty)" }}"
