package dev.jeromeswannack.chineselearning.lab.data.sentences

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.core.SentenceHistory
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.api.SentenceTopUpBody
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The Sentence round's asks for more sentences (the web's requestMoreSentences / flushPendingTopUps, its
 * sentencePractice.test.ts): at most every ten minutes per word, offline → sent with the next sync, and the
 * body `{ note_ids, reason, counts }`.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class SentenceTopUpsTest {
    private var now = 1_762_596_000_000L // 2026-11-08T10:00:00Z
    private lateinit var topUps: SentenceTopUps

    @Before
    fun setUp() {
        val prefs = ApplicationProvider.getApplicationContext<Context>().getSharedPreferences("topups-test", Context.MODE_PRIVATE)
        prefs.edit().clear().commit()
        topUps = SentenceTopUps(prefs) { now }
    }

    private val minute = 60_000L

    @Test
    fun asksAtMostEveryTenMinutesPerWord() {
        val want = SentenceTopUps.Want("fresh", 4)
        assertEquals(SentenceTopUps.Decision.SEND, topUps.claim("n1", want, online = true))
        assertEquals(SentenceTopUps.Decision.SKIP, topUps.claim("n1", want, online = true))
        // Another word is its own.
        assertEquals(SentenceTopUps.Decision.SEND, topUps.claim("n2", want, online = true))
        now += 9 * minute
        assertEquals(SentenceTopUps.Decision.SKIP, topUps.claim("n1", SentenceTopUps.Want("fresh", 6), online = true))
        // The buffer is used up again later the same day: a new ask once ten minutes have passed.
        now += 2 * minute
        assertEquals(SentenceTopUps.Decision.SEND, topUps.claim("n1", SentenceTopUps.Want("fresh", 6), online = true))
        assertEquals(SentenceHistory.TOPUP_RETRY_MS, 10 * minute)
    }

    @Test
    fun offlineWaitsForTheSyncThenSendsByReasonWithCounts() = runBlocking {
        assertEquals(SentenceTopUps.Decision.QUEUE, topUps.claim("n2", SentenceTopUps.Want("few", 5), online = false))
        assertEquals(SentenceTopUps.Decision.QUEUE, topUps.claim("n3", SentenceTopUps.Want("fresh", 3), online = false))
        // Waiting already: not asked twice.
        assertEquals(SentenceTopUps.Decision.SKIP, topUps.claim("n2", SentenceTopUps.Want("few", 5), online = true))
        assertEquals(mapOf("n2" to SentenceTopUps.Want("few", 5), "n3" to SentenceTopUps.Want("fresh", 3)), topUps.pending())

        val posts = ArrayList<SentenceTopUpBody>()
        val sent = topUps.flush { ids, reason, counts -> posts += SentenceTopUpBody(ids, reason, counts) }
        assertEquals(listOf("n2", "n3"), sent)
        assertEquals(listOf(SentenceTopUpBody(listOf("n2"), "few", mapOf("n2" to 5)), SentenceTopUpBody(listOf("n3"), "fresh", mapOf("n3" to 3))), posts)
        assertTrue(topUps.pending().isEmpty())
        // Sent = asked: the ten-minute guard holds for them too.
        assertTrue(topUps.askedRecently("n2"))
        assertEquals(SentenceTopUps.Decision.SKIP, topUps.claim("n3", SentenceTopUps.Want("fresh", 3), online = true))
    }

    @Test
    fun aFailedAskWaitsAndAFailedFlushKeepsIt() = runBlocking {
        val want = SentenceTopUps.Want("fresh", 4)
        assertEquals(SentenceTopUps.Decision.SEND, topUps.claim("n1", want, online = true))
        topUps.failed("n1", want)
        assertEquals(mapOf("n1" to want), topUps.pending())
        assertEquals(emptyList(), topUps.flush { _, _, _ -> error("offline") })
        assertEquals(mapOf("n1" to want), topUps.pending())
        now += 30 * minute
        assertEquals(listOf("n1"), topUps.flush { _, _, _ -> })
        assertTrue(topUps.pending().isEmpty())
    }

    @Test
    fun theBodyIsNoteIdsReasonAndCounts() {
        val api = Api("http://localhost") { null }
        val body = api.json.encodeToString(SentenceTopUpBody.serializer(), SentenceTopUpBody(listOf("n1"), "fresh", mapOf("n1" to 4)))
        assertEquals(Json.parseToJsonElement("""{"note_ids":["n1"],"reason":"fresh","counts":{"n1":4}}"""), Json.parseToJsonElement(body))
        // "Listen in context" (no reason) sends only the notes.
        val listen = api.json.encodeToString(SentenceTopUpBody.serializer(), SentenceTopUpBody(listOf("n1")))
        assertEquals(setOf("note_ids"), (Json.parseToJsonElement(listen) as JsonObject).keys)
    }
}
