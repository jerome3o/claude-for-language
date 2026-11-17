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
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * "Listen in context" — the listening card's question side (docs/STUDY_SESSION.md): a few of the
 * note's sentences, picked fresh and shuffled per showing (core ListenContext.pick, the seed pinned
 * here), as audio-only rows (no Chinese on screen, EN = only the English, a dot on never-heard ones), "▶ The word" at the bottom with "Try the sentences first?" before any sentence was
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

    @Before fun pinSeed() { ListenSeeds.fixed = "ui-test" }
    @After fun unpinSeed() { ListenSeeds.fixed = null }

    /** The showing's rows in their order (the pinned seed, nothing heard yet). */
    private fun order(v: CardView = view()): List<ListenContext.Row> = ListenContext.pick(listenRows(v), emptyMap(), "ui-test", v.note.hanzi).rows
    private fun indexOf(key: String, v: CardView = view()) = order(v).indexOfFirst { it.key == key }
    private val clueKey = "clue:${Samples.note.id}"

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

    @Test fun audioOnlyRowsFreshAndShuffled() {
        screen()
        // The card sentence + the two natural set rows (the contrived one never comes), in the showing's order;
        // none of the Chinese, pinyin or English on screen; all three new.
        assertEquals(3, compose.onAllNodesWithTag(LISTEN_ROW_TAG).fetchSemanticsNodes().size)
        assertEquals(setOf(clueKey, "s1", "s2"), order().map { it.key }.toSet())
        assertEquals(3, compose.onAllNodesWithTag(LISTEN_NEW_TAG, useUnmergedTree = true).fetchSemanticsNodes().size)
        compose.onNodeWithText(ListenContext.Copy.HEADING.uppercase()).assertExists()
        compose.onNodeWithText("你周末打算做什么？", substring = true).assertDoesNotExist()
        compose.onNodeWithText("我打算学中文。", substring = true).assertDoesNotExist()
        compose.onNodeWithText("What are you planning", substring = true).assertDoesNotExist()
        shot("study-listen-01-question")
        // ▶ on the card sentence's row plays its clip, marks it heard and takes its dot away.
        val clue = indexOf(clueKey) + 1
        compose.onNodeWithContentDescription("Sentence $clue").performClick()
        assertEquals(clueClip to "你周末打算做什么？", played.single())
        compose.onNodeWithContentDescription("Sentence $clue, played").assertExists()
        assertEquals(2, compose.onAllNodesWithTag(LISTEN_NEW_TAG, useUnmergedTree = true).fetchSemanticsNodes().size)
        // EN on s1's row: just its English.
        compose.onAllNodesWithTag(LISTEN_EN_TAG)[indexOf("s1")].performClick()
        compose.onNodeWithText("I plan to study Chinese.").assertExists()
        compose.onNodeWithText("我打算学中文。", substring = true).assertDoesNotExist()
        shot("study-listen-03-after-a-sentence")
        // A sentence was heard: the word plays at once, no ask.
        compose.onNodeWithTag(PLAY_WORD_TAG).performScrollTo().performClick()
        assertEquals(1, wordPlays)
        compose.onNodeWithTag(LISTEN_PROMPT_TAG).assertDoesNotExist()
    }

    /** The card's own sentence with no English on the note (~⅓ of notes): EN is still there and fetches the line. */
    @Test fun cardSentenceWithoutEnglishFetchesIt() {
        val asked = ArrayList<String>()
        val base = view()
        val v = base.copy(note = base.note.copy(sentenceClueTranslation = null))
        val ui = StudyUi(StudyPhase.Showing(v), Samples.counts, SessionStats(), online = true)
        val acts = StudyActions(
            onPlay = { key, text -> played += key to text },
            onPlayWord = { wordPlays++ },
            sentences = SentenceActions(translate = { r -> asked += r.hanzi; "What are you planning to do this weekend?" }),
        )
        compose.setContent { LabTheme(dark = true) { StudyScreen(ui, playingKey = null, actions = acts, autoplay = false) } }
        compose.mainClock.advanceTimeBy(600)
        assertEquals(3, compose.onAllNodesWithTag(LISTEN_EN_TAG).fetchSemanticsNodes().size)
        compose.onAllNodesWithTag(LISTEN_EN_TAG)[indexOf(clueKey, v)].performClick()
        compose.mainClock.advanceTimeBy(600)
        assertEquals(listOf("你周末打算做什么？"), asked)
        compose.onNodeWithText("What are you planning to do this weekend?").assertExists()
        compose.onNodeWithText("你周末打算做什么？", substring = true).assertDoesNotExist()
        shot("study-listen-08-card-sentence-english-fetched")
    }

    /** Offline and never fetched: "Translation needs a connection". */
    @Test fun cardSentenceWithoutEnglishOffline() {
        val base = view(online = false)
        val v = base.copy(note = base.note.copy(sentenceClueTranslation = null))
        val ui = StudyUi(StudyPhase.Showing(v), Samples.counts, SessionStats(), online = false)
        compose.setContent { LabTheme { StudyScreen(ui, playingKey = null, actions = actions(), autoplay = false) } }
        compose.mainClock.advanceTimeBy(600)
        compose.onAllNodesWithTag(LISTEN_EN_TAG)[indexOf(clueKey, v)].performClick()
        compose.mainClock.advanceTimeBy(600)
        compose.onNodeWithText(ListenContext.Copy.TRANSLATION_OFFLINE).assertExists()
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
        // The first row of the showing (s2 has no clip yet: the device voice while it is made).
        assertEquals(order().first().audioUrl, played.single().first)
        assertEquals(0, wordPlays)
        compose.onNodeWithText(ListenContext.Copy.PROMPT_TITLE).assertDoesNotExist()
    }

    @Test fun autoplayIsTheFirstSentence() {
        screen(autoplay = true)
        // The first row of the showing with a clip.
        val first = order().indexOfFirst { it.audioUrl != null }
        assertEquals(order()[first].let { it.audioUrl to it.hanzi }, played.firstOrNull())
        assertEquals(0, wordPlays)
        compose.onNodeWithContentDescription("Sentence ${first + 1}, played").assertExists()
    }

    @Test fun aNewOrderEveryShowing() {
        val orders = (1..12).map { n -> ListenContext.pick(listenRows(view()), emptyMap(), "showing-$n", Samples.note.hanzi).rows.map { it.key } }
        assertTrue(orders.toSet().size > 2)
        assertTrue(orders.any { it.first() != clueKey })
    }

    @Test fun offlineOnlyCachedClipsPlay() {
        screen(online = false, cached = setOf(s1Clip))
        compose.onNodeWithContentDescription("Sentence ${indexOf(clueKey) + 1}").assertIsNotEnabled()
        compose.onNodeWithContentDescription("Sentence ${indexOf("s2") + 1}").assertIsNotEnabled()
        assertTrue(compose.onAllNodesWithText(ListenContext.Copy.UNAVAILABLE).fetchSemanticsNodes().size == 2)
        compose.onNodeWithTag(LISTEN_MORE_TAG).assertDoesNotExist()
        compose.onNodeWithContentDescription("Sentence ${indexOf("s1") + 1}").performClick()
        assertEquals(s1Clip, played.single().first)
        shot("study-listen-04-offline")
    }

    @Test fun moreSentencesAddsToTheSet() {
        screen()
        compose.onNodeWithTag(LISTEN_MORE_TAG).performScrollTo().performClick()
        compose.mainClock.advanceTimeBy(300)
        // Four sentences, three of them natural (s3 was written around a look-alike, core SentenceFocus) →
        // enough natural ones to reach about eight, keeping the set.
        assertEquals(5 to true, generated)
    }

    @Test fun darkQuestion() {
        screen(dark = true)
        compose.onNodeWithContentDescription("Sentence ${indexOf("s1") + 1}").performClick()
        compose.onAllNodesWithTag(LISTEN_EN_TAG)[0].performClick()
        shot("study-listen-05-dark")
    }

    /** The hanzi of the sentence rows on the answer side, top to bottom (after Show all). */
    private fun answerRowHanzi(v: CardView): List<String> {
        val known = (listenRows(v).map { it.hanzi } + v.sentences.map { it.hanzi }).distinct()
        // Each sentence's text node on the answer side, by its unclipped position (rows below the fold too).
        return known.mapNotNull { h ->
            compose.onAllNodesWithText(h, useUnmergedTree = true).fetchSemanticsNodes()
                .minOfOrNull { it.positionInRoot.y }?.let { h to it }
        }.sortedBy { it.second }.map { it.first }
    }

    /**
     * The answer keeps the question's order (core AnswerOrder; docs/STUDY_SESSION.md): the answer side's
     * example sentences start with the rows Listen in context showed, in exactly that order — the card's
     * own sentence where it was, with its badge — then the rest (the contrived one last, as always).
     */
    @Test fun answerSideKeepsTheQuestionsOrder() {
        screen(dark = true)
        val question = order().map { it.hanzi }
        shot("study-listen-10-question-order")
        compose.onNodeWithText("Show answer", substring = true, ignoreCase = true).performClick()
        compose.mainClock.advanceTimeBy(800)
        compose.onNodeWithText("Show all").performScrollTo().performClick()
        compose.mainClock.advanceTimeBy(600)
        val answer = answerRowHanzi(view())
        assertEquals(question, answer.take(question.size))
        assertEquals("他算了算钱，打算买那辆车。", answer.last())
        shot("study-listen-11-answer-matches")
    }

    /** The same showing again (back from the coach / Home, a resume): the question's rows as they were, and the answer follows them. */
    @Test fun aResumedShowingKeepsItsRows() {
        val kept = listOf("s2", clueKey, "s1")
        val base = view()
        val v = base.copy(start = CardStartState(listenShown = kept))
        val reported = ArrayList<List<String>>()
        val ui = StudyUi(StudyPhase.Showing(v), Samples.counts, SessionStats(), online = true)
        val acts = StudyActions(onPlay = { key, text -> played += key to text }, onCardListen = { _, keys -> reported += keys })
        compose.setContent { LabTheme { StudyScreen(ui, playingKey = null, actions = acts, autoplay = false) } }
        compose.mainClock.advanceTimeBy(600)
        // Not re-picked: "Sentence 1" is s2's row (its EN shows s2's English).
        compose.onAllNodesWithTag(LISTEN_EN_TAG)[0].performClick()
        compose.onNodeWithText("When do you plan to go home?").assertExists()
        assertEquals(kept, reported.last())
        compose.onNodeWithText("Show answer", substring = true, ignoreCase = true).performClick()
        compose.mainClock.advanceTimeBy(800)
        compose.onNodeWithText("Show all").performScrollTo().performClick()
        compose.mainClock.advanceTimeBy(600)
        assertEquals(listOf("你打算什么时候回家？", "你周末打算做什么？", "我打算学中文。"), answerRowHanzi(v).take(3))
    }
}
