package dev.jeromeswannack.chineselearning.lab.ui.quests

import android.media.AudioAttributes
import android.media.MediaPlayer
import android.util.Base64
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.data.api.practiceTts
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.security.MessageDigest

/**
 * Speaks a Chinese line (quest instructions, sentence-breakdown chunks) through the same offline-capable clip cache the web uses for
 * quests (`getTTSWithCache` → `POST /api/practice/tts`): a clip is fetched once, kept under
 * `files/tts-clips/`, and played from there on the train. No clip and no connection → the
 * phone's own Chinese voice (WordAudio's fallback).
 */
class QuestSpeech(private val app: LabApp) {
    private val dir = File(app.filesDir, "tts-clips")
    private var player: MediaPlayer? = null
    private var generation = 0

    private fun fileFor(text: String): File {
        val hash = MessageDigest.getInstance("SHA-1").digest(text.toByteArray()).joinToString("") { "%02x".format(it) }
        return File(dir, "$hash.mp3")
    }

    fun speak(text: String, onEnd: (() -> Unit)? = null) {
        if (text.isBlank()) { onEnd?.invoke(); return }
        val claim = ++generation
        app.scope.launch {
            val file = fileFor(text)
            if (!file.exists() && app.online.value) {
                runCatching {
                    val clip = app.repo.api.practiceTts(text)
                    withContext(Dispatchers.IO) {
                        dir.mkdirs()
                        val tmp = File(dir, file.name + ".part")
                        tmp.writeBytes(Base64.decode(clip.audio_base64, Base64.DEFAULT))
                        tmp.renameTo(file)
                    }
                }
            }
            withContext(Dispatchers.Main) {
                if (claim != generation) return@withContext
                if (file.exists()) play(file, onEnd) else { app.audio.play(null, text, online = false); onEnd?.invoke() }
            }
        }
    }

    private fun play(file: File, onEnd: (() -> Unit)?) {
        stop()
        val mp = MediaPlayer()
        player = mp
        runCatching {
            mp.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
            mp.setDataSource(file.absolutePath)
            mp.setOnPreparedListener { it.start() }
            mp.setOnCompletionListener { if (player === it) { it.release(); player = null; onEnd?.invoke() } }
            mp.setOnErrorListener { p, _, _ -> if (player === p) { p.release(); player = null; onEnd?.invoke() }; true }
            mp.prepareAsync()
        }.onFailure {
            mp.release()
            player = null
            onEnd?.invoke()
        }
    }

    fun stop() {
        player?.let { runCatching { it.stop() }; it.release() }
        player = null
    }

    fun release() {
        generation++
        stop()
    }
}
