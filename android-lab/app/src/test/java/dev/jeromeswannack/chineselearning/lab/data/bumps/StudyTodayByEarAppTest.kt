package dev.jeromeswannack.chineselearning.lab.data.bumps

import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.StudyToday
import dev.jeromeswannack.chineselearning.lab.data.CardEntity
import dev.jeromeswannack.chineselearning.lab.data.DeckEntity
import dev.jeromeswannack.chineselearning.lab.data.NoteEntity
import kotlinx.coroutines.runBlocking
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.assertEquals

/**
 * "⚡ Study it today" on a word just added from a sentence breakdown / the explorer (core StudyToday —
 * shared/decks/study-today.ts). Regression (Nov 2026): such a word has no clip for a few seconds (the server
 * makes it after the add), and the phone bumped its READING card instead of the listening card "Start new
 * words by ear" leads with everywhere else; a tap before the sync brought the note said "Not in your decks yet".
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], application = LabApp::class)
class StudyTodayByEarAppTest {
    private fun note(id: String, hanzi: String) = NoteEntity(id, "d1", hanzi, "", "", null, null, null, null, null, null, null, null, null)

    private suspend fun seed(app: LabApp, id: String, hanzi: String) {
        val dao = app.repo.dao
        dao.upsertDecks(listOf(DeckEntity("d1", "From example sentences", null, 3, 6, 0, "2026-09-01 10:00:00")))
        dao.upsertNotes(listOf(note(id, hanzi)))
        dao.upsertCards(
            listOf(
                CardEntity("$id-r", id, "d1", CardTypes.HANZI_TO_MEANING),
                CardEntity("$id-m", id, "d1", CardTypes.MEANING_TO_HANZI),
                CardEntity("$id-a", id, "d1", CardTypes.AUDIO_TO_HANZI),
            ),
        )
    }

    private suspend fun rowTypes(app: LabApp, noteId: String) =
        BumpStore.parseCardTypes(app.repo.dao.studyBumps().single { it.noteId == noteId }.cardTypes)

    @Test fun aWordWhoseClipIsStillBeingMadeStartsWithItsListeningCard() = runBlocking {
        val app = ApplicationProvider.getApplicationContext<LabApp>()
        app.prefs.newCardOrder = app.prefs.newCardOrder.copy(newWordsByEar = true)
        seed(app, "n1", "右侧")
        val r = BumpStore.bumpNotes(app, listOf("n1"), "explorer")
        assertEquals(listOf(StudyToday.LISTENING), r.kinds)
        assertEquals(listOf(CardTypes.AUDIO_TO_HANZI), rowTypes(app, "n1"))
        assertEquals("⚡ Listening card of 右侧 added to today", r.message)
    }

    @Test fun justAddedNotSyncedYetIsBumpedAsAnUnstartedWord() = runBlocking {
        val app = ApplicationProvider.getApplicationContext<LabApp>()
        app.prefs.newCardOrder = app.prefs.newCardOrder.copy(newWordsByEar = true)
        val r = BumpStore.bumpHanzi(app, listOf("左侧"), "explorer", justCreated = mapOf("左侧" to "n-new"))
        assertEquals(listOf("左侧"), r.added)
        assertEquals(0, r.notFound)
        assertEquals(listOf(StudyToday.LISTENING), r.kinds)
        assertEquals(listOf(CardTypes.AUDIO_TO_HANZI), rowTypes(app, "n-new"))
    }

    @Test fun withTheSwitchOffTheLeadCardAsBefore() = runBlocking {
        val app = ApplicationProvider.getApplicationContext<LabApp>()
        app.prefs.newCardOrder = app.prefs.newCardOrder.copy(newWordsByEar = false)
        seed(app, "n2", "上方")
        val r = BumpStore.bumpNotes(app, listOf("n2"), "explorer")
        assertEquals(listOf(StudyToday.LEAD), r.kinds)
        assertEquals(listOf(CardTypes.HANZI_TO_MEANING), rowTypes(app, "n2"))
    }
}
