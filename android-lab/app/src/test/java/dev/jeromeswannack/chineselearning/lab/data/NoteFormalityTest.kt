package dev.jeromeswannack.chineselearning.lab.data

import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.NewCardOrder
import dev.jeromeswannack.chineselearning.lab.core.cards.WordTags
import kotlinx.coroutines.runBlocking
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config as RoboConfig
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * "Everyday words before formal ones" on the phone (LabDao.noteFormality): the classes come from
 * Room's notes (hanzi + AI word tags) and the shipped lexicon — never waiting for the lexicon
 * (until LabApp's warm-up has read it every note is neutral), nothing when the switch is off.
 */
@RunWith(RobolectricTestRunner::class)
@RoboConfig(sdk = [34], application = LabApp::class)
class NoteFormalityTest {
    @Test
    fun classesFromRoomNotesOnceTheLexiconIsRead() = runBlocking {
        val app: LabApp = ApplicationProvider.getApplicationContext()
        val dao = app.repo.dao
        dao.upsertDecks(listOf(DeckEntity("fd", "Words", null, 20, 20, 1, "2026-01-01T00:00:00.000Z")))
        fun note(id: String, hanzi: String) = NoteEntity(id, "fd", hanzi, "", "", null, null, null, null, null, null, null, null, null)
        dao.upsertNotes(listOf(note("f-didai", "抵达"), note("f-gaoding", "搞定"), note("f-gongzuo", "工作"), note("f-gaozhi", "告知").copy(wordTags = """{"v":2,"register":"formal","confidence":"high"}""")))

        if (!WordTags.shippedLoaded) assertNull(dao.noteFormality(NewCardOrder.DEFAULT), "not read yet: the plain order, no waiting")
        WordTags.shipped // LabApp's warm-up (skipped under Robolectric)
        val map = dao.noteFormality(NewCardOrder.DEFAULT)!!
        assertEquals(mapOf("f-didai" to 2, "f-gaoding" to 0, "f-gaozhi" to 2), map.filterKeys { it.startsWith("f-") })
        assertNull(dao.noteFormality(NewCardOrder.DEFAULT.copy(everydayFirst = false)))
    }
}
