package dev.jeromeswannack.chineselearning.lab.ui.teaching

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.core.CardQueue
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.QueueDeck
import dev.jeromeswannack.chineselearning.lab.core.StudyBudget
import dev.jeromeswannack.chineselearning.lab.core.StudyQueue
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.CardEntity
import dev.jeromeswannack.chineselearning.lab.data.LabDatabase
import dev.jeromeswannack.chineselearning.lab.data.Prefs
import dev.jeromeswannack.chineselearning.lab.data.ReviewEventEntity
import dev.jeromeswannack.chineselearning.lab.data.TodaysBudget
import dev.jeromeswannack.chineselearning.lab.data.api.PauseChange
import dev.jeromeswannack.chineselearning.lab.data.api.StudentOverviewDto
import dev.jeromeswannack.chineselearning.lab.data.api.StudyBudgetInfoDto
import dev.jeromeswannack.chineselearning.lab.data.api.saveOwnStudyBudget
import dev.jeromeswannack.chineselearning.lab.data.api.saveStudentStudyBudget
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.time.ZoneId

/**
 * "Pause new cards on heavy days" in the Lab app: the API bodies, the cached limit, the
 * overview / info DTOs, and TodaysBudget over a real Room store (load counts the cards
 * reviewed today, a paused day gives 0 new cards, the reviews stay).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class ReviewLoadLogicTest {
    private val json = Json { ignoreUnknownKeys = true }
    private val info = """{"new_cards_per_day":3,"secondary_cards_per_day":6,"is_default":true,"set_by_id":"t1","set_by_name":"Minghui Wang","set_by_tutor":true,"set_at":"2026-10-21T08:00:00.000Z","pause_new_when_reviews_over":100}"""

    @Test fun bodiesCarryThePauseOnlyWhenItChanged() = runBlocking {
        val server = MockWebServer().apply { start() }
        val api = Api(server.url("").toString().removeSuffix("/")) { "t" }
        server.enqueue(MockResponse().setBody("""{"budget":$info,"changed":true,"message_sent":false}"""))
        val saved = api.saveStudentStudyBudget("rel1", 3, 6, PauseChange(100))
        assertEquals(100, saved.budget.toInfo().pauseNewWhenReviewsOver)
        assertEquals("""{"new_cards_per_day":3,"secondary_cards_per_day":6,"pause_new_when_reviews_over":100}""", server.takeRequest().body.readUtf8())

        server.enqueue(MockResponse().setBody(info))
        api.saveOwnStudyBudget(3, 6, PauseChange(null))
        assertEquals("""{"new_cards_per_day":3,"secondary_cards_per_day":6,"pause_new_when_reviews_over":null}""", server.takeRequest().body.readUtf8())

        server.enqueue(MockResponse().setBody(info))
        api.saveOwnStudyBudget(3, 6, PauseChange(150), numbers = false)
        assertEquals("""{"pause_new_when_reviews_over":150}""", server.takeRequest().body.readUtf8())

        server.enqueue(MockResponse().setBody(info))
        api.saveOwnStudyBudget(3, 6)
        assertEquals("""{"new_cards_per_day":3,"secondary_cards_per_day":6}""", server.takeRequest().body.readUtf8())
        server.shutdown()
    }

    @Test fun prefsKeepTheLimitAndTheOverviewCarriesTodaysState() {
        val prefs = Prefs(RuntimeEnvironment.getApplication())
        val dto = json.decodeFromString(StudyBudgetInfoDto.serializer(), info)
        prefs.budgetInfo = dto.toInfo()
        assertEquals(100, prefs.reviewLoadCap)
        assertEquals(100, prefs.budgetInfo.pauseNewWhenReviewsOver)
        prefs.budgetInfo = dto.toInfo().copy(pauseNewWhenReviewsOver = null)
        assertNull(prefs.reviewLoadCap)

        val ov = json.decodeFromString(StudentOverviewDto.serializer(), """{"relationship_id":"r","student":{"id":"s"},"review_load":{"load":124,"threshold":100,"paused":true}}""")
        assertEquals("⏸ New cards paused today · 124 reviews due", pausedChip(ov.review_load))
        assertNull(pausedChip(null))
        assertNull(pausedChip(json.decodeFromString(StudentOverviewDto.serializer(), """{"relationship_id":"r","student":{"id":"s"},"review_load":{"load":80,"threshold":100,"paused":false}}""").review_load))
    }

    @Test fun todaysBudgetOverTheLocalStore() = runBlocking {
        val db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), LabDatabase::class.java).allowMainThreadQueries().build()
        try {
            val dao = db.dao()
            val zone = ZoneId.of("Europe/London")
            val now = Js.parseDate("2026-10-21T09:00:00.000Z")
            val dueMs = now - 3_600_000L
            val later = now + 5 * 86_400_000L
            val cards = buildList {
                for (i in 0 until 8) add(CardEntity("due-$i", "n-due-$i", "reviews", "hanzi_to_meaning", queue = CardQueue.REVIEW, stability = 20.0, reps = 3, dueTimestamp = dueMs))
                for (i in 0 until 4) add(CardEntity("done-$i", "n-done-$i", "reviews", "hanzi_to_meaning", queue = CardQueue.REVIEW, stability = 20.0, reps = 4, dueTimestamp = later))
                add(CardEntity("today-new", "n-today", "words", "hanzi_to_meaning", queue = CardQueue.LEARNING, dueTimestamp = now + 600_000L))
                for (i in 0 until 5) add(CardEntity("new-$i", "n-new-$i", "words", "hanzi_to_meaning"))
            }
            dao.upsertCards(cards)
            val events = buildList {
                for (i in 0 until 4) {
                    add(ReviewEventEntity("old-$i", "done-$i", 2, "2026-09-21T09:00:00.000Z", null, null, true))
                    add(ReviewEventEntity("now-$i", "done-$i", 2, "2026-10-21T08:30:00.000Z", null, null, true))
                }
                add(ReviewEventEntity("intro", "today-new", 2, "2026-10-21T08:40:00.000Z", null, null, true))
            }
            dao.insertEvents(events)
            val queueCards = dao.cards().map { it.toQueueCard() }
            val first = dao.firstReviews().associate { it.cardId to Js.parseDate(it.firstAt) }

            // 8 due + 4 done today = 12; the card introduced today is not a review.
            val paused = TodaysBudget.of(dao, StudyBudget(3, 6), 10, queueCards, first, now, zone)
            assertEquals(12, paused.reviewLoad.load)
            assertTrue(paused.reviewLoad.paused)
            assertEquals(StudyBudget(0, 0), paused.budget)

            val decks = listOf(QueueDeck("reviews", 5, "2026-10-01", 3, 6), QueueDeck("words", 0, "2026-10-02", 3, 6))
            val introduced = StudyQueue.introducedToday(queueCards, first, StudyQueue.startOfDay(now, zone))
            val q = StudyQueue.build(decks, queueCards, paused.budget, 0, introduced, StudyQueue.cutoff(now, zone), null)
            assertEquals(0, q.dueCards.count { it.queue == CardQueue.NEW })
            assertEquals(8, q.dueCards.count { it.queue == CardQueue.REVIEW })
            assertTrue(q.dueCards.any { it.id == "today-new" }) // its learning steps go on
            assertTrue(q.hasMoreNew)

            val atLimit = TodaysBudget.of(dao, StudyBudget(3, 6), 12, queueCards, first, now, zone)
            assertFalse(atLimit.reviewLoad.paused)
            assertEquals(StudyBudget(3, 6), atLimit.budget)
            assertEquals(StudyBudget(3, 6), TodaysBudget.of(dao, StudyBudget(3, 6), null, queueCards, first, now, zone).budget)
        } finally {
            db.close()
        }
    }
}
