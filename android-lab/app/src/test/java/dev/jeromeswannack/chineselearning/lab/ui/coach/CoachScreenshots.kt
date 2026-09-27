package dev.jeromeswannack.chineselearning.lab.ui.coach

import dev.jeromeswannack.chineselearning.lab.data.api.SentenceBreakdownDto
import dev.jeromeswannack.chineselearning.lab.data.api.SentenceChunkDto
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.analyze.AnalyzeActions
import dev.jeromeswannack.chineselearning.lab.ui.analyze.AnalyzeScreen
import dev.jeromeswannack.chineselearning.lab.ui.analyze.AnalyzeUi
import dev.jeromeswannack.chineselearning.lab.ui.nav.TabId
import org.junit.Test
import org.robolectric.annotation.Config

/** Sentence Coach + Sentence Breakdown (package H). */
class CoachScreenshots : LabScreenshotTest() {
    @Test fun home() = shootInShell("coach-01-home", active = TabId.MORE) {
        CoachHomeScreen(CoachHomeUi(draft = "我昨天去了商店买苹果", conversations = Loadable(CoachSamples.conversations)), CoachHomeActions(onBack = {}))
    }

    @Test fun startingOffline() = shoot("coach-02-start-error-offline") {
        CoachHomeScreen(
            CoachHomeUi(draft = "How do I say I'm running late?", startError = "You're offline — the coach needs a connection. Your text is kept; try again when you're back online.", conversations = Loadable(CoachSamples.conversations, offline = true, updatedAt = System.currentTimeMillis() - 3_600_000)),
            CoachHomeActions(onBack = {}),
        )
    }

    @Test fun analysing() = shoot("coach-03-analysing", settleMs = 600) {
        CoachHomeScreen(CoachHomeUi(draft = "How do I say I'm running late?", starting = true), CoachHomeActions(onBack = {}))
    }

    @Test fun conversation() = shoot("coach-04-conversation") {
        CoachChatScreen(CoachChatUi(thread = Loadable(CoachSamples.thread), decks = CoachSamples.decks, deckId = "d1"), CoachChatActions())
    }

    @Test fun translationSending() = shoot("coach-05-translation-sending", settleMs = 600) {
        CoachChatScreen(
            CoachChatUi(thread = Loadable(CoachSamples.translationThread), decks = CoachSamples.decks, sending = true, pendingMessage = "Show me 2–3 other natural ways to say \"我昨天去买茶了。\""),
            CoachChatActions(),
        )
    }

    @Test fun sendError() = shoot("coach-06-send-error") {
        CoachChatScreen(
            CoachChatUi(thread = Loadable(CoachSamples.translationThread), decks = CoachSamples.decks, followUp = "Why 了 at the end?", sendError = "Couldn't send that — the connection dropped. Try again."),
            CoachChatActions(),
        )
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun unfolded() = shoot("coach-07-unfolded") {
        CoachChatScreen(CoachChatUi(thread = Loadable(CoachSamples.thread), decks = CoachSamples.decks, deckId = "d1"), CoachChatActions())
    }

    @Test fun dark() = shoot("coach-08-dark", dark = true) {
        CoachChatScreen(CoachChatUi(thread = Loadable(CoachSamples.thread), decks = CoachSamples.decks, deckId = "d1"), CoachChatActions())
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
