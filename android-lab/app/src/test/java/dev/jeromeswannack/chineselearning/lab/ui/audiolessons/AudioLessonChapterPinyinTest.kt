package dev.jeromeswannack.chineselearning.lab.ui.audiolessons

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import dev.jeromeswannack.chineselearning.lab.core.AudioLessonChapter
import dev.jeromeswannack.chineselearning.lab.data.api.AudioLessonDto
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Pinyin under the chapter titles (web components/audioLessons/ChapterTitle.tsx): the server sends
 * each chapter's `label` + `pinyin` (shared/audio-lesson/chapter-pinyin.ts); the player shows the
 * pinyin on its own line in the chapter list and under the current chapter, and hides it with 拼.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w412dp-h915dp-xxhdpi", application = android.app.Application::class)
class AudioLessonChapterPinyinTest {
    @get:Rule val compose = createComposeRule()

    private fun player(lesson: AudioLessonDto, positionMs: Long, showPinyin: Boolean = true) {
        compose.setContent {
            LabTheme {
                AudioLessonPlayerScreen(
                    AudioLessonPlayerUi(lesson = lesson, savedOnPhone = true, canPlay = true, positionMs = positionMs, showChapters = true, showTranscript = false, showPinyin = showPinyin),
                    AudioLessonPlayerActions(),
                )
            }
        }
    }

    @Test fun decodesTheServedFieldsAndOlderDetailsWithoutThem() {
        val json = Json { ignoreUnknownKeys = true }
        val served = json.decodeFromString<AudioLessonChapter>("""{"title":"自驾游 zìjiàyóu","start_ms":5,"label":"自驾游","pinyin":"zìjiàyóu"}""")
        assertEquals("自驾游", served.shownTitle)
        assertEquals("zìjiàyóu", served.pinyin)
        val old = json.decodeFromString<AudioLessonChapter>("""{"title":"自驾游 zìjiàyóu","start_ms":5}""")
        assertEquals("自驾游 zìjiàyóu", old.shownTitle)
        assertNull(old.pinyin)
    }

    @Test fun dialogueChaptersShowTheTaughtWordsPinyin() {
        player(SampleAudioLessons.dialogue, positionMs = 385_000)
        compose.onNodeWithText("6. 粗 — thick").assertExists()
        compose.onNodeWithTag("al-chapter-pinyin-5", useUnmergedTree = true).assertExists()
        compose.onAllNodesWithText("cū").assertCountEquals(1)
        // The current chapter (少放点) has its pinyin under the title too; English chapters have none.
        compose.onNodeWithTag("al-now-chapter-pinyin", useUnmergedTree = true).assertIsDisplayed()
        compose.onAllNodesWithTag("al-chapter-pinyin-0", useUnmergedTree = true).assertCountEquals(0)
    }

    @Test fun sleepChaptersAreNotDoubled() {
        player(SampleAudioLessons.sleep, positionMs = 10_000)
        compose.onNodeWithText("2. 银行").assertExists()
        compose.onAllNodesWithText("2. 银行 yínháng").assertCountEquals(0)
        // Under the current chapter and in the list.
        compose.onAllNodesWithText("yínháng").assertCountEquals(2)
    }

    @Test fun pinyinOffHidesIt() {
        player(SampleAudioLessons.sleep, positionMs = 10_000, showPinyin = false)
        compose.onNodeWithText("2. 银行").assertExists()
        compose.onAllNodesWithText("yínháng").assertCountEquals(0)
        compose.onAllNodesWithTag("al-now-chapter-pinyin", useUnmergedTree = true).assertCountEquals(0)
    }
}
