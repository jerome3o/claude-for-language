package dev.jeromeswannack.chineselearning.lab.ui.audiolessons

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.jeromeswannack.chineselearning.lab.core.chinese.Segmenter
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderWordDto
import dev.jeromeswannack.chineselearning.lab.data.text.DeviceWords
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The audio-lesson transcript's word chips (web components/audioLessons/TranscriptLine.tsx): the
 * Chinese of every row is word chips made on the phone (DeviceWords); a word goes to the explorer,
 * a tap on the rest of the row seeks — never both.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w412dp-h915dp-xxhdpi", application = android.app.Application::class)
class AudioLessonTranscriptWordsTest {
    @get:Rule val compose = createComposeRule()

    @Before fun words() = DeviceWords.setForTests(Segmenter.shipped)
    @After fun reset() = DeviceWords.setForTests(null)

    private val words = mutableListOf<Pair<ReaderWordDto, String>>()
    private val seeks = mutableListOf<Long>()

    private fun player(lesson: dev.jeromeswannack.chineselearning.lab.data.api.AudioLessonDto, known: Set<String> = emptySet()) {
        compose.setContent {
            LabTheme {
                AudioLessonPlayerScreen(
                    AudioLessonPlayerUi(lesson = lesson, savedOnPhone = true, canPlay = true, known = known),
                    AudioLessonPlayerActions(onSeek = { seeks += it }, onWord = { w, s -> words += w to s }),
                )
            }
        }
    }

    @Test fun storyRowsAreWordChipsAndAWordOpensTheExplorerWithoutSeeking() {
        player(SampleAudioLessons.story, known = setOf("什么"))
        // The first row: 明慧：你好！你今天想喝什么？ — words, punctuation plain.
        compose.onAllNodesWithText("你今天").assertCountEquals(0)
        compose.onAllNodesWithText("今天").onFirst().assertIsDisplayed()
        compose.onAllNodesWithContentDescription("什么, in your decks").onFirst().assertIsDisplayed()
        // The row's pinyin and English lines and its ×3 stay as they were.
        compose.onNodeWithText("nǐ hǎo! nǐ jīntiān xiǎng hē shénme?").assertIsDisplayed()
        compose.onNodeWithText("Hi! What would you like to drink today?").assertIsDisplayed()
        compose.onAllNodesWithContentDescription("said 3 times", useUnmergedTree = true).onFirst().assertIsDisplayed()

        compose.onAllNodesWithText("今天").onFirst().performClick()
        assertEquals(listOf("今天"), words.map { it.first.text })
        assertEquals("你今天想喝什么？", words.single().second)
        assertTrue("a word tap must not seek", seeks.isEmpty())
    }

    @Test fun aTapOnTheRestOfTheRowSeeks() {
        player(SampleAudioLessons.story)
        compose.onNodeWithText("Hi! What would you like to drink today?").performClick()
        assertEquals(listOf(1000L), seeks)
        // Punctuation is not a chip: it belongs to the row.
        compose.onAllNodesWithText("！").onFirst().performClick()
        assertEquals(2, seeks.size)
        assertTrue(words.isEmpty())
    }

    @Test fun withoutTheWordListsTheRowIsItsPlainText() {
        DeviceWords.setForTests(null)
        player(SampleAudioLessons.story)
        compose.onNodeWithText("明慧：你好！你今天想喝什么？").assertIsDisplayed()
        compose.onAllNodesWithTag("chat-word-chip").assertCountEquals(0)
    }

    @Test fun punctuationWrapsWithItsWord() {
        val wrap = dev.jeromeswannack.chineselearning.lab.ui.chat.wrapGroups(listOf("这", "是", "一个", "新词", "。"))
        assertEquals(listOf(listOf(0), listOf(1), listOf(2), listOf(3, 4)), wrap)
        // Opening quotes go with the word after them, closing ones with the word before.
        val quoted = dev.jeromeswannack.chineselearning.lab.ui.chat.wrapGroups(listOf("‘", "银", "’", "是", "‘", "银色", "’", "的", "\n", "。"))
        assertEquals(listOf(listOf(0, 1, 2), listOf(3), listOf(4, 5, 6), listOf(7), listOf(8), listOf(9)), quoted)
        // A space stays with the word before it (an English line never starts a line with a space).
        val english = dev.jeromeswannack.chineselearning.lab.ui.chat.wrapGroups(listOf("The", " ", "word", " ", "银行", ":", " ", "bank", "."))
        assertEquals(listOf(listOf(0, 1), listOf(2, 3), listOf(4, 5, 6), listOf(7, 8)), english)
    }
}
