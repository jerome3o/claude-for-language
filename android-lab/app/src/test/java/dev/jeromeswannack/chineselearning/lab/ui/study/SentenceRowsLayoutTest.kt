package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsNode
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
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.testing.Samples
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.robolectric.annotation.Config

/**
 * The example sentences on the card back: the card's own sentence (row 1, "From the card") and
 * a set of five, with the header above and the "+ 5 more sentences" line on its own below.
 *
 * Regression: #446 wrapped the list in a Box to keep its taps, and the list emitted its header,
 * rows and "+ 5 more" line as loose siblings — so the Box drew them on top of each other (the
 * header hidden under the rows, "+ 5 more sentences" over the first row). These tests check the
 * stacking at font scale 1.0 and 1.3, folded and unfolded, and shoot the state Jerome saw
 * (dark theme, 1.3) collapsed and with Show all.
 */
class SentenceRowsLayoutTest : LabScreenshotTest() {
    private val note = Samples.note.copy(
        hanzi = "桃李满天下", pinyin = "táo lǐ mǎn tiānxià", english = "to have students all over the world",
        funFacts = "桃 (táo) peach + 李 (lǐ) plum = a teacher's students, 满 (mǎn) full, 天下 (tiānxià) the whole world. Said to praise a great teacher.",
        sentenceClue = "王老师教了三十年书，真是桃李满天下。",
        sentenceCluePinyin = "Wáng lǎoshī jiāole sānshí nián shū, zhēn shì táo lǐ mǎn tiānxià.",
        sentenceClueTranslation = "Teacher Wang taught for thirty years — she truly has students all over the world.",
    )

    private val set = listOf(
        SentenceEntity("s1", "n1", 0, "我的老师桃李满天下。", "Wǒ de lǎoshī táo lǐ mǎn tiānxià.", "My teacher has students everywhere.", null, "core", null),
        SentenceEntity("s2", "n1", 1, "这位教授桃李满天下，很受尊敬。", "Zhè wèi jiàoshòu táo lǐ mǎn tiānxià, hěn shòu zūnjìng.", "This professor has students all over the world and is highly respected.", null, "core", null),
        SentenceEntity("s3", "n1", 2, "春天到了，院子里的桃花和李花都开了。", "Chūntiān dào le, yuànzi lǐ de táohuā hé lǐhuā dōu kāi le.", "Spring has come; the peach and plum blossoms in the yard are all out.", null, "shared_character", "桃 and 李 in their literal sense"),
        SentenceEntity("s4", "n1", 3, "他的学生遍布全国。", "Tā de xuésheng biànbù quánguó.", "His students are spread across the whole country.", null, "contrast", "遍布 says the same thing plainly"),
        SentenceEntity("s5", "n1", 4, "退休那天，她收到了来自世界各地学生的祝福，大家都说她桃李满天下。", "Tuìxiū nà tiān, tā shōudàole láizì shìjiè gèdì xuésheng de zhùfú, dàjiā dōu shuō tā táo lǐ mǎn tiānxià.", "On the day she retired she got good wishes from students all over the world; everyone said her students were everywhere.", null, "complex", null),
    )

    private fun studyBack(fontScale: Float, dark: Boolean) {
        val now = Js.parseDate("2026-09-28T19:35:00.000Z")
        var state = CardScheduler.initialCardState()
        state = CardScheduler.applyReview(state, 2, "2026-09-20T08:00:00.000Z")
        val card = QueueCard("c1", note.id, "d1", CardTypes.HANZI_TO_MEANING, state)
        val view = CardView(card, note, set, CardScheduler.intervalPreviews(state, now), emptyList(), 1, "Idioms", true)
        val ui = StudyUi(StudyPhase.Showing(view), Samples.counts, SessionStats(reviews = 5, correct = 4), canUndo = true, online = true, forcedOffline = false)
        compose.setContent {
            LabTheme(dark = dark) {
                CompositionLocalProvider(LocalDensity provides Density(LocalDensity.current.density, fontScale)) {
                    StudyScreen(ui, playingKey = null, actions = StudyActions(), cardStart = CardStartState(flipped = true), autoplay = false)
                }
            }
        }
        compose.mainClock.advanceTimeBy(2_000)
    }

    private fun node(text: String): SemanticsNode = compose.onNodeWithText(text, useUnmergedTree = true).fetchSemanticsNode()
    private fun SemanticsNode.top() = positionInRoot.y
    private fun SemanticsNode.bottom() = positionInRoot.y + size.height

    /** Header, then every row one under the other, then "+ 5 more sentences" — nothing overlapping. */
    private fun assertStacked(expectedRows: Int, rowText: String) {
        val header = node("Example sentences")
        val rows = compose.onAllNodesWithText(rowText, useUnmergedTree = true).fetchSemanticsNodes().sortedBy { it.top() }
        val more = node("+ 5 more sentences")
        assertEquals("the card's own sentence + the set of five", expectedRows, rows.size)
        assertTrue("header above the first row", header.bottom() <= rows.first().top())
        rows.zipWithNext().forEach { (a, b) -> assertTrue("rows don't overlap", a.bottom() <= b.top()) }
        assertTrue("\"+ 5 more sentences\" on its own line below the last row", rows.last().bottom() < more.top())
    }

    private fun scrollToList() {
        compose.onNodeWithText("Example sentences").performScrollTo()
        compose.mainClock.advanceTimeBy(500)
    }

    /** Down to the end of the list: the last rows and the "+ 5 more sentences" line under them. */
    private fun scrollToEnd() {
        compose.onNodeWithText("+ 5 more sentences").performScrollTo()
        compose.mainClock.advanceTimeBy(500)
    }

    private fun showAll() {
        compose.onNodeWithText("Show all").performScrollTo().performClick()
        compose.mainClock.advanceTimeBy(1_000)
    }

    @Test fun collapsedStacksAtFontScale1() {
        studyBack(1f, dark = false)
        assertStacked(6, "Tap to reveal")
    }

    @Test fun collapsedStacksAtFontScale13Dark() {
        studyBack(1.3f, dark = true)
        scrollToEnd()
        compose.onRoot().captureRoboImage("screenshots/study-e01-sentences-collapsed-dark-1.3.png")
        assertStacked(6, "Tap to reveal")
    }

    @Test fun expandedStacksAndShowsTheCardBadge() {
        studyBack(1.3f, dark = true)
        showAll()
        scrollToList()
        compose.onRoot().captureRoboImage("screenshots/study-e02-sentences-expanded-dark-1.3.png")
        scrollToEnd()
        compose.onRoot().captureRoboImage("screenshots/study-e03-sentences-expanded-end-dark-1.3.png")
        // Row 1 is the note's own sentence, badged as such once it is open.
        val clue = node(note.sentenceClue!!)
        val badge = node("From the card")
        val firstSet = node(set[0].hanzi)
        assertTrue(clue.top() < badge.top() && badge.bottom() <= firstSet.top())
        assertStacked(1, note.sentenceClue!!)
        assertTrue(node(set.last().hanzi).bottom() < node("+ 5 more sentences").top())
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun unfoldedStacksAtFontScale13() {
        studyBack(1.3f, dark = true)
        scrollToEnd()
        compose.onRoot().captureRoboImage("screenshots/study-e04-sentences-unfolded-dark-1.3.png")
        assertStacked(6, "Tap to reveal")
    }
}
