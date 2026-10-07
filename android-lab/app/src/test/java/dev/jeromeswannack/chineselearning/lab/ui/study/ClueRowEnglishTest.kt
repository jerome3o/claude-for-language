package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import com.github.takahirom.roborazzi.captureRoboImage
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.QueueCard
import dev.jeromeswannack.chineselearning.lab.data.SentenceEntity
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.testing.Samples
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The card's own sentence (row 1, "From the card") on a note that has no translation or pinyin for
 * it — a third of the notes (MCP-added / older ones). It must reveal like every other row:
 * hanzi → pinyin (the device's own) → English (fetched once from explain-text, cached by text).
 *
 * Regression: the reveal chain dropped the missing steps, so one tap opened the row fully and the
 * "From the card" badge sat where the English should have been (Jerome, Oct 2026).
 */
class ClueRowEnglishTest : LabScreenshotTest() {
    private val clue = "服务员，我们要点菜。"
    private val english = "Waiter, we'd like to order."

    private val note = Samples.note.copy(
        hanzi = "点菜", pinyin = "diǎn cài", english = "to order food",
        sentenceClue = clue, sentenceCluePinyin = null, sentenceClueTranslation = null,
    )

    private val set = listOf(
        SentenceEntity("s1", "n1", 0, "我们点菜吧。", "Wǒmen diǎn cài ba.", "Let's order.", null, "core", null),
        SentenceEntity("s2", "n1", 1, "你来点菜，我不知道吃什么。", "Nǐ lái diǎn cài, wǒ bù zhīdào chī shénme.", "You order — I don't know what to eat.", null, "core", null),
    )

    private var translateCalls = 0

    private fun studyBack(online: Boolean, cached: String? = null) {
        val now = Js.parseDate("2026-10-07T08:00:00.000Z")
        var state = CardScheduler.initialCardState()
        state = CardScheduler.applyReview(state, 2, "2026-10-01T08:00:00.000Z")
        val card = QueueCard("c1", note.id, "d1", CardTypes.HANZI_TO_MEANING, state)
        val view = CardView(card, note, set, CardScheduler.intervalPreviews(state, now), emptyList(), 1, "Restaurant", true)
        val ui = StudyUi(StudyPhase.Showing(view), Samples.counts, SessionStats(reviews = 5, correct = 4), canUndo = true, online = online, forcedOffline = false)
        val actions = StudyActions(
            sentences = SentenceActions(
                cachedTranslation = { r -> if (r.hanzi == clue) cached else null },
                translate = { r -> translateCalls++; assertEquals(clue, r.hanzi); english },
                decks = { listOf("d1" to "Restaurant") },
            ),
        )
        compose.setContent {
            LabTheme(dark = false) {
                StudyScreen(ui, playingKey = null, actions = actions, cardStart = CardStartState(flipped = true), autoplay = false)
            }
        }
        compose.mainClock.advanceTimeBy(2_000)
    }

    private fun node(text: String): SemanticsNode = compose.onNodeWithText(text, useUnmergedTree = true).fetchSemanticsNode()
    private fun tagged(tag: String) = compose.onAllNodesWithTag(tag, useUnmergedTree = true).fetchSemanticsNodes()
    private fun SemanticsNode.top() = positionInRoot.y
    private fun SemanticsNode.bottom() = positionInRoot.y + size.height

    /** Tap the clue row (the first one) [times] times. */
    private fun tapClueRow(times: Int) {
        compose.onAllNodesWithText("Tap to reveal")[0].performScrollTo().performClick()
        compose.mainClock.advanceTimeBy(400)
        repeat(times - 1) {
            compose.onNodeWithText(clue).performClick()
            compose.mainClock.advanceTimeBy(400)
        }
        compose.mainClock.advanceTimeBy(600)
    }

    @Test fun revealsHanziThenPinyinThenFetchedEnglish() {
        studyBack(online = true)
        // Badge on its own line from the start, the row otherwise blank (listen first).
        assertEquals(1, tagged(SENTENCE_CARD_BADGE_TAG).size)
        tapClueRow(2)
        // Two taps: hanzi + the device's pinyin, no English yet and not open (no tools).
        assertTrue(compose.onAllNodesWithText(english, useUnmergedTree = true).fetchSemanticsNodes().isEmpty())
        assertTrue(tagged(SENTENCE_EXPLAIN_TAG).isEmpty())
        compose.onNodeWithText(clue).performClick()
        compose.mainClock.advanceTimeBy(1_000)
        compose.onNodeWithText(english, useUnmergedTree = true).performScrollTo()
        compose.mainClock.advanceTimeBy(300)
        compose.onRoot().captureRoboImage("screenshots/study-e07-clue-row-english.png")
        val badge = tagged(SENTENCE_CARD_BADGE_TAG).single()
        val hanzi = node(clue)
        val en = node(english)
        assertTrue("badge above the sentence", badge.bottom() <= hanzi.top())
        assertTrue("English under the sentence", hanzi.bottom() < en.top())
        assertEquals("fetched once", 1, translateCalls)
        // Fully open: the tools line like every row (+ Add as card now that it has an English).
        assertEquals(1, tagged(SENTENCE_EXPLAIN_TAG).size)
        assertTrue(tagged(SENTENCE_ADD_TAG).isNotEmpty())
    }

    @Test fun offlineAndNeverFetchedSaysItNeedsAConnection() {
        studyBack(online = false)
        tapClueRow(3)
        compose.onNodeWithText("Translation needs a connection", useUnmergedTree = true).performScrollTo()
        compose.mainClock.advanceTimeBy(300)
        compose.onRoot().captureRoboImage("screenshots/study-e08-clue-row-offline.png")
        assertEquals(1, tagged(SENTENCE_TRANSLATION_PENDING_TAG).size)
        assertEquals(0, translateCalls)
    }

    @Test fun offlineWithACachedLineShowsIt() {
        studyBack(online = false, cached = english)
        tapClueRow(3)
        assertTrue(compose.onAllNodesWithText(english, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty())
        assertTrue(tagged(SENTENCE_TRANSLATION_PENDING_TAG).isEmpty())
        assertEquals(0, translateCalls)
    }

    @Test fun clueRowGetsDevicePinyin() {
        val rows = sentenceRows(note, set)
        val row = rows.first()
        assertTrue(row.fromCard && row.fetchTranslation)
        assertTrue("auto pinyin for a clue without one: ${row.pinyin}", row.pinyin!!.contains("cài"))
        assertTrue("tidy around punctuation: ${row.pinyin}", !row.pinyin!!.contains(" ，") && row.pinyin!!.endsWith("。"))
        // A note that has both keeps its own and fetches nothing.
        val full = sentenceRows(note.copy(sentenceCluePinyin = "Fúwùyuán, wǒmen yào diǎn cài.", sentenceClueTranslation = english), set).first()
        assertEquals("Fúwùyuán, wǒmen yào diǎn cài.", full.pinyin)
        assertEquals(english, full.translation)
        assertTrue(!full.fetchTranslation)
    }
}
