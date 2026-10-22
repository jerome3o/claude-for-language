package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.OtherCardTypes
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
import kotlin.test.assertTrue

/**
 * ⋯ → "Practise this word other ways…" in the Lab session (web useStudySession.otherCards.test.tsx):
 * the sheet lists the note's card types with their state (the new sibling ticked), Add makes a
 * card-level ⚡ bump, and the sibling joins THIS session over a spent budget — a few cards later,
 * never straight after its sibling — then leaves the pocket once rated.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = LabApp::class)
class OtherCardTypesSessionTest {
    private lateinit var app: LabApp
    private val now = System.currentTimeMillis()
    private val day = 86_400_000L
    private val words = listOf("一", "二", "三", "四", "五", "六")

    @Before
    fun setUp() = runBlocking {
        app = ApplicationProvider.getApplicationContext()
        app.prefs.sessionToken = null
        app.prefs.budget = StudyBudget(0, 0) // the budget is spent: new cards only through the ⚡ pocket
        StudyDayStore.forTest(app, ZoneId.systemDefault())
        val dao = app.repo.dao
        dao.upsertDecks(listOf(DeckEntity("d1", "HSK 3", null, 20, 20, 1, "2026-01-01T00:00:00.000Z")))
        dao.upsertNotes(words.mapIndexed { i, h -> NoteEntity("n$i", "d1", h, "yī", "one", null, null, "f", "s", null, null, null, null, null) })
        val read = words.indices.map { CardEntity("c$it", "n$it", "d1", CardTypes.HANZI_TO_MEANING) }
        val siblings = words.indices.map { CardEntity("m$it", "n$it", "d1", CardTypes.MEANING_TO_HANZI) }
        dao.insertCardsIfMissing(read + siblings)
        // Each read card reviewed once long ago → due now; the English → 汉字 siblings are new.
        val events = read.map { ReviewEventEntity("e-${it.id}", it.id, Rating.GOOD, Js.toIsoString(now - 40 * day), 1000, null, synced = true) }
        dao.insertEvents(events)
        dao.upsertCards(read.map { c -> c.withState(CardScheduler.computeCardState(events.filter { it.cardId == c.id }.map { ReviewEventInput(it.id, it.cardId, it.rating, it.reviewedAt) })) })
    }

    private fun idle() = shadowOf(android.os.Looper.getMainLooper()).idle()

    private fun awaitUi(vm: StudyViewModel, what: String, ok: (StudyUi) -> Boolean): StudyUi {
        repeat(300) {
            idle()
            val u = vm.ui.value
            if (ok(u)) return u
            Thread.sleep(10)
        }
        error("timed out waiting for $what: ${vm.ui.value.phase} ${vm.ui.value.extras.otherCards}")
    }

    private fun showing(vm: StudyViewModel) = (awaitUi(vm, "a card") { it.phase is StudyPhase.Showing }.phase as StudyPhase.Showing).view

    @Test
    fun theAddedSiblingJoinsTheSessionAFewCardsLaterAndLeavesOnceRated() {
        val vm = StudyViewModel(app, null)
        val first = showing(vm)
        assertEquals(0, vm.ui.value.counts.new + vm.ui.value.counts.secondaryNew)
        awaitUi(vm, "the ⋯ item") { it.extras.hasOtherCardTypes }
        val sibling = "m" + first.card.id.removePrefix("c")

        vm.openOtherCards()
        val sheet = awaitUi(vm, "the rows") { it.extras.otherCards?.loading == false }.extras.otherCards!!
        assertEquals(listOf("this card", "new"), sheet.rows.map { it.status })
        assertEquals(listOf(null, OtherCardTypes.ACTION_ADD), sheet.rows.map { it.action })
        assertEquals(setOf(sibling), sheet.picked)

        vm.addOtherCards()
        val done = awaitUi(vm, "added") { it.extras.otherCards?.done != null }
        assertEquals("⚡ English → 汉字 comes up in a few cards", done.extras.otherCards!!.done)
        assertEquals(1, done.counts.new + done.counts.secondaryNew)
        val bump = runBlocking { BumpStore.active(app.repo.dao) }.single()
        assertEquals(first.note.id, bump.noteId)
        assertEquals(listOf(CardTypes.MEANING_TO_HANZI), BumpStore.parseCardTypes(bump.cardTypes))
        vm.closeOtherCards()

        val shown = mutableListOf(first.card.id)
        var current = first
        while (shown.last() != sibling && shown.size < 10) {
            vm.rate(Rating.GOOD, 2_000, null)
            val next = awaitUi(vm, "next") { u -> (u.phase as? StudyPhase.Showing)?.view?.presentation != current.presentation || u.phase is StudyPhase.Done }
            current = (next.phase as? StudyPhase.Showing)?.view ?: break
            shown += current.card.id
        }
        val at = shown.indexOf(sibling)
        assertTrue(at > 3, "the sibling came at $at: $shown")
        assertTrue(current.bumped, "the ⚡ chip shows on it")
        assertEquals(listOf(sibling), shown.filter { it.startsWith("m") }) // no other new card got in

        vm.rate(Rating.GOOD, 2_000, null)
        awaitUi(vm, "rated") { u -> (u.phase as? StudyPhase.Showing)?.view?.presentation != current.presentation }
        // Reviewed since the bump: the pocket is empty, the bump done.
        val open = runBlocking { BumpStore.openNoteIds(app.repo.dao) }
        assertTrue(first.note.id !in open)
    }
}
