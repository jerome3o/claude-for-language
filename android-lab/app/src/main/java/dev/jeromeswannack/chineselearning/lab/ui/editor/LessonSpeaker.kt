package dev.jeromeswannack.chineselearning.lab.ui.editor

import android.media.AudioAttributes
import android.media.MediaPlayer
import android.util.Base64
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.data.api.practiceTts
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.security.MessageDigest

/**
 * The editors' 🔊: cache-first lesson TTS, the same clip the learner's lesson plays
 * (`/api/practice/tts` at speed 0.6, the web's `useLessonSpeak` → `getTTSWithCache`). A clip
 * spoken once is kept on the phone; offline with nothing cached it falls back to the phone's
 * Chinese voice. One clip at a time — a new tap stops the last.
 */
class LessonSpeaker(private val app: LabApp, private val scope: CoroutineScope) {
    private var player: MediaPlayer? = null
    private var job: Job? = null
    private val dir: File by lazy { File(app.filesDir, "lesson-tts").apply { mkdirs() } }

    private fun fileFor(text: String): File {
        val hash = MessageDigest.getInstance("SHA-1").digest("$text|0.6".toByteArray()).joinToString("") { "%02x".format(it) }
        return File(dir, "$hash.mp3")
    }

    fun speak(text: String) {
        val t = text.trim()
        if (t.isEmpty()) return
        stop()
        app.haptics.tick()
        job = scope.launch {
            val file = fileFor(t)
            val ready = file.exists() || (app.online.value && withContext(Dispatchers.IO) {
                runCatching {
                    val tts = app.repo.api.practiceTts(t)
                    file.writeBytes(Base64.decode(tts.audio_base64, Base64.DEFAULT))
                }.isSuccess
            })
            if (ready) play(file) else app.audio.play(null, t, online = false)
        }
    }

    private fun play(file: File) {
        app.audio.stop()
        val mp = MediaPlayer()
        player = mp
        runCatching {
            mp.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
            mp.setDataSource(file.absolutePath)
            mp.setOnPreparedListener { it.start() }
            mp.setOnCompletionListener { if (player === it) { it.release(); player = null } }
            mp.prepareAsync()
        }.onFailure {
            mp.release()
            player = null
            file.delete()
        }
    }

    fun stop() {
        job?.cancel()
        player?.let { runCatching { it.stop() }; it.release() }
        player = null
    }
}
