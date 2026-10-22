package dev.jeromeswannack.chineselearning.lab.ui.lessons

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.QueueCard
import dev.jeromeswannack.chineselearning.lab.core.ScheduledItem
import dev.jeromeswannack.chineselearning.lab.core.SessionItem
import dev.jeromeswannack.chineselearning.lab.core.SessionMix
import dev.jeromeswannack.chineselearning.lab.core.StudyCutoff
import dev.jeromeswannack.chineselearning.lab.data.api.sentenceFeedback
import dev.jeromeswannack.chineselearning.lab.data.api.checkLessonAnswer
import dev.jeromeswannack.chineselearning.lab.data.api.askAboutLessonAnswer
import dev.jeromeswannack.chineselearning.lab.data.lessons.LessonRuntime
import dev.jeromeswannack.chineselearning.lab.fx.Sounds
import kotlinx.coroutines.launch
import kotlin.random.Random

/**
 * Package B's part of the study session (the web's useStudySession reader queue): today's
 * reader of an all-decks session, and recording a finished story. StudyViewModel (package A)
 * calls it instead of StudyQueue.selectNext — see the "Package B" blocks there.
 *
 * Mini lessons are NOT part of the session any more (Oct 2026, docs/STUDY_SESSION.md "Mini
 * lessons"): they are done from Home's homework / to-do card and the Mini Lessons page. The
 * flashcards come first, then (after the session's "Flashcards done" pause) the reader. Today's
 * reader is the one Home shows (TodayData), re-read with [reload].
 */
class StudyExtras(private val app: LabApp, private val deckId: String?) {
    private val runtime by lazy { LessonRuntime.of(app) }
    private val today by lazy { dev.jeromeswannack.chineselearning.lab.ui.today.TodayData(app) }
    private val zone = java.time.ZoneId.systemDefault()
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
        if (deckId != null) { readers = emptyList(); return }
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

    /** Today's reader as it stands now (it may have been read from Home). */
    suspend fun reload() {
        if (deckId != null) return
        val snap = runCatching { today.snapshot(System.currentTimeMillis(), zone) }.getOrNull() ?: return
        readers = listOfNotNull(snap.readerEntry)
    }

    /** `selectNextItem`: a card, else the reader (no mini lessons). */
    fun next(
        queue: List<QueueCard>,
        reviewedNoteIds: Set<String>,
        recentNoteIds: List<String>,
        lastRatedCardId: String?,
        nowMs: Long,
        cutoff: StudyCutoff,
        random: Random,
        bumpedCardIds: Set<String> = emptySet(),
        knownCharacterNoteIds: Set<String> = emptySet(),
    ): SessionItem? = SessionMix.next(
        queue, emptyList(), readers.map { it.item }, false,
        reviewedNoteIds, recentNoteIds, lastRatedCardId, lastRatedReaderId, nowMs, cutoff, random, bumpedCardIds, knownCharacterNoteIds,
    )

    /** The reader for a [SessionItem.Reader]. */
    fun presentReader(item: ScheduledItem): dev.jeromeswannack.chineselearning.lab.ui.readers.SessionReader? {
        val entry = readers.firstOrNull { it.id == item.id } ?: return null
        return dev.jeromeswannack.chineselearning.lab.ui.readers.SessionReader(entry.reader, ++shown)
    }

    /**
     * `finishReader`: records the finish — a story is read once and never comes back, so it
     * leaves the session. Reading counts as the day's reader activity.
     */
    suspend fun finishReader(readerId: String, timeSpentMs: Long, how: String = "finish") {
        readers = readers.filter { it.id != readerId }
        lastRatedReaderId = readerId
        today.finishReader(readerId, timeSpentMs, how)
    }

    val readerLeft: Boolean get() = readers.isNotEmpty()

    /** Titles for the "Flashcards done" pause: the story. */
    fun titles(): List<String> = readers.map { "📖 ${it.reader.titleChinese.ifBlank { it.reader.titleEnglish }}" }

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
fun rememberExerciseEnv(app: LabApp, preview: Boolean = false, prefetch: Boolean = true): ExerciseEnv {
    val runtime = remember(app) { LessonRuntime.of(app) }
    val scope = rememberCoroutineScope()
    val playing by runtime.audio.playing.collectAsState()
    val recorder = remember(preview) { LessonRecorder(app, scope) { runtime.store.recordingFile() } }
    DisposableEffect(recorder) { onDispose { recorder.release(); runtime.audio.stop() } }
    return ExerciseEnv(
        speak = { runtime.audio.speak(it) },
        playClip = { text, voice, speed -> runtime.audio.playClip(text, voice, speed ?: dev.jeromeswannack.chineselearning.lab.data.lessons.LessonMedia.DEFAULT_SPEED) },
        conversationVoices = { dev.jeromeswannack.chineselearning.lab.data.lessons.ConversationVoiceCache.get(app.cache) },
        conversationAudio = remember(app) { LabConversationAudioControls(app) },
        playLine = { clip, regenerate -> runtime.audio.playLine(clip, regenerate) },
        stopAudio = { runtime.audio.stop() },
        prefetchLesson = { spec, current -> if (prefetch) runtime.prefetchOpenLesson(spec, current) },
        exerciseChanged = { runtime.audio.cancelPending() },
        lessonAudioOpened = { runtime.audio.resetStats() },
        lessonAudioDone = { source -> runtime.reportLessonAudio(source) },
        playing = playing,
        image = { key -> runtime.media.image(key, app.online.value) },
        cachedImage = { key -> runtime.media.cachedImage(key) },
        picture = { key, prompt -> runtime.store.pictures.picture(key, prompt, app.online) },
        sentenceFeedback = { words, task, sentence ->
            if (!app.online.value) throw java.io.IOException("offline")
            app.repo.api.sentenceFeedback(words, task, sentence)
        },
        answerCheck = { input -> app.repo.api.checkLessonAnswer(input, app.cache, app.online.value) },
        askAboutAnswer = { input, check, history, question ->
            if (!app.online.value) throw dev.jeromeswannack.chineselearning.lab.data.api.AnswerCheckUnavailable("offline", offline = true)
            app.repo.api.askAboutLessonAnswer(input, check, history, question)
        },
        recorder = recorder,
        playFile = { runtime.audio.playFile(it) },
        onCorrect = { app.sounds.play(Sounds.Sfx.CORRECT); app.haptics.correct() },
        onWrong = { app.sounds.play(Sounds.Sfx.WRONG, 0.6f); app.haptics.wrong() },
        onTap = { app.haptics.tick() },
        strokeLoader = remember(app) { dev.jeromeswannack.chineselearning.lab.data.strokes.StrokeStore.of(app)::get },
    )
}
