package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import com.github.takahirom.roborazzi.captureRoboImage
import dev.jeromeswannack.chineselearning.lab.core.AnswerCheck
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.QueueCard
import dev.jeromeswannack.chineselearning.lab.core.SentencePractise
import dev.jeromeswannack.chineselearning.lab.data.SentenceEntity
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.testing.Samples
import dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceDictationUi
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.After
import org.junit.Test
import kotlin.test.assertEquals

/**
 * 🎤 on the example sentence rows + "Get two sentences right before Good / Easy"
 * (docs/STUDY_SESSION.md "Practise a sentence aloud"; core SentencePractise): no 🎤 on a blank row,
 * read mode once the Chinese is up, translate mode on an English-first row with it hidden; the
 * results (right / close / Claude's verdict / Check online); the gate line and the locked Good / Easy
 * (a tap rates nothing and says why, Again rates); screenshots of the states.
 */
class SentencePractiseUiTest : LabScreenshotTest() {
    private val note = Samples.note.copy(
        id = "n1", hanzi = "银行", pinyin = "yínháng", english = "bank",
        funFacts = "银 (yín) silver + 行 (háng) firm: a bank. 行 is háng here, not xíng.",
        sentenceClue = "我去银行取钱。", sentenceCluePinyin = "Wǒ qù yínháng qǔ qián.", sentenceClueTranslation = "I go to the bank to get money.",
    )
    private val set = listOf(
        SentenceEntity("s1", "n1", 0, "银行在哪儿？", "Yínháng zài nǎr?", "Where is the bank?", null, "core", null),
        SentenceEntity("s2", "n1", 1, "这家银行几点开门？", "Zhè jiā yínháng jǐ diǎn kāimén?", "What time does this bank open?", null, "core", null),
    )
    private val clueKey = clueRowKey("n1")
    private val prefs get() = StudyPrefs.get(ApplicationProvider.getApplicationContext())

    @After fun gateOff() = prefs.setHardMode("off")

    private fun view(type: String = CardTypes.HANZI_TO_MEANING): CardView {
        val now = Js.parseDate("2026-10-24T08:00:00.000Z")
        var state = CardScheduler.initialCardState()
        state = CardScheduler.applyReview(state, 2, "2026-10-20T08:00:00.000Z")
        return CardView(QueueCard("c1", "n1", "d1", type, state), note, set, CardScheduler.intervalPreviews(state, now), emptyList(), 1, "HSK 2", true)
    }

    private fun ui(v: CardView) = StudyUi(StudyPhase.Showing(v), Samples.counts, SessionStats(reviews = 5, correct = 4), canUndo = true, online = true)

    private fun take(mode: String, said: String, target: String, claude: SentenceClaude? = null) =
        SentenceRowTake(mode, SentencePractise.take(mode, said, target), claude)

    private fun rows(practise: SentencePractiseState, steps: Map<String, Int> = emptyMap(), english: Set<String> = emptySet()) {
        val state = SentenceRowsState()
        state.steps.putAll(steps)
        english.forEach { state.english[it] = true }
        compose.setContent {
            LabTheme {
                Column(Modifier.padding(16.dp)) {
                    for (row in sentenceRows(note, set)) {
                        SentenceRowView(row, state, true, null, SentenceActions(), onPlay = { _, _ -> }, onAdd = {}, practise = practise)
                    }
                }
            }
        }
        compose.mainClock.advanceTimeBy(1_000)
    }

    private fun micCount() = compose.onAllNodesWithTag(SentencePractiseTags.MIC, useUnmergedTree = true).fetchSemanticsNodes().size

    @Test fun micOnlyOnceSomethingIsOpen() {
        val practise = previewSentencePractise()
        rows(practise)
        // Rows start blank (listen first): no 🎤 until something is open.
        assertEquals(0, micCount())
        compose.onAllNodesWithTag(SENTENCE_ROW_TAG)[0].performClick()
        compose.mainClock.advanceTimeBy(500)
        assertEquals(1, micCount())
        compose.onNodeWithTag(SentencePractiseTags.MIC, useUnmergedTree = true).performClick()
        assertEquals(clueKey, practise.activeKey)
        assertEquals(SentencePractise.READ, practise.activeMode)
    }

    @Test fun englishFirstRowIsTranslateMode() {
        val practise = previewSentencePractise()
        rows(practise, english = setOf("s1"))
        assertEquals(1, micCount())
        compose.onNodeWithTag(SentencePractiseTags.MIC, useUnmergedTree = true).performClick()
        assertEquals(SentencePractise.TRANSLATE, practise.activeMode)
    }

    @Test fun resultsShowUnderTheRow() {
        val check = AnswerCheck("acceptable", "Also natural — 什么地方 = 哪儿.", suggested = "got_it")
        val practise = previewSentencePractise(
            takes = mapOf(
                clueKey to take(SentencePractise.READ, "我去银行取钱", note.sentenceClue!!),
                "s1" to take(SentencePractise.TRANSLATE, "银行在什么地方", "银行在哪儿？", SentenceClaude.Done(check)),
                "s2" to take(SentencePractise.TRANSLATE, "这个银行什么时候开", "这家银行几点开门？", SentenceClaude.Unavailable),
            ),
        )
        rows(practise, steps = mapOf(clueKey to 1, "s1" to 1, "s2" to 1), english = setOf("s1", "s2"))
        assertEquals(2, compose.onAllNodesWithTag("${SentencePractiseTags.RESULT}-right", useUnmergedTree = true).fetchSemanticsNodes().size)
        compose.onNodeWithTag(SentencePractiseTags.VERDICT, useUnmergedTree = true).assertExists()
        compose.onNodeWithText(SentencePractise.CHECK_ONLINE, useUnmergedTree = true).assertExists()
    }

    private fun card(practise: SentencePractiseState, actions: StudyActions = StudyActions()) {
        prefs.setHardMode("all")
        compose.setContent {
            LabTheme { StudyScreen(ui(view()), playingKey = null, actions = actions, cardStart = CardStartState(flipped = true), autoplay = false, sentencePractisePreview = practise) }
        }
        compose.mainClock.advanceTimeBy(2_000)
    }

    @Test fun gateLocksGoodAndEasyAgainRates() {
        val rated = mutableListOf<Int>()
        card(previewSentencePractise(), StudyActions(onRate = { r, _, _ -> rated += r }))
        compose.onNodeWithTag(SentencePractiseTags.GATE, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("🎤 Get 2 sentences right to unlock Good · 0/2", useUnmergedTree = true).assertExists()
        compose.onNodeWithTag("rating-good", useUnmergedTree = true).performClick()
        compose.mainClock.advanceTimeBy(500)
        assertEquals(emptyList(), rated)
        compose.onNodeWithText(SentencePractise.blockedNote(SentencePractise.Gate(2, 0, true)), useUnmergedTree = true).assertExists()
        compose.onNodeWithTag("rating-again", useUnmergedTree = true).performClick()
        compose.mainClock.advanceTimeBy(500)
        assertEquals(listOf(0), rated)
    }

    @Test fun twoRightUnlocks() {
        val rated = mutableListOf<Int>()
        card(previewSentencePractise(rightKeys = listOf(clueKey, "s1")), StudyActions(onRate = { r, _, _ -> rated += r }))
        compose.onNodeWithText("✓ 2/2 right — Good and Easy unlocked", useUnmergedTree = true).assertExists()
        compose.onNodeWithTag("rating-good", useUnmergedTree = true).performClick()
        compose.mainClock.advanceTimeBy(500)
        assertEquals(listOf(2), rated)
    }

    @Test fun offWhenTheSettingIsOffOrTheListeningCard() {
        compose.setContent {
            LabTheme { StudyScreen(ui(view(CardTypes.AUDIO_TO_HANZI)), playingKey = null, actions = StudyActions(), cardStart = CardStartState(flipped = true, answer = "银行"), autoplay = false, sentencePractisePreview = previewSentencePractise()) }
        }
        prefs.setHardMode("all")
        compose.mainClock.advanceTimeBy(1_000)
        assertEquals(0, compose.onAllNodesWithTag(SentencePractiseTags.GATE, useUnmergedTree = true).fetchSemanticsNodes().size)
    }

    // ---- screenshots

    private fun shotCard(name: String, practise: SentencePractiseState, scrollToSentences: Boolean = true) {
        card(practise)
        if (scrollToSentences) {
            compose.onNodeWithText("Example sentences").performScrollTo()
            compose.mainClock.advanceTimeBy(800)
        }
        compose.onRoot().captureRoboImage("screenshots/$name.png")
    }

    @Test fun shotLocked() = shotCard("sentence-practise-01-gate-locked", previewSentencePractise())

    @Test fun shotOneOfTwo() = shotCard("sentence-practise-02-gate-1-of-2", previewSentencePractise(rightKeys = listOf(clueKey)))

    @Test fun shotUnlocked() = shotCard("sentence-practise-03-gate-unlocked", previewSentencePractise(rightKeys = listOf(clueKey, "s1")))

    @Test fun shotRowsClaude() = shoot("sentence-practise-05-rows-claude-close") {
        val state = SentenceRowsState().apply { steps.putAll(mapOf(clueKey to 1, "s1" to 1)); english["s1"] = true }
        val practise = previewSentencePractise(
            takes = mapOf(
                clueKey to take(SentencePractise.READ, "我去银行去钱", note.sentenceClue!!),
                "s1" to take(SentencePractise.TRANSLATE, "银行在什么地方", "银行在哪儿？", SentenceClaude.Done(AnswerCheck("acceptable", "Also natural — 什么地方 means the same as 哪儿.", suggested = "got_it"))),
            ),
        )
        Column(Modifier.padding(16.dp)) {
            for (row in sentenceRows(note, set).take(2)) SentenceRowView(row, state, true, null, SentenceActions(), onPlay = { _, _ -> }, onAdd = {}, practise = practise)
        }
    }

    @Test fun shotRows() = shoot("sentence-practise-04-rows") {
        val state = SentenceRowsState().apply { steps.putAll(mapOf(clueKey to 1, "s1" to 1)); english["s1"] = true; english["s2"] = true }
        val practise = previewSentencePractise(
            takes = mapOf(
                clueKey to take(SentencePractise.READ, "我去银行取前", note.sentenceClue!!),
                "s1" to take(SentencePractise.TRANSLATE, "这个银行什么时候开", "银行在哪儿？", SentenceClaude.Unavailable),
            ),
            dictation = VoiceDictationUi(phase = "listening", finalText = "这家银行", partialText = "几点"),
            activeKey = "s2", activeMode = SentencePractise.TRANSLATE,
        )
        Column(Modifier.padding(16.dp)) {
            for (row in sentenceRows(note, set)) SentenceRowView(row, state, true, null, SentenceActions(), onPlay = { _, _ -> }, onAdd = {}, practise = practise)
        }
    }

    @Test fun shotSetting() = shoot("sentence-practise-06-setting") {
        Column(Modifier.padding(16.dp)) {
            SpokenAnswerSection(false, wordTagsOn = true, picturesOn = true, newCharShimmerOn = true, hardMode = "red") {}
        }
    }
}
