package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.CardQueue
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.Rating
import dev.jeromeswannack.chineselearning.lab.core.StudyBudget
import dev.jeromeswannack.chineselearning.lab.data.CardEntity
import dev.jeromeswannack.chineselearning.lab.data.DeckEntity
import dev.jeromeswannack.chineselearning.lab.data.NoteEntity
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
import kotlin.test.assertTrue

/**
 * A REVIEW card whose stored row has stability 0 (a corrupt / legacy row — real state is replayed
 * from review events) used to throw while the session worked out its rating previews, so the study
 * screen never showed it. It must show, with real interval labels, and be ratable.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = LabApp::class)
class CorruptCardStateTest {
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
        dao.upsertNotes(listOf(NoteEntity("n0", "d1", "银行", "yínháng", "bank", null, null, "f", "s", null, null, null, null, null)))
        dao.insertCardsIfMissing(listOf(CardEntity("c0", "n0", "d1", "hanzi_to_meaning")))
        dao.upsertCards(
            listOf(
                CardEntity(
                    "c0", "n0", "d1", "hanzi_to_meaning",
                    queue = CardQueue.REVIEW, stability = 0.0, difficulty = 5.0, scheduledDays = 3, reps = 4,
                    nextReviewAt = Js.toIsoString(now - day), dueTimestamp = now - day, lastReviewedAt = Js.toIsoString(now - 4 * day),
                ),
            ),
        )
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

    @Test
    fun theCardShowsWithRealPreviewsAndCanBeRated() {
        val vm = StudyViewModel(app, null)
        val view = (awaitUi(vm, "the card") { it.phase is StudyPhase.Showing }.phase as StudyPhase.Showing).view
        assertEquals("c0", view.card.id)
        assertEquals(4, view.previews.size)
        assertTrue(view.previews.all { it.intervalDays.isFinite() && it.intervalDays > 0 }, "${view.previews}")
        vm.rate(Rating.GOOD, 2_000, null)
        awaitUi(vm, "rated") { it.phase !is StudyPhase.Showing || (it.phase as StudyPhase.Showing).view.presentation != view.presentation }
    }
}
