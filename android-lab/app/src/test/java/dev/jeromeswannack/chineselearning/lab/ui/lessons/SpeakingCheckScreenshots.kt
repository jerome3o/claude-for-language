package dev.jeromeswannack.chineselearning.lab.ui.lessons

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.AnswerCheck
import dev.jeromeswannack.chineselearning.lab.core.AnswerCheckPart
import dev.jeromeswannack.chineselearning.lab.core.AnswerCheckTip
import dev.jeromeswannack.chineselearning.lab.core.LessonAnswerCheck
import dev.jeromeswannack.chineselearning.lab.core.LessonSentence
import dev.jeromeswannack.chineselearning.lab.core.LessonWord
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import org.junit.Test
import kotlin.random.Random
import kotlin.test.assertEquals

/**
 * Claude's check of free speaking (SpeakingCheckViews.kt, docs/STUDY_SESSION.md "Claude checks your
 * speaking") on Jerome's "Annie" task: the transcript under "🎤 You said", the check with the task's
 * parts ✓ ~ ✗, a cleaner version and tips with the better words; and "Couldn't transcribe — tap to
 * retry". The views are stateless here (the recorder can't run under Robolectric).
 */
class SpeakingCheckScreenshots : LabScreenshotTest() {
    private val prompt = "A new colleague, Annie, arrives at your office. Guess who she is (① 就是…吧), tell her where two places are (② 就在), what today's meeting is about (③ 是关于…的), and how busy the team is (④ 形容词 + 到…)."
    private val said = "嗯，你好，你就是……sorry，你就是新来的Annie吧？欢迎欢迎！洗手间在……wait，洗手间就在电梯的旁边，打印机就在我的办公桌后面。今天的会议是关于下个月的活动。我们团队最近忙到……忙到没有时间吃午饭了。"
    private val check = AnswerCheck(
        verdict = "acceptable",
        headline = "All four parts are there — just close 是关于…的 with 的.",
        corrected = "你好，你就是新来的Annie吧？欢迎欢迎！洗手间就在电梯旁边，打印机就在我的办公桌后面。今天的会议是关于下个月的活动的。我们团队最近忙到没有时间吃午饭了。",
        correctedPinyin = "nǐ hǎo, nǐ jiù shì xīn lái de Annie ba? huānyíng huānyíng! xǐshǒujiān jiù zài diàntī pángbiān, dǎyìnjī jiù zài wǒ de bàngōngzhuō hòumiàn. jīntiān de huìyì shì guānyú xià ge yuè de huódòng de. wǒmen tuánduì zuìjìn máng dào méiyǒu shíjiān chī wǔfàn le.",
        tips = listOf(
            AnswerCheckTip("是关于…的 needs its closing 的: 是关于下个月的活动的.", "是关于下个月的活动", "是关于下个月的活动的", "shì guānyú xià ge yuè de huódòng de"),
            AnswerCheckTip("With 旁边 the 的 is usually dropped: 电梯旁边 sounds more natural.", "电梯的旁边", "电梯旁边", "diàntī pángbiān"),
        ),
        suggested = "got_it",
        cleaned = "你好，你就是新来的Annie吧？欢迎欢迎！洗手间就在电梯的旁边，打印机就在我的办公桌后面。今天的会议是关于下个月的活动。我们团队最近忙到没有时间吃午饭了。",
        parts = listOf(
            AnswerCheckPart("① 就是…吧", "used", "你就是新来的Annie吧 — a perfect friendly guess."),
            AnswerCheckPart("② 就在", "used", "Two places: 洗手间就在… and 打印机就在…."),
            AnswerCheckPart("③ 是关于…的", "used_with_issue", "The closing 的 is missing."),
            AnswerCheckPart("④ 形容词 + 到…", "used", "忙到没有时间吃午饭 — great use."),
        ),
    )
    private val env = ExerciseEnv(random = Random(7))

    @Composable
    private fun Screen(transcript: SpeakingTranscript, withCheck: Boolean, header: Boolean = true) {
        Column(
            Modifier.fillMaxSize().background(Lab.colors.card).verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            if (header) {
                PhaseLabel("Speak — recorded 🎙")
                PromptText(prompt)
                Explanation("Useful words")
                WordChips(listOf(LessonWord("就是", "jiù shì"), LessonWord("就在", "jiù zài"), LessonWord("关于", "guānyú")), env)
                ActionRow { Secondary("▶ Your answer") {} }
                SpeakingTranscriptBlock(transcript, onRetry = {}) {
                    if (withCheck) AnswerCheckBody(check, said, onPlay = {}, onRetry = {}, onAsk = {})
                }
            } else {
                // The lower half of the same screen: the check's tips, the model answer, the buttons.
                AnswerCheckBody(check, said, onPlay = {}, onRetry = {}, onAsk = {})
            }
            Reference(LessonSentence("你就是新来的Annie吧？洗手间就在那边。", "Nǐ jiù shì xīn lái de Annie ba? Xǐshǒujiān jiù zài nàbiān."), env, label = "One way to say it:")
            SelfAssess("How did it go?", yes = "✓ I said it well", suggested = true) {}
        }
    }

    @Test fun transcribedAndChecked() = shoot("speaking-check-01-checked") { Screen(SpeakingTranscript.Done(said, "live"), withCheck = true) }

    @Test fun checkLowerHalf() = shoot("speaking-check-01b-tips") { Screen(SpeakingTranscript.Done(said, "live"), withCheck = true, header = false) }

    @Test fun transcriptionFailed() = shoot("speaking-check-02-failed") { Screen(SpeakingTranscript.Failed, withCheck = false) }

    @Test fun offline() = shoot("speaking-check-03-offline") { Screen(SpeakingTranscript.Offline, withCheck = false) }

    @Test fun cleanerVersionDiffsWhatTheyMeant() {
        val v = LessonAnswerCheck.cleanerVersion(check)
        assertEquals(check.corrected, v.hanzi)
        assertEquals(check.cleaned, v.diffFrom)
    }
}
