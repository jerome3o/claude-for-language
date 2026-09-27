package dev.jeromeswannack.chineselearning.lab.ui.strokes

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.StrokeQuiz
import dev.jeromeswannack.chineselearning.lab.core.WritingMode
import dev.jeromeswannack.chineselearning.lab.data.strokes.StrokeLoad
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.nav.TabId
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import org.junit.Test
import org.robolectric.annotation.Config

/** Handwriting practice (package H): the page, the pad in each state, the summary, the sheet. */
@OptIn(ExperimentalCoroutinesApi::class)
class StrokesScreenshots : LabScreenshotTest() {
    private val data = listOf("你", "好", "十", "永").associateWith { TestStrokes.data(it) }
    private val recent = listOf(
        PracticeWord("打算", "dǎsuàn", "to plan"), PracticeWord("你好", "nǐ hǎo", "hello"), PracticeWord("周末", "zhōumò", "weekend"),
        PracticeWord("谢谢", "xièxie", "thank you"), PracticeWord("中国", "Zhōngguó", "China"), PracticeWord("永远", "yǒngyuǎn", "forever"),
    )

    private fun controller(text: String, mode: WritingMode, scope: TestScope = TestScope(), autoDemo: Boolean = true) =
        WritingController(text, StrokeQuiz.writableCharacters(text), data, emptyList(), mode, autoDemo, scope)

    private fun run(c: WritingController, pinyin: String? = "nǐ hǎo", english: String? = "hello") = shoot(nameFor(c), settleMs = 3_000) {
        Box(Modifier.fillMaxSize().background(Lab.colors.background).padding(20.dp)) {
            WritingRunView(c, pinyin = pinyin, english = english, still = true)
        }
    }

    private var pendingName = ""
    private fun nameFor(@Suppress("UNUSED_PARAMETER") c: WritingController) = pendingName

    @Test fun page() = shootInShell("strokes-01-page", active = TabId.MORE) {
        StrokePracticeScreen(StrokePracticeUi(recent = recent, offlineTotal = 412, offlineCached = 57), StrokePracticeActions(onBack = {}))
    }

    @Test fun pageWithWord() = shoot("strokes-02-page-trace-demo", settleMs = 1_500) {
        StrokePracticeScreen(
            StrokePracticeUi(text = "你好", found = recent[1], recent = recent, offlineTotal = 412, offlineCached = 412),
            StrokePracticeActions(onBack = {}, loader = TestStrokes.loader),
        )
    }

    @Test fun traceHalfway() {
        val c = controller("你好", WritingMode.TRACE)
        c.onPenDown()
        c.charData.medians.take(3).forEach { c.onStroke(TestStrokes.draw(it)) }
        pendingName = "strokes-03-trace-three-strokes"
        run(c)
    }

    @Test fun wrongOrderWithStartHint() {
        val c = controller("你好", WritingMode.RECALL)
        val m = c.charData.medians
        c.onStroke(TestStrokes.draw(m[0]))
        c.onStroke(TestStrokes.draw(m[1]))
        c.onStroke(TestStrokes.draw(m[3]))
        c.onStroke(TestStrokes.draw(m[2], reverse = true))
        pendingName = "strokes-04-recall-backwards-start-hint"
        run(c)
    }

    @Test fun strokeHint() {
        val c = controller("永", WritingMode.RECALL)
        c.onStroke(TestStrokes.draw(c.charData.medians[0]))
        c.requestHint()
        pendingName = "strokes-05-recall-stroke-hint"
        run(c, pinyin = "yǒng", english = "forever")
    }

    @Test fun characterDone() {
        val c = controller("你好", WritingMode.RECALL)
        c.charData.medians.forEach { c.onStroke(TestStrokes.draw(it)) }
        pendingName = "strokes-06-character-perfect"
        run(c)
    }

    @Test fun summary() {
        val scope = TestScope()
        val c = controller("你好", WritingMode.RECALL, scope)
        val first = c.charData.medians
        c.onStroke(TestStrokes.draw(first[1]))
        first.forEach { c.onStroke(TestStrokes.draw(it)) }
        scope.advanceUntilIdle()
        c.requestHint()
        c.charData.medians.forEach { c.onStroke(TestStrokes.draw(it)) }
        scope.advanceUntilIdle()
        pendingName = "strokes-07-summary"
        shoot(pendingName) {
            Box(Modifier.fillMaxSize().background(Lab.colors.background).padding(20.dp)) {
                WritingRunView(c, pinyin = "nǐ hǎo", english = "hello", onDone = {}, doneLabel = "Back to the card")
            }
        }
    }

    @Test fun offline() = shoot("strokes-08-offline") {
        StrokePracticeScreen(
            StrokePracticeUi(text = "谢谢", recent = recent, offlineTotal = 412, offlineCached = 57, saving = 120 to 355),
            StrokePracticeActions(onBack = {}, loader = { StrokeLoad.Offline }),
        )
    }

    @Test fun sheet() = shoot("strokes-09-write-it-sheet", settleMs = 1_500) {
        WritingSheetBody("十", onClose = {}, pinyin = "shí", english = "ten", loader = TestStrokes.loader)
    }

    @Test fun dark() {
        val c = controller("你好", WritingMode.TRACE)
        c.onPenDown()
        c.charData.medians.take(5).forEach { c.onStroke(TestStrokes.draw(it)) }
        shoot("strokes-10-dark", dark = true, settleMs = 3_000) {
            Box(Modifier.fillMaxSize().background(Lab.colors.background).padding(20.dp)) { WritingRunView(c, pinyin = "nǐ hǎo", english = "hello", still = true) }
        }
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun unfolded() = shoot("strokes-11-unfolded", settleMs = 1_500) {
        StrokePracticeScreen(
            StrokePracticeUi(text = "你好", found = recent[1], recent = recent, offlineTotal = 412, offlineCached = 412),
            StrokePracticeActions(onBack = {}, loader = TestStrokes.loader),
        )
    }
}
