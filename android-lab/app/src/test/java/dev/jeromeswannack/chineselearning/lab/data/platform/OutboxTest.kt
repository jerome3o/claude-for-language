package dev.jeromeswannack.chineselearning.lab.data.platform

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.LabDatabase
import dev.jeromeswannack.chineselearning.lab.data.UnauthorizedException
import dev.jeromeswannack.chineselearning.lab.data.api.get
import dev.jeromeswannack.chineselearning.lab.data.api.post
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.Serializable
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

@Serializable data class FlagBody(val id: String, val note_id: String, val message: String)
@Serializable data class Echo(val ok: Boolean = false, val n: Int = 0)

/** The offline write queue and the generic API helpers, against a fake server. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class OutboxTest {
    private lateinit var server: MockWebServer
    private lateinit var db: LabDatabase
    private lateinit var api: Api
    private lateinit var outbox: Outbox
    private lateinit var dir: File

    @Before fun setUp() {
        server = MockWebServer().apply { start() }
        db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), LabDatabase::class.java).allowMainThreadQueries().build()
        api = Api(server.url("").toString().removeSuffix("/")) { "token-1" }
        dir = File(ApplicationProvider.getApplicationContext<android.app.Application>().filesDir, "outbox-test").apply { deleteRecursively() }
        outbox = Outbox(db.platform(), api, dir)
    }

    @After fun tearDown() {
        server.shutdown()
        db.close()
    }

    @Test fun drainsInOrderWithAuthAndBody() = runBlocking {
        outbox.enqueueJson("flags", "POST", "/api/card-flags", FlagBody("f1", "n1", "Is this tone right?"), id = "f1")
        outbox.enqueue("homework", "POST", "/api/me/homework/events", """{"events":[]}""")
        repeat(2) { server.enqueue(MockResponse().setResponseCode(201).setBody("{}")) }

        val r = outbox.drain()

        assertEquals(Outbox.DrainResult(sent = 2, failed = 0, remaining = 0), r)
        val first = server.takeRequest()
        assertEquals("/api/card-flags", first.path)
        assertEquals("Bearer token-1", first.getHeader("Authorization"))
        assertTrue(first.body.readUtf8().contains("Is this tone right?"))
        assertEquals("/api/me/homework/events", server.takeRequest().path)
        assertTrue(outbox.all().isEmpty())
    }

    @Test fun enqueueingTheSameClientIdTwiceIsANoOp() = runBlocking {
        outbox.enqueue("flags", "POST", "/api/card-flags", "{}", id = "same")
        outbox.enqueue("flags", "POST", "/api/card-flags", "{}", id = "same")
        assertEquals(1, outbox.pendingCount())
    }

    @Test fun serverErrorStopsTheDrainAndKeepsOrder() = runBlocking {
        outbox.enqueue("a", "POST", "/one", "{}", id = "1")
        outbox.enqueue("a", "POST", "/two", "{}", id = "2")
        server.enqueue(MockResponse().setResponseCode(503).setBody("busy"))

        val r = outbox.drain()

        assertEquals(0, r.sent)
        assertEquals(2, r.remaining)
        assertEquals(1, server.requestCount) // "/two" was not sent before "/one"
        val item = outbox.all().first()
        assertEquals(1, item.attempts)
        assertTrue(item.lastError!!.contains("503"))

        repeat(2) { server.enqueue(MockResponse().setResponseCode(200).setBody("{}")) }
        assertEquals(2, outbox.drain().sent)
    }

    @Test fun rejectedItemFailsAndTheRestGoThrough409IsDone() = runBlocking {
        outbox.enqueue("a", "POST", "/bad", "{}", id = "1")
        outbox.enqueue("a", "POST", "/dup", "{}", id = "2")
        outbox.enqueue("a", "POST", "/ok", "{}", id = "3")
        server.enqueue(MockResponse().setResponseCode(400).setBody("""{"error":"message is required"}"""))
        server.enqueue(MockResponse().setResponseCode(409).setBody("{}"))
        server.enqueue(MockResponse().setResponseCode(200).setBody("{}"))

        val r = outbox.drain()

        assertEquals(Outbox.DrainResult(sent = 2, failed = 1, remaining = 0), r)
        val failed = outbox.all().single()
        assertEquals(Outbox.FAILED, failed.state)
        assertTrue(failed.lastError!!.contains("message is required"))
        outbox.retryFailed()
        assertEquals(1, outbox.pendingCount())
    }

    @Test fun networkErrorKeepsTheItemPendingWithoutCountingAnAttempt() = runBlocking {
        outbox.enqueue("a", "POST", "/one", "{}", id = "1")
        server.shutdown()
        val r = outbox.drain()
        assertEquals(1, r.remaining)
        assertEquals(0, outbox.all().single().attempts)
    }

    @Test fun unauthorizedEscapesSoTheSyncCanSayWhy() = runBlocking {
        outbox.enqueue("a", "POST", "/one", "{}", id = "1")
        server.enqueue(MockResponse().setResponseCode(401))
        try {
            outbox.drain()
            fail("expected UnauthorizedException")
        } catch (_: UnauthorizedException) {
        }
        assertEquals(1, outbox.pendingCount())
    }

    @Test fun uploadsAStagedFileAsMultipartThenDeletesIt() = runBlocking {
        val file = outbox.stageFile("take 1.webm").apply { writeBytes(byteArrayOf(1, 2, 3, 4)) }
        outbox.enqueueUpload("recordings", "/api/audio/upload", file, fileField = "audio", mime = "audio/webm", fields = mapOf("card_id" to "c1"))
        server.enqueue(MockResponse().setResponseCode(200).setBody("{}"))

        assertEquals(1, outbox.drain().sent)

        val req = server.takeRequest()
        val body = req.body.readUtf8()
        assertTrue(req.getHeader("Content-Type")!!.startsWith("multipart/form-data"))
        assertTrue(body.contains("name=\"audio\""))
        assertTrue(body.contains("name=\"card_id\""))
        assertFalse(file.exists())
    }

    @Test fun completedItemsAreAnnounced() = runBlocking {
        outbox.enqueue("flags", "POST", "/x", "{}", id = "f9")
        server.enqueue(MockResponse().setResponseCode(200).setBody("{}"))
        val seen = async(Dispatchers.Default) { outbox.completed.first() }
        delay(50)
        outbox.drain()
        assertEquals("f9", seen.await().id)
    }

    @Test fun typedHelpersDecodeAndReportServerMessages() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(200).setBody("""{"ok":true,"n":3,"extra":"ignored"}"""))
        val echo: Echo = api.get("/api/echo")
        assertEquals(Echo(true, 3), echo)

        server.enqueue(MockResponse().setResponseCode(400).setBody("""{"problems":["hanzi is empty"]}"""))
        try {
            api.post<FlagBody, Echo>("/api/echo", FlagBody("1", "n", "m"))
            fail("expected HttpException")
        } catch (e: dev.jeromeswannack.chineselearning.lab.data.HttpException) {
            assertEquals(400, e.code)
            assertEquals("hanzi is empty", e.userMessage())
        }
    }

    @Test fun jsonCacheRoundTripsAndReadsStaleShapesAsMissing() = runBlocking {
        val cache = JsonCache(db.platform(), api.json) { 1_000L }
        cache.put("readers/list", "readers", listOf(Echo(true, 1)))
        assertEquals(listOf(Echo(true, 1)), cache.get<List<Echo>>("readers/list"))
        assertTrue(cache.isFresh("readers/list", 10))
        db.platform().putCache(listOf(JsonCacheEntity("readers/r1", "readers", "not json", 1)))
        assertNull(cache.get<Echo>("readers/r1"))
        cache.deleteKind("readers")
        assertNull(cache.get<List<Echo>>("readers/list"))
    }
}
