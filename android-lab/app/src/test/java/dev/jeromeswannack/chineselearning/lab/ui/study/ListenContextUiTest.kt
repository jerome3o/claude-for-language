package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import com.github.takahirom.roborazzi.captureRoboImage
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.ListenContext
import dev.jeromeswannack.chineselearning.lab.core.QueueCard
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.testing.Samples
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * "Listen in context" — the listening card's question side (docs/STUDY_SESSION.md): the note's
 * sentences as audio-only rows (the card sentence first, no Chinese on screen, EN = only the
 * English), "▶ The word" at the bottom with "Try the sentences first?" before any sentence was
 * heard, the first sentence auto-played, offline rows without a clip, + More sentences, and the
 * `study.listen_context` numbers on reveal. Screenshots `study-listen-*`.
 */
class ListenContextUiTest : LabScreenshotTest() {
    private val played = ArrayList<Pair<String?, String>>()
    private var wordPlays = 0
    private var listenStats: Triple<Int, Boolean, Boolean>? = null
    private var generated: Pair<Int, Boolean>? = null

    private val clueClip = "generated/clue-n1.mp3"
    private val s1Clip = "generated/s1.mp3"

    private fun view(online: Boolean = true, cached: Set<String> = emptySet()): CardView {
        val now = Js.parseDate("2026-10-22T09:30:00.000Z")
        val state = CardScheduler.initialCardState()
        val note = Samples.note.copy(audioUrl = "generated/n1.mp3", sentenceClueAudioUrl = clueClip)
        val sentences = Samples.sentences.mapIndexed { i, s -> if (i == 0) s.copy(audioUrl = s1Clip) else s }
        val card = QueueCard("c1", note.id, "d1", CardTypes.AUDIO_TO_HANZI, state)
        return CardView(card, note, sentences, CardScheduler.intervalPreviews(state, now), emptyList(), 1, "HSK 3", true, cachedClips = cached)
    }

    private fun actions() = StudyActions(
        onPlay = { key, text -> played += key to text },
        onPlayWord = { wordPlays++ },
        onListenContext = { n, prompt, anyway -> listenStats = Triple(n, prompt, anyway) },
        sentences = SentenceActions(generate = { count, keep, _ -> generated = count to keep }),
    )

    private fun screen(online: Boolean = true, cached: Set<String> = emptySet(), autoplay: Boolean = false, dark: Boolean = false) {
        val ui = StudyUi(StudyPhase.Showing(view(online, cached)), Samples.counts, SessionStats(), online = online)
        compose.setContent { LabTheme(dark = dark) { StudyScreen(ui, playingKey = null, actions = actions(), autoplay = autoplay) } }
        compose.mainClock.advanceTimeBy(600)
    }

    private fun shot(name: String) {
        compose.mainClock.advanceTimeBy(1_200)
        compose.onRoot().captureRoboImage("screenshots/$name.png")
    }

    @Test fun audioOnlyRowsCardSentenceFirst() {
        screen()
        // The card sentence + three set rows; none of the Chinese, pinyin or English on screen.
        assertEquals(4, compose.onAllNodesWithTag(LISTEN_ROW_TAG).fetchSemanticsNodes().size)
        compose.onNodeWithText(ListenContext.Copy.HEADING.uppercase()).assertExists()
        compose.onNodeWithText("你周末打算做什么？", substring = true).assertDoesNotExist()
        compose.onNodeWithText("我打算学中文。", substring = true).assertDoesNotExist()
        compose.onNodeWithText("What are you planning", substring = true).assertDoesNotExist()
        shot("study-listen-01-question")
        // ▶ row 1 plays the card sentence's clip and marks it heard.
        compose.onNodeWithContentDescription("Sentence 1").performClick()
        assertEquals(clueClip to "你周末打算做什么？", played.single())
        compose.onNodeWithContentDescription("Sentence 1, played").assertExists()
        // EN on row 2: just its English.
        compose.onAllNodesWithTag(LISTEN_EN_TAG)[1].performClick()
        compose.onNodeWithText("I plan to study Chinese.").assertExists()
        compose.onNodeWithText("我打算学中文。", substring = true).assertDoesNotExist()
        shot("study-listen-03-after-a-sentence")
        // A sentence was heard: the word plays at once, no ask.
        compose.onNodeWithTag(PLAY_WORD_TAG).performScrollTo().performClick()
        assertEquals(1, wordPlays)
        compose.onNodeWithTag(LISTEN_PROMPT_TAG).assertDoesNotExist()
    }

    @Test fun theWordFirstAsksThenPlaysAnyway() {
        screen()
        compose.onNodeWithTag(PLAY_WORD_TAG).performScrollTo().performClick()
        assertEquals(0, wordPlays)
        compose.onNodeWithText(ListenContext.Copy.PROMPT_TITLE).assertExists()
        compose.onNodeWithText(ListenContext.Copy.PROMPT_BODY).assertExists()
        shot("study-listen-02-try-sentences-first")
        compose.onNodeWithText(ListenContext.Copy.PROMPT_ANYWAY).performClick()
        assertEquals(1, wordPlays)
        compose.onNodeWithText(ListenContext.Copy.PROMPT_TITLE).assertDoesNotExist()
        // Chosen once: no second ask on this card.
        compose.onNodeWithTag(PLAY_WORD_TAG).performScrollTo().performClick()
        assertEquals(2, wordPlays)
        // The numbers go out when the card is answered.
        compose.onNodeWithText("Show answer", substring = true, ignoreCase = true).performClick()
        compose.mainClock.advanceTimeBy(600)
        assertEquals(Triple(0, true, true), listenStats)
    }

    @Test fun playASentenceFromTheAsk() {
        screen()
        compose.onNodeWithTag(PLAY_WORD_TAG).performScrollTo().performClick()
        compose.onNodeWithText(ListenContext.Copy.PROMPT_SENTENCE).performClick()
        assertEquals(clueClip, played.single().first)
        assertEquals(0, wordPlays)
        compose.onNodeWithText(ListenContext.Copy.PROMPT_TITLE).assertDoesNotExist()
    }

    @Test fun autoplayIsTheFirstSentence() {
        screen(autoplay = true)
        assertEquals(clueClip to "你周末打算做什么？", played.firstOrNull())
        assertEquals(0, wordPlays)
        compose.onNodeWithContentDescription("Sentence 1, played").assertExists()
    }

    @Test fun offlineOnlyCachedClipsPlay() {
        screen(online = false, cached = setOf(s1Clip))
        compose.onNodeWithContentDescription("Sentence 1").assertIsNotEnabled()
        compose.onNodeWithContentDescription("Sentence 3").assertIsNotEnabled()
        assertTrue(compose.onAllNodesWithText(ListenContext.Copy.UNAVAILABLE).fetchSemanticsNodes().size == 3)
        compose.onNodeWithTag(LISTEN_MORE_TAG).assertDoesNotExist()
        compose.onNodeWithContentDescription("Sentence 2").performClick()
        assertEquals(s1Clip, played.single().first)
        shot("study-listen-04-offline")
    }

    @Test fun moreSentencesAddsToTheSet() {
        screen()
        compose.onNodeWithTag(LISTEN_MORE_TAG).performScrollTo().performClick()
        compose.mainClock.advanceTimeBy(300)
        // Four sentences → enough to reach about eight, keeping the set.
        assertEquals(4 to true, generated)
    }

    @Test fun darkQuestion() {
        screen(dark = true)
        compose.onNodeWithContentDescription("Sentence 2").performClick()
        compose.onAllNodesWithTag(LISTEN_EN_TAG)[0].performClick()
        shot("study-listen-05-dark")
    }

}
