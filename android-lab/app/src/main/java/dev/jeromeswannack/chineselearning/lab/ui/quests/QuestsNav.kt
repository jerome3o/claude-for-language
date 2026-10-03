package dev.jeromeswannack.chineselearning.lab.ui.quests

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.QuestWorld
import dev.jeromeswannack.chineselearning.lab.data.api.NewQuestBody
import dev.jeromeswannack.chineselearning.lab.data.api.QuestCompleteBody
import dev.jeromeswannack.chineselearning.lab.data.api.QuestDto
import dev.jeromeswannack.chineselearning.lab.data.api.QuestSummaryDto
import dev.jeromeswannack.chineselearning.lab.data.api.createQuest
import dev.jeromeswannack.chineselearning.lab.data.api.deleteQuest
import dev.jeromeswannack.chineselearning.lab.data.api.enc
import dev.jeromeswannack.chineselearning.lab.data.api.quest
import dev.jeromeswannack.chineselearning.lab.data.api.quests
import dev.jeromeswannack.chineselearning.lab.data.api.retryQuest
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.data.platform.FeatureSync
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.fx.Sounds
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/** `/quests` and `/quests/:id` (package H). Play is immersive (NavRules) — no tab bar. */
fun NavGraphBuilder.questsGraph(nav: LabNav) {
    composable(Routes.route("/quests")) {
        val vm: QuestsViewModel = viewModel(factory = QuestsViewModel.Factory(nav.app))
        val ui by vm.ui.collectAsStateWithLifecycle()
        QuestsScreen(
            ui,
            QuestsActions(
                onBack = nav::back,
                onOpen = { nav.open(Routes.quest(it)) },
                onGenerate = { topic, difficulty, goals -> vm.generate(topic, difficulty, goals) { id -> nav.open(Routes.quest(id)) } },
                onRetry = vm::retry,
                onDelete = vm::delete,
                onRefresh = vm::refresh,
            ),
        )
    }
    composable(Routes.route("/quests/{id}")) { entry ->
        val id = entry.arguments?.getString("id").orEmpty()
        val vm: QuestPlayViewModel = viewModel(key = "quest-$id", factory = QuestPlayViewModel.Factory(nav.app, id))
        val loadable by vm.quest.collectAsStateWithLifecycle()
        val retrying by vm.retrying.collectAsStateWithLifecycle()
        val quest = loadable.data
        val world = remember(quest?.world) { quest?.world?.let { runCatching { QuestWorld.parse(it) }.getOrNull() } }
        if (quest != null && quest.status == "ready" && world != null) {
            QuestGameRoute(nav.app, quest.id, world, onExit = { nav.back() }, onFinished = vm::complete)
        } else {
            QuestWaitScreen(
                title = quest?.title.orEmpty(),
                status = quest?.status ?: "generating",
                progress = quest?.progress,
                error = quest?.error ?: if (quest?.status == "ready" && world == null) "The level's world couldn't be read." else null,
                loadError = if (quest == null && !loadable.loading) (loadable.error ?: if (loadable.offline) "You're offline and this quest isn't saved on this phone yet." else null) else null,
                retrying = retrying,
                onRetry = { if (quest == null) vm.refresh() else vm.retry() },
                onBack = nav::back,
            )
        }
    }
}

@Composable
private fun QuestGameRoute(app: LabApp, questId: String, world: QuestWorld, onExit: () -> Unit, onFinished: (Int) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val speech = remember { QuestSpeech(app) }
    DisposableEffect(Unit) { onDispose { speech.release() } }
    var reveal by remember { mutableStateOf(QuestPrefs.reveal(context)) }
    androidx.compose.runtime.LaunchedEffect(questId) { app.analytics.track("quest.play") }
    val controller = remember(questId, world) {
        QuestGameController(
            world,
            scope,
            fx = object : QuestFx {
                override fun step() = app.haptics.tick()
                override fun refused() { app.haptics.wrong(); app.sounds.play(Sounds.Sfx.TAP, 0.5f, 0.6f) }
                override fun pickedUp() { app.haptics.flip(); app.sounds.play(Sounds.Sfx.POP, 0.5f) }
                override fun goal() { app.haptics.correct(); app.sounds.play(Sounds.Sfx.CORRECT) }
                override fun finished() { app.haptics.celebrate(); app.sounds.play(Sounds.Sfx.FANFARE) }
                override fun speak(text: String) = speech.speak(text)
            },
            onFinished = onFinished,
        )
    }
    QuestGameView(controller, reveal, onReveal = { reveal = it; QuestPrefs.setReveal(context, it) }, onExit = onExit)
}

private const val LIST_KEY = "quests/list"
private fun questKey(id: String) = "quests/q/$id"

class QuestsViewModel(private val app: LabApp) : ViewModel() {
    private val list = app.cachedResource<List<QuestSummaryDto>>(viewModelScope, LIST_KEY, "quests") { quests() }
    private val extra = MutableStateFlow(QuestsUi())
    val ui: StateFlow<QuestsUi> = combine(list.state, extra) { l, e -> e.copy(quests = l) }.stateIn(viewModelScope, SharingStarted.Eagerly, QuestsUi())

    init {
        // Levels are written in the background; keep the list moving while any are.
        viewModelScope.launch {
            while (isActive) {
                delay(4000)
                if (list.state.value.data.orEmpty().any { it.status == "generating" } && app.online.value) list.refresh()
            }
        }
    }

    fun refresh() { list.refresh() }

    fun generate(topic: String, difficulty: String, goals: Int, onCreated: (String) -> Unit) {
        if (extra.value.generating) return
        extra.update { it.copy(generating = true, generateError = null) }
        app.analytics.track("quest.generate", mapOf("difficulty" to difficulty))
        viewModelScope.launch {
            try {
                val created = app.repo.api.createQuest(NewQuestBody(topic.ifBlank { null }, difficulty, goals))
                app.haptics.tick()
                list.refresh()
                extra.update { it.copy(generating = false) }
                onCreated(created.id)
            } catch (e: Exception) {
                extra.update { it.copy(generating = false, generateError = "Couldn't start building the level. ${e.userMessage()}") }
            }
        }
    }

    fun retry(id: String) = busy(id) {
        app.repo.api.retryQuest(id)
        list.update { l -> l.orEmpty().map { if (it.id == id) it.copy(status = "generating", progress = "queued", error = null) else it } }
        list.refresh()
    }

    fun delete(id: String) = busy(id) {
        app.repo.api.deleteQuest(id)
        list.update { l -> l.orEmpty().filter { it.id != id } }
        app.cache.delete(questKey(id))
    }

    private fun busy(id: String, block: suspend () -> Unit) {
        extra.update { it.copy(busyId = id, actionError = null) }
        viewModelScope.launch {
            try {
                block()
                extra.update { it.copy(busyId = null) }
            } catch (e: Exception) {
                extra.update { it.copy(busyId = null, actionError = e.userMessage()) }
            }
        }
    }

    class Factory(private val app: LabApp) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = QuestsViewModel(app) as T
    }
}

class QuestPlayViewModel(private val app: LabApp, private val id: String) : ViewModel() {
    private val resource = app.cachedResource<QuestDto>(viewModelScope, questKey(id), "quest") { quest(id) }
    val quest: StateFlow<Loadable<QuestDto>> = resource.state
    val retrying = MutableStateFlow(false)

    init {
        // Poll while the level is still being written.
        viewModelScope.launch {
            while (isActive) {
                delay(3000)
                if (resource.state.value.data?.status == "generating" && app.online.value) resource.refresh()
            }
        }
    }

    fun refresh() { resource.refresh() }

    fun retry() {
        if (retrying.value) return
        retrying.value = true
        viewModelScope.launch {
            runCatching {
                app.repo.api.retryQuest(id)
                resource.update { q -> q?.copy(status = "generating", progress = "queued", error = null) ?: QuestDto(id, status = "generating") }
            }
            retrying.value = false
            resource.refresh()
        }
    }

    /** Report the finish once per play-through (best moves on the list); queued when offline. */
    fun complete(moves: Int) {
        app.analytics.track("quest.complete", mapOf("moves" to moves))
        app.scope.launch {
            runCatching {
                app.outbox.enqueueJson("quest-complete", "POST", "/api/quests/${enc(id)}/complete", QuestCompleteBody(moves))
                app.scheduleBackgroundUpload()
                app.cache.delete(LIST_KEY) // the list re-reads best moves next time
            }
        }
    }

    class Factory(private val app: LabApp, private val id: String) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = QuestPlayViewModel(app, id) as T
    }
}

/**
 * Keeps quests playable on the train: after each sync, refresh the list (at most hourly)
 * and save every ready level that isn't on the phone yet.
 */
object QuestsSync : FeatureSync {
    override suspend fun sync(ctx: dev.jeromeswannack.chineselearning.lab.data.platform.SyncContext) {
        val cache = ctx.cache
        if (!ctx.full && cache.isFresh(LIST_KEY, 60 * 60 * 1000L)) return
        val list = ctx.api.quests()
        cache.put(LIST_KEY, "quests", list)
        for (q in list.filter { it.status == "ready" }.take(20)) {
            if (cache.entry(questKey(q.id)) != null) continue
            runCatching { cache.put(questKey(q.id), "quest", ctx.api.quest(q.id)) }
        }
    }
}
