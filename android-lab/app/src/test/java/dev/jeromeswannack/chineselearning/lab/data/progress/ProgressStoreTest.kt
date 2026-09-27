package dev.jeromeswannack.chineselearning.lab.data.progress

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.data.CardEntity
import dev.jeromeswannack.chineselearning.lab.data.DeckEntity
import dev.jeromeswannack.chineselearning.lab.data.LabDatabase
import dev.jeromeswannack.chineselearning.lab.data.NoteEntity
import dev.jeromeswannack.chineselearning.lab.data.ReviewEventEntity
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.ZoneOffset

/** The Progress store reads the synced Room tables (its raw SQL must follow the schema). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class ProgressStoreTest {
    private lateinit var db: LabDatabase
    private val now = Js.parseDate("2026-09-27T10:00:00.000Z")

    @Before fun setUp() = runBlocking {
        db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), LabDatabase::class.java).allowMainThreadQueries().build()
        val dao = db.dao()
        dao.upsertDecks(listOf(DeckEntity("d1", "HSK 1", null, 3, 6, 0, "2026-01-01"), DeckEntity("d2", "Top", null, 3, 6, 5, "2026-01-02")))
        dao.upsertNotes(listOf(NoteEntity("n1", "d1", "猫", "māo", "cat", null, null, null, null, null, null, null, null, null)))
        dao.upsertCards(listOf(
            CardEntity("c1", "n1", "d1", "hanzi_to_meaning", queue = 2, stability = 30.0),
            CardEntity("c2", "n1", "d1", "audio_to_hanzi", queue = 0),
        ))
        dao.insertEvents(listOf(
            ReviewEventEntity("e1", "c1", 2, "2026-09-27T01:00:00.000Z", 3000, null, true),
            ReviewEventEntity("e2", "c1", 0, "2026-09-26T01:00:00.000Z", 5000, "狗", true),
            ReviewEventEntity("e3", "c2", 3, "2026-09-26T02:00:00.000Z", null, null, false),
            ReviewEventEntity("e4", "c1", 3, "2026-07-01T02:00:00.000Z", null, null, true), // outside 30 days
        ))
    }

    @After fun tearDown() = db.close()

    @Test fun snapshot() = runBlocking {
        val s = ProgressStore(db).snapshot(now, ZoneOffset.UTC)
        assertEquals(4, s.totalReviews)
        assertEquals(listOf("2026-09-27", "2026-09-26"), s.daily.days.map { it.date })
        assertEquals(3, s.daily.summary.totalReviews30d)
        assertEquals(2, s.streak.streak)
        assertEquals(1, s.overall.counts.mastered)
        assertEquals(listOf("d2", "d1"), s.decks.map { it.id }) // queue order: priority first
        assertEquals(50, s.decks[1].completion.percentMastered)
    }

    @Test fun dayAndCard() = runBlocking {
        val store = ProgressStore(db)
        val day = store.day("2026-09-26")
        assertEquals(listOf("c1", "c2"), day.cards.map { it.card.cardId })
        assertEquals(true, day.cards[0].hasAnswers)
        val card = store.cardDay("2026-09-26", "c1")!!
        assertEquals(listOf("e2"), card.reviews.map { it.id })
        assertNull(store.cardDay("2026-09-26", "missing"))
    }
}
