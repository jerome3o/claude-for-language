package dev.jeromeswannack.chineselearning.lab.data.readers

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.core.RevisitState
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.Rating
import dev.jeromeswannack.chineselearning.lab.core.StudyQueue
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.LabDatabase
import dev.jeromeswannack.chineselearning.lab.data.platform.JsonCache
import dev.jeromeswannack.chineselearning.lab.data.platform.Outbox
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import java.time.ZoneId
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Graded readers offline against a fake server: other devices' reviews come down by
 * cursor, a review made here schedules the reader at once and goes up through the Outbox,
 * one reader a day (read → nothing more today), the daily-reader request is made once per
 * local day, and a reader deleted on the server drops out with its events.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class ReaderStoreTest {
    private lateinit var server: MockWebServer
    private lateinit var db: LabDatabase
    private lateinit var store: ReaderStore
    private lateinit var outbox: Outbox
    private val requests = CopyOnWriteArrayList<Pair<String, String>>()
    private val zone = ZoneId.of("UTC")
    private var readers = listOf("r1", "r2")
    private var reviewsServed = false

    private fun readerJson(id: String, created: String) = """{"id":"$id","title_chinese":"小明在巴黎","title_english":"Xiaoming in Paris","difficulty_level":"beginner",
        "vocabulary_used":[{"hanzi":"巴黎","pinyin":"Bālí","english":"Paris"}],"status":"ready","created_at":"$created",
        "pages":[{"id":"$id-p1","page_number":1,"content_chinese":"小明在巴黎。","content_pinyin":"Xiǎomíng zài Bālí.","content_english":"Xiaoming is in Paris.","image_url":null,"image_prompt":null}]}"""

    @Before fun setUp() {
        server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                requests += "${request.method} ${request.path}" to request.body.readUtf8()
                val path = request.path!!
                return when {
                    path.startsWith("/api/readers?include_pages=true") ->
                        MockResponse().setBody("[" + readers.mapIndexed { i, id -> readerJson(id, "2026-09-2${i}T10:00:00Z") }.joinToString(",") + "]")
                    path.startsWith("/api/reader-reviews?") -> {
                        val body = if (reviewsServed) """{"events":[],"has_more":false}"""
                        else """{"events":[{"id":"other","reader_id":"r1","rating":3,"time_spent_ms":60000,"reviewed_at":"2026-09-26T09:00:00.000Z","created_at":"2026-09-26 09:00:01"}],"has_more":false}"""
                        reviewsServed = true
                        MockResponse().setBody(body)
                    }
                    path == "/api/reader-reviews" -> MockResponse().setBody("""{"created":1}""")
                    path == "/api/daily/reader/generate" -> MockResponse().setBody("""{"reader_id":"r9","status":"generating"}""")
                    path == "/api/me/homework" -> MockResponse().setBody("""{"assignments":[],"events":[]}""")
                    else -> MockResponse().setResponseCode(404)
                }
            }
        }
        server.start()
        val ctx = ApplicationProvider.getApplicationContext<android.app.Application>()
        db = Room.inMemoryDatabaseBuilder(ctx, LabDatabase::class.java).allowMainThreadQueries().build()
        val api = Api(server.url("").toString().removeSuffix("/")) { "t" }
        val dir = File(ctx.filesDir, "reader-store-test/outbox").apply { parentFile!!.deleteRecursively(); mkdirs() }
        outbox = Outbox(db.platform(), api, dir)
        store = ReaderStore(JsonCache(db.platform(), api.json), outbox, api)
    }

    @After fun tearDown() {
        server.shutdown()
        db.close()
    }

    @Test fun oneReaderADayFromMergedEvents() = runBlocking {
        store.sync(zone, prefetch = false)
        // r1 was read on another device (Easy: back in 6 weeks); r2 is new → today's reader.
        assertEquals(RevisitState.SCHEDULED, store.entry("r1")!!.state.status)
        assertEquals(42.0, store.entry("r1")!!.state.gapDays, 0.0)
        val now = Js.parseDate("2026-09-27T12:00:00.000Z")
        val cutoff = StudyQueue.cutoff(now, zone)
        assertEquals("r2", store.todaysReader(now, cutoff, zone)?.id)

        val state = store.rate("r2", Rating.GOOD, 90_000, now)
        // "Revisit later": Good = back in two weeks.
        assertEquals(now + 14 * 86_400_000L, state.dueMs)
        assertEquals(1, outbox.pendingCount())
        // Read today: nothing more today (not even an Again repeat).
        assertNull(store.todaysReader(now + 11 * 60_000, cutoff, zone))

        outbox.drain()
        val upload = requests.first { it.first == "POST /api/reader-reviews" }.second
        assertTrue(upload.contains("\"reader_id\":\"r2\"") && upload.contains("\"time_spent_ms\":90000"))
        // The cursor moved: the next download asks from the last server event.
        store.downloadEvents()
        assertTrue(requests.last { it.first.startsWith("GET /api/reader-reviews?") }.first.contains("after_id=other"))
    }

    @Test fun doneForGoodReadersAreNeverOffered() = runBlocking {
        store.sync(zone, prefetch = false)
        val now = Js.parseDate("2026-09-27T12:00:00.000Z")
        val cutoff = StudyQueue.cutoff(now, zone)
        store.markRevisit("r2", "retire")
        assertEquals(RevisitState.RETIRED, store.entry("r2")!!.state.status)
        assertNull(store.todaysReader(now, cutoff, zone)) // r1 isn't due, r2 is done for good
        store.markRevisit("r2", "restore")
        // Bring back: in rotation again, due at once.
        val later = System.currentTimeMillis()
        assertEquals("r2", store.todaysReader(later, StudyQueue.cutoff(later, zone), zone)?.id)
        assertEquals(listOf("revisit", "revisit"), outbox.all().map { it.kind })
    }

    @Test fun dailyReaderIsRequestedOncePerDayWhenNothingIsDue() = runBlocking {
        readers = emptyList()
        store.sync(zone, prefetch = false)
        val now = Js.parseDate("2026-09-27T12:00:00.000Z")
        val cutoff = StudyQueue.cutoff(now, zone)
        assertNull(store.todaysReader(now, cutoff, zone))
        assertTrue(store.ensureDaily(listOf("n1", "n2"), now, cutoff, zone, online = true))
        assertFalse(store.ensureDaily(listOf("n1"), now, cutoff, zone, online = true))
        val asks = requests.filter { it.first == "POST /api/daily/reader/generate" }
        assertEquals(1, asks.size)
        assertTrue(asks[0].second.contains("\"note_ids\":[\"n1\",\"n2\"]") && asks[0].second.contains("\"local_date\":\"2026-09-27\""))
    }

    @Test fun readersDeletedOnTheServerTakeTheirEvents() = runBlocking {
        store.sync(zone, prefetch = false)
        assertEquals(1, store.entry("r1")!!.events.size)
        readers = listOf("r2")
        store.refresh()
        assertNull(store.entry("r1"))
        assertTrue(store.entries().all { it.events.isEmpty() })
    }
}
