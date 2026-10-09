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
import dev.jeromeswannack.chineselearning.lab.core.ItemSchedule
import dev.jeromeswannack.chineselearning.lab.core.Revisit
import dev.jeromeswannack.chineselearning.lab.core.StudyQueue
import dev.jeromeswannack.chineselearning.lab.data.lessons.LessonEntry
import dev.jeromeswannack.chineselearning.lab.data.lessons.LessonRuntime
import dev.jeromeswannack.chineselearning.lab.ui.fx.ConfettiRain
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.time.ZoneId

/**
 * `/lessons/:id/play?from=` — "▶ Do it again" / "▶ Start" on a mini lesson outside the session
 * (the web's LessonReplayPage): from the Mini Lessons list, a "Done today" row of today's lesson
 * list, or a finished homework pass. The real player with [PlayerContext.Replay]:
 *  - due today (new, or due by the cutoff — `replayIsPractice` false): a normal run; the rating
 *    records the completion exactly like the session (attempt for the tutor, "revisit later"
 *    pacing, homework done) through TodayData;
 *  - not due: the same rating bar plus "Practice only", which records nothing.
 * Closing (✕) records nothing either way.
 */
sealed interface ReplayState {
    data object Loading : ReplayState
    data object Missing : ReplayState
    data class Playing(val entry: LessonEntry, val practice: Boolean) : ReplayState
    /** A LOCKED lesson (core LessonUnlocks): what unlocks it and the button. */
    data class Locked(val entry: LessonEntry) : ReplayState
    /** [rated]: saved as a completion; else Practice only (nothing recorded). */
    data class Finished(val entry: LessonEntry, val rated: Boolean) : ReplayState
}

class LessonReplayViewModel(private val app: LabApp, private val id: String, private val from: String) : ViewModel() {
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
        run {
            val entry = app.safely("lesson replay load") { LessonRuntime.of(app).store.entry(id) }
            _state.value = if (entry == null) ReplayState.Missing else if (entry.locked) ReplayState.Locked(entry) else {
                // Decided once, when it opens: rating it mid-way doesn't flip it.
                val practice = Revisit.replayIsPractice(entry.state, StudyQueue.cutoff(System.currentTimeMillis(), ZoneId.systemDefault()).ts)
                app.analytics.track("lesson.replay", mapOf("from" to from, "practice" to practice))
                ReplayState.Playing(entry, practice)
            }
        }
    }

    /** Rated (or Done for good): recorded exactly like the session (TodayData), then the done screen. */
    fun complete(result: LessonResult) {
        val playing = _state.value as? ReplayState.Playing ?: return
        _state.value = ReplayState.Finished(playing.entry, rated = true)
        app.haptics.rated(result.rating)
        viewModelScope.launch { dev.jeromeswannack.chineselearning.lab.ui.today.TodayData(app).completeLesson(id, result, source = "replay") }
    }

    /** Practice only: nothing is written. */
    fun practiceDone() {
        val playing = _state.value as? ReplayState.Playing ?: return
        _state.value = ReplayState.Finished(playing.entry, rated = false)
        app.haptics.tick()
    }

    class Factory(private val app: LabApp, private val id: String, private val from: String) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = LessonReplayViewModel(app, id, from) as T
    }
}

fun NavGraphBuilder.lessonReplayGraph(nav: LabNav) {
    composable(
        Routes.route("/lessons/{id}/play?from={from}"),
        arguments = listOf(navArgument("from") { type = NavType.StringType; nullable = true; defaultValue = null }),
    ) { backStack ->
        val id = backStack.arguments?.getString("id").orEmpty()
        val from = backStack.arguments?.getString("from")?.takeIf { it in setOf("lessons_page", "today", "homework", "player") } ?: "lessons_page"
        val vm: LessonReplayViewModel = viewModel(key = "lesson-replay-$id", factory = LessonReplayViewModel.Factory(nav.app, id, from))
        val state by vm.state.collectAsStateWithLifecycle()
        LessonReplayRoute(nav, state, vm)
    }
}

@Composable
private fun LessonReplayRoute(nav: LabNav, state: ReplayState, vm: LessonReplayViewModel) {
    when (state) {
        is ReplayState.Playing -> {
            val env = rememberExerciseEnv(nav.app)
            val e = state.entry
            val previews = remember(e) { ItemSchedule.previews(e.state, e.settings) }
            LessonPlayer(
                title = e.lesson.title,
                icon = e.lesson.icon,
                spec = e.lesson.spec,
                env = env,
                context = PlayerContext.Replay(state.practice),
                previews = previews,
                onComplete = vm::complete,
                onEnd = nav::back,
                resume = rememberLessonResume(LocalContext.current, e.id, e.lesson.spec),
                onPracticeDone = vm::practiceDone,
            )
        }
        is ReplayState.Finished -> ReplayDone(state, onDone = nav::back)
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

/** After a replay: "Saved" (rated) or "Practice done" (nothing recorded). */
@Composable
fun ReplayDone(state: ReplayState.Finished, onDone: () -> Unit) {
    Box(Modifier.fillMaxSize().background(Lab.colors.background).safeDrawingPadding().testTag(REPLAY_DONE_TAG)) {
        Column(
            Modifier.fillMaxWidth().align(Alignment.Center).padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(state.entry.lesson.icon ?: "🎓", fontSize = 64.sp)
            Text(if (state.rated) "Saved" else "Practice done", style = MaterialTheme.typography.headlineSmall, color = Lab.colors.ink)
            Text(
                if (state.rated) "Your answers are saved and your rating decides when it comes back."
                else "Nothing was recorded — it comes back when it was going to.",
                color = Lab.colors.muted, textAlign = TextAlign.Center,
            )
            PrimaryPill("Done", Modifier.fillMaxWidth().height(54.dp), onClick = onDone)
        }
        if (state.rated) ConfettiRain(key = 0, colors = Palette.Confetti)
    }
}

const val REPLAY_DONE_TAG = "lesson-replay-done"
