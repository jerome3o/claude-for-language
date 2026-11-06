package dev.jeromeswannack.chineselearning.lab.ui.readers

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.CoachPractise
import dev.jeromeswannack.chineselearning.lab.core.ReadAloud
import dev.jeromeswannack.chineselearning.lab.core.WordRecap
import dev.jeromeswannack.chineselearning.lab.core.WordRecapRun
import dev.jeromeswannack.chineselearning.lab.data.readers.RecapOffer
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.coach.CoachPractiseTags
import dev.jeromeswannack.chineselearning.lab.ui.coach.PractiseUi
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * 📝 Reader word recap (docs/STUDY_SESSION.md "Reader word recap"): the end-of-story offer, a card's
 * front (the story sentence, the word marked) and back (why it is here, the switch OFF by default),
 * Not yet bringing a word back, and the list of every word with its switch.
 */
class WordRecapTest : LabScreenshotTest() {
    private val p1 = WordRecap.Page(
        0, "今天我们在成都，先去春熙路采耳。", "Today we're in Chengdu; first we get our ears cleaned on Chunxi Road.",
        listOf(
            WordRecap.Word("今天", "jīntiān", "today"), WordRecap.Word("我们", "wǒmen", "we"), WordRecap.Word("在", "zài", "in"),
            WordRecap.Word("成都", "Chéngdū", "Chengdu"), WordRecap.Word("，", "", ""), WordRecap.Word("先", "xiān", "first"),
            WordRecap.Word("去", "qù", "go"), WordRecap.Word("春熙路", "Chūnxī Lù", "Chunxi Road"), WordRecap.Word("采耳", "cǎi'ěr", "ear cleaning"),
            WordRecap.Word("。", "", ""),
        ),
    )
    private val p2 = WordRecap.Page(
        1, "晚上我们吃麻辣兔头。", "In the evening we eat spicy rabbit heads.",
        listOf(
            WordRecap.Word("晚上", "wǎnshang", "evening"), WordRecap.Word("我们", "wǒmen", "we"), WordRecap.Word("吃", "chī", "eat"),
            WordRecap.Word("麻辣", "málà", "numbing and spicy"), WordRecap.Word("兔头", "tùtóu", "rabbit head"), WordRecap.Word("。", "", ""),
        ),
    )

    private fun run(): WordRecapRun {
        var r = WordRecap.emptyRun("r-cd", "2026-11-03T10:00:00Z")
        r = WordRecap.addTap(r, WordRecap.Tap("采耳", "cǎi'ěr", "ear cleaning", p1.text, 0, 13, p1.english), "2026-11-03T10:00:01Z")
        r = WordRecap.addTap(r, WordRecap.Tap("成都", "Chéngdū", "Chengdu", p1.text, 0, 5, p1.english), "2026-11-03T10:00:01Z")
        r = WordRecap.addMistakes(r, p1, ReadAloud.judge(p1.text, "今天我们在程度先去春熙路采耳"), "2026-11-03T10:00:02Z")
        r = WordRecap.addMistakes(r, p2, ReadAloud.judge(p2.text, "晚上我们吃兔头"), "2026-11-03T10:00:03Z")
        r = WordRecap.addTap(r, WordRecap.Tap("兔头", "tùtóu", "rabbit head", p2.text, 1, 7, p2.english), "2026-11-03T10:00:04Z")
        return WordRecap.finish(r, "2026-11-03T10:05:00Z")
    }

    @Test
    fun collectsInStoryOrder() {
        val r = run()
        // The run keeps the take's mistakes (Ask Claude reads them) …
        assertEquals(listOf("成都", "采耳", "麻辣", "兔头"), r.words.map { it.hanzi })
        assertEquals(listOf(WordRecap.TAPPED, WordRecap.SAID_WRONG), r.words[0].reasons)
        // … but the recap is the TAPPED words only (麻辣 was only read wrong), each as tapped.
        assertEquals(listOf("成都", "采耳", "兔头"), WordRecap.words(r).map { it.hanzi })
        assertEquals(listOf("You tapped it while reading"), WordRecap.whyLines(WordRecap.words(r)[0]))
        assertEquals("Words from this story: 3 you tapped.", WordRecap.promptLine(r))
    }

    @Test fun offer() = shoot("reader-recap-01-offer") { OfferOverPage() }
    @Test fun offerDark() = shoot("reader-recap-01-offer-dark", dark = true) { OfferOverPage() }

    @androidx.compose.runtime.Composable
    private fun OfferOverPage() {
        val r = run()
        Box(Modifier.fillMaxSize().background(Lab.colors.background).padding(12.dp), contentAlignment = Alignment.BottomCenter) {
            RecapOfferCard(RecapOffer("r-cd", WordRecap.words(r).size, WordRecap.promptLine(r)), onStart = {}, onDone = {})
        }
    }

    @Test fun front() = shoot("reader-recap-02-front") { ReaderRecapScreen(RecapUi("Word recap", run(), sourceLabel = WordRecap.sourceLabel(WordRecap.SOURCE_READER, "成都的一天"), owned = setOf("兔头")), RecapActions()) }

    @Test fun back() = shoot("reader-recap-03-back") { ReaderRecapScreen(RecapUi("Word recap", run(), sourceLabel = WordRecap.sourceLabel(WordRecap.SOURCE_READER, "成都的一天"), owned = setOf("兔头"), revealed = true), RecapActions()) }
    @Test fun backDark() = shoot("reader-recap-03-back-dark", dark = true) { ReaderRecapScreen(RecapUi("Word recap", run(), sourceLabel = WordRecap.sourceLabel(WordRecap.SOURCE_READER, "成都的一天"), owned = setOf("兔头"), revealed = true), RecapActions()) }

    private fun answered(): WordRecapRun {
        var r = run()
        r = WordRecap.answer(r, "成都", false, "2026-11-03T10:06:01Z", "e1")
        r = WordRecap.answer(r, "采耳", true, "2026-11-03T10:06:02Z", "e2")
        r = WordRecap.answer(r, "兔头", true, "2026-11-03T10:06:04Z", "e4")
        r = WordRecap.answer(r, "成都", true, "2026-11-03T10:06:05Z", "e5")
        r = WordRecap.setKeep(r, "成都", true)
        r = WordRecap.setKeep(r, "兔头", true)
        return r
    }

    @Test fun summary() = shoot("reader-recap-04-summary", settleMs = 3_500) { ReaderRecapScreen(RecapUi("Word recap", answered(), sourceLabel = WordRecap.sourceLabel(WordRecap.SOURCE_READER, "成都的一天"), owned = setOf("兔头")), RecapActions()) }
    @Test fun summaryDark() = shoot("reader-recap-04-summary-dark", dark = true, settleMs = 3_500) { ReaderRecapScreen(RecapUi("Word recap", answered(), sourceLabel = WordRecap.sourceLabel(WordRecap.SOURCE_READER, "成都的一天"), owned = setOf("兔头")), RecapActions()) }

    @Test
    fun notYetComesBackAndSwitchesStartOff() {
        val answers = ArrayList<Pair<String, Boolean>>()
        compose.setContent {
            LabTheme {
                var r by remember { mutableStateOf(run()) }
                ReaderRecapScreen(
                    RecapUi("成都的一天", r, owned = setOf("兔头")),
                    RecapActions(
                        answer = { k, right -> answers += k to right; r = WordRecap.answer(r, k, right, "2026-11-03T10:0${answers.size}:00Z", "e${answers.size}") },
                        keep = { k, on -> r = WordRecap.setKeep(r, k, on) },
                    ),
                )
            }
        }
        fun answer(word: String, right: Boolean) {
            assertTrue(compose.onAllNodesWithText(word).fetchSemanticsNodes().isNotEmpty(), "card shows $word")
            compose.onNodeWithTag(WordRecapTags.SHOW).performClick()
            compose.onNodeWithTag(WordRecapTags.KEEP).assertIsOff()
            compose.onNodeWithTag(if (right) WordRecapTags.GOT_IT else WordRecapTags.NOT_YET).performClick()
            compose.waitForIdle()
        }
        answer("成都", false)
        answer("采耳", true)
        answer("兔头", true)
        answer("成都", true)
        compose.onNodeWithText("Recap done 🎉").assertExists()
        compose.onNodeWithText("2 right first time", substring = true).assertExists()
        assertEquals(3, compose.onAllNodesWithTag(WordRecapTags.KEEP).fetchSemanticsNodes().size)
        compose.onNodeWithText("⚡ Study it today").assertExists()
    }

    // ---------- 🎤 Say it ----------

    private val label = WordRecap.sourceLabel(WordRecap.SOURCE_READER, "成都的一天")
    private fun said(transcript: String) = PractiseUi(result = CoachPractise.practise(transcript, "成都"))

    @Test fun sayQuestion() = shoot("reader-recap-05-say-question") { ReaderRecapScreen(RecapUi("Word recap", run(), sourceLabel = label, sayPreview = said("成都。")), RecapActions()) }
    @Test fun sayQuestionDark() = shoot("reader-recap-05-say-question-dark", dark = true) { ReaderRecapScreen(RecapUi("Word recap", run(), sourceLabel = label, sayPreview = said("成都。")), RecapActions()) }
    @Test fun sayCloseDark() = shoot("reader-recap-06-say-close-dark", dark = true) { ReaderRecapScreen(RecapUi("Word recap", run(), sourceLabel = label, sayPreview = said("城都")), RecapActions()) }
    @Test fun sayAnswerDark() = shoot("reader-recap-07-say-answer-dark", dark = true) {
        ReaderRecapScreen(RecapUi("Word recap", run(), sourceLabel = label, revealed = true, sayPreview = said("我们在成都"), saySuggested = WordRecap.saySuggestion("contains")), RecapActions())
    }

    @Test
    fun sayItShowsOnBothSidesWithoutListen() {
        compose.setContent { LabTheme { ReaderRecapScreen(RecapUi("Word recap", run()), RecapActions()) } }
        val mic = CoachPractiseTags.mic(WordRecapTags.SAY)
        compose.onNodeWithTag(mic).assertExists()
        compose.onNodeWithText("🎤  Say it").assertExists()
        // No ▶ on the question side: it would give the word away.
        assertTrue(compose.onAllNodesWithTag(CoachPractiseTags.listen(WordRecapTags.SAY)).fetchSemanticsNodes().isEmpty())
        compose.onNodeWithTag(WordRecapTags.SHOW).performClick()
        compose.waitForIdle()
        compose.onNodeWithTag(mic).assertExists()
        // Nothing said before Show answer: no suggestion.
        compose.onNodeWithText("Got it").assertExists()
    }

    @Test
    fun saidRightShowsYouSaidAndSuggestsGotIt() {
        compose.setContent {
            LabTheme { ReaderRecapScreen(RecapUi("Word recap", run(), revealed = true, sayPreview = said("成都"), saySuggested = WordRecap.saySuggestion("match")), RecapActions()) }
        }
        compose.onNodeWithTag(CoachPractiseTags.result(WordRecapTags.SAY)).assertExists()
        compose.onNodeWithText("Match", substring = true).assertExists()
        compose.onNodeWithText("✓ Got it").assertExists()
        compose.onNodeWithTag(WordRecapTags.GOT_IT).assert(androidx.compose.ui.test.SemanticsMatcher.expectValue(androidx.compose.ui.semantics.SemanticsProperties.StateDescription, "Suggested"))
        compose.onNodeWithText("🔁  Try again").assertExists()
    }

    @Test
    fun sayCheckedLikeASpokenAnswer() {
        assertEquals("match", CoachPractise.outcome(CoachPractise.practise("成都。", "成都"), null))
        assertEquals("contains", CoachPractise.outcome(CoachPractise.practise("我们在成都", "成都"), null))
        assertEquals("right", WordRecap.saySuggestion("contains"))
        assertEquals(null, WordRecap.saySuggestion("close"))
    }

    @Test
    fun sayOfflineSaysWhy() {
        compose.setContent { LabTheme { ReaderRecapScreen(RecapUi("Word recap", run(), sayPreview = PractiseUi(blocked = "offline")), RecapActions()) } }
        compose.onNodeWithTag(CoachPractiseTags.blocked(WordRecapTags.SAY)).assertExists()
        compose.onNodeWithText(CoachPractise.OFFLINE).assertExists()
    }
}
