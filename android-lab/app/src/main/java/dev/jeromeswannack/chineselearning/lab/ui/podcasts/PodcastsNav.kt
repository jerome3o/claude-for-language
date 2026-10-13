package dev.jeromeswannack.chineselearning.lab.ui.podcasts

import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
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
import dev.jeromeswannack.chineselearning.lab.core.CoachActions
import dev.jeromeswannack.chineselearning.lab.core.CoachBreakdownWord
import dev.jeromeswannack.chineselearning.lab.core.CoachNewWords
import dev.jeromeswannack.chineselearning.lab.core.PickerDecks
import dev.jeromeswannack.chineselearning.lab.core.ReaderWords
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerStack
import dev.jeromeswannack.chineselearning.lab.core.podcasts.Podcasts
import dev.jeromeswannack.chineselearning.lab.data.HttpException
import dev.jeromeswannack.chineselearning.lab.data.api.EnrichWordIn
import dev.jeromeswannack.chineselearning.lab.data.api.FeedEpisodeDto
import dev.jeromeswannack.chineselearning.lab.data.api.GlossWordIn
import dev.jeromeswannack.chineselearning.lab.data.api.NewNoteBody
import dev.jeromeswannack.chineselearning.lab.data.api.PodcastEpisodeDto
import dev.jeromeswannack.chineselearning.lab.data.api.PodcastFeedViewDto
import dev.jeromeswannack.chineselearning.lab.data.api.PodcastSegmentDto
import dev.jeromeswannack.chineselearning.lab.data.api.PodcastsHomeDto
import dev.jeromeswannack.chineselearning.lab.data.api.addNotesBatch
import dev.jeromeswannack.chineselearning.lab.data.api.enrichWords
import dev.jeromeswannack.chineselearning.lab.data.api.forgetPodcastEpisode
import dev.jeromeswannack.chineselearning.lab.data.api.glossWords
import dev.jeromeswannack.chineselearning.lab.data.api.makePodcastLesson
import dev.jeromeswannack.chineselearning.lab.data.api.podcastFeedView
import dev.jeromeswannack.chineselearning.lab.data.api.podcastsHome
import dev.jeromeswannack.chineselearning.lab.data.api.retryPodcastEpisode
import dev.jeromeswannack.chineselearning.lab.data.api.serverMessage
import dev.jeromeswannack.chineselearning.lab.data.api.subscribePodcast
import dev.jeromeswannack.chineselearning.lab.data.api.transcribeEpisode
import dev.jeromeswannack.chineselearning.lab.data.api.unsubscribePodcast
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.data.bumps.BumpStore
import dev.jeromeswannack.chineselearning.lab.data.podcasts.PodcastPrefs
import dev.jeromeswannack.chineselearning.lab.data.podcasts.PodcastStore
import dev.jeromeswannack.chineselearning.lab.data.podcasts.SegmentPlayer
import dev.jeromeswannack.chineselearning.lab.data.text.DeviceWords
import dev.jeromeswannack.chineselearning.lab.fx.Sounds
import dev.jeromeswannack.chineselearning.lab.ui.coach.CoachDeck
import dev.jeromeswannack.chineselearning.lab.ui.coach.CoachRules
import dev.jeromeswannack.chineselearning.lab.ui.coach.NewWordsActions
import dev.jeromeswannack.chineselearning.lab.ui.coach.NewWordsResult
import dev.jeromeswannack.chineselearning.lab.ui.coach.NewWordsSheetUi
import dev.jeromeswannack.chineselearning.lab.ui.explorer.rememberExplorerTap
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** `/podcasts`, `/podcasts/feed?url=` and `/podcasts/episodes/:id` (docs/PODCASTS.md; the player is immersive). */
fun NavGraphBuilder.podcastsGraph(nav: LabNav) {
    composable(Routes.route("/podcasts")) {
        val vm: PodcastsHomeViewModel = viewModel(factory = factory { PodcastsHomeViewModel(nav.app) })
        val ui by vm.ui.collectAsStateWithLifecycle()
        PodcastsScreen(
            ui,
            PodcastsHomeActions(
                onBack = nav::back,
                onUrl = vm::setUrl,
                onAdd = { vm.add { url -> nav.open(Routes.podcastFeed(url)) } },
                onSubscribe = vm::subscribe,
                onOpenFeed = { nav.open(Routes.podcastFeed(it)) },
                onOpenEpisode = { nav.open(Routes.podcastEpisode(it)) },
                onRetry = vm::refresh,
            ),
        )
    }
    composable(
        Routes.route("/podcasts/feed?url={url}"),
        arguments = listOf(navArgument("url") { type = NavType.StringType; nullable = true; defaultValue = null }),
    ) { entry ->
        val url = entry.arguments?.getString("url").orEmpty()
        val vm: PodcastFeedViewModel = viewModel(key = "podcast-feed-$url", factory = factory { PodcastFeedViewModel(nav.app, url) })
        val ui by vm.ui.collectAsStateWithLifecycle()
        PodcastFeedScreen(
            ui,
            PodcastFeedActions(
                onBack = nav::back,
                onSubscribe = vm::subscribe,
                onUnsubscribe = vm::unsubscribe,
                onTranscribe = { e -> vm.transcribe(e) { id -> nav.open(Routes.podcastEpisode(id)) } },
                onOpen = { e -> nav.open(Routes.podcastEpisode(e.id)) },
                onExpand = vm::expand,
                onRetry = vm::refresh,
            ),
        )
    }
    composable(Routes.route("/podcasts/episodes/{id}")) { entry ->
        val id = entry.arguments?.getString("id").orEmpty()
        val app = nav.app
        val vm: EpisodeViewModel = viewModel(key = "podcast-episode-$id", factory = factory { EpisodeViewModel(app, id) })
        val ui by vm.ui.collectAsStateWithLifecycle()
        val explore = rememberExplorerTap("podcast")
        // Stop the audio when the screen goes (back, or another screen on top).
        DisposableEffect(Unit) { onDispose { vm.pause() } }
        EpisodeScreen(
            ui,
            EpisodeActions(
                onBack = nav::back,
                onPlay = vm::play,
                onToggle = vm::toggle,
                onReplay = vm::replay,
                onPrev = vm::prev,
                onNext = vm::next,
                onSeek = vm::seek,
                onSlow = vm::toggleSlow,
                onAuto = vm::toggleAuto,
                onMode = vm::cycleMode,
                onReveal = vm::reveal,
                onWord = { w, sentence ->
                    ExplorerStack.itemForText(w.text, w.pinyin.ifEmpty { null }, w.gloss.ifEmpty { null }, sentence)?.let { item ->
                        app.haptics.tick()
                        explore?.invoke(item)
                    }
                },
                onWords = vm::openWords,
                onDownload = vm::download,
                onDeleteAudio = vm::deleteAudio,
                onForget = { vm.forget { nav.back() } },
                onRetry = vm::retry,
                onReload = vm::reload,
                onMakeLesson = vm::makeLesson,
                onOpenLessons = { nav.open(Routes.lessons()) },
                newWords = NewWordsActions(
                    onToggle = vm::toggleWord,
                    onDeck = vm::selectDeck,
                    onAdd = vm::addWords,
                    onBump = vm::bumpExisting,
                    onClose = vm::closeWords,
                ),
            ),
        )
    }
}

private inline fun <reified V : ViewModel> factory(crossinline make: () -> V) = object : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T = make() as T
}

private fun Throwable.readable(): String = (this as? HttpException)?.serverMessage()?.takeIf { it.isNotBlank() } ?: userMessage()

// ---------------------------------------------------------------- /podcasts

class PodcastsHomeViewModel(private val app: LabApp) : ViewModel() {
    private val home = app.cachedResource<PodcastsHomeDto>(viewModelScope, PodcastStore.HOME_KEY, PodcastStore.KIND) { podcastsHome() }
    private val local = MutableStateFlow(PodcastsHomeUi())

    val ui: StateFlow<PodcastsHomeUi> = combine(home.state, local, app.online) { h, l, online -> l.copy(home = h, online = online) }
        .stateIn(viewModelScope, SharingStarted.Eagerly, PodcastsHomeUi())

    init {
        // Episodes are transcribed in the background: keep "My episodes" moving while any is.
        viewModelScope.launch {
            while (isActive) {
                delay(5000)
                if (app.online.value && home.state.value.data?.episodes?.any { Podcasts.isWorking(it.status) } == true) home.refresh().join()
            }
        }
    }

    fun refresh() { home.refresh() }

    fun setUrl(v: String) = local.update { it.copy(url = v, addError = null) }

    fun add(onAdded: (String) -> Unit) {
        val url = local.value.url.trim()
        if (url.isEmpty() || local.value.adding) return
        local.update { it.copy(adding = true, addError = null) }
        viewModelScope.launch {
            try {
                val res = app.repo.api.subscribePodcast(url)
                app.cache.put(PodcastStore.feedKey(res.feed.podcast.feed_url), PodcastStore.KIND, res.feed)
                app.haptics.correct()
                local.update { it.copy(adding = false, url = "") }
                home.refresh()
                onAdded(res.feed.podcast.feed_url)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                local.update { it.copy(adding = false, addError = e.readable()) }
            }
        }
    }

    fun subscribe(url: String) {
        if (url in local.value.busy) return
        local.update { it.copy(busy = it.busy + url) }
        viewModelScope.launch {
            try {
                val res = app.repo.api.subscribePodcast(url)
                app.cache.put(PodcastStore.feedKey(res.feed.podcast.feed_url), PodcastStore.KIND, res.feed)
                app.haptics.correct()
                home.refresh().join()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                local.update { it.copy(addError = e.readable()) }
            } finally {
                local.update { it.copy(busy = it.busy - url) }
            }
        }
    }
}

// ---------------------------------------------------------------- /podcasts/feed?url=

class PodcastFeedViewModel(private val app: LabApp, private val url: String) : ViewModel() {
    private val feed = app.cachedResource<PodcastFeedViewDto>(viewModelScope, PodcastStore.feedKey(url), PodcastStore.KIND) { podcastFeedView(url) }
    private val local = MutableStateFlow(PodcastFeedUi(url))

    val ui: StateFlow<PodcastFeedUi> = combine(feed.state, local, app.online) { f, l, online -> l.copy(feed = f, online = online) }
        .stateIn(viewModelScope, SharingStarted.Eagerly, PodcastFeedUi(url))

    init {
        viewModelScope.launch {
            while (isActive) {
                delay(5000)
                if (app.online.value && feed.state.value.data?.episodes?.any { Podcasts.isWorking(it.transcript?.status) } == true) feed.refresh().join()
            }
        }
    }

    fun refresh() { feed.refresh() }

    fun expand(id: String) = local.update { it.copy(expanded = if (it.expanded == id) null else id) }

    fun transcribe(e: FeedEpisodeDto, onOpen: (String) -> Unit) {
        if (e.id in local.value.starting) return
        local.update { it.copy(starting = it.starting + e.id, error = null) }
        app.haptics.tick()
        viewModelScope.launch {
            try {
                val ep = app.repo.api.transcribeEpisode(feed.state.value.data?.podcast?.feed_url ?: url, e.guid)
                PodcastStore.of(app, app.cache, app.repo.api).remember(ep)
                feed.refresh()
                onOpen(ep.id)
            } catch (err: CancellationException) {
                throw err
            } catch (err: Exception) {
                local.update { it.copy(error = err.readable()) }
            } finally {
                local.update { it.copy(starting = it.starting - e.id) }
            }
        }
    }

    fun subscribe() {
        if (local.value.subscribing) return
        local.update { it.copy(subscribing = true, error = null) }
        viewModelScope.launch {
            try {
                val res = app.repo.api.subscribePodcast(url)
                feed.update { res.feed }
                app.haptics.correct()
                app.cache.delete(PodcastStore.HOME_KEY)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                local.update { it.copy(error = e.readable()) }
            } finally {
                local.update { it.copy(subscribing = false) }
            }
        }
    }

    fun unsubscribe() {
        val sub = feed.state.value.data?.subscription_id ?: return
        local.update { it.copy(subscribing = true, error = null) }
        viewModelScope.launch {
            try {
                app.repo.api.unsubscribePodcast(sub)
                feed.update { it?.copy(subscription_id = null) ?: error("no feed") }
                app.analytics.track("podcast.unsubscribe", emptyMap())
                app.cache.delete(PodcastStore.HOME_KEY)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                local.update { it.copy(error = e.readable()) }
            } finally {
                local.update { it.copy(subscribing = false) }
            }
        }
    }
}

// ---------------------------------------------------------------- /podcasts/episodes/:id

class EpisodeViewModel(private val app: LabApp, private val id: String) : ViewModel() {
    private val store = PodcastStore.of(app, app.cache, app.repo.api)
    private val prefs = PodcastPrefs(app)
    private val player = SegmentPlayer(viewModelScope)
    private val local = MutableStateFlow(EpisodeUi(id, current = prefs.segment(id), slow = prefs.slow, auto = prefs.auto, mode = prefs.reveal))
    private var knownNotes: List<String> = emptyList()
    private var lastPlayed = -1
    private var opened = false
    private var lessonWasGenerating = false

    val ui: StateFlow<EpisodeUi> = combine(local, app.online) { l, online -> l.copy(online = online) }
        .stateIn(viewModelScope, SharingStarted.Eagerly, local.value)

    private val speed: Double get() = if (local.value.slow) 0.75 else 1.0

    init {
        player.onStopped = { local.update { it.copy(playing = false) } }
        viewModelScope.launch {
            knownNotes = app.safely("podcast known words") {
                withContext(Dispatchers.IO) {
                    val live = app.repo.dao.decks().map { it.id }.toHashSet()
                    app.repo.dao.allNotes().filter { it.deckId in live }.map { it.hanzi }
                }
            }.orEmpty()
            local.update { it.copy(known = knownNotes.mapTo(HashSet()) { h -> h.trim() }) }
            updateNewWordCount()
        }
        viewModelScope.launch {
            store.cachedEpisode(id)?.let { cached -> setEpisode(cached, fromCache = true) }
            reload()
            // Poll while the server is still working on it (or writing a lesson).
            while (isActive) {
                delay(4000)
                val ep = local.value.episode
                val working = ep == null || Podcasts.isWorking(ep.status) || ep.lesson?.status == "generating"
                if (working && app.online.value) fetch()
            }
        }
        viewModelScope.launch {
            player.state.collect { s ->
                local.update { u ->
                    var next = u.copy(playing = s.playing, positionMs = s.positionMs)
                    // Keep playing: the transcript follows the audio.
                    if (u.auto && s.playing && u.segments.isNotEmpty()) {
                        val at = Podcasts.segmentAt(u.segments.map { it.start_ms }, s.positionMs + Podcasts.LEAD_MS)
                        if (at >= 0 && at != u.current) next = next.copy(current = at)
                    }
                    next
                }
            }
        }
        viewModelScope.launch {
            store.downloads.collect { d ->
                val f = d[id] ?: return@collect
                local.update { it.copy(audio = EpisodeAudio.Downloading(f)) }
            }
        }
        viewModelScope.launch {
            var last = -1
            ui.collect { u ->
                if (u.current != last) {
                    last = u.current
                    prefs.saveSegment(id, u.current)
                    updateNewWordCount()
                }
            }
        }
    }

    fun reload() {
        viewModelScope.launch { fetch() }
    }

    private suspend fun fetch() {
        if (!app.online.value) {
            local.update { it.copy(loading = false) }
            return
        }
        try {
            setEpisode(store.fetchEpisode(id), fromCache = false)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            local.update { it.copy(loading = false, error = if (it.episode == null) e.readable() else null) }
        }
    }

    private fun setEpisode(ep: PodcastEpisodeDto, fromCache: Boolean) {
        val wasListenable = Podcasts.isListenable(local.value.episode?.status) && local.value.segments.isNotEmpty()
        local.update { u ->
            u.copy(
                episode = ep,
                loading = false,
                error = null,
                current = u.current.coerceIn(0, maxOf(0, ep.segments.size - 1)),
            )
        }
        if (!opened) {
            opened = true
            app.analytics.track("podcast.open", mapOf("status" to ep.status, "offline" to (fromCache && !app.online.value), "segments" to ep.segments.size))
        }
        if (ep.lesson?.status == "generating") lessonWasGenerating = true
        if (lessonWasGenerating && ep.lesson?.status == "ready") {
            lessonWasGenerating = false
            app.haptics.correct()
            app.scope.launch { app.safely("podcast lesson sync") { app.repo.sync() } }
        }
        if (Podcasts.isListenable(ep.status) && ep.segments.isNotEmpty()) {
            val saved = store.savedFile(ep.id)
            if (saved != null) {
                local.update { it.copy(audio = EpisodeAudio.Saved(saved.length())) }
            } else if (local.value.audio !is EpisodeAudio.Downloading) {
                local.update { it.copy(audio = EpisodeAudio.Missing(ep.audio_bytes)) }
                // Opened to listen: fetch the audio at once (Jerome: prefetch aggressively).
                if (!wasListenable && app.online.value && ep.has_audio) download()
            }
            if (!wasListenable) updateNewWordCount()
        }
    }

    fun download() {
        val ep = local.value.episode ?: return
        if (local.value.audio is EpisodeAudio.Downloading) return
        local.update { it.copy(audio = EpisodeAudio.Downloading(0.0)) }
        viewModelScope.launch {
            try {
                val f = store.download(ep)
                local.update { it.copy(audio = EpisodeAudio.Saved(f.length())) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                local.update { it.copy(audio = EpisodeAudio.Failed("Couldn't download the audio: ${e.readable()}")) }
            }
        }
    }

    fun deleteAudio() {
        player.release()
        viewModelScope.launch {
            store.deleteAudio(id)
            local.update { it.copy(audio = EpisodeAudio.Missing(it.episode?.audio_bytes), playing = false, notice = "The audio was deleted from this phone. The transcript stays.") }
        }
    }

    fun forget(done: () -> Unit) {
        player.release()
        viewModelScope.launch {
            app.safely("forget podcast episode") { app.repo.api.forgetPodcastEpisode(id) }
            store.forget(id)
            app.cache.delete(PodcastStore.HOME_KEY)
            done()
        }
    }

    fun retry() {
        viewModelScope.launch {
            try {
                setEpisode(app.repo.api.retryPodcastEpisode(id), fromCache = false)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                local.update { it.copy(error = e.readable()) }
            }
        }
    }

    // ---- playback

    private fun ensureLoaded(): Boolean {
        val f = store.savedFile(id) ?: return false
        return player.load(f)
    }

    fun play(i: Int) {
        val u = local.value
        val segs = u.segments
        val s = segs.getOrNull(i) ?: return
        if (u.playing && i == u.current) return pause()
        if (!ensureLoaded()) {
            local.update { it.copy(notice = "The audio isn't on this phone yet.") }
            return
        }
        app.haptics.tick()
        val stop = if (u.auto) null else Podcasts.stopAt(s.end_ms, segs.getOrNull(i + 1)?.start_ms)
        local.update { it.copy(current = i, notice = null) }
        player.play(Podcasts.startAt(s.start_ms), stop, speed)
        app.analytics.track("podcast.segment_play", mapOf("slow" to u.slow, "replay" to (i == lastPlayed), "auto" to u.auto))
        lastPlayed = i
    }

    fun toggle() {
        val u = local.value
        if (u.playing) return pause()
        play(u.current)
    }

    fun replay() {
        val u = local.value
        if (u.playing) player.pause()
        local.update { it.copy(playing = false) }
        play(u.current)
    }

    fun pause() {
        player.pause()
    }

    fun next() = step(+1)
    fun prev() = step(-1)

    private fun step(d: Int) {
        val u = local.value
        val i = (u.current + d).coerceIn(0, maxOf(0, u.segments.size - 1))
        if (i == u.current) return
        if (u.canPlay) {
            if (u.playing) player.pause()
            local.update { it.copy(playing = false) }
            play(i)
        } else {
            local.update { it.copy(current = i) }
        }
    }

    fun seek(fraction: Float) {
        val u = local.value
        if (u.segments.isEmpty()) return
        val ms = (fraction * u.durationMs).toLong()
        val i = Podcasts.segmentAt(u.segments.map { it.start_ms }, ms).coerceAtLeast(0)
        if (i == u.current) return
        local.update { it.copy(current = i) }
        if (u.playing) {
            player.pause()
            local.update { it.copy(playing = false) }
            play(i)
        }
    }

    fun toggleSlow() {
        app.haptics.tick()
        local.update { it.copy(slow = !it.slow) }
        prefs.slow = local.value.slow
        player.setSpeed(speed)
    }

    fun toggleAuto() {
        app.haptics.tick()
        local.update { it.copy(auto = !it.auto) }
        val u = local.value
        prefs.auto = u.auto
        if (u.playing) {
            val s = u.segments.getOrNull(u.current)
            player.setStopAt(if (u.auto || s == null) null else Podcasts.stopAt(s.end_ms, u.segments.getOrNull(u.current + 1)?.start_ms))
        }
    }

    /** 👁: what every untapped segment shows — Listen first → Chinese → + pinyin → Everything. */
    fun cycleMode() {
        app.haptics.tick()
        val next = Podcasts.Reveal.entries[(local.value.mode.ordinal + 1) % Podcasts.Reveal.entries.size]
        prefs.reveal = next
        local.update { it.copy(mode = next, reveals = emptyMap()) }
    }

    fun reveal(i: Int) {
        val u = local.value
        val s = u.segments.getOrNull(i) ?: return
        val next = Podcasts.nextReveal(u.reveal(i), hasPinyin = s.lang != "en", hasEnglish = s.english != null)
        app.haptics.tick()
        local.update { it.copy(current = i, reveals = it.reveals + (i to next)) }
        if (next != Podcasts.Reveal.LISTEN) app.analytics.track("podcast.reveal", mapOf("step" to next.analytics))
    }

    // ---- ➕ Words: the segment's new words as cards (the Coach's picker)

    private fun wordsOf(s: PodcastSegmentDto): List<CoachBreakdownWord> {
        val words = DeviceWords.of(s.text) ?: return emptyList()
        val candidates = words.filter { ReaderWords.isTappable(it.text) && CoachActions.hasHan(it.text) }.map { CoachBreakdownWord(it.text.trim(), it.pinyin, it.gloss) }
        return CoachNewWords.newWordsInSentence(candidates, knownNotes)
    }

    private fun updateNewWordCount() {
        val s = local.value.segments.getOrNull(local.value.current)
        val n = if (s == null) 0 else runCatching { wordsOf(s).size }.getOrDefault(0)
        local.update { it.copy(newWordCount = n) }
    }

    fun openWords() {
        val u = local.value
        val s = u.segments.getOrNull(u.current) ?: return
        val words = wordsOf(s)
        if (words.isEmpty()) {
            local.update { it.copy(notice = if (DeviceWords.of(s.text) == null) "The word lists are still loading — try again in a second." else "Every word in this segment is already in your decks. Tap a word to study it today.") }
            return
        }
        viewModelScope.launch {
            val decks = withContext(Dispatchers.IO) {
                PickerDecks.inQueueOrder(app.repo.dao.decks(), { it.studyPriority }, { it.createdAt }).map { CoachDeck(it.id, it.name) }
            }
            if (decks.isEmpty()) {
                local.update { it.copy(notice = "Make a deck first (More → Decks), then add words to it.") }
                return@launch
            }
            local.update { it.copy(newWords = NewWordsSheetUi(words, decks)) }
            // The meanings, so he can choose (Haiku, one call; the picker works without them).
            if (!app.online.value) return@launch
            val glossed = app.safely("podcast gloss") { app.repo.api.glossWords(words.map { GlossWordIn(it.hanzi, it.pinyin.ifBlank { null }) }) }.orEmpty()
            if (glossed.isEmpty()) return@launch
            val byHanzi = glossed.associateBy { it.hanzi }
            local.update { st ->
                val sheet = st.newWords ?: return@update st
                st.copy(newWords = sheet.copy(words = sheet.words.map { w -> byHanzi[w.hanzi]?.let { g -> w.copy(pinyin = w.pinyin.ifBlank { g.pinyin }, gloss = g.english) } ?: w }))
            }
        }
    }

    fun closeWords() = local.update { if (it.newWords?.saving == true) it else it.copy(newWords = null) }

    fun toggleWord(hanzi: String) = local.update { u ->
        val s = u.newWords?.takeIf { !it.saving } ?: return@update u
        u.copy(newWords = s.copy(picked = if (hanzi in s.picked) s.picked - hanzi else s.picked + hanzi, error = null))
    }

    fun selectDeck(deckId: String) = local.update { u -> u.copy(newWords = u.newWords?.copy(deckId = deckId)) }

    /** Gloss what still has no meaning → card drafts → enrich-words → ONE batch with skip_existing (like the Coach). */
    fun addWords() {
        val sheet = local.value.newWords ?: return
        val seg = local.value.segments.getOrNull(local.value.current) ?: return
        val deck = sheet.deck ?: return
        val chosen = sheet.chosen
        if (sheet.saving || chosen.isEmpty()) return
        if (!app.online.value) {
            local.update { it.copy(newWords = sheet.copy(error = "You're offline — adding cards needs a connection. Your ticks are kept.")) }
            return
        }
        local.update { it.copy(newWords = sheet.copy(saving = true, error = null)) }
        viewModelScope.launch {
            val missing = chosen.filter { it.gloss.isBlank() }
            val glossed = if (missing.isEmpty()) emptyMap() else app.safely("podcast gloss") {
                app.repo.api.glossWords(missing.map { GlossWordIn(it.hanzi, it.pinyin.ifBlank { null }) })
            }.orEmpty().associateBy { it.hanzi }
            val words = chosen.map { w -> glossed[w.hanzi]?.let { g -> w.copy(pinyin = w.pinyin.ifBlank { g.pinyin }, gloss = g.english) } ?: w }.filter { it.gloss.isNotBlank() }
            if (words.isEmpty()) {
                local.update { u -> u.copy(newWords = u.newWords?.copy(saving = false, error = "Couldn't find the meanings — try again.")) }
                return@launch
            }
            val cards = CoachNewWords.newWordCards(words, seg.text, seg.pinyin, seg.english)
            val enriched = app.safely("podcast enrich") { app.repo.api.enrichWords(cards.map { EnrichWordIn(it.hanzi, it.pinyin, it.english) }) }.orEmpty().associateBy { it.hanzi }
            val notes = cards.map { c ->
                val e = enriched[c.hanzi]
                val ownClue = e?.sentence_clue?.takeIf { it.isNotBlank() && it.contains(c.hanzi) } != null
                NewNoteBody(
                    c.hanzi, c.pinyin, c.english,
                    fun_facts = e?.fun_facts?.takeIf { it.isNotBlank() },
                    sentence_clue = if (ownClue) e!!.sentence_clue else c.sentenceClue,
                    sentence_clue_pinyin = if (ownClue) e!!.sentence_clue_pinyin else c.sentenceCluePinyin,
                    sentence_clue_translation = if (ownClue) e!!.sentence_clue_translation else c.sentenceClueTranslation,
                )
            }
            try {
                val res = app.repo.api.addNotesBatch(deck.id, notes, skipExisting = true)
                knownNotes = knownNotes + res.created.map { it.hanzi } + res.existing.map { it.hanzi }
                app.analytics.track("podcast.add_card", mapOf("count" to res.created.size, "existing" to res.existing.size))
                if (res.created.isNotEmpty()) {
                    app.sounds.play(Sounds.Sfx.CORRECT, 0.6f)
                    app.haptics.correct()
                }
                val failed = res.failed.map { f -> "${f.hanzi}: ${f.error}" }
                local.update { u ->
                    u.copy(
                        newWords = u.newWords?.copy(saving = false, result = NewWordsResult(res.created.map { it.hanzi }, deck.name, res.existing, failed)),
                        known = u.known + res.created.map { it.hanzi } + res.existing.map { it.hanzi },
                    )
                }
                updateNewWordCount()
                app.scope.launch { app.safely("podcast cards sync") { app.repo.sync() } }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                local.update { u -> u.copy(newWords = u.newWords?.copy(saving = false, error = if (!app.online.value) CoachRules.OFFLINE else e.readable())) }
            }
        }
    }

    fun bumpExisting(noteId: String) {
        viewModelScope.launch {
            app.safely("podcast bump") { BumpStore.bumpNotes(app, listOf(noteId), "podcast") } ?: return@launch
            app.haptics.correct()
            local.update { u -> u.copy(newWords = u.newWords?.let { it.copy(bumped = it.bumped + noteId) }) }
        }
    }

    // ---- 🎓 Make a mini lesson

    fun makeLesson() {
        val u = local.value
        val ep = u.episode ?: return
        if (u.lessonBusy || ep.status != "ready") return
        val from = Podcasts.lessonFrom(u.current, u.segments.size)
        local.update { it.copy(lessonBusy = true, error = null) }
        viewModelScope.launch {
            try {
                val lesson = app.repo.api.makePodcastLesson(id, from)
                lessonWasGenerating = lesson.status == "generating"
                local.update { st -> st.copy(episode = st.episode?.copy(lesson = lesson), notice = "Writing a mini lesson from ${Podcasts.lessonFromLabel(u.segments.getOrNull(from)?.start_ms)} — it takes a minute or two.") }
                app.analytics.track("podcast.make_lesson", mapOf("from" to from))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                local.update { it.copy(error = e.readable()) }
            } finally {
                local.update { it.copy(lessonBusy = false) }
            }
        }
    }

    override fun onCleared() {
        player.release()
        super.onCleared()
    }
}
