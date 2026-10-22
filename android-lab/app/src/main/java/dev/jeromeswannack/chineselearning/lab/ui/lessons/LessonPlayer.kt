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
import androidx.compose.runtime.DisposableEffect
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
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.LessonRevision
import dev.jeromeswannack.chineselearning.lab.core.LessonRun
import dev.jeromeswannack.chineselearning.lab.core.LessonAttemptData
import dev.jeromeswannack.chineselearning.lab.core.LessonAttempts
import dev.jeromeswannack.chineselearning.lab.core.LessonExercise
import dev.jeromeswannack.chineselearning.lab.core.Lessons
import dev.jeromeswannack.chineselearning.lab.core.QueueCounts
import dev.jeromeswannack.chineselearning.lab.data.lessons.LessonRecording
import dev.jeromeswannack.chineselearning.lab.ui.fx.ConfettiRain
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.data.lessons.SavedLessonRun
import dev.jeromeswannack.chineselearning.lab.data.lessons.SavedRecording
import dev.jeromeswannack.chineselearning.lab.ui.kit.RetryProgressBar
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

/** What a finished real run hands back (web StudyCustomLesson's `LessonRunResult`). */
data class LessonResult(
    val correct: Int,
    val total: Int,
    val attempt: LessonAttemptData,
    val recordings: List<LessonRecording>,
    /** What it missed first time (core LessonRevision): decides done forever vs a revision in a week. */
    val outcome: LessonRevision.Outcome = LessonRevision.Outcome(),
    /** "full" | "revision". */
    val mode: String = "full",
)

/** Where the player sits: a mini lesson run, a homework pass, or a preview (nothing recorded). */
sealed interface PlayerContext {
    data object Homework : PlayerContext
    data object Preview : PlayerContext
    /**
     * A mini lesson outside a homework pass — Home's homework / to-do rows, the Mini Lessons page
     * (▶ Start / ▶ Revision / ▶ Continue / ▶ Do it again), the podcast player's companion card.
     * Mini lessons are no longer part of the study session (Oct 2026). [source] = analytics.
     */
    data class Lesson(val source: String = "lessons_page") : PlayerContext
}

/**
 * A half-done run to continue ([saved], null = start fresh) and where to save the run after every
 * exercise (data/lessons/LessonProgressStore — never bounded by date). Never for previews.
 */
class LessonResumeHandle(
    val saved: SavedLessonRun?,
    val onProgress: (SavedLessonRun) -> Unit = {},
    val onStartOver: () -> Unit = {},
)

/**
 * A preview that may be KEPT (the Sentence Coach's "🎯 Mini lesson on this mistake"; web
 * StudyCustomLesson `previewSave`): played with nothing recorded, then "Save to my mini lessons" —
 * this run becomes its first completion (a lesson with mistakes comes back as a revision in a
 * week), "＋ Save" in the top bar saves it without one, "Not now" leaves.
 */
class PreviewSave(
    /** Already in his mini lessons (saved before, or with ＋ Save just now). */
    val saved: Boolean,
    val busy: Boolean = false,
    val error: String? = null,
    val onSaveNow: () -> Unit = {},
    val onSaveDone: (LessonResult) -> Unit = {},
)

/** Test tags of the keepable preview. */
const val PREVIEW_SAVE_NOW_TAG = "lesson-preview-save-now"
const val PREVIEW_SAVE_TAG = "lesson-preview-save"
const val PREVIEW_NOT_NOW_TAG = "lesson-preview-not-now"
/** Test tags of the run: the progress bar, the retry line, the end line, Done. */
const val LESSON_BAR_TAG = "lesson-run-bar"
const val LESSON_RETRY_TAG = "lesson-retry-line"
const val LESSON_END_TAG = "lesson-end-line"
const val LESSON_DONE_TAG = "lesson-done"

/** `lesson.start` / `lesson.complete` source: where the player sits. */
private fun lessonSource(context: PlayerContext): String = when (context) {
    PlayerContext.Homework -> "homework"
    PlayerContext.Preview -> "preview"
    is PlayerContext.Lesson -> context.source
}

/**
 * A custom mini lesson (the web's StudyCustomLesson): the whole lesson, or its REVISION
 * ([revisionKeys]: what was missed last time + a few that were got; core LessonRevision). Walks the
 * run's steps (core LessonRun), builds the attempt (answer + time per exercise, recordings by media
 * key), then the RETRY ROUND: every scored exercise answered wrong on the main pass comes back until
 * it is right — the bar grows an orange "owed" part at its right end that the blue catches up (the
 * homework pass's retry bar). The end records the completion at once (its outcome decides: all
 * right first time → done forever; otherwise a revision in a week) — no rating to give. A real run
 * is saved after every exercise ([resume]) and continues next time; ✕ never records a completion.
 * [PlayerContext.Preview] records nothing.
 */
@Composable
fun LessonPlayer(
    title: String,
    icon: String?,
    spec: CustomLessonSpec,
    env: ExerciseEnv,
    context: PlayerContext,
    onComplete: (LessonResult) -> Unit,
    onEnd: () -> Unit,
    onCelebrate: () -> Unit = {},
    /** The editor preview's jump: the main-pass step to start on. */
    startAt: Int = 0,
    /** False inside a host with its own top bar. */
    showTopBar: Boolean = true,
    /** The main-pass step now on screen (the editor preview's jump bar follows it); steps.size = done. */
    onIndex: (Int) -> Unit = {},
    /** Continue a half-done run and save this one after every exercise (null: previews, nothing kept). */
    resume: LessonResumeHandle? = null,
    /** A revision: its scored exercises (LessonRevision.revisionKeys); null = the whole lesson. */
    revisionKeys: List<String>? = null,
    /** With [PlayerContext.Preview]: offer to keep the lesson ([PreviewSave]). */
    previewSave: PreviewSave? = null,
) {
    val preview = context is PlayerContext.Preview
    val shape = remember(spec) { LessonRun.shape(spec) }
    var run by remember { mutableIntStateOf(0) }
    // A run saved earlier continues where it stopped (the exercise on screen starts again) — any day.
    val restored = remember(spec) { resume?.saved?.takeIf { !preview } }
    var continuing by remember { mutableStateOf(restored != null) }
    fun from(run: Int) = if (run == 0) restored else null
    val mode = remember(run) { from(run)?.mode ?: if (revisionKeys != null) "revision" else "full" }
    val keys = remember(run) { if (from(run) != null) from(run)!!.keys else revisionKeys }
    val exercises = remember(spec) {
        val map = HashMap<String, Pair<LessonExercise, String?>>()
        spec.sections.forEachIndexed { si, s -> s.exercises.forEachIndexed { i, ex -> map[LessonRun.exerciseKey(si, i)] = ex to s.title } }
        map
    }
    val steps = remember(spec, keys) { LessonRun.steps(spec, keys).filter { exercises[it.key]?.first?.let(Lessons::isPlayable) == true } }
    var state by remember(run) { mutableStateOf(from(run)?.state ?: LessonRun.State(pos = startAt.coerceIn(0, steps.size))) }
    var correct by remember(run) { mutableIntStateOf(from(run)?.correct ?: 0) }
    var total by remember(run) { mutableIntStateOf(from(run)?.total ?: 0) }
    val startedAt = remember(run) { from(run)?.startedAt ?: System.currentTimeMillis() }
    var exerciseStart by remember(run) { mutableLongStateOf(System.currentTimeMillis()) }
    val attempts = remember(run) { mutableStateListOf<ExerciseAttempt>().apply { from(run)?.let { addAll(it.attempts) } } }
    val recordings = remember(run) {
        mutableStateListOf<LessonRecording>().apply { from(run)?.let { p -> addAll(p.recordings.map { LessonRecording(it.mediaKey, java.io.File(it.path), it.mime) }) } }
    }
    var endLine by remember(run) { mutableStateOf<String?>(null) }
    var completed by remember(run) { mutableStateOf(false) }
    val current = LessonRun.current(state, steps)
    val done = current == null
    val bar = LessonRun.retryBar(state, steps)

    LaunchedEffect(done) { if (done) onCelebrate() }
    // Usage analytics: a real run (previews record nothing — not even this).
    LaunchedEffect(run) {
        if (!preview) dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics.track("lesson.start", mapOf("source" to lessonSource(context), "exercises" to steps.size, "mode" to mode))
        if (!preview && run == 0 && restored != null) dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics.track("lesson.resume", mapOf("source" to lessonSource(context), "mode" to mode, "exercises" to steps.size, "at" to restored.state.pos))
    }
    LaunchedEffect(state.pos) { onIndex(state.pos) }
    // Every clip of the lesson fetched as it opens, the exercise on screen first (docs/AUDIO.md
    // "Lesson audio prefetch"); `lesson.audio` when it closes.
    val latestEnv by androidx.compose.runtime.rememberUpdatedState(env)
    val flatIndex = current?.let { c -> flattenSpec(spec).indexOfFirst { it.section == c.step.section && it.index == c.step.index } } ?: 0
    val audioIndex = remember(spec) { kotlinx.coroutines.flow.MutableStateFlow(flatIndex.coerceAtLeast(0)) }
    androidx.compose.runtime.SideEffect { audioIndex.value = flatIndex.coerceAtLeast(0) }
    DisposableEffect(spec) {
        latestEnv.lessonAudioOpened()
        onDispose { latestEnv.lessonAudioDone(lessonSource(context)) }
    }
    LaunchedEffect(spec) { latestEnv.prefetchLesson(spec, audioIndex) }

    fun attemptData(): LessonAttemptData {
        // A run continued on another day: the time spent on its exercises, not the days between.
        val duration = if (restored != null && run == 0) attempts.sumOf { Math.max(0L, it.durationMs) } else System.currentTimeMillis() - startedAt
        return LessonAttemptData(Js.toIsoString(startedAt), duration, attempts.toList())
    }

    fun finish() {
        val attempt = attemptData()
        val outcome = LessonRevision.runOutcome(attempt) ?: LessonRevision.Outcome()
        endLine = LessonRevision.runEndLine(outcome, mode == "revision")
        if (preview || completed) return
        completed = true
        dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics.track(
            "lesson.complete",
            mapOf(
                "source" to lessonSource(context), "mode" to mode, "duration_ms" to attempt.durationMs,
                "missed" to outcome.missed.size, "scored" to outcome.keys.size, "retries" to attempts.count { (it.retry ?: 0) > 0 },
            ),
        )
        onComplete(LessonResult(correct, total, attempt, recordings.toList(), outcome, mode))
    }

    fun advance(isCorrect: Boolean?, answer: dev.jeromeswannack.chineselearning.lab.core.ExerciseAnswer?, recording: java.io.File?) {
        val cur = LessonRun.current(state, steps) ?: return
        val ex = exercises[cur.step.key]?.first ?: return
        val retry = if (cur.phase == "retry") LessonRun.retryNumber(attempts, cur.step.key) else 0
        val base = LessonAttempts.attemptFor(cur.step.section, cur.step.index, ex, isCorrect, answer, System.currentTimeMillis() - exerciseStart)
        val attempt = if (retry > 0) base.copy(retry = retry) else base
        if (cur.phase == "main" && isCorrect != null && attempt.maxPoints > 0) {
            correct += attempt.points
            total += attempt.maxPoints
        }
        attempts += attempt
        val rec = answer?.recording
        if (recording != null && rec != null) recordings += LessonRecording(rec.mediaKey, recording, rec.mime ?: "audio/mp4")
        exerciseStart = System.currentTimeMillis()
        // A clip still on its way never plays on the next exercise.
        env.exerciseChanged()
        // Wrong = owed (main pass) / back of the queue (retry round): a conversation with a missed question too.
        val wrong = LessonRun.verdictWrong(isCorrect, attempt.points, attempt.maxPoints)
        val next = LessonRun.advance(state, steps, if (isCorrect == null) null else !wrong)
        state = next
        continuing = false
        if (cur.phase == "retry") {
            dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics.track("lesson.retry", mapOf("type" to cur.step.type, "right" to !wrong, "left" to LessonRun.retryBar(next, steps).retries))
        }
        if (LessonRun.finished(next, steps)) finish()
        else if (!preview) resume?.onProgress(
            SavedLessonRun(
                lessonId = restored?.lessonId ?: "", shape = shape, mode = mode, keys = keys, state = next, correct = correct, total = total,
                startedAt = startedAt, savedAt = System.currentTimeMillis(), attempts = attempts.toList(),
                recordings = recordings.map { SavedRecording(it.mediaKey, it.file.absolutePath, it.mime) },
            ),
        )
    }

    fun startOver() {
        resume?.onStartOver()
        continuing = false
        env.exerciseChanged()
        if (!preview) dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics.track("lesson.start_over", mapOf("source" to lessonSource(context)))
        run++
    }

    Box(Modifier.fillMaxSize().background(Lab.colors.background).then(if (showTopBar) Modifier.safeDrawingPadding() else Modifier)) {
        Column(Modifier.fillMaxSize()) {
            if (showTopBar) Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.weight(1f).padding(start = 12.dp)) {
                    when (context) {
                        PlayerContext.Homework -> Text(if (mode == "revision") "Homework · revision" else "Homework", fontWeight = FontWeight.SemiBold, color = Lab.colors.muted)
                        is PlayerContext.Lesson -> Text(if (mode == "revision") "Mini lesson · revision" else "Mini lesson", fontWeight = FontWeight.SemiBold, color = Lab.colors.muted)
                        PlayerContext.Preview -> Text(
                            when { previewSave == null -> "Preview · nothing is recorded"; previewSave.saved -> "✓ In your mini lessons"; else -> "Trying it · not saved yet" },
                            color = Violet, fontWeight = FontWeight.SemiBold, fontSize = 14.sp,
                            modifier = Modifier.clip(CircleShape).background(Violet.copy(alpha = 0.12f)).padding(horizontal = 12.dp, vertical = 6.dp))
                    }
                }
                if (preview && previewSave != null && !previewSave.saved && !done) {
                    SecondaryPill(if (previewSave.busy) "Saving…" else "＋ Save", Modifier.heightIn(min = 44.dp).testTag(PREVIEW_SAVE_NOW_TAG), enabled = !previewSave.busy, onClick = previewSave.onSaveNow)
                }
                IconButton(onClick = onEnd) { Icon(Icons.Filled.Close, if (preview) "Close preview" else "Close lesson", tint = Lab.colors.muted) }
            }

            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.TopCenter) {
                Column(
                    Modifier.fillMaxSize().widthIn(max = 720.dp).verticalScroll(rememberScrollState()).imePadding().padding(horizontal = 20.dp, vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("${icon ?: "🎓"}  ${if (mode == "revision") "REVISION" else "MINI LESSON"}", color = Violet, fontWeight = FontWeight.SemiBold, fontSize = 12.sp, letterSpacing = 1.sp)
                        Text(title, fontWeight = FontWeight.SemiBold, fontSize = 18.sp, color = Lab.colors.ink, textAlign = TextAlign.Center)
                    }
                    if (continuing && run == 0 && restored != null && !done) {
                        ContinueLine(LessonRun.resumeLine(state, steps)) { startOver() }
                    }
                    if (!done) {
                        RetryProgressBar(bar, Modifier.fillMaxWidth().testTag(LESSON_BAR_TAG), unit = LessonRun.EXERCISE_UNIT)
                    }
                    if (current?.phase == "retry") {
                        Text(
                            "🔁 ${LessonRun.retryLine(bar.retries)}",
                            color = Palette.Hard, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, textAlign = TextAlign.Center,
                            modifier = Modifier.fillMaxWidth().clip(androidx.compose.foundation.shape.RoundedCornerShape(10.dp))
                                .background(Palette.Hard.copy(alpha = 0.12f)).padding(horizontal = 14.dp, vertical = 8.dp).testTag(LESSON_RETRY_TAG),
                        )
                    }
                    AnimatedContent(
                        targetState = Triple(run, current?.phase, current?.step?.key to bar.answered),
                        transitionSpec = {
                            (slideInHorizontally(spring(dampingRatio = 0.85f, stiffness = 380f)) { it / 4 } + fadeIn(tween(180))) togetherWith
                                (slideOutHorizontally(tween(200)) { -it / 4 } + fadeOut(tween(150)))
                        },
                        label = "exercise",
                    ) { target ->
                        val key = target.third.first
                        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            if (key == null) {
                                DoneBody(icon, title, correct, total, preview && previewSave == null, mode == "revision", if (preview) null else endLine)
                            } else {
                                val (exercise, sectionTitle) = exercises[key] ?: return@Column
                                val step = steps.first { it.key == key }
                                val sectionStart = target.second == "main" && step.index == 0 && !sectionTitle.isNullOrBlank()
                                if (sectionStart) {
                                    Text(sectionTitle.orEmpty(), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = Lab.colors.ink)
                                }
                                val stillHere = { current?.step?.key == key && bar.answered == target.third.second }
                                val mediaKey = if (preview) null else LessonRun.retryMediaKey(step.section, step.index, if (target.second == "retry") LessonRun.retryNumber(attempts, key) else 0)
                                if (Lessons.renderable(exercise)) {
                                    androidx.compose.runtime.CompositionLocalProvider(LocalLessonFocus provides title) {
                                        ExerciseView(exercise, env, mediaKey) { c, a, r -> if (stillHere()) advance(c, a, r) }
                                    }
                                } else {
                                    // A half-typed exercise in the editor (the validator is the authority; this keeps it from crashing).
                                    Text("This exercise isn't complete yet — fill in its fields to preview it.", color = Lab.colors.muted)
                                    SecondaryPill("Skip", Modifier.height(48.dp)) { if (stillHere()) advance(null, null, null) }
                                }
                            }
                        }
                    }
                    Spacer(Modifier.height(24.dp))
                }
                if (done) ConfettiRain(key = run, colors = Palette.Confetti)
            }

            if (done && !preview) {
                Row(Modifier.fillMaxWidth().background(Lab.colors.card).padding(16.dp)) {
                    PrimaryPill("Done", Modifier.fillMaxWidth().height(54.dp).testTag(LESSON_DONE_TAG), onClick = onEnd)
                }
            }
            if (done && preview && previewSave != null) {
                Column(Modifier.fillMaxWidth().background(Lab.colors.card).padding(horizontal = 16.dp, vertical = 12.dp).testTag(PREVIEW_SAVE_TAG), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(
                        if (previewSave.saved) "Keep this run as done? Anything you missed comes back in a week as a revision."
                        else "Save it to your mini lessons? Anything you missed comes back in a week as a revision.",
                        color = Lab.colors.muted, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth(),
                    )
                    PrimaryPill(
                        if (previewSave.busy) "Saving…" else if (previewSave.saved) "Save this run" else "Save to my mini lessons",
                        Modifier.fillMaxWidth().height(54.dp), enabled = !previewSave.busy,
                    ) {
                        val attempt = attemptData()
                        previewSave.onSaveDone(LessonResult(correct, total, attempt, emptyList(), LessonRevision.runOutcome(attempt) ?: LessonRevision.Outcome(), mode))
                    }
                    previewSave.error?.let { Text(it, color = Palette.Again, fontSize = 14.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth()) }
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        SecondaryPill("↻ Try again", Modifier.weight(1f).height(48.dp), enabled = !previewSave.busy) { run++ }
                        SecondaryPill(if (previewSave.saved) "Done" else "Not now", Modifier.weight(1f).height(48.dp).testTag(PREVIEW_NOT_NOW_TAG), enabled = !previewSave.busy, onClick = onEnd)
                    }
                }
            }
            if (done && preview && previewSave == null) {
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
private fun ContinueLine(text: String, onStartOver: (() -> Unit)?) {
    Row(
        Modifier.fillMaxWidth().clip(CircleShape).background(Violet.copy(alpha = 0.08f)).padding(start = 14.dp, end = 4.dp)
            .testTag(CONTINUE_TAG),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text, color = Lab.colors.muted, fontSize = 13.sp, modifier = Modifier.weight(1f).then(if (onStartOver == null) Modifier.padding(vertical = 12.dp) else Modifier))
        if (onStartOver != null) androidx.compose.material3.TextButton(onClick = onStartOver, modifier = Modifier.heightIn(min = 44.dp)) {
            Text("Start over", color = Violet, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
        }
    }
}

/** Test tag of the "Continuing where you left off" line. */
const val CONTINUE_TAG = "lesson-continue"

/** Test tag of a replay's "Practice only". */
const val PRACTICE_ONLY_TAG = "lesson-practice-only"

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

