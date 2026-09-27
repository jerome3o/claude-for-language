package dev.jeromeswannack.chineselearning.lab.ui.lessons

import androidx.compose.runtime.Composable
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.LessonAttempts
import dev.jeromeswannack.chineselearning.lab.data.api.AttemptDetailDto
import dev.jeromeswannack.chineselearning.lab.data.api.AttemptMediaDto
import dev.jeromeswannack.chineselearning.lab.data.api.AttemptSummaryDto
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.ui.kit.EmptyState
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabCard
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.LoadableContent
import dev.jeromeswannack.chineselearning.lab.ui.kit.NavRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.RowDivider
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private val WHEN = DateTimeFormatter.ofPattern("EEE d MMM, HH:mm", Locale.ENGLISH)

fun formatDateTime(iso: String, zone: ZoneId = ZoneId.systemDefault()): String =
    runCatching { WHEN.format(Instant.ofEpochMilli(Js.parseDate(iso)).atZone(zone)) }.getOrDefault(iso)

/**
 * `/lesson-attempts[?lesson=]` (the learner's own, the web's MyLessonAttemptsPage) and
 * `/connections/:relId/lesson-attempts[?lesson=]` (the tutor's view of a student,
 * StudentLessonAttemptsPage) — the same list; [studentName] set = the tutor's.
 */
@Composable
fun AttemptListScreen(state: Loadable<List<AttemptSummaryDto>>, onBack: () -> Unit, onOpen: (String) -> Unit, onRetry: () -> Unit, studentName: String? = null) {
    LabScreen(if (studentName != null) "📝 Lesson attempts" else "📝 My lesson answers", onBack = onBack, subtitle = studentName) {
        item {
            LoadableContent(state, onRetry, isEmpty = { it.isEmpty() }, empty = {
                EmptyState(
                    "📝", "No answers recorded yet",
                    body = if (studentName != null) "They appear here after $studentName finishes a lesson and their device has synced."
                    else "They appear here after a lesson is finished and the phone has synced.",
                )
            }) { rows ->
                LabCard {
                    rows.forEachIndexed { i, r ->
                        if (i > 0) RowDivider()
                        NavRow(
                            icon = r.lessonIcon ?: "🎓",
                            label = r.lessonTitle,
                            desc = formatDateTime(r.completedAt) + " · " + LessonAttempts.formatDuration(r.durationMs) + if (r.recordings > 0) " · 🎙 ${r.recordings}" else "",
                            badge = r.total?.takeIf { it > 0 }?.let { "${r.correct}/$it" },
                            onClick = { onOpen(r.id) },
                        )
                    }
                }
            }
        }
    }
}

/**
 * `/lesson-attempts/:id` and `/connections/:relId/lesson-attempts/:id` — one attempt, exercise
 * by exercise (the ONE [AttemptReview] for learner and tutor); recordings play, handwriting is
 * re-drawn over the model outline ([strokeLoader]).
 */
@Composable
fun AttemptDetailScreen(
    state: Loadable<AttemptDetailDto>,
    onBack: () -> Unit,
    onRetry: () -> Unit,
    onPlay: (AttemptMediaDto) -> Unit,
    playingKey: String?,
    studentName: String? = null,
    strokeLoader: (suspend (String) -> dev.jeromeswannack.chineselearning.lab.data.strokes.StrokeLoad)? = null,
) {
    val title = state.data?.let { "${it.spec.icon ?: "🎓"} ${it.spec.title}" } ?: if (studentName != null) "Lesson answers" else "My answers"
    val subtitle = listOfNotNull(studentName, state.data?.let { formatDateTime(it.completedAt) }).joinToString(" · ").ifEmpty { null }
    LabScreen(title, onBack = onBack, subtitle = subtitle) {
        item {
            ProvideStrokeLoader(strokeLoader) {
                LoadableContent(state, onRetry) { attempt -> AttemptReview(attempt, onPlay, playingKey) }
            }
        }
    }
}
