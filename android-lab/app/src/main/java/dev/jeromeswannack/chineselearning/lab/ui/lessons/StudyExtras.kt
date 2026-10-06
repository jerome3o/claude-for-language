package dev.jeromeswannack.chineselearning.lab.ui.lessons

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.ItemSchedule
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
import kotlinx.coroutines.launch
import kotlin.random.Random

/** A mini lesson presented in the session. [key] changes when the same lesson comes back. */
data class SessionLesson(val entry: LessonEntry, val previews: List<IntervalPreview>, val key: Int)

/**
 * Package B's part of the study session (the web's useStudySession lesson / reader queues):
 * the due mini lessons and today's reader of an all-decks session, and recording a finished
 * lesson / story. StudyViewModel (package A) calls it instead of StudyQueue.selectNext — see
 * the "Package B" blocks there.
 *
 * Lab "today split" experiment (core TodayPlan, android-lab/PARITY.md): no lesson break every
 * [LessonSchedule.MIX_INTERVAL] reviews any more — the flashcards come first, then (after the
 * session's "Flashcards done" pause) the leftover lessons and the reader, in the same
 * [SessionMix] order. Today's lessons / reader are the ones Home shows (TodayData), re-read
 * with [reload] so what was done from Home isn't offered again.
 */
class StudyExtras(private val app: LabApp, private val deckId: String?) {
    private val runtime by lazy { LessonRuntime.of(app) }
    private val today by lazy { dev.jeromeswannack.chineselearning.lab.ui.today.TodayData(app) }
    private val zone = java.time.ZoneId.systemDefault()
    private var lessons: List<LessonEntry> = emptyList()
    private var readers: List<dev.jeromeswannack.chineselearning.lab.data.readers.ReaderEntry> = emptyList()
    private var shown = 0
    private var lastRatedReaderId: String? = null
    private var dailyPoll: kotlinx.coroutines.Job? = null

    /**
     * Lessons and readers aren't deck-scoped: all-decks sessions only. Today's reader (one a
     * day) closes out the session; when there's none, one is asked for in the background
     * (`ensureDailyReader`) and polled for every 20 s until it lands ([onReaderArrived]).
     */
    suspend fun load(cutoff: StudyCutoff, dueNoteIds: List<String> = emptyList(), scope: kotlinx.coroutines.CoroutineScope? = null, onReaderArrived: () -> Unit = {}) {
        if (deckId != null) { lessons = emptyList(); readers = emptyList(); return }
        reload()
        val now = System.currentTimeMillis()
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
                    if (fresh != null && fresh.state.isNew) {
                        readers = listOf(fresh)
                        onReaderArrived()
                        return@launch
                    }
                }
            }
        }
    }

    /** Today's lessons and reader as they stand now (some may have been done from Home). */
    suspend fun reload() {
        if (deckId != null) return
        val snap = runCatching { today.snapshot(System.currentTimeMillis(), zone) }.getOrNull() ?: return
        lessons = snap.toDo
        readers = listOfNotNull(snap.readerEntry)
    }

    /** `selectNextItem` without the lesson break: a card, else a leftover lesson, else the reader. */
    fun next(
        queue: List<QueueCard>,
        reviewedNoteIds: Set<String>,
        recentNoteIds: List<String>,
        lastRatedCardId: String?,
        nowMs: Long,
        cutoff: StudyCutoff,
        random: Random,
        bumpedCardIds: Set<String> = emptySet(),
    ): SessionItem? = SessionMix.next(
        queue, lessons.map { it.item }, readers.map { it.item }, false,
        reviewedNoteIds, recentNoteIds, lastRatedCardId, lastRatedReaderId, nowMs, cutoff, random, bumpedCardIds,
    )

    /** The reader for a [SessionItem.Reader]. */
    fun presentReader(item: ScheduledItem): dev.jeromeswannack.chineselearning.lab.ui.readers.SessionReader? {
        val entry = readers.firstOrNull { it.id == item.id } ?: return null
        return dev.jeromeswannack.chineselearning.lab.ui.readers.SessionReader(entry.reader, ItemSchedule.previews(entry.state, entry.settings), ++shown)
    }

    /**
     * `rateReader`: records the review (or Done for good, [retire]). Even Again brings a story
     * back tomorrow at the earliest, so it always leaves the session. Reading counts as the
     * day's reader activity.
     */
    suspend fun rateReader(readerId: String, rating: Int, timeSpentMs: Long, retire: Boolean = false) {
        readers = readers.filter { it.id != readerId }
        lastRatedReaderId = readerId
        today.rateReader(readerId, rating, timeSpentMs, retire)
    }

    /** The lesson for a [SessionItem.Lesson]. */
    fun present(item: ScheduledItem): SessionLesson? {
        val entry = lessons.firstOrNull { it.id == item.id } ?: return null
        return SessionLesson(entry, ItemSchedule.previews(entry.state, entry.settings), ++shown)
    }

    val remainingLessons: Int get() = lessons.size
    val readerLeft: Boolean get() = readers.isNotEmpty()

    /** Titles for the "Flashcards done" pause: lessons in order, then the story. */
    fun titles(): List<String> =
        lessons.map { "${it.lesson.icon ?: "📘"} ${it.lesson.title}" } + readers.map { "📖 ${it.reader.titleChinese.ifBlank { it.reader.titleEnglish }}" }

    /**
     * Records the rated completion (or Done for good, `result.retire`). The rating sets when it
     * comes back — a day at the soonest — so it always leaves the session.
     */
    suspend fun complete(lesson: SessionLesson, result: LessonResult) {
        lessons = lessons.filter { it.id != lesson.entry.id }
        today.completeLesson(lesson.entry.id, result)
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
        resume = rememberLessonResume(androidx.compose.ui.platform.LocalContext.current, l.id, l.spec),
    )
}
