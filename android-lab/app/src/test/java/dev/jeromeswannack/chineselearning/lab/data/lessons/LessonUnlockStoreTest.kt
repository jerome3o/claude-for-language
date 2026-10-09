package dev.jeromeswannack.chineselearning.lab.data.lessons

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.core.Rating
import dev.jeromeswannack.chineselearning.lab.core.StudyQueue
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.LabDatabase
import dev.jeromeswannack.chineselearning.lab.data.platform.JsonCache
import dev.jeromeswannack.chineselearning.lab.data.platform.Outbox
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
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
 * Unlockable mini lessons on the phone against a fake server (web: services/lessonUnlock.ts):
 * a locked companion is never offered; unlocking it (by hand, or by listening to its podcast)
 * puts it in today at once, on top of the daily lesson, and goes up through the Outbox; once the
 * server's list carries the unlock, the local one is forgotten and it stays unlocked.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class LessonUnlockStoreTest {
    private lateinit var server: MockWebServer
    private lateinit var db: LabDatabase
    private lateinit var api: Api
    private lateinit var store: LessonStore
    private lateinit var outbox: Outbox
    private val requests = CopyOnWriteArrayList<Pair<String, String>>()
    @Volatile private var serverUnlockedAt: String? = null

    private fun lessonsJson(): String {
        val unlocked = serverUnlockedAt?.let { "\"$it\"" } ?: "null"
        return """{"lessons":[
          {"id":"C1","title":"去朋友家吃饭 · Dinner at a friend's parents' home — mini lesson","icon":"🎧","source":"companion","status":"active","created_at":"2026-09-01T10:00:00Z",
           "spec":{"title":"c","sections":[{"exercises":[{"type":"note","body":"饭 fàn — 4th tone"}]}]},"completions":[],
           "unlock":{"kind":"audio_lesson","audio_lesson_id":"al1"},"unlocked_at":$unlocked,"companion_of":"al1"},
          {"id":"L1","title":"把 sentences","source":"mcp","status":"active","created_at":"2026-09-20T10:00:00Z","spec":{"title":"b","sections":[]},"completions":[]},
          {"id":"M1","title":"Order 打包","source":"mcp","status":"active","created_at":"2026-09-02T10:00:00Z","spec":{"title":"m","sections":[]},"completions":[],
           "unlock":{"kind":"manual","prompt":"Go to a restaurant and order 打包"}}
        ]}"""
    }

    @Before fun setUp() {
        server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val body = request.body.readUtf8()
                requests += "${request.method} ${request.path}" to body
                return when (request.path) {
                    "/api/custom-lessons" -> MockResponse().setBody(lessonsJson())
                    "/api/custom-lessons/unlock" -> {
                        val ev = Json.parseToJsonElement(body).jsonObject["events"]!!.jsonArray.first().jsonObject
                        if (ev["lesson_id"]!!.jsonPrimitive.content == "C1") serverUnlockedAt = ev["unlocked_at"]!!.jsonPrimitive.content
                        MockResponse().setBody("""{"unlocked":["${ev["lesson_id"]!!.jsonPrimitive.content}"],"already":[],"not_found":[],"invalid":0}""")
                    }
                    "/api/audio-lessons/listened" -> MockResponse().setBody("""{"listened":["al1"],"not_found":[],"unlocked_lessons":["C1"]}""")
                    "/api/custom-lessons/offline-complete" -> MockResponse().setBody("""{"applied":1}""")
                    "/api/me/homework/events" -> MockResponse().setBody("""{"accepted":1}""")
                    "/api/me/revisit-events" -> MockResponse().setBody("""{"accepted":[],"orphans":[],"invalid":[]}""")
                    "/api/me/revisit" -> MockResponse().setBody("""{"events":[]}""")
                    else -> MockResponse().setResponseCode(404)
                }
            }
        }
        server.start()
        val ctx = ApplicationProvider.getApplicationContext<android.app.Application>()
        db = Room.inMemoryDatabaseBuilder(ctx, LabDatabase::class.java).allowMainThreadQueries().build()
        api = Api(server.url("").toString().removeSuffix("/")) { "t" }
        val dir = File(ctx.filesDir, "lesson-unlock-test/outbox").apply { parentFile!!.deleteRecursively(); mkdirs() }
        outbox = Outbox(db.platform(), api, dir)
        store = LessonStore(JsonCache(db.platform(), api.json), outbox, api)
    }

    @After fun tearDown() {
        server.shutdown()
        db.close()
    }

    private val cutoff get() = StudyQueue.cutoff(System.currentTimeMillis(), ZoneId.of("UTC"))
    private suspend fun due() = store.dueLessons(cutoff, zone = ZoneId.of("UTC")).map { it.id }

    @Test fun lockedLessonsAreNeverOfferedThenUnlockingPutsItOnTopAndUploads() = runBlocking {
        store.sync(prefetch = false)
        // C1 and M1 are the oldest new lessons, but locked: today's one new lesson is L1.
        assertEquals(listOf("L1"), due())
        assertTrue(store.entry("C1")!!.locked)
        assertEquals("manual", store.entry("M1")!!.unlock!!.kind)

        assertTrue(store.unlock("C1", "manual"))
        assertFalse("a second unlock is a no-op", store.unlock("C1", "manual"))
        assertFalse("no condition, nothing to unlock", store.unlock("L1", "manual"))
        // Unlocked = "I want this now": on top of the daily new lesson.
        assertEquals(listOf("C1", "L1"), due())

        outbox.drain()
        val sent = requests.filter { it.first == "POST /api/custom-lessons/unlock" }
        assertEquals(1, sent.size)
        assertTrue(sent[0].second.contains("\"via\":\"manual\""))

        // The server's list carries it now; the phone's own unlock is forgotten and it stays unlocked.
        store.sync(prefetch = false)
        assertEquals("unlocked", store.entry("C1")!!.lockStatus)
        assertEquals(listOf("C1", "L1"), due())

        // Finishing it doesn't use up the daily place.
        store.complete("C1", 3, 3, Rating.GOOD, null, emptyList())
        assertEquals(listOf("L1"), due())
    }

    @Test fun listeningToThePodcastUnlocksItsCompanionOnly() = runBlocking {
        store.sync(prefetch = false)
        assertNull(store.listenedHere("al1"))
        assertEquals(listOf("C1"), store.markAudioListened("al1"))
        assertTrue(store.listenedHere("al1") != null)
        assertTrue("the manual one waits", store.entry("M1")!!.locked)
        assertEquals("unlocked", store.entry("C1")!!.lockStatus)
        outbox.drain()
        assertTrue(requests.any { it.first == "POST /api/audio-lessons/listened" && it.second.contains("\"audio_lesson_id\":\"al1\"") })
        assertTrue(requests.any { it.first == "POST /api/custom-lessons/unlock" && it.second.contains("\"via\":\"auto\"") })
    }
}
