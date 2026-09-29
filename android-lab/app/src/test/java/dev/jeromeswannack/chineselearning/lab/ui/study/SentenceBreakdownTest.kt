package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.unit.Density
import com.github.takahirom.roborazzi.captureRoboImage
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.QueueCard
import dev.jeromeswannack.chineselearning.lab.data.SentenceEntity
import dev.jeromeswannack.chineselearning.lab.data.api.ExplainedWord
import dev.jeromeswannack.chineselearning.lab.data.api.SentenceExplanation
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.testing.Samples
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

/**
 * "What's going on here?" on an example sentence: like the web's `.sentence-set-words`, every
 * word of the breakdown is its own full-width row (hanzi, then pinyin + meaning), stacked one
 * under the other with the hanzi in one column, and the construction paragraph below them.
 *
 * Regression: the Lab drew the words as wrapping chips side by side, so the breakdown read
 * sideways block by block (Jerome, 这场比赛我们不能输。). Shot folded, dark, at 1.0 and 1.3.
 */
class SentenceBreakdownTest : LabScreenshotTest() {
    private val note = Samples.note.copy(
        hanzi = "比赛", pinyin = "bǐsài", english = "match, competition",
        sentenceClue = "明天有一场足球比赛。",
        sentenceCluePinyin = "Míngtiān yǒu yì chǎng zúqiú bǐsài.",
        sentenceClueTranslation = "There's a football match tomorrow.",
    )

    private val sentence = "这场比赛我们不能输。"

    private val set = listOf(
        SentenceEntity("s1", "n1", 0, "我喜欢看比赛。", "Wǒ xǐhuan kàn bǐsài.", "I like watching matches.", null, "core", null),
        SentenceEntity("s2", "n1", 1, sentence, "Zhè chǎng bǐsài wǒmen bù néng shū.", "We can't lose this match.", null, "core", null),
        SentenceEntity("s3", "n1", 2, "比赛结束以后，大家一起去吃饭了。", "Bǐsài jiéshù yǐhòu, dàjiā yìqǐ qù chīfàn le.", "After the match everyone went to eat together.", null, "complex", null),
    )

    private val breakdown = SentenceExplanation(
        words = listOf(
            ExplainedWord("这", "zhè", "this"),
            ExplainedWord("场", "chǎng", "measure word for games, matches and performances"),
            ExplainedWord("比赛", "bǐsài", "match, competition"),
            ExplainedWord("我们", "wǒmen", "we, us"),
            ExplainedWord("不能", "bù néng", "cannot"),
            ExplainedWord("输", "shū", "lose"),
        ),
        construction = "Topic-comment structure: the object (这场比赛) is fronted as the topic, then the subject and " +
            "predicate follow. The modal 不能 (cannot) negates the ability or permission to perform the action, " +
            "not the action itself — a learner might incorrectly use 没有 instead.",
    )

    private var peeks = 0

    private fun studyBack(fontScale: Float, dark: Boolean) {
        val now = Js.parseDate("2026-09-29T08:33:00.000Z")
        var state = CardScheduler.initialCardState()
        state = CardScheduler.applyReview(state, 2, "2026-09-20T08:00:00.000Z")
        val card = QueueCard("c1", note.id, "d1", CardTypes.HANZI_TO_MEANING, state)
        val view = CardView(card, note, set, CardScheduler.intervalPreviews(state, now), emptyList(), 1, "HSK 3", true)
        val ui = StudyUi(StudyPhase.Showing(view), Samples.counts, SessionStats(reviews = 5, correct = 4), canUndo = true, online = true, forcedOffline = false)
        val actions = StudyActions(
            onPeek = { peeks++ },
            sentences = SentenceActions(
                cachedExplanation = { row -> if (row.hanzi == sentence) breakdown else null },
                decks = { listOf("d1" to "HSK 3") },
            ),
        )
        compose.setContent {
            LabTheme(dark = dark) {
                CompositionLocalProvider(LocalDensity provides Density(LocalDensity.current.density, fontScale)) {
                    StudyScreen(ui, playingKey = null, actions = actions, cardStart = CardStartState(flipped = true), autoplay = false)
                }
            }
        }
        compose.mainClock.advanceTimeBy(2_000)
        // Open the sentence the way Jerome did: tap its row until hanzi, pinyin and English show.
        compose.onAllNodesWithText("Tap to reveal")[2].performScrollTo().performClick()
        compose.mainClock.advanceTimeBy(300)
        repeat(2) {
            compose.onNodeWithText(sentence).performClick()
            compose.mainClock.advanceTimeBy(300)
        }
        compose.mainClock.advanceTimeBy(1_000)
        // Down to the construction paragraph: the whole breakdown on screen, the words above it.
        compose.onNodeWithText("Topic-comment structure", substring = true, useUnmergedTree = true).performScrollTo()
        compose.mainClock.advanceTimeBy(500)
    }

    private fun tagged(tag: String): List<SemanticsNode> =
        compose.onAllNodesWithTag(tag, useUnmergedTree = true).fetchSemanticsNodes()
    private fun SemanticsNode.top() = positionInRoot.y
    private fun SemanticsNode.bottom() = positionInRoot.y + size.height
    private fun SemanticsNode.left() = positionInRoot.x
    private fun SemanticsNode.text() = config[SemanticsProperties.Text].joinToString("") { it.text }

    /** One word per row, top to bottom, hanzi in one column and the pinyin + meaning in the next. */
    private fun assertOneWordPerRow() {
        val hanzi = tagged(BREAKDOWN_HANZI_TAG)
        assertEquals(breakdown.words.map { it.hanzi }, hanzi.map { it.text() })
        hanzi.zipWithNext().forEach { (a, b) -> assertTrue("each word on its own row, below the one before", a.bottom() <= b.top()) }
        hanzi.forEach { assertEquals("hanzi column is aligned", hanzi.first().left(), it.left(), 0.5f) }
        val meanings = tagged(BREAKDOWN_MEANING_TAG)
        assertEquals(breakdown.words.map(::meaningText), meanings.map { it.text() })
        meanings.forEach { m -> assertEquals("pinyin + meaning column is aligned", meanings.first().left(), m.left(), 0.5f) }
        hanzi.zip(meanings).forEach { (h, m) ->
            assertTrue("the meaning sits beside its hanzi", m.left() > h.left() + h.size.width - 0.5f)
            assertTrue("… on the same line", abs(m.top() - h.top()) < h.size.height)
        }
        val construction = compose.onAllNodesWithText("Topic-comment structure", substring = true, useUnmergedTree = true).fetchSemanticsNodes().single()
        assertTrue("the construction comes after the words", hanzi.last().bottom() <= construction.top())
    }

    private fun meaningText(w: ExplainedWord) = "${w.pinyin}  ${w.gloss}"

    @Test fun breakdownRowsFontScale1Dark() {
        studyBack(1f, dark = true)
        compose.onRoot().captureRoboImage("screenshots/study-e05-breakdown-rows-dark-1.0.png")
        assertOneWordPerRow()
    }

    @Test fun breakdownRowsFontScale13Dark() {
        studyBack(1.3f, dark = true)
        compose.onRoot().captureRoboImage("screenshots/study-e06-breakdown-rows-dark-1.3.png")
        assertOneWordPerRow()
    }

    /** A word row is interactive: it opens "add as a card" and never flips the card to peek. */
    @Test fun tappingAWordAddsItAndDoesntFlip() {
        studyBack(1f, dark = true)
        compose.onNodeWithText("不能", useUnmergedTree = true).performClick()
        compose.mainClock.advanceTimeBy(1_000)
        compose.onNodeWithText("Save to deck:").assertExists()
        assertEquals(0, peeks)
        compose.onNodeWithText("Good").assertExists()
    }
}
