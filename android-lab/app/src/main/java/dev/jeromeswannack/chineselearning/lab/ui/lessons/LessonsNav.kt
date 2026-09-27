package dev.jeromeswannack.chineselearning.lab.ui.lessons

import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.StudyQueue
import dev.jeromeswannack.chineselearning.lab.data.api.AttemptDetailDto
import dev.jeromeswannack.chineselearning.lab.data.api.AttemptMediaDto
import dev.jeromeswannack.chineselearning.lab.data.api.AttemptSummaryDto
import dev.jeromeswannack.chineselearning.lab.data.api.lessonAttempt
import dev.jeromeswannack.chineselearning.lab.data.api.lessonAttempts
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.data.lessons.LessonRuntime
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.ZoneId

/** Package B routes: `/lessons`, `/lesson-attempts[?lesson=]`, `/lesson-attempts/:id`. */
fun NavGraphBuilder.lessonsGraph(nav: LabNav) {
    composable(Routes.route("/lessons")) {
        val vm: MiniLessonsViewModel = viewModel(factory = MiniLessonsViewModel.Factory(nav.app))
        val ui by vm.ui.collectAsStateWithLifecycle()
        MiniLessonsScreen(
            ui,
            MiniLessonsActions(
                onBack = nav::back,
                onEdit = { nav.open(Routes.lessonEdit(it)) },
                onAnswers = { nav.open(Routes.lessonAttempts() + "?lesson=" + Routes.seg(it)) },
                onDelete = vm::delete,
                onRetry = vm::refresh,
            ),
        )
    }
    composable(
        Routes.route("/lesson-attempts?lesson={lesson}"),
        arguments = listOf(navArgument("lesson") { type = NavType.StringType; nullable = true; defaultValue = null }),
    ) { entry ->
        val app = nav.app
        val lessonId = entry.arguments?.getString("lesson")
        val vm: AttemptsViewModel = viewModel(key = "attempts-${lessonId ?: "all"}", factory = AttemptsViewModel.Factory(app, lessonId, null))
        val state by vm.list.state.collectAsStateWithLifecycle()
        AttemptListScreen(state, onBack = nav::back, onOpen = { nav.open(Routes.lessonAttempts(it)) }, onRetry = { vm.list.refresh() })
    }
    composable(Routes.route("/lesson-attempts/{id}")) { entry ->
        val app = nav.app
        val id = entry.arguments?.getString("id").orEmpty()
        val vm: AttemptsViewModel = viewModel(key = "attempt-$id", factory = AttemptsViewModel.Factory(app, null, id))
        val state by vm.detail.state.collectAsStateWithLifecycle()
        val runtime = remember { LessonRuntime.of(app) }
        val playing by runtime.audio.playing.collectAsState()
        AttemptDetailScreen(state, onBack = nav::back, onRetry = { vm.detail.refresh() }, onPlay = vm::play, playingKey = playing)
    }
}

class MiniLessonsViewModel(private val app: LabApp) : ViewModel() {
    private val runtime = LessonRuntime.of(app)
    private val _ui = MutableStateFlow(MiniLessonsUi(cutoff = StudyQueue.cutoff(System.currentTimeMillis(), ZoneId.systemDefault())))
    val ui: StateFlow<MiniLessonsUi> = _ui.asStateFlow()

    init {
        viewModelScope.launch {
            // Cached lessons first; null only until the first sync has ever fetched them.
            val cached = runtime.store.hasCache()
            if (!cached) _ui.update { it.copy(lessons = null) }
            runtime.store.observe().collect { list ->
                if (list.isNotEmpty() || runtime.store.hasCache()) _ui.update { it.copy(lessons = list, updatedAt = app.cache.updatedAt(dev.jeromeswannack.chineselearning.lab.data.lessons.LessonStore.LIST)) }
            }
        }
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            if (!app.online.value) {
                _ui.update { it.copy(offline = true, lessons = it.lessons ?: emptyList()) }
                return@launch
            }
            _ui.update { it.copy(refreshing = true, error = null, offline = false) }
            try {
                app.outbox.drain()
                runtime.store.sync(prefetch = false)
                _ui.update { it.copy(refreshing = false) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _ui.update { it.copy(refreshing = false, error = e.userMessage(), offline = e is java.io.IOException && e !is dev.jeromeswannack.chineselearning.lab.data.HttpException, lessons = it.lessons ?: emptyList()) }
            }
        }
    }

    fun delete(id: String) {
        _ui.update { it.copy(deleting = id) }
        viewModelScope.launch {
            try {
                runtime.store.delete(id)
                app.haptics.tick()
                _ui.update { it.copy(deleting = null) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _ui.update { it.copy(deleting = null, error = e.userMessage()) }
            }
        }
    }

    class Factory(private val app: LabApp) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = MiniLessonsViewModel(app) as T
    }
}

/** My answers — the list (cached per lesson filter) and one attempt (cached per id). */
class AttemptsViewModel(private val app: LabApp, lessonId: String?, attemptId: String?) : ViewModel() {
    private val runtime = LessonRuntime.of(app)
    val list by lazy { app.cachedResource<List<AttemptSummaryDto>>(viewModelScope, "lessons/attempts/${lessonId ?: "all"}", "lessons") { lessonAttempts(lessonId) } }
    val detail by lazy { app.cachedResource<AttemptDetailDto>(viewModelScope, "lessons/attempt/${attemptId ?: "none"}", "lessons") {
        if (attemptId == null) throw IllegalStateException("no attempt") else lessonAttempt(attemptId)
    } }

    /** A recording is an R2 object: downloaded once, then played from the phone. */
    fun play(media: AttemptMediaDto) {
        viewModelScope.launch {
            if (runtime.audio.playing.value == media.audioKey) { runtime.audio.stop(); return@launch }
            val file = runtime.media.image(media.audioKey, app.online.value) ?: return@launch
            runtime.audio.playFileFor(media.audioKey, file)
        }
    }

    override fun onCleared() = runtime.audio.stop()

    class Factory(private val app: LabApp, private val lessonId: String?, private val attemptId: String?) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = AttemptsViewModel(app, lessonId, attemptId) as T
    }
}
