package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.CardQueue
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.NewCardOrder
import dev.jeromeswannack.chineselearning.lab.core.StudyBudget
import dev.jeromeswannack.chineselearning.lab.data.CardEntity
import dev.jeromeswannack.chineselearning.lab.data.DeckEntity
import dev.jeromeswannack.chineselearning.lab.data.NoteEntity
import dev.jeromeswannack.chineselearning.lab.data.study.StudyDayStore
import dev.jeromeswannack.chineselearning.lab.ui.home.TodayCounts
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.time.ZoneId
import kotlin.test.assertEquals

/**
 * "Words made of characters I know: start with English → Chinese" (core LeadCard): 学生 is new, but
 * 学 (大学) and 生 (生活) are known — mature cards — so the session opens it with its meaning_to_hanzi
 * card; with the switch off it opens with hanzi_to_meaning as before. Home's count is the same either way.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = LabApp::class)
class KnownCharactersLeadTest {
    private lateinit var app: LabApp
    private val now = System.currentTimeMillis()
    private val day = 86_400_000L

    @Before
    fun setUp() = runBlocking {
        app = ApplicationProvider.getApplicationContext()
        app.prefs.sessionToken = null
        app.prefs.budget = StudyBudget(1, 0)
        app.prefs.newCardOrder = NewCardOrder.DEFAULT
        StudyDayStore.forTest(app, ZoneId.systemDefault())
        val dao = app.repo.dao
        dao.upsertDecks(listOf(DeckEntity("d1", "HSK 1", null, 20, 20, 1, "2026-01-01T00:00:00.000Z")))
        fun note(id: String, hanzi: String, english: String) = NoteEntity(id, "d1", hanzi, "", english, null, null, "f", "s", null, null, null, null, null)
        dao.upsertNotes(listOf(note("k1", "大学", "university"), note("k2", "生活", "life"), note("w1", "学生", "student")))
        val known = { id: String, noteId: String, stability: Double ->
            CardEntity(
                id, noteId, "d1", CardTypes.HANZI_TO_MEANING,
                queue = CardQueue.REVIEW, stability = stability, difficulty = 5.0, scheduledDays = 40, reps = 6,
                nextReviewAt = Js.toIsoString(now + 30 * day), dueTimestamp = now + 30 * day, lastReviewedAt = Js.toIsoString(now - 10 * day),
            )
        }
        val fresh = listOf(CardTypes.HANZI_TO_MEANING, CardTypes.MEANING_TO_HANZI, CardTypes.AUDIO_TO_HANZI).map { CardEntity("w1-$it", "w1", "d1", it) }
        dao.insertCardsIfMissing(listOf(CardEntity("k1c", "k1", "d1", CardTypes.HANZI_TO_MEANING), CardEntity("k2c", "k2", "d1", CardTypes.HANZI_TO_MEANING)) + fresh)
        dao.upsertCards(listOf(known("k1c", "k1", 40.0), known("k2c", "k2", 30.0)))
    }

    @After
    fun tearDown() { app.prefs.newCardOrder = NewCardOrder.DEFAULT }

    private fun idle() = shadowOf(android.os.Looper.getMainLooper()).idle()

    private fun firstCard(): String {
        val vm = StudyViewModel(app, null)
        return dev.jeromeswannack.chineselearning.lab.testing.awaitOnMain(describe = { "no card: ${vm.ui.value.phase}" }) {
            (vm.ui.value.phase as? StudyPhase.Showing)?.view?.card?.id
        }
    }

    @Test
    fun aWordOfKnownCharactersStartsWithEnglishToChinese() {
        assertEquals("w1-${CardTypes.MEANING_TO_HANZI}", firstCard())
        assertEquals(1, runBlocking { TodayCounts.compute(app, now, ZoneId.systemDefault()) }.new)
    }

    @Test
    fun theSwitchOffKeepsHanziFirst() {
        app.prefs.newCardOrder = NewCardOrder.DEFAULT.copy(knownCharactersEnglishFirst = false)
        assertEquals("w1-${CardTypes.HANZI_TO_MEANING}", firstCard())
        assertEquals(1, runBlocking { TodayCounts.compute(app, now, ZoneId.systemDefault()) }.new)
    }
}
