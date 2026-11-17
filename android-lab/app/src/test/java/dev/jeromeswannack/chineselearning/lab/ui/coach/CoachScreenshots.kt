package dev.jeromeswannack.chineselearning.lab.ui.coach

import dev.jeromeswannack.chineselearning.lab.data.api.SentenceBreakdownDto
import dev.jeromeswannack.chineselearning.lab.data.api.SentenceChunkDto
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.analyze.AnalyzeActions
import dev.jeromeswannack.chineselearning.lab.ui.analyze.AnalyzeScreen
import dev.jeromeswannack.chineselearning.lab.ui.analyze.AnalyzeUi
import org.junit.Test
import org.robolectric.annotation.Config

/** Sentence Coach + Sentence Breakdown (package H). */
class CoachScreenshots : LabScreenshotTest() {

    @Test fun conversation() = shoot("coach-04-conversation") {
        CoachConversationPreview(CoachChatUi(thread = Loadable(CoachSamples.thread)), CoachChatActions())
    }

    @Test fun translationSending() = shoot("coach-05-translation-sending", settleMs = 600) {
        CoachConversationPreview(
            CoachChatUi(thread = Loadable(CoachSamples.translationThread), sending = true, pendingMessage = "Show me 2–3 other natural ways to say \"我昨天去买茶了。\""),
            CoachChatActions(),
        )
    }

    @Test fun sendError() = shoot("coach-06-send-error") {
        CoachConversationPreview(
            CoachChatUi(thread = Loadable(CoachSamples.translationThread), followUp = "Why 了 at the end?", sendError = "Couldn't send that — the connection dropped. Try again."),
            CoachChatActions(),
        )
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun unfolded() = shoot("coach-07-unfolded") {
        CoachConversationPreview(CoachChatUi(thread = Loadable(CoachSamples.thread)), CoachChatActions())
    }

    @Test fun dark() = shoot("coach-08-dark", dark = true) {
        CoachConversationPreview(CoachChatUi(thread = Loadable(CoachSamples.thread)), CoachChatActions())
    }

    private val breakdown = SentenceBreakdownDto(
        "你好，请问洗手间在哪里？", "chinese", "你好，请问洗手间在哪里？", "Nǐ hǎo, qǐngwèn xǐshǒujiān zài nǎlǐ?", "Hello, excuse me, where is the restroom?",
        listOf(
            SentenceChunkDto("你好，", "Nǐ hǎo,", "Hello,", 0, 6),
            SentenceChunkDto("请问", "qǐngwèn", "excuse me", 7, 16, "请问 opens a polite question to a stranger."),
            SentenceChunkDto("洗手间", "xǐshǒujiān", "the restroom", 27, 39),
            SentenceChunkDto("在哪里？", "zài nǎlǐ?", "where is", 18, 26, "在 + 哪里: where something is."),
        ),
        "Chinese puts the place question (在哪里) at the end; English moves 'where' to the front.",
    )

    @Test fun analyze() = shoot("analyze-01-input") { AnalyzeScreen(AnalyzeUi(draft = "我每天早上喝咖啡"), AnalyzeActions(onBack = {})) }

    @Test fun breakdownView() = shoot("analyze-02-breakdown") { AnalyzeScreen(AnalyzeUi(breakdown = breakdown, chunk = 1), AnalyzeActions(onBack = {})) }
}
