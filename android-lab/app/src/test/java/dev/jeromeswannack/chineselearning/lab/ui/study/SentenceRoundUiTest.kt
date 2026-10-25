package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import com.github.takahirom.roborazzi.captureRoboImage
import dev.jeromeswannack.chineselearning.lab.core.AnswerCheck
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.QueueCard
import dev.jeromeswannack.chineselearning.lab.core.SentencePractise
import dev.jeromeswannack.chineselearning.lab.core.SentenceRound
import dev.jeromeswannack.chineselearning.lab.data.SentenceEntity
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.testing.Samples
import dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceDictationUi
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.After
import org.junit.Test
import kotlin.test.assertEquals

/**
 * The Sentence round between the question and the answer (docs/STUDY_SESSION.md "Sentence round";
 * core SentenceRound): the reveal opens it (setting on, reading / meaning card), four exercises with the
 * translate ones' Chinese hidden, two right open the answer unlocked, Skip opens it with the gate still
 * locked, the listening card never gets one; screenshots of the states.
 */
class SentenceRoundUiTest : LabScreenshotTest() {
    private val note = Samples.note.copy(
        id = "n1", hanzi = "银行", pinyin = "yínháng", english = "bank",
        funFacts = "银 (yín) silver + 行 (háng) firm: a bank.",
        sentenceClue = "我去银行取钱。", sentenceCluePinyin = "Wǒ qù yínháng qǔ qián.", sentenceClueTranslation = "I go to the bank to get money.",
    )
    private val set = listOf(
        SentenceEntity("s1", "n1", 0, "银行在哪儿？", "Yínháng zài nǎr?", "Where is the bank?", null, "core", null),
        SentenceEntity("s2", "n1", 1, "这家银行几点开门？", "Zhè jiā yínháng jǐ diǎn kāimén?", "What time does this bank open?", null, "core", null),
        SentenceEntity("s3", "n1", 2, "我哥哥在银行工作了十年。", "Wǒ gēge zài yínháng gōngzuòle shí nián.", "My older brother has worked at a bank for ten years.", null, "complex", null),
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

    private fun card(
        practise: SentencePractiseState,
        start: CardStartState = CardStartState(roundOpen = true),
        type: String = CardTypes.HANZI_TO_MEANING,
        actions: StudyActions = StudyActions(),
        dark: Boolean = false,
    ) {
        prefs.setHardMode("all")
        compose.setContent {
            LabTheme(dark = dark) { StudyScreen(ui(view(type)), playingKey = null, actions = actions, cardStart = start, autoplay = false, sentencePractisePreview = practise) }
        }
        compose.mainClock.advanceTimeBy(2_000)
    }

    private fun count(tag: String) = compose.onAllNodesWithTag(tag, useUnmergedTree = true).fetchSemanticsNodes().size
    private fun exerciseTags(): List<String> = (0 until 4).map { i ->
        listOf("read", "translate").flatMap { m -> listOf("open", "right", "close", "wrong").map { "${SentenceRoundTags.EXERCISE}-$i-$m-$it" } }.first { count(it) > 0 }
    }

    @Test fun showAnswerBeforeTryingGivesUp() {
        card(previewSentencePractise(), start = CardStartState())
        compose.onNodeWithText("Show answer", useUnmergedTree = true).performClick()
        compose.mainClock.advanceTimeBy(800)
        assertEquals(0, count(SentenceRoundTags.ROUND))
        compose.onNodeWithTag(HardModeTags.GAVE_UP, useUnmergedTree = true).assertExists()
    }

    @Test fun fourExercisesTranslateChineseHidden() {
        card(previewSentencePractise())
        assertEquals(
            listOf("read", "translate", "read", "translate").mapIndexed { i, m -> "${SentenceRoundTags.EXERCISE}-$i-$m-open" },
            exerciseTags(),
        )
        compose.onNodeWithText("Where is the bank?", useUnmergedTree = true).assertExists()
        // The translate exercises' Chinese stays hidden until answered; the read ones show it.
        compose.onNodeWithText("银行在哪儿？", useUnmergedTree = true).assertDoesNotExist()
        compose.onNodeWithText("我去银行取钱。", useUnmergedTree = true).assertExists()
        assertEquals(0, count(SentenceRoundTags.PLAY))
        compose.onNodeWithText("Get any 2 of these 4 right", useUnmergedTree = true).assertExists()
        compose.onNodeWithText(SentenceRound.skipNote(SentenceRound.Progress(2, 0, false)), useUnmergedTree = true).assertExists()
    }

    @Test fun twoRightOpenTheAnswerUnlocked() {
        val rated = mutableListOf<Int>()
        val practise = previewSentencePractise(rightKeys = listOf("read:$clueKey"))
        card(practise, actions = StudyActions(onRate = { r, _, _ -> rated += r }))
        compose.onNodeWithText("1 / 2", useUnmergedTree = true).assertExists()
        compose.runOnIdle { practise.rightKeys.add("translate:s1") }
        // (The cheer's 1.4 s pause runs on the test dispatcher's virtual time: the answer is up at once here.)
        compose.mainClock.advanceTimeBy(2_500)
        assertEquals(0, count(SentenceRoundTags.ROUND))
        compose.onNodeWithText("✓ 2/2 right — Good and Easy unlocked", useUnmergedTree = true).assertExists()
        compose.onNodeWithTag("rating-good", useUnmergedTree = true).performClick()
        compose.mainClock.advanceTimeBy(500)
        assertEquals(listOf(2), rated)
    }

    /** The homework pass (docs/HOMEWORK.md §3e): its own Skip line and "Got it unlocked" — never Good / Easy. */
    @Test fun inThePassTheRoundSpeaksOfGotIt() {
        val practise = previewSentencePractise(rightKeys = listOf("read:$clueKey"))
        compose.setContent {
            LabTheme {
                SentenceRoundPage(
                    question = "银行", questionIsChinese = true, rows = sentenceRows(view()), practise = practise,
                    playingKey = null, onPlay = { _, _ -> }, onDone = {}, onSkip = {},
                    skipNote = dev.jeromeswannack.chineselearning.lab.core.PassAngles.ROUND_SKIP_NOTE,
                    doneCheer = dev.jeromeswannack.chineselearning.lab.core.PassAngles::roundDoneCheer,
                )
            }
        }
        compose.mainClock.advanceTimeBy(1_000)
        compose.onNodeWithText(dev.jeromeswannack.chineselearning.lab.core.PassAngles.ROUND_SKIP_NOTE, useUnmergedTree = true).assertExists()
        compose.runOnIdle { practise.rightKeys.add("translate:s1") }
        compose.mainClock.advanceTimeBy(300)
        compose.onNodeWithText("🎉 2 / 2 — Got it unlocked", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("Good and Easy unlocked", substring = true, useUnmergedTree = true).assertDoesNotExist()
    }

    @Test fun skipOpensTheAnswerWithTheGate() {
        val rated = mutableListOf<Int>()
        card(previewSentencePractise(rightKeys = listOf("read:$clueKey")), actions = StudyActions(onRate = { r, _, _ -> rated += r }))
        compose.onNodeWithTag(SentenceRoundTags.SKIP, useUnmergedTree = true).performClick()
        compose.mainClock.advanceTimeBy(1_000)
        assertEquals(0, count(SentenceRoundTags.ROUND))
        // The round's count carries over: 1 of 2.
        compose.onNodeWithText("🎤 Get 2 sentences right to unlock Good · 1/2", useUnmergedTree = true).assertExists()
        compose.onNodeWithTag("rating-good", useUnmergedTree = true).performClick()
        compose.mainClock.advanceTimeBy(500)
        assertEquals(emptyList(), rated)
    }

    @Test fun noRoundOnTheListeningCard() {
        card(previewSentencePractise(), start = CardStartState(roundOpen = true), type = CardTypes.AUDIO_TO_HANZI)
        assertEquals(0, count(SentenceRoundTags.ROUND))
    }

    @Test fun missOffersTryAgain() {
        val practise = previewSentencePractise(takes = mapOf("read:$clueKey" to take(SentencePractise.READ, "我去学校", note.sentenceClue!!)))
        card(practise)
        compose.onNodeWithTag(SentenceRoundTags.RETRY, useUnmergedTree = true).performClick()
        assertEquals("read:$clueKey", practise.activeKey)
        assertEquals(SentencePractise.READ, practise.activeMode)
    }

    @Test fun rightReadShowsItsEnglishAtOnce() {
        card(previewSentencePractise(rightKeys = listOf("read:$clueKey")))
        compose.onNodeWithTag(SentenceRoundTags.READ_ENGLISH, useUnmergedTree = true).assertExists()
        compose.onNodeWithText("I go to the bank to get money.", useUnmergedTree = true).assertExists()
        compose.onNodeWithText(SentenceRound.HIDE_ENGLISH, useUnmergedTree = true).performClick()
        compose.mainClock.advanceTimeBy(500)
        assertEquals(0, count(SentenceRoundTags.READ_ENGLISH))
        compose.onNodeWithText(SentenceRound.SHOW_ENGLISH, useUnmergedTree = true).assertExists()
    }

    @Test fun missedReadKeepsShowEnglish() {
        card(previewSentencePractise(takes = mapOf("read:$clueKey" to take(SentencePractise.READ, "我去学校", note.sentenceClue!!))))
        assertEquals(0, count(SentenceRoundTags.READ_ENGLISH))
        compose.onNodeWithText(SentenceRound.SHOW_ENGLISH, useUnmergedTree = true).performClick()
        compose.mainClock.advanceTimeBy(500)
        compose.onNodeWithTag(SentenceRoundTags.READ_ENGLISH, useUnmergedTree = true).assertExists()
    }

    // ---- screenshots

    private fun shot(name: String) = compose.onRoot().captureRoboImage("screenshots/$name.png")

    @Test fun shotRoundRead() {
        card(previewSentencePractise())
        shot("sentence-round-01-reading-card")
    }

    @Test fun shotRoundMeaning() {
        card(previewSentencePractise(), type = CardTypes.MEANING_TO_HANZI)
        shot("sentence-round-02-meaning-card")
    }

    @Test fun shotRoundListening() {
        card(
            previewSentencePractise(
                dictation = VoiceDictationUi(phase = "listening", finalText = "银行在", partialText = "哪儿"),
                activeKey = "translate:s1", activeMode = SentencePractise.TRANSLATE,
            ),
        )
        shot("sentence-round-03-listening")
    }

    @Test fun shotRightAndMiss() {
        val practise = previewSentencePractise(
            takes = mapOf(
                "read:$clueKey" to take(SentencePractise.READ, "我去银行取钱", note.sentenceClue!!),
                "translate:s1" to take(SentencePractise.TRANSLATE, "银行在什么地方", "银行在哪儿？", SentenceClaude.Done(AnswerCheck("almost", "Close — 在哪儿 is the natural way to ask.", suggested = "missed_it"))),
            ),
            rightKeys = listOf("read:$clueKey"),
        )
        card(practise)
        shot("sentence-round-04-right-and-miss")
    }

    @Test fun shotDark() {
        card(previewSentencePractise(rightKeys = listOf("read:$clueKey")), dark = true)
        shot("sentence-round-05-dark")
    }

    @Test fun shotUnlocked() {
        val practise = previewSentencePractise(rightKeys = listOf("read:$clueKey"))
        card(practise)
        compose.runOnIdle { practise.rightKeys.add("translate:s1") }
        compose.mainClock.advanceTimeBy(3_000)
        shot("sentence-round-06-answer-unlocked")
    }

    @Test fun shotSkipped() {
        card(previewSentencePractise(rightKeys = listOf("read:$clueKey")))
        compose.onNodeWithTag(SentenceRoundTags.SKIP, useUnmergedTree = true).performClick()
        compose.mainClock.advanceTimeBy(2_000)
        shot("sentence-round-07-skipped-locked")
    }
}
