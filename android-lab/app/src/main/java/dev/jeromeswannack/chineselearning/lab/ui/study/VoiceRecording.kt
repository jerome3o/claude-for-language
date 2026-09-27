package dev.jeromeswannack.chineselearning.lab.ui.study

import android.content.Context
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.os.Build
import dev.jeromeswannack.chineselearning.lab.core.AnswerKey
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.File

/** `TranscriptionComparison` (hooks/useTranscription.ts). */
data class TranscriptionComparison(
    val transcribedHanzi: String,
    val transcribedPinyin: String,
    val isMatch: Boolean,
    /** Not an exact match, but the word appears inside what was said. */
    val containsExpected: Boolean,
)

object Transcription {
    private val NON_PINYIN = Regex("[^a-zA-Zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]")
    private val SPACES = Regex("\\s+")

    /** `normalizePinyin`: lowercase, no spaces, only letters and tone-marked vowels. */
    fun normalizePinyin(py: String): String = NON_PINYIN.replace(SPACES.replace(py.lowercase(), ""), "")

    /**
     * `compareTranscription`: both sides to tone-marked pinyin (numbers normalised to hanzi
     * first; 两 and 二 treated alike), so a homophone written differently still matches.
     */
    fun compare(transcribed: String, expectedHanzi: String, pinyin: (String) -> String = Pinyin::of): TranscriptionComparison {
        val original = transcribed.trim()
        val heard = AnswerKey.normalizeNumbersToHanzi(original)
        val expected = AnswerKey.normalizeNumbersToHanzi(expectedHanzi)
        fun key(h: String) = normalizePinyin(pinyin(h))
        val tKey = key(heard)
        val eKey = key(expected)
        val tAlt = key(heard.replace("两", "二"))
        val eAlt = key(expected.replace("两", "二"))
        val match = tKey == eKey || tAlt == eAlt
        val contains = !match && eKey.isNotEmpty() && (tKey.contains(eKey) || tAlt.contains(eAlt))
        return TranscriptionComparison(original, pinyin(heard), match, contains)
    }
}

/** What the card shows about the recording on its back. */
sealed interface TranscriptionUi {
    data object Working : TranscriptionUi
    /** Offline: "Recording saved, will transcribe when online". */
    data object Offline : TranscriptionUi
    /** Failed: nothing shown (the recording is still saved). */
    data object Failed : TranscriptionUi
    data class Done(val result: TranscriptionComparison) : TranscriptionUi
}

/**
 * The microphone for "Record your pronunciation" (the web's useAudioRecorder): webm/Opus
 * like the browser's MediaRecorder where the phone can (API 29+), AAC in MP4 before that;
 * [level] is 0..1 for the meter. And one player for "Play my recording".
 *
 * [startLive] records raw 16 kHz mono PCM instead (AudioRecord), hands every 100 ms to the
 * live transcriber (Soniox) and keeps the take as a WAV — so "You said" is ready at Stop.
 */
class VoiceRecorder(private val context: Context, private val scope: CoroutineScope) {
    private var recorder: MediaRecorder? = null
    private var file: File? = null
    private var meter: Job? = null
    private var player: MediaPlayer? = null
    private val _level = MutableStateFlow(0f)
    val level: StateFlow<Float> = _level

    /** The current / last take's type (webm or m4a from MediaRecorder, wav from [startLive]). */
    var mime: String = defaultMime
        private set
    private val defaultMime: String get() = if (Build.VERSION.SDK_INT >= 29) "audio/webm" else "audio/mp4"
    private val ext: String get() = if (Build.VERSION.SDK_INT >= 29) "webm" else "m4a"

    private var pcm: PcmTake? = null
    val recording: Boolean get() = recorder != null || pcm != null

    /** A take streamed as it is spoken: [onAudio] gets 16-bit mono PCM at 16 kHz. */
    @android.annotation.SuppressLint("MissingPermission") // the card asks for RECORD_AUDIO first
    fun startLive(onAudio: (ByteArray, Int) -> Unit): Boolean {
        stopQuietly()
        val out = File(File(context.cacheDir, "takes").apply { mkdirs() }, "take-${System.currentTimeMillis()}.wav")
        val take = PcmTake.start(out, SonioxProtocol.SAMPLE_RATE, onAudio) { _level.value = it } ?: return false
        pcm = take
        file = out
        mime = "audio/wav"
        return true
    }

    /** Starts a new take; false when the microphone can't be opened. */
    fun start(): Boolean {
        stopQuietly()
        val out = File(File(context.cacheDir, "takes").apply { mkdirs() }, "take-${System.currentTimeMillis()}.$ext")
        val r = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(context) else @Suppress("DEPRECATION") MediaRecorder()
        mime = defaultMime
        return try {
            r.setAudioSource(MediaRecorder.AudioSource.MIC)
            if (Build.VERSION.SDK_INT >= 29) {
                r.setOutputFormat(MediaRecorder.OutputFormat.WEBM)
                r.setAudioEncoder(MediaRecorder.AudioEncoder.OPUS)
            } else {
                r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            }
            r.setAudioSamplingRate(48_000)
            r.setAudioEncodingBitRate(64_000)
            r.setOutputFile(out.absolutePath)
            r.prepare()
            r.start()
            recorder = r
            file = out
            meter = scope.launch {
                while (isActive) {
                    _level.value = runCatching { (recorder?.maxAmplitude ?: 0) / 32767f }.getOrDefault(0f)
                    delay(80)
                }
            }
            true
        } catch (e: Exception) {
            runCatching { r.release() }
            out.delete()
            false
        }
    }

    /** Stops and returns the take (null when it failed or was too short to hold anything). */
    fun stop(): File? {
        pcm?.let { take ->
            pcm = null
            _level.value = 0f
            val ok = take.stop()
            val f = file
            file = null
            return f?.takeIf { ok } ?: run { f?.delete(); null }
        }
        val r = recorder ?: return null
        meter?.cancel()
        _level.value = 0f
        recorder = null
        val ok = runCatching { r.stop() }.isSuccess
        runCatching { r.release() }
        val f = file
        file = null
        return f?.takeIf { ok && it.length() > 0 } ?: run { f?.delete(); null }
    }

    private fun stopQuietly() {
        stop()?.delete()
    }

    fun play(take: File, onDone: () -> Unit = {}) {
        player?.release()
        player = MediaPlayer().apply {
            runCatching {
                setDataSource(take.absolutePath)
                setOnCompletionListener { onDone() }
                prepare()
                start()
            }
        }
    }

    fun release() {
        stopQuietly()
        player?.release()
        player = null
    }
}

/**
 * A PCM take: AudioRecord on its own thread, 100 ms buffers to [onAudio] (the live
 * transcriber) and into a WAV file whose header sizes are filled in at [stop].
 */
class PcmTake private constructor(
    private val record: android.media.AudioRecord,
    private val out: File,
    private val sampleRate: Int,
    private val onAudio: (ByteArray, Int) -> Unit,
    private val onLevel: (Float) -> Unit,
) {
    @Volatile private var running = true
    private var bytes = 0L
    private val thread = Thread({ loop() }, "pcm-take")

    private fun loop() {
        val buf = ByteArray(sampleRate / 10 * 2) // 100 ms of 16-bit mono
        java.io.RandomAccessFile(out, "rw").use { raf ->
            raf.setLength(0)
            raf.write(Wav.header(sampleRate, 0))
            while (running) {
                val n = record.read(buf, 0, buf.size)
                if (n <= 0) { if (n < 0) break else continue }
                raf.write(buf, 0, n)
                bytes += n
                onLevel(Wav.peak(buf, n))
                runCatching { onAudio(buf, n) }
            }
            raf.seek(0)
            raf.write(Wav.header(sampleRate, bytes))
        }
    }

    /** Stops the microphone; true when the take holds any audio. */
    fun stop(): Boolean {
        running = false
        runCatching { record.stop() }
        runCatching { thread.join(1_000) }
        runCatching { record.release() }
        return bytes > 0
    }

    companion object {
        @android.annotation.SuppressLint("MissingPermission")
        fun start(out: File, sampleRate: Int, onAudio: (ByteArray, Int) -> Unit, onLevel: (Float) -> Unit): PcmTake? {
            val min = android.media.AudioRecord.getMinBufferSize(sampleRate, android.media.AudioFormat.CHANNEL_IN_MONO, android.media.AudioFormat.ENCODING_PCM_16BIT)
            if (min <= 0) return null
            val record = runCatching {
                android.media.AudioRecord(
                    MediaRecorder.AudioSource.MIC, sampleRate, android.media.AudioFormat.CHANNEL_IN_MONO,
                    android.media.AudioFormat.ENCODING_PCM_16BIT, maxOf(min, sampleRate / 10 * 2 * 4),
                )
            }.getOrNull() ?: return null
            if (record.state != android.media.AudioRecord.STATE_INITIALIZED || runCatching { record.startRecording() }.isFailure) {
                runCatching { record.release() }
                return null
            }
            return PcmTake(record, out, sampleRate, onAudio, onLevel).also { it.thread.start() }
        }
    }
}

/** 16-bit mono PCM WAV helpers. */
object Wav {
    fun header(sampleRate: Int, dataBytes: Long): ByteArray {
        val b = java.nio.ByteBuffer.allocate(44).order(java.nio.ByteOrder.LITTLE_ENDIAN)
        b.put("RIFF".toByteArray()).putInt((36 + dataBytes).toInt()).put("WAVE".toByteArray())
        b.put("fmt ".toByteArray()).putInt(16).putShort(1).putShort(1).putInt(sampleRate).putInt(sampleRate * 2).putShort(2).putShort(16)
        b.put("data".toByteArray()).putInt(dataBytes.toInt())
        return b.array()
    }

    /** Loudest sample in the buffer, 0..1 (the meter). */
    fun peak(buf: ByteArray, n: Int): Float {
        var max = 0
        var i = 0
        while (i + 1 < n) {
            val v = (buf[i].toInt() and 0xFF) or (buf[i + 1].toInt() shl 8)
            val a = kotlin.math.abs(v.toShort().toInt())
            if (a > max) max = a
            i += 2
        }
        return max / 32767f
    }
}
