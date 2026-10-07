package dev.jeromeswannack.chineselearning.lab.data.audiolessons

import dev.jeromeswannack.chineselearning.lab.core.AudioLessonMusic
import dev.jeromeswannack.chineselearning.lab.core.AudioLessonTimeline
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The music bed (docs/AUDIO_LESSONS.md "Music") follows the lesson: it starts when the lesson
 * plays, stops when it pauses / ends / the sleep timer stops it, fades with the timer, and the
 * toggle turns it off at once. AudioLessonEngine calls [LessonMusic.update] from ExoPlayer's
 * onIsPlayingChanged, its STATE_ENDED and the sleep-timer tick — exactly the calls below.
 */
class LessonMusicTest {
    private class FakeTrack : MusicTrack {
        val calls = mutableListOf<String>()
        var playing = false
        var vol = -1f
        var released = false
        override fun play() { calls += "play"; playing = true }
        override fun pause() { calls += "pause"; playing = false }
        override fun setVolume(volume: Float) { vol = volume }
        override fun release() { released = true }
    }

    @Test
    fun startsAndStopsWithThePlayback() {
        val track = FakeTrack()
        val music = LessonMusic(track)
        music.setOn(true)
        assertFalse("nothing plays before the lesson does", track.playing)
        music.update(lessonPlaying = true)
        assertTrue(track.playing)
        assertEquals(AudioLessonMusic.DEFAULT_VOLUME.toFloat(), track.vol, 0.0001f)
        music.update(lessonPlaying = true) // ticks: no second play()
        assertEquals(listOf("play"), track.calls)
        music.update(lessonPlaying = false) // pause / end of the lesson / headphones out
        assertFalse(track.playing)
        music.update(lessonPlaying = true)
        assertTrue(track.playing)
        assertEquals(listOf("play", "pause", "play"), track.calls)
    }

    @Test
    fun offMeansSilentAndTheToggleActsAtOnce() {
        val track = FakeTrack()
        val music = LessonMusic(track)
        music.update(lessonPlaying = true)
        assertFalse("off by default (a dialogue lesson)", track.playing)
        music.setOn(true)
        assertTrue(track.playing)
        music.setOn(false)
        assertFalse(track.playing)
        assertTrue(music.playing.not())
    }

    @Test
    fun theSleepTimerFadesItThenStopsIt() {
        val track = FakeTrack()
        val music = LessonMusic(track)
        music.setOn(true)
        music.setVolume(0.6)
        music.update(lessonPlaying = true, fade = AudioLessonTimeline.sleepFadeVolume(60_000.0))
        assertEquals(0.6f, track.vol, 0.0001f)
        music.update(lessonPlaying = true, fade = AudioLessonTimeline.sleepFadeVolume(15_000.0))
        assertEquals(0.3f, track.vol, 0.0001f)
        // The timer ran out: the engine pauses the lesson and tells the music.
        music.update(lessonPlaying = false)
        assertFalse(track.playing)
        assertEquals(0.6f, track.vol, 0.0001f) // back to the learner's volume for next time
    }

    @Test
    fun volumeIsClampedAndReleaseStops() {
        val track = FakeTrack()
        val music = LessonMusic(track)
        music.setVolume(0.0)
        assertEquals(AudioLessonMusic.MIN_VOLUME, music.volume, 0.0)
        music.setVolume(3.0)
        assertEquals(1.0, music.volume, 0.0)
        music.setOn(true)
        music.update(lessonPlaying = true)
        music.release()
        assertFalse(track.playing)
        assertTrue(track.released)
    }
}
