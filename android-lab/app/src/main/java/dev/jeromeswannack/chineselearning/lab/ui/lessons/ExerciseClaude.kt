package dev.jeromeswannack.chineselearning.lab.ui.lessons

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.AnswerCheck
import dev.jeromeswannack.chineselearning.lab.core.claude.ClaudeChats
import dev.jeromeswannack.chineselearning.lab.core.spec.LessonCatalogue
import dev.jeromeswannack.chineselearning.lab.data.api.ClaudeContextDto
import dev.jeromeswannack.chineselearning.lab.data.claude.ContextFields
import dev.jeromeswannack.chineselearning.lab.ui.claude.ContextClaudeSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

/*
 * 💬 Ask Claude on a mini lesson exercise = the exercise's Claude THREAD in a sheet over the lesson (the
 * web's components/lessons/ExerciseClaude.tsx; docs/STUDY_SESSION.md "Mini lessons" → "Ask Claude about an
 * exercise"). The player ([LessonPlayer]) provides [LocalExerciseClaude] for a REAL run of one of his
 * stored lessons (a preview / the catalogue / a Coach mistake lesson has no stored lesson for Claude to
 * read — the answer check there keeps its old inline "💬 Ask about this" chat).
 *
 * Two ways in: the player's top-bar 💬 (any exercise, before or after answering) and, on a checked answer,
 * the answer check's "💬 Ask Claude" ([AnswerCheckView]) — that one sends his answer and the check.
 */

/** The exercise on screen, in a stored lesson of his. */
data class ExerciseClaudeTarget(val lessonId: String, val lessonTitle: String, val exerciseKey: String, val exerciseType: String)

/** What the player hands the exercise views: open the exercise's thread (with his answer, or none). */
@Stable
class ExerciseClaude(private val target: ExerciseClaudeTarget, private val onAsk: (ExerciseClaudeTarget, String, JsonObject?) -> Unit) {
    /** [from] = "answer_check" | "toolbar"; [answer] = his answer on this showing (+ its check). */
    fun ask(from: String, answer: JsonObject? = null) = onAsk(target, from, answer)
}

val LocalExerciseClaude = staticCompositionLocalOf<ExerciseClaude?> { null }

/** His checked answer as the exercise context carries it (the web's `exerciseAnswerOf`). */
fun exerciseAnswerOf(answer: String, check: AnswerCheck?): JsonObject = buildJsonObject {
    put("text", JsonPrimitive(answer.trim().take(400)))
    if (check != null) {
        put("verdict", JsonPrimitive(check.verdict))
        if (check.headline.isNotEmpty()) put("headline", JsonPrimitive(check.headline))
        if (check.corrected.isNotEmpty()) put("corrected", JsonPrimitive(check.corrected))
        val tips = check.tips.map { t -> if (!t.quote.isNullOrEmpty()) "${t.quote}: ${t.text}" else t.text }.filter { it.isNotEmpty() }.take(3)
        if (tips.isNotEmpty()) put("tips", JsonArray(tips.map { JsonPrimitive(it) }))
    }
}

/** The open sheet's state (held by the player, outside the exercise on screen). */
@Stable
class ExerciseClaudeState {
    var open by mutableStateOf<Triple<ExerciseClaudeTarget, String, JsonObject?>?>(null)
}

/**
 * Provides [LocalExerciseClaude] for [target] (null = nothing offered) around [content], and draws the
 * thread's sheet when one is open.
 */
@Composable
fun ExerciseClaudeHost(target: ExerciseClaudeTarget?, state: ExerciseClaudeState, content: @Composable () -> Unit) {
    val api = remember(target) { target?.let { ExerciseClaude(it) { t, from, answer -> state.open = Triple(t, from, answer) } } }
    CompositionLocalProvider(LocalExerciseClaude provides api) { content() }
}

/** The sheet, when [state] has one open. */
@Composable
fun ExerciseClaudeSheet(state: ExerciseClaudeState) {
    val (target, from, answer) = state.open ?: return
    val app = LocalContext.current.applicationContext as? LabApp ?: return
    val context = ClaudeContextDto(
        ClaudeChats.EXERCISE,
        lesson_id = target.lessonId,
        exercise_key = target.exerciseKey,
        exercise_type = target.exerciseType,
        answer = answer,
        label = LessonCatalogue.name(target.exerciseType).ifEmpty { target.exerciseType },
        sublabel = target.lessonTitle,
    )
    ContextClaudeSheet(
        context = context,
        fields = ContextFields(answer = answer ?: JsonNull),
        source = "lesson",
        explorerSource = "lesson",
        onDismiss = { state.open = null },
        onResolved = { resumed ->
            app.analytics.track(
                "lesson.exercise_ask",
                mapOf("from" to from, "exercise_type" to target.exerciseType, "verdict" to ((answer?.get("verdict") as? JsonPrimitive)?.content ?: "none"), "resumed" to resumed),
            )
        },
    )
}

const val LESSON_ASK_CLAUDE_TAG = "lesson-ask-claude"

/** The player's top-bar 💬. */
@Composable
fun LessonAskClaudeButton(onClick: () -> Unit) {
    Box(
        Modifier.size(48.dp).clip(CircleShape).bouncyClickable(pressedScale = 0.9f, onClick = onClick)
            .semantics { contentDescription = "Ask Claude about this exercise" }.testTag(LESSON_ASK_CLAUDE_TAG),
        contentAlignment = Alignment.Center,
    ) {
        Box(Modifier.size(38.dp).clip(CircleShape).background(Lab.colors.card).border(1.dp, Lab.colors.cardBorder, CircleShape), contentAlignment = Alignment.Center) {
            Text("💬", fontSize = 17.sp)
        }
    }
}
