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
import dev.jeromeswannack.chineselearning.lab.ui.teaching.studentUser
import androidx.compose.runtime.Composable
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.ZoneId

/**
 * Package B routes: `/lessons`, `/lesson-attempts[?lesson=]`, `/lesson-attempts/:id`, and the
 * tutor's view of a student's answers `/connections/:relId/lesson-attempts[?lesson=]`,
 * `/connections/:relId/lesson-attempts/:attemptId` (same screens, the student's API).
 */
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
                onDoneForGood = { vm.revisit(it, dev.jeromeswannack.chineselearning.lab.data.revisit.RevisitStore.RETIRE) },
                onBringBack = { vm.revisit(it, dev.jeromeswannack.chineselearning.lab.data.revisit.RevisitStore.RESTORE) },
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
        AttemptDetailRoute(nav, relId = null, id = entry.arguments?.getString("id").orEmpty())
    }
    composable(
        Routes.route("/connections/{relId}/lesson-attempts?lesson={lesson}"),
        arguments = listOf(navArgument("lesson") { type = NavType.StringType; nullable = true; defaultValue = null }),
    ) { entry ->
        val relId = entry.arguments?.getString("relId").orEmpty()
        val lessonId = entry.arguments?.getString("lesson")
        val vm: AttemptsViewModel = viewModel(key = "attempts-$relId-${lessonId ?: "all"}", factory = AttemptsViewModel.Factory(nav.app, lessonId, null, relId))
        val state by vm.list.state.collectAsStateWithLifecycle()
        AttemptListScreen(
            state,
            onBack = nav::back,
            onOpen = { nav.open(Routes.studentLessonAttempts(relId, it)) },
            onRetry = { vm.list.refresh() },
            studentName = rememberStudentName(nav, relId),
        )
    }
    composable(Routes.route("/connections/{relId}/lesson-attempts/{attemptId}")) { entry ->
        AttemptDetailRoute(nav, relId = entry.arguments?.getString("relId").orEmpty(), id = entry.arguments?.getString("attemptId").orEmpty())
    }
}

/** One attempt — mine ([relId] null) or a student's (the tutor). */
@Composable
private fun AttemptDetailRoute(nav: LabNav, relId: String?, id: String) {
    val app = nav.app
    val vm: AttemptsViewModel = viewModel(key = "attempt-${relId ?: "me"}-$id", factory = AttemptsViewModel.Factory(app, null, id, relId))
    val state by vm.detail.state.collectAsStateWithLifecycle()
    val runtime = remember { LessonRuntime.of(app) }
    val playing by runtime.audio.playing.collectAsState()
    val strokes = remember(app) { dev.jeromeswannack.chineselearning.lab.data.strokes.StrokeStore.of(app)::get }
    AttemptDetailScreen(
        state,
        onBack = nav::back,
        onRetry = { vm.detail.refresh() },
        onPlay = vm::play,
        playingKey = playing,
        studentName = if (relId != null) rememberStudentName(nav, relId) else null,
        strokeLoader = strokes,
    )
}

/** The student's name in a relationship where I'm the tutor (from the cached relationships), or null. */
@Composable
private fun rememberStudentName(nav: LabNav, relId: String): String? {
    val relationships by nav.app.cache.observe<dev.jeromeswannack.chineselearning.lab.data.api.MyRelationshipsDto>(dev.jeromeswannack.chineselearning.lab.ui.nav.NavKeys.RELATIONSHIPS).collectAsStateWithLifecycle(null)
    val rel = relationships?.students?.firstOrNull { it.id == relId } ?: return null
    return rel.studentUser()?.let { it.name ?: it.email } ?: "Student"
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

    /** ✓ Done for good / ↩ Bring back: written here at once, uploaded through the outbox. */
    fun revisit(id: String, action: String) {
        viewModelScope.launch {
            runtime.store.markRevisit(id, action)
            app.haptics.tick()
            runtime.uploadSoon()
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

/**
 * Lesson answers — the list (cached per lesson filter) and one attempt (cached per id), mine
 * or, with [relId], a student's for their tutor; cached so they re-open offline.
 */
class AttemptsViewModel(private val app: LabApp, lessonId: String?, private val attemptId: String?, relId: String? = null) : ViewModel() {
    private val runtime = LessonRuntime.of(app)
    private val scope = relId?.let { "rel/$it/" } ?: ""
    val list by lazy { app.cachedResource<List<AttemptSummaryDto>>(viewModelScope, "lessons/attempts/$scope${lessonId ?: "all"}", "lessons") { lessonAttempts(lessonId, relId) } }
    val detail by lazy {
        app.cachedResource<AttemptDetailDto>(viewModelScope, "lessons/attempt/$scope${attemptId ?: "none"}", "lessons") {
            if (attemptId == null) throw IllegalStateException("no attempt") else lessonAttempt(attemptId, relId)
        }.also { pollWhileTranscribing(it) }
    }

    /** A recording may still be transcribing — look again every 5 s (web: refetchInterval), for up to 10 minutes. */
    private fun pollWhileTranscribing(res: dev.jeromeswannack.chineselearning.lab.data.platform.CachedResource<AttemptDetailDto>) {
        viewModelScope.launch {
            repeat(120) {
                kotlinx.coroutines.delay(5_000)
                val pending = res.state.value.data?.media?.any { it.transcriptStatus == "pending" } == true
                if (!pending) return@launch
                if (app.online.value) res.refresh()
            }
        }
    }

    /** A recording is an R2 object: downloaded once, then played from the phone. */
    fun play(media: AttemptMediaDto) {
        viewModelScope.launch {
            if (runtime.audio.playing.value == media.audioKey) { runtime.audio.stop(); return@launch }
            val file = runtime.media.image(media.audioKey, app.online.value) ?: return@launch
            runtime.audio.playFileFor(media.audioKey, file)
        }
    }

    override fun onCleared() = runtime.audio.stop()

    class Factory(private val app: LabApp, private val lessonId: String?, private val attemptId: String?, private val relId: String? = null) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = AttemptsViewModel(app, lessonId, attemptId, relId) as T
    }
}
