package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import com.github.takahirom.roborazzi.captureRoboImage
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.TutorNoteRow
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Regression: a "🎤 On your recording" note on a whole sentence put the 28sp hanzi in a Row beside
 * the pinyin / English column — the hanzi took the width and the pinyin wrapped letter by letter
 * in a ~2-character strip, making the card hundreds of dp tall (Pixel Fold, folded, 412dp).
 * The card now stacks header → hanzi → pinyin → English → comment → actions.
 */
class TutorNotesLayoutTest : LabScreenshotTest() {
    private val nowMs = Js.parseDate("2026-10-03T09:30:00.000Z")

    private val sentence = TutorNoteRow(
        "r-long", "recording", "c-long", "hanzi_to_meaning", "n-long", "d1",
        "不知道睡觉的小裤子怎么说", "bù zhīdào shuìjiào de xiǎo kùzi zěnme shuō",
        "I don't know how to say \"little pyjama trousers\"",
        "睡裤 (shuìkù) is the word — 裤 is fourth tone. Keep 怎么说 light at the end.",
        "Mandarin Home 明慧老师", "2026-10-03T08:00:00Z", null, "recordings/r-long.webm", null,
    )
    private val flag = TutorNoteRow(
        "f-long", "flag", "c-flag", "meaning_to_hanzi", "n-flag", "d1",
        "我对中国文化特别感兴趣，尤其是书法和茶艺", "wǒ duì Zhōngguó wénhuà tèbié gǎn xìngqù, yóuqí shì shūfǎ hé cháyì",
        "I'm especially interested in Chinese culture, above all calligraphy and the tea ceremony",
        "对…感兴趣 is right. 尤其是 adds \"above all\".", "Mandarin Home 明慧老师", "2026-10-02T08:00:00Z",
        null, null, "Is 尤其是 the right word here?",
    )

    private fun node(text: String): SemanticsNode = compose.onNodeWithText(text, useUnmergedTree = true).fetchSemanticsNode()
    private fun SemanticsNode.left() = positionInRoot.x
    private fun SemanticsNode.right() = positionInRoot.x + size.width
    private fun SemanticsNode.top() = positionInRoot.y
    private fun SemanticsNode.bottom() = positionInRoot.y + size.height

    private fun render(vararg notes: TutorNoteRow) {
        compose.setContent {
            LabTheme { TutorNotesScreen(TutorNotesUi(true, notes.toList(), emptyList()), playingKey = null, actions = TutorNotesActions(), nowMs = nowMs) }
        }
        compose.mainClock.advanceTimeBy(2_000)
    }

    private fun assertStacked(n: TutorNoteRow, card: SemanticsNode) {
        val hanzi = node(n.hanzi)
        val pinyin = node(n.pinyin)
        val english = node(n.english)
        // The card's content column = the card minus the 4dp stripe and 14dp padding each side.
        val density = compose.density.density
        val content = card.size.width - (4 + 14 + 14) * density
        assertTrue("pinyin is ${pinyin.size.width}px wide of ${content}px content", pinyin.size.width >= 0.8f * content)
        assertTrue("English is ${english.size.width}px wide of ${content}px content", english.size.width >= 0.8f * content)
        assertTrue("hanzi above the pinyin", hanzi.bottom() <= pinyin.top() + 1)
        assertTrue("pinyin above the English", pinyin.bottom() <= english.top() + 1)
        assertTrue("hanzi fits in the card", hanzi.left() >= card.left() && hanzi.right() <= card.right() + 1)
        assertTrue("pinyin fits in the card", pinyin.right() <= card.right() + 1)
        // Two lines of pinyin + two of English + the hanzi + header, comment and actions — not hundreds of dp.
        assertTrue("card is ${card.size.height / density}dp tall", card.size.height / density < 420)
    }

    @Test fun longSentenceRecordingNoteStacks() {
        render(sentence)
        val card = compose.onAllNodesWithTag("tutor-note").fetchSemanticsNodes().single()
        compose.onRoot().captureRoboImage("screenshots/tutor-notes-08-long-sentence.png")
        assertStacked(sentence, card)
    }

    @Test fun longSentenceFlagNoteStacks() {
        render(flag)
        val card = compose.onAllNodesWithTag("tutor-note").fetchSemanticsNodes().single()
        assertStacked(flag, card)
    }
}
