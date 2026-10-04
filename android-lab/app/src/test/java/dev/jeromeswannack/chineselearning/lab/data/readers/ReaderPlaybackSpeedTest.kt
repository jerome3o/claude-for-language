package dev.jeromeswannack.chineselearning.lab.data.readers

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.core.ReaderSpeed
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The reader's speed chip on the phone: the choice is remembered, and the narration player gets
 * it — as the speed it starts at, and live while it plays — with the pitch left alone.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class ReaderPlaybackSpeedTest {
    /** Records what a MediaPlayer would be told. */
    private class FakePlayer(var playing: Boolean = false) : SpeedPlayer {
        val speeds = mutableListOf<Float>()
        var starts = 0
        override val isPlaying: Boolean get() = playing
        override fun setSpeed(speed: Float) { speeds += speed }
        override fun start() { starts++; playing = true }
    }

    private val context: Context get() = ApplicationProvider.getApplicationContext()

    @Before
    fun clean() {
        context.getSharedPreferences("lab-reader", Context.MODE_PRIVATE).edit().clear().commit()
        ReaderSpeedPref.resetForTests()
    }

    @Test
    fun choosingThreeQuartersPlaysTheNarrationAt075() {
        val pref = ReaderSpeedPref.of(context)
        assertEquals(1.0, pref.speed.value, 0.0)
        // One tap on the chip: 1× → 0.75×
        assertEquals(0.75, pref.cycle(), 0.0)
        val player = FakePlayer()
        ReaderPlaybackSpeed.start(player, pref.speed.value)
        assertEquals(listOf(0.75f), player.speeds)
        assertEquals(1, player.starts)
    }

    @Test
    fun changingSpeedMidPlayAppliesLiveWithoutRestarting() {
        val pref = ReaderSpeedPref.of(context)
        val player = FakePlayer()
        ReaderPlaybackSpeed.start(player, pref.speed.value)
        ReaderPlaybackSpeed.change(player, pref.cycle()) // 0.75
        ReaderPlaybackSpeed.change(player, pref.cycle()) // 0.5
        assertEquals(listOf(1f, 0.75f, 0.5f), player.speeds)
        assertEquals("no restart", 1, player.starts)
    }

    @Test
    fun aPausedPlayerIsNotStartedByAChangeAndGetsTheSpeedAtItsNextStart() {
        val player = FakePlayer(playing = false)
        ReaderPlaybackSpeed.change(player, 0.5)
        assertTrue("setting params would start a paused MediaPlayer", player.speeds.isEmpty())
        ReaderPlaybackSpeed.start(player, 0.5)
        assertEquals(listOf(0.5f), player.speeds)
    }

    @Test
    fun theChoiceIsRememberedOnThePhone() {
        ReaderSpeedPref.of(context).set(0.5)
        ReaderSpeedPref.resetForTests()
        assertEquals(0.5, ReaderSpeedPref.of(context).speed.value, 0.0)
        assertEquals("0.5", context.getSharedPreferences("lab-reader", Context.MODE_PRIVATE).getString(ReaderSpeed.STORAGE_KEY, null))
    }

    @Test
    fun aCorruptStoredValueIsNormalSpeed() {
        context.getSharedPreferences("lab-reader", Context.MODE_PRIVATE).edit().putString(ReaderSpeed.STORAGE_KEY, "warp").commit()
        assertEquals(1.0, ReaderSpeedPref.of(context).speed.value, 0.0)
    }

    @Test
    fun theChipCyclesBackToNormal() {
        val pref = ReaderSpeedPref.of(context)
        assertEquals(listOf(0.75, 0.5, 1.0), List(3) { pref.cycle() })
    }
}
