package dev.jeromeswannack.chineselearning.lab.ui.audiolessons

import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import org.junit.Test
import org.robolectric.annotation.Config

/**
 * Feedback while listening (docs/AUDIO_LESSONS.md): the player's ⏪ Back a section / 😵 Too hard row under the
 * controls, "Noted — too hard" after a tap, and the transcript's 😵 on the lines marked too hard on this phone.
 * (The lock screen / notification's flag button is drawn by Android and can't be rendered here.)
 */
class AudioLessonFeedbackScreenshots : LabScreenshotTest() {
    private val s = SampleAudioLessons

    @Test fun storyFeedback() = shoot("audio-lessons-26-player-feedback") {
        AudioLessonPlayerScreen(
            AudioLessonPlayerUi(
                lesson = s.story, savedOnPhone = true, canPlay = true, playing = true, positionMs = 40_000, musicOn = true,
                flaggedRows = setOf(1, 3), notedAt = 1, notedText = "Noted — too hard: 他很累。",
            ),
            AudioLessonPlayerActions(),
        )
    }

    @Config(qualifiers = LabScreenshotTest.UNFOLDED)
    @Test fun storyFeedbackUnfolded() = shoot("audio-lessons-27-player-feedback-unfolded") {
        AudioLessonPlayerScreen(
            AudioLessonPlayerUi(lesson = s.story, savedOnPhone = true, canPlay = true, playing = true, positionMs = 40_000, flaggedRows = setOf(1, 3)),
            AudioLessonPlayerActions(),
        )
    }
}
