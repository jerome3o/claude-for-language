package dev.jeromeswannack.chineselearning.lab.data

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.assertEquals

/**
 * 27 Sep: 40 words were moved out of an old homework deck into Core Homework, then the old
 * deck was deleted. One /sync/changes response carried the moved notes AND the deck's
 * tombstone; deleting the deck first took the moved notes' cards with it (the response only
 * carries cards whose own row changed), so they were gone from the device for good.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class SyncChangesTest {
    private val db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), LabDatabase::class.java).allowMainThreadQueries().build()
    private val dao = db.dao()

    @After fun close() = db.close()

    private fun note(id: String, deck: String) = NoteEntity(id, deck, id, "x", "y", null, null, null, null, null, null, null, null, "2026-09-23 09:43:51")
    private fun noteDto(id: String, deck: String) = NoteDto(id = id, deck_id = deck, hanzi = id, pinyin = "x", english = "y", created_at = "2026-09-23 09:43:51")

    private suspend fun seed() {
        dao.upsertDecks(listOf(DeckEntity("d-old", "Old homework", null, 3, 6, 1, "2026-09-01T10:00:00Z"), DeckEntity("d-core", "Core Homework", null, 3, 6, 2, "2026-09-01T10:00:00Z")))
        dao.upsertNotes(listOf(note("字体", "d-old"), note("留下", "d-old"), note("打算", "d-core")))
        dao.upsertCards(listOf("字体" to "d-old", "留下" to "d-old", "打算" to "d-core").map { (n, d) -> CardEntity("$n-h", n, d, "hanzi_to_meaning") })
    }

    @Test
    fun aNoteMovedOutOfADeckDeletedInTheSameResponseKeepsItsCards() = runBlocking {
        seed()
        val changes = ChangesDto(
            notes = listOf(noteDto("字体", "d-core")),
            deleted = DeletedDto(deck_ids = listOf("d-old")),
            server_time = "2026-09-30T08:00:00.000Z",
        )
        assertEquals(setOf("字体"), SyncChanges.movedToLiveDecks(changes))
        SyncChanges.apply(dao, changes)

        assertEquals(listOf("d-core"), dao.decks().map { it.id })
        assertEquals(listOf("字体" to "d-core", "打算" to "d-core"), dao.allNotes().map { it.id to it.deckId }.sortedBy { it.first })
        assertEquals(listOf("字体-h" to "d-core", "打算-h" to "d-core"), dao.cardPlacements().map { it.id to it.deckId }.sortedBy { it.first })
    }

    @Test
    fun nothingDeletedInTheResponseComesBackFromIt() = runBlocking {
        seed()
        // Edited, then deleted — both in one response: the note stays deleted.
        SyncChanges.apply(dao, ChangesDto(notes = listOf(noteDto("打算", "d-core")), deleted = DeletedDto(note_ids = listOf("打算")), server_time = "2026-09-30T08:00:00.000Z"))
        assertEquals(listOf("字体", "留下"), dao.allNotes().map { it.id }.sorted())
        assertEquals(listOf("字体-h", "留下-h"), dao.cardPlacements().map { it.id }.sorted())
    }
}
