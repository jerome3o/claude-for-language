package dev.jeromeswannack.chineselearning.lab.ui.today

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.StudyQueue
import dev.jeromeswannack.chineselearning.lab.data.lessons.LessonEntry
import dev.jeromeswannack.chineselearning.lab.data.lessons.LessonProgressStore
import dev.jeromeswannack.chineselearning.lab.data.lessons.LessonRuntime
import dev.jeromeswannack.chineselearning.lab.data.readers.ReaderEntry
import dev.jeromeswannack.chineselearning.lab.data.study.StudyDayStore
import dev.jeromeswannack.chineselearning.lab.fx.Sounds
import dev.jeromeswannack.chineselearning.lab.ui.home.TodayCounts
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.lessons.LessonPlayer
import dev.jeromeswannack.chineselearning.lab.ui.lessons.LessonResult
import dev.jeromeswannack.chineselearning.lab.ui.lessons.PlayerContext
import dev.jeromeswannack.chineselearning.lab.ui.lessons.rememberExerciseEnv
import dev.jeromeswannack.chineselearning.lab.ui.lessons.rememberLessonResume
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import dev.jeromeswannack.chineselearning.lab.ui.readers.SessionReader
import dev.jeromeswannack.chineselearning.lab.ui.readers.StudyReaderView
import dev.jeromeswannack.chineselearning.lab.ui.readers.rememberReaderEnv
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.merge
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.ZoneId

/**
 * Lab-only "today split" routes (no web twin — android-lab/PARITY.md):
 * `/today/lessons` (today's mini lessons), `/today/lessons/:id` (one of them, recorded like
 * the session), `/today/reader` (today's story, rated like the session).
 */
fun NavGraphBuilder.todayGraph(nav: LabNav) {
    composable(Routes.route("/today/lessons")) {
        val vm: TodayViewModel = viewModel(factory = factory { TodayViewModel(nav.app) })
        val today by vm.ui.collectAsStateWithLifecycle()
        TodayLessonsScreen(today, onBack = nav::back, onOpen = { nav.open(Routes.todayLesson(it)) }, onAllLessons = { nav.open(Routes.lessons()) })
    }
    composable(Routes.route("/today/lessons/{id}")) { entry ->
        val id = entry.arguments?.getString("id").orEmpty()
        val vm: TodayLessonViewModel = viewModel(key = "today-lesson-$id", factory = factory { TodayLessonViewModel(nav.app, id) })
        val state by vm.state.collectAsStateWithLifecycle()
        TodayLessonRoute(nav, state, vm)
    }
    composable(Routes.route("/today/reader")) {
        val vm: TodayReaderViewModel = viewModel(factory = factory { TodayReaderViewModel(nav.app) })
        val state by vm.state.collectAsStateWithLifecycle()
        TodayReaderRoute(nav, state, vm)
    }
}

private inline fun <reified V : ViewModel> factory(crossinline make: () -> V) = object : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T = make() as T
}

/** Home's "Today" numbers: the card counts (the Study button's), today's lessons and story. Off the main thread. */
object TodayHomeLoader {
    suspend fun load(app: LabApp, nowMs: Long = System.currentTimeMillis(), zone: ZoneId = ZoneId.systemDefault()): TodayHome = withContext(Dispatchers.IO) {
        val counts = TodayCounts.compute(app, nowMs, zone)
        val reviewed = app.repo.dao.reviewsSince(Js.toIsoString(StudyQueue.startOfDay(nowMs, zone)))
        val snapshot = runCatching { TodayData(app).snapshot(nowMs, zone) }.getOrDefault(TodaySnapshot.EMPTY)
        val progress = LessonProgressStore.get(app)
        TodayHome.from(snapshot, counts.total, reviewed) { progress.has(it) }
    }

    /**
     * After a lesson / the story from Home: when that was the last of today's work (cards,
     * lessons and story all done), the second, smaller celebration — once a day.
     */
    suspend fun celebrateIfAllClear(app: LabApp): Boolean {
        val home = load(app)
        if (!home.allClear || (home.lessonsDone.isEmpty() && home.reader.state != TodayReaderRow.State.READ)) return false
        if (!StudyDayStore.get(app).claimAllClear()) return false
        app.sounds.play(Sounds.Sfx.MILESTONE, 0.7f)
        app.haptics.celebrate()
        return true
    }
}

/** Today's lessons / story, kept fresh as lessons are completed and synced. */
class TodayViewModel(private val app: LabApp) : ViewModel() {
    private val _ui = MutableStateFlow<TodayHome?>(null)
    val ui: StateFlow<TodayHome?> = _ui.asStateFlow()

    init {
        val runtime = LessonRuntime.of(app)
        viewModelScope.launch {
            merge(runtime.store.observe().map { }, runtime.readers.observe().map { }, app.repo.dataVersion.map { }).collect { refresh() }
        }
        refresh()
    }

    fun refresh() {
        viewModelScope.launch { _ui.value = TodayHomeLoader.load(app) }
    }
}

sealed interface TodayItemState {
    data object Loading : TodayItemState
    data object Missing : TodayItemState
    data class Lesson(val entry: LessonEntry) : TodayItemState
    data class Reader(val entry: ReaderEntry) : TodayItemState
    /** Rated: going back to where it was opened from. */
    data object Finished : TodayItemState
}

class TodayLessonViewModel(private val app: LabApp, private val id: String) : ViewModel() {
    private val _state = MutableStateFlow<TodayItemState>(TodayItemState.Loading)
    val state: StateFlow<TodayItemState> = _state.asStateFlow()

    init {
        viewModelScope.launch { _state.value = LessonRuntime.of(app).store.entry(id)?.let { TodayItemState.Lesson(it) } ?: TodayItemState.Missing }
    }

    /** Rated: recorded exactly like the session (TodayData), then back. */
    fun complete(result: LessonResult, then: () -> Unit) {
        if (_state.value !is TodayItemState.Lesson) return
        _state.value = TodayItemState.Finished
        app.haptics.rated(result.rating)
        viewModelScope.launch {
            TodayData(app).completeLesson(id, result)
            TodayHomeLoader.celebrateIfAllClear(app)
            then()
        }
    }
}

class TodayReaderViewModel(private val app: LabApp) : ViewModel() {
    private val _state = MutableStateFlow<TodayItemState>(TodayItemState.Loading)
    val state: StateFlow<TodayItemState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            val entry = runCatching { TodayData(app).snapshot().readerEntry }.getOrNull()
            _state.value = entry?.let { TodayItemState.Reader(it) } ?: TodayItemState.Missing
        }
    }

    /** The last page was rated: the review event + the day's reader mark, like the session. */
    fun rate(rating: Int, timeSpentMs: Long, then: () -> Unit) {
        val entry = (_state.value as? TodayItemState.Reader)?.entry ?: return
        _state.value = TodayItemState.Finished
        app.haptics.rated(rating)
        viewModelScope.launch {
            TodayData(app).rateReader(entry.id, rating, timeSpentMs)
            TodayHomeLoader.celebrateIfAllClear(app)
            then()
        }
    }
}

@Composable
private fun TodayLessonRoute(nav: LabNav, state: TodayItemState, vm: TodayLessonViewModel) {
    val app = nav.app
    val env = rememberExerciseEnv(app)
    when (state) {
        is TodayItemState.Lesson -> {
            val e = state.entry
            val previews = remember(e) { CardScheduler.intervalPreviews(e.state, System.currentTimeMillis()) }
            LessonPlayer(
                title = e.lesson.title,
                icon = e.lesson.icon,
                spec = e.lesson.spec,
                env = env,
                context = PlayerContext.Today,
                previews = previews,
                onComplete = { vm.complete(it) { nav.back() } },
                onEnd = nav::back,
                resume = rememberLessonResume(LocalContext.current, e.id, e.lesson.spec),
            )
        }
        TodayItemState.Missing -> MissingItem("Mini lesson", "This lesson isn't on this phone yet — it comes with the next sync.", nav)
        else -> Box(Modifier.fillMaxSize().background(Lab.colors.background))
    }
}

@Composable
private fun TodayReaderRoute(nav: LabNav, state: TodayItemState, vm: TodayReaderViewModel) {
    when (state) {
        is TodayItemState.Reader -> {
            val e = state.entry
            val session = remember(e) { SessionReader(e.reader, CardScheduler.intervalPreviews(e.state, System.currentTimeMillis()), 1) }
            val env = rememberReaderEnv(nav.app, e.id)
            Column(Modifier.fillMaxSize().background(Lab.colors.background).safeDrawingPadding()) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("Today's story", fontWeight = FontWeight.SemiBold, color = Lab.colors.muted, modifier = Modifier.weight(1f).padding(start = 12.dp))
                    IconButton(onClick = nav::back) { Icon(Icons.Filled.Close, "Close", tint = Lab.colors.muted) }
                }
                Box(Modifier.weight(1f).fillMaxWidth()) { StudyReaderView(session, env) { r, ms -> vm.rate(r, ms) { nav.back() } } }
            }
        }
        TodayItemState.Missing -> MissingItem("Today's story", "No story to read today. Your readers are all in More → Graded readers.", nav, Routes.readers())
        else -> Box(Modifier.fillMaxSize().background(Lab.colors.background))
    }
}

@Composable
private fun MissingItem(title: String, text: String, nav: LabNav, more: String? = null) {
    LabScreen(title, onBack = nav::back) {
        item { InlineNotice(text) }
        if (more != null) item { SecondaryPill("Open graded readers") { nav.open(more) } }
    }
}
