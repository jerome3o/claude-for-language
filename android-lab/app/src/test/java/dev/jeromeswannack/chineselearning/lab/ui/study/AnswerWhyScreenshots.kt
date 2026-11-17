package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.github.takahirom.roborazzi.captureRoboImage
import dev.jeromeswannack.chineselearning.lab.core.AnswerDiff
import dev.jeromeswannack.chineselearning.lab.core.AnswerWhy
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Test

/**
 * The ONE why sentence + "Explain more ›" under a judged answer (docs/STUDY_SESSION.md "Answer feedback: one line and a
 * diff"; Jerome: "one sentence as to why my answer is also okay or why it's wrong … a little button that's like explain
 * more"): his Sentence round take said differently from the model, a wrong one with its why, and Explain more opened.
 */
class AnswerWhyScreenshots : LabScreenshotTest() {
    @Composable
    private fun Panel() {
        Column(
            Modifier.fillMaxSize().background(Lab.colors.card).verticalScroll(rememberScrollState()).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(26.dp),
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("Sentence round · Say it in Chinese: “This is a true story.”", color = Lab.colors.muted, fontSize = 12.sp)
                DifferenceTitle(dev.jeromeswannack.chineselearning.lab.core.AnswerDifference.ACCEPTABLE)
                DifferenceCompare(
                    "这是一个真实的故事。", "这是真实的故事。", "Zhè shì zhēnshí de gùshi.", accepted = true, onPlayModel = {},
                    verdict = AnswerDiff.verdict("acceptable"), hideLine = true,
                    check = AnswerWhy.Check("Correct — 一个 is optional here; both are natural.", listOf("Without 一个 it sounds a little more written.")),
                )
            }
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("Hard mode · a sentence Claude checked", color = Lab.colors.muted, fontSize = 12.sp)
                AnswerDiffView(
                    "他说的很好", "他说得很好", expectedPinyin = "Tā shuō de hěn hǎo.", onPlayExpected = {},
                    verdict = AnswerDiff.verdict("almost"),
                    check = AnswerWhy.Check(
                        "Nearly — compare with the corrected version.",
                        listOf("得 links a verb to how it was done; 的 belongs before a noun.", "Say 说得很好: \"speaks very well\"."),
                        corrected = "他说得很好",
                    ),
                )
            }
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("Mini lesson · translate — Explain more opened", color = Lab.colors.muted, fontSize = 12.sp)
                AnswerDiffView(
                    "我买了三块钱苹果", "我买了三块钱的苹果", expectedPinyin = "Wǒ mǎile sān kuài qián de píngguǒ.", onPlayExpected = {},
                    verdict = AnswerDiff.verdict("almost"),
                    check = AnswerWhy.Check(
                        "Almost — add 的 between the price and the thing you bought.",
                        listOf("A price describing a noun takes 的: 三块钱的苹果.", "Without 的 it reads as two separate pieces."),
                        alternative = "我买了三块钱的苹果。",
                    ),
                )
            }
        }
    }

    private fun shootOpened(name: String, dark: Boolean) {
        compose.setContent { LabTheme(dark = dark) { Panel() } }
        compose.mainClock.advanceTimeBy(1_000)
        val more = compose.onAllNodesWithTag(AnswerWhyTags.MORE).fetchSemanticsNodes().size
        compose.onAllNodesWithTag(AnswerWhyTags.MORE)[more - 1].performClick()
        compose.mainClock.advanceTimeBy(1_000)
        compose.onRoot().captureRoboImage("screenshots/$name.png")
    }

    @Test fun whyDark() = shootOpened("adiff-07-why-dark", dark = true)

    @Test fun whyLight() = shootOpened("adiff-08-why-light", dark = false)
}
