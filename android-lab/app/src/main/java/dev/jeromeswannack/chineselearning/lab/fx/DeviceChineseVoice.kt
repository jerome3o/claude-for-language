package dev.jeromeswannack.chineselearning.lab.fx

import android.content.Context
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import dev.jeromeswannack.chineselearning.lab.core.ChatVoice
import java.util.Locale

/**
 * The phone's own Mandarin voice, for when a generated clip isn't on the phone and there is no
 * connection (chat read-aloud offline). Always a zh-CN voice, of the sender's gender where the
 * engine names one ([ChatVoice.pickDeviceVoice]) — never whatever the engine's default is.
 */
class DeviceChineseVoice(private val context: Context) {
    private var tts: TextToSpeech? = null
    private var ready = false
    private var pending: (() -> Unit)? = null
    private var onDone: (() -> Unit)? = null

    /** Speaks [text]; [onDone] runs (on the main thread's caller side, best effort) when it ends or can't play. */
    fun speak(text: String, gender: String?, onDone: () -> Unit = {}) {
        if (text.isBlank()) { onDone(); return }
        this.onDone = onDone
        val run: () -> Unit = {
            val engine = tts
            if (engine == null || !ready) finish() else {
                val voices = runCatching { engine.voices.orEmpty() }.getOrDefault(emptySet())
                val choice = ChatVoice.pickDeviceVoice(voices.map { it.flatten() }, gender)
                val voice = choice?.let { c -> voices.firstOrNull { it.name == c.name } }
                if (voice != null) engine.voice = voice else engine.language = Locale.SIMPLIFIED_CHINESE
                engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, UTTERANCE)
                Unit
            }
        }
        if (tts == null) {
            pending = run
            tts = TextToSpeech(context) { status ->
                ready = status == TextToSpeech.SUCCESS
                tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(utteranceId: String?) {}
                    override fun onDone(utteranceId: String?) = finish()
                    @Deprecated("Deprecated in Java")
                    override fun onError(utteranceId: String?) = finish()
                    override fun onError(utteranceId: String?, errorCode: Int) = finish()
                })
                pending?.invoke()
                pending = null
            }
        } else {
            run()
        }
    }

    private fun finish() {
        val cb = onDone
        onDone = null
        cb?.invoke()
    }

    fun stop() {
        onDone = null
        pending = null
        tts?.stop()
    }

    fun shutdown() {
        stop()
        tts?.shutdown()
        tts = null
    }

    private fun Voice.flatten() = ChatVoice.DeviceVoice(
        name = name,
        language = locale?.language.orEmpty(),
        country = locale?.country.orEmpty(),
        quality = quality,
        needsNetwork = isNetworkConnectionRequired,
    )

    private companion object {
        const val UTTERANCE = "chat-read-aloud"
    }
}
