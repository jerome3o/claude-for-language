package dev.jeromeswannack.chineselearning.lab.data.readers

import android.content.Context
import android.content.SharedPreferences
import android.media.MediaPlayer
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.ReaderSpeed
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * The reader's playback speed on this phone (the web's services/readerSpeed.ts): 1× · 0.75× ·
 * 0.5×, chosen with the chip in the reader's audio controls (core [ReaderSpeed]), remembered
 * in prefs and shared live by every reading view (scrubber, page ▶, a word's ▶).
 */
class ReaderSpeedPref internal constructor(private val prefs: SharedPreferences) {
    private val _speed = MutableStateFlow(ReaderSpeed.parse(runCatching { prefs.getString(ReaderSpeed.STORAGE_KEY, null) }.getOrNull()))
    val speed: StateFlow<Double> = _speed

    fun set(speed: Double): Double {
        val s = ReaderSpeed.parse(speed)
        _speed.value = s
        runCatching { prefs.edit().putString(ReaderSpeed.STORAGE_KEY, Js.numberToString(s)).apply() }
        return s
    }

    /** The chip's tap: 1× → 0.75× → 0.5× → 1×. */
    fun cycle(): Double = set(ReaderSpeed.next(_speed.value))

    companion object {
        @Volatile private var instance: ReaderSpeedPref? = null

        fun of(context: Context): ReaderSpeedPref = instance ?: synchronized(this) {
            instance ?: ReaderSpeedPref(context.applicationContext.getSharedPreferences("lab-reader", Context.MODE_PRIVATE)).also { instance = it }
        }

        /** Test seam: the next [of] reads prefs again. */
        internal fun resetForTests() { instance = null }
    }
}

/** What the reader's speed needs from a player: a [MediaPlayer] in the app ([asSpeedPlayer]), a fake in tests. */
interface SpeedPlayer {
    val isPlaying: Boolean
    /** Speed with the pitch kept at 1. */
    fun setSpeed(speed: Float)
    fun start()
}

/**
 * Speed at PLAYBACK, pitch kept: `PlaybackParams.setSpeed(x).setPitch(1f)` — MediaPlayer
 * time-stretches with Sonic, which sounds smooth rather than choppy, and the clip is never
 * regenerated. A change while playing applies live (no seek, no restart).
 */
object ReaderPlaybackSpeed {
    /**
     * Start (or resume) at [speed]. The speed is set first — every time, since the player keeps
     * whatever it had and the chip may have moved while it was paused. (`setPlaybackParams` with a
     * non-zero speed starts a paused player itself; the `start()` after it is then a no-op.)
     */
    fun start(player: SpeedPlayer, speed: Double) {
        runCatching { player.setSpeed(ReaderSpeed.parse(speed).toFloat()) }
        player.start()
    }

    /**
     * The chip moved: a playing clip changes speed in place. A paused one is left alone (setting
     * params would start it) and gets the speed at its next [start].
     */
    fun change(player: SpeedPlayer, speed: Double) {
        if (runCatching { player.isPlaying }.getOrDefault(false)) runCatching { player.setSpeed(ReaderSpeed.parse(speed).toFloat()) }
    }
}

fun MediaPlayer.asSpeedPlayer(): SpeedPlayer = object : SpeedPlayer {
    override val isPlaying: Boolean get() = this@asSpeedPlayer.isPlaying
    override fun setSpeed(speed: Float) {
        val mp = this@asSpeedPlayer
        mp.playbackParams = mp.playbackParams.setSpeed(speed).setPitch(1f)
    }
    override fun start() = this@asSpeedPlayer.start()
}
