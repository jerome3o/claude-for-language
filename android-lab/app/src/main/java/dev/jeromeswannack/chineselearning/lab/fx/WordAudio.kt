package dev.jeromeswannack.chineselearning.lab.fx

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.speech.tts.TextToSpeech
import dev.jeromeswannack.chineselearning.lab.Config
import dev.jeromeswannack.chineselearning.lab.data.Repository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.util.Locale

/**
 * Card / sentence audio: the downloaded clip if we have it, else stream it, else the
 * device's Chinese voice (like the web app's offline fallback). One clip at a time.
 */
class WordAudio(private val context: Context, private val repo: Repository) {
    private var player: MediaPlayer? = null
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var pendingSpeech: String? = null
    private val _playingKey = MutableStateFlow<String?>(null)
    /** What is playing now (the audio key, or "tts:<text>"), for the lit-up ▶ buttons. */
    val playingKey: StateFlow<String?> = _playingKey

    fun play(key: String?, fallbackText: String, online: Boolean) {
        stop()
        val file = repo.cachedAudio(key)
        val source = when {
            file != null -> file.absolutePath
            // Forced offline (StudyPrefs — Settings or the study pill): never stream.
            !key.isNullOrBlank() && online && !dev.jeromeswannack.chineselearning.lab.data.settings.SettingsStore.forcedOffline(context) -> Config.audioUrl(key, repo.api.baseUrl)
            else -> null
        }
        if (source == null) {
            speak(fallbackText)
            return
        }
        val id = key!!
        val mp = MediaPlayer()
        player = mp
        _playingKey.value = id
        try {
            mp.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
            mp.setDataSource(source)
            mp.setOnPreparedListener { it.start() }
            mp.setOnCompletionListener { if (player === it) { _playingKey.value = null; it.release(); player = null } }
            mp.setOnErrorListener { p, _, _ ->
                if (player === p) { p.release(); player = null; speak(fallbackText) }
                true
            }
            mp.prepareAsync()
        } catch (e: Exception) {
            mp.release()
            player = null
            speak(fallbackText)
        }
    }

    private fun speak(text: String) {
        if (text.isBlank()) { _playingKey.value = null; return }
        _playingKey.value = "tts:$text"
        val engine = tts
        if (engine == null) {
            pendingSpeech = text
            tts = TextToSpeech(context) { status ->
                ttsReady = status == TextToSpeech.SUCCESS
                tts?.language = Locale.SIMPLIFIED_CHINESE
                pendingSpeech?.let { tts?.speak(it, TextToSpeech.QUEUE_FLUSH, null, "lab") }
                pendingSpeech = null
            }
        } else if (ttsReady) {
            engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, "lab")
        }
    }

    fun stop() {
        player?.let { runCatching { it.stop() }; it.release() }
        player = null
        tts?.stop()
        _playingKey.value = null
    }

    fun release() {
        stop()
        tts?.shutdown()
        tts = null
    }
}
