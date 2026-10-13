package dev.jeromeswannack.chineselearning.lab.data.podcasts

import android.media.AudioAttributes
import android.media.MediaPlayer
import dev.jeromeswannack.chineselearning.lab.data.readers.ReaderPlaybackSpeed
import dev.jeromeswannack.chineselearning.lab.data.readers.asSpeedPlayer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.File

/**
 * Plays a podcast episode a segment at a time (docs/PODCASTS.md): one [MediaPlayer] over the saved
 * file; [play] seeks to a time and, with a stop time, pauses itself there (one segment, then
 * silence to think); without one it plays on (continuous listening). Speed at playback with the
 * pitch kept, like the reader ([ReaderPlaybackSpeed]). [state] ticks every 40 ms while playing.
 */
class SegmentPlayer(private val scope: CoroutineScope) {
    data class State(val playing: Boolean = false, val positionMs: Long = 0, val durationMs: Long = 0, val loaded: Boolean = false)

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    /** Called once when playback reaches the stop time of [play] (or the end of the file). */
    var onStopped: (() -> Unit)? = null

    private var player: MediaPlayer? = null
    private var file: File? = null
    private var stopAt: Long? = null
    /** Where [play] seeked to: the stop time only counts once the player reports a position past it
     *  (right after a seek it can still report the old one, which may be beyond the new stop). */
    private var seekedTo: Long? = null
    private var seekedAt = 0L
    private var ticker: Job? = null

    /** Load [f] (a no-op when it is already loaded). False when the file can't be played. */
    fun load(f: File): Boolean {
        if (file == f && player != null) return true
        release()
        val mp = runCatching {
            MediaPlayer().apply {
                setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                setDataSource(f.absolutePath)
                prepare()
                setOnCompletionListener {
                    stopTicker()
                    _state.update { it.copy(playing = false, positionMs = it.durationMs) }
                    onStopped?.invoke()
                }
            }
        }.getOrNull() ?: return false
        player = mp
        file = f
        _state.value = State(loaded = true, durationMs = runCatching { mp.duration.toLong() }.getOrDefault(0))
        return true
    }

    fun play(fromMs: Long, stopAtMs: Long?, speed: Double) {
        val mp = player ?: return
        stopAt = stopAtMs
        seekedTo = fromMs
        seekedAt = System.currentTimeMillis()
        runCatching {
            mp.seekTo(fromMs, MediaPlayer.SEEK_CLOSEST)
            ReaderPlaybackSpeed.start(mp.asSpeedPlayer(), speed)
        }.onFailure { return }
        _state.update { it.copy(playing = true, positionMs = fromMs) }
        startTicker()
    }

    /** Continue from where it is (continuous listening), at [speed]. */
    fun resume(speed: Double, stopAtMs: Long? = null) {
        val mp = player ?: return
        stopAt = stopAtMs
        runCatching { ReaderPlaybackSpeed.start(mp.asSpeedPlayer(), speed) }.onFailure { return }
        _state.update { it.copy(playing = true) }
        startTicker()
    }

    /** The playing segment's stop time changed (continuous listening switched on / off). */
    fun setStopAt(ms: Long?) {
        stopAt = ms
    }

    fun setSpeed(speed: Double) {
        player?.let { ReaderPlaybackSpeed.change(it.asSpeedPlayer(), speed) }
    }

    fun pause() {
        runCatching { player?.pause() }
        stopTicker()
        _state.update { it.copy(playing = false, positionMs = position()) }
    }

    fun seek(ms: Long) {
        runCatching { player?.seekTo(ms, MediaPlayer.SEEK_CLOSEST) }
        _state.update { it.copy(positionMs = ms) }
    }

    fun release() {
        stopTicker()
        runCatching { player?.release() }
        player = null
        file = null
        _state.value = State()
    }

    private fun position(): Long = runCatching { player?.currentPosition?.toLong() }.getOrNull() ?: _state.value.positionMs

    private fun startTicker() {
        ticker?.cancel()
        ticker = scope.launch {
            while (isActive) {
                val pos = position()
                val target = seekedTo
                val settled = target == null || (pos >= target - 400 && pos < target + 5_000) || System.currentTimeMillis() - seekedAt > 2_000
                if (settled) seekedTo = null
                if (settled) _state.update { it.copy(positionMs = pos) }
                val stop = stopAt
                if (settled && stop != null && pos >= stop) {
                    runCatching { player?.pause() }
                    _state.update { it.copy(playing = false) }
                    stopAt = null
                    onStopped?.invoke()
                    break
                }
                delay(40)
            }
        }
    }

    private fun stopTicker() {
        ticker?.cancel()
        ticker = null
    }
}
