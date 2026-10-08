package dev.jeromeswannack.chineselearning.lab.ui.idioms

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.PickerDecks
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerItem
import dev.jeromeswannack.chineselearning.lab.core.idioms.IdiomEntry
import dev.jeromeswannack.chineselearning.lab.core.idioms.IdiomRecord
import dev.jeromeswannack.chineselearning.lab.core.idioms.IdiomSummary
import dev.jeromeswannack.chineselearning.lab.core.idioms.Idioms
import dev.jeromeswannack.chineselearning.lab.data.HttpException
import dev.jeromeswannack.chineselearning.lab.data.api.NewNoteBody
import dev.jeromeswannack.chineselearning.lab.data.api.SentenceChunkDto
import dev.jeromeswannack.chineselearning.lab.data.api.serverMessage
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.data.bumps.BumpStore
import dev.jeromeswannack.chineselearning.lab.data.idioms.IdiomStore
import dev.jeromeswannack.chineselearning.lab.ui.explorer.ExplorerData
import dev.jeromeswannack.chineselearning.lab.ui.explorer.LocalExplorer
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import dev.jeromeswannack.chineselearning.lab.ui.quests.QuestSpeech
import dev.jeromeswannack.chineselearning.lab.ui.readers.AddWordActions
import dev.jeromeswannack.chineselearning.lab.ui.readers.AddWordSheet
import dev.jeromeswannack.chineselearning.lab.ui.readers.DeckChoice
import dev.jeromeswannack.chineselearning.lab.ui.study.CardTools
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** `/idioms` and `/idioms/:hanzi` (web pages/IdiomsPage.tsx, IdiomPage.tsx; docs/IDIOMS.md). */
fun NavGraphBuilder.idiomsGraph(nav: LabNav) {
    composable(Routes.route("/idioms")) {
        val vm: IdiomsViewModel = viewModel(factory = factory { IdiomsViewModel(nav.app) })
        val ui by vm.ui.collectAsStateWithLifecycle()
        IdiomsScreen(
            ui,
            IdiomsActions(
                onBack = nav::back,
                onQuery = vm::setQuery,
                onLookUp = { vm.lookUp()?.let { nav.open(Routes.idiom(it, "search")) } },
                onOpen = { nav.open(Routes.idiom(it, "list")) },
            ),
        )
    }
    composable(Routes.route("/idioms/{hanzi}?from={from}")) { entry ->
        val hanzi = Idioms.normalize(entry.arguments?.getString("hanzi").orEmpty())
        val from = entry.arguments?.getString("from")?.takeIf { it.isNotBlank() } ?: "list"
        val app = nav.app
        val vm: IdiomViewModel = viewModel(key = "idiom-$hanzi", factory = factory { IdiomViewModel(app, hanzi, from) })
        val ui by vm.ui.collectAsStateWithLifecycle()
        val explorer = LocalExplorer.current
        var adding by remember { mutableStateOf<IdiomEntry?>(null) }
        DisposableEffect(Unit) { onDispose { vm.stopAudio() } }
        IdiomScreen(
            ui,
            IdiomActions(
                onBack = nav::back,
                onPlay = vm::play,
                onPlayStory = vm::playStory,
                onTogglePinyin = vm::togglePinyin,
                onToggleEnglish = vm::toggleEnglish,
                onPeek = vm::peek,
                onReveal = vm::reveal,
                onPick = vm::pick,
                onResetQuiz = vm::resetQuiz,
                onChar = { explorer?.open(ExplorerItem.Char(it), "idioms") },
                onRef = { nav.open(Routes.idiom(it, "related")) },
                onAdd = { (ui.state as? IdiomState.Ready)?.let { adding = it.entry } },
                onBump = vm::bump,
                onOpenCard = { nav.open(Routes.cardHub(it)) },
                onRetry = vm::retry,
            ),
        )
        adding?.let { e ->
            val tools = remember(app) { CardTools(app) }
            val card = Idioms.cardFields(e)
            AddWordSheet(
                SentenceChunkDto(hanzi = card.hanzi, pinyin = card.pinyin, english = card.english),
                AddWordActions(
                    decks = { withContext(Dispatchers.IO) { PickerDecks.inQueueOrder(app.repo.dao.decks(), { it.studyPriority }, { it.createdAt }).map { DeckChoice(it.id, it.name, it.description) } } },
                    isDuplicate = { deckId, h -> tools.deckHas(deckId, h) },
                    add = { deckId, _ ->
                        tools.addNote(
                            deckId,
                            NewNoteBody(card.hanzi, card.pinyin, card.english, card.funFacts, card.sentenceClue, card.sentenceCluePinyin, card.sentenceClueTranslation),
                        )
                    },
                ),
                onDismiss = { adding = null },
                onAdded = { vm.added() },
                bumpSource = "idioms",
            )
        }
    }
}

private inline fun <reified T : ViewModel> factory(crossinline make: () -> T) = object : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <V : ViewModel> create(modelClass: Class<V>): V = make() as V
}

class IdiomsViewModel(private val app: LabApp) : ViewModel() {
    private val _ui = MutableStateFlow(IdiomsUi(online = app.online.value))
    val ui: StateFlow<IdiomsUi> = _ui

    init {
        viewModelScope.launch {
            // The phone first: the last server list + what was opened here, then the server.
            val opened = IdiomStore.opened(app)
            val cachedList = IdiomStore.cachedList(app)
            apply(cachedList?.starter, cachedList?.more, opened)
            if (app.online.value) {
                runCatching { IdiomStore.refreshList(app) }.getOrNull()?.let { apply(it.starter, it.more, opened) }
            }
        }
        viewModelScope.launch { app.online.collect { o -> _ui.update { it.copy(online = o) } } }
    }

    private fun apply(starter: List<IdiomSummary>?, more: List<IdiomSummary>?, opened: List<IdiomRecord>) {
        val onDevice = opened.map { it.hanzi }.toSet()
        _ui.update { u ->
            u.copy(
                starter = (starter ?: u.starter).map { if (it.hanzi in onDevice) it.copy(status = "ready") else it },
                more = more ?: u.more,
                opened = opened.filter { !Idioms.isStarter(it.hanzi) && it.entry != null }.map { IdiomSummary(it.hanzi, it.entry!!.pinyin, it.entry!!.meaning, "ready", false) },
                onDevice = onDevice,
            )
        }
    }

    fun setQuery(q: String) = _ui.update { it.copy(query = q, problem = null) }

    /** The key to open, or null (the problem is shown). */
    fun lookUp(): String? {
        val q = _ui.value.query
        val problem = Idioms.keyProblem(q)
        _ui.update { it.copy(problem = problem) }
        return if (problem == null) Idioms.normalize(q) else null
    }
}

class IdiomViewModel(private val app: LabApp, private val hanzi: String, private val from: String) : ViewModel() {
    private val prefs = app.getSharedPreferences("idioms", Context.MODE_PRIVATE)
    private val _ui = MutableStateFlow(
        IdiomUi(hanzi, showPinyin = prefs.getBoolean("pinyin", false), showEnglish = prefs.getBoolean("english", false), online = app.online.value),
    )
    val ui: StateFlow<IdiomUi> = _ui
    private val speech = QuestSpeech(app)
    private var poll: Job? = null
    private var openedTracked = false
    private var quizReported = false
    private var storyJob: Job? = null

    init {
        viewModelScope.launch { app.online.collect { o -> _ui.update { it.copy(online = o) } } }
        viewModelScope.launch { load() }
        viewModelScope.launch { loadCard() }
    }

    private suspend fun loadCard() {
        val card = runCatching { ExplorerData.myWord(app, hanzi).card }.getOrNull()
        _ui.update { it.copy(card = card?.let { c -> IdiomCard(c.noteId, c.deckName) } ?: IdiomCard("", ""), cardLoaded = true) }
    }

    private fun stateOf(r: IdiomRecord): IdiomState? = when (r.status) {
        "ready" -> r.entry?.let { IdiomState.Ready(it) }
        "generating" -> IdiomState.Generating
        "not_idiom" -> IdiomState.NotIdiom(r.error.orEmpty(), r.suggestion)
        "failed" -> IdiomState.Failed(r.error ?: "Something went wrong — try again.")
        else -> null
    }

    private fun show(s: IdiomState, cached: Boolean) {
        _ui.update { it.copy(state = s, picked = if (s is IdiomState.Ready && it.picked.size != s.entry.quiz.size) s.entry.quiz.map { null } else it.picked) }
        if (s is IdiomState.Ready && !openedTracked) {
            openedTracked = true
            app.analytics.track("idioms.open", mapOf("source" to from, "cached" to cached))
            viewModelScope.launch {
                IdiomStore.markOpened(app, IdiomRecord(s.entry.hanzi, "ready", s.entry))
                speech.prefetch(listOf(s.entry.hanzi) + s.entry.origin.story.map { it.hanzi })
            }
        }
        if (s is IdiomState.Generating) startPolling()
    }

    private suspend fun load() {
        val cached = IdiomStore.cached(app, hanzi)?.let(::stateOf)
        if (cached is IdiomState.Ready) show(cached, true)
        if (!app.online.value) {
            if (cached !is IdiomState.Ready) _ui.update { it.copy(state = IdiomState.Offline) }
            return
        }
        try {
            var r = IdiomStore.fetch(app, hanzi)
            if (r.status == "missing") r = IdiomStore.start(app, hanzi)
            val s = stateOf(r)
            if (s != null && !(s !is IdiomState.Ready && cached is IdiomState.Ready)) show(s, false)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (cached is IdiomState.Ready) return
            val code = (e as? HttpException)?.code
            _ui.update {
                it.copy(
                    state = when {
                        code == 503 || code == 400 -> IdiomState.Unavailable((e as HttpException).serverMessage() ?: "Idioms aren’t available right now.")
                        !app.online.value || (e is java.io.IOException && e !is HttpException) -> IdiomState.Offline
                        else -> IdiomState.Failed("Couldn’t load this idiom — ${e.userMessage()}")
                    },
                )
            }
        }
    }

    private fun startPolling() {
        if (poll?.isActive == true) return
        poll = viewModelScope.launch {
            val started = System.currentTimeMillis()
            while (_ui.value.state == IdiomState.Generating) {
                delay(2500)
                if (System.currentTimeMillis() - started > 4 * 60_000) {
                    _ui.update { it.copy(state = IdiomState.Failed("This is taking too long — try again.")) }
                    break
                }
                if (!app.online.value) continue
                val r = runCatching { IdiomStore.fetch(app, hanzi) }.getOrNull() ?: continue
                val s = stateOf(r)
                if (s != null && s != IdiomState.Generating) {
                    if (s is IdiomState.Ready) app.haptics.correct()
                    show(s, false)
                }
            }
        }
    }

    fun retry() {
        _ui.update { it.copy(retrying = true) }
        viewModelScope.launch {
            try {
                stateOf(IdiomStore.start(app, hanzi, retry = true))?.let { show(it, false) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _ui.update { it.copy(state = IdiomState.Failed(e.userMessage())) }
            } finally {
                _ui.update { it.copy(retrying = false) }
            }
        }
    }

    // ── audio ──
    fun play(key: String, text: String) {
        storyJob?.cancel()
        if (_ui.value.playing == key) return stopAudio()
        _ui.update { it.copy(playing = key) }
        speech.speak(text) { _ui.update { u -> if (u.playing == key) u.copy(playing = null) else u } }
    }

    fun playStory() {
        val entry = (_ui.value.state as? IdiomState.Ready)?.entry ?: return
        if (_ui.value.playing?.startsWith("story") == true) return stopAudio()
        storyJob?.cancel()
        storyJob = viewModelScope.launch {
            for ((i, p) in entry.origin.story.withIndex()) {
                val done = kotlinx.coroutines.CompletableDeferred<Unit>()
                _ui.update { it.copy(playing = "story:$i") }
                speech.speak(p.hanzi) { done.complete(Unit) }
                done.await()
                if (_ui.value.playing != "story:$i") return@launch
            }
            _ui.update { it.copy(playing = null) }
        }
    }

    fun stopAudio() {
        storyJob?.cancel()
        speech.release()
        _ui.update { it.copy(playing = null) }
    }

    // ── reading ──
    fun togglePinyin() = _ui.update { it.copy(showPinyin = !it.showPinyin).also { u -> prefs.edit().putBoolean("pinyin", u.showPinyin).apply() } }
    fun toggleEnglish() = _ui.update { it.copy(showEnglish = !it.showEnglish).also { u -> prefs.edit().putBoolean("english", u.showEnglish).apply() } }
    fun peek(i: Int) = _ui.update { it.copy(peek = if (i in it.peek) it.peek - i else it.peek + i) }

    fun reveal(i: Int) {
        val entry = (_ui.value.state as? IdiomState.Ready)?.entry ?: return
        val line = entry.usage.examples.getOrNull(i) ?: return
        app.haptics.tick()
        _ui.update { it.copy(revealed = it.revealed + (i to nextExampleStep(line, it.revealed[i] ?: 0))) }
    }

    // ── Try it (practice only: one analytics event) ──
    fun pick(q: Int, o: Int) {
        val entry = (_ui.value.state as? IdiomState.Ready)?.entry ?: return
        val picked = _ui.value.picked.takeIf { it.size == entry.quiz.size } ?: entry.quiz.map { null }
        if (picked[q] != null) return
        val next = picked.toMutableList().also { it[q] = o }
        if (o == entry.quiz[q].answer) { app.sounds.play(dev.jeromeswannack.chineselearning.lab.fx.Sounds.Sfx.CORRECT); app.haptics.correct() }
        else { app.sounds.play(dev.jeromeswannack.chineselearning.lab.fx.Sounds.Sfx.WRONG); app.haptics.wrong() }
        _ui.update { it.copy(picked = next) }
        if (next.all { it != null } && !quizReported) {
            quizReported = true
            val correct = next.withIndex().count { (i, p) -> p == entry.quiz[i].answer }
            if (correct == entry.quiz.size) app.haptics.celebrate()
            app.analytics.track("idioms.quiz", mapOf("correct" to correct, "total" to entry.quiz.size))
        }
    }

    fun resetQuiz() {
        quizReported = false
        _ui.update { u -> u.copy(picked = u.picked.map { null }) }
    }

    // ── the card ──
    fun added() {
        app.haptics.correct()
        app.analytics.track("idioms.add_card", emptyMap())
        _ui.update { it.copy(added = true) }
        viewModelScope.launch { loadCard() }
    }

    fun bump() {
        val deck = _ui.value.card?.deckName?.ifBlank { null }
        viewModelScope.launch {
            val msg = runCatching { BumpStore.bumpHanzi(app, listOf(hanzi), "idioms", deck).message }.getOrElse { it.userMessage() }
            app.haptics.tick()
            _ui.update { it.copy(bumped = msg) }
        }
    }

    override fun onCleared() {
        speech.release()
        super.onCleared()
    }
}
