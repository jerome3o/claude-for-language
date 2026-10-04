package dev.jeromeswannack.chineselearning.lab.data.lessons

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.speech.tts.TextToSpeech
import dev.jeromeswannack.chineselearning.lab.data.readers.ReaderPlaybackSpeed
import dev.jeromeswannack.chineselearning.lab.data.readers.asSpeedPlayer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import java.io.File
import java.util.Locale
import kotlin.coroutines.resume

/**
 * Lesson / reader playback (the web's `useOfflineSpeak` + `useLessonClips`): one clip at a
 * time, cache-first through [LessonMedia]. [speak] is fire-and-forget and falls back to the
 * phone's Chinese voice when a clip can't be had offline (like the Lab's card audio);
 * [playClip] awaits the end of a clip and reports false when it couldn't play, so a
 * conversation can say its audio isn't on the device yet.
 */
class LessonAudio(
    private val context: Context,
    private val media: LessonMedia,
    private val scope: CoroutineScope,
    private val online: () -> Boolean,
) {
    private var player: MediaPlayer? = null
    /** The current clip follows the reader's speed chip ([changeSpeed]); lesson clips don't. */
    private var speedControlled = false
    private var job: Job? = null
    private var claim = 0
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var pendingSpeech: String? = null

    private val _playing = MutableStateFlow<String?>(null)
    /** The text (or "file:<path>") playing now, for lit-up buttons. */
    val playing: StateFlow<String?> = _playing

    /**
     * Plays [text] (default voice unless [voice]); newest call wins. [speed] = the reader's speed
     * chip (pitch kept, the clip is never regenerated); null = normal and not chip-controlled.
     */
    fun speak(text: String, voice: String? = null, speed: Double? = null) {
        if (text.isBlank()) return
        val id = stopInternal()
        job = scope.launch {
            val file = media.tts(text, voice, online = online())
            if (id != claim) return@launch
            if (file == null) deviceSpeak(text) else start(file, text, id, speed, null)
        }
    }

    /**
     * One clip, awaited: true when it finished, false when it couldn't play (≤ 30 s, then moves on).
     * [speed] is the TTS rate baked into the clip (a conversation line's ConversationVoices.SPEED).
     */
    suspend fun playClip(text: String, voice: String? = null, speed: Double = LessonMedia.DEFAULT_SPEED): Boolean {
        val id = stopInternal()
        val file = media.tts(text, voice, speed = speed, online = online()) ?: return false
        if (id != claim) return false
        return withTimeoutOrNull(CLIP_TIMEOUT_MS) {
            suspendCancellableCoroutine { cont ->
                start(file, text, id, null) { ok -> if (cont.isActive) cont.resume(ok) }
                cont.invokeOnCancellation { if (id == claim) scope.launch { stop() } }
            }
        } ?: (id == claim)
    }

    /** A local recording (oral expression "Listen back"). */
    fun playFile(file: File) {
        val id = stopInternal()
        start(file, "file:${file.absolutePath}", id, null, null)
    }

    /** A reader page's narration, cached under its page key (readerTtsKey); [speed] as in [speak]. */
    fun playFileFor(label: String, file: File, onDone: ((Boolean) -> Unit)? = null, speed: Double? = null) {
        val id = stopInternal()
        start(file, label, id, speed, onDone)
    }

    /** The reader's speed chip moved: a chip-controlled clip that is playing changes speed in place. */
    fun changeSpeed(speed: Double) {
        val mp = player ?: return
        if (speedControlled) ReaderPlaybackSpeed.change(mp.asSpeedPlayer(), speed)
    }

    private fun start(file: File, label: String, id: Int, speed: Double?, onDone: ((Boolean) -> Unit)?) {
        val mp = MediaPlayer()
        player = mp
        speedControlled = speed != null
        _playing.value = label
        fun finish(ok: Boolean) {
            if (player === mp) { player = null; _playing.value = null }
            runCatching { mp.release() }
            onDone?.invoke(ok)
        }
        try {
            mp.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
            mp.setDataSource(file.absolutePath)
            mp.setOnPreparedListener {
                when {
                    id != claim -> finish(false)
                    speed != null -> ReaderPlaybackSpeed.start(it.asSpeedPlayer(), speed)
                    else -> it.start()
                }
            }
            mp.setOnCompletionListener { finish(true) }
            mp.setOnErrorListener { _, _, _ -> finish(false); true }
            mp.prepareAsync()
        } catch (e: Exception) {
            finish(false)
        }
    }

    private fun deviceSpeak(text: String) {
        val engine = tts
        if (engine == null) {
            pendingSpeech = text
            tts = TextToSpeech(context) { status ->
                ttsReady = status == TextToSpeech.SUCCESS
                tts?.language = Locale.SIMPLIFIED_CHINESE
                pendingSpeech?.let { tts?.speak(it, TextToSpeech.QUEUE_FLUSH, null, "lesson") }
                pendingSpeech = null
            }
        } else if (ttsReady) {
            engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, "lesson")
        }
    }

    private fun stopInternal(): Int {
        job?.cancel()
        job = null
        player?.let { runCatching { it.stop() }; runCatching { it.release() } }
        player = null
        tts?.stop()
        _playing.value = null
        return ++claim
    }

    fun stop() {
        stopInternal()
    }

    private companion object {
        const val CLIP_TIMEOUT_MS = 30_000L
    }
}
