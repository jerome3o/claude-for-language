package dev.jeromeswannack.chineselearning.lab.ui.readers

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.produceState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.data.anki.AnkiExportTarget
import dev.jeromeswannack.chineselearning.lab.data.api.GenerateReaderBody
import dev.jeromeswannack.chineselearning.lab.data.api.GradedReaderDto
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderPageDto
import dev.jeromeswannack.chineselearning.lab.data.api.generateReader
import dev.jeromeswannack.chineselearning.lab.data.api.markDailyReader
import dev.jeromeswannack.chineselearning.lab.data.api.reader
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.data.lessons.LessonRuntime
import dev.jeromeswannack.chineselearning.lab.data.readers.ReaderStore
import dev.jeromeswannack.chineselearning.lab.ui.editor.rememberReaderImporter
import dev.jeromeswannack.chineselearning.lab.ui.kit.AnkiExportSheet
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** Package B routes: `/readers`, `/readers/generate`, `/readers/:id`. */
fun NavGraphBuilder.readersGraph(nav: LabNav) {
    composable(Routes.route("/readers")) {
        val vm: ReadersViewModel = viewModel(factory = factory { ReadersViewModel(nav.app) })
        val ui by vm.ui.collectAsStateWithLifecycle()
        var message by remember { mutableStateOf<String?>(null) }
        var anki by remember { mutableStateOf<AnkiExportTarget?>(null) }
        val importReader = rememberReaderImporter(nav) { message = it }
        AnkiExportSheet(anki) { anki = null }
        ReadersListScreen(
            ui.copy(message = message),
            ReadersActions(
                onBack = nav::back,
                onOpen = { nav.open(Routes.reader(it)) },
                onEdit = { nav.open(Routes.readerEdit(it)) },
                onGenerate = { nav.open("/readers/generate") },
                onCreate = { nav.open(Routes.readerEdit("new")) },
                onDelete = vm::delete,
                onRetry = vm::retry,
                onDeleteAllFailed = vm::deleteAllFailed,
                onRefresh = vm::refresh,
                onImport = { message = null; importReader() },
                onAnki = { r -> anki = AnkiExportTarget.Reader(r.id, r.titleChinese) },
                onDismissMessage = { message = null },
            ),
        )
    }
    composable(Routes.route("/readers/generate")) {
        val vm: GenerateReaderViewModel = viewModel(factory = factory { GenerateReaderViewModel(nav.app) })
        val ui by vm.ui.collectAsStateWithLifecycle()
        GenerateReaderScreen(
            ui,
            GenerateActions(
                onBack = nav::back,
                onSource = vm::source,
                onToggleDeck = vm::toggle,
                onSelectAll = vm::selectAll,
                onClear = vm::clear,
                onTopic = vm::topic,
                onDifficulty = vm::difficulty,
                onGenerate = { vm.generate { nav.back() } },
            ),
        )
    }
    composable(Routes.route("/readers/{id}")) { entry ->
        val id = entry.arguments?.getString("id").orEmpty()
        val vm: ReaderViewModel = viewModel(key = "reader-$id", factory = factory { ReaderViewModel(nav.app, id) })
        val state by vm.state.collectAsStateWithLifecycle()
        val env = rememberReaderEnv(nav.app, id)
        var anki by remember { mutableStateOf<AnkiExportTarget?>(null) }
        AnkiExportSheet(anki) { anki = null }
        ReaderScreen(
            state.first, state.second, env,
            onBack = nav::back,
            onEdit = { nav.open(Routes.readerEdit(id)) },
            onFinish = { vm.finish(); nav.app.haptics.celebrate(); nav.back() },
            onAnki = { state.first?.let { r -> anki = AnkiExportTarget.Reader(r.id, r.titleChinese) } },
        )
    }
}

private inline fun <reified V : ViewModel> factory(crossinline make: () -> V) = object : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T = make() as T
}

/**
 * Illustrations (generated on demand), narration and word chips for one reader, from the shared
 * runtime. Every reading view has the chips — the reading page, Today's story, the in-session
 * reader and homework — so a tapped word always opens the word sheet.
 */
@Composable
fun rememberReaderEnv(app: LabApp, readerId: String): ReaderEnv {
    val runtime = remember(app) { LessonRuntime.of(app) }
    val playing by runtime.audio.playing.collectAsState()
    val clips = remember(app) { dev.jeromeswannack.chineselearning.lab.data.readers.ReaderClipAnalyzer(app.cache) }
    DisposableEffect(readerId) { onDispose { runtime.audio.stop() } }
    var knownVersion by remember { mutableStateOf(0) }
    val known by produceState(emptySet<String>(), knownVersion) {
        value = withContext(Dispatchers.IO) { app.repo.dao.allNotes().mapTo(HashSet()) { it.hanzi.trim() } }
    }
    var tapped by remember { mutableStateOf<Pair<dev.jeromeswannack.chineselearning.lab.data.api.ReaderWordDto, String>?>(null) }
    tapped?.let { (w, sentence) ->
        val tools = remember(app) { dev.jeromeswannack.chineselearning.lab.ui.study.CardTools(app) }
        ReaderWordSheet(
            w,
            sentence,
            known = w.text in known,
            actions = ReaderWordActions(
                online = { app.online.value },
                play = { text -> runtime.audio.speak(text) },
                cachedExplanation = { word, s -> runtime.readers.cachedExplanation(word.text, s) },
                explain = { word, s -> runtime.readers.explainWord(word.text, s, word.pinyin, word.gloss) },
                decks = { dev.jeromeswannack.chineselearning.lab.core.PickerDecks.inQueueOrder(app.repo.dao.decks(), { it.studyPriority }, { it.createdAt }).map { DeckChoice(it.id, it.name, it.description) } },
                isDuplicate = { deckId, hanzi -> tools.deckHas(deckId, hanzi) },
                add = { deckId, word, ex -> tools.addNote(deckId, readerWordNote(word, ex)) },
            ),
            onDismiss = { tapped = null },
            onAdded = { app.haptics.correct(); knownVersion++ },
        )
    }
    return ReaderEnv(
        words = { page -> runtime.readers.words(readerId, page, app.online.value) },
        known = known,
        onWord = { w, sentence -> tapped = w to sentence; app.haptics.tick() },
        pageAudio = { page, regenerate -> runtime.audio.stop(); runtime.readers.pageAudio(page, app.online.value, regenerate) },
        analyze = { page, file -> clips.analyze(runtime.readers.pageTtsKey(page).removePrefix("reader-tts/"), file) },
        image = { page -> runtime.readers.pageImage(readerId, page, app.online.value) },
        cachedImage = { page -> runtime.media.cachedImage(page.imageUrl) },
        togglePlay = { page -> togglePage(app, runtime, page) },
        playingPage = playing?.takeIf { it.startsWith(PAGE_PREFIX) }?.removePrefix(PAGE_PREFIX),
        onTap = { app.haptics.tick() },
    )
}

private const val PAGE_PREFIX = "reader-page:"

private fun togglePage(app: LabApp, runtime: LessonRuntime, page: ReaderPageDto) {
    val label = PAGE_PREFIX + page.id
    if (runtime.audio.playing.value == label) { runtime.audio.stop(); return }
    app.scope.launch {
        val file = runtime.readers.pageAudio(page, app.online.value)
        if (file != null) runtime.audio.playFileFor(label, file) else runtime.audio.speak(page.contentChinese)
    }
}

class ReadersViewModel(private val app: LabApp) : ViewModel() {
    private val store = LessonRuntime.of(app).readers
    private val _ui = MutableStateFlow(ReadersUi())
    val ui: StateFlow<ReadersUi> = _ui.asStateFlow()
    private var poll: Job? = null

    init {
        viewModelScope.launch {
            store.observe().collect { list ->
                if (list.isNotEmpty() || store.hasCache()) {
                    _ui.update { it.copy(readers = list.map { e -> e.reader }.sortedByDescending { r -> r.createdAt }, updatedAt = app.cache.updatedAt(ReaderStore.LIST)) }
                    // Poll every 3 s while a story is being written.
                    if (list.any { it.reader.status == "generating" }) startPolling()
                }
            }
        }
        refresh()
    }

    private fun startPolling() {
        if (poll?.isActive == true) return
        poll = viewModelScope.launch {
            while (_ui.value.readers.orEmpty().any { it.status == "generating" } && app.online.value) {
                delay(3_000)
                runCatching { store.refresh() }
            }
        }
    }

    fun refresh() {
        viewModelScope.launch {
            if (!app.online.value) {
                _ui.update { it.copy(offline = true, readers = it.readers ?: emptyList()) }
                return@launch
            }
            try {
                store.refresh()
                _ui.update { it.copy(offline = false, error = null) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _ui.update { it.copy(error = e.userMessage(), readers = it.readers ?: emptyList()) }
            }
        }
    }

    private fun busy(id: String, on: Boolean) = _ui.update { it.copy(busy = if (on) it.busy + id else it.busy - id) }

    fun delete(id: String) = viewModelScope.launch {
        busy(id, true)
        try { store.delete(id); app.haptics.tick() } catch (e: CancellationException) { throw e } catch (e: Exception) { _ui.update { it.copy(error = "Couldn't delete that story. Please try again.") } }
        busy(id, false)
    }.let { }

    fun retry(id: String) = viewModelScope.launch {
        busy(id, true)
        try { store.retry(id); startPolling() } catch (e: CancellationException) { throw e } catch (e: Exception) { _ui.update { it.copy(error = "Couldn't retry: ${e.userMessage()}") } }
        busy(id, false)
    }.let { }

    fun deleteAllFailed() = viewModelScope.launch {
        val failed = _ui.value.readers.orEmpty().filter { it.status == "failed" }
        _ui.update { it.copy(deletingAll = true) }
        var failures = 0
        for (r in failed) if (runCatching { store.delete(r.id) }.isFailure) failures++
        _ui.update { it.copy(deletingAll = false, error = if (failures > 0) "$failures of ${failed.size} couldn't be deleted. Try again." else null) }
    }.let { }
}

class GenerateReaderViewModel(private val app: LabApp) : ViewModel() {
    private val _ui = MutableStateFlow(GenerateUi(online = app.online.value))
    val ui: StateFlow<GenerateUi> = _ui.asStateFlow()

    init {
        viewModelScope.launch {
            val decks = app.repo.dao.decks().sortedBy { it.name.lowercase() }.map { DeckChoice(it.id, it.name, it.description) }
            _ui.update { it.copy(decks = decks) }
            val due = dev.jeromeswannack.chineselearning.lab.data.readers.DueWords.noteIds(app)
            _ui.update { it.copy(dueWords = due.size) }
        }
        viewModelScope.launch { app.online.collect { o -> _ui.update { it.copy(online = o) } } }
    }

    fun source(s: String) = _ui.update { it.copy(source = s) }
    fun toggle(id: String) = _ui.update { it.copy(selected = if (id in it.selected) it.selected - id else it.selected + id) }
    fun selectAll() = _ui.update { it.copy(selected = it.decks.mapTo(HashSet()) { d -> d.id }) }
    fun clear() = _ui.update { it.copy(selected = emptySet()) }
    fun topic(t: String) = _ui.update { it.copy(topic = t) }
    fun difficulty(d: String) = _ui.update { it.copy(difficulty = d) }

    fun generate(onStarted: () -> Unit) {
        val u = _ui.value
        if (!u.canGenerate) return
        _ui.update { it.copy(submitting = true, error = null) }
        viewModelScope.launch {
            try {
                val body = if (u.source == "due_cards") {
                    GenerateReaderBody(source = "due_cards", noteIds = dev.jeromeswannack.chineselearning.lab.data.readers.DueWords.noteIds(app), topic = u.topic.ifBlank { null }, difficulty = u.difficulty)
                } else {
                    GenerateReaderBody(deckIds = u.selected.toList(), topic = u.topic.ifBlank { null }, difficulty = u.difficulty)
                }
                app.repo.api.generateReader(body)
                runCatching { LessonRuntime.of(app).readers.refresh() }
                app.haptics.tick()
                onStarted()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _ui.update { it.copy(submitting = false, error = e.userMessage().ifBlank { "Couldn't start the story. Please try again." }) }
            }
        }
    }
}

/** One reader: the cached copy (with pages), refreshed from the server; polls while generating. */
class ReaderViewModel(private val app: LabApp, private val id: String) : ViewModel() {
    private val store = LessonRuntime.of(app).readers
    private val _state = MutableStateFlow<Pair<GradedReaderDto?, String?>>(null to null)
    val state: StateFlow<Pair<GradedReaderDto?, String?>> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            store.entry(id)?.let { _state.value = it.reader to null }
            while (true) {
                if (!app.online.value) {
                    if (_state.value.first == null) _state.value = null to "This story isn't on the phone yet — open it again when you're online."
                    break
                }
                try {
                    val r = app.repo.api.reader(id)
                    val cached = _state.value.first
                    // Keep illustrations generated on this phone that the server copy doesn't list yet.
                    _state.value = (if (cached != null) r.copy(pages = r.pages.map { p -> p.copy(imageUrl = p.imageUrl ?: cached.pages.firstOrNull { it.id == p.id }?.imageUrl) }) else r) to null
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    if (_state.value.first == null) _state.value = null to "Failed to load reader. ${e.userMessage()}"
                    break
                }
                val r = _state.value.first ?: break
                if (r.status != "generating" && r.pages.isNotEmpty()) break
                delay(3_000)
            }
        }
    }

    /** Finish marks the day's reader activity (best effort). */
    fun finish() {
        if (app.online.value) app.scope.launch { runCatching { app.repo.api.markDailyReader(id) } }
    }
}
