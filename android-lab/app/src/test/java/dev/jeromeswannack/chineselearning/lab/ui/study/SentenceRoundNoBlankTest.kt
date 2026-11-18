package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onRoot
import androidx.test.core.app.ApplicationProvider
import com.github.takahirom.roborazzi.captureRoboImage
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.QueueCard
import dev.jeromeswannack.chineselearning.lab.core.SentenceHistory
import dev.jeromeswannack.chineselearning.lab.core.SentenceRound
import dev.jeromeswannack.chineselearning.lab.data.SentenceEntity
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.testing.Samples
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.delay
import org.junit.After
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Jerome (Nov 2026, Lab, a listening card in Hard mode): "I get this blank page for a little while, and then after a
 * second, it loads" — the round showed "You heard it — now say these in Chinese. Get any 0 of these 0 right" while it
 * fetched the English of the card's own sentence (none on the note) before picking. The data is on the phone: the
 * round's FIRST frame has its exercises, the card looks the English up while the question is up, a round with no
 * exercises goes straight to the answer, and "0 of these 0" never shows.
 */
class SentenceRoundNoBlankTest : LabScreenshotTest() {
    // The card's own sentence has no English on the note (an MCP-added / older note): the case that waited.
    private val note = Samples.note.copy(
        id = "n1", hanzi = "暗示", pinyin = "ànshì", english = "to hint; to imply",
        funFacts = "暗 (àn) dark, hidden + 示 (shì) show: to show without saying.",
        sentenceClue = "他暗示我早点走。", sentenceCluePinyin = "Tā ànshì wǒ zǎodiǎn zǒu.", sentenceClueTranslation = null,
    )
    private val set = listOf(
        SentenceEntity("s1", "n1", 0, "她暗示我不要说。", "Tā ànshì wǒ bú yào shuō.", "She hinted that I shouldn't say it.", null, "core", null),
        SentenceEntity("s2", "n1", 1, "老板暗示要加班。", "Lǎobǎn ànshì yào jiābān.", "The boss hinted we'd have to work overtime.", null, "collocation", null),
        SentenceEntity("s3", "n1", 2, "这句话有暗示的意思。", "Zhè jù huà yǒu ànshì de yìsi.", "This sentence has an implied meaning.", null, "complex", null),
    )
    private val prefs get() = StudyPrefs.get(ApplicationProvider.getApplicationContext())

    @After fun gateOff() = prefs.setHardMode("off")

    private fun view(type: String = CardTypes.AUDIO_TO_HANZI, sentences: List<SentenceEntity> = set): CardView {
        val now = Js.parseDate("2026-11-18T08:00:00.000Z")
        var state = CardScheduler.initialCardState()
        state = CardScheduler.applyReview(state, 2, "2026-11-10T08:00:00.000Z")
        return CardView(QueueCard("c1", "n1", "d1", type, state), note, sentences, CardScheduler.intervalPreviews(state, now), emptyList(), 1, "HSK 6", true)
    }

    private fun count(tag: String) = compose.onAllNodesWithTag(tag, useUnmergedTree = true).fetchSemanticsNodes().size
    private fun exercises() = (0 until 4).count { i ->
        listOf("read", "translate", "listen").any { m -> count("${SentenceRoundTags.EXERCISE}-$i-$m-open") > 0 }
    }
    private fun zeroLine() = compose.onAllNodesWithText("of these 0", substring = true, useUnmergedTree = true).fetchSemanticsNodes().size

    /** The round alone, as the card opens it; [translate] = the English fetch of the card's sentence. */
    private fun round(
        rows: List<SentenceRow>,
        translate: suspend (SentenceRow) -> String,
        onDone: () -> Unit = {},
        dark: Boolean = false,
        stats: Map<String, SentenceHistory.Stats>? = emptyMap(),
    ) {
        compose.mainClock.autoAdvance = false
        compose.setContent {
            LabTheme(dark = dark) {
                SentenceRoundPage(
                    question = note.hanzi, questionIsChinese = true, rows = rows,
                    practise = previewSentencePractise(), playingKey = null, onPlay = { _, _ -> },
                    onDone = onDone, onSkip = {}, listen = true, word = note.hanzi,
                    stats = stats, translate = translate, online = true,
                )
            }
        }
    }

    /** The first frame of the listening round already has its exercises — even while the English fetch hangs. */
    @Test fun listeningRoundHasItsExercisesOnItsFirstFrame() {
        round(sentenceRows(view()), translate = { awaitCancellation() })
        // No time advanced: this is the first composition.
        assertEquals(SentenceRound.LISTEN_SIZE, exercises())
        assertEquals(0, zeroLine())
        assertEquals(1, count(SentenceRoundTags.INTRO))
        assertEquals(0, count(SentenceRoundTags.LOADING))
    }

    /**
     * Before / after (virtual ms until the exercises show, with an English fetch that takes 1 s like the real one).
     * Before the fix: ~1,000 ms of "Get any 0 of these 0 right"; after: 0 — the first frame.
     */
    @Test fun timingUntilTheExercisesShow() {
        round(sentenceRows(view()), translate = { delay(1_000); "He hinted that I should leave early." })
        var ms = 0L
        var zeroSeen = false
        while (exercises() == 0 && ms < 3_000) {
            if (zeroLine() > 0) zeroSeen = true
            compose.mainClock.advanceTimeBy(16); ms += 16
        }
        println("[sentence-round-timing] exercises after $ms ms (virtual), \"0 of these 0\" seen: $zeroSeen")
        assertEquals(0L, ms)
        assertEquals(false, zeroSeen)
    }

    /** The history not read yet (the first card of a run): no "0 of 0", a skeleton only after a beat. */
    @Test fun stillReadingTheHistoryShowsSkeletonNotZero() {
        round(sentenceRows(view()), translate = { awaitCancellation() }, stats = null)
        assertEquals(0, zeroLine())
        assertEquals(0, count(SentenceRoundTags.INTRO))
        assertEquals(0, count(SentenceRoundTags.LOADING))
        compose.mainClock.advanceTimeBy(ROUND_LOADING_DELAY_MS + 50)
        assertEquals(1, count(SentenceRoundTags.LOADING))
        assertEquals(0, zeroLine())
    }

    /** Really no exercises (no sentence with English carries the word): straight to the answer, never "0 of these 0". */
    @Test fun zeroExercisesSkipTheRound() {
        var done = 0
        round(sentenceRows(view(sentences = emptyList())), translate = { awaitCancellation() }, onDone = { done++ })
        assertEquals(0, zeroLine())
        assertEquals(0, count(SentenceRoundTags.INTRO))
        compose.mainClock.advanceTimeBy(100)
        assertEquals(1, done)
        assertEquals(0, zeroLine())
    }

    /** The whole card: the listening card's English lookup runs while the QUESTION is up, not when the round opens. */
    @Test fun theCardLooksTheEnglishUpWhileTheQuestionIsUp() {
        val asked = mutableListOf<String>()
        prefs.setHardMode("all")
        val actions = StudyActions(sentences = SentenceActions(translate = { r -> asked += r.key; "He hinted that I should leave early." }))
        compose.setContent {
            LabTheme {
                StudyScreen(
                    StudyUi(StudyPhase.Showing(view()), Samples.counts, SessionStats(reviews = 5, correct = 4), canUndo = true, online = true),
                    playingKey = null, actions = actions, cardStart = CardStartState(), autoplay = false, sentencePractisePreview = previewSentencePractise(),
                )
            }
        }
        compose.mainClock.advanceTimeBy(500)
        // The question is up, no round yet — and the card sentence's English was already asked for.
        assertEquals(0, count(SentenceRoundTags.ROUND))
        assertEquals(listOf(cardRowKey("n1")), asked)
    }

    /** Screenshot: the listening round of 暗示 on its first frame (Lab dark) — the exercises are there at once. */
    @Test fun shotListeningRoundFirstFrameDark() {
        round(sentenceRows(view()), translate = { awaitCancellation() }, dark = true)
        assertTrue(exercises() > 0)
        compose.onRoot().captureRoboImage("screenshots/sentence-round-no-blank-listening-dark.png")
    }
}
