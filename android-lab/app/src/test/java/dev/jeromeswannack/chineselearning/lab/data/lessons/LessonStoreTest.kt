package dev.jeromeswannack.chineselearning.lab.data.lessons

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.core.CardQueue
import dev.jeromeswannack.chineselearning.lab.core.ExerciseAnswer
import dev.jeromeswannack.chineselearning.lab.core.ExerciseAttempt
import dev.jeromeswannack.chineselearning.lab.core.LessonAttemptData
import dev.jeromeswannack.chineselearning.lab.core.Rating
import dev.jeromeswannack.chineselearning.lab.core.AttemptRecording
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
 * The offline lesson flow against a fake server: a completion is scheduled locally at once,
 * goes up through the Outbox with its attempt, its recording waits until the attempt has
 * landed (404 → retry), local events are dropped once the server lists them, and one-off
 * homework lessons stay out of the rotation and get their `done` event.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class LessonStoreTest {
    private lateinit var server: MockWebServer
    private lateinit var db: LabDatabase
    private lateinit var api: Api
    private lateinit var store: LessonStore
    private lateinit var outbox: Outbox
    private val requests = CopyOnWriteArrayList<Pair<String, String>>()

    /** Completions the fake server knows; the media endpoint 404s until the attempt is there. */
    private val serverCompletions = CopyOnWriteArrayList<String>()
    private var homework = """{"assignments":[],"events":[]}"""

    private fun lessonsJson(): String {
        val completions = serverCompletions.joinToString(",") { """{"id":"$it","lesson_id":"L1","correct":3,"total":4,"completed_at":"2026-09-27T10:00:00.000Z","rating":2}""" }
        return """{"lessons":[
          {"id":"L1","title":"把 sentences","icon":"🧱","source":"mcp","status":"active","created_at":"2026-09-20T10:00:00Z",
           "spec":{"title":"把 sentences","sections":[{"exercises":[{"type":"choice","question":"Q","options":[{"hanzi":"对"},{"hanzi":"错"}],"correct":0},{"type":"hologram"}]}]},
           "completions":[$completions]},
          {"id":"L2","title":"Homework lesson","source":"tutor","status":"active","created_at":"2026-09-21T10:00:00Z","spec":{"title":"h","sections":[]},"completions":[]}
        ]}"""
    }

    @Before fun setUp() {
        server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val body = request.body.readUtf8()
                requests += "${request.method} ${request.path}" to body
                return when {
                    request.path == "/api/custom-lessons" -> MockResponse().setBody(lessonsJson())
                    request.path == "/api/custom-lessons/offline-complete" -> {
                        Json.parseToJsonElement(body).jsonObject["events"]!!.jsonArray.forEach { serverCompletions += it.jsonObject["id"]!!.jsonPrimitive.content }
                        MockResponse().setBody("""{"applied":1}""")
                    }
                    request.path!!.startsWith("/api/lesson-attempts/") -> {
                        val id = request.path!!.split("/")[3]
                        if (id in serverCompletions) MockResponse().setBody("{}") else MockResponse().setResponseCode(404).setBody("""{"error":"Attempt not found"}""")
                    }
                    request.path == "/api/me/homework" -> MockResponse().setBody(homework)
                    request.path == "/api/me/homework/events" -> MockResponse().setBody("""{"accepted":1}""")
                    else -> MockResponse().setResponseCode(404)
                }
            }
        }
        server.start()
        val ctx = ApplicationProvider.getApplicationContext<android.app.Application>()
        db = Room.inMemoryDatabaseBuilder(ctx, LabDatabase::class.java).allowMainThreadQueries().build()
        api = Api(server.url("").toString().removeSuffix("/")) { "t" }
        val dir = File(ctx.filesDir, "lesson-store-test/outbox").apply { parentFile!!.deleteRecursively(); mkdirs() }
        outbox = Outbox(db.platform(), api, dir)
        store = LessonStore(JsonCache(db.platform(), api.json), outbox, api)
    }

    @After fun tearDown() {
        server.shutdown()
        db.close()
    }

    private val cutoff get() = StudyQueue.cutoff(System.currentTimeMillis(), ZoneId.of("UTC"))

    @Test fun completionIsScheduledLocallyThenUploadedWithItsAttemptAndRecording() = runBlocking {
        store.sync(prefetch = false)
        assertEquals(listOf("L1", "L2"), store.dueLessons(cutoff).map { it.id })
        assertEquals("unknown exercise types still decode", 2, store.entry("L1")!!.lesson.spec.sections[0].exercises.size)

        val rec = store.recordingFile().apply { writeBytes(ByteArray(64) { 1 }) }
        val attempt = LessonAttemptData(
            "2026-09-27T10:00:00.000Z", 60_000,
            listOf(ExerciseAttempt(0, 0, "oral_expression", true, 1, 1, 30_000, ExerciseAnswer(selfAssessed = true, recording = AttemptRecording("s0e0", 12_000, "audio/mp4")))),
        )
        val state = store.complete("L1", 1, 1, Rating.AGAIN, attempt, listOf(LessonRecording("s0e0", rec, "audio/mp4")))

        // Offline right now: the new state is local and the lesson stays in learning.
        assertTrue(CardQueue.isLearning(state.queue))
        assertEquals(1, store.entry("L1")!!.events.size)
        assertEquals(1, outbox.pendingCount())
        assertEquals(1, store.pendingMediaCount())

        // A media upload before the attempt landed is a 404 → it waits.
        store.uploadMedia()
        assertEquals(1, store.pendingMediaCount())

        // Sync: the outbox sends the completion (with the attempt), then the recording goes up.
        outbox.drain()
        store.sync(prefetch = false)
        val upload = requests.first { it.first == "POST /api/custom-lessons/offline-complete" }.second
        assertTrue(upload.contains("\"attempt\"") && upload.contains("\"media_key\":\"s0e0\"") && upload.contains("\"rating\":0"))
        assertEquals(0, store.pendingMediaCount())
        assertTrue(requests.any { it.first.startsWith("PUT /api/lesson-attempts/") && it.first.endsWith("/media/s0e0") })

        // The server now lists the completion; the local copy is dropped without double counting.
        val entry = store.entry("L1")!!
        assertEquals(1, entry.events.size)
        assertEquals(state.queue, entry.state.queue)
    }

    @Test fun oneOffHomeworkLessonsStayOutAndGetTheirDoneEvent() = runBlocking {
        homework = """{"assignments":[
            {"id":"A1","kind":"lesson","target_id":"L2","mode":"one_off","status":"active"},
            {"id":"A2","kind":"lesson","target_id":"L1","mode":"both","status":"active"}
        ],"events":[]}"""
        store.sync(prefetch = false)
        assertEquals(listOf("L1"), store.dueLessons(cutoff).map { it.id })

        store.complete("L1", 1, 1, Rating.GOOD, null, emptyList())
        store.complete("L1", 1, 1, Rating.GOOD, null, emptyList()) // a second finish doesn't queue again
        outbox.drain()
        val done = requests.filter { it.first == "POST /api/me/homework/events" }
        assertEquals(1, done.size)
        assertTrue(done[0].second.contains("\"assignment_id\":\"A2\"") && done[0].second.contains("\"result\":\"done\""))
    }
}
