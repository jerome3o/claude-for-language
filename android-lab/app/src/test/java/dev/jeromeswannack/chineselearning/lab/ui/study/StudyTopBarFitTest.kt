package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.text.TextLayoutResult
import androidx.test.core.app.ApplicationProvider
import com.github.takahirom.roborazzi.captureRoboImage
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.HardMode
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.QueueCard
import dev.jeromeswannack.chineselearning.lab.core.QueueCounts
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.testing.Samples
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.After
import org.junit.Test
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The study top bar on a tight width (Jerome's Pixel Fold, folded: "132" broke onto two lines once the
 * 🎯 Red chip joined 📖 1 and ✈ Auto). Every count stays ONE line and fully visible, at 360 / 412 dp and
 * unfolded, with long counts; the chips go icon-only (44 dp, labelled) only when they must.
 */
class StudyTopBarFitTest : LabScreenshotTest() {
    private val prefs get() = StudyPrefs.get(ApplicationProvider.getApplicationContext())

    @After fun off() = prefs.setHardMode(HardMode.OFF)

    private fun view(): CardView {
        val now = Js.parseDate("2026-10-24T08:00:00.000Z")
        var state = CardScheduler.initialCardState()
        state = CardScheduler.applyReview(state, 0, "2026-10-24T07:50:00.000Z")
        return CardView(QueueCard("c1", Samples.note.id, "d1", CardTypes.HANZI_TO_MEANING, state), Samples.note, Samples.sentences, CardScheduler.intervalPreviews(state, now), emptyList(), 1, "HSK 3", true)
    }

    private fun show(counts: QueueCounts, mode: String = HardMode.RED, todayLeft: TodayLeft = TodayLeft(reader = true)) {
        prefs.setHardMode(mode)
        val ui = StudyUi(StudyPhase.Showing(view()), counts, SessionStats(reviews = 5, correct = 4), canUndo = true, online = true, todayLeft = todayLeft)
        compose.setContent { LabTheme { StudyScreen(ui, playingKey = null, actions = StudyActions(), autoplay = false) } }
        compose.mainClock.advanceTimeBy(1_500)
    }

    private fun layout(tag: String): TextLayoutResult {
        val node = compose.onNodeWithTag(tag, useUnmergedTree = true).fetchSemanticsNode()
        val results = mutableListOf<TextLayoutResult>()
        node.config[SemanticsActions.GetTextLayoutResult].action!!.invoke(results)
        return results.single()
    }

    /** Each number on one line, not cut off, and clear of the chips on its right. */
    private fun assertCountsFit(counts: QueueCounts) {
        val numbers = listOf(counts.new, counts.secondaryNew, counts.learning, counts.review)
        CountBucket.entries.forEachIndexed { i, bucket ->
            val tag = queueCountTag(bucket)
            val text = compose.onNodeWithTag(tag, useUnmergedTree = true).fetchSemanticsNode().config.getOrNull(SemanticsProperties.Text)
            assertEquals("${numbers[i]}", text?.joinToString { it.text })
            val l = layout(tag)
            assertEquals(1, l.lineCount, "$bucket is one line")
            // softWrap = false lays the line out unbounded: it must still fit the box it got.
            val line = l.getLineRight(0) - l.getLineLeft(0)
            assertTrue(line <= l.size.width + 0.5f, "$bucket fits its width ($line > ${l.size.width})")
        }
        val review = compose.onNodeWithTag(queueCountTag(CountBucket.REVIEW), useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
        val chip = compose.onNodeWithTag(HardModeTags.CHIP, useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
        assertTrue(review.right <= chip.left + 1f, "the review count ends before the 🎯 chip ($review vs $chip)")
    }

    private val long = QueueCounts(new = 1, secondaryNew = 12, learning = 23, review = 1432)
    private val jerome = QueueCounts(new = 1, secondaryNew = 0, learning = 3, review = 132)

    @Test fun foldedJeromesCountsFitWithTheRedChip() {
        show(jerome)
        assertCountsFit(jerome)
    }

    @Test fun foldedLongCountsFit() {
        show(long)
        assertCountsFit(long)
        // Tight: the 🎯 chip is a labelled icon (a 44 dp target) with the state as a dot.
        val chip = compose.onNodeWithTag(HardModeTags.CHIP, useUnmergedTree = true).fetchSemanticsNode()
        assertEquals(listOf(HardMode.chipLabel(HardMode.RED)), chip.config[SemanticsProperties.ContentDescription])
        assertTrue(chip.size.width >= with(compose.density) { 44.0f * density } - 1, "≥ 44 dp")
        assertEquals(1, compose.onAllNodesWithTag(HardModeTags.CHIP_DOT, useUnmergedTree = true).fetchSemanticsNodes().size)
    }

    @Config(qualifiers = "w360dp-h800dp-xxhdpi")
    @Test fun narrowLongCountsFit() {
        show(long, mode = HardMode.ALL)
        assertCountsFit(long)
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun unfoldedKeepsTheFullChips() {
        show(long)
        assertCountsFit(long)
        assertEquals(0, compose.onAllNodesWithTag(HardModeTags.CHIP_DOT, useUnmergedTree = true).fetchSemanticsNodes().size)
    }

    @Test fun fitPicksTheWidestLevelThatFits() {
        assertEquals(StudyTopBarFit.FULL, StudyTopBarFit.choose(800f, { 100f }, { 150f }))
        assertTrue(StudyTopBarFit.choose(412f, { if (it.counts.fontSp >= 17f && !it.compactChips) 180f else 150f }, { if (it.compactChips) 90f else 190f }).compactChips)
        assertEquals(StudyTopBarFit.LEVELS.last(), StudyTopBarFit.choose(200f, { 300f }, { 100f }))
    }

    // ---- screenshots

    private fun shot(name: String) = compose.onRoot().captureRoboImage("screenshots/$name.png")

    @Test fun shotFolded() {
        show(jerome)
        shot("round-polish-01-header-412-jerome")
    }

    @Test fun shotFoldedLong() {
        show(long)
        shot("round-polish-02-header-412-long")
    }

    @Config(qualifiers = "w360dp-h800dp-xxhdpi")
    @Test fun shotNarrowLong() {
        show(long)
        shot("round-polish-03-header-360-long")
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun shotUnfoldedLong() {
        show(long)
        shot("round-polish-04-header-unfolded-long")
    }
}
