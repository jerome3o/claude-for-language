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
        // Back from a lesson: its run may have moved on or finished.
        androidx.lifecycle.compose.LifecycleResumeEffect(Unit) { vm.refreshRuns(); onPauseOrDispose { } }
        val menu = dev.jeromeswannack.chineselearning.lab.ui.homework.rememberRowActions(nav.app, "lessons_page")
        dev.jeromeswannack.chineselearning.lab.ui.homework.RowActionsHost(menu)
        MiniLessonsScreen(
            ui,
            MiniLessonsActions(
                onBack = nav::back,
                onEdit = { nav.open(Routes.lessonEdit(it)) },
                onAnswers = { nav.open(Routes.lessonAttempts() + "?lesson=" + Routes.seg(it)) },
                onDelete = vm::delete,
                onRetry = vm::refresh,
                onPlay = { id, revision -> nav.open(Routes.lessonPlay(id, "lessons_page", revision)) },
                onUnlock = vm::unlock,
                onListen = { nav.open(Routes.audioLesson(it)) },
                onMenu = { entry -> menu.open(vm.menuTarget(entry)) },
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
        // Open / skipped homework on each lesson (the card menu's "Skip this homework"; skipped ones leave To do).
        viewModelScope.launch {
            dev.jeromeswannack.chineselearning.lab.data.homework.HomeworkStore.observe(app.cache).collect { data ->
                val (assignments, events) = data ?: (emptyList<dev.jeromeswannack.chineselearning.lab.core.HomeworkAssignment>() to emptyList())
                val active = assignments.filter { it.kind == "lesson" && it.status == "active" }
                fun skipped(a: dev.jeromeswannack.chineselearning.lab.core.HomeworkAssignment) =
                    dev.jeromeswannack.chineselearning.lab.core.Homework.isSkipped(events.filter { it.assignment_id == a.id }, a.skipped_at)
                val open = active.filter { !skipped(it) }
                val openIds = open.mapTo(HashSet()) { it.target_id }
                _ui.update { u -> u.copy(openHomework = open.associateBy { it.target_id }, skippedHomework = active.filter { skipped(it) && it.target_id !in openIds }.mapTo(HashSet()) { it.target_id }) }
            }
        }
        // Runs saved / cleared (a lesson finished, Start over): the bars follow.
        viewModelScope.launch { dev.jeromeswannack.chineselearning.lab.data.lessons.LessonProgressStore.changes.collect { refreshRuns() } }
        viewModelScope.launch {
            // Cached lessons first; null only until the first sync has ever fetched them.
            val cached = runtime.store.hasCache()
            if (!cached) _ui.update { it.copy(lessons = null) }
            runtime.store.observe().collect { list ->
                if (list.isNotEmpty() || runtime.store.hasCache()) _ui.update { it.copy(lessons = list, updatedAt = app.cache.updatedAt(dev.jeromeswannack.chineselearning.lab.data.lessons.LessonStore.LIST)) }
                refreshRuns()
                // The locked lessons' podcasts (title, heard to the end) from the audio lessons cache.
                val ids = list.mapNotNull { e -> e.unlock?.takeIf { e.locked && it.isAudio }?.audioLessonId }
                if (ids.isNotEmpty()) {
                    val audio = runCatching { dev.jeromeswannack.chineselearning.lab.data.audiolessons.AudioLessonStore(app.cache, app.repo.api, app.filesDir).cachedList() }.getOrDefault(emptyList()).associateBy { it.id }
                    val map = ids.associateWith { id -> audio[id]?.title to (audio[id]?.listened_at != null || runtime.store.listenedHere(id) != null) }
                    _ui.update { it.copy(audio = map) }
                }
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

    /** "✓ I've listened — unlock" / "✓ Done — unlock": written here at once, uploaded through the outbox. */
    fun unlock(id: String) {
        viewModelScope.launch {
            app.safely("unlock lesson") { runtime.store.unlock(id, "manual") }
            app.haptics.tick()
            runtime.uploadSoon()
        }
    }

    /** Runs in progress on this phone ("▶ Continue") and their retry bars; re-read whenever the list is shown again. */
    fun refreshRuns() {
        val runs = dev.jeromeswannack.chineselearning.lab.data.lessons.LessonProgressStore.get(app).inProgress()
        _ui.update { u ->
            val specs = u.lessons.orEmpty().associate { it.id to it.lesson.spec }
            u.copy(
                inProgress = runs.mapValues { e -> e.value.mode },
                runBars = dev.jeromeswannack.chineselearning.lab.data.lessons.LessonProgressStore.runBars(runs, specs, app.prefs.skipHandwriting),
                cutoff = StudyQueue.cutoff(System.currentTimeMillis(), ZoneId.systemDefault()),
            )
        }
    }

    /**
     * What a card's menu acts on (core HomeworkRowActions): the tutor's open homework is skipped, his own
     * lessons / revisions done for good or deleted (web MiniLessonsPage `menuTarget`).
     */
    fun menuTarget(entry: dev.jeromeswannack.chineselearning.lab.data.lessons.LessonEntry): dev.jeromeswannack.chineselearning.lab.ui.homework.RowActionTarget {
        val a = _ui.value.openHomework[entry.id]
        val kind = when {
            a != null -> if (dev.jeromeswannack.chineselearning.lab.core.Homework.hasOneOff(a.mode)) "assignment" else "tutor_lesson"
            entry.isRevision -> "revision"
            else -> "lesson"
        }
        return dev.jeromeswannack.chineselearning.lab.ui.homework.RowActionTarget(kind, entry.lesson.title, a?.tutor_name, a?.id, if (a != null) "lesson" else null, entry.id)
    }

    fun delete(id: String) {
        _ui.update { it.copy(deleting = id) }
        viewModelScope.launch {
            try {
                runtime.store.delete(id)
                runtime.uploadSoon()
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
