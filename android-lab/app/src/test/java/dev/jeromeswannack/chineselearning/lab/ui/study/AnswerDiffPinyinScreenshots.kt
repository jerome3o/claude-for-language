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
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.github.takahirom.roborazzi.captureRoboImage
import dev.jeromeswannack.chineselearning.lab.core.AnswerDiff
import dev.jeromeswannack.chineselearning.lab.core.AnswerKey
import dev.jeromeswannack.chineselearning.lab.core.AnswerWhy
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * His own pinyin under "You said" (Jerome: "the stuff that I said that was incorrect also has pinyin, so I can see where
 * my pronunciation was") and the small "💬 Ask Claude" link when the check gave no reason (docs/STUDY_SESSION.md
 * "Answer feedback: one line and a diff").
 */
class AnswerDiffPinyinScreenshots : LabScreenshotTest() {
    @Composable
    private fun Panel(onAsk: (String) -> Unit = {}) {
        Column(
            Modifier.fillMaxSize().background(Lab.colors.card).verticalScroll(rememberScrollState()).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(26.dp),
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("Sentence round · Say it in Chinese: “He insulted me.”", color = Lab.colors.muted, fontSize = 12.sp)
                DifferenceCompare(
                    "他捂住了我", "他侮辱了我", "Tā wǔrǔle wǒ", accepted = false, onPlayModel = {},
                    verdict = AnswerDiff.verdict("wrong"),
                    check = AnswerWhy.Check("Wrong verb — 捂住 means ‘cover up’, not ‘insult’.", listOf("侮辱 wǔrǔ = to insult; 捂住 wǔzhù = to cover with the hand.")),
                    askPrompt = "He insulted me.",
                )
            }
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("Hard mode · Claude gave no reason → 💬 Ask Claude", color = Lab.colors.muted, fontSize = 12.sp)
                CompositionLocalProvider(LocalAnswerAsk provides onAsk) {
                    AnswerDiffView(
                        "他打了我", "他侮辱了我", expectedPinyin = "Tā wǔrǔle wǒ", expectedEnglish = "He insulted me.", onPlayExpected = {},
                        verdict = AnswerDiff.verdict("wrong"), tag = "ask-case",
                    )
                }
            }
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("Typing card · said the answer", color = Lab.colors.muted, fontSize = 12.sp)
                SpokenResultRow("我都是学生", "我读书是学生", AnswerKey.Verdict.WRONG)
            }
        }
    }

    private fun shoot(name: String, dark: Boolean) {
        compose.setContent { LabTheme(dark = dark) { Panel() } }
        compose.mainClock.advanceTimeBy(1_000)
        compose.onRoot().captureRoboImage("screenshots/$name.png")
    }

    @Test fun pinyinAndAskDark() = shoot("adiff-09-said-pinyin-ask-dark", dark = true)

    @Test fun pinyinAndAskLight() = shoot("adiff-10-said-pinyin-ask-light", dark = false)

    @Test
    fun saidPinyinMarksHisSyllables() {
        compose.setContent { LabTheme { AnswerDiffView("他捂住了我", "他侮辱了我", expectedPinyin = "Tā wǔrǔle wǒ") } }
        compose.onNodeWithTag(AnswerDiffTags.SAID_PINYIN, useUnmergedTree = true).assertTextEquals("tā wǔ zhù le wǒ")
        val syllables = AnswerDiff.pinyinLine(AnswerDiff.of("他捂住了我", "他侮辱了我"))!!
        assertEquals(listOf("zhù"), syllables.filter { it.kind == "wrong" }.map { it.text })
    }

    @Test
    fun askLinkOnlyWhenNothingExplainsIt() {
        var asked: String? = null
        compose.setContent {
            LabTheme {
                CompositionLocalProvider(LocalAnswerAsk provides { q: String -> asked = q }) {
                    Column {
                        // No reason at all: the link.
                        AnswerDiffView("他打了我", "他侮辱了我", verdict = AnswerDiff.verdict("wrong"), askPrompt = "He insulted me", tag = "a")
                        // A why line: its Explain more asks instead — no link.
                        AnswerDiffView("他打了我", "他侮辱了我", verdict = AnswerDiff.verdict("wrong"), check = AnswerWhy.Check("Use 侮辱 for insult."), tag = "b")
                        // Right: nothing.
                        AnswerDiffView("他侮辱了我", "他侮辱了我", tag = "c")
                        // The answer still hidden: nothing.
                        AnswerDiffView("他打了我", "他侮辱了我", showExpected = false, verdict = AnswerDiff.verdict("wrong"), askable = false, tag = "d")
                    }
                }
            }
        }
        assertEquals(1, compose.onAllNodesWithTag(AnswerWhyTags.ASK, useUnmergedTree = true).fetchSemanticsNodes().size)
        compose.onNodeWithTag(AnswerWhyTags.ASK, useUnmergedTree = true).performClick()
        assertEquals("I was asked to say “He insulted me”. I said “他打了我” but the answer is “他侮辱了我”. What did I get wrong?", asked)
    }

    @Test
    fun noLinkWithoutAThread() {
        compose.setContent { LabTheme { AnswerDiffView("他打了我", "他侮辱了我", verdict = AnswerDiff.verdict("wrong")) } }
        assertEquals(0, compose.onAllNodesWithTag(AnswerWhyTags.ASK, useUnmergedTree = true).fetchSemanticsNodes().size)
    }
}
