package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.Rating
import dev.jeromeswannack.chineselearning.lab.core.ReviewEventInput
import dev.jeromeswannack.chineselearning.lab.core.StudyBudget
import dev.jeromeswannack.chineselearning.lab.data.CardEntity
import dev.jeromeswannack.chineselearning.lab.data.DeckEntity
import dev.jeromeswannack.chineselearning.lab.data.NoteEntity
import dev.jeromeswannack.chineselearning.lab.data.ReviewEventEntity
import dev.jeromeswannack.chineselearning.lab.data.bumps.BumpStore
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

/**
 * "⚡ Study it today" during a Lab session (core BumpNext; web useStudySession.bumpNext.test.tsx): a NEW word
 * bumped while a card is on screen — the sentence breakdown → explorer → "+ Add as card" → ⚡ — never replaces it,
 * and its listening card ("Start new words by ear") is the very next card once it is rated; several words come
 * next in the order bumped.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = LabApp::class)
class BumpNextSessionTest {
    private lateinit var app: LabApp
    private val now = System.currentTimeMillis()
    private val day = 86_400_000L
    private val words = listOf("一", "二", "三", "四", "五", "六")

    @Before
    fun setUp() = runBlocking {
        app = ApplicationProvider.getApplicationContext()
        app.prefs.sessionToken = null
        app.prefs.budget = StudyBudget(0, 0) // the budget is spent: new cards only through the ⚡ pocket
        app.prefs.newCardOrder = app.prefs.newCardOrder.copy(newWordsByEar = true)
        StudyDayStore.forTest(app, ZoneId.systemDefault())
        val dao = app.repo.dao
        dao.upsertDecks(listOf(DeckEntity("d1", "HSK 3", null, 20, 20, 1, "2026-01-01T00:00:00.000Z")))
        dao.upsertNotes(words.mapIndexed { i, h -> NoteEntity("n$i", "d1", h, "yī", "one", null, null, "f", "s", null, null, null, null, null) })
        val read = words.indices.map { CardEntity("c$it", "n$it", "d1", CardTypes.HANZI_TO_MEANING) }
        dao.insertCardsIfMissing(read)
        val events = read.map { ReviewEventEntity("e-${it.id}", it.id, Rating.GOOD, Js.toIsoString(now - 40 * day), 1000, null, synced = true) }
        dao.insertEvents(events)
        dao.upsertCards(read.map { c -> c.withState(CardScheduler.computeCardState(events.filter { it.cardId == c.id }.map { ReviewEventInput(it.id, it.cardId, it.rating, it.reviewedAt) })) })
        // Two words just added (no clip yet): three NEW cards each.
        for ((id, hanzi) in listOf("w1" to "右侧", "w2" to "左边")) {
            dao.upsertNotes(listOf(NoteEntity("n-$id", "d1", hanzi, "", "", null, null, null, null, null, null, null, null, null)))
            dao.insertCardsIfMissing(
                listOf(
                    CardEntity("$id-h", "n-$id", "d1", CardTypes.HANZI_TO_MEANING),
                    CardEntity("$id-m", "n-$id", "d1", CardTypes.MEANING_TO_HANZI),
                    CardEntity("$id-a", "n-$id", "d1", CardTypes.AUDIO_TO_HANZI),
                ),
            )
        }
    }

    private fun idle() = shadowOf(android.os.Looper.getMainLooper()).idle()

    private fun awaitUi(vm: StudyViewModel, what: String, ok: (StudyUi) -> Boolean): StudyUi {
        repeat(300) {
            idle()
            val u = vm.ui.value
            if (ok(u)) return u
            Thread.sleep(10)
        }
        error("timed out waiting for $what: ${vm.ui.value.phase}")
    }

    private fun showing(vm: StudyViewModel) = (awaitUi(vm, "a card") { it.phase is StudyPhase.Showing }.phase as StudyPhase.Showing).view

    private fun rateAndNext(vm: StudyViewModel, current: Int): String {
        vm.rate(Rating.GOOD, 2_000, null)
        val next = awaitUi(vm, "next") { u -> (u.phase as? StudyPhase.Showing)?.view?.presentation != current }
        return (next.phase as StudyPhase.Showing).view.card.id
    }

    @Test
    fun aNewWordBumpedMidSessionIsTheVeryNextCardInTheOrderBumped() {
        val vm = StudyViewModel(app, null)
        val first = showing(vm)
        runBlocking {
            BumpStore.bumpNotes(app, listOf("n-w2"), "explorer")
            Thread.sleep(5)
            BumpStore.bumpNotes(app, listOf("n-w1"), "ask_claude")
        }
        // Both joined the session (the counts grow) — the card on screen stays.
        awaitUi(vm, "bumps in the session") { it.counts.new + it.counts.secondaryNew == 2 }
        assertEquals(first.card.id, showing(vm).card.id)
        val second = rateAndNext(vm, first.presentation)
        assertEquals("w2-a", second)
        val third = rateAndNext(vm, showing(vm).presentation)
        assertEquals("w1-a", third)
    }
}
