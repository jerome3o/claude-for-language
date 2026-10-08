package dev.jeromeswannack.chineselearning.lab.ui.readers

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.jeromeswannack.chineselearning.lab.data.api.GradedReaderDto
import dev.jeromeswannack.chineselearning.lab.data.api.NewNoteBody
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderPageDto
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderWordDto
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderWordExplanationDto
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.assertEquals

/**
 * Reader word chips as a user taps them: reveal the Chinese → chips (punctuation plain, a word in
 * a deck marked) → tap a word → the sheet (the Chinese stays revealed) → "More about this word"
 * → "+ Add as card" → Add to deck creates the note with the explanation's card fields. A page
 * without words is plain text until the phone's own words are ready (data/text/DeviceWords), then
 * those; words that don't match the page are never shown.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class, qualifiers = "w412dp-h915dp-xxhdpi")
class ReaderWordsComposeTest {
    @get:Rule val compose = createComposeRule()

    /** The phone's segmenter not loaded: the plain-text path (each test opts in). */
    @Before fun noDeviceWords() = dev.jeromeswannack.chineselearning.lab.data.text.DeviceWords.setForTests(null)
    @After fun resetDeviceWords() = dev.jeromeswannack.chineselearning.lab.data.text.DeviceWords.setForTests(null)

    private val text = "早上好。我叫小徐。"
    private val words = listOf(
        ReaderWordDto("早上", "zǎoshang", "morning"), ReaderWordDto("好", "hǎo", "good"), ReaderWordDto("。", "", ""),
        ReaderWordDto("我", "wǒ", "I"), ReaderWordDto("叫", "jiào", "am called"), ReaderWordDto("小徐", "Xiǎo Xú", "Xiao Xu"), ReaderWordDto("。", "", ""),
    )
    private fun reader(page: ReaderPageDto) = GradedReaderDto("r1", "靠窗的座位", "The window seat", "beginner", null, emptyList(), "ready", null, "2026-09-25T09:47:33Z", listOf(page))

    private val explanation = ReaderWordExplanationDto(
        word = "小徐", pinyin = "Xiǎo Xú", english = "Xiao Xu (a name)", explanation = "小 little + 徐 a surname: a friendly way to call someone Xu.",
        funFacts = "小 (xiǎo) little + 徐 (Xú) surname.", sentenceClue = "我叫小徐。", sentenceCluePinyin = "wǒ jiào Xiǎo Xú", sentenceClueTranslation = "My name is Xiao Xu.",
    )

    /** The reading page wired like rememberReaderEnv, with fakes; records what was asked and added. */
    private class Recorder {
        val tapped = mutableListOf<Pair<String, String>>()
        val explained = mutableListOf<Pair<String, String>>()
        val added = mutableListOf<Pair<String, NewNoteBody>>()
    }

    @Composable
    private fun Harness(page: ReaderPageDto, rec: Recorder, load: (suspend (ReaderPageDto) -> List<ReaderWordDto>?)? = null) {
        ReaderScreen(
            reader(page), null,
            ReaderEnv(words = load, known = setOf("早上"), onWord = { w, s -> rec.tapped += w.text to s }),
            onBack = {}, onEdit = {}, onFinish = {},
        )
    }

    private fun show(content: @Composable () -> Unit) {
        compose.mainClock.autoAdvance = false
        compose.setContent { LabTheme { content() } }
        compose.mainClock.advanceTimeBy(2_000)
    }

    private fun tap(text: String) {
        compose.onNodeWithText(text).performClick()
        compose.mainClock.advanceTimeBy(1_500)
    }

    private fun press(node: androidx.compose.ui.test.SemanticsNodeInteraction) {
        node.performClick()
        compose.mainClock.advanceTimeBy(1_500)
    }

    @Test
    fun tapWordGivesTheWordAndItsSentenceWithoutHidingTheChinese() {
        val rec = Recorder()
        show { Harness(ReaderPageDto("p1", 1, text, words = words), rec) }
        tap("Tap to reveal Chinese")
        assertEquals(5, compose.onAllNodesWithTag("word-chip").fetchSemanticsNodes().size)
        compose.onNodeWithContentDescription("早上, in your decks").assertIsDisplayed()
        compose.onNodeWithContentDescription("小徐").performClick()
        compose.mainClock.advanceTimeBy(1_000)
        assertEquals(listOf("小徐" to "我叫小徐。"), rec.tapped)
        // Tapping a word doesn't hide the Chinese: the chips are still there.
        compose.onNodeWithTag("reader-words").assertIsDisplayed()
    }

    @Test
    fun sheetExplainsAndAddsCard() {
        val rec = Recorder()
        show {
            // The sheet's content in the main window (the ModalBottomSheet dialog doesn't idle reliably under Robolectric).
            ReaderWordPanel(
                words[5], "我叫小徐。", known = false,
                actions = ReaderWordActions(
                    explain = { word, sentence -> rec.explained += word.text to sentence; explanation },
                    decks = { listOf(DeckChoice("d1", "Readers", null), DeckChoice("d2", "HSK 3", null)) },
                    add = { deckId, word, ex -> rec.added += deckId to readerWordNote(word, ex) },
                ),
            )
        }
        compose.onNodeWithTag("reader-word-sheet").assertExists()
        compose.onNodeWithText("Xiǎo Xú").assertExists()
        compose.onNodeWithText("Xiao Xu").assertExists()
        compose.onNodeWithText("我叫小徐。").assertExists()

        press(compose.onNodeWithText("✨ More about this word"))
        assertEquals(listOf("小徐" to "我叫小徐。"), rec.explained)
        compose.onNodeWithTag("word-explanation", useUnmergedTree = true).assertExists()

        press(compose.onNodeWithText("+ Add as card"))
        press(compose.onNodeWithTag("add-to-deck"))
        assertEquals(1, rec.added.size)
        val (deck, note) = rec.added[0]
        assertEquals("d1", deck)
        assertEquals(NewNoteBody("小徐", "Xiǎo Xú", "Xiao Xu (a name)", "小 (xiǎo) little + 徐 (Xú) surname.", "我叫小徐。", "wǒ jiào Xiǎo Xú", "My name is Xiao Xu."), note)
        compose.onNodeWithText("Added to Readers ✓").assertExists()
        assertEquals(listOf("小徐" to "我叫小徐。"), rec.explained) // asked once, reused for the card
    }

    @Test
    fun wordsArriveLater() {
        val rec = Recorder()
        show { Harness(ReaderPageDto("p1", 1, text), rec, load = { words }) }
        tap("Tap to reveal Chinese")
        assertEquals(5, compose.onAllNodesWithTag("word-chip").fetchSemanticsNodes().size)
    }

    @Test
    fun withoutClaudesWordsThePhoneSplitsThePageIntoWords() {
        dev.jeromeswannack.chineselearning.lab.data.text.DeviceWords.setForTests(dev.jeromeswannack.chineselearning.lab.core.chinese.Segmenter.shipped)
        show { Harness(ReaderPageDto("p3", 1, "早上好。我们明天去银行。"), Recorder(), load = { null }) }
        tap("Tap to reveal Chinese")
        val chips = compose.onAllNodesWithTag("word-chip").fetchSemanticsNodes().size
        assertEquals(5, chips) // 早上好 · 我们 · 明天 · 去 · 银行
        compose.onNodeWithText("银行").assertExists()
    }

    @Test
    fun staleWordsAreNotShown() {
        show { Harness(ReaderPageDto("p2", 1, "早上好！", words = words), Recorder()) }
        tap("Tap to reveal Chinese")
        assertEquals(0, compose.onAllNodesWithTag("word-chip").fetchSemanticsNodes().size)
        compose.onNodeWithText("早上好！").assertIsDisplayed()
    }
}
