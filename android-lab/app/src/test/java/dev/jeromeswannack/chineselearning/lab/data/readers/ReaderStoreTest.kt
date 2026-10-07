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

    @Test fun oneUnreadReaderADayFromMergedEvents() = runBlocking {
        store.sync(zone, prefetch = false)
        // r1 was read on another device: never offered again; r2 is unread → today's reader.
        assertTrue(store.entry("r1")!!.read)
        assertNull(store.entry("r1")!!.state.dueMs)
        val now = Js.parseDate("2026-09-27T12:00:00.000Z")
        val cutoff = StudyQueue.cutoff(now, zone)
        assertEquals("r2", store.todaysReader(now, cutoff, zone)?.id)

        store.finish("r2", 90_000, "listened", now)
        assertTrue(store.entry("r2")!!.read)
        assertEquals(1, outbox.pendingCount())
        // Read today: nothing more today.
        assertNull(store.todaysReader(now + 11 * 60_000, cutoff, zone))
        // …and never again: both stories were read.
        val tomorrow = now + 86_400_000L
        assertNull(store.todaysReader(tomorrow, StudyQueue.cutoff(tomorrow, zone), zone))

        outbox.drain()
        val upload = requests.first { it.first == "POST /api/reader-reviews" }.second
        assertTrue(upload.contains("\"reader_id\":\"r2\"") && upload.contains("\"time_spent_ms\":90000") && upload.contains("\"rating\":2"))
        // The cursor moved: the next download asks from the last server event.
        store.downloadEvents()
        assertTrue(requests.last { it.first.startsWith("GET /api/reader-reviews?") }.first.contains("after_id=other"))
    }

    @Test fun anUnreadDailyReaderIsOfferedAgainAndNoNewOneIsAskedFor() = runBlocking {
        store.sync(zone, prefetch = false)
        val now = Js.parseDate("2026-09-27T12:00:00.000Z")
        // r2 is unread: offered today, tomorrow, the day after — and no new story is generated.
        for (d in 0..2) {
            val t = now + d * 86_400_000L
            val cutoff = StudyQueue.cutoff(t, zone)
            assertEquals("r2", store.todaysReader(t, cutoff, zone)?.id)
            assertFalse(store.ensureDaily(listOf("n1"), t, cutoff, zone, online = true))
        }
        assertTrue(requests.none { it.first == "POST /api/daily/reader/generate" })
        // Read it: still nothing generated today (one a day) …
        store.finish("r2", 1_000, nowMs = now + 2 * 86_400_000L)
        assertFalse(store.ensureDaily(emptyList(), now + 2 * 86_400_000L, StudyQueue.cutoff(now, zone), zone, online = true))
        // … the next day a new one is asked for.
        val next = now + 3 * 86_400_000L
        assertTrue(store.ensureDaily(emptyList(), next, StudyQueue.cutoff(next, zone), zone, online = true))
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
