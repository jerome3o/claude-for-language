package dev.jeromeswannack.chineselearning.lab.ui.study

import android.media.MediaMetadataRetriever
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.AskClaude
import dev.jeromeswannack.chineselearning.lab.core.chat.ChatListening
import dev.jeromeswannack.chineselearning.lab.data.api.AskAnswer
import dev.jeromeswannack.chineselearning.lab.data.chat.ChatClips
import dev.jeromeswannack.chineselearning.lab.data.chat.ChatListeningStore
import dev.jeromeswannack.chineselearning.lab.ui.chat.ChatListeningMode
import dev.jeromeswannack.chineselearning.lab.ui.chat.ListeningPlayer
import dev.jeromeswannack.chineselearning.lab.ui.chat.ListeningUi
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File

/** A hidden answer that couldn't play: the line under its bubble. */
data class AskListenNotice(val id: String, val text: String)

/**
 * Ask Claude 🎧 Listen first (docs/STUDY_SESSION.md "Ask Claude"; web components/askClaude/AskClaudeSheet.tsx):
 * the chat's listening mode for Claude's answers — the same hidden bubble ([ListeningUi], the chat's
 * [ListeningPlayer], the 0.75× chip remembered under the chat's key) and the same clip Read aloud plays
 * (ChatClips: `POST /api/practice/tts`, kept by text + voice + speed) in Claude's voice
 * ([AskClaude.VOICE] at [AskClaude.SPEED]). Revealed answers are this phone's only, like the chat's.
 */
class AskListening(
    private val app: LabApp,
    private val scope: CoroutineScope,
    private val state: () -> ListeningUi,
    private val update: ((ListeningUi) -> ListeningUi) -> Unit,
    private val notice: (AskListenNotice?) -> Unit,
    /** Stops Read aloud (the lessons' player) before a clip plays. */
    private val stopOthers: () -> Unit,
) {
    private val clips: ChatClips get() = ChatClips.of(app)
    private var player: ListeningPlayer? = null
    private val lock = Mutex()

    fun start() {
        scope.launch {
            val revealed = runCatching { app.cache.get<List<String>>(REVEALED_KEY) }.getOrNull().orEmpty()
            val slow = runCatching { app.cache.get<Boolean>(ChatListeningStore.SLOW_KEY) }.getOrNull() ?: false
            update { it.copy(revealed = it.revealed + revealed, slow = slow) }
        }
    }

    /** A tap (or the auto-play of a new answer): the clip from the start; a tap while it plays replays it. */
    fun play(entry: AskAnswer, auto: Boolean = false) {
        val l = state()
        val p = player
        if (l.playing == entry.id && p != null) {
            p.restart()
            update { it.copy(playNonce = it.playNonce + 1) }
            return
        }
        stopOthers()
        stop()
        notice(null)
        update { it.copy(loading = entry.id) }
        scope.launch {
            val file = runCatching { clips.clip(entry.answer, AskClaude.VOICE, AskClaude.SPEED) }.getOrNull()
            if (state().loading != entry.id) return@launch
            if (file == null) {
                update { it.copy(loading = null) }
                notice(AskListenNotice(entry.id, if (app.online.value) "Couldn't play it — tap to try again, or hold to read it." else "🎧 Listening needs a connection the first time — hold to read it instead."))
                return@launch
            }
            measure(entry.id, file)
            val next = ListeningPlayer.factory()
            player = next
            val slow = state().slow
            app.analytics.track("study.ask_claude_listen_play", mapOf("auto" to auto, "slow" to slow))
            update { it.copy(loading = null, playing = entry.id, playNonce = it.playNonce + 1) }
            next.play(file, if (slow) ChatListeningMode.SLOW else 1f) {
                if (player === next) { player = null; update { it.copy(playing = null) } }
            }
        }
    }

    /** The 0.75× chip (the chat's, remembered on the phone). */
    fun toggleSlow() {
        val slow = !state().slow
        app.haptics.tick()
        update { it.copy(slow = slow) }
        player?.setSpeed(if (slow) ChatListeningMode.SLOW else 1f)
        scope.launch { app.cache.put(ChatListeningStore.SLOW_KEY, ChatListeningStore.KIND, slow) }
    }

    /** Long press / 👁: the answer's text for good on this phone (haptic + the chat's un-blur). */
    fun reveal(id: String) {
        if (id in state().revealed) return
        app.haptics.flip()
        if (state().playing == id || state().loading == id) stop()
        notice(null)
        app.analytics.track("study.ask_claude_listen_reveal")
        update { it.copy(revealed = it.revealed + id, justRevealed = it.justRevealed + id) }
        scope.launch { save { ChatListening.addRevealed(it, id) } }
        scope.launch { delay(ChatListeningMode.REVEAL_MS); update { it.copy(justRevealed = it.justRevealed - id) } }
    }

    /** Switched on: the answers on screen stay visible (`revealedWhenListeningOn`). */
    fun keepOnScreen(conversation: List<AskAnswer>) {
        val entries = conversation.map(::entryOf)
        scope.launch {
            val next = save { AskClaude.revealedWhenListeningOn(entries, it) }
            update { it.copy(revealed = it.revealed + next) }
        }
    }

    fun busy(): Boolean = state().playing != null || state().loading != null

    fun stop() {
        player?.stop()
        player = null
        if (state().playing != null || state().loading != null) update { it.copy(playing = null, loading = null) }
    }

    private suspend fun save(change: (List<String>) -> List<String>): List<String> = lock.withLock {
        val cur = runCatching { app.cache.get<List<String>>(REVEALED_KEY) }.getOrNull().orEmpty()
        val next = change(cur)
        app.cache.put(REVEALED_KEY, REVEALED_KIND, next)
        next
    }

    private fun measure(id: String, file: File) {
        if (id in state().durations) return
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

    companion object {
        /** The answers revealed on this phone (newest 500, never synced) — web `ask-claude-revealed-v1`. */
        const val REVEALED_KEY = "study/ask/listening/revealed"
        const val REVEALED_KIND = "ask-listening-revealed"

        fun entryOf(a: AskAnswer) = AskClaude.ListeningEntry(a.id, a.answer, a.answer_lang)
    }
}
