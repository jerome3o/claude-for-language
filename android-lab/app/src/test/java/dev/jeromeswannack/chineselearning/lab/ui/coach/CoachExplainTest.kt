package dev.jeromeswannack.chineselearning.lab.ui.coach

import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import dev.jeromeswannack.chineselearning.lab.core.CoachAction
import dev.jeromeswannack.chineselearning.lab.data.api.CoachAnalysisDto
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.study.BREAKDOWN_HANZI_TAG
import dev.jeromeswannack.chineselearning.lab.ui.study.Chunk
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Assert.assertEquals
import org.junit.Test
import org.robolectric.annotation.Config

/**
 * Sentence Coach: Chinese offers "Check my sentence" + "Explain" (English only "Translate"), and
 * Explain shows the translation plus the study card's own one-word-per-row breakdown, every row
 * adding that word as a card, and "+ Add whole sentence as card".
 */
class CoachExplainTest : LabScreenshotTest() {
    private val explain = CoachAnalysisDto.parse(CoachSamples.ANALYSIS_EXPLAIN)!!.breakdown!!

    @Test fun buttonsChinese() = shoot("coach-09-buttons-chinese") {
        CoachHomeScreen(CoachHomeUi(draft = "这场比赛我们不能输。", conversations = Loadable(CoachSamples.conversationsWithExplain)), CoachHomeActions(onBack = {}))
    }

    @Test fun buttonsEnglish() = shoot("coach-10-buttons-english") {
        CoachHomeScreen(CoachHomeUi(draft = "How do I say I'm running late?", conversations = Loadable(CoachSamples.conversationsWithExplain)), CoachHomeActions(onBack = {}))
    }

    /** The widget's ✏️ (?focus=1): an empty box on the two buttons, disabled, nothing sent. */
    @Test fun buttonsEmpty() = shoot("coach-11-buttons-empty") {
        CoachHomeScreen(CoachHomeUi(conversations = Loadable(CoachSamples.conversationsWithExplain)), CoachHomeActions(onBack = {}))
    }

    @Test fun explaining() = shoot("coach-12-explaining", settleMs = 600) {
        CoachHomeScreen(CoachHomeUi(draft = "这场比赛我们不能输。", starting = true, pendingAction = CoachAction.EXPLAIN), CoachHomeActions(onBack = {}))
    }

    @Test fun explainResult() = shoot("coach-13-explain-result") {
        CoachChatScreen(CoachChatUi(thread = Loadable(CoachSamples.explainThread), decks = CoachSamples.decks, deckId = "d1"), CoachChatActions())
    }

    @Test fun explainResultDark() = shoot("coach-14-explain-result-dark", dark = true) {
        CoachChatScreen(CoachChatUi(thread = Loadable(CoachSamples.explainThread), decks = CoachSamples.decks, deckId = "d1"), CoachChatActions())
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun explainResultUnfolded() = shoot("coach-15-explain-unfolded") {
        CoachChatScreen(CoachChatUi(thread = Loadable(CoachSamples.explainThread), decks = CoachSamples.decks, deckId = "d1"), CoachChatActions())
    }

    /** Offline: Explain answers from the breakdown saved on the device. */
    @Test fun explainSavedOffline() = shoot("coach-16-explain-saved-offline") {
        CoachHomeScreen(
            CoachHomeUi(draft = "这场比赛我们不能输。", savedBreakdown = explain, online = false, startError = "You're offline — the coach needs a connection. Your text is kept; try again when you're back online."),
            CoachHomeActions(onBack = {}),
        )
    }

    @Test fun chineseHasCheckAndExplainEnglishOnlyTranslate() {
        var draft by mutableDraft("我昨天去了商店买苹果")
        val pressed = mutableListOf<CoachAction>()
        compose.setContent {
            LabTheme { CoachHomeScreen(CoachHomeUi(draft = draft), CoachHomeActions(onAction = { pressed += it })) }
        }
        compose.onNodeWithTag(coachActionTag(CoachAction.CHECK)).assertIsEnabled()
        compose.onNodeWithTag(coachActionTag(CoachAction.EXPLAIN)).assertIsEnabled().performClick()
        assertEquals(listOf(CoachAction.EXPLAIN), pressed)
        assertEquals(0, compose.onAllNodesWithTag(coachActionTag(CoachAction.TRANSLATE)).fetchSemanticsNodes().size)

        draft = "How do I say I'm running late?"
        compose.waitForIdle()
        compose.onNodeWithTag(coachActionTag(CoachAction.TRANSLATE)).assertIsEnabled().performClick()
        assertEquals(listOf(CoachAction.EXPLAIN, CoachAction.TRANSLATE), pressed)
        assertEquals(0, compose.onAllNodesWithTag(coachActionTag(CoachAction.EXPLAIN)).fetchSemanticsNodes().size)

        draft = "  "
        compose.waitForIdle()
        compose.onNodeWithTag(coachActionTag(CoachAction.CHECK)).assertIsNotEnabled()
        compose.onNodeWithTag(coachActionTag(CoachAction.EXPLAIN)).assertIsNotEnabled()
    }

    @Test fun wordRowsAndTheWholeSentenceBecomeCards() {
        val added = mutableListOf<Chunk>()
        compose.setContent { LabTheme { androidx.compose.foundation.lazy.LazyColumn { item { ExplainResult(explain, enabled = true, onAdd = { added += it }) } } } }
        val rows = compose.onAllNodesWithTag(BREAKDOWN_HANZI_TAG, useUnmergedTree = true).fetchSemanticsNodes()
        assertEquals(6, rows.size)
        compose.onNodeWithText("比赛", useUnmergedTree = true).performClick()
        assertEquals(Chunk("比赛", "bǐsài", "match, competition"), added.single())

        compose.onNodeWithTag(COACH_ADD_SENTENCE_TAG).performScrollTo().performClick()
        val sentence = added.last()
        assertEquals("这场比赛我们不能输。", sentence.hanzi)
        assertEquals("We can't lose this match.", sentence.english)
        assertEquals(true, sentence.funFacts?.startsWith("这 (zhè) this\n场 (chǎng)"))
    }

    private fun mutableDraft(s: String) = androidx.compose.runtime.mutableStateOf(s)
}
