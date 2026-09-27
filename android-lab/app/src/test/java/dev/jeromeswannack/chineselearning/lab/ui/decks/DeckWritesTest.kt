package dev.jeromeswannack.chineselearning.lab.ui.decks

import dev.jeromeswannack.chineselearning.lab.core.DeckQueue
import dev.jeromeswannack.chineselearning.lab.data.decks.NoteFields
import dev.jeromeswannack.chineselearning.lab.data.decks.WriteOutcome
import dev.jeromeswannack.chineselearning.lab.data.platform.Outbox
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.mockwebserver.MockResponse
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The deck / note write path: same calls as the web online, Room + Outbox offline, rules checked first. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class DeckWritesTest {
    private lateinit var f: DecksFixture
    private val dao get() = f.db.dao()

    @Before fun setUp() = runBlocking { f = DecksFixture(); f.seed() }

    @After fun tearDown() = f.close()

    private fun ok(body: String = "{}") = MockResponse().setResponseCode(200).setBody(body)

    @Test fun reorderSendsTheWholeOrderAndMirrorsPriorities() = runBlocking {
        f.server.enqueue(ok("""{"reordered":3}"""))
        val out = f.writes.reorder(listOf("d3", "d1", "d2"))
        assertEquals(WriteOutcome.Saved, out)
        val req = f.server.takeRequest()
        assertEquals("PUT", req.method)
        assertEquals("/api/decks/reorder", req.path)
        assertEquals(listOf("d3", "d1", "d2"), Json.parseToJsonElement(req.body.readUtf8()).jsonObject["deck_ids"]!!.jsonArray.map { it.jsonPrimitive.content })
        assertEquals(mapOf("d3" to 3, "d1" to 2, "d2" to 1), dao.decks().associate { it.id to it.studyPriority })
        assertTrue(f.version.value > 0)
    }

    @Test fun moveToTopUsesTheMoveEndpointAndLandsAboveEveryDeck() = runBlocking {
        f.server.enqueue(ok())
        f.writes.moveDeck("d3", DeckQueue.Move.TOP, listOf("d1", "d2", "d3"))
        val req = f.server.takeRequest()
        assertEquals("/api/decks/d3/move", req.path)
        assertEquals("""{"to":"top"}""", req.body.readUtf8())
        assertEquals(3, dao.decks().first { it.id == "d3" }.studyPriority)
    }

    @Test fun moveUpIsAReorder() = runBlocking {
        f.server.enqueue(ok())
        f.writes.moveDeck("d2", DeckQueue.Move.UP, listOf("d1", "d2", "d3"))
        assertEquals("/api/decks/reorder", f.server.takeRequest().path)
        assertEquals(listOf("d2", "d1", "d3"), dao.decks().sortedByDescending { it.studyPriority }.map { it.id })
    }

    @Test fun offlineEditsAreMirroredAndQueuedInOrder() = runBlocking {
        f.online.value = false
        val out = f.writes.updateNote("n2", NoteFields("银行", "yínháng", "bank (money)", sentenceClue = "我去银行。", sentenceCluePinyin = "Wǒ qù yínháng."))
        assertEquals(WriteOutcome.Queued, out)
        val n = dao.note("n2")!!
        assertEquals("bank (money)", n.english)
        assertEquals("我去银行。", n.sentenceClue)
        val queued = f.outbox.all().single()
        assertEquals("PUT", queued.method)
        assertEquals("/api/notes/n2", queued.path)
        val body = Json.parseToJsonElement(queued.bodyJson!!).jsonObject
        assertEquals(JsonNull, body["fun_facts"]) // an emptied field is cleared, not left alone
        assertEquals(0, f.server.requestCount)

        // Back online with that edit still queued: the next write waits behind it (order kept).
        f.online.value = true
        assertEquals(WriteOutcome.Queued, f.writes.deleteNote("n3"))
        assertEquals(listOf("note-edit", "note-delete"), f.outbox.all().map { it.kind })
        assertNull(dao.note("n3"))
        assertTrue(dao.cards().none { it.noteId == "n3" })
    }

    @Test fun theCardStandardIsCheckedOnThePhone() = runBlocking {
        val out = f.writes.updateNote("n2", NoteFields("银行/钱庄", "yin2hang2", "bank"))
        assertTrue(out is WriteOutcome.Refused)
        assertTrue((out as WriteOutcome.Refused).message.contains("ONE clean form"))
        assertTrue(out.message.contains("tone numbers"))
        assertEquals(0, f.server.requestCount)
        assertEquals("bank", dao.note("n2")!!.english)
    }

    @Test fun aServerRefusalIsShownAndNothingChanges() = runBlocking {
        f.server.enqueue(MockResponse().setResponseCode(400).setBody("""{"error":"english cannot be empty"}"""))
        val out = f.writes.updateNote("n2", NoteFields("银行", "yínháng", "banks"))
        assertEquals(WriteOutcome.Refused("english cannot be empty"), out)
        assertEquals("bank", dao.note("n2")!!.english)
        assertTrue(f.outbox.all().isEmpty())
    }

    @Test fun onlineEditMirrorsTheServersAnswer() = runBlocking {
        f.server.enqueue(ok("""{"id":"n2","deck_id":"d1","hanzi":"银行","pinyin":"yínháng","english":"bank","audio_url":"generated/new.mp3","sentence_clue":"我在银行工作。"}"""))
        assertEquals(WriteOutcome.Saved, f.writes.updateNote("n2", NoteFields("银行", "yínháng", "bank", sentenceClue = "我在银行工作。")))
        assertEquals("generated/new.mp3", dao.note("n2")!!.audioUrl)
        assertEquals(1, f.afterWrites)
    }

    @Test fun deletingSomethingAlreadyGoneStillRemovesItHere() = runBlocking {
        f.server.enqueue(MockResponse().setResponseCode(404).setBody("""{"error":"Deck not found"}"""))
        assertEquals(WriteOutcome.Saved, f.writes.deleteDeck("d2"))
        assertTrue(dao.decks().none { it.id == "d2" })
        assertTrue(dao.allNotes().none { it.deckId == "d2" })
        assertTrue(dao.cards().none { it.deckId == "d2" })
    }

    @Test fun moveNotesKeepsCardsAndMovesThemToo() = runBlocking {
        f.server.enqueue(ok("""{"moved":1}"""))
        assertEquals(WriteOutcome.Saved, f.writes.moveNotes(listOf("n2"), "d2"))
        assertEquals("d2", dao.note("n2")!!.deckId)
        assertTrue(dao.cards().filter { it.noteId == "n2" }.all { it.deckId == "d2" })
        assertEquals(3, dao.cards().count { it.noteId == "n2" })
    }

    @Test fun settingsAreValidatedLikePickDeckSettingsBeforeSending() = runBlocking {
        val bad = f.writes.updateSettings("d1", mapOf("new_cards_per_day" to "-2", "secondary_cards_per_day" to "4"))
        assertEquals(WriteOutcome.Refused("new_cards_per_day must be a number between 0 and 1000"), bad)
        assertEquals(0, f.server.requestCount)

        f.server.enqueue(ok())
        assertEquals(WriteOutcome.Saved, f.writes.updateSettings("d1", mapOf("new_cards_per_day" to "5", "secondary_cards_per_day" to " 0 ")))
        assertEquals("""{"new_cards_per_day":5,"secondary_cards_per_day":0}""", f.server.takeRequest().body.readUtf8())
        val d = dao.decks().first { it.id == "d1" }
        assertEquals(5, d.newCardsPerDay)
        assertEquals(0, d.secondaryCardsPerDay)
    }

    @Test fun addingAWordNeedsTheServerAndMirrorsItsCards() = runBlocking {
        f.online.value = false
        val offline = f.writes.createNote("d1", NoteFields("面包", "miànbāo", "bread"))
        assertTrue(offline.exceptionOrNull()!!.message!!.contains("offline"))

        f.online.value = true
        f.server.enqueue(
            MockResponse().setResponseCode(201).setBody(
                """{"id":"n9","deck_id":"d1","hanzi":"面包","pinyin":"miànbāo","english":"bread","cards":[{"id":"c9a","note_id":"n9","card_type":"hanzi_to_meaning"},{"id":"c9b","note_id":"n9","card_type":"meaning_to_hanzi"},{"id":"c9c","note_id":"n9","card_type":"audio_to_hanzi"}]}""",
            ),
        )
        val made = f.writes.createNote("d1", NoteFields("面包", "miànbāo", "bread", alternatives = "面包儿\n\n"))
        assertEquals("n9", made.getOrThrow().id)
        val sent = Json.parseToJsonElement(f.server.takeRequest().body.readUtf8()).jsonObject
        assertEquals("[\"面包儿\"]", sent["alternatives"]!!.jsonPrimitive.content)
        assertEquals(3, dao.cards().count { it.noteId == "n9" && it.deckId == "d1" })
    }

    @Test fun aFlagWaitsInTheOutboxWithItsClientId() = runBlocking {
        f.online.value = false
        assertEquals(WriteOutcome.Queued, f.writes.flagCard("rel1", "n1", "  Is the tone on 算 right?  ", nowMs = 1_790_000_000_000))
        val item = f.outbox.all().single()
        val body = Json.parseToJsonElement(item.bodyJson!!).jsonObject
        assertEquals(item.id, body["id"]!!.jsonPrimitive.content)
        assertEquals("Is the tone on 算 right?", body["message"]!!.jsonPrimitive.content)
        assertEquals(Outbox.PENDING, item.state)
    }
}
