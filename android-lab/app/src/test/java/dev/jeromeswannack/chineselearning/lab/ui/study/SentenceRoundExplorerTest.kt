package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.click
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.text.TextLayoutResult
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.QueueCard
import dev.jeromeswannack.chineselearning.lab.core.SourceDecks
import dev.jeromeswannack.chineselearning.lab.core.chinese.Segmenter
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerItem
import dev.jeromeswannack.chineselearning.lab.data.SentenceEntity
import dev.jeromeswannack.chineselearning.lab.data.text.DeviceWords
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.testing.Samples
import dev.jeromeswannack.chineselearning.lab.ui.explorer.ExplorerController
import dev.jeromeswannack.chineselearning.lab.ui.explorer.LocalExplorer
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * A Sentence round row's Chinese (docs/STUDY_SESSION.md "Sentence round"; the web's RoundChinese): once the
 * row is answered every word opens the language explorer (source `sentence_round` → "+ Add as card" lands in
 * "From example sentences"); while it is the question — a read row before its take, a translate row's hidden
 * Chinese — it is plain text. A word tap is not the row's long press (no hide sheet).
 */
class SentenceRoundExplorerTest : LabScreenshotTest() {
    private val note = Samples.note.copy(
        id = "n1", hanzi = "来源", pinyin = "láiyuán", english = "source", funFacts = null,
        sentenceClue = "这个消息来源可靠。", sentenceCluePinyin = "Zhège xiāoxi láiyuán kěkào.", sentenceClueTranslation = "The source of this news is reliable.",
    )
    private val set = listOf(
        SentenceEntity("s1", "n1", 0, "他的收入来源很多。", "Tā de shōurù láiyuán hěn duō.", "He has many sources of income.", null, "core", null),
        SentenceEntity("s2", "n1", 1, "你知道这句话的来源吗？", "Nǐ zhīdào zhè jù huà de láiyuán ma?", "Do you know where this saying comes from?", null, "core", null),
        SentenceEntity("s3", "n1", 2, "新闻的来源要写清楚。", "Xīnwén de láiyuán yào xiě qīngchu.", "The source of the news must be written clearly.", null, "core", null),
    )
    private val clueKey = clueRowKey("n1")
    private val prefs get() = StudyPrefs.get(ApplicationProvider.getApplicationContext())
    private val events = ArrayList<Pair<String, Map<String, Any?>>>()
    private val controller = ExplorerController(track = { e, p -> events += e to p })

    @Before fun load() = DeviceWords.setForTests(Segmenter.shipped)

    @After fun unload() {
        DeviceWords.setForTests(null)
        prefs.setHardMode("off")
    }

    private fun card(practise: SentencePractiseState) {
        prefs.setHardMode("all")
        val now = Js.parseDate("2026-11-11T08:00:00.000Z")
        var state = CardScheduler.initialCardState()
        state = CardScheduler.applyReview(state, 2, "2026-11-07T08:00:00.000Z")
        val view = CardView(QueueCard("c1", "n1", "d1", CardTypes.HANZI_TO_MEANING, state), note, set, CardScheduler.intervalPreviews(state, now), emptyList(), 1, "HSK 3", true)
        val ui = StudyUi(StudyPhase.Showing(view), Samples.counts, SessionStats(reviews = 5, correct = 4), canUndo = true, online = true)
        compose.setContent {
            LabTheme {
                CompositionLocalProvider(LocalExplorer provides controller) {
                    StudyScreen(ui, playingKey = null, actions = StudyActions(), cardStart = CardStartState(roundOpen = true), autoplay = false, sentencePractisePreview = practise)
                }
            }
        }
        compose.mainClock.advanceTimeBy(2_000)
    }

    private fun node(text: String) = compose.onAllNodes(hasTestTag(SentenceRoundTags.CHINESE) and hasText(text), useUnmergedTree = true)[0]

    private fun chinese(text: String): SemanticsNode = node(text).fetchSemanticsNode()

    private fun links(text: String): List<String> {
        val t = chinese(text).config[SemanticsProperties.Text].first { it.text == text }
        return t.getLinkAnnotations(0, t.length).map { t.text.substring(it.start, it.end) }
    }

    /** A real tap on [word] where it is drawn (through the row's own gesture handling). */
    private fun tapWord(text: String, word: String) {
        val node = chinese(text)
        val layouts = ArrayList<TextLayoutResult>()
        node.config[SemanticsActions.GetTextLayoutResult].action!!.invoke(layouts)
        val box = layouts.first().getBoundingBox(text.indexOf(word))
        node(text).performTouchInput { click(Offset(box.center.x, box.center.y)) }
        compose.mainClock.advanceTimeBy(600)
    }

    private fun hideSheets() = compose.onAllNodes(hasTestTag(SentenceHideTags.SHEET), useUnmergedTree = true).fetchSemanticsNodes().size

    @Test fun aJudgedRowsWordsOpenTheExplorer() {
        card(previewSentencePractise(rightKeys = listOf("read:$clueKey")))
        val clue = note.sentenceClue!!
        assertTrue("可靠" in links(clue), "words: ${links(clue)}")
        tapWord(clue, "可靠")
        val item = controller.current as ExplorerItem.Word
        assertEquals("可靠", item.hanzi)
        assertEquals("explorer.open" to mapOf("source" to "sentence_round", "kind" to "word"), events.last())
        // "+ Add as card" from here lands in "From example sentences".
        assertEquals("sentences", SourceDecks.forExplorer(controller.openSource))
        // A word tap isn't the row's long press: no hide sheet.
        assertEquals(0, hideSheets())
    }

    @Test fun beforeTheTakeTheSentenceIsPlainText() {
        card(previewSentencePractise())
        val clue = note.sentenceClue!!
        assertEquals(emptyList(), links(clue))
        tapWord(clue, "可靠")
        assertNull(controller.current)
        // A translate row's Chinese isn't there at all until answered.
        assertEquals(0, compose.onAllNodes(hasTestTag(SentenceRoundTags.CHINESE) and hasText(set[0].hanzi), useUnmergedTree = true).fetchSemanticsNodes().size)
    }

    @Test fun aTranslateRowAnsweredIsExplorable() {
        card(previewSentencePractise(rightKeys = listOf("translate:s1")))
        assertTrue("收入" in links(set[0].hanzi), "words: ${links(set[0].hanzi)}")
        tapWord(set[0].hanzi, "收入")
        assertEquals("收入", (controller.current as ExplorerItem.Word).hanzi)
    }
}
