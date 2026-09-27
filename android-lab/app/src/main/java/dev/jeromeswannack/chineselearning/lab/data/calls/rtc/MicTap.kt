package dev.jeromeswannack.chineselearning.lab.data.calls.rtc

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.SystemClock
import android.util.Log
import dev.jeromeswannack.chineselearning.lab.core.calls.PcmTo48kMono
import org.webrtc.audio.JavaAudioDeviceModule

/**
 * The microphone as 48 kHz mono PCM for the call recorder.
 *
 * While a peer is connected, WebRTC's own capture (echo-cancelled, the same audio the other person
 * hears) is tapped through the audio module's samples callback. WebRTC only captures while it is
 * sending, though — alone in a test call, or before the other person joins, nothing would be
 * recorded — so when its samples stop for [GAP_MS] the tap opens its own AudioRecord, and closes it
 * again as soon as WebRTC's samples come back (never two captures fighting over the mic for long).
 */
class MicTap {
    @Volatile private var consumer: ((ShortArray) -> Unit)? = null
    @Volatile private var lastWebRtcAt = 0L
    private var webrtcConverter: Pair<Pair<Int, Int>, PcmTo48kMono>? = null
    private var thread: Thread? = null

    /** Starts delivering the mic to [onPcm] (on the audio threads — keep it quick); null stops. */
    @Synchronized
    fun setConsumer(onPcm: ((ShortArray) -> Unit)?) {
        consumer = onPcm
        if (onPcm != null && thread == null) thread = Thread(::fallbackLoop, "call-mic-fallback").also { it.start() }
        if (onPcm == null) { thread?.interrupt(); thread = null }
    }

    /** JavaAudioDeviceModule.SamplesReadyCallback. */
    fun fromWebRtc(samples: JavaAudioDeviceModule.AudioSamples) {
        lastWebRtcAt = SystemClock.elapsedRealtime()
        val c = consumer ?: return
        val key = samples.sampleRate to samples.channelCount
        val conv = webrtcConverter?.takeIf { it.first == key }?.second ?: PcmTo48kMono(samples.sampleRate, samples.channelCount).also { webrtcConverter = key to it }
        c(conv.convert(samples.data))
    }

    @SuppressLint("MissingPermission") // the call screen only records after RECORD_AUDIO is granted
    private fun fallbackLoop() {
        var record: AudioRecord? = null
        val buf = ShortArray(480)
        try {
            while (!Thread.currentThread().isInterrupted && consumer != null) {
                val webrtcLive = SystemClock.elapsedRealtime() - lastWebRtcAt < GAP_MS
                if (webrtcLive) {
                    record?.let { runCatching { it.stop() }; it.release() }
                    record = null
                    Thread.sleep(50)
                    continue
                }
                if (record == null) {
                    val min = AudioRecord.getMinBufferSize(48_000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
                    record = runCatching { AudioRecord(MediaRecorder.AudioSource.VOICE_COMMUNICATION, 48_000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(min, 48_000 / 5)) }
                        .getOrNull()?.takeIf { it.state == AudioRecord.STATE_INITIALIZED }
                    if (record == null) { Thread.sleep(500); continue }
                    record.startRecording()
                }
                val n = record.read(buf, 0, buf.size)
                if (n > 0) consumer?.invoke(buf.copyOf(n))
            }
        } catch (_: InterruptedException) {
        } catch (e: Exception) {
            Log.w("MicTap", "fallback capture stopped", e)
        } finally {
            record?.let { runCatching { it.stop() }; it.release() }
        }
    }

    companion object {
        const val GAP_MS = 300L
    }
}
