package dev.jeromeswannack.chineselearning.lab.ui.lessons

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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
import dev.jeromeswannack.chineselearning.lab.data.lessons.LessonEntry
import dev.jeromeswannack.chineselearning.lab.data.lessons.LessonRuntime
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * `/lessons/:id/play?from=&mode=revision` — a mini lesson outside any session (the web's
 * LessonReplayPage): Home's homework / to-do rows ("🎓 new", "🔁 Revision"), the Mini Lessons page
 * (▶ Start / ▶ Revision / ▶ Continue / ▶ Do it again), a finished homework pass, the podcast
 * player's companion card. The real player: a run saved as it goes (it continues next time), the
 * retry round at the end, the completion recorded at the end — its outcome decides done forever vs
 * a revision in a week (core LessonRevision). `mode=revision` plays the lesson's revision while one
 * is waiting; otherwise the whole lesson. Closing (✕) records nothing — the run waits.
 */
sealed interface ReplayState {
    data object Loading : ReplayState
    data object Missing : ReplayState
    /** [revisionKeys]: the revision's scored exercises; null = the whole lesson. */
    data class Playing(val entry: LessonEntry, val revisionKeys: List<String>?) : ReplayState
    /** A LOCKED lesson (core LessonUnlocks): what unlocks it and the button. */
    data class Locked(val entry: LessonEntry) : ReplayState
}

class LessonReplayViewModel(private val app: LabApp, private val id: String, private val from: String, private val wantsRevision: Boolean = false) : ViewModel() {
    /** `lesson.start` source: home / homework / replay. */
    val source: String get() = when (from) { "homework" -> "homework"; "home", "today" -> "home"; else -> "replay" }

    private val _state = MutableStateFlow<ReplayState>(ReplayState.Loading)
    val state: StateFlow<ReplayState> = _state.asStateFlow()

    init {
        viewModelScope.launch { load() }
    }

    /** "✓ I've listened — unlock" / "✓ Done — unlock" on the gate: unlocked here, then it plays. */
    fun unlock() {
        viewModelScope.launch {
            app.safely("unlock lesson") { LessonRuntime.of(app).store.unlock(id, if (from == "player") "player" else "manual") }
            LessonRuntime.of(app).uploadSoon()
            load()
        }
    }

    private suspend fun load() {
        val entry = app.safely("lesson replay load") { LessonRuntime.of(app).store.entry(id) }
        _state.value = if (entry == null) ReplayState.Missing else if (entry.locked) ReplayState.Locked(entry) else {
            // Decided once, when it opens: the finish mid-page doesn't change what is played.
            val revision = wantsRevision && entry.isRevision
            app.analytics.track("lesson.replay", mapOf("from" to from, "revision" to revision, "status" to entry.learn.status))
            ReplayState.Playing(entry, if (revision) entry.revisionKeys() else null)
        }
    }

    /** Finished: recorded (TodayData → the store), synced soon. The player shows the end itself. */
    fun complete(result: LessonResult) {
        if (_state.value !is ReplayState.Playing) return
        app.haptics.celebrate()
        viewModelScope.launch { dev.jeromeswannack.chineselearning.lab.ui.today.TodayData(app).completeLesson(id, result, source = from) }
    }

    class Factory(private val app: LabApp, private val id: String, private val from: String, private val revision: Boolean = false) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = LessonReplayViewModel(app, id, from, revision) as T
    }
}

fun NavGraphBuilder.lessonReplayGraph(nav: LabNav) {
    composable(
        Routes.route("/lessons/{id}/play?from={from}&mode={mode}"),
        arguments = listOf(
            navArgument("from") { type = NavType.StringType; nullable = true; defaultValue = null },
            navArgument("mode") { type = NavType.StringType; nullable = true; defaultValue = null },
        ),
    ) { backStack ->
        val id = backStack.arguments?.getString("id").orEmpty()
        val from = backStack.arguments?.getString("from")?.takeIf { it in setOf("lessons_page", "today", "homework", "player", "coach", "home") } ?: "lessons_page"
        val revision = backStack.arguments?.getString("mode") == "revision"
        val vm: LessonReplayViewModel = viewModel(key = "lesson-replay-$id-$revision", factory = LessonReplayViewModel.Factory(nav.app, id, from, revision))
        val state by vm.state.collectAsStateWithLifecycle()
        LessonReplayRoute(nav, state, vm)
    }
}

/** Analytics source of a run opened here. */
private fun vmSource(vm: LessonReplayViewModel): String = vm.source

@Composable
private fun LessonReplayRoute(nav: LabNav, state: ReplayState, vm: LessonReplayViewModel) {
    when (state) {
        is ReplayState.Playing -> {
            val env = rememberExerciseEnv(nav.app)
            val e = state.entry
            LessonPlayer(
                title = e.lesson.title,
                icon = e.lesson.icon,
                spec = e.lesson.spec,
                env = env,
                context = PlayerContext.Lesson(vmSource(vm)),
                onComplete = vm::complete,
                onEnd = nav::back,
                resume = rememberLessonResume(LocalContext.current, e.id, e.lesson.spec),
                revisionKeys = state.revisionKeys,
            )
        }
        is ReplayState.Locked -> LockedGate(state.entry, onUnlock = vm::unlock, onBack = nav::back)
        ReplayState.Missing -> LabScreen("Mini lesson", onBack = nav::back) {
            item { InlineNotice("This lesson isn't on this phone yet — it comes with the next sync.") }
        }
        ReplayState.Loading -> Box(Modifier.fillMaxSize().background(Lab.colors.background))
    }
}

/** A locked lesson opened from a list: 🔒, what unlocks it and the unlock button. */
@Composable
fun LockedGate(entry: LessonEntry, onUnlock: () -> Unit, onBack: () -> Unit) {
    val unlock = entry.unlock ?: return
    LabScreen("Mini lesson", onBack = onBack) {
        item {
            Column(
                Modifier.fillMaxWidth().padding(top = 24.dp).testTag(LOCKED_GATE_TAG),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text("🔒", fontSize = 56.sp)
                Text(entry.lesson.title, style = MaterialTheme.typography.titleLarge, color = Lab.colors.ink, textAlign = TextAlign.Center)
                Text(dev.jeromeswannack.chineselearning.lab.core.LessonUnlocks.lockedLine(unlock), color = Lab.colors.muted, textAlign = TextAlign.Center)
                PrimaryPill(dev.jeromeswannack.chineselearning.lab.core.LessonUnlocks.buttonLabel(unlock), Modifier.fillMaxWidth().height(54.dp).testTag("lesson-gate-unlock"), onClick = onUnlock)
            }
        }
    }
}

const val LOCKED_GATE_TAG = "lesson-locked-gate"
