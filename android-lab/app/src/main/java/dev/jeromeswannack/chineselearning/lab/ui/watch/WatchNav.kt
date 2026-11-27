package dev.jeromeswannack.chineselearning.lab.ui.watch

import android.os.SystemClock
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerStack
import dev.jeromeswannack.chineselearning.lab.core.watch.Watch
import dev.jeromeswannack.chineselearning.lab.data.HttpException
import dev.jeromeswannack.chineselearning.lab.data.api.WatchAddBody
import dev.jeromeswannack.chineselearning.lab.data.api.WatchListDto
import dev.jeromeswannack.chineselearning.lab.data.api.WatchVideoDto
import dev.jeromeswannack.chineselearning.lab.data.api.addWatchVideo
import dev.jeromeswannack.chineselearning.lab.data.api.removeWatchVideo
import dev.jeromeswannack.chineselearning.lab.data.api.retryWatchVideo
import dev.jeromeswannack.chineselearning.lab.data.api.serverMessage
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.data.api.watchList
import dev.jeromeswannack.chineselearning.lab.data.watch.WatchPrefs
import dev.jeromeswannack.chineselearning.lab.data.watch.WatchStore
import dev.jeromeswannack.chineselearning.lab.ui.explorer.rememberExplorerTap
import dev.jeromeswannack.chineselearning.lab.ui.homework.openExternal
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

/** `/watch`, `/watch/share?text=` and `/watch/:id` (docs/WATCH.md; the player is immersive). */
fun NavGraphBuilder.watchGraph(nav: LabNav) {
    composable(Routes.route("/watch")) {
        WatchListRoute(nav, sharedText = null)
    }
    // Registered before /watch/{id} so "share" is never read as a video id.
    composable(
        Routes.route("/watch/share?text={text}"),
        arguments = listOf(navArgument("text") { type = NavType.StringType; nullable = true; defaultValue = null }),
    ) { entry ->
        WatchListRoute(nav, sharedText = entry.arguments?.getString("text").orEmpty())
    }
    composable(
        Routes.route("/watch/{id}?source={source}"),
        arguments = listOf(navArgument("source") { type = NavType.StringType; nullable = true; defaultValue = null }),
    ) { entry ->
        val id = entry.arguments?.getString("id").orEmpty()
        val source = entry.arguments?.getString("source")
        val app = nav.app
        val vm: WatchPlayerViewModel = viewModel(key = "watch-$id", factory = factory { WatchPlayerViewModel(app, id, source) })
        val ui by vm.ui.collectAsStateWithLifecycle()
        val context = LocalContext.current
        val explore = rememberExplorerTap("watch")
        val controller = remember { YouTubeController() }
        vm.controller = controller
        // Leaving (back, another screen, the app in the background): pause and save the position.
        val owner = LocalLifecycleOwner.current
        DisposableEffect(owner) {
            val obs = LifecycleEventObserver { _, e -> if (e == Lifecycle.Event.ON_PAUSE) vm.onHidden() }
            owner.lifecycle.addObserver(obs)
            onDispose {
                owner.lifecycle.removeObserver(obs)
                vm.onHidden()
                if (vm.controller === controller) vm.controller = null
            }
        }
        WatchPlayerScreen(
            ui,
            WatchPlayerActions(
                onBack = nav::back,
                onPrev = { vm.step(-1) },
                onReplay = vm::replay,
                onNext = { vm.step(1) },
                onToggle = vm::toggle,
                onTapLine = vm::tapLine,
                onSpeed = vm::cycleSpeed,
                onPinyin = vm::togglePinyin,
                onEnglish = vm::toggleEnglish,
                onPauseMode = vm::togglePauseMode,
                onListenFirst = vm::toggleListenFirst,
                onReveal = vm::reveal,
                onWord = { w, sentence ->
                    ExplorerStack.itemForText(w.text, w.pinyin.ifEmpty { null }, w.gloss.ifEmpty { null }, sentence)?.let { item -> explore?.invoke(item) }
                },
                onRetry = vm::retry,
                onReload = vm::reload,
                onOpenOnYouTube = { openExternal(context, Watch.youtubeWatchUrl(id)) },
                onRemove = { vm.remove { nav.back() } },
            ),
            video = { m ->
                YouTubePlayerView(
                    videoId = id,
                    startMs = ui.startMs ?: 0,
                    rate = ui.speed,
                    controller = controller,
                    listener = vm,
                    modifier = m,
                )
            },
        )
    }
}

@androidx.compose.runtime.Composable
private fun WatchListRoute(nav: LabNav, sharedText: String?) {
    val app = nav.app
    val vm: WatchListViewModel = viewModel(key = "watch-list-${sharedText != null}", factory = factory { WatchListViewModel(app) })
    val ui by vm.ui.collectAsStateWithLifecycle()
    val context = LocalContext.current
    // A link shared from YouTube: open the player (once — not again on coming back), else say why not.
    var handled by androidx.compose.runtime.saveable.rememberSaveable { androidx.compose.runtime.mutableStateOf(false) }
    LaunchedEffect(sharedText) {
        if (sharedText == null || handled) return@LaunchedEffect
        handled = true
        val id = Watch.parseYouTubeVideoId(sharedText)
        if (id != null) nav.open(Routes.watchVideo(id) + "?source=share")
        else vm.notice("That wasn't a YouTube video link. Share a video from the YouTube app (Share → Watch (Lab)), or paste its link below.")
    }
    WatchListScreen(
        ui,
        WatchListActions(
            onBack = nav::back,
            onLink = vm::setLink,
            onOpenLink = { vm.openLink { id -> nav.open(Routes.watchVideo(id) + "?source=paste") } },
            onOpen = { nav.open(Routes.watchVideo(it)) },
            onShow = { s -> openExternal(context, Watch.youtubeSearchUrl(s.query)) },
            onRetry = vm::retry,
            onRemove = vm::remove,
            onRefresh = vm::refresh,
            onDismissNotice = { vm.notice(null) },
        ),
    )
}

private inline fun <reified V : ViewModel> factory(crossinline make: () -> V) = object : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T = make() as T
}

private fun Throwable.readable(): String = (this as? HttpException)?.serverMessage()?.takeIf { it.isNotBlank() } ?: userMessage()

// ---------------------------------------------------------------- /watch

class WatchListViewModel(private val app: LabApp) : ViewModel() {
    private val store = WatchStore(app.cache, app.repo.api, app.outbox)
    private val list = app.cachedResource<WatchListDto>(viewModelScope, WatchStore.LIST_KEY, WatchStore.KIND) { watchList() }
    private val local = MutableStateFlow(WatchListUi())

    val ui: StateFlow<WatchListUi> = combine(list.state, local, app.online) { l, u, online -> u.copy(list = l, online = online) }
        .stateIn(viewModelScope, SharingStarted.Eagerly, WatchListUi())

    init {
        // Transcripts are made in the background: keep the status lines moving while any is.
        viewModelScope.launch {
            while (isActive) {
                delay(5000)
                if (app.online.value && list.state.value.data?.videos?.any { Watch.isWorking(it.status) } == true) list.refresh().join()
            }
        }
    }

    fun refresh() { list.refresh() }

    fun notice(text: String?) = local.update { it.copy(notice = text) }

    fun setLink(v: String) = local.update { it.copy(link = v, linkError = null) }

    fun openLink(open: (String) -> Unit) {
        val text = local.value.link
        val id = Watch.parseYouTubeVideoId(text)
        if (id == null) {
            local.update { it.copy(linkError = "That doesn't look like a YouTube video link (youtube.com/watch?v=… or youtu.be/…).") }
            app.haptics.wrong()
            return
        }
        app.haptics.tick()
        local.update { it.copy(link = "", linkError = null) }
        open(id)
    }

    fun retry(id: String) {
        if (id in local.value.busy) return
        local.update { it.copy(busy = it.busy + id) }
        viewModelScope.launch {
            try {
                store.remember(app.repo.api.retryWatchVideo(id))
                list.refresh().join()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                local.update { it.copy(notice = e.readable()) }
            } finally {
                local.update { it.copy(busy = it.busy - id) }
            }
        }
    }

    fun remove(id: String) {
        viewModelScope.launch {
            try {
                app.repo.api.removeWatchVideo(id)
                store.forget(id)
                app.haptics.tick()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                local.update { it.copy(notice = e.readable()) }
            }
        }
    }
}

// ---------------------------------------------------------------- /watch/:id

/**
 * The player's brain. The YouTube page ticks every ~150 ms; each tick runs the rules of
 * shared/watch/lines.ts (Watch.kt): drop the focus once playback has left it (focusStillHolds),
 * and with "Pause after each line" pause when a line's pause point was played through
 * (lineEndCrossed) and hold that line. ⏮ 🔁 ⏭ / a tap on a row seek to lineSeekMs and focus that line.
 */
class WatchPlayerViewModel(private val app: LabApp, private val id: String, private val source: String?) : ViewModel(), YouTubeListener {
    private val store = WatchStore(app.cache, app.repo.api, app.outbox)
    private val prefs = WatchPrefs(app)
    private val local = MutableStateFlow(
        WatchPlayerUi(
            id,
            pinyin = prefs.pinyin,
            english = prefs.english,
            pauseEachLine = prefs.pauseEachLine,
            listenFirst = prefs.listenFirst,
            speed = prefs.speed,
            startMs = prefs.position(id)?.let { Watch.resumeAtMs(it, null) },
        ),
    )

    @Volatile var controller: YouTubeController? = null

    val ui: StateFlow<WatchPlayerUi> = combine(local, app.online) { l, online -> l.copy(online = online) }
        .stateIn(viewModelScope, SharingStarted.Eagerly, local.value)

    private var lastTickMs: Long? = null
    /** After a jump: ignore ticks until the player reports the new time (or 1.5 s pass). */
    private var seekTarget: Long? = null
    private var seekUntil = 0L
    private var opened = false
    private var addState = AddState.UNKNOWN
    private var readyAt = 0L
    private var lastLocalSave = 0L
    private var lastServerSave = 0L
    private var lastSentMs = -1L

    private enum class AddState { UNKNOWN, NEEDED, ADDING, DONE }

    init {
        viewModelScope.launch {
            val known = app.safely("watch known words") {
                withContext(Dispatchers.IO) {
                    val live = app.repo.dao.decks().map { it.id }.toHashSet()
                    app.repo.dao.allNotes().filter { it.deckId in live }.map { it.hanzi.trim() }.toHashSet()
                }
            }.orEmpty()
            local.update { it.copy(known = known) }
        }
        viewModelScope.launch {
            // Already in My videos? Then the player never needs to add it (no second watch.add).
            val list = store.cachedList() ?: if (app.online.value) app.safely("watch list") { app.repo.api.watchList().also { app.cache.put(WatchStore.LIST_KEY, WatchStore.KIND, it) } } else null
            val mine = list?.videos?.any { it.id == id } == true
            if (mine) addState = AddState.DONE
            store.cachedVideo(id)?.let { setVideo(it, fromCache = true) }
            fetch()
            local.update { u -> if (u.startMs == null) u.copy(startMs = Watch.resumeAtMs(u.video?.position_ms, u.video?.duration_ms)) else u }
            // Poll every 5 s while the transcript is being made.
            while (isActive) {
                delay(5000)
                val v = local.value.video
                if (v != null && v.working && app.online.value) fetch()
                if (addState == AddState.NEEDED) maybeAdd()
            }
        }
    }

    fun reload() { viewModelScope.launch { fetch() } }

    private suspend fun fetch() {
        if (!app.online.value) {
            local.update { it.copy(loading = false) }
            return
        }
        try {
            setVideo(store.fetchVideo(id), fromCache = false)
            if (addState == AddState.UNKNOWN) addState = AddState.NEEDED // not in my list yet: link it once the player knows the length
            maybeAdd()
        } catch (e: CancellationException) {
            throw e
        } catch (e: HttpException) {
            if (e.code == 404) {
                addState = AddState.NEEDED
                local.update { it.copy(loading = false, error = null) }
                maybeAdd()
            } else {
                local.update { it.copy(loading = false, error = if (it.video == null) e.readable() else null) }
            }
        } catch (e: Exception) {
            local.update { it.copy(loading = false, error = if (it.video == null) e.readable() else null) }
        }
    }

    private fun setVideo(v: WatchVideoDto, fromCache: Boolean) {
        local.update { it.copy(video = v, loading = false, error = null) }
        if (!opened) {
            opened = true
            app.analytics.track("watch.open", mapOf("status" to v.status, "offline" to (fromCache && !app.online.value), "lines" to v.lines.size))
        }
    }

    /** POST /api/watch/videos once the player has reported the length (and, if it can, the title). */
    private fun maybeAdd() {
        if (addState != AddState.NEEDED) return
        val u = local.value
        if (u.durationMs < 1000 || !app.online.value) return
        val waitedForTitle = readyAt > 0 && SystemClock.elapsedRealtime() - readyAt > 4000
        if (u.playerTitle.isBlank() && !waitedForTitle) return
        addState = AddState.ADDING
        viewModelScope.launch {
            try {
                val res = app.repo.api.addWatchVideo(WatchAddBody(id, u.durationMs, u.playerTitle.ifBlank { null }, source ?: "paste"))
                addState = AddState.DONE
                store.remember(res.video)
                setVideo(res.video, fromCache = false)
            } catch (e: CancellationException) {
                addState = AddState.NEEDED
                throw e
            } catch (e: Exception) {
                addState = AddState.DONE // don't hammer the server; Retry on the screen tries again
                local.update { it.copy(error = e.readable()) }
                if (local.value.video == null) local.update { it.copy(playerError = e.readable()) }
            }
        }
    }

    // ---- the player's events (main thread)

    override fun onReady() {
        readyAt = SystemClock.elapsedRealtime()
        local.update { it.copy(ready = true, playerError = null) }
    }

    override fun onTick(positionMs: Long, durationMs: Long, state: Int, title: String) {
        val playing = state == 1
        val u = local.value
        val spans = u.spans
        var focus = u.focus
        val now = positionMs
        val target = seekTarget
        val settling = target != null && SystemClock.elapsedRealtime() < seekUntil && kotlin.math.abs(now - target) > 1500
        if (!settling) {
            seekTarget = null
            val prev = lastTickMs
            // Drop the focus once playback has left it…
            if (focus != null && !Watch.focusStillHolds(spans, now, focus, playing)) focus = null
            // …and "Pause after each line": playing through a line's pause point pauses and holds it.
            if (u.pauseEachLine && playing && prev != null) {
                val crossed = Watch.lineEndCrossed(spans, prev, now, focus)
                if (crossed != null) {
                    controller?.pause()
                    focus = crossed
                }
            }
            lastTickMs = now
        }
        local.update {
            it.copy(
                positionMs = if (settling) it.positionMs else now,
                durationMs = if (durationMs > 0) durationMs else it.durationMs,
                playing = playing,
                playerTitle = title.ifBlank { it.playerTitle },
                focus = if (settling) it.focus else focus,
            )
        }
        if (addState == AddState.NEEDED) maybeAdd()
        if (!settling && playing) savePosition(now, force = false)
    }

    override fun onError(code: Int) {
        val text = when (code) {
            101, 150 -> "This video can't be played outside YouTube (its owner turned embedding off)."
            100 -> "This video isn't available (removed or private)."
            2 -> "YouTube didn't recognise this video."
            152, 153 -> "YouTube refused the embedded player (error $code)."
            else -> "The YouTube player hit an error ($code)."
        }
        local.update { it.copy(playerError = text) }
    }

    // ---- position

    private fun savePosition(ms: Long, force: Boolean) {
        val t = SystemClock.elapsedRealtime()
        if (force || t - lastLocalSave > 3000) {
            lastLocalSave = t
            prefs.savePosition(id, ms)
        }
        if ((force || t - lastServerSave > 15_000) && ms != lastSentMs && addState == AddState.DONE) {
            lastServerSave = t
            lastSentMs = ms
            val online = app.online.value
            app.scope.launch { app.safely("watch position") { store.sendPosition(id, ms, online) } }
        }
    }

    /** The screen went away or into the background: pause, save the position everywhere. */
    fun onHidden() {
        controller?.pause()
        val u = local.value
        if (u.ready || u.positionMs > 0) savePosition(u.positionMs, force = true)
    }

    // ---- controls

    private fun jump(i: Int, action: String) {
        val u = local.value
        if (i < 0 || i >= u.lines.size) return
        val seek = Watch.lineSeekMs(u.spans, i)
        seekTarget = seek
        seekUntil = SystemClock.elapsedRealtime() + 1500
        lastTickMs = seek
        controller?.seekTo(seek)
        controller?.play()
        local.update { it.copy(focus = i, positionMs = seek) }
        app.haptics.tick()
        app.analytics.track("watch.line", mapOf("action" to action))
    }

    fun step(dir: Int) {
        val u = local.value
        jump(Watch.stepLine(u.lines.size, u.active, dir), if (dir < 0) "prev" else "next")
    }

    fun replay() {
        val u = local.value
        jump(if (u.active >= 0) u.active else Watch.stepLine(u.lines.size, u.active, 1), "replay")
    }

    fun tapLine(i: Int) = jump(i, "tap")

    fun toggle() {
        if (local.value.playing) controller?.pause() else controller?.play()
        app.haptics.tick()
    }

    fun cycleSpeed() {
        val next = Watch.nextSpeed(local.value.speed)
        prefs.speed = next
        controller?.setRate(next)
        local.update { it.copy(speed = next) }
        app.haptics.tick()
        app.analytics.track("watch.speed", mapOf("speed" to next))
    }

    fun togglePinyin() {
        val v = !local.value.pinyin
        prefs.pinyin = v
        local.update { it.copy(pinyin = v) }
    }

    fun toggleEnglish() {
        val v = !local.value.english
        prefs.english = v
        local.update { it.copy(english = v) }
    }

    fun togglePauseMode() {
        val v = !local.value.pauseEachLine
        prefs.pauseEachLine = v
        local.update { it.copy(pauseEachLine = v) }
        app.haptics.tick()
        app.analytics.track("watch.pause_mode", mapOf("on" to v))
    }

    fun toggleListenFirst() {
        val v = !local.value.listenFirst
        prefs.listenFirst = v
        local.update { it.copy(listenFirst = v, reveal = Watch.Reveal.LISTEN, revealFor = -1) }
        app.haptics.tick()
        app.analytics.track("watch.listen_first", mapOf("on" to v))
    }

    /** Listen first: each tap on the card uncovers one more step (Chinese → pinyin → English → covered). */
    fun reveal() {
        val u = local.value
        val line = u.lines.getOrNull(u.active) ?: return
        val next = Watch.nextReveal(u.cardReveal, hasPinyin = !line.pinyin.isNullOrBlank(), hasEnglish = !line.english.isNullOrBlank())
        local.update { it.copy(reveal = next, revealFor = u.active) }
        app.haptics.flip()
        app.analytics.track("watch.reveal", mapOf("step" to next.wire))
    }

    fun retry() {
        if (local.value.retrying) return
        local.update { it.copy(retrying = true, error = null) }
        viewModelScope.launch {
            try {
                val v = app.repo.api.retryWatchVideo(id)
                store.remember(v)
                setVideo(v, fromCache = false)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                local.update { it.copy(error = e.readable()) }
            } finally {
                local.update { it.copy(retrying = false) }
            }
        }
    }

    fun remove(done: () -> Unit) {
        viewModelScope.launch {
            try {
                app.repo.api.removeWatchVideo(id)
                store.forget(id)
                done()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                local.update { it.copy(error = e.readable()) }
            }
        }
    }
}
