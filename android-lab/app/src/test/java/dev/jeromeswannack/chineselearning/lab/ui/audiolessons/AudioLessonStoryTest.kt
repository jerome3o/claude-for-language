package dev.jeromeswannack.chineselearning.lab.ui.audiolessons

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.assertCountEquals
import dev.jeromeswannack.chineselearning.lab.core.AudioLessonFormats
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The story format ("Listen & repeat a story") on the Lab's create screen, list and player. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w412dp-h915dp-xxhdpi", application = android.app.Application::class)
class AudioLessonStoryTest {
    @get:Rule val compose = createComposeRule()

    @Test fun theCreateScreenOffersStoryWithItsPasteBoxAndNoLengthSlider() {
        var started = 0
        compose.setContent {
            var ui by remember { mutableStateOf(AudioLessonsUi(lessons = Loadable(data = listOf(SampleAudioLessons.story)))) }
            LabTheme {
                AudioLessonsScreen(
                    ui,
                    AudioLessonsActions(
                        onFormat = { ui = ui.copy(format = it) },
                        onStoryText = { ui = ui.copy(storyText = it) },
                        onStart = { started++ },
                    ),
                )
            }
        }
        // Three formats; the story's name and few words.
        compose.onNodeWithText("Story").assertIsDisplayed()
        // The list's story row has its icon too.
        compose.onAllNodesWithText("📖").assertCountEquals(2)
        compose.onNodeWithText("Listen & repeat").assertIsDisplayed()
        compose.onAllNodesWithText("Length: about 12 minutes").assertCountEquals(1)
        compose.onNodeWithTag("al-format-story").performClick()
        compose.onNodeWithText("Paste a story or a conversation").assertIsDisplayed()
        compose.onAllNodesWithText("Length: about 0 minutes").assertCountEquals(0)
        compose.onAllNodesWithText("Length: about 12 minutes").assertCountEquals(0)
        compose.onNodeWithTag("al-story-estimate").assertIsDisplayed()
        compose.onNodeWithText("0 / 6,000 characters · Each line three times, slowly, then its English.").assertIsDisplayed()
        // Make it: enabled once there is text.
        compose.onNodeWithText("🎧 Make the lesson").performScrollTo().performClick()
        assertEquals(0, started)
        compose.onNodeWithTag("al-story-text").performScrollTo().performTextInput("明慧：你好！你今天想喝什么？")
        compose.onNodeWithText("14 / 6,000 characters · About 1 minute of audio.").assertIsDisplayed()
        compose.onNodeWithText("🎧 Make the lesson").performScrollTo().performClick()
        assertEquals(1, started)
    }

    @Test fun aStoryLessonInTheListAndThePlayer() {
        assertEquals("📖", AudioLessonFormats.info("story").icon)
        var pinyin = 0
        var english = 0
        compose.setContent {
            LabTheme {
                AudioLessonPlayerScreen(
                    AudioLessonPlayerUi(lesson = SampleAudioLessons.story, savedOnPhone = true, canPlay = true, musicOn = true),
                    AudioLessonPlayerActions(onPinyin = { pinyin++ }, onEnglish = { english++ }),
                )
            }
        }
        compose.onNodeWithText("📖 Listen & repeat a story").assertIsDisplayed()
        // Transcript on by default: the first line once, "×3", with its English.
        compose.onNodeWithText("明慧：你好！你今天想喝什么？").assertIsDisplayed()
        compose.onAllNodesWithContentDescription("said 3 times", useUnmergedTree = true).onFirst().assertIsDisplayed()
        compose.onNodeWithText("Hi! What would you like to drink today?").assertIsDisplayed()
        compose.onNodeWithText("拼").performClick()
        compose.onNodeWithText("EN").performClick()
        assertEquals(1, pinyin)
        assertEquals(1, english)
    }

    @Test fun pinyinAndEnglishCanBeHidden() {
        compose.setContent {
            LabTheme {
                AudioLessonPlayerScreen(
                    AudioLessonPlayerUi(lesson = SampleAudioLessons.story, savedOnPhone = true, canPlay = true, showPinyin = false, showEnglish = false),
                    AudioLessonPlayerActions(),
                )
            }
        }
        compose.onNodeWithText("明慧：你好！你今天想喝什么？").assertIsDisplayed()
        compose.onAllNodesWithText("nǐ hǎo! nǐ jīntiān xiǎng hē shénme?").assertCountEquals(0)
        compose.onAllNodesWithText("Hi! What would you like to drink today?").assertCountEquals(0)
    }
}
