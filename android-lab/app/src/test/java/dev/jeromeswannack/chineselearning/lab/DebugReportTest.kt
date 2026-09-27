package dev.jeromeswannack.chineselearning.lab

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.core.CardQueue
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.ReviewEventInput
import dev.jeromeswannack.chineselearning.lab.core.StudyQueue
import dev.jeromeswannack.chineselearning.lab.data.CardEntity
import dev.jeromeswannack.chineselearning.lab.data.DebugReportBuilder
import dev.jeromeswannack.chineselearning.lab.data.DeckEntity
import dev.jeromeswannack.chineselearning.lab.data.LabDatabase
import dev.jeromeswannack.chineselearning.lab.data.NoteEntity
import dev.jeromeswannack.chineselearning.lab.data.Prefs
import dev.jeromeswannack.chineselearning.lab.data.ReviewEventEntity
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.longOrNull
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.ZoneId
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** data/DebugReport.kt builds the shared/debug/report.ts shape from Room with the home screen's numbers. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class DebugReportTest {
    private val zone = ZoneId.of("Europe/London")
    private val now = Js.parseDate("2026-09-27T10:00:00.000Z")
    private val day = 24 * 60 * 60 * 1000L
    private lateinit var db: LabDatabase
    private lateinit var prefs: Prefs

    @Before
    fun setUp() {
        val ctx = ApplicationProvider.getApplicationContext<android.app.Application>()
        db = Room.inMemoryDatabaseBuilder(ctx, LabDatabase::class.java).allowMainThreadQueries().build()
        prefs = Prefs(ctx).apply { clearAccount() }
    }

    @After
    fun tearDown() = db.close()

    /** EVENT_HASH_VECTORS in shared/debug/report.ts — the TS test checks the same list. */
    @Test
    fun eventIdHashMatchesTheTypeScriptVectors() {
        val vectors = listOf(
            "" to "811c9dc5",
            "a" to "e40c292c",
            "foobar" to "bf9cf968",
            "3f2b8c1e-9d4a-4e6b-8f0a-1c2d3e4f5a6b" to "d04aef6b",
            "学习" to "cb323bfb",
        )
        for ((input, hash) in vectors) assertEquals(hash, DebugReportBuilder.eventIdHash(input), "hash of '$input'")
    }

    private fun note(id: String, deck: String) = NoteEntity(id, deck, "学习", "xuéxí", "to study", null, null, null, null, null, null, null, null, null)

    private suspend fun seed() {
        val dao = db.dao()
        dao.upsertDecks(listOf(
            DeckEntity("d1", "HSK 3", null, 3, 6, 1, "2026-01-01T00:00:00.000Z"),
            DeckEntity("d2", "Homework", null, 3, null, 0, "2026-02-01T00:00:00.000Z"),
        ))
        dao.upsertNotes(listOf(note("n1", "d1"), note("n2", "d1"), note("n3", "d2")))
        val cards = listOf(
            CardEntity("n1-h", "n1", "d1", "hanzi_to_meaning"),
            CardEntity("n1-m", "n1", "d1", "meaning_to_hanzi"),
            CardEntity("n2-h", "n2", "d1", "hanzi_to_meaning"),
            CardEntity("n3-h", "n3", "d2", "hanzi_to_meaning"),
            CardEntity("n3-m", "n3", "d2", "meaning_to_hanzi"),
        )
        dao.insertCardsIfMissing(cards)
        val events = listOf(
            ReviewEventEntity("e1", "n1-h", 2, Js.toIsoString(now - 10 * day), 1000, null, synced = true),
            ReviewEventEntity("e2", "n1-h", 2, Js.toIsoString(now - 10 * day + 11 * 60_000), 1000, null, synced = true),
            // Introduced today (first review after local midnight).
            ReviewEventEntity("e3", "n3-h", 0, Js.toIsoString(now - 30 * 60_000), 1000, null, synced = false),
            ReviewEventEntity("e4", "gone-card", 2, Js.toIsoString(now - 3 * day), 1000, null, synced = true),
        )
        dao.insertEvents(events)
        val byCard = events.groupBy { it.cardId }
        dao.upsertCards(cards.map { c ->
            c.withState(CardScheduler.computeCardState(byCard[c.id].orEmpty().map { ReviewEventInput(it.id, it.cardId, it.rating, it.reviewedAt) }))
        })
    }

    private fun JsonObject.obj(k: String) = this[k]!!.jsonObject
    private fun JsonObject.int(k: String) = this[k]!!.jsonPrimitive.int

    @Test
    fun buildsTheReportWithTheHomeScreenNumbers() = runBlocking {
        seed()
        val r = DebugReportBuilder.build(db, prefs, "0.9-test", now, zone)
        assertEquals("lab", r["client"]!!.jsonPrimitive.content)
        assertEquals("2026-09-27", r.obj("day_start")["local_date"]!!.jsonPrimitive.content)
        assertEquals(60, r.obj("timezone").int("offset_minutes"))

        val totals = r.obj("totals")
        assertEquals(2, totals.int("decks")); assertEquals(3, totals.int("notes")); assertEquals(5, totals.int("cards"))
        assertEquals(4, totals.int("events")); assertEquals(1, totals.int("unsynced_events")); assertEquals(1, totals.int("orphan_events"))

        // Recompute what HomeViewModel.load shows, independently.
        val dao = db.dao()
        val cards = dao.cards().map { it.toQueueCard() }
        val first = dao.firstReviews().associate { it.cardId to Js.parseDate(it.firstAt) }
        val introduced = StudyQueue.introducedToday(cards, first, StudyQueue.startOfDay(now, zone))
        val built = StudyQueue.build(dao.decks().map { it.toQueueDeck() }, cards, prefs.budget, 0, introduced, StudyQueue.cutoff(now, zone), null)
        val counts = StudyQueue.counts(built.dueCards, built.reviewedNoteIds)
        val home = r.obj("home")
        assertEquals(counts.total, home.int("total"))
        assertEquals(counts.new, home.obj("counts").int("new"))
        assertEquals(counts.secondaryNew, home.obj("counts").int("secondaryNew"))
        assertEquals(counts.learning, home.obj("counts").int("learning"))
        assertEquals(counts.review, home.obj("counts").int("review"))
        assertEquals(built.dueCards.size, r.obj("queue").int("due_cards"))

        // Card rows: in_due_queue is exactly the built queue; NEW cards have no due time.
        val rows = r["cards"]!!.jsonArray.map { it.jsonArray }
        assertEquals(5, rows.size)
        val flagged = rows.filter { it[9].jsonPrimitive.int == 1 }.map { it[0].jsonPrimitive.content }.toSet()
        assertEquals(built.dueCards.map { it.id }.toSet(), flagged)
        val n1h = rows.first { it[0].jsonPrimitive.content == "n1-h" }
        assertEquals(CardQueue.REVIEW, n1h[4].jsonPrimitive.int)
        assertEquals(2, n1h[8].jsonPrimitive.int)
        assertEquals(now - 10 * day, n1h[10].jsonPrimitive.long)
        assertNull(rows.first { it[0].jsonPrimitive.content == "n2-h" }[5].jsonPrimitive.longOrNull)

        // Decks: introduced today, caps (secondary falls back to 10), pools with the web's definitions.
        val decks = r["decks"]!!.jsonArray.map { it.jsonObject }.associateBy { it["id"]!!.jsonPrimitive.content }
        val d2 = decks.getValue("d2")
        assertEquals(1, d2.obj("introduced_today").int("primary"))
        assertEquals(10, d2.obj("caps").int("secondary"))
        assertEquals(1, d2.obj("pools").int("learning"))
        assertEquals(1, d2.obj("pools").int("totalSecondaryNew"))
        val d1 = decks.getValue("d1")
        val cutoff = StudyQueue.cutoff(now, zone).ts
        val reviewDue = cards.count { it.deckId == "d1" && it.queue == CardQueue.REVIEW && (it.state.dueTimestamp ?: 0) <= cutoff }
        assertEquals(reviewDue, d1.obj("pools").int("review"))
        assertEquals(1, d1.obj("pools").int("totalNew"))
        assertEquals(2, d1.int("note_count")); assertEquals(3, d1.int("card_count"))

        val hashes = r["event_hashes"]!!.jsonArray.map { it.jsonPrimitive.content }
        assertEquals(listOf("e1", "e2", "e3", "e4").map(DebugReportBuilder::eventIdHash).sorted(), hashes)
        assertTrue(DebugReportBuilder.describe(r).contains("5 cards"))
    }
}
