package dev.jeromeswannack.chineselearning.lab.ui.chat

import android.media.AudioAttributes
import android.media.MediaMetadataRetriever
import android.media.MediaPlayer
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.chat.ChatListResponse
import dev.jeromeswannack.chineselearning.lab.core.chat.ChatListening
import dev.jeromeswannack.chineselearning.lab.data.api.ChatMessageDto
import dev.jeromeswannack.chineselearning.lab.data.chat.ChatClips
import dev.jeromeswannack.chineselearning.lab.data.chat.ChatListeningStore
import dev.jeromeswannack.chineselearning.lab.ui.chats.ChatsKeys
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Listening mode in the open chat (docs/CHAT.md "Listening mode"): what [ChatUi.isHidden] needs
 * (the setting, the read marker the chat opened with, the ids revealed on this phone) and the
 * hidden bubble's playback (tap = play from the start, the 0.75× chip, the clip's duration).
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
) {
    /** The placeholder's duration: the clip's, else "~" + the estimate. */
    fun durationLabel(m: ChatMessageDto): String =
        durations[m.id]?.let { ChatListening.formatListeningDuration(it) }
            ?: ("~" + ChatListening.formatListeningDuration(ChatListening.estimateSpeechSeconds(m.content)))
}

/** The hidden bubble's player — a seam for tests (MediaPlayer on the phone). */
interface ListeningPlayer {
    /** Plays [file] at [speed] from the start; [onDone] when it ends or fails. */
    fun play(file: File, speed: Float, onDone: () -> Unit)
    fun restart()
    fun setSpeed(speed: Float)
    fun stop()

    companion object {
        /** Tests swap this. */
        @Volatile var factory: () -> ListeningPlayer = { MediaListeningPlayer() }
    }
}

class MediaListeningPlayer : ListeningPlayer {
    private var mp: MediaPlayer? = null

    override fun play(file: File, speed: Float, onDone: () -> Unit) {
        stop()
        val p = MediaPlayer()
        mp = p
        runCatching {
            p.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
            p.setDataSource(file.absolutePath)
            p.setOnPreparedListener { runCatching { if (speed != 1f) it.playbackParams = it.playbackParams.setSpeed(speed) }; it.start() }
            p.setOnCompletionListener { if (mp === it) { stop(); onDone() } }
            p.setOnErrorListener { _, _, _ -> stop(); onDone(); true }
            p.prepareAsync()
        }.onFailure { stop(); onDone() }
    }

    override fun restart() {
        val p = mp ?: return
        runCatching { p.seekTo(0); if (!p.isPlaying) p.start() }
    }

    override fun setSpeed(speed: Float) {
        val p = mp ?: return
        runCatching { val was = p.isPlaying; p.playbackParams = p.playbackParams.setSpeed(speed); if (!was) p.pause() }
    }

    override fun stop() {
        mp?.runCatching { release() }
        mp = null
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

    /** A tap on a hidden bubble: play its clip (cache-first); a tap while it plays replays from the start. */
    fun tap(m: ChatMessageDto) {
        val l = ui.value.listening
        val p = player
        if (l.playing == m.id && p != null) {
            p.restart()
            update { it.copy(playNonce = it.playNonce + 1) }
            return
        }
        stopOthers()
        stop()
        update { it.copy(loading = m.id) }
        scope.launch {
            // Exactly what Read aloud plays: the same voice, the same cached file (text + voice + speed).
            val file = runCatching { voiceOf(m).let { (voice, speed) -> clips.clip(m.content, voice, speed) } }.getOrNull()
            if (ui.value.listening.loading != m.id) return@launch
            if (file == null) {
                update { it.copy(loading = null) }
                notice(if (app.online.value) "Couldn't play that message." else "Audio not downloaded yet — it downloads when you're online.")
                return@launch
            }
            measure(m.id, file)
            val next = ListeningPlayer.factory()
            player = next
            update { it.copy(loading = null, playing = m.id, playNonce = it.playNonce + 1) }
            next.play(file, if (ui.value.listening.slow) SLOW else 1f) {
                if (player === next) { player = null; update { it.copy(playing = null) } }
            }
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
                clips.cached(m.content, voice, speed)?.let { measure(m.id, it) }
            }
        }
    }

    fun stop() {
        player?.stop()
        player = null
        if (ui.value.listening.playing != null || ui.value.listening.loading != null) update { it.copy(playing = null, loading = null) }
    }

    companion object {
        const val SLOW = 0.75f
        const val REVEAL_MS = 700L
    }
}
