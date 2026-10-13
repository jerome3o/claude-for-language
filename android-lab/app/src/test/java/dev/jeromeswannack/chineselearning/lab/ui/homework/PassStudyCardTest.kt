package dev.jeromeswannack.chineselearning.lab.ui.homework

import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.HomeworkAssignment
import dev.jeromeswannack.chineselearning.lab.core.HomeworkEvent
import dev.jeromeswannack.chineselearning.lab.core.StudyBudget
import dev.jeromeswannack.chineselearning.lab.data.CardEntity
import dev.jeromeswannack.chineselearning.lab.data.DeckEntity
import dev.jeromeswannack.chineselearning.lab.data.NoteEntity
import dev.jeromeswannack.chineselearning.lab.data.bumps.BumpStore
import dev.jeromeswannack.chineselearning.lab.data.homework.HomeworkKeys
import dev.jeromeswannack.chineselearning.lab.data.study.StudyDayStore
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.bumps.BUMP_TOGGLE_TAG
import dev.jeromeswannack.chineselearning.lab.ui.study.CardStartState
import dev.jeromeswannack.chineselearning.lab.ui.study.PassSpec
import dev.jeromeswannack.chineselearning.lab.ui.study.RecordAgainAutoplayTest
import dev.jeromeswannack.chineselearning.lab.ui.study.StudyActions
import dev.jeromeswannack.chineselearning.lab.ui.study.StudyPhase
import dev.jeromeswannack.chineselearning.lab.ui.study.StudyScreen
import dev.jeromeswannack.chineselearning.lab.ui.study.StudyViewModel
import dev.jeromeswannack.chineselearning.lab.ui.study.TakeUi
import dev.jeromeswannack.chineselearning.lab.ui.study.TranscriptionUi
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.time.ZoneId

/**
 * The homework pass on the STUDY CARD (web: HomeworkPassPage → StudyCard `pass`, e2e
 * homework-pass-voice.spec.ts): each word is its read card — Show answer / 🎤 Record, the back —
 * with Not yet / Got it where the ratings are. Nothing is a review event; the take is never kept
 * for upload; a "Not yet" word comes back as a fresh card; a matching "You said" suggests Got it;
 * ⚡ Study it today toggles the word in today's pocket (source homework_pass).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = LabScreenshotTest.PHONE, application = LabApp::class)
class PassStudyCardTest {
    @get:Rule val compose = createComposeRule()
    private lateinit var app: LabApp

    @Before
    fun setUp() = runBlocking {
        app = ApplicationProvider.getApplicationContext()
        app.prefs.sessionToken = null
        app.prefs.budget = StudyBudget(3, 6)
        StudyDayStore.forTest(app, ZoneId.systemDefault())
        val dao = app.repo.dao
        // A one-off-only homework copy (caps 0 + 0).
        dao.upsertDecks(listOf(DeckEntity("d1", "餐厅点菜", null, 0, 0, 1, "2026-09-30T00:00:00.000Z")))
        dao.upsertNotes(
            listOf(
                NoteEntity("n1", "d1", "服务员", "fúwùyuán", "waiter; waitress", null, null, null, null, null, null, null, null, null),
                NoteEntity("n2", "d1", "点菜", "diǎn cài", "to order food", null, null, null, null, null, null, null, null, null),
                NoteEntity("n3", "d1", "菜单", "càidān", "menu", null, null, null, null, null, null, null, null, null),
            ),
        )
        // n1's typing card is first in the table: the pass still deals its read card. n3 has no cards on the phone.
        dao.insertCardsIfMissing(
            listOf(
                CardEntity("c1m", "n1", "d1", "meaning_to_hanzi"), CardEntity("c1h", "n1", "d1", "hanzi_to_meaning"),
                CardEntity("c2h", "n2", "d1", "hanzi_to_meaning"),
            ),
        )
        app.cache.put(HomeworkKeys.ASSIGNMENTS, HomeworkKeys.KIND, listOf(HomeworkAssignment(id = "a1", kind = "deck", target_id = "d1", title = "餐厅点菜", mode = "one_off", due_date = "2026-10-12", item_ids = listOf("n1", "n2"), item_count = 2)))
        app.cache.put(HomeworkKeys.EVENTS, HomeworkKeys.KIND, emptyList<HomeworkEvent>())
    }

    private fun settle(what: String, state: () -> Any? = { null }, done: () -> Boolean) {
        val hangGuard = System.nanoTime() + 120_000_000_000L
        while (true) {
            compose.waitForIdle()
            shadowOf(android.os.Looper.getMainLooper()).idle()
            if (done()) return
            check(System.nanoTime() < hangGuard) { "Still waiting for $what after 2 minutes; ui = ${state()}" }
            Thread.sleep(5)
        }
    }

    private fun showAnswer() {
        settle("the card's Show answer") { compose.onAllNodesWithText("Show answer").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Show answer").performClick()
        settle("the answer side") { compose.onAllNodesWithTag("hw-gotit").fetchSemanticsNodes().isNotEmpty() }
    }

    private fun events() = runBlocking { app.cache.get<List<HomeworkEvent>>(HomeworkKeys.EVENTS).orEmpty() }

    /**
     * Jerome (Oct 2026): every character of his tutor's homework sentence shimmered. The pass is not
     * the flashcard session — no new-character shimmer at all, whatever the seen set (here nothing
     * is reviewed, which used to make every character "new"), also on a card dealt before anything loaded.
     */
    @Test
    fun thePassNeverShimmersNewCharacters() {
        val vm = StudyViewModel(app, null, pass = PassSpec("a1"))
        vm.showPassCard("n1", 0)
        settle("n1's card", { vm.ui.value }) { (vm.ui.value.phase as? StudyPhase.Showing)?.view?.card?.id == "c1h" }
        assertEquals(emptyList<String>(), (vm.ui.value.phase as StudyPhase.Showing).view.newChars)
        vm.showPassCard("n3", 0)
        settle("n3's card", { vm.ui.value }) { (vm.ui.value.phase as? StudyPhase.Showing)?.view?.card?.id == "pass:n3" }
        assertEquals(emptyList<String>(), (vm.ui.value.phase as StudyPhase.Showing).view.newChars)
    }

    /** The card engine in pass mode: the read card, the take let go, never a review. */
    @Test
    fun theStudyViewModelDealsTheReadCardAndNeverReviewsOrKeepsTheTake() {
        @Suppress("UNCHECKED_CAST")
        (LabApp::class.java.getDeclaredField("_online").apply { isAccessible = true }.get(app) as MutableStateFlow<Boolean>).value = true
        var rec: RecordAgainAutoplayTest.FakeRecorder? = null
        val vm = StudyViewModel(app, null, pass = PassSpec("a1"), newRecorder = { scope -> RecordAgainAutoplayTest.FakeRecorder(app, scope).also { rec = it } })
        vm.showPassCard("n1", 0)
        settle("n1's card", { vm.ui.value }) { (vm.ui.value.phase as? StudyPhase.Showing)?.view?.card?.id == "c1h" }

        vm.startRecording()
        shadowOf(android.os.Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(700))
        vm.stopRecording(false)
        settle("the take") { vm.ui.value.extras.take.hasTake }
        vm.onRevealed(null)
        // Rating is not how a pass word is answered: nothing happens.
        vm.rate(2, 1_000, null)
        vm.passAnswered(true)
        settle("the take let go") { rec?.recording == false }
        runBlocking {
            assertEquals(0, app.repo.dao.allEvents().size)
            assertFalse("no recording queued for upload", app.outbox.all().any { it.kind == "recording" })
        }

        // The next word, then a word whose cards aren't on the phone: a NEW read card for it, nothing written.
        vm.showPassCard("n2", 0)
        settle("n2's card", { vm.ui.value }) { (vm.ui.value.phase as? StudyPhase.Showing)?.view?.card?.id == "c2h" }
        vm.showPassCard("n3", 0)
        settle("n3's card", { vm.ui.value }) { (vm.ui.value.phase as? StudyPhase.Showing)?.view?.card?.id == "pass:n3" }
        assertEquals("hanzi_to_meaning", (vm.ui.value.phase as StudyPhase.Showing).view.card.cardType)
        assertFalse(vm.ui.value.showExplainer)
        runBlocking { assertTrue(app.repo.dao.cardsOfNotes(listOf("n3")).isEmpty()) }
    }

    /** The whole pass on the study card: Not yet brings the word back fresh, Got it twice ends it — homework events only. */
    @Test
    fun notYetBringsTheWordBackAndGotItEndsThePassWithoutAReview() {
        val vm = HomeworkPassViewModel(app, "a1")
        compose.setContent { LabTheme { HomeworkPassContent(app, vm, PassActions()) } }
        showAnswer()
        // The pass's choices, never the ratings; the pass's header, no queue counts.
        compose.onNodeWithText("Again").assertDoesNotExist()
        compose.onNodeWithText("Good").assertDoesNotExist()
        compose.onNodeWithText("0/2").assertExists()
        compose.onNodeWithText("服务员", useUnmergedTree = true).assertExists()

        compose.onNodeWithTag("hw-notyet").performClick()
        settle("the second word", { vm.ui.value }) { (vm.ui.value as? PassUi.Deck)?.note?.id == "n2" }
        showAnswer()
        compose.onNodeWithTag("hw-gotit").performClick()
        settle("the first word again", { vm.ui.value }) { (vm.ui.value as? PassUi.Deck)?.let { it.note?.id == "n1" && it.attempt == 1 } == true }
        // A fresh card: the question side again.
        showAnswer()
        compose.onNodeWithTag("hw-gotit").performClick()
        settle("the finish", { vm.ui.value }) { (vm.ui.value as? PassUi.Deck)?.progress?.complete == true }
        settle("the done screen") { compose.onAllNodesWithTag("hw-pass-done").fetchSemanticsNodes().isNotEmpty() }

        assertEquals(listOf("wrong", "right", "right"), events().map { it.result })
        runBlocking { assertEquals(0, app.repo.dao.allEvents().size) }
    }

    /** ⚡ on the answer side: on = in today's pocket (homework_pass), off = taken out; the queue follows. */
    @Test
    fun theBumpToggleBumpsAndClears() {
        val vm = HomeworkPassViewModel(app, "a1")
        compose.setContent { LabTheme { HomeworkPassContent(app, vm, PassActions()) } }
        showAnswer()
        compose.onNodeWithTag(BUMP_TOGGLE_TAG).performScrollTo().assert(SemanticsMatcher.expectValue(SemanticsProperties.ToggleableState, androidx.compose.ui.state.ToggleableState.Off))
        compose.onNodeWithText("⚡ Study it today").assertExists()

        compose.onNodeWithTag(BUMP_TOGGLE_TAG).performClick()
        settle("the bump", { vm.ui.value }) { runBlocking { BumpStore.active(app.repo.dao).any { it.noteId == "n1" } } && (vm.ui.value as? PassUi.Deck)?.bumped == true }
        val row = runBlocking { BumpStore.active(app.repo.dao).single { it.noteId == "n1" } }
        assertEquals("homework_pass", row.source)
        compose.onNodeWithText("⚡ Today ✓").assertExists()
        assertTrue(runBlocking { app.outbox.all() }.any { it.method == "POST" && it.path == "/api/me/bumps" })
        // The one-off copy's word is first in today's study now — outside the pools, past the caps.
        assertTrue(runBlocking { BumpStore.openNoteIds(app.repo.dao) }.contains("n1"))

        compose.onNodeWithTag(BUMP_TOGGLE_TAG).performClick()
        settle("the clear", { vm.ui.value }) { runBlocking { BumpStore.active(app.repo.dao).none { it.noteId == "n1" } } && (vm.ui.value as? PassUi.Deck)?.bumped == false }
        compose.onNodeWithText("⚡ Study it today").assertExists()
        assertTrue(runBlocking { app.outbox.all() }.any { it.method == "DELETE" && it.path == "/api/me/bumps/n1" })
        runBlocking { assertEquals(0, app.repo.dao.allEvents().size) }
    }

    /** What the card saw suggests the answer: a matching take → Got it (ringed); nothing tried → nothing. He still chooses. */
    @Test
    fun aMatchingTakeSuggestsGotItAndTheChoiceIsHis() {
        val answers = mutableListOf<Triple<Boolean, String, String?>>()
        val take = mutableListOf(TakeUi(hasTake = true, transcription = TranscriptionUi.Done(PassStudyCardScreenshots.said)))
        compose.setContent {
            LabTheme {
                StudyScreen(
                    PassStudyCardScreenshots.ui(take.single()), playingKey = null,
                    actions = StudyActions(onPassAnswer = { r, a, s -> answers += Triple(r, a, s) }),
                    cardStart = CardStartState(flipped = true), autoplay = false, pass = PassStudyCardScreenshots.pass(),
                )
            }
        }
        compose.onNodeWithText("✓ suggested").assertExists()
        compose.onNodeWithTag("hw-gotit").assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, "Suggested"))
        // He disagrees: Not yet is his answer all the same.
        compose.onNodeWithTag("hw-notyet").performClick()
        compose.waitForIdle()
        assertEquals(listOf(Triple(false, "take", "right")), answers)
    }

    @Test
    fun nothingTriedSuggestsNothing() {
        val answers = mutableListOf<Triple<Boolean, String, String?>>()
        compose.setContent {
            LabTheme {
                StudyScreen(
                    PassStudyCardScreenshots.ui(), playingKey = null,
                    actions = StudyActions(onPassAnswer = { r, a, s -> answers += Triple(r, a, s) }),
                    cardStart = CardStartState(flipped = true), autoplay = false, pass = PassStudyCardScreenshots.pass(),
                )
            }
        }
        compose.onNodeWithText("✓ suggested").assertDoesNotExist()
        compose.onNodeWithTag("hw-gotit").performClick()
        compose.waitForIdle()
        assertEquals(listOf(Triple(true, "none", null as String?)), answers)
    }
}
