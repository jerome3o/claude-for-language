package dev.jeromeswannack.chineselearning.lab.ui.homework

import androidx.compose.runtime.getValue
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.HomeworkAssignment
import dev.jeromeswannack.chineselearning.lab.core.HomeworkEvent
import dev.jeromeswannack.chineselearning.lab.data.CardEntity
import dev.jeromeswannack.chineselearning.lab.data.DeckEntity
import dev.jeromeswannack.chineselearning.lab.data.NoteEntity
import dev.jeromeswannack.chineselearning.lab.data.SentenceEntity
import dev.jeromeswannack.chineselearning.lab.data.api.ExplainedWord
import dev.jeromeswannack.chineselearning.lab.data.api.SentenceExplanation
import dev.jeromeswannack.chineselearning.lab.data.homework.HomeworkKeys
import dev.jeromeswannack.chineselearning.lab.ui.study.BREAKDOWN_HANZI_TAG
import dev.jeromeswannack.chineselearning.lab.ui.study.CardTools
import dev.jeromeswannack.chineselearning.lab.ui.study.SENTENCE_ROW_TAG
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The pass's example sentences are the study card's rows — play, tap to reveal, "What's going
 * on here?" (from the offline cache), the word rows, "+ N more sentences" — and
 * none of it records anything: no review event, no homework event, the card stays where it
 * is. Only Got it / Not yet write (a homework event, never a review).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = LabScreenshotTest.PHONE, application = LabApp::class)
class PassSentencesTest {
    @get:Rule val compose = createComposeRule()
    private lateinit var app: LabApp

    private val clue = "老师喜欢在课上和学生互动。"

    @Before
    fun setUp() = runBlocking {
        app = ApplicationProvider.getApplicationContext()
        app.prefs.sessionToken = null
        val dao = app.repo.dao
        dao.upsertDecks(listOf(DeckEntity("d1", "Lesson vocab – 30 Sep", null, 0, 0, 1, "2026-09-30T00:00:00.000Z")))
        dao.upsertNotes(
            listOf(
                NoteEntity("n1", "d1", "互动", "hùdòng", "to interact; interaction", null, null, null, clue, "lǎoshī xǐhuan zài kè shang hé xuésheng hùdòng.", "The teacher likes to interact with the students in class.", null, null, null),
                NoteEntity("n2", "d1", "课堂", "kètáng", "classroom", null, null, null, null, null, null, null, null, null),
            ),
        )
        dao.insertCardsIfMissing(listOf(CardEntity("c1", "n1", "d1", "hanzi_to_meaning"), CardEntity("c2", "n2", "d1", "hanzi_to_meaning")))
        dao.upsertSentences(
            listOf(
                SentenceEntity("s1", "n1", 0, "我们多互动吧。", "wǒmen duō hùdòng ba.", "Let's interact more.", null, "core", null),
                SentenceEntity("s2", "n1", 1, "这个节目和观众有很多互动。", "zhège jiémù hé guānzhòng yǒu hěn duō hùdòng.", "This show interacts a lot with the audience.", null, "collocation", null),
            ),
        )
        app.cache.put(HomeworkKeys.ASSIGNMENTS, HomeworkKeys.KIND, listOf(HomeworkAssignment(id = "a1", kind = "deck", target_id = "d1", title = "Lesson vocab – 30 Sep", mode = "one_off", due_date = "2026-10-02", item_ids = listOf("n1", "n2"), item_count = 2)))
        app.cache.put(HomeworkKeys.EVENTS, HomeworkKeys.KIND, emptyList<HomeworkEvent>())
        // Explained once before (study card / Coach): the breakdown is on the phone, offline.
        CardTools(app).cacheTextExplanation(
            clue,
            SentenceExplanation(listOf(ExplainedWord("老师", "lǎoshī", "teacher"), ExplainedWord("互动", "hùdòng", "to interact")), construction = "喜欢 + a whole activity."),
        )
    }

    @Test
    fun sentenceToolsRecordNothingAndLeaveTheCardAlone() {
        val vm = HomeworkPassViewModel(app, "a1")
        compose.setContent {
            val ui by vm.ui.collectAsStateWithLifecycle()
            LabTheme {
                HomeworkPassScreen(
                    ui,
                    PassActions(onReveal = vm::reveal, onAnswer = vm::answer, sentences = passSentenceActions(app), onPlaySentence = { _, _ -> }),
                )
            }
        }
        compose.waitUntil(5_000) { (vm.ui.value as? PassUi.Deck)?.note != null }
        compose.onNodeWithTag("hw-show").performClick()
        compose.waitForIdle()

        // The card's own sentence, Chinese up; two taps → pinyin, then English + the tools.
        compose.onNodeWithText(clue, substring = true).assertExists()
        compose.onAllNodesWithTag(SENTENCE_ROW_TAG).onFirst().performScrollTo().performClick()
        compose.onNodeWithText("lǎoshī xǐhuan zài kè shang hé xuésheng hùdòng.", substring = true).assertExists()
        compose.onAllNodesWithTag(SENTENCE_ROW_TAG).onFirst().performScrollTo().performClick()
        compose.onNodeWithText("The teacher likes to interact with the students in class.", substring = true).assertExists()
        // The breakdown comes from the cache (offline) — one row per word; a word opens the add sheet.
        compose.waitUntil(5_000) { compose.onAllNodesWithTag(BREAKDOWN_HANZI_TAG, useUnmergedTree = true).fetchSemanticsNodes().size == 2 }
        compose.onNodeWithText("喜欢 + a whole activity.", substring = true).assertExists()
        // (This phone is offline in the test: adding a card needs the network, so the word tap is inert.)
        compose.onAllNodesWithTag(BREAKDOWN_HANZI_TAG, useUnmergedTree = true).onFirst().performScrollTo().performClick()
        compose.waitForIdle()
        // The generated set waits behind "+ 2 more sentences".
        compose.onNodeWithText("我们多互动吧。").assertDoesNotExist()
        compose.onNodeWithTag(PASS_MORE_SENTENCES_TAG).performScrollTo().performClick()
        compose.onNodeWithText("我们多互动吧。", substring = true).assertExists()
        compose.onAllNodesWithTag(SENTENCE_ROW_TAG).assertCountEquals(3)

        // Nothing recorded; still the same card, still turned over.
        runBlocking {
            assertEquals(0, app.repo.dao.allEvents().size)
            assertEquals(emptyList<HomeworkEvent>(), app.cache.get<List<HomeworkEvent>>(HomeworkKeys.EVENTS))
        }
        val deck = vm.ui.value as PassUi.Deck
        assertEquals("n1", deck.note?.id)
        assertTrue(deck.revealed)
        assertEquals(0, deck.progress.done)

        // Got it still works as before: one homework event, no review.
        compose.onNodeWithTag("hw-gotit").performClick()
        // The event is written off the main thread (Room, the outbox): let it land.
        repeat(300) {
            if ((vm.ui.value as? PassUi.Deck)?.note?.id == "n2") return@repeat
            org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle()
            Thread.sleep(10)
        }
        assertEquals("n2", (vm.ui.value as? PassUi.Deck)?.note?.id)
        runBlocking {
            assertEquals(0, app.repo.dao.allEvents().size)
            assertEquals(listOf("right"), app.cache.get<List<HomeworkEvent>>(HomeworkKeys.EVENTS).orEmpty().map { it.result })
        }
    }
}
