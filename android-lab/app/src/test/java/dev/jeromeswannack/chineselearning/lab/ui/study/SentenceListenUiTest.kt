package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onLast
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.unit.dp
import com.github.takahirom.roborazzi.captureRoboImage
import dev.jeromeswannack.chineselearning.lab.core.AnswerCheck
import dev.jeromeswannack.chineselearning.lab.core.AnswerCheckInput
import dev.jeromeswannack.chineselearning.lab.core.AnswerCheckTip
import dev.jeromeswannack.chineselearning.lab.core.SentenceRound
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceTextFieldTags
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import kotlinx.coroutines.CompletableDeferred
import org.junit.Test
import androidx.compose.foundation.background
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Hard mode's "Sentences by ear" in the Sentence round (docs/STUDY_SESSION.md "Sentences by ear"; core
 * SentenceRound.pick byEar): read slots with a clip are listen exercises — the clip plays by itself, no text before
 * the answer, the meaning given in English and checked by Claude online (the reveal at once, the verdict under it
 * without moving it), a self-check offline, a clip that won't play falls back to read; screenshots of the states.
 */
class SentenceListenUiTest : LabScreenshotTest() {
    private val rows = listOf(
        SentenceRow("clue:n1", null, "我去银行取钱。", "Wǒ qù yínháng qǔ qián.", "I go to the bank to get money.", null, "From the card", fromCard = true),
        SentenceRow("s1", "s1", "银行在哪儿？", "Yínháng zài nǎr?", "Where is the bank?", "generated/s1.mp3", null),
        SentenceRow("s2", "s2", "我昨天没去银行。", "Wǒ zuótiān méi qù yínháng.", "I didn't go to the bank yesterday.", "generated/s2.mp3", null),
        SentenceRow("s3", "s3", "这家银行几点开门？", "Zhè jiā yínháng jǐ diǎn kāimén?", "What time does this bank open?", null, null),
    )

    private class Calls {
        val plays = mutableListOf<Pair<String, Double>>()
        var unavailable: (() -> Unit)? = null
        val checks = mutableListOf<AnswerCheckInput>()
        val picked = mutableListOf<List<String>>()
        val results = mutableListOf<Pair<String, String>>()
    }

    private fun round(
        calls: Calls = Calls(),
        online: Boolean = true,
        byEar: Boolean = true,
        hasClip: (String) -> Boolean = { false },
        check: suspend (AnswerCheckInput) -> AnswerCheck? = { null },
        takes: Map<String, ListenTake> = emptyMap(),
    ) {
        compose.setContent {
            LabTheme {
                Box(Modifier.fillMaxSize().background(Lab.colors.background).padding(12.dp)) {
                    SentenceRoundPage(
                        question = "银行", questionIsChinese = true, rows = rows, practise = previewSentencePractise(),
                        playingKey = null, onPlay = { _, _ -> }, onDone = {}, onSkip = {}, stats = emptyMap(),
                        onPicked = { calls.picked += it }, onResult = { id, r -> calls.results += id to r },
                        online = online, byEar = byEar, hasClip = hasClip,
                        onPlayClip = { url, speed, unavailable -> calls.plays += url to speed; calls.unavailable = unavailable },
                        checkMeaning = { calls.checks += it; check(it) },
                        initialListenTakes = takes,
                    )
                }
            }
        }
        compose.mainClock.advanceTimeBy(1_000)
    }

    private fun count(tag: String) = compose.onAllNodesWithTag(tag, useUnmergedTree = true).fetchSemanticsNodes().size
    private fun shot(name: String) = compose.onRoot().captureRoboImage("screenshots/$name.png")

    private fun typeAndSubmit(text: String) {
        compose.onAllNodesWithTag(VoiceTextFieldTags.TYPE).onFirst().performClick()
        compose.mainClock.advanceTimeBy(300)
        compose.onAllNodes(hasSetTextAction()).onFirst().performTextInput(text)
        val submit = compose.onAllNodesWithTag(VoiceTextFieldTags.SUBMIT).onLast()
        runCatching { submit.performScrollTo() }
        submit.performClick()
        compose.mainClock.advanceTimeBy(500)
    }

    @Test fun readSlotsWithAClipAreListenExercisesAndTheClipPlays() {
        val calls = Calls()
        round(calls)
        // The clue (no clip) is read only if a read slot falls on it: here the clipped sentences take the read slots.
        assertEquals(listOf("translate:clue:n1", "listen:s1", "listen:s2", "translate:s3"), calls.picked.last())
        assertEquals(1, count("${SentenceRoundTags.EXERCISE}-1-listen-open"))
        // Autoplay: the first listen exercise's clip, once, at normal speed.
        assertEquals(listOf("generated/s1.mp3" to 1.0), calls.plays)
        // No text before the answer.
        compose.onNodeWithText("银行在哪儿？", useUnmergedTree = true).assertDoesNotExist()
        compose.onNodeWithText("Where is the bank?", useUnmergedTree = true).assertDoesNotExist()
        assertEquals(2, compose.onAllNodesWithText(SentenceRound.PROMPT[SentenceRound.LISTEN]!!, useUnmergedTree = true).fetchSemanticsNodes().size)
        // One box: the exercise with the floor.
        assertEquals(1, count(SentenceListenTags.INPUT))
        compose.onAllNodesWithTag(SentenceListenTags.SLOW, useUnmergedTree = true).onFirst().performClick()
        assertEquals("generated/s1.mp3" to SentenceRound.LISTEN_SLOW_RATE, calls.plays.last())
        shot("sentence-listen-01-question")
    }

    @Test fun claudesVerdictLandsUnderTheRevealWithoutMovingIt() {
        val calls = Calls()
        val answer = CompletableDeferred<AnswerCheck?>()
        round(calls, check = { answer.await() })
        typeAndSubmit("Where is a bank?")
        assertEquals(1, calls.checks.size)
        val input = calls.checks.single()
        assertEquals("listen_translate", input.exerciseType)
        assertEquals("银行在哪儿？", input.promptEn)
        assertEquals("Where is the bank?", input.modelAnswer)
        assertEquals("typed", input.input)
        // The reveal at once, the verdict row checking.
        compose.onNodeWithText("银行在哪儿？", useUnmergedTree = true).assertExists()
        compose.onNodeWithText(SentenceRound.LISTEN_EX_CHECKING, useUnmergedTree = true).assertExists()
        val before = compose.onNodeWithTag(SentenceListenTags.REVEAL, useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
        val verdictBefore = compose.onNodeWithTag(SentenceListenTags.VERDICT, useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
        shot("sentence-listen-02-checking")
        answer.complete(AnswerCheck(verdict = "acceptable", headline = "You got it — “a bank” for “the bank” is fine.", suggested = "got_it"))
        compose.mainClock.advanceTimeBy(800)
        compose.onNodeWithText("✓ Right · You got it — “a bank” for “the bank” is fine.", useUnmergedTree = true).assertExists()
        // Inside the exercise nothing moves: the reveal keeps its size and the verdict row its place under it (the
        // round's cheer above the list may push the whole list down, as for every exercise).
        val after = compose.onNodeWithTag(SentenceListenTags.REVEAL, useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
        val verdictAfter = compose.onNodeWithTag(SentenceListenTags.VERDICT, useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
        assertEquals(before.height, after.height)
        assertEquals(verdictBefore.top - before.top, verdictAfter.top - after.top)
        assertTrue("listen:s1" to "right" in calls.results)
        // The next listen exercise gets the floor and plays.
        assertEquals("generated/s2.mp3", calls.plays.last().first)
        shot("sentence-listen-03-right")
    }

    @Test fun nearlyWithATipQuotingTheChinese() {
        val take = ListenTake(
            "I went to the bank yesterday", "spoken",
            ListenVerdict.Claude(
                AnswerCheck(verdict = "almost", headline = "Close — but you missed the negative.", tips = listOf(AnswerCheckTip("makes it negative: they did NOT go.", "没")), suggested = "missed_it"),
                "close", "claude",
            ),
        )
        round(takes = mapOf("listen:s2" to take))
        compose.onNodeWithText("≈ Nearly · Close — but you missed the negative.", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("You said: I went to the bank yesterday", useUnmergedTree = true).assertExists()
        shot("sentence-listen-04-nearly")
    }

    @Test fun offlineHeChecksHimself() {
        val calls = Calls()
        round(calls, online = false, hasClip = { it == "generated/s1.mp3" })
        // Offline only a clip on the device can be heard; the other is read.
        assertEquals(listOf("translate:clue:n1", "listen:s1", "read:s2", "translate:s3"), calls.picked.last())
        typeAndSubmit("Where is the bank")
        assertEquals(0, calls.checks.size)
        compose.onNodeWithText(SentenceRound.LISTEN_EX_SELF_QUESTION, useUnmergedTree = true).assertExists()
        shot("sentence-listen-05-self-check")
        compose.onNodeWithTag(SentenceListenTags.GOT, useUnmergedTree = true).performClick()
        compose.mainClock.advanceTimeBy(300)
        assertTrue("listen:s1" to "right" in calls.results)
    }

    @Test fun showTheAnswerGoesToTheSelfCheck() {
        val calls = Calls()
        round(calls)
        compose.onNodeWithTag(SentenceListenTags.SHOW, useUnmergedTree = true).performClick()
        compose.mainClock.advanceTimeBy(300)
        assertEquals(0, calls.checks.size)
        compose.onNodeWithTag(SentenceListenTags.MISSED, useUnmergedTree = true).performClick()
        compose.mainClock.advanceTimeBy(300)
        assertTrue("listen:s1" to "wrong" in calls.results)
    }

    @Test fun aClipThatWontPlayBecomesARead() {
        val calls = Calls()
        round(calls)
        calls.unavailable!!.invoke()
        compose.mainClock.advanceTimeBy(500)
        assertEquals(listOf("translate:clue:n1", "read:s1", "listen:s2", "translate:s3"), calls.picked.last())
        compose.onNodeWithText("银行在哪儿？", useUnmergedTree = true).assertExists()
    }

    @Test fun settingsSwitchNextToHardMode() {
        var on = true
        compose.setContent {
            LabTheme {
                Box(Modifier.fillMaxSize().background(Lab.colors.background).padding(16.dp)) {
                    SpokenAnswerSection(false, hardMode = "all", sentencesByEar = on, onSentencesByEarChange = { on = it }) {}
                }
            }
        }
        compose.mainClock.advanceTimeBy(500)
        compose.onNodeWithText(SentenceRound.BY_EAR_TITLE, useUnmergedTree = true).assertExists()
        shot("sentence-listen-06-settings")
        compose.onNodeWithText(SentenceRound.BY_EAR_TITLE, useUnmergedTree = true).performClick()
        assertEquals(false, on)
    }

    @Test fun offTheRoundIsReadAndTranslate() {
        val calls = Calls()
        round(calls, byEar = false)
        assertEquals(listOf("read:clue:n1", "translate:s1", "read:s2", "translate:s3"), calls.picked.last())
        assertTrue(calls.plays.isEmpty())
    }
}
