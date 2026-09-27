package dev.jeromeswannack.chineselearning.lab

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.core.CardQueue
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.ReviewEventInput
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.LabDatabase
import dev.jeromeswannack.chineselearning.lab.data.Prefs
import dev.jeromeswannack.chineselearning.lab.data.Repository
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The Lab app's sync against a REAL worker (the same code the web client talks to).
 * Opt-in: start the worker with E2E_TEST_MODE=true (`npm run dev:worker`) and run
 * `LAB_E2E_API=http://localhost:8787 ./gradlew :app:testDebugUnitTest --tests '*SyncContractTest*'`.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class SyncContractTest {
    private val base = System.getenv("LAB_E2E_API")
    private val http = OkHttpClient()
    private val json = Json { ignoreUnknownKeys = true }

    private fun call(method: String, path: String, token: String?, body: String? = null): String {
        val b = Request.Builder().url("$base$path")
        token?.let { b.header("Authorization", "Bearer $it") }
        b.method(method, body?.toRequestBody("application/json".toMediaType()))
        http.newCall(b.build()).execute().use { res ->
            val text = res.body!!.string()
            check(res.isSuccessful) { "$method $path → ${res.code}: $text" }
            return text
        }
    }

    @Test
    fun fullSyncReviewUploadUndoAndTombstonesRoundTrip() = runBlocking {
        assumeTrue("set LAB_E2E_API to run against a local worker", base != null)
        val token = json.parseToJsonElement(call("POST", "/api/test/auth", null, """{"email":"lab-${UUID.randomUUID()}@example.com","name":"Lab"}"""))
            .jsonObject["session_token"]!!.jsonPrimitive.content

        // Content made through the API, like the web app / MCP would.
        val deckId = json.parseToJsonElement(call("POST", "/api/decks", token, """{"name":"Lab sync deck"}""")).jsonObject["id"]!!.jsonPrimitive.content
        val words = listOf(Triple("打算", "dǎsuàn", "to plan"), Triple("周末", "zhōumò", "weekend"), Triple("旅行", "lǚxíng", "to travel"))
        val noteIds = words.map { (h, p, e) ->
            json.parseToJsonElement(call("POST", "/api/decks/$deckId/notes", token, """{"hanzi":"$h","pinyin":"$p","english":"$e","sentence_clue":"我们周末${h}。"}"""))
                .jsonObject["id"]!!.jsonPrimitive.content
        }
        val deck = json.parseToJsonElement(call("GET", "/api/decks/$deckId", token)).jsonObject
        val firstNoteCards = deck["notes"]!!.jsonArray.first { it.jsonObject["id"]!!.jsonPrimitive.content == noteIds[0] }.jsonObject["cards"]!!.jsonArray
        val otherDeviceCard = firstNoteCards.first { it.jsonObject["card_type"]!!.jsonPrimitive.content == "hanzi_to_meaning" }.jsonObject["id"]!!.jsonPrimitive.content

        // A review made on "another device" (the web app).
        val webEvents = listOf(
            ReviewEventInput(UUID.randomUUID().toString(), otherDeviceCard, 2, "2026-09-20T08:00:00.000Z"),
            ReviewEventInput(UUID.randomUUID().toString(), otherDeviceCard, 2, "2026-09-20T08:11:00.000Z"),
        )
        call("POST", "/api/reviews", token, """{"events":[${webEvents.joinToString(",") { """{"id":"${it.id}","card_id":"${it.cardId}","rating":${it.rating},"reviewed_at":"${it.reviewedAt}"}""" }}]}""")

        val ctx = ApplicationProvider.getApplicationContext<android.app.Application>()
        val db = Room.inMemoryDatabaseBuilder(ctx, LabDatabase::class.java).allowMainThreadQueries().build()
        val prefs = Prefs(ctx).apply { clearAccount(); sessionToken = token }
        val repo = Repository(ctx, db, Api(base!!) { prefs.sessionToken }, prefs)

        repo.sync()
        assertNull(repo.status.value.error, "sync error: ${repo.status.value.error}")
        val dao = repo.dao
        assertTrue(dao.decks().any { it.id == deckId })
        assertEquals(3, dao.allNotes().count { it.deckId == deckId })
        assertEquals(9, dao.cards().count { it.deckId == deckId })
        assertEquals("我们周末打算。", dao.note(noteIds[0])!!.sentenceClue)

        // The web review arrived and the card state is the event replay.
        val synced = dao.card(otherDeviceCard)!!
        assertEquals(CardScheduler.computeCardState(webEvents).nextReviewAt, synced.nextReviewAt)
        assertEquals(CardQueue.REVIEW, synced.queue)

        // A review on this phone goes up as an ordinary event.
        val newCard = dao.cards().first { it.noteId == noteIds[1] && it.cardType == "hanzi_to_meaning" }
        val (eventId, updated) = repo.recordReview(newCard.id, 2, 4200, null)
        assertEquals(CardQueue.LEARNING, updated!!.queue)
        repo.pushEvents()
        assertEquals(0, dao.unsyncedCount())
        val server = call("GET", "/api/reviews?since=1970-01-01%2000:00:00", token)
        assertTrue(eventId in server)

        // Undo after upload → DELETE on the next sync.
        repo.undoReview(eventId)
        assertEquals(CardQueue.NEW, dao.card(newCard.id)!!.queue)
        repo.sync()
        assertTrue(eventId !in call("GET", "/api/reviews?since=1970-01-01%2000:00:00", token))

        // A note deleted elsewhere disappears on the next incremental sync (tombstone) — also
        // when it happens in the same second as the previous sync (the cursor has milliseconds,
        // the rows whole seconds).
        call("DELETE", "/api/notes/${noteIds[2]}", token)
        repo.sync()
        assertNull(repo.status.value.error)
        assertNull(dao.note(noteIds[2]))
        assertEquals(6, dao.cards().count { it.deckId == deckId })
        assertNotNull(dao.note(noteIds[0]))

        // An edit made right after a sync arrives with the next one.
        call("PUT", "/api/notes/${noteIds[1]}", token, """{"english":"weekend (Sat + Sun)"}""")
        repo.sync()
        assertEquals("weekend (Sat + Sun)", dao.note(noteIds[1])!!.english)

        // Reviews made on the web after the full sync, on a card this phone has: replayed on the next sync.
        val later = ReviewEventInput(UUID.randomUUID().toString(), otherDeviceCard, 0, "2026-09-26T08:00:00.000Z")
        call("POST", "/api/reviews", token, """{"events":[{"id":"${later.id}","card_id":"${later.cardId}","rating":0,"reviewed_at":"${later.reviewedAt}"}]}""")
        repo.sync()
        assertEquals(CardScheduler.computeCardState(webEvents + later).let { synced.withState(it) }, dao.card(otherDeviceCard))

        // Every sync reports its steps (Lab settings → Last sync).
        val run = repo.status.value.lastRun!!
        assertTrue(run.ok && !run.full)
        assertTrue(run.phases.map { it.name }.containsAll(listOf("Changes", "Downloading reviews", "Card states")))
        repo.awaitAudioPrefetch()
        db.close()
    }
}
