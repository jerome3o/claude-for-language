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
import dev.jeromeswannack.chineselearning.lab.data.api.markDailyReader
import kotlinx.coroutines.launch
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
    private val zone = java.time.ZoneId.systemDefault()
    private var lessons: List<LessonEntry> = emptyList()
    private var readers: List<dev.jeromeswannack.chineselearning.lab.data.readers.ReaderEntry> = emptyList()
    private var reviewsSinceLesson = 0
    private var shown = 0
    private var lastRatedReaderId: String? = null
    private var dailyPoll: kotlinx.coroutines.Job? = null

    /**
     * Lessons and readers aren't deck-scoped: all-decks sessions only. Today's reader (one a
     * day) closes out the session; when there's none, one is asked for in the background
     * (`ensureDailyReader`) and polled for every 20 s until it lands ([onReaderArrived]).
     */
    suspend fun load(cutoff: StudyCutoff, dueNoteIds: List<String> = emptyList(), scope: kotlinx.coroutines.CoroutineScope? = null, onReaderArrived: () -> Unit = {}) {
        reviewsSinceLesson = 0
        if (deckId != null) { lessons = emptyList(); readers = emptyList(); return }
        lessons = runCatching { runtime.store.dueLessons(cutoff) }.getOrDefault(emptyList())
        val now = System.currentTimeMillis()
        readers = listOfNotNull(runCatching { runtime.readers.todaysReader(now, cutoff, zone) }.getOrNull())
        if (scope != null && readers.isEmpty() && app.online.value && dailyPoll?.isActive != true) {
            dailyPoll = scope.launch {
                if (!runtime.readers.ensureDaily(dueNoteIds, now, cutoff, zone, app.online.value)) {
                    // A story generated earlier may just have been pulled in.
                    runtime.readers.todaysReader(System.currentTimeMillis(), cutoff, zone)?.let { readers = listOf(it); onReaderArrived() }
                    return@launch
                }
                repeat(30) {
                    kotlinx.coroutines.delay(20_000)
                    if (!app.online.value) return@repeat
                    runCatching { runtime.readers.refresh() }
                    val fresh = runtime.readers.todaysReader(System.currentTimeMillis(), cutoff, zone)
                    if (fresh != null && fresh.state.queue == CardQueue.NEW) {
                        readers = listOf(fresh)
                        onReaderArrived()
                        return@launch
                    }
                }
            }
        }
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
        queue, lessons.map { it.item }, readers.map { it.item }, breakAllowed && reviewsSinceLesson >= LessonSchedule.MIX_INTERVAL,
        reviewedNoteIds, recentNoteIds, lastRatedCardId, lastRatedReaderId, nowMs, cutoff, random,
    )

    /** The reader for a [SessionItem.Reader]. */
    fun presentReader(item: ScheduledItem): dev.jeromeswannack.chineselearning.lab.ui.readers.SessionReader? {
        val entry = readers.firstOrNull { it.id == item.id } ?: return null
        return dev.jeromeswannack.chineselearning.lab.ui.readers.SessionReader(entry.reader, CardScheduler.intervalPreviews(entry.state, System.currentTimeMillis()), ++shown)
    }

    /**
     * `rateReader`: records the review; a reader rated back into learning stays in the session,
     * otherwise FSRS has scheduled it out. Reading counts as the day's reader activity.
     */
    suspend fun rateReader(readerId: String, rating: Int, timeSpentMs: Long) {
        val entry = readers.firstOrNull { it.id == readerId }
        readers = readers.filter { it.id != readerId }
        lastRatedReaderId = readerId
        val state = runCatching { runtime.readers.rate(readerId, rating, timeSpentMs) }.getOrNull()
        if (entry != null && state != null && CardQueue.isLearning(state.queue)) readers = readers + entry.copy(state = state)
        runtime.uploadSoon()
        if (app.online.value) app.scope.launch { runCatching { app.repo.api.markDailyReader(readerId) } }
    }

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

    fun stopAudio() {
        dailyPoll?.cancel()
        runtime.audio.stop()
    }
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
        playClip = { text, voice, speed -> runtime.audio.playClip(text, voice, speed ?: dev.jeromeswannack.chineselearning.lab.data.lessons.LessonMedia.DEFAULT_SPEED) },
        conversationVoices = { dev.jeromeswannack.chineselearning.lab.data.lessons.ConversationVoiceCache.get(app.cache) },
        stopAudio = { runtime.audio.stop() },
        playing = playing,
        image = { key -> runtime.media.image(key, app.online.value) },
        cachedImage = { key -> runtime.media.cachedImage(key) },
        picture = { key, prompt -> runtime.store.pictures.picture(key, prompt, app.online) },
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
