package dev.jeromeswannack.chineselearning.lab.data.clips

import android.content.Context
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.RawResourceDataSource
import androidx.media3.exoplayer.ExoPlayer
import dev.jeromeswannack.chineselearning.lab.R
import dev.jeromeswannack.chineselearning.lab.core.clips.ClipMusic

/**
 * 🎬 The lo-fi beat under the clips feed (core [ClipMusic]; web pages/ClipsPage.tsx): one looping
 * ExoPlayer on the theme's res/raw track (made by scripts/audio/generate-clip-music.mjs, CC0),
 * its volume stepped every frame by the duck. Created lazily on the first play.
 */
@OptIn(UnstableApi::class)
class ClipMusicPlayer private constructor(private val context: Context, private val res: Int) {
    private var player: ExoPlayer? = null
    private var volume = ClipMusic.VOLUME.toFloat()

    private fun player(): ExoPlayer = player ?: ExoPlayer.Builder(context)
        .setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), false)
        .build()
        .also { p ->
            p.setMediaItem(MediaItem.fromUri(RawResourceDataSource.buildRawResourceUri(res)))
            p.repeatMode = Player.REPEAT_MODE_ONE
            p.volume = volume
            p.prepare()
            player = p
        }

    fun play() = player().play()
    fun pause() { player?.pause() }
    fun setVolume(v: Float) {
        volume = v
        player?.volume = v
    }
    fun release() {
        player?.release()
        player = null
    }

    companion object {
        fun create(context: Context, track: ClipMusic.Track): ClipMusicPlayer = ClipMusicPlayer(
            context,
            when (track.raw) {
                "clip_beat_nightbus" -> R.raw.clip_beat_nightbus
                "clip_beat_rain" -> R.raw.clip_beat_rain
                else -> R.raw.clip_beat_cafe
            },
        )
    }
}
