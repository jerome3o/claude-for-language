package dev.jeromeswannack.chineselearning.lab.ui.audiolessons

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.AudioLessonTimeline
import dev.jeromeswannack.chineselearning.lab.data.api.AudioLessonDto
import dev.jeromeswannack.chineselearning.lab.data.api.NewAudioLessonBody
import dev.jeromeswannack.chineselearning.lab.data.api.audioLessons
import dev.jeromeswannack.chineselearning.lab.data.api.createAudioLesson
import dev.jeromeswannack.chineselearning.lab.data.api.retryAudioLesson
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.data.audiolessons.AudioLessonEngine
import dev.jeromeswannack.chineselearning.lab.data.audiolessons.AudioLessonPlayback
import dev.jeromeswannack.chineselearning.lab.data.audiolessons.AudioLessonPlaybackState
import dev.jeromeswannack.chineselearning.lab.data.audiolessons.AudioLessonStore
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.File

/** `/audio-lessons` and `/audio-lessons/:id` (docs/AUDIO_LESSONS.md). The player is immersive (NavRules). */
fun NavGraphBuilder.audioLessonsGraph(nav: LabNav) {
    composable(Routes.route("/audio-lessons")) {
        val vm: AudioLessonsViewModel = viewModel(factory = AudioLessonsViewModel.Factory(nav.app))
        val ui by vm.ui.collectAsStateWithLifecycle()
        var feedSheet by rememberSaveable { mutableStateOf(false) }
        if (feedSheet) {
            LabBottomSheet(onDismiss = { feedSheet = false }) {
                PodcastFeedCard(nav.app, Modifier.padding(horizontal = 16.dp))
            }
        }
        AudioLessonsScreen(
            ui,
            AudioLessonsActions(
                onBack = nav::back,
                onFormat = vm::setFormat,
                onDescription = vm::setDescription,
                onDialogue = vm::setDialogue,
                onShowDialogue = vm::showDialogue,
                onText = vm::setText,
                onMinutes = vm::setMinutes,
                onStart = vm::start,
                onOpen = { nav.open(Routes.audioLesson(it)) },
                onRetry = vm::retry,
                onDelete = vm::delete,
                onRefresh = vm::refresh,
                onPodcastFeed = { feedSheet = true },
            ),
        )
    }
    composable(Routes.route("/audio-lessons/{id}")) { entry ->
        val id = entry.arguments?.getString("id").orEmpty()
        val app = nav.app
        val vm: AudioLessonPlayerViewModel = viewModel(key = "audio-lesson-$id", factory = AudioLessonPlayerViewModel.Factory(app, id))
        val ui by vm.ui.collectAsStateWithLifecycle()
        BindPlaybackService()
        AudioLessonPlayerScreen(
            ui,
            AudioLessonPlayerActions(
                onBack = nav::back,
                onToggle = { app.haptics.tick(); vm.toggle() },
                onSeek = vm::seekTo,
                onSkip = vm::skip,
                onPreviousChapter = { app.haptics.tick(); vm.previousChapter() },
                onNextChapter = { app.haptics.tick(); vm.nextChapter() },
                onSpeed = { app.haptics.tick(); vm.nextSpeed() },
                onTimerSheet = vm::toggleTimerSheet,
                onTimer = { app.haptics.tick(); vm.setTimer(it) },
                onChapters = vm::toggleChapters,
                onTranscript = vm::toggleTranscript,
                onWords = vm::toggleWords,
            ),
        )
    }
}

/**
 * Binds the playback service while the player is on screen (a MediaController): that creates the
 * service and its engine, and lets Media3 make it a foreground service when playback starts, so the
 * lesson carries on after the screen goes off or the player is closed.
 */
@Composable
private fun BindPlaybackService() {
    val context = LocalContext.current
    DisposableEffect(Unit) {
        val future = AudioLessonPlayback.connect(context.applicationContext)
        onDispose { androidx.media3.session.MediaController.releaseFuture(future) }
    }
}

class AudioLessonsViewModel(private val app: LabApp) : ViewModel() {
    private val store = AudioLessonStore(app.cache, app.repo.api, app.filesDir)
    private val list = app.cachedResource<List<AudioLessonDto>>(viewModelScope, AudioLessonStore.LIST_KEY, AudioLessonStore.KIND) {
        val lessons = audioLessons()
        store.storeList(lessons)
        lessons.map { with(AudioLessonStore) { it.summary() } }
    }
    private val form = MutableStateFlow(AudioLessonsUi())

    val ui: StateFlow<AudioLessonsUi> = combine(list.state, form, app.online, store.downloads) { l, f, online, dls ->
        f.copy(lessons = l, saved = store.savedIds(l.data.orEmpty()), downloading = dls, online = online)
    }.stateIn(viewModelScope, SharingStarted.Eagerly, AudioLessonsUi())

    init {
        // Lessons are made in the background; keep the list moving while any are (every 4 s, like the web).
        viewModelScope.launch {
            while (isActive) {
                delay(4000)
                val lessons = list.state.value.data.orEmpty()
                if (lessons.any { it.building } && app.online.value) {
                    list.refresh().join()
                    // A lesson that just finished: its details + file for the train.
                    val now = list.state.value.data.orEmpty()
                    val finished = now.filter { n -> n.ready && lessons.any { it.id == n.id && it.building } }
                    if (finished.isNotEmpty()) app.scope.launch { runCatching { store.refresh(); store.downloadMissing(finished) } }
                }
            }
        }
    }

    fun refresh() { list.refresh() }

    fun setFormat(f: String) = form.update { it.copy(format = f, minutes = AudioLessonTimeline.Limits.defaultMinutes(f), error = null) }
    fun setDescription(v: String) = form.update { it.copy(description = v) }
    fun setDialogue(v: String) = form.update { it.copy(dialogue = v) }
    fun showDialogue() = form.update { it.copy(showDialogue = true) }
    fun setText(v: String) = form.update { it.copy(text = v) }
    fun setMinutes(m: Int) = form.update { it.copy(minutes = m.coerceIn(AudioLessonTimeline.Limits.MIN_MINUTES, AudioLessonTimeline.Limits.MAX_MINUTES)) }

    fun start() {
        val f = ui.value
        if (!f.canStart) return
        form.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            try {
                val body = if (f.format == "dialogue") {
                    NewAudioLessonBody(format = "dialogue", description = f.description.trim(), dialogue = f.dialogue.trim().ifEmpty { null }, target_minutes = f.minutes)
                } else {
                    NewAudioLessonBody(format = "sleep", text = f.text.trim(), target_minutes = f.minutes)
                }
                val lesson = app.repo.api.createAudioLesson(body)
                app.analytics.track("audio_lesson.create", mapOf("format" to f.format, "target_minutes" to f.minutes))
                store.remember(lesson)
                app.haptics.correct()
                form.update { it.copy(busy = false, description = "", dialogue = "", text = "") }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                form.update { it.copy(busy = false, error = e.userMessage()) }
            }
        }
    }

    fun retry(id: String) = busy(id) {
        store.remember(app.repo.api.retryAudioLesson(id))
        list.refresh()
    }

    fun delete(id: String) = busy(id) {
        // Stop it first when it is the lesson playing in the background.
        AudioLessonPlayback.engine.value?.let { e -> if (e.currentLessonId() == id) e.pause() }
        store.delete(id)
    }

    private fun busy(id: String, block: suspend () -> Unit) {
        form.update { it.copy(busyId = id, error = null) }
        viewModelScope.launch {
            try {
                block()
                form.update { it.copy(busyId = null) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                form.update { it.copy(busyId = null, error = e.userMessage()) }
            }
        }
    }

    class Factory(private val app: LabApp) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = AudioLessonsViewModel(app) as T
    }
}

/** The player: the lesson (cached first), its file (saved, else downloaded and kept), then the service's engine. */
@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class AudioLessonPlayerViewModel(private val app: LabApp, private val id: String) : ViewModel() {
    private val store = AudioLessonStore(app.cache, app.repo.api, app.filesDir)
    private val screen = MutableStateFlow(AudioLessonPlayerUi())
    private val file = MutableStateFlow<File?>(null)

    /** The engine's state for THIS lesson (another lesson playing in the background is not shown here). */
    private val playback = AudioLessonPlayback.engine.flatMapLatest { e -> e?.state ?: flowOf(AudioLessonPlaybackState()) }

    private val clock = flow {
        while (true) {
            emit(android.os.SystemClock.elapsedRealtime())
            delay(500)
        }
    }

    val ui: StateFlow<AudioLessonPlayerUi> = combine(screen, playback, AudioLessonPlayback.engine, clock, file) { s, p, engine, now, f ->
        if (p.lessonId != id || engine == null || f == null) {
            s.copy(canPlay = false, playing = false, speed = p.speed)
        } else {
            s.copy(
                canPlay = true,
                playing = p.playing,
                positionMs = p.positionMs,
                speed = p.speed,
                timerMinutes = p.timerMinutes,
                timerLeftMs = p.timerLeftMs(now),
            )
        }
    }.stateIn(viewModelScope, SharingStarted.Eagerly, AudioLessonPlayerUi())

    init {
        viewModelScope.launch { load() }
        // The engine (created when the service binds) gets this lesson once the file is here.
        viewModelScope.launch {
            combine(AudioLessonPlayback.engine, file) { e, f -> e to f }.collectLatest { (e, f) ->
                val lesson = screen.value.lesson
                if (e != null && f != null && lesson != null) e.load(lesson, f)
            }
        }
    }

    private fun engine(): AudioLessonEngine? = AudioLessonPlayback.engine.value?.takeIf { it.currentLessonId() == id && file.value != null }

    private suspend fun load() {
        var lesson = store.cachedDetail(id) ?: store.cachedList().firstOrNull { it.id == id }
        screen.update { it.copy(lesson = lesson) }
        if (app.online.value) {
            try {
                lesson = store.fetchDetail(id)
                screen.update { it.copy(lesson = lesson, loadError = null) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (lesson == null || !lesson.hasDetail) screen.update { it.copy(loadError = e.userMessage()) }
            }
        } else if (lesson == null) {
            screen.update { it.copy(loadError = "This lesson isn't on this phone yet — open it once with a connection to keep it.") }
        }
        // Not ready yet (opened from a link): keep checking.
        while (lesson?.building == true && viewModelScope.isActive) {
            delay(5000)
            if (!app.online.value) continue
            val fresh = runCatching { store.fetchDetail(id) }.getOrNull() ?: continue
            lesson = fresh
            screen.update { it.copy(lesson = fresh) }
        }
        val ready = lesson?.takeIf { it.ready && it.audio_version != null } ?: return
        val saved = store.savedFile(id, ready.audio_version)
        if (saved != null) {
            screen.update { it.copy(savedOnPhone = true) }
            file.value = saved
            return
        }
        if (!app.online.value) {
            screen.update { it.copy(loadError = "This lesson isn't on this phone yet — open it once with a connection to keep it.") }
            return
        }
        screen.update { it.copy(download = 0.0) }
        try {
            val f = store.download(ready) { fraction, bytes -> screen.update { it.copy(download = fraction, downloadBytes = bytes) } }
            screen.update { it.copy(download = null, savedOnPhone = true) }
            file.value = f
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            screen.update { it.copy(download = null, loadError = e.userMessage()) }
        }
    }

    fun toggle() { engine()?.toggle() }
    fun seekTo(ms: Long) { engine()?.seekTo(ms) }
    fun skip(delta: Long) { engine()?.skip(delta) }
    fun previousChapter() { engine()?.previousChapter() }
    fun nextChapter() { engine()?.nextChapter() }

    fun nextSpeed() {
        val e = AudioLessonPlayback.engine.value ?: return
        e.setSpeed(AudioLessonTimeline.nextSpeed(e.state.value.speed))
    }

    fun setTimer(minutes: Int) {
        screen.update { it.copy(showTimer = false) }
        engine()?.setSleepTimer(minutes)
    }

    fun toggleTimerSheet() = screen.update { it.copy(showTimer = !it.showTimer) }
    fun toggleChapters() = screen.update { it.copy(showChapters = !it.showChapters) }
    fun toggleTranscript() = screen.update { it.copy(showTranscript = !it.transcriptOn) }
    fun toggleWords() = screen.update { it.copy(showWords = !it.showWords) }

    override fun onCleared() {
        AudioLessonPlayback.engine.value?.savePosition()
    }

    class Factory(private val app: LabApp, private val id: String) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = AudioLessonPlayerViewModel(app, id) as T
    }
}
