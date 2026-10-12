package dev.jeromeswannack.chineselearning.lab.data.upnext

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.StudyBudget
import dev.jeromeswannack.chineselearning.lab.core.StudyQueue
import dev.jeromeswannack.chineselearning.lab.data.CardEntity
import dev.jeromeswannack.chineselearning.lab.data.DeckEntity
import dev.jeromeswannack.chineselearning.lab.data.LabDatabase
import dev.jeromeswannack.chineselearning.lab.data.NoteEntity
import dev.jeromeswannack.chineselearning.lab.data.UpNextEntity
import dev.jeromeswannack.chineselearning.lab.data.api.UpNextDto
import dev.jeromeswannack.chineselearning.lab.data.platform.Outbox
import dev.jeromeswannack.chineselearning.lab.data.platform.OutboxEntity
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.ZoneId

/**
 * "Up next" on the phone (UpNextStore): the server's list replaces the rows unless an Up next change
 * made here is still waiting in the Outbox, and the queue built from Room takes the list's words first.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class UpNextStoreTest {
    private lateinit var db: LabDatabase
    private val dao get() = db.dao()

    @Before fun setUp() {
        db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), LabDatabase::class.java).allowMainThreadQueries().build()
    }

    @After fun tearDown() = db.close()

    private fun dto(note: String, position: Int, by: String? = null) = UpNextDto("srv-$note", note, position, "2026-10-12 08:00:00", "deck", added_by_name = by, hanzi = "字")

    private suspend fun outbox(id: String, kind: String, state: String = Outbox.PENDING) =
        db.platform().insertOutbox(OutboxEntity(id = id, kind = kind, method = "PUT", path = "/api/me/up-next/order", bodyJson = "{}", filePath = null, fileField = null, fileName = null, fileMime = null, createdAt = 1, state = state))

    @Test fun serverListReplacesRowsInItsOrder() = runBlocking {
        dao.upsertUpNext(listOf(UpNextEntity("old", "o", 0, "2026-10-10 08:00:00", "deck")))
        UpNextStore.replaceFromServer(db, db.platform(), listOf(dto("b", 1), dto("a", 0, by = "Minghui"), dto("b", 5)))
        assertEquals(listOf("a", "b"), UpNextStore.queueList(dao))
        assertEquals("Minghui", dao.upNext().first().addedByName)
        assertEquals(listOf(0, 1), dao.upNext().map { it.position })
    }

    @Test fun aWaitingChangeKeepsTheLocalList() = runBlocking {
        dao.upsertUpNext(listOf(UpNextEntity("mine", "c1", 0, "2026-10-12T09:00:00.000Z", "search")))
        outbox("o1", UpNextStore.OUTBOX_ORDER)
        UpNextStore.replaceFromServer(db, db.platform(), listOf(dto("theirs", 0)))
        assertEquals(listOf("mine"), UpNextStore.queueList(dao))
        // Once it has gone (sent, or refused for good), the server's list wins.
        db.platform().deleteOutbox("o1")
        outbox("o2", UpNextStore.OUTBOX_ADD, Outbox.FAILED)
        outbox("o3", "study-bump") // another feature's waiting item doesn't hold Up next back
        UpNextStore.replaceFromServer(db, db.platform(), listOf(dto("theirs", 0)))
        assertEquals(listOf("theirs"), UpNextStore.queueList(dao))
    }

    private fun note(id: String, deck: String, hanzi: String) = NoteEntity(
        id = id, deckId = deck, hanzi = hanzi, pinyin = "", english = id, audioUrl = null, funFacts = null, context = null,
        sentenceClue = null, sentenceCluePinyin = null, sentenceClueTranslation = null, sentenceClueAudioUrl = null, alternatives = null, createdAt = "2026-10-01 10:00:00",
    )

    @Test fun theQueueTakesTheListFirstWithinTheBudget() = runBlocking {
        dao.upsertDecks(
            listOf(
                DeckEntity("top", "Everyday", null, 3, 6, 5, "2026-10-01 10:00:00"),
                DeckEntity("low", "Bank words", null, 3, 6, 0, "2026-10-01 10:00:00"),
            ),
        )
        dao.upsertNotes(
            listOf(
                note("apple", "top", "苹果"),
                note("bank", "low", "银行"),
            ),
        )
        dao.upsertCards(listOf(CardEntity("c-apple", "apple", "top", CardTypes.HANZI_TO_MEANING), CardEntity("c-bank", "bank", "low", CardTypes.HANZI_TO_MEANING)))
        UpNextStore.replaceFromServer(db, db.platform(), listOf(dto("bank", 0)))
        val zone = ZoneId.of("Europe/London")
        val now = System.currentTimeMillis()
        val built = StudyQueue.build(
            dao.decks().map { it.toQueueDeck() }, dao.cards().map { it.toQueueCard() }, StudyBudget(1, 0), 0, emptyMap(),
            StudyQueue.cutoff(now, zone), null, upNext = UpNextStore.queueList(dao),
        )
        assertEquals(listOf("c-bank"), built.dueCards.map { it.id })
        assertEquals(listOf("bank"), built.upNextNoteIds)
        assertEquals(mapOf("bank" to ("new" to 1)), UpNextStore.statuses(dao, listOf("bank")))
    }
}
