package dev.jeromeswannack.chineselearning.lab.ui.lessons

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.ui.platform.testTag
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.CustomLessonSpec
import dev.jeromeswannack.chineselearning.lab.core.ExerciseAttempt
import dev.jeromeswannack.chineselearning.lab.core.IntervalPreview
import dev.jeromeswannack.chineselearning.lab.core.Rating
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.LessonAttemptData
import dev.jeromeswannack.chineselearning.lab.core.LessonAttempts
import dev.jeromeswannack.chineselearning.lab.core.LessonExercise
import dev.jeromeswannack.chineselearning.lab.core.Lessons
import dev.jeromeswannack.chineselearning.lab.core.QueueCounts
import dev.jeromeswannack.chineselearning.lab.data.lessons.LessonRecording
import dev.jeromeswannack.chineselearning.lab.ui.fx.ConfettiRain
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.study.RatingBar
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

/** One exercise in play order (`flattenSpec`). */
data class FlatExercise(val exercise: LessonExercise, val section: Int, val index: Int, val sectionTitle: String?, val sectionStart: Boolean)

/** `flattenSpec`; exercise types this build doesn't know are left out. */
fun flattenSpec(spec: CustomLessonSpec): List<FlatExercise> = spec.sections.flatMapIndexed { si, section ->
    section.exercises.mapIndexedNotNull { i, ex ->
        if (!Lessons.isPlayable(ex)) null else FlatExercise(ex, si, i, section.title, i == 0 && !section.title.isNullOrBlank())
    }
}

/** What a finished run hands back (StudyCustomLesson's onComplete). */
data class LessonResult(
    val correct: Int,
    val total: Int,
    val rating: Int,
    val attempt: LessonAttemptData,
    val recordings: List<LessonRecording>,
    /** "Done for good": finished (rated Good for the record) and never scheduled again. */
    val retire: Boolean = false,
)

/** Where the player sits: the study session (counts), a homework pass, or a preview (nothing recorded). */
sealed interface PlayerContext {
    data class Session(val counts: QueueCounts) : PlayerContext
    data object Homework : PlayerContext
    data object Preview : PlayerContext
    /** Lab "today split": a lesson started from Home / today's list (recorded exactly like the session). */
    data object Today : PlayerContext
}

/**
 * A half-done run to continue ([saved], null = start fresh) and where to save the run after
 * every exercise (core LessonResume; data/lessons/LessonProgressStore). Never for previews.
 */
class LessonResumeHandle(
    val saved: dev.jeromeswannack.chineselearning.lab.core.LessonResume.Progress?,
    val onProgress: (index: Int, correct: Int, total: Int, startedAt: Long, attempts: List<ExerciseAttempt>, recordings: List<LessonRecording>) -> Unit = { _, _, _, _, _, _ -> },
    val onStartOver: () -> Unit = {},
)

/**
 * A custom mini lesson (the web's StudyCustomLesson): walks the flattened exercises,
 * builds the attempt (answer + time per exercise, recordings by media key) and ends with
 * the rating bar (its gap sets when the lesson comes back — "revisit later") and Done for good. [PlayerContext.Preview] records nothing
 * and offers Try again / Done instead of a rating.
 */
/** `lesson.start` / `lesson.complete` source: where the player sits. */
private fun lessonSource(context: PlayerContext): String = when (context) {
    is PlayerContext.Session -> "session"
    PlayerContext.Homework -> "homework"
    PlayerContext.Preview -> "preview"
    PlayerContext.Today -> "today"
}

@Composable
fun LessonPlayer(
    title: String,
    icon: String?,
    spec: CustomLessonSpec,
    env: ExerciseEnv,
    context: PlayerContext,
    previews: List<IntervalPreview>?,
    onComplete: (LessonResult) -> Unit,
    onEnd: () -> Unit,
    onCelebrate: () -> Unit = {},
    startAt: Int = 0,
    /** False inside the study session, which keeps its own top bar (counts, ✕, undo). */
    showTopBar: Boolean = true,
    /** The exercise now on screen (the editor preview's jump bar follows it); items.size = done. */
    onIndex: (Int) -> Unit = {},
    /** Continue a half-done run and save this one after every exercise (null: previews, nothing kept). */
    resume: LessonResumeHandle? = null,
) {
    val items = remember(spec) { flattenSpec(spec) }
    var run by remember { mutableIntStateOf(0) }
    // A run saved earlier today continues where it stopped (the exercise on screen starts again).
    val restored = remember(spec) { resume?.saved?.takeIf { context !is PlayerContext.Preview && it.index in 1..items.size } }
    var continuing by remember { mutableStateOf(restored != null) }
    fun from(run: Int) = if (run == 0) restored else null
    var idx by remember(run) { mutableIntStateOf(from(run)?.index ?: startAt) }
    var correct by remember(run) { mutableIntStateOf(from(run)?.correct ?: 0) }
    var total by remember(run) { mutableIntStateOf(from(run)?.total ?: 0) }
    var rating by remember(run) { mutableStateOf(false) }
    val startedAt = remember(run) { from(run)?.startedAt ?: System.currentTimeMillis() }
    var exerciseStart by remember(run) { mutableLongStateOf(System.currentTimeMillis()) }
    val attempts = remember(run) { mutableStateListOf<ExerciseAttempt>().apply { from(run)?.let { addAll(it.attempts) } } }
    val recordings = remember(run) {
        mutableStateListOf<LessonRecording>().apply { from(run)?.let { p -> addAll(p.recordings.map { LessonRecording(it.mediaKey, java.io.File(it.path), it.mime) }) } }
    }
    val preview = context is PlayerContext.Preview
    val done = idx >= items.size

    LaunchedEffect(done) { if (done) onCelebrate() }
    // Usage analytics: a real run (previews record nothing — not even this).
    LaunchedEffect(run) { if (!preview) dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics.track("lesson.start", mapOf("source" to lessonSource(context), "exercises" to items.size)) }
    LaunchedEffect(idx) { onIndex(idx) }

    fun advance(isCorrect: Boolean?, answer: dev.jeromeswannack.chineselearning.lab.core.ExerciseAnswer?, recording: java.io.File?) {
        val item = items[idx]
        val attempt = LessonAttempts.attemptFor(item.section, item.index, item.exercise, isCorrect, answer, System.currentTimeMillis() - exerciseStart)
        if (isCorrect != null && attempt.maxPoints > 0) {
            correct += attempt.points
            total += attempt.maxPoints
        }
        attempts += attempt
        val rec = answer?.recording
        if (recording != null && rec != null) recordings += LessonRecording(rec.mediaKey, recording, rec.mime ?: "audio/mp4")
        exerciseStart = System.currentTimeMillis()
        idx++
        continuing = false
        if (!preview) resume?.onProgress(idx, correct, total, startedAt, attempts.toList(), recordings.toList())
    }

    Box(Modifier.fillMaxSize().background(Lab.colors.background).then(if (showTopBar) Modifier.safeDrawingPadding() else Modifier)) {
        Column(Modifier.fillMaxSize()) {
            if (showTopBar) Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.weight(1f).padding(start = 12.dp)) {
                    when (context) {
                        is PlayerContext.Session -> SessionCounts(context.counts)
                        PlayerContext.Homework -> Text("Homework", fontWeight = FontWeight.SemiBold, color = Lab.colors.muted)
                        PlayerContext.Today -> Text("Today's mini lesson", fontWeight = FontWeight.SemiBold, color = Lab.colors.muted)
                        PlayerContext.Preview -> Text("Preview · nothing is recorded", color = Violet, fontWeight = FontWeight.SemiBold, fontSize = 14.sp,
                            modifier = Modifier.clip(CircleShape).background(Violet.copy(alpha = 0.12f)).padding(horizontal = 12.dp, vertical = 6.dp))
                    }
                }
                IconButton(onClick = onEnd) { Icon(Icons.Filled.Close, if (preview) "Close preview" else "End session", tint = Lab.colors.muted) }
            }

            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.TopCenter) {
                Column(
                    Modifier.fillMaxSize().widthIn(max = 720.dp).verticalScroll(rememberScrollState()).imePadding().padding(horizontal = 20.dp, vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("${icon ?: "🎓"}  MINI LESSON", color = Violet, fontWeight = FontWeight.SemiBold, fontSize = 12.sp, letterSpacing = 1.sp)
                        Text(title, fontWeight = FontWeight.SemiBold, fontSize = 18.sp, color = Lab.colors.ink, textAlign = TextAlign.Center)
                    }
                    if (continuing && run == 0 && restored != null) {
                        ContinueLine(dev.jeromeswannack.chineselearning.lab.core.LessonResume.continueLine(restored.index, items.size)) {
                            resume?.onStartOver()
                            continuing = false
                            run++
                        }
                    }
                    if (!done) {
                        val progress by animateFloatAsState(if (items.isEmpty()) 1f else idx.toFloat() / items.size, spring(dampingRatio = 0.9f, stiffness = 120f), label = "lessonProgress")
                        Box(Modifier.fillMaxWidth().height(6.dp).clip(CircleShape).background(Lab.colors.faint)) {
                            Box(Modifier.fillMaxHeight().fillMaxWidth(progress.coerceIn(0f, 1f)).clip(CircleShape).background(Brush.horizontalGradient(listOf(Violet, Palette.Easy))))
                        }
                    }
                    AnimatedContent(
                        targetState = idx,
                        transitionSpec = {
                            (slideInHorizontally(spring(dampingRatio = 0.85f, stiffness = 380f)) { it / 4 } + fadeIn(tween(180))) togetherWith
                                (slideOutHorizontally(tween(200)) { -it / 4 } + fadeOut(tween(150)))
                        },
                        label = "exercise",
                    ) { i ->
                        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            if (i >= items.size) {
                                DoneBody(icon, title, correct, total, preview)
                            } else {
                                val item = items[i]
                                if (item.sectionStart) {
                                    Text(item.sectionTitle.orEmpty(), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = Lab.colors.ink)
                                }
                                if (Lessons.renderable(item.exercise)) {
                                    ExerciseView(item.exercise, env, if (preview) null else LessonAttempts.mediaKey(item.section, item.index)) { c, a, r -> if (i == idx) advance(c, a, r) }
                                } else {
                                    // A half-typed exercise in the editor (the validator is the authority; this keeps it from crashing).
                                    Text("This exercise isn't complete yet — fill in its fields to preview it.", color = Lab.colors.muted)
                                    SecondaryPill("Skip", Modifier.height(48.dp)) { if (i == idx) advance(null, null, null) }
                                }
                            }
                        }
                    }
                    Spacer(Modifier.height(24.dp))
                }
                if (done) ConfettiRain(key = run, colors = Palette.Confetti)
            }

            if (done && !preview && previews != null) {
                Column(Modifier.fillMaxWidth().background(Lab.colors.card).padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("How well do you know this material now?", color = Lab.colors.muted, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
                    RatingBar(previews, enabled = !rating) { r ->
                        if (rating) return@RatingBar
                        rating = true
                        val attempt = LessonAttemptData(Js.toIsoString(startedAt), System.currentTimeMillis() - startedAt, attempts.toList())
                        dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics.track("lesson.complete", mapOf("rating" to listOf("again", "hard", "good", "easy").getOrNull(r), "source" to lessonSource(context), "duration_ms" to System.currentTimeMillis() - startedAt))
                        onComplete(LessonResult(correct, total, r, attempt, recordings.toList()))
                    }
                    // "Revisit later": or never again (web: RatingButtons onDoneForGood).
                    dev.jeromeswannack.chineselearning.lab.ui.kit.DoneForGoodButton(enabled = !rating) {
                        if (rating) return@DoneForGoodButton
                        rating = true
                        val attempt = LessonAttemptData(Js.toIsoString(startedAt), System.currentTimeMillis() - startedAt, attempts.toList())
                        dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics.track("lesson.complete", mapOf("rating" to "good", "source" to lessonSource(context), "duration_ms" to System.currentTimeMillis() - startedAt))
                        onComplete(LessonResult(correct, total, Rating.GOOD, attempt, recordings.toList(), retire = true))
                    }
                }
            }
            if (done && preview) {
                Row(Modifier.fillMaxWidth().background(Lab.colors.card).padding(16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    SecondaryPill("↻ Try again", Modifier.weight(1f).height(54.dp)) { run++ }
                    PrimaryPill("Done", Modifier.weight(1f).height(54.dp), onClick = onEnd)
                }
            }
        }
    }
}

/** "Continuing where you left off · exercise 4 of 9 · Start over" — subtle, above the progress bar. */
@Composable
private fun ContinueLine(text: String, onStartOver: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(CircleShape).background(Violet.copy(alpha = 0.08f)).padding(start = 14.dp, end = 4.dp)
            .testTag(CONTINUE_TAG),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text, color = Lab.colors.muted, fontSize = 13.sp, modifier = Modifier.weight(1f))
        androidx.compose.material3.TextButton(onClick = onStartOver, modifier = Modifier.heightIn(min = 44.dp)) {
            Text("Start over", color = Violet, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
        }
    }
}

/** Test tag of the "Continuing where you left off" line. */
const val CONTINUE_TAG = "lesson-continue"

@Composable
private fun DoneBody(icon: String?, title: String, correct: Int, total: Int, preview: Boolean) {
    var shown by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { shown = true }
    val scale by animateFloatAsState(if (shown) 1f else 0.3f, spring(dampingRatio = 0.45f, stiffness = 200f), label = "lessonTrophy")
    Column(Modifier.fillMaxWidth().padding(top = 24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(icon ?: "🎓", fontSize = 76.sp, modifier = Modifier.scale(scale))
        Text("Lesson complete", style = MaterialTheme.typography.headlineMedium, color = Lab.colors.ink)
        Text(title, style = MaterialTheme.typography.titleMedium, color = Lab.colors.muted, textAlign = TextAlign.Center)
        if (total > 0) {
            val pct = Math.round(correct * 100.0 / total)
            Text("$correct/$total correct ($pct%)", fontSize = 22.sp, fontWeight = FontWeight.Bold, color = if (pct >= 80) Palette.Good else if (pct >= 50) Palette.Hard else Palette.Again)
        }
        if (preview) Text("Preview — nothing was recorded.", color = Lab.colors.muted)
    }
}

/** The four queue counts (new · secondary · learning · review), like the card session's header. */
@Composable
fun SessionCounts(counts: QueueCounts) {
    Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        for ((value, color) in listOf(counts.new to Palette.New, counts.secondaryNew to Palette.Secondary, counts.learning to Palette.Learning, counts.review to Palette.Review)) {
            Text("$value", color = if (value == 0) color.copy(alpha = 0.35f) else color, fontWeight = FontWeight.Bold, fontSize = 17.sp)
        }
    }
}

