package dev.jeromeswannack.chineselearning.lab.ui.lessons

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.CardQueue
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.IntervalPreview
import dev.jeromeswannack.chineselearning.lab.core.LessonSchedule
import dev.jeromeswannack.chineselearning.lab.core.QueueCard
import dev.jeromeswannack.chineselearning.lab.core.ScheduledItem
import dev.jeromeswannack.chineselearning.lab.core.SessionItem
import dev.jeromeswannack.chineselearning.lab.core.SessionMix
import dev.jeromeswannack.chineselearning.lab.core.StudyCutoff
import dev.jeromeswannack.chineselearning.lab.data.api.sentenceFeedback
import dev.jeromeswannack.chineselearning.lab.data.lessons.LessonEntry
import dev.jeromeswannack.chineselearning.lab.data.lessons.LessonRuntime
import dev.jeromeswannack.chineselearning.lab.fx.Sounds
import kotlin.random.Random

/** A mini lesson presented in the session. [key] changes when the same lesson comes back. */
data class SessionLesson(val entry: LessonEntry, val previews: List<IntervalPreview>, val key: Int)

/**
 * Package B's part of the study session (the web's useStudySession lesson / reader queues):
 * the due mini lessons of an all-decks session, the every-[LessonSchedule.MIX_INTERVAL]
 * reviews break, and recording a finished lesson. StudyViewModel (package A) calls it
 * instead of StudyQueue.selectNext — see the "Package B" blocks there.
 */
class StudyExtras(private val app: LabApp, private val deckId: String?) {
    private val runtime by lazy { LessonRuntime.of(app) }
    private var lessons: List<LessonEntry> = emptyList()
    private var reviewsSinceLesson = 0
    private var shown = 0

    /** Lessons aren't deck-scoped: all-decks sessions only. */
    suspend fun load(cutoff: StudyCutoff) {
        reviewsSinceLesson = 0
        lessons = if (deckId != null) emptyList() else runCatching { runtime.store.dueLessons(cutoff) }.getOrDefault(emptyList())
    }

    /** One more card review toward the next lesson break. */
    fun cardRated() {
        reviewsSinceLesson++
    }

    /** `selectNextItem`: a card, or a lesson (break / leftovers). [breakAllowed] = false right after a lesson. */
    fun next(
        queue: List<QueueCard>,
        reviewedNoteIds: Set<String>,
        recentNoteIds: List<String>,
        lastRatedCardId: String?,
        nowMs: Long,
        cutoff: StudyCutoff,
        random: Random,
        breakAllowed: Boolean = true,
    ): SessionItem? = SessionMix.next(
        queue, lessons.map { it.item }, emptyList(), breakAllowed && reviewsSinceLesson >= LessonSchedule.MIX_INTERVAL,
        reviewedNoteIds, recentNoteIds, lastRatedCardId, null, nowMs, cutoff, random,
    )

    /** The lesson for a [SessionItem.Lesson]; starting it resets the break counter. */
    fun present(item: ScheduledItem): SessionLesson? {
        val entry = lessons.firstOrNull { it.id == item.id } ?: return null
        reviewsSinceLesson = 0
        return SessionLesson(entry, CardScheduler.intervalPreviews(entry.state, System.currentTimeMillis()), ++shown)
    }

    val remainingLessons: Int get() = lessons.size

    /**
     * Records the rated completion; a lesson rated back into learning stays in the session
     * with its new state, otherwise FSRS has scheduled it out.
     */
    suspend fun complete(lesson: SessionLesson, result: LessonResult) {
        lessons = lessons.filter { it.id != lesson.entry.id }
        val state = runCatching {
            runtime.store.complete(lesson.entry.id, result.correct, result.total, result.rating, result.attempt, result.recordings)
        }.getOrNull()
        if (state != null && CardQueue.isLearning(state.queue)) lessons = lessons + lesson.entry.copy(state = state)
        runtime.uploadSoon()
    }

    fun stopAudio() = runtime.audio.stop()
}

/**
 * The [ExerciseEnv] for a real run: cache-first TTS and images, Claude's sentence check,
 * the recorder (not in a preview), haptics and sounds.
 */
@Composable
fun rememberExerciseEnv(app: LabApp, preview: Boolean = false): ExerciseEnv {
    val runtime = remember(app) { LessonRuntime.of(app) }
    val scope = rememberCoroutineScope()
    val playing by runtime.audio.playing.collectAsState()
    val recorder = remember(preview) { LessonRecorder(app, scope) { runtime.store.recordingFile() } }
    DisposableEffect(recorder) { onDispose { recorder.release(); runtime.audio.stop() } }
    return ExerciseEnv(
        speak = { runtime.audio.speak(it) },
        playClip = { text, voice -> runtime.audio.playClip(text, voice) },
        stopAudio = { runtime.audio.stop() },
        playing = playing,
        image = { key -> runtime.media.image(key, app.online.value) },
        cachedImage = { key -> runtime.media.cachedImage(key) },
        sentenceFeedback = { words, task, sentence ->
            if (!app.online.value) throw java.io.IOException("offline")
            app.repo.api.sentenceFeedback(words, task, sentence)
        },
        recorder = recorder,
        playFile = { runtime.audio.playFile(it) },
        onCorrect = { app.sounds.play(Sounds.Sfx.CORRECT); app.haptics.correct() },
        onWrong = { app.sounds.play(Sounds.Sfx.WRONG, 0.6f); app.haptics.wrong() },
        onTap = { app.haptics.tick() },
        strokeLoader = remember(app) { dev.jeromeswannack.chineselearning.lab.data.strokes.StrokeStore.of(app)::get },
    )
}

/** A mini lesson inside the study screen (under the session's own top bar). */
@Composable
fun SessionLessonView(
    lesson: SessionLesson,
    counts: dev.jeromeswannack.chineselearning.lab.core.QueueCounts,
    env: ExerciseEnv,
    onComplete: (LessonResult) -> Unit,
) {
    val l = lesson.entry.lesson
    LessonPlayer(
        title = l.title,
        icon = l.icon,
        spec = l.spec,
        env = env,
        context = PlayerContext.Session(counts),
        previews = lesson.previews,
        onComplete = onComplete,
        onEnd = {},
        showTopBar = false,
    )
}
