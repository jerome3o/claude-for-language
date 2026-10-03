package dev.jeromeswannack.chineselearning.lab.ui.homework

import androidx.compose.runtime.getValue
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.HomeworkAssignment
import dev.jeromeswannack.chineselearning.lab.core.HomeworkEvent
import dev.jeromeswannack.chineselearning.lab.data.CardEntity
import dev.jeromeswannack.chineselearning.lab.data.DeckEntity
import dev.jeromeswannack.chineselearning.lab.data.NoteEntity
import dev.jeromeswannack.chineselearning.lab.data.homework.HomeworkKeys
import dev.jeromeswannack.chineselearning.lab.data.homework.LongTermStore
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.home.TodayCounts
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.ZoneId

/**
 * "Add to my long-term review" on the pass's answer side (docs/HOMEWORK.md §3a): in a one-off
 * pass the switch starts off; switching it on stores the choice on the note at once (the study
 * queue introduces the word, offline), queues `PUT /api/notes/:id/long-term`, and a sync that
 * rewrites the note keeps the choice until it is uploaded. Switching back stores null. A word
 * already reviewed shows "Already in your reviews" and can't be switched.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = LabScreenshotTest.PHONE, application = LabApp::class)
class LongTermToggleTest {
    @get:Rule val compose = createComposeRule()
    private lateinit var app: LabApp

    @Before
    fun setUp() = runBlocking {
        app = ApplicationProvider.getApplicationContext()
        app.prefs.sessionToken = null
        val dao = app.repo.dao
        // A one-off-only homework copy (caps 0 + 0).
        dao.upsertDecks(listOf(DeckEntity("d1", "Lesson vocab – 30 Sep", null, 0, 0, 1, "2026-09-30T00:00:00.000Z")))
        dao.upsertNotes(
            listOf(
                NoteEntity("n1", "d1", "互动", "hùdòng", "to interact", null, null, null, null, null, null, null, null, null),
                NoteEntity("n2", "d1", "课堂", "kètáng", "classroom", null, null, null, null, null, null, null, null, null),
            ),
        )
        dao.insertCardsIfMissing(listOf(CardEntity("c1", "n1", "d1", "hanzi_to_meaning"), CardEntity("c2", "n2", "d1", "hanzi_to_meaning", queue = 2)))
        app.cache.put(HomeworkKeys.ASSIGNMENTS, HomeworkKeys.KIND, listOf(HomeworkAssignment(id = "a1", kind = "deck", target_id = "d1", title = "Lesson vocab – 30 Sep", mode = "one_off", due_date = "2026-10-04", item_ids = listOf("n1", "n2"), item_count = 2)))
        app.cache.put(HomeworkKeys.EVENTS, HomeworkKeys.KIND, emptyList<HomeworkEvent>())
    }

    private fun settle(what: String, done: () -> Boolean) {
        val hangGuard = System.nanoTime() + 120_000_000_000L
        while (true) {
            compose.waitForIdle()
            org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle()
            if (done()) return
            check(System.nanoTime() < hangGuard) { "Still waiting for $what after 2 minutes" }
            Thread.sleep(5)
        }
    }

    private fun newInQueue(): List<String> = runBlocking {
        TodayCounts.allDecksQueue(app.repo.dao, app.prefs, System.currentTimeMillis(), ZoneId.systemDefault())!!.dueCards.filter { it.queue == 0 }.map { it.noteId }
    }

    @Test
    fun switchingAOneOffWordOnPutsItInTheQueueAndQueuesTheUpload() {
        val vm = HomeworkPassViewModel(app, "a1")
        compose.setContent {
            val ui by vm.ui.collectAsStateWithLifecycle()
            LabTheme { HomeworkPassScreen(ui, PassActions(onReveal = vm::reveal, onAnswer = vm::answer, onLongTerm = vm::setLongTerm)) }
        }
        settle("the first word") { (vm.ui.value as? PassUi.Deck)?.note?.id == "n1" }
        assertEquals(emptyList<String>(), newInQueue())

        compose.onNodeWithTag("hw-show").performClick()
        compose.onNodeWithText("Add to my long-term review").performScrollTo()
        compose.onNodeWithTag("hw-longterm").assertIsOff()
        compose.onNodeWithTag("hw-longterm").performClick()
        settle("the choice to land") { runBlocking { app.repo.dao.notes(listOf("n1")).single().longTerm } == 1 }
        compose.onNodeWithTag("hw-longterm").assertIsOn()
        compose.onNodeWithText("In my long-term review").assertExists()
        assertEquals(listOf("n1"), newInQueue())
        val queued = runBlocking { app.outbox.all() }.filter { it.kind == LongTermStore.OUTBOX_KIND }
        assertEquals(1, queued.size)
        assertEquals("PUT", queued[0].method)
        assertEquals("/api/notes/n1/long-term", queued[0].path)
        assertTrue(queued[0].bodyJson!!.contains("\"long_term\":1"))

        // A sync writing the server's (older) row: the pending choice is re-applied.
        runBlocking {
            val dao = app.repo.dao
            dao.upsertNotes(listOf(dao.notes(listOf("n1")).single().copy(longTerm = null)))
            LongTermStore.reapplyPending(dao, app.repo.platform.dao)
            assertEquals(1, dao.notes(listOf("n1")).single().longTerm)
        }

        // Back off = the deck's own default again: null, and out of the queue.
        compose.onNodeWithTag("hw-longterm").performClick()
        settle("the choice to clear") { runBlocking { app.repo.dao.notes(listOf("n1")).single().longTerm } == null && (vm.ui.value as PassUi.Deck).note?.longTerm == null }
        assertEquals(emptyList<String>(), newInQueue())
        assertTrue(runBlocking { app.outbox.all() }.last { it.kind == LongTermStore.OUTBOX_KIND }.bodyJson!!.contains("\"long_term\":null"))
    }

    @Test
    fun aStartedWordShowsAlreadyInReviewsAndCannotBeSwitched() {
        val vm = HomeworkPassViewModel(app, "a1")
        compose.setContent {
            val ui by vm.ui.collectAsStateWithLifecycle()
            LabTheme { HomeworkPassScreen(ui, PassActions(onReveal = vm::reveal, onAnswer = vm::answer, onLongTerm = vm::setLongTerm)) }
        }
        settle("the first word") { (vm.ui.value as? PassUi.Deck)?.note?.id == "n1" }
        compose.onNodeWithTag("hw-show").performClick()
        compose.onNodeWithTag("hw-gotit").performClick()
        settle("the second word") { (vm.ui.value as? PassUi.Deck)?.note?.id == "n2" }
        assertTrue((vm.ui.value as PassUi.Deck).note!!.started)
        compose.onNodeWithTag("hw-show").performClick()
        compose.onNodeWithText("✓ Already in your reviews").performScrollTo().assertExists()
        vm.setLongTerm(false)
        compose.waitForIdle()
        assertNull(runBlocking { app.repo.dao.notes(listOf("n2")).single().longTerm })
        assertFalse(runBlocking { app.outbox.all() }.any { it.kind == LongTermStore.OUTBOX_KIND })
    }
}
