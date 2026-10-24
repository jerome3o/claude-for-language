package dev.jeromeswannack.chineselearning.lab.ui.clips

import android.provider.Settings
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
import dev.jeromeswannack.chineselearning.lab.core.clips.ClipRecord
import dev.jeromeswannack.chineselearning.lab.core.clips.ClipWord
import dev.jeromeswannack.chineselearning.lab.core.clips.Clips
import dev.jeromeswannack.chineselearning.lab.data.api.NewNoteBody
import dev.jeromeswannack.chineselearning.lab.data.api.SentenceChunkDto
import dev.jeromeswannack.chineselearning.lab.data.api.clip
import dev.jeromeswannack.chineselearning.lab.data.api.clipLearnMore
import dev.jeromeswannack.chineselearning.lab.data.api.deleteClip
import dev.jeromeswannack.chineselearning.lab.data.api.generateClips
import dev.jeromeswannack.chineselearning.lab.data.api.retryClip
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.data.audiolessons.ExoMusicTrack
import dev.jeromeswannack.chineselearning.lab.data.bumps.BumpStore
import dev.jeromeswannack.chineselearning.lab.data.clips.ClipStore
import dev.jeromeswannack.chineselearning.lab.ui.explorer.ExplorerData
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
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

/** `/clips` and `/clips/:id?scene=` (web pages/ClipsPage.tsx; docs/CLIPS.md). */
fun NavGraphBuilder.clipsGraph(nav: LabNav) {
    composable(Routes.route("/clips")) { ClipsRoute(nav, null, 0) }
    composable(Routes.route("/clips/{id}?scene={scene}")) { entry ->
        ClipsRoute(nav, entry.arguments?.getString("id"), entry.arguments?.getString("scene")?.toIntOrNull() ?: 0)
    }
}

@Composable
private fun ClipsRoute(nav: LabNav, startId: String?, startScene: Int) {
    val app = nav.app
    val vm: ClipsViewModel = viewModel(key = "clips-${startId ?: ""}", factory = factory { ClipsViewModel(app, startId, startScene) })
    val ui by vm.ui.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val reducedMotion = remember { runCatching { Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f }.getOrDefault(false) }
    var adding by remember { mutableStateOf<ClipWord?>(null) }
    val music = remember { ExoMusicTrack(context).also { it.setVolume(0.12f) } }
    DisposableEffect(Unit) { onDispose { music.release() } }
    ClipsScreen(
        ui,
        ClipsActions(
            onBack = nav::back,
            onActive = vm::active,
            player = { clip ->
                ClipPlayerActions(
                    onLike = { via -> vm.like(clip.id, via) },
                    onSave = { vm.save(clip.id) },
                    onLearnMore = { via -> vm.openSheet(clip.id, via) },
                    onComplete = { ms -> vm.complete(clip, ms) },
                    onQuiz = { right, timeout -> vm.quiz(clip.id, right, timeout) },
                    onExplore = { layout -> app.analytics.track("clips.explore", mapOf("clip" to clip.id, "layout" to layout)) },
                    onPrefs = vm::setPrefs,
                    onPlaying = { playing -> if (playing && !ui.prefs.muted) music.play() else music.pause() },
                    lineAudio = { text, voice -> ClipStore.lineAudio(app, text, voice) },
                    picture = { key -> ClipStore.picture(app, key) },
                )
            },
            onCloseSheet = vm::closeSheet,
            onOffer = { action -> vm.offer(action) { route -> nav.open(route) } },
            onOpenLink = { route -> vm.closeSheet(); nav.open(route) },
            onBumpWord = vm::bump,
            onAddWord = { adding = it },
            onMakeOpen = vm::makeOpen,
            onMake = vm::make,
            onRetry = vm::retry,
            onDelete = vm::delete,
        ),
        animate = !reducedMotion,
    )
    adding?.let { word ->
        val tools = remember(app) { CardTools(app) }
        AddWordSheet(
            SentenceChunkDto(hanzi = word.hanzi, pinyin = word.pinyin, english = word.english),
            AddWordActions(
                decks = { withContext(Dispatchers.IO) { PickerDecks.inQueueOrder(app.repo.dao.decks(), { it.studyPriority }, { it.createdAt }).map { DeckChoice(it.id, it.name, it.description) } } },
                isDuplicate = { deckId, h -> tools.deckHas(deckId, h) },
                add = { deckId, _ -> tools.addNote(deckId, NewNoteBody(word.hanzi, word.pinyin, word.english)) },
            ),
            onDismiss = { adding = null },
            onAdded = { vm.added(word) },
            bumpSource = "other",
        )
    }
}

private inline fun <reified T : ViewModel> factory(crossinline make: () -> T) = object : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <V : ViewModel> create(modelClass: Class<V>): V = make() as V
}

/**
 * The feed: the phone's copy first, then the server's (the order on screen never changes while
 * watching; new clips join at the end), events through the Outbox, the next clip prefetched,
 * clips being written polled, and the Learn more sheet's actions.
 */
class ClipsViewModel(private val app: LabApp, startId: String?, startScene: Int) : ViewModel() {
    private val _ui = MutableStateFlow(ClipsUi(prefs = ClipStore.prefs(app), startId = startId, startScene = startScene, online = app.online.value))
    val ui: StateFlow<ClipsUi> = _ui
    private val viewed = HashSet<String>()
    private val completedIds = HashSet<String>()
    private var lastActive: Pair<String, Long>? = null
    private var poll: Job? = null
    private var lessonPoll: Job? = null
    private var opened = false

    init {
        viewModelScope.launch { app.online.collect { on -> _ui.update { it.copy(online = on) } } }
        viewModelScope.launch {
            val cached = ClipStore.cached(app)
            if (cached != null) _ui.update { it.copy(clips = cached) }
            refresh()
            if (!opened) {
                opened = true
                app.analytics.track("clips.open", mapOf("clips" to (_ui.value.clips?.size ?: 0), "cached" to (cached != null), "offline" to !app.online.value))
            }
        }
    }

    private suspend fun refresh() {
        try {
            val fresh = ClipStore.refresh(app)
            _ui.update { u -> u.copy(clips = merge(u.clips, fresh), offline = false) }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            _ui.update { it.copy(clips = it.clips ?: emptyList(), offline = !app.online.value) }
        }
        if (_ui.value.clips?.any { it.status == "generating" } == true) startPolling()
    }

    /** Keep the order on screen; take the server's rows; new ones at the end. */
    private fun merge(prev: List<ClipRecord>?, fresh: List<ClipRecord>): List<ClipRecord> {
        if (prev.isNullOrEmpty()) return fresh
        val byId = fresh.associateBy { it.id }
        val kept = prev.mapNotNull { byId[it.id] }
        val seen = kept.map { it.id }.toSet()
        return kept + fresh.filter { it.id !in seen }
    }

    private fun startPolling() {
        if (poll?.isActive == true) return
        poll = viewModelScope.launch {
            while (_ui.value.clips?.any { it.status == "generating" } == true) {
                delay(5000)
                if (!app.online.value) continue
                runCatching { ClipStore.refresh(app) }.getOrNull()?.let { fresh -> _ui.update { u -> u.copy(clips = merge(u.clips, fresh)) } }
            }
        }
    }

    private fun update(id: String, f: (ClipRecord) -> ClipRecord) {
        _ui.update { u -> u.copy(clips = u.clips?.map { if (it.id == id) f(it) else it }) }
        viewModelScope.launch { _ui.value.clips?.let { ClipStore.store(app, it) } }
    }

    fun active(index: Int) {
        val clips = _ui.value.clips ?: return
        val clip = clips.getOrNull(index) ?: return
        val prev = lastActive
        if (prev != null && prev.first != clip.id && prev.first !in completedIds && System.currentTimeMillis() - prev.second < 4000) ClipStore.record(app, prev.first, "skip")
        lastActive = clip.id to System.currentTimeMillis()
        if (clip.status == "ready" && clip.spec != null && viewed.add(clip.id)) {
            ClipStore.record(app, clip.id, "view")
            app.analytics.track("clips.view", mapOf("clip" to clip.id, "position" to index + 1, "theme" to clip.spec!!.style.theme, "muted" to _ui.value.prefs.muted))
        }
        clips.drop(index + 1).firstOrNull { it.status == "ready" }?.let { next -> app.scope.launch { runCatching { ClipStore.prefetch(app, next) } } }
    }

    fun like(id: String, via: String) {
        val clip = _ui.value.clips?.firstOrNull { it.id == id } ?: return
        val on = if (via == "double_tap") true else !clip.state.liked
        if (via == "double_tap") ClipStore.record(app, id, "double_tap")
        if (on == clip.state.liked) return
        ClipStore.record(app, id, if (on) "like" else "unlike")
        app.analytics.track("clips.like", mapOf("clip" to id, "on" to on, "via" to via))
        if (on) app.haptics.correct() else app.haptics.tick()
        update(id) { it.copy(state = it.state.copy(liked = on)) }
    }

    fun save(id: String) {
        val clip = _ui.value.clips?.firstOrNull { it.id == id } ?: return
        val on = !clip.state.saved
        ClipStore.record(app, id, if (on) "save" else "unsave")
        app.analytics.track("clips.save", mapOf("clip" to id, "on" to on))
        app.haptics.tick()
        update(id) { it.copy(state = it.state.copy(saved = on)) }
    }

    fun complete(clip: ClipRecord, ms: Long) {
        completedIds += clip.id
        ClipStore.record(app, clip.id, "complete")
        app.analytics.track("clips.complete", mapOf("clip" to clip.id, "duration_ms" to ms, "scenes" to (clip.spec?.scenes?.size ?: 0)))
        update(clip.id) { it.copy(state = it.state.copy(viewed = true, completed = true)) }
    }

    fun quiz(id: String, right: Boolean, timedOut: Boolean) {
        ClipStore.record(app, id, "quiz", if (right) 1 else 0)
        app.analytics.track("clips.quiz_answer", mapOf("clip" to id, "right" to right, "timeout" to timedOut))
        if (right) app.haptics.correct() else if (!timedOut) app.haptics.wrong()
    }

    fun setPrefs(prefs: ClipStore.CaptionPrefs, toggled: String) {
        ClipStore.savePrefs(app, prefs)
        _ui.update { it.copy(prefs = prefs) }
        app.analytics.track("clips.caption_toggle", mapOf("toggle" to toggled, "on" to when (toggled) { "mute" -> prefs.muted; "pinyin" -> prefs.pinyin; else -> prefs.english }))
    }

    // ---------- Learn more ----------

    fun openSheet(id: String, via: String) {
        val clip = _ui.value.clips?.firstOrNull { it.id == id } ?: return
        ClipStore.record(app, id, "learn_more")
        app.analytics.track("clips.learn_more", mapOf("clip" to id, "action" to "open", "via" to via))
        _ui.update { it.copy(sheet = clipSheet(clip)) }
    }

    fun closeSheet() {
        _ui.update { it.copy(sheet = null) }
    }

    private fun sheet(f: (ClipSheetUi) -> ClipSheetUi) = _ui.update { u -> u.copy(sheet = u.sheet?.let(f)) }

    private suspend fun loadWords() {
        val sheet = _ui.value.sheet ?: return
        val rows = sheet.words.map { row ->
            val card = runCatching { ExplorerData.myWord(app, row.word.hanzi).card }.getOrNull()
            row.copy(deck = card?.let { it.deckName.ifBlank { "your decks" } })
        }
        sheet { it.copy(words = rows, showWords = true) }
    }

    fun offer(action: String, open: (String) -> Unit) {
        val sheet = _ui.value.sheet ?: return
        val clip = _ui.value.clips?.firstOrNull { it.id == sheet.clipId } ?: return
        val spec = clip.spec ?: return
        val track = { status: String -> app.analytics.track("clips.learn_more", mapOf("clip" to clip.id, "action" to action, "status" to status)) }
        when (action) {
            "study_words", "add_card" -> viewModelScope.launch {
                loadWords()
                if (action == "study_words") {
                    val have = _ui.value.sheet?.words?.filter { it.deck != null }?.map { it.word.hanzi }.orEmpty()
                    val msg = if (have.isEmpty()) "None of these words are in your decks yet — add them below."
                    else runCatching { BumpStore.bumpHanzi(app, have, "other").message }.getOrElse { it.userMessage() }
                    sheet { s -> s.copy(note = msg, error = false, words = s.words.map { if (it.deck != null) it.copy(bumped = true) else it }) }
                }
                track("open")
            }
            "lesson" -> {
                val lesson = clip.lesson
                if (lesson?.status == "ready" && lesson.lesson_id != null) {
                    track("open")
                    closeSheet()
                    open(Routes.lessonPlay(lesson.lesson_id!!))
                    return
                }
                start(action) {
                    val out = app.repo.api.clipLearnMore(clip.id, "lesson")
                    val l = out.lesson ?: return@start
                    update(clip.id) { it.copy(lesson = l) }
                    track(if (out.started) "started" else if (l.status == "ready") "open" else "writing")
                    if (l.status == "ready" && l.lesson_id != null) {
                        closeSheet()
                        open(Routes.lessonPlay(l.lesson_id!!))
                    } else {
                        sheet { s -> s.copy(offers = Clips.learnMoreOffers(spec, l), note = "✨ Writing your mini lesson (about a minute) — it opens here when it’s ready. It will also be in Mini Lessons.") }
                        pollLesson(clip.id, open)
                    }
                }
            }
            "reader" -> start(action) {
                app.repo.api.clipLearnMore(clip.id, "reader")
                track("started")
                sheet { it.copy(note = "📖 Writing a short story with these words — it will be in Readers in a minute or two.", link = Routes.readers() to "Open Readers") }
            }
            "podcast" -> start(action) {
                val out = app.repo.api.clipLearnMore(clip.id, "podcast")
                track("started")
                sheet { it.copy(note = "🎧 Making a dialogue audio lesson on this — a few minutes. It will be in Audio lessons.", link = out.audio_lesson?.let { a -> Routes.audioLesson(a.id) to "Open it" }) }
            }
            "more" -> start(action) {
                val out = app.repo.api.clipLearnMore(clip.id, "more")
                track("started")
                val made = out.clips.orEmpty()
                _ui.update { u ->
                    val list = u.clips.orEmpty()
                    val at = list.indexOfFirst { it.id == clip.id }
                    u.copy(clips = list.take(at + 1) + made + list.drop(at + 1))
                }
                startPolling()
                sheet { it.copy(note = "🎬 Two more clips on “${Clips.topic(spec)}” are being made — they’ll show up in your feed.") }
            }
        }
    }

    private fun start(action: String, block: suspend () -> Unit) {
        if (!app.online.value) {
            sheet { it.copy(note = "This needs a connection — try again when you are online.", error = true) }
            return
        }
        sheet { it.copy(busy = action, note = null, error = false, link = null) }
        viewModelScope.launch {
            try {
                block()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                sheet { it.copy(note = e.userMessage(), error = true) }
                app.analytics.track("clips.learn_more", mapOf("action" to action, "status" to "failed"))
            } finally {
                sheet { it.copy(busy = null) }
            }
        }
    }

    private fun pollLesson(clipId: String, open: (String) -> Unit) {
        if (lessonPoll?.isActive == true) return
        lessonPoll = viewModelScope.launch {
            while (true) {
                delay(3000)
                if (!app.online.value) continue
                val fresh = runCatching { app.repo.api.clip(clipId) }.getOrNull() ?: continue
                update(clipId) { fresh }
                val l = fresh.lesson ?: continue
                if (l.status == "ready" && l.lesson_id != null) {
                    app.haptics.correct()
                    if (_ui.value.sheet?.clipId == clipId) {
                        closeSheet()
                        open(Routes.lessonPlay(l.lesson_id!!))
                    }
                    break
                }
                if (l.status == "failed") {
                    sheet { it.copy(note = l.error ?: "The lesson couldn’t be written — try again.", error = true, offers = fresh.spec?.let { s -> Clips.learnMoreOffers(s, l) } ?: it.offers) }
                    break
                }
            }
        }
    }

    fun bump(word: ClipWord) {
        viewModelScope.launch {
            val msg = runCatching { BumpStore.bumpHanzi(app, listOf(word.hanzi), "other").message }.getOrElse { it.userMessage() }
            sheet { s -> s.copy(note = msg, error = false, words = s.words.map { if (it.word.hanzi == word.hanzi) it.copy(bumped = true) else it }) }
        }
    }

    fun added(word: ClipWord) {
        app.analytics.track("clips.learn_more", mapOf("action" to "add_card", "status" to "started"))
        sheet { s -> s.copy(words = s.words.map { if (it.word.hanzi == word.hanzi) it.copy(added = true) else it }) }
    }

    // ---------- Making clips ----------

    fun makeOpen(open: Boolean) = _ui.update { it.copy(making = open, makeError = null) }

    fun make(topic: String) {
        _ui.update { it.copy(makeBusy = true, makeError = null) }
        viewModelScope.launch {
            try {
                val made = app.repo.api.generateClips(topic.trim().ifEmpty { null }, 2)
                _ui.update { u ->
                    val list = u.clips.orEmpty()
                    val at = list.indexOfFirst { it.id == lastActive?.first }.coerceAtLeast(-1)
                    u.copy(clips = list.take(at + 1) + made + list.drop(at + 1), making = false)
                }
                startPolling()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _ui.update { it.copy(makeError = e.userMessage()) }
            } finally {
                _ui.update { it.copy(makeBusy = false) }
            }
        }
    }

    fun retry(clip: ClipRecord) {
        viewModelScope.launch {
            runCatching { app.repo.api.retryClip(clip.id) }.getOrNull()?.let { fresh -> update(clip.id) { fresh }; startPolling() }
        }
    }

    fun delete(clip: ClipRecord) {
        viewModelScope.launch {
            runCatching { app.repo.api.deleteClip(clip.id) }
            _ui.update { u -> u.copy(clips = u.clips?.filter { it.id != clip.id }) }
            _ui.value.clips?.let { ClipStore.store(app, it) }
        }
    }
}
