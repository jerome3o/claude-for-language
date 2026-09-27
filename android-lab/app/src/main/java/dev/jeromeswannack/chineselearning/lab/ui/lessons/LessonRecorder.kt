package dev.jeromeswannack.chineselearning.lab.ui.lessons

import android.content.Context
import android.media.MediaRecorder
import android.os.Build
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.File

/**
 * The microphone for oral expression (the web's useAudioRecorder): AAC in an MP4
 * container (`audio/mp4`), with a live input level for the meter. One recording at a
 * time; [start] again replaces the last take.
 */
class LessonRecorder(private val context: Context, private val scope: CoroutineScope, private val newFile: () -> File) {
    private var recorder: MediaRecorder? = null
    private var levelJob: Job? = null
    private var file: File? = null

    private val _recording = MutableStateFlow(false)
    val recording: StateFlow<Boolean> = _recording
    private val _level = MutableStateFlow(0f)
    /** 0..1 — the input level while recording. */
    val level: StateFlow<Float> = _level
    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error

    val mime = "audio/mp4"

    /** Starts a take; false (with [error]) when the microphone can't be used. */
    fun start(): Boolean {
        stopRecorder()
        val out = newFile()
        return try {
            @Suppress("DEPRECATION")
            val r = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(context) else MediaRecorder()
            r.setAudioSource(MediaRecorder.AudioSource.MIC)
            r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            r.setAudioEncodingBitRate(64_000)
            r.setAudioSamplingRate(44_100)
            r.setOutputFile(out.absolutePath)
            r.prepare()
            r.start()
            recorder = r
            file = out
            _error.value = null
            _recording.value = true
            levelJob = scope.launch {
                while (isActive) {
                    _level.value = (runCatching { r.maxAmplitude }.getOrDefault(0) / 20_000f).coerceIn(0f, 1f)
                    delay(100)
                }
            }
            true
        } catch (e: Exception) {
            out.delete()
            _error.value = "The microphone isn't available — ${e.message ?: "couldn't start recording"}."
            _recording.value = false
            false
        }
    }

    /** Stops the take; the file, or null when nothing usable was recorded. */
    fun stop(): File? {
        val f = file
        val ok = stopRecorder()
        return f?.takeIf { ok && it.exists() && it.length() > 0 }
    }

    private fun stopRecorder(): Boolean {
        levelJob?.cancel()
        levelJob = null
        _level.value = 0f
        val r = recorder ?: return false
        recorder = null
        _recording.value = false
        val ok = runCatching { r.stop() }.isSuccess
        r.release()
        return ok
    }

    fun setError(message: String?) {
        _error.value = message
    }

    fun release() {
        stopRecorder()
    }
}
