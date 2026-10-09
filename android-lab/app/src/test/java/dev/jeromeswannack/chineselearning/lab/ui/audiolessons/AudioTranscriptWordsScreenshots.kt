package dev.jeromeswannack.chineselearning.lab.ui.audiolessons

import dev.jeromeswannack.chineselearning.lab.core.chinese.Segmenter
import dev.jeromeswannack.chineselearning.lab.data.text.DeviceWords
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import org.junit.After
import org.junit.Before
import org.junit.Test

/** The audio-lesson transcript with word chips made on the phone (DeviceWords). Screenshots: `audio-transcript-words-*`. */
class AudioTranscriptWordsScreenshots : LabScreenshotTest() {
    private val s = SampleAudioLessons

    @Before fun words() = DeviceWords.setForTests(Segmenter.shipped)
    @After fun reset() = DeviceWords.setForTests(null)

    private fun story(dark: Boolean, name: String) = shoot(name, dark = dark) {
        AudioLessonPlayerScreen(
            AudioLessonPlayerUi(lesson = s.story, savedOnPhone = true, canPlay = true, playing = true, positionMs = 40_000, musicOn = true, known = setOf("咖啡", "什么")),
            AudioLessonPlayerActions(),
        )
    }

    @Test fun storyLight() = story(false, "audio-transcript-words-01-story-light")
    @Test fun storyDark() = story(true, "audio-transcript-words-02-story-dark")

    @Test fun dialogue() = shoot("audio-transcript-words-03-dialogue") {
        AudioLessonPlayerScreen(AudioLessonPlayerUi(lesson = s.dialogue, savedOnPhone = true, canPlay = true, positionMs = 20_000), AudioLessonPlayerActions())
    }

    @Test fun sleep() = shoot("audio-transcript-words-04-sleep", dark = true) {
        AudioLessonPlayerScreen(AudioLessonPlayerUi(lesson = s.sleep, savedOnPhone = true, canPlay = true, showTranscript = true, positionMs = 30_000), AudioLessonPlayerActions())
    }
}
