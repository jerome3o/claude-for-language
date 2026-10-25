package dev.jeromeswannack.chineselearning.lab.ui.homework

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.HomeworkAssignment
import dev.jeromeswannack.chineselearning.lab.core.HomeworkEvent
import dev.jeromeswannack.chineselearning.lab.core.PassAngles
import dev.jeromeswannack.chineselearning.lab.core.StudyBudget
import dev.jeromeswannack.chineselearning.lab.data.CardEntity
import dev.jeromeswannack.chineselearning.lab.data.DeckEntity
import dev.jeromeswannack.chineselearning.lab.data.NoteEntity
import dev.jeromeswannack.chineselearning.lab.data.homework.HomeworkKeys
import dev.jeromeswannack.chineselearning.lab.data.study.StudyDayStore
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.study.CardStartState
import dev.jeromeswannack.chineselearning.lab.ui.study.StudyActions
import dev.jeromeswannack.chineselearning.lab.ui.study.StudyPrefs
import dev.jeromeswannack.chineselearning.lab.ui.study.StudyScreen
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
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
 * Hard mode in the homework pass (docs/HOMEWORK.md §3e; web: HomeworkPassPage + StudyCard `pass.hard`,
 * e2e homework-pass-hard-mode.spec.ts): its own setting (All by default), a hard Got it on a first angle
 * records a STEP and the word comes back once on its meaning card, a give-up locks Got it, Off is the
 * pass as before. Never a review event.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = LabScreenshotTest.PHONE, application = LabApp::class)
class PassHardModeTest {
    @get:Rule val compose = createComposeRule()
    private lateinit var app: LabApp

    @Before
    fun setUp() = runBlocking {
        app = ApplicationProvider.getApplicationContext()
        app.prefs.sessionToken = null
        app.prefs.budget = StudyBudget(3, 6)
        StudyDayStore.forTest(app, ZoneId.systemDefault())
        val dao = app.repo.dao
        dao.upsertDecks(listOf(DeckEntity("d1", "餐厅点菜", null, 0, 0, 1, "2026-09-30T00:00:00.000Z")))
        dao.upsertNotes(
            listOf(
                NoteEntity("n1", "d1", "服务员", "fúwùyuán", "waiter; waitress", null, null, null, null, null, null, null, null, null),
                NoteEntity("n2", "d1", "点菜", "diǎn cài", "to order food", null, null, null, null, null, null, null, null, null),
            ),
        )
        dao.insertCardsIfMissing(
            listOf(
                CardEntity("c1h", "n1", "d1", "hanzi_to_meaning"), CardEntity("c1m", "n1", "d1", "meaning_to_hanzi"), CardEntity("c1a", "n1", "d1", "audio_to_hanzi"),
                CardEntity("c2h", "n2", "d1", "hanzi_to_meaning"), CardEntity("c2m", "n2", "d1", "meaning_to_hanzi"),
            ),
        )
        app.cache.put(HomeworkKeys.ASSIGNMENTS, HomeworkKeys.KIND, listOf(HomeworkAssignment(id = "a1", kind = "deck", target_id = "d1", title = "餐厅点菜", mode = "one_off", due_date = "2026-10-27", item_ids = listOf("n1", "n2"), item_count = 2)))
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

    private fun events() = runBlocking { app.cache.get<List<HomeworkEvent>>(HomeworkKeys.EVENTS).orEmpty() }

    private fun deck(vm: HomeworkPassViewModel) = vm.ui.value as? PassUi.Deck

    @Test
    fun theDefaultIsAllAndAHardGotItBringsTheWordBackOnItsMeaningCard() {
        StudyPrefs.get(app).setPassHardMode("unset-means-all")
        assertEquals("all", StudyPrefs.get(app).passHardMode.value)
        val vm = HomeworkPassViewModel(app, "a1")
        settle("n1's read card", { vm.ui.value }) { deck(vm)?.showing == PassAngles.Showing("n1", CardTypes.HANZI_TO_MEANING, 1, false) && deck(vm)?.note?.cardTypes?.size == 3 }
        val first = deck(vm)!!
        assertTrue(first.hardApplies)
        assertEquals("2 words × 2 angles in the bar", 4, first.bar.slots)

        vm.answer(true, "take", "right", hard = true)
        settle("n2", { vm.ui.value }) { deck(vm)?.showing?.noteId == "n2" && deck(vm)?.busy == false }
        assertEquals(0, deck(vm)!!.progress.done)
        vm.answer(true, "take", "right", hard = true)
        // No fresh word left: n1's second angle (its meaning card) comes back first.
        settle("n1's second angle", { vm.ui.value }) { deck(vm)?.showing == PassAngles.Showing("n1", CardTypes.MEANING_TO_HANZI, 2, false) && deck(vm)?.busy == false }
        assertTrue(deck(vm)!!.hardApplies)
        assertEquals("n1", passCardUi(deck(vm)!!, deck(vm)!!.note!!).noteId)
        assertEquals(2, passCardUi(deck(vm)!!, deck(vm)!!.note!!).angle)

        vm.answer(true, "typed", "right", hard = true)
        settle("n2's second angle", { vm.ui.value }) { deck(vm)?.showing?.noteId == "n2" && deck(vm)?.busy == false }
        assertEquals(1, deck(vm)!!.progress.done)
        vm.answer(false, "typed", "wrong", hard = true)
        settle("n2's second angle again", { vm.ui.value }) { deck(vm)?.showing == PassAngles.Showing("n2", CardTypes.MEANING_TO_HANZI, 2, true) && deck(vm)?.busy == false }
        vm.answer(true, "typed", "right", hard = true)
        settle("the finish", { vm.ui.value }) { deck(vm)?.progress?.complete == true }

        assertEquals(
            listOf("n1#hanzi_to_meaning" to "right", "n2#hanzi_to_meaning" to "right", "n1" to "right", "n2" to "wrong", "n2" to "right"),
            events().map { it.item_id to it.result },
        )
        runBlocking { assertEquals(0, app.repo.dao.allEvents().size) }
    }

    @Test
    fun offIsThePassAsBefore() {
        StudyPrefs.get(app).setPassHardMode("off")
        val vm = HomeworkPassViewModel(app, "a1")
        settle("n1", { vm.ui.value }) { deck(vm)?.showing?.noteId == "n1" && deck(vm)?.note?.cardTypes?.isNotEmpty() == true }
        assertEquals(false, deck(vm)!!.hardApplies)
        assertEquals(2, deck(vm)!!.bar.slots)
        vm.answer(true, "none", null, hard = false)
        settle("n2", { vm.ui.value }) { deck(vm)?.showing?.noteId == "n2" && deck(vm)?.busy == false }
        assertEquals(listOf("n1" to "right"), events().map { it.item_id to it.result })
        assertEquals(1, deck(vm)!!.progress.done)
    }

    /** Giving up (👁 Show answer before a right answer) locks Got it and suggests Not yet. */
    @Test
    fun aGiveUpLocksGotIt() {
        val answers = mutableListOf<List<Any?>>()
        compose.setContent {
            LabTheme {
                StudyScreen(
                    PassHardModeScreenshots.ui(), playingKey = null,
                    actions = StudyActions(onPassAnswer = { r, a, s, h -> answers += listOf(r, a, s, h) }),
                    cardStart = CardStartState(flipped = true, gaveUp = true), autoplay = false, pass = PassHardModeScreenshots.pass(),
                )
            }
        }
        compose.onNodeWithText(PassAngles.GAVE_UP_LINE).assertExists()
        compose.onNodeWithContentDescription("Hard mode in homework: All words").assertExists()
        compose.onNodeWithTag("hw-gotit").performClick()
        compose.waitForIdle()
        assertTrue("a locked Got it answers nothing", answers.isEmpty())
        compose.onNodeWithText(PassAngles.GAVE_UP_BLOCKED).assertExists()
        compose.onNodeWithTag("hw-notyet").performClick()
        compose.waitForIdle()
        assertEquals(listOf(listOf(false, "none", "wrong", true)), answers)
    }
}
