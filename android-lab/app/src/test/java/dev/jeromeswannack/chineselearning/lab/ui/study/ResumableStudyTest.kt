package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.Rating
import dev.jeromeswannack.chineselearning.lab.core.ReviewEventInput
import dev.jeromeswannack.chineselearning.lab.core.StudyBudget
import dev.jeromeswannack.chineselearning.lab.core.StudyResume
import dev.jeromeswannack.chineselearning.lab.data.CardEntity
import dev.jeromeswannack.chineselearning.lab.data.DeckEntity
import dev.jeromeswannack.chineselearning.lab.data.NoteEntity
import dev.jeromeswannack.chineselearning.lab.data.ReviewEventEntity
import dev.jeromeswannack.chineselearning.lab.data.study.StudyDayStore
import kotlinx.coroutines.runBlocking
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.time.ZoneId
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Today is the session (docs/STUDY_SESSION.md): leaving Study and coming back shows the same
 * card as it was left (revealed, answer), from memory or — after a process death — from the
 * saved resume point; rating it clears the point; emptying the queue is celebrated once.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = LabApp::class)
class ResumableStudyTest {
    private lateinit var app: LabApp
    private val now = System.currentTimeMillis()
    private val day = 86_400_000L

    @Before
    fun setUp() = runBlocking {
        app = ApplicationProvider.getApplicationContext()
        app.prefs.sessionToken = null
        app.prefs.budget = StudyBudget(0, 0)
        StudyDayStore.forTest(app, ZoneId.systemDefault())
        val dao = app.repo.dao
        dao.upsertDecks(listOf(DeckEntity("d1", "HSK 3", null, 20, 20, 1, "2026-01-01T00:00:00.000Z")))
        val words = listOf("一", "二", "三")
        dao.upsertNotes(words.mapIndexed { i, h -> NoteEntity("n$i", "d1", h, "yī", "one", null, null, "f", "s", null, null, null, null, null) })
        val cards = words.indices.map { CardEntity("c$it", "n$it", "d1", "meaning_to_hanzi") }
        dao.insertCardsIfMissing(cards)
        // Each card reviewed once long ago → due now.
        val events = cards.map { ReviewEventEntity("e-${it.id}", it.id, Rating.GOOD, Js.toIsoString(now - 40 * day), 1000, null, synced = true) }
        dao.insertEvents(events)
        dao.upsertCards(cards.map { c -> c.withState(CardScheduler.computeCardState(events.filter { it.cardId == c.id }.map { ReviewEventInput(it.id, it.cardId, it.rating, it.reviewedAt) })) })
    }

    private fun idle() = shadowOf(android.os.Looper.getMainLooper()).idle()

    private fun awaitUi(vm: StudyViewModel, what: String, ok: (StudyUi) -> Boolean): StudyUi {
        repeat(200) {
            idle()
            val u = vm.ui.value
            if (ok(u)) return u
            Thread.sleep(10)
        }
        error("timed out waiting for $what: ${vm.ui.value.phase}")
    }

    private fun showing(vm: StudyViewModel) = (awaitUi(vm, "a card") { it.phase is StudyPhase.Showing }.phase as StudyPhase.Showing).view

    @Test
    fun theCardLeftOnScreenComesBackRevealedWithItsAnswer() {
        val store = StudyDayStore.get(app)
        store.saveResumePoint(StudyResume.Point(store.today(), "all", "c2", revealed = true, answer = "三", elapsedMs = 8_000))
        // A new process: the point is all there is.
        val vm = StudyViewModel(app, null)
        val v = showing(vm)
        assertEquals("c2", v.card.id)
        assertTrue(v.start.flipped)
        assertEquals("三", v.start.answer)
        assertTrue(v.start.elapsedMs >= 8_000)
    }

    @Test
    fun leavingAndComingBackKeepsTheCardAsItStood() {
        val vm = StudyViewModel(app, null)
        val first = showing(vm)
        vm.onCardProgress(first.presentation, revealed = true, answer = "二", mcSlots = null)
        vm.onLeave() // ✕ or the coach: nothing ends
        val point = assertNotNull(StudyDayStore.get(app).resumePoint())
        assertEquals(first.card.id, point.cardId)
        assertTrue(point.revealed)
        vm.onReturn()
        val back = awaitUi(vm, "the same card, revealed") { u -> (u.phase as? StudyPhase.Showing)?.view?.start?.flipped == true }
        val view = (back.phase as StudyPhase.Showing).view
        assertEquals(first.presentation, view.presentation) // not re-dealt
        assertEquals("二", view.start.answer)
    }

    @Test
    fun ratingClearsThePointAndTheFinishIsCelebratedOnce() {
        val vm = StudyViewModel(app, null)
        repeat(3) {
            val v = showing(vm)
            vm.rate(Rating.GOOD, 2_000, null)
            awaitUi(vm, "next") { u -> (u.phase as? StudyPhase.Showing)?.view?.presentation != v.presentation }
            val point = StudyDayStore.get(app).resumePoint()
            if (point != null) assertTrue(point.cardId != v.card.id)
        }
        val done = awaitUi(vm, "today's numbers") { it.phase is StudyPhase.Done && it.today != null }
        assertIs<StudyPhase.Done>(done.phase)
        assertEquals(3, done.today!!.reviews)
        assertTrue(done.today!!.celebrate)
        assertNull(StudyDayStore.get(app).resumePoint())

        // Back to Study later that day with nothing new due: quiet.
        val again = StudyViewModel(app, null)
        val quiet = awaitUi(again, "today's numbers") { it.phase is StudyPhase.Done && it.today != null }
        assertEquals(false, quiet.today!!.celebrate)
        assertEquals(3, quiet.today!!.reviews)
    }
}
