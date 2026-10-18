package dev.jeromeswannack.chineselearning.lab.ui.memereview

import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
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
import dev.jeromeswannack.chineselearning.lab.core.PickerDecks
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerItem
import dev.jeromeswannack.chineselearning.lab.core.memereview.MemeIssue
import dev.jeromeswannack.chineselearning.lab.core.memereview.MemeItem
import dev.jeromeswannack.chineselearning.lab.core.memereview.MemeReview
import dev.jeromeswannack.chineselearning.lab.data.api.MemeIssueStatsDto
import dev.jeromeswannack.chineselearning.lab.data.api.NewNoteBody
import dev.jeromeswannack.chineselearning.lab.data.api.SentenceChunkDto
import dev.jeromeswannack.chineselearning.lab.data.api.generateMemeIssue
import dev.jeromeswannack.chineselearning.lab.data.api.memeLessonJob
import dev.jeromeswannack.chineselearning.lab.data.api.startMemeLesson
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.data.bumps.BumpStore
import dev.jeromeswannack.chineselearning.lab.data.memereview.MemeReviewStore
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
import java.util.Locale

/** `/meme-review` and `/meme-review/:month` (web pages/MemeReviewPage.tsx, MemeIssuePage.tsx; docs/MEME_REVIEW.md). */
fun NavGraphBuilder.memeReviewGraph(nav: LabNav) {
    composable(Routes.route("/meme-review")) {
        val vm: MemeListViewModel = viewModel(factory = factory { MemeListViewModel(nav.app) })
        val ui by vm.ui.collectAsStateWithLifecycle()
        MemeReviewListScreen(ui, MemeListActions(onBack = nav::back, onOpen = { nav.open(Routes.memeIssue(it, "list")) }, onGenerate = vm::generate))
    }
    composable(Routes.route("/meme-review/{month}?from={from}")) { entry ->
        val month = entry.arguments?.getString("month").orEmpty()
        val from = if (entry.arguments?.getString("from") == "list") "list" else "link"
        val app = nav.app
        val vm: MemeIssueViewModel = viewModel(key = "meme-$month", factory = factory { MemeIssueViewModel(app, month, from) })
        val ui by vm.ui.collectAsStateWithLifecycle()
        val explorer = LocalExplorer.current
        val context = LocalContext.current
        var adding by remember { mutableStateOf<MemeItem?>(null) }
        DisposableEffect(Unit) { onDispose { vm.stopAudio() } }
        MemeIssueScreen(
            ui,
            MemeIssueActions(
                onBack = nav::back,
                onToggle = vm::toggle,
                onPlay = vm::play,
                onToggleEnglish = vm::toggleEnglish,
                onToggleIntroEnglish = vm::toggleIntroEnglish,
                onLink = { url, link, kind, platform ->
                    app.analytics.track("meme_review.link_out", mapOf("link" to link, "kind" to kind, "platform" to platform))
                    runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                },
                onRelated = { r -> explorer?.open(ExplorerItem.Word(r.hanzi, r.pinyin.ifBlank { null }, r.english.ifBlank { null }), "meme_review") },
                onAdd = { adding = it },
                onBump = vm::bump,
                onPick = vm::pick,
                onResetQuiz = vm::resetQuiz,
                onMakeLesson = vm::makeLesson,
                onOpenLesson = { id ->
                    app.analytics.track("meme_review.make_lesson", mapOf("status" to "open"))
                    nav.open(Routes.lessonPlay(id))
                },
            ),
        )
        adding?.let { item ->
            val tools = remember(app) { CardTools(app) }
            val card = MemeReview.cardFields(item, month)
            AddWordSheet(
                SentenceChunkDto(hanzi = card.hanzi, pinyin = card.pinyin, english = card.english),
                AddWordActions(
                    decks = { withContext(Dispatchers.IO) { PickerDecks.inQueueOrder(app.repo.dao.decks(), { it.studyPriority }, { it.createdAt }).map { DeckChoice(it.id, it.name, it.description) } } },
                    isDuplicate = { deckId, h -> tools.deckHas(deckId, h) },
                    add = { deckId, _ ->
                        tools.addNote(deckId, NewNoteBody(card.hanzi, card.pinyin, card.english, card.funFacts, card.sentenceClue, card.sentenceCluePinyin, card.sentenceClueTranslation))
                    },
                ),
                onDismiss = { adding = null },
                onAdded = { vm.added(item) },
                bumpSource = "other",
            )
        }
    }
}

private inline fun <reified T : ViewModel> factory(crossinline make: () -> T) = object : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <V : ViewModel> create(modelClass: Class<V>): V = make() as V
}

class MemeListViewModel(private val app: LabApp) : ViewModel() {
    private val _ui = MutableStateFlow(MemeListUi(online = app.online.value))
    val ui: StateFlow<MemeListUi> = _ui
    private var poll: Job? = null

    init {
        viewModelScope.launch { app.online.collect { o -> _ui.update { it.copy(online = o) } } }
        viewModelScope.launch {
            // The phone first (the last list, the issues opened here), then the server.
            val onPhone = MemeReviewStore.onPhone(app)
            val cached = MemeReviewStore.cachedList(app)
            _ui.update { u ->
                u.copy(
                    issues = cached?.issues ?: onPhone.map { r -> offlineSummary(r.issue!!) }.sortedByDescending { it.month },
                    onPhone = onPhone.map { it.month }.toSet(),
                    canGenerate = cached?.can_generate ?: false,
                    currentMonth = cached?.current_month ?: "",
                    loading = app.online.value,
                )
            }
            refresh()
        }
    }

    private fun offlineSummary(issue: MemeIssue) = dev.jeromeswannack.chineselearning.lab.core.memereview.MemeIssueSummary(
        issue.month, "ready", issue.title, issue.title_en, issue.items.size, issue.items.take(4).map { it.hanzi },
    )

    private suspend fun refresh() {
        if (!app.online.value) {
            _ui.update { it.copy(loading = false) }
            return
        }
        val list = runCatching { MemeReviewStore.refreshList(app) }.getOrNull()
        _ui.update { u -> if (list == null) u.copy(loading = false) else u.copy(loading = false, issues = list.issues, canGenerate = list.can_generate, currentMonth = list.current_month) }
        if (list?.issues?.any { it.status == "generating" } == true) startPolling()
    }

    private fun startPolling() {
        if (poll?.isActive == true) return
        poll = viewModelScope.launch {
            while (_ui.value.issues.any { it.status == "generating" }) {
                delay(5000)
                if (app.online.value) runCatching { MemeReviewStore.refreshList(app) }.getOrNull()?.let { l -> _ui.update { it.copy(issues = l.issues) } }
            }
        }
    }

    fun generate() {
        val month = _ui.value.currentMonth.ifEmpty { return }
        _ui.update { it.copy(generating = true, error = null) }
        viewModelScope.launch {
            try {
                app.repo.api.generateMemeIssue(month)
                refresh()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _ui.update { it.copy(error = e.userMessage()) }
            } finally {
                _ui.update { it.copy(generating = false) }
            }
        }
    }
}

class MemeIssueViewModel(private val app: LabApp, private val month: String, private val from: String) : ViewModel() {
    private val _ui = MutableStateFlow(MemeIssueUi(month, online = app.online.value))
    val ui: StateFlow<MemeIssueUi> = _ui
    private val speech = QuestSpeech(app)
    private var opened = false
    private var quizReported = false
    private var poll: Job? = null
    private var lessonPoll: Job? = null

    init {
        viewModelScope.launch { app.online.collect { o -> _ui.update { it.copy(online = o) } } }
        viewModelScope.launch { load() }
    }

    private fun statsLine(s: MemeIssueStatsDto?): String? =
        s?.let { "Admin: ${it.rounds} model calls · ${it.searches} searches · ${it.images} pictures · ≈ $${String.format(Locale.US, "%.2f", it.cost_usd)}" }

    private fun show(issue: MemeIssue, cached: Boolean) {
        _ui.update { it.copy(state = MemeIssueState.Ready(issue), picked = if (it.picked.size != issue.quiz.size) issue.quiz.map { null } else it.picked) }
        if (opened) return
        opened = true
        app.analytics.track("meme_review.open", mapOf("source" to from, "cached" to cached, "items" to issue.items.size))
        viewModelScope.launch {
            MemeReviewStore.cachePictures(app, issue)
            loadPictures(issue)
            speech.prefetch(MemeReview.audioLines(issue))
        }
        viewModelScope.launch { loadPictures(issue) }
    }

    private suspend fun loadPictures(issue: MemeIssue) {
        val files = issue.items.mapNotNull { item -> MemeReviewStore.picture(app, item.picture.image_key)?.let { item.id to it } }.toMap()
        if (files.isNotEmpty()) _ui.update { it.copy(pictures = it.pictures + files) }
    }

    private suspend fun load() {
        if (!MemeReview.isMonth(month)) {
            _ui.update { it.copy(state = MemeIssueState.Missing) }
            return
        }
        val cached = MemeReviewStore.cached(app, month)?.issue
        if (cached != null) show(cached, true)
        if (!app.online.value) {
            if (cached == null) _ui.update { it.copy(state = MemeIssueState.Offline) }
            return
        }
        try {
            val res = MemeReviewStore.fetch(app, month)
            val r = res.issue
            val ready = r.issue
            val lesson = res.lesson
            _ui.update { it.copy(lesson = lesson, stats = statsLine(res.stats)) }
            if (lesson?.status == "generating") pollLesson(lesson.id)
            when {
                r.status == "ready" && ready != null -> show(ready, false)
                cached != null -> Unit
                r.status == "generating" -> { _ui.update { it.copy(state = MemeIssueState.Generating(r.progress)) }; startPolling() }
                r.status == "failed" -> _ui.update { it.copy(state = MemeIssueState.Failed(r.error ?: "This issue didn’t come out.")) }
                else -> _ui.update { it.copy(state = MemeIssueState.Missing) }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (cached == null) _ui.update { it.copy(state = if (app.online.value) MemeIssueState.Failed("Couldn’t load this issue — ${e.userMessage()}") else MemeIssueState.Offline) }
        }
    }

    private fun startPolling() {
        if (poll?.isActive == true) return
        poll = viewModelScope.launch {
            while (_ui.value.state is MemeIssueState.Generating) {
                delay(5000)
                if (!app.online.value) continue
                val res = runCatching { MemeReviewStore.fetch(app, month) }.getOrNull() ?: continue
                val r = res.issue
                val ready = r.issue
                when {
                    r.status == "ready" && ready != null -> { app.haptics.correct(); show(ready, false) }
                    r.status == "generating" -> _ui.update { it.copy(state = MemeIssueState.Generating(r.progress)) }
                    r.status == "failed" -> _ui.update { it.copy(state = MemeIssueState.Failed(r.error ?: "This issue didn’t come out.")) }
                }
            }
        }
    }

    // ── cards ──
    fun toggle(item: MemeItem, index: Int) {
        val opening = _ui.value.openId != item.id
        app.haptics.tick()
        _ui.update { it.copy(openId = if (opening) item.id else null, bumped = null) }
        if (!opening) return
        app.analytics.track("meme_review.item_open", mapOf("item" to item.id, "position" to index + 1))
        viewModelScope.launch {
            val card = runCatching { ExplorerData.myWord(app, item.hanzi).card }.getOrNull()
            if (card != null) _ui.update { it.copy(cards = it.cards + (item.id to card.deckName.ifBlank { "your decks" })) }
        }
    }

    fun toggleEnglish(id: String) = _ui.update { it.copy(english = if (id in it.english) it.english - id else it.english + id) }
    fun toggleIntroEnglish() = _ui.update { it.copy(introEnglish = !it.introEnglish) }

    fun added(item: MemeItem) {
        app.haptics.correct()
        app.analytics.track("meme_review.add_card", mapOf("item" to item.id))
        _ui.update { it.copy(added = it.added + item.id) }
    }

    fun bump(item: MemeItem) {
        viewModelScope.launch {
            val msg = runCatching { BumpStore.bumpHanzi(app, listOf(item.hanzi), "other", _ui.value.cards[item.id]).message }.getOrElse { it.userMessage() }
            app.haptics.tick()
            _ui.update { it.copy(bumped = msg) }
        }
    }

    // ── audio ──
    fun play(key: String, text: String) {
        if (_ui.value.playing == key) return stopAudio()
        _ui.update { it.copy(playing = key) }
        speech.speak(text) { _ui.update { u -> if (u.playing == key) u.copy(playing = null) else u } }
    }

    fun stopAudio() {
        speech.release()
        _ui.update { it.copy(playing = null) }
    }

    // ── quiz (practice only: one analytics event) ──
    fun pick(q: Int, o: Int) {
        val issue = (_ui.value.state as? MemeIssueState.Ready)?.issue ?: return
        val picked = _ui.value.picked.takeIf { it.size == issue.quiz.size } ?: issue.quiz.map { null }
        if (picked[q] != null) return
        val next = picked.toMutableList().also { it[q] = o }
        if (o == issue.quiz[q].answer) { app.sounds.play(dev.jeromeswannack.chineselearning.lab.fx.Sounds.Sfx.CORRECT); app.haptics.correct() }
        else { app.sounds.play(dev.jeromeswannack.chineselearning.lab.fx.Sounds.Sfx.WRONG); app.haptics.wrong() }
        _ui.update { it.copy(picked = next) }
        if (next.all { it != null } && !quizReported) {
            quizReported = true
            val correct = next.withIndex().count { (i, p) -> p == issue.quiz[i].answer }
            if (correct == issue.quiz.size) app.haptics.celebrate()
            app.analytics.track("meme_review.quiz_finish", mapOf("correct" to correct, "total" to issue.quiz.size))
        }
    }

    fun resetQuiz() {
        quizReported = false
        _ui.update { u -> u.copy(picked = u.picked.map { null }) }
    }

    // ── "Make a mini lesson from this issue" (in his own account) ──
    fun makeLesson() {
        _ui.update { it.copy(lessonBusy = true, lessonError = null) }
        viewModelScope.launch {
            try {
                val job = app.repo.api.startMemeLesson(month)
                app.analytics.track("meme_review.make_lesson", mapOf("status" to if (job.status == "generating") "started" else "writing"))
                _ui.update { it.copy(lesson = job) }
                if (job.status == "generating") pollLesson(job.id)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _ui.update { it.copy(lessonError = e.userMessage()) }
            } finally {
                _ui.update { it.copy(lessonBusy = false) }
            }
        }
    }

    private fun pollLesson(jobId: String) {
        if (lessonPoll?.isActive == true) return
        lessonPoll = viewModelScope.launch {
            while (_ui.value.lesson?.status == "generating") {
                delay(4000)
                if (!app.online.value) continue
                val job = runCatching { app.repo.api.memeLessonJob(jobId) }.getOrNull() ?: continue
                if (job.status == "ready") app.haptics.correct()
                _ui.update { it.copy(lesson = job) }
            }
        }
    }

    override fun onCleared() {
        speech.release()
        super.onCleared()
    }
}
