package dev.jeromeswannack.chineselearning.lab.data.bumps

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.core.Bumps
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.StudyBudget
import dev.jeromeswannack.chineselearning.lab.core.StudyQueue
import dev.jeromeswannack.chineselearning.lab.data.CardEntity
import dev.jeromeswannack.chineselearning.lab.data.DeckEntity
import dev.jeromeswannack.chineselearning.lab.data.LabDatabase
import dev.jeromeswannack.chineselearning.lab.data.NoteEntity
import dev.jeromeswannack.chineselearning.lab.data.ReviewEventEntity
import dev.jeromeswannack.chineselearning.lab.data.StudyBumpEntity
import dev.jeromeswannack.chineselearning.lab.data.api.StudyBumpDto
import dev.jeromeswannack.chineselearning.lab.data.platform.Outbox
import dev.jeromeswannack.chineselearning.lab.data.platform.OutboxEntity
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.ZoneId

/**
 * "⚡ Study it today" on the phone (BumpStore): the server's full list replaces the synced rows,
 * a row whose Outbox item is still pending stays as made here, and the queue sees the bumps with
 * the review times from the local events.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class BumpStoreTest {
    private lateinit var db: LabDatabase
    private val dao get() = db.dao()

    @Before fun setUp() {
        db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), LabDatabase::class.java).allowMainThreadQueries().build()
    }

    @After fun tearDown() = db.close()

    private fun dto(note: String, at: String = "2026-10-04 08:00:00", by: String? = null) =
        StudyBumpDto("srv-$note", note, at, "coach", bumped_by_name = by, hanzi = "字")

    private suspend fun outbox(id: String, state: String = Outbox.PENDING) =
        db.platform().insertOutbox(OutboxEntity(id = id, kind = BumpStore.OUTBOX_ADD, method = "POST", path = "/api/me/bumps", bodyJson = "{}", filePath = null, fileField = null, fileName = null, fileMime = null, createdAt = 1, state = state))

    @Test fun serverListReplacesSyncedRowsAndKeepsPendingOnes() = runBlocking {
        dao.upsertStudyBumps(
            listOf(
                StudyBumpEntity("old", "srv-old", "2026-10-01 08:00:00", "coach"), // synced, gone from the server (done / cleared elsewhere)
                StudyBumpEntity("added", "c1", "2026-10-04T09:00:00.000Z", "reader", pending = BumpStore.PENDING_ADD, outboxId = "c1"), // not sent yet
                StudyBumpEntity("cleared", "srv-cleared", "2026-10-03 08:00:00", "coach", pending = BumpStore.PENDING_CLEAR, outboxId = "o-clear"), // removal not sent
                StudyBumpEntity("sent", "c2", "2026-10-04T07:00:00.000Z", "deck", pending = BumpStore.PENDING_ADD, outboxId = "c2"), // sent: follows the server
                StudyBumpEntity("refused", "c3", "2026-10-04T07:00:00.000Z", "deck", pending = BumpStore.PENDING_ADD, outboxId = "c3"), // refused for good
            ),
        )
        outbox("c1")
        outbox("o-clear")
        outbox("c3", Outbox.FAILED)

        BumpStore.replaceFromServer(db, db.platform(), listOf(dto("cleared"), dto("sent"), dto("tutor", by = "Minghui"), dto("added", at = "2026-10-02 08:00:00")))

        val rows = dao.studyBumps().associateBy { it.noteId }
        assertEquals(setOf("added", "cleared", "sent", "tutor"), rows.keys)
        assertEquals(BumpStore.PENDING_ADD, rows.getValue("added").pending) // the local add wins over the server's older row
        assertEquals("2026-10-04T09:00:00.000Z", rows.getValue("added").createdAt)
        assertEquals(BumpStore.PENDING_CLEAR, rows.getValue("cleared").pending) // still hidden
        assertNull(rows.getValue("sent").pending)
        assertEquals("srv-sent", rows.getValue("sent").id)
        assertEquals("Minghui", rows.getValue("tutor").bumpedByName)
        // The queue sees every active row except the pending clear.
        assertEquals(setOf("added", "sent", "tutor"), BumpStore.active(dao).map { it.noteId }.toSet())
    }

    @Test fun anEmptyServerListClearsSyncedRows() = runBlocking {
        dao.upsertStudyBumps(listOf(StudyBumpEntity("n1", "srv-1", "2026-10-01 08:00:00", "coach")))
        BumpStore.replaceFromServer(db, db.platform(), emptyList())
        assertEquals(emptyList<StudyBumpEntity>(), dao.studyBumps())
    }

    @Test fun queueBumpsFeedTheStudyQueueFromLocalEvents() = runBlocking {
        val zone = ZoneId.of("Europe/London")
        val now = Js.parseDate("2026-10-04T10:00:00.000Z")
        dao.upsertDecks(listOf(DeckEntity("d1", "HSK 3", null, 3, 6, 0, "2026-09-01 10:00:00")))
        dao.upsertNotes(listOf(note("n1", "银行"), note("n2", "苹果")))
        // n1 is brand new; the budget is spent (0 + 0) — a bump still brings all three cards.
        dao.upsertCards(listOf(CardEntity("a", "n1", "d1", CardTypes.HANZI_TO_MEANING), CardEntity("b", "n1", "d1", CardTypes.MEANING_TO_HANZI), CardEntity("c", "n1", "d1", CardTypes.AUDIO_TO_HANZI), CardEntity("x", "n2", "d1", CardTypes.HANZI_TO_MEANING)))
        dao.upsertStudyBumps(listOf(StudyBumpEntity("n1", "c1", "2026-10-04T09:00:00.000Z", "coach", pending = BumpStore.PENDING_ADD, outboxId = "c1")))
        val built = StudyQueue.build(dao.decks().map { it.toQueueDeck() }, dao.cards().map { it.toQueueCard() }, StudyBudget(0, 0), 0, emptyMap(), StudyQueue.cutoff(now, zone), null, bumps = BumpStore.queueBumps(dao))
        assertEquals(listOf("a", "b", "c"), built.bumped.map { it.id })
        assertEquals(listOf("a", "b", "c"), built.dueCards.map { it.id })

        // A review after the bump covers the card (its replayed state is not needed for that).
        dao.insertEvents(listOf(ReviewEventEntity("e1", "a", 2, "2026-10-04T09:30:00.000Z", 3000, null, synced = false)))
        val after = BumpStore.queueBumps(dao)!!
        assertEquals(Js.parseDate("2026-10-04T09:30:00.000Z"), after.lastReviewMs["a"])
        assertEquals(Js.parseDate("2026-10-04T09:00:00.000Z"), after.bumps.single().createdMs)
        assertEquals(setOf("n1"), BumpStore.openNoteIds(dao, now, zone))
    }

    @Test fun knownWordsUseTheBreakdownElseTheLongestLocalMatch() {
        val byKey = mapOf("商店" to "商店", "商" to "商", "苹果" to "苹果", "我" to "我")
        assertEquals(listOf("我", "商店", "苹果"), BumpStore.knownWordsIn(byKey, "我昨天去商店买了苹果。", emptyList()))
        assertEquals(listOf("苹果"), BumpStore.knownWordsIn(byKey, "我昨天去商店买了苹果。", listOf("昨天", "苹果", "买")))
        assertEquals(emptyList<String>(), BumpStore.knownWordsIn(emptyMap(), "你好", emptyList()))
    }

    @Test fun resultMessages() {
        assertEquals(Bumps.bumpedMessage(listOf("银行")), BumpStore.Result(listOf("银行"), emptyList(), 0).message)
        assertEquals("Already in today’s pocket ⚡", BumpStore.Result(emptyList(), listOf("银行"), 0).message)
        assertEquals("Not in your decks yet", BumpStore.Result(emptyList(), emptyList(), 1).message)
    }

    private fun note(id: String, hanzi: String) = NoteEntity(id, "d1", hanzi, "", "", null, null, null, null, null, null, null, null, null)
}
