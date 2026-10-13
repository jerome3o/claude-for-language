package dev.jeromeswannack.chineselearning.lab.data.calls

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import dev.jeromeswannack.chineselearning.lab.core.calls.CallChime

/**
 * Plays the call's chimes (core CallChime: someone joined / left, the timer reached zero) — synthesised
 * PCM, no audio files. With the call's audio (voice-communication signalling), so it comes out where
 * the call does (speaker, earpiece, headset) and never interrupts the call's own audio focus.
 */
class CallChimePlayer {
    private val pcm = HashMap<CallChime.Kind, ShortArray>()

    fun play(kind: CallChime.Kind) {
        runCatching {
            val data = pcm.getOrPut(kind) { CallChime.chimePcm(kind, RATE) }
            val track = AudioTrack.Builder()
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION_SIGNALLING)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build(),
                )
                .setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(RATE).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
                .setTransferMode(AudioTrack.MODE_STATIC)
                .setBufferSizeInBytes(data.size * 2)
                .build()
            track.write(data, 0, data.size)
            track.setNotificationMarkerPosition(data.size)
            track.setPlaybackPositionUpdateListener(object : AudioTrack.OnPlaybackPositionUpdateListener {
                override fun onMarkerReached(t: AudioTrack) { runCatching { t.release() } }
                override fun onPeriodicNotification(t: AudioTrack) {}
            })
            track.play()
        }
    }

    private companion object {
        const val RATE = 44_100
    }
}
