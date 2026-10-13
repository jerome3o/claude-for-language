package dev.jeromeswannack.chineselearning.lab.ui.chat

import dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics
import android.media.AudioAttributes
import android.media.MediaMetadataRetriever
import android.media.MediaPlayer
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.setValue
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.AudioBlocks
import dev.jeromeswannack.chineselearning.lab.core.BlockPlayback
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.ReaderSpeed
import dev.jeromeswannack.chineselearning.lab.data.readers.ClipAnalysis
import dev.jeromeswannack.chineselearning.lab.data.readers.ReaderClipAnalyzer
import dev.jeromeswannack.chineselearning.lab.core.chat.ChatListResponse
import dev.jeromeswannack.chineselearning.lab.core.chat.ChatListening
import dev.jeromeswannack.chineselearning.lab.data.api.ChatMessageDto
import dev.jeromeswannack.chineselearning.lab.data.chat.ChatClips
import dev.jeromeswannack.chineselearning.lab.data.chat.ChatListeningStore
import dev.jeromeswannack.chineselearning.lab.ui.chats.ChatsKeys
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Listening mode in the open chat (docs/CHAT.md "Listening mode"): what [ChatUi.isHidden] needs
 * (the setting, the read marker the chat opened with, the ids revealed on this phone) and the
 * hidden bubble's playback: the clip split into PARTS at its pauses like the graded readers' scrubber
 * (core `AudioBlocks` + `BlockPlayback`, parity-tested): tap a part = play from it, tap the bubble /
 * ▶ ⏸ = play / pause (play again = the part he was in, or the one before within the grace), drag
 * along the waveform = scrub; the 0.75× chip, the clip's duration.
 */
data class ListeningUi(
    val setting: ChatListening.Setting = ChatListening.Setting(false, null),
    /** My read marker when the chat opened (the threshold while the setting is undecided). */
    val readMarkerAtOpen: String? = null,
    val revealed: Set<String> = emptySet(),
    /** Revealed in this visit: they fade / un-blur in once. */
    val justRevealed: Set<String> = emptySet(),
    /** The hidden bubble playing (message id). */
    val playing: String? = null,
    /** Its clip is being fetched. */
    val loading: String? = null,
    /** Counts every (re)start, so the bars' animation restarts with the clip. */
    val playNonce: Int = 0,
    /** The 0.75× chip. */
    val slow: Boolean = false,
    /** Seconds of the clips on the phone, by message id. */
    val durations: Map<String, Double> = emptyMap(),
    /** The bubble whose parts [block] belongs to (playing, or paused with its restart point). */
    val focus: String? = null,
    /** The restart point of [focus] (the readers' rules). */
    val block: BlockPlayback.State = BlockPlayback.State(),
    /** Waveform peaks + parts of the clips analysed on the phone, by message id. */
    val analyses: Map<String, ClipAnalysis> = emptyMap(),
    /** Where the clip of [focus] is (ms) — its own state, so the bubble alone redraws while it plays. */
    val clock: ListeningClock = ListeningClock(),
) {
    /** [m]'s restart point: its own when it has the focus, else the start. */
    fun blockOf(m: ChatMessageDto): BlockPlayback.State = if (focus == m.id) block else BlockPlayback.State()

    /** The placeholder's duration: the clip's, else "~" + the estimate. */
    fun durationLabel(m: ChatMessageDto): String =
        durations[m.id]?.let { ChatListening.formatListeningDuration(it) }
            ?: ("~" + ChatListening.formatListeningDuration(ChatListening.estimateSpeechSeconds(m.content)))
}

/** The playing position of the focused hidden bubble. */
class ListeningClock {
    var headMs by mutableDoubleStateOf(0.0)
}

/** The hidden bubble's player — a seam for tests (MediaPlayer on the phone). */
interface ListeningPlayer {
    /** Plays [file] at [speed] from the start; [onDone] when it ends or fails. */
    fun play(file: File, speed: Float, onDone: () -> Unit)
    /** Plays [file] at [speed] from [fromMs]. */
    fun play(file: File, speed: Float, fromMs: Int, onDone: () -> Unit) { play(file, speed, onDone); if (fromMs > 0) seekTo(fromMs) }
    fun restart()
    fun setSpeed(speed: Float)
    fun stop()
    /** Where the clip is (ms); null when unknown. */
    fun positionMs(): Int? = null
    fun seekTo(ms: Int) {}
    fun pause() {}
    /** Plays on from where it is (after [pause]). */
    fun resume() {}

    companion object {
        /** Tests swap this. */
        @Volatile var factory: () -> ListeningPlayer = { MediaListeningPlayer() }
    }
}

class MediaListeningPlayer : ListeningPlayer {
    private var mp: MediaPlayer? = null
    private var prepared = false
    /** Where to start once prepared (a seek before then). */
    private var pendingMs = 0
    private var wantPlay = true

    override fun play(file: File, speed: Float, onDone: () -> Unit) = play(file, speed, 0, onDone)

    override fun play(file: File, speed: Float, fromMs: Int, onDone: () -> Unit) {
        stop()
        val p = MediaPlayer()
        mp = p
        pendingMs = fromMs
        wantPlay = true
        runCatching {
            p.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
            p.setDataSource(file.absolutePath)
            p.setOnPreparedListener {
                prepared = true
                runCatching { if (speed != 1f) it.playbackParams = it.playbackParams.setSpeed(speed) }
                if (pendingMs > 0) runCatching { it.seekTo(pendingMs.toLong(), MediaPlayer.SEEK_CLOSEST) }
                if (wantPlay) it.start() else runCatching { it.pause() }
            }
            p.setOnCompletionListener { if (mp === it) { stop(); onDone() } }
            p.setOnErrorListener { _, _, _ -> stop(); onDone(); true }
            p.prepareAsync()
        }.onFailure { stop(); onDone() }
    }

    override fun restart() {
        val p = mp ?: return
        runCatching { p.seekTo(0); if (!p.isPlaying) p.start() }
    }

    override fun positionMs(): Int? = mp?.let { p -> if (prepared) runCatching { p.currentPosition }.getOrNull() else pendingMs }

    override fun seekTo(ms: Int) {
        val p = mp ?: return
        if (prepared) runCatching { p.seekTo(ms.toLong(), MediaPlayer.SEEK_CLOSEST) } else pendingMs = ms
    }

    override fun pause() {
        wantPlay = false
        val p = mp ?: return
        if (prepared) runCatching { p.pause() }
    }

    override fun resume() {
        wantPlay = true
        val p = mp ?: return
        if (prepared) runCatching { if (!p.isPlaying) p.start() }
    }

    override fun setSpeed(speed: Float) {
        val p = mp ?: return
        runCatching { val was = p.isPlaying; p.playbackParams = p.playbackParams.setSpeed(speed); if (!was) p.pause() }
    }

    override fun stop() {
        mp?.runCatching { release() }
        mp = null
        prepared = false
    }
}

class ChatListeningMode(
    private val app: LabApp,
    private val convId: String,
    private val scope: CoroutineScope,
    private val ui: MutableStateFlow<ChatUi>,
    /** Stops the chat's other audio (voice messages, Read aloud) before a clip plays. */
    private val stopOthers: () -> Unit,
    private val notice: (String) -> Unit,
    /** The read-aloud voice + speed of a message (ChatReadAloud — the same rule Read aloud uses). */
    private val voiceOf: suspend (ChatMessageDto) -> Pair<String, Double>,
) {
    private val clips: ChatClips get() = ChatClips.of(app)
    private var player: ListeningPlayer? = null
    /** The message [player] plays (its clip stays loaded while paused). */
    private var playerFor: String? = null
    /** The focused message's clip (play again after it ended without fetching it again). */
    private var focusFile: Pair<String, File>? = null
    private var ticker: Job? = null
    /** The undecided setting is stored once per visit. */
    private var decided = false

    private fun update(f: (ListeningUi) -> ListeningUi) = ui.update { it.copy(listening = f(it.listening)) }

    fun start() {
        scope.launch {
            val revealed = ChatListeningStore.revealed(app.cache, convId)
            val slow = runCatching { app.cache.get<Boolean>(ChatListeningStore.SLOW_KEY) }.getOrNull() ?: false
            // Opened offline: the inbox's copy of my read marker stands in until the page loads.
            val marker = runCatching { app.cache.get<ChatListResponse>(ChatsKeys.LIST) }.getOrNull()
                ?.conversations?.firstOrNull { it.conversationId == convId }?.myReadAt
            update { it.copy(revealed = it.revealed + revealed, slow = slow, readMarkerAtOpen = if (opened) it.readMarkerAtOpen else marker) }
        }
        scope.launch {
            ChatListeningStore.observe(app.cache).collect { state ->
                update { it.copy(setting = ChatListeningStore.settingFor(state, convId)) }
                maybeDecide()
            }
        }
    }

    /**
     * The first page loaded: [readMe] = my read marker before this visit marks it read. An
     * undecided "on" stores it as `since` (one PUT), so the choice is the same on every device.
     */
    fun onOpened(readMe: String?, messages: List<ChatMessageDto>) {
        update { it.copy(readMarkerAtOpen = readMe) }
        opened = true
        maybeDecide()
        prefetch(messages)
    }

    private var opened = false

    private fun maybeDecide() {
        val s = ui.value
        if (decided || !opened || !available(s)) return
        val l = s.listening
        if (!l.setting.on || l.setting.since != null) return
        decided = true
        val since = ChatListening.listeningThreshold(l.setting, l.readMarkerAtOpen)
        scope.launch { ChatListeningStore.setConversation(app, convId, true, since) }
    }

    fun available(s: ChatUi = ui.value) = !s.isAi && !s.otherIsClaude

    fun prefetch(messages: List<ChatMessageDto>) {
        val me = ui.value.myId ?: return
        if (!available()) return
        app.scope.launch { runCatching { clips.prefetchFor(messages, me, voiceOf) } }
    }

    /** Header ⋯ → 🎧 Listening mode: on (anything newer than what's on screen hides) / off. */
    fun toggle() {
        val s = ui.value
        val on = !s.listening.setting.on
        val since = if (on) ChatListening.sinceWhenTurnedOn(s.messages.map { it.created_at }, Js.toIsoString(System.currentTimeMillis())) else s.listening.setting.since
        decided = true
        app.haptics.tick()
        ui.update { it.copy(sheet = null, listening = it.listening.copy(setting = ChatListening.Setting(on, since))) }
        if (!on) stop()
        scope.launch { ChatListeningStore.setConversation(app, convId, on, since) }
    }

    /** ⋯ → 🙈 Hide all messages: every candidate hides (revealed ones stay). */
    fun hideAll() {
        decided = true
        app.haptics.tick()
        ui.update { it.copy(sheet = null, listening = it.listening.copy(setting = ChatListening.Setting(true, ChatListening.HIDE_ALL_SINCE))) }
        scope.launch { ChatListeningStore.setConversation(app, convId, true, ChatListening.HIDE_ALL_SINCE) }
    }

    /** A tap on a hidden bubble (or its ▶ ⏸): play from its restart point; a tap while it plays pauses. */
    fun tap(m: ChatMessageDto) {
        val l = ui.value.listening
        if (l.loading == m.id) return
        if (l.playing == m.id && player != null) { pause(); return }
        focus(m)
        play(m)
    }

    /**
     * A part of the waveform: [tap] = play from the part under [ms] (a clip with no pause found:
     * from [ms] itself); a drag = move the restart point there (a playing clip follows at once).
     */
    fun seek(m: ChatMessageDto, ms: Double, tap: Boolean) {
        focus(m)
        val blocks = blocksOf(m.id)
        if (tap) {
            dispatch(if (blocks.size > 1) BlockPlayback.Event.Jump(AudioBlocks.indexAt(blocks, ms)) else BlockPlayback.Event.Place(ms))
            Analytics.track("chat.listening_part", mapOf("how" to "tap"))
            if (ui.value.listening.playing != m.id) play(m)
        } else {
            if (!dragging) Analytics.track("chat.listening_part", mapOf("how" to "drag"))
            dragging = true
            dispatch(BlockPlayback.Event.Place(ms))
        }
    }

    /** A drag along the waveform ended (one analytics event per drag). */
    fun seekDone() { dragging = false }
    private var dragging = false

    /** [m] takes the parts' restart point (another bubble playing stops; its point is forgotten). */
    private fun focus(m: ChatMessageDto) {
        if (ui.value.listening.focus == m.id) return
        stop()
        focusFile = null
        ui.value.listening.clock.headMs = 0.0
        update { it.copy(focus = m.id, block = BlockPlayback.State()) }
    }

    private fun blocksOf(id: String): List<AudioBlocks.Block> {
        val l = ui.value.listening
        l.analyses[id]?.blocks?.takeIf { it.isNotEmpty() }?.let { return it }
        val ms = l.analyses[id]?.durationMs ?: l.durations[id]?.let { (it * 1000).toInt() } ?: 0
        return listOf(AudioBlocks.Block(0, Math.max(1, ms)))
    }

    private fun graceMs() = ReaderSpeed.blockGraceMsAt(if (ui.value.listening.slow) SLOW.toDouble() else 1.0)

    /** The readers' restart-point rules on the focused bubble (a seek follows when it plays). */
    private fun dispatch(event: BlockPlayback.Event) {
        val l = ui.value.listening
        val id = l.focus ?: return
        val r = BlockPlayback.reduce(l.block, event, blocksOf(id), graceMs())
        r.seekToMs?.let { ms -> player?.seekTo(ms.toInt()); l.clock.headMs = ms }
        if (!r.state.playing) l.clock.headMs = r.state.anchorMs
        update { it.copy(block = r.state) }
    }

    /** Plays the focused [m] from its restart point (the clip already loaded, else cache-first). */
    private fun play(m: ChatMessageDto) {
        // The chat's other audio stops (its stopAudio() calls stop() here too: keep this clip loaded).
        keep = true
        try { stopOthers() } finally { keep = false }
        val loaded = player
        if (loaded != null && playerFor == m.id) {
            dispatch(BlockPlayback.Event.Play) // seeks to the restart point
            loaded.resume()
            update { it.copy(playing = m.id, playNonce = it.playNonce + 1) }
            tick()
            return
        }
        update { it.copy(loading = m.id) }
        scope.launch {
            // Exactly what Read aloud plays: the same voice, the same cached file (text + voice + speed).
            val file = focusFile?.takeIf { it.first == m.id }?.second
                ?: runCatching { voiceOf(m).let { (voice, speed) -> clips.clip(m.content, voice, speed) } }.getOrNull()
            if (ui.value.listening.loading != m.id) return@launch
            if (file == null) {
                update { it.copy(loading = null) }
                notice(if (app.online.value) "Couldn't play that message." else "Audio not downloaded yet — it downloads when you're online.")
                return@launch
            }
            focusFile = m.id to file
            measure(m.id, file)
            analyze(m.id, file)
            val next = ListeningPlayer.factory()
            player = next
            playerFor = m.id
            Analytics.track("chat.listening_play", mapOf("slow" to ui.value.listening.slow))
            dispatch(BlockPlayback.Event.Play)
            update { it.copy(loading = null, playing = m.id, playNonce = it.playNonce + 1) }
            next.play(file, if (ui.value.listening.slow) SLOW else 1f, ui.value.listening.block.anchorMs.toInt()) {
                if (player === next) {
                    player = null
                    playerFor = null
                    ticker?.cancel()
                    if (ui.value.listening.focus == m.id) dispatch(BlockPlayback.Event.Ended)
                    update { it.copy(playing = null) }
                }
            }
            tick()
        }
    }

    /** ⏸: the clip stays loaded; the restart point = the part he was in (or the one before, within the grace). */
    private fun pause() {
        val p = player ?: return
        val pos = p.positionMs()?.toDouble() ?: ui.value.listening.clock.headMs
        p.pause()
        ticker?.cancel()
        dispatch(BlockPlayback.Event.Pause(pos))
        update { it.copy(playing = null) }
    }

    /** While it plays: the head follows the clip and the restart point moves part by part. */
    private fun tick() {
        ticker?.cancel()
        ticker = scope.launch {
            var last = -1
            while (isActive) {
                val l = ui.value.listening
                val id = l.playing ?: break
                player?.positionMs()?.toDouble()?.let { pos ->
                    l.clock.headMs = pos
                    val idx = AudioBlocks.indexAt(blocksOf(id), pos)
                    if (idx != last) { last = idx; dispatch(BlockPlayback.Event.Tick(pos)) }
                }
                delay(TICK_MS)
            }
        }
    }

    /** The clip's waveform + parts (decoded once, cached on the phone so they show at once and offline). */
    private fun analyze(id: String, file: File) {
        if (id in ui.value.listening.analyses) return
        scope.launch {
            val a = runCatching { analyzer(app, file) }.getOrNull() ?: return@launch
            update { it.copy(analyses = it.analyses + (id to a)) }
        }
    }

    /** The 0.75× chip (remembered on the phone; the clip playing follows at once). */
    fun toggleSlow() {
        val slow = !ui.value.listening.slow
        app.haptics.tick()
        update { it.copy(slow = slow) }
        player?.setSpeed(if (slow) SLOW else 1f)
        scope.launch { app.cache.put(ChatListeningStore.SLOW_KEY, ChatListeningStore.KIND, slow) }
    }

    /** Long-press / 👁: shown for good on this phone (with a haptic and the un-blur). */
    fun reveal(m: ChatMessageDto) {
        if (m.id in ui.value.listening.revealed) return
        app.haptics.flip()
        update { it.copy(revealed = it.revealed + m.id, justRevealed = it.justRevealed + m.id) }
        scope.launch { ChatListeningStore.reveal(app.cache, convId, m.id) }
        // The un-blur plays once (not again when the row scrolls back into view).
        scope.launch { kotlinx.coroutines.delay(REVEAL_MS); update { it.copy(justRevealed = it.justRevealed - m.id) } }
    }

    /** The clip's length for the placeholder (once per message). */
    private fun measure(id: String, file: File) {
        if (id in ui.value.listening.durations) return
        scope.launch {
            val ms = withContext(Dispatchers.IO) {
                runCatching {
                    val r = MediaMetadataRetriever()
                    try { r.setDataSource(file.absolutePath); r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() } finally { r.release() }
                }.getOrNull()
            }
            if (ms != null && ms > 0) update { it.copy(durations = it.durations + (id to ms / 1000.0)) }
        }
    }

    /** Durations of the hidden bubbles whose clips are already on the phone. */
    fun measureCached(messages: List<ChatMessageDto>) {
        val me = ui.value.myId ?: return
        scope.launch {
            for (m in ChatListening.prefetchSelection(messages, me, ChatListening.LISTENING_PREFETCH_COUNT, ChatListeningStore::listeningMessage)) {
                if (m.id in ui.value.listening.durations) continue
                val (voice, speed) = voiceOf(m)
                clips.cached(m.content, voice, speed)?.let { measure(m.id, it); analyze(m.id, it) }
            }
        }
    }

    /** Set while [play] silences the chat's other audio. */
    private var keep = false

    fun stop() {
        if (keep) return
        player?.stop()
        player = null
        playerFor = null
        ticker?.cancel()
        val l = ui.value.listening
        if (l.playing != null || l.loading != null || l.block.playing) {
            if (l.block.playing) l.clock.headMs = l.block.anchorMs
            update { it.copy(playing = null, loading = null, block = it.block.copy(playing = false, crossedFromMs = null)) }
        }
    }

    companion object {
        const val SLOW = 0.75f
        const val REVEAL_MS = 700L
        const val TICK_MS = 40L

        /** The clip → waveform + parts (cache-first, the readers' decoder); tests swap it. */
        @Volatile var analyzer: suspend (LabApp, File) -> ClipAnalysis? = { app, file ->
            ReaderClipAnalyzer(app.cache, prefix = "chat/listening/audio-blocks/").analyze(file.name, file)
        }
    }
}
