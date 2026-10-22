package dev.jeromeswannack.chineselearning.lab.data.lessons

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.core.ExerciseAnswer
import dev.jeromeswannack.chineselearning.lab.core.ExerciseAttempt
import dev.jeromeswannack.chineselearning.lab.core.LessonAttemptData
import dev.jeromeswannack.chineselearning.lab.core.LessonRevision
import dev.jeromeswannack.chineselearning.lab.core.AttemptRecording
import dev.jeromeswannack.chineselearning.lab.core.StudyQueue
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.LabDatabase
import dev.jeromeswannack.chineselearning.lab.data.platform.JsonCache
import dev.jeromeswannack.chineselearning.lab.core.HomeworkAssignment
import dev.jeromeswannack.chineselearning.lab.core.HomeworkEvent
import dev.jeromeswannack.chineselearning.lab.data.homework.HomeworkKeys
import dev.jeromeswannack.chineselearning.lab.data.platform.Outbox
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
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
 * The offline lesson flow against a fake server: a completion decides the lesson's state locally
 * at once (all right first time → done forever; a miss → a revision in a week), goes up through
 * the Outbox with its attempt and outcome, its recording waits until the attempt has landed
 * (404 → retry), local events are dropped once the server lists them, and homework lessons get
 * their `done` event.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class LessonStoreTest {
    private lateinit var server: MockWebServer
    private lateinit var db: LabDatabase
    private lateinit var api: Api
    private lateinit var store: LessonStore
    private lateinit var outbox: Outbox
    private lateinit var cache: JsonCache
    private val requests = CopyOnWriteArrayList<Pair<String, String>>()
    /** Texts asked of `POST /api/practice/tts`. */
    private val ttsTexts = CopyOnWriteArrayList<String>()

    /** Completions the fake server knows; the media endpoint 404s until the attempt is there. */
    private val serverCompletions = CopyOnWriteArrayList<String>()
    /** Done-for-good / Bring-back events the fake server holds (as JSON) and its gaps. */
    private val serverRevisit = CopyOnWriteArrayList<String>()
    private var settingsJson = """{"hard_days":2,"good_days":14,"easy_days":42,"growth":2,"cap_days":180,"is_default":true}"""

    private fun lessonsJson(): String {
        val completions = serverCompletions.joinToString(",") { """{"id":"$it","lesson_id":"L1","correct":3,"total":4,"completed_at":"2026-09-27T10:00:00.000Z","rating":2}""" }
        return """{"lessons":[
          {"id":"L1","title":"把 sentences","icon":"🧱","source":"mcp","status":"active","created_at":"2026-09-20T10:00:00Z",
           "spec":{"title":"把 sentences","sections":[{"exercises":[{"type":"choice","question":"Q","options":[{"hanzi":"对"},{"hanzi":"错"}],"correct":0},{"type":"hologram"}]}]},
           "completions":[$completions]},
          {"id":"L2","title":"Homework lesson","source":"tutor","status":"active","created_at":"2026-09-21T10:00:00Z","spec":{"title":"h","sections":[{"exercises":[{"type":"scramble","english":"Even if he is busy, he reviews Chinese every day.","tiles":["即使","他","很忙，","也","每天","复习中文。"],"correct_order":["即使","他","很忙，","也","每天","复习中文。"]}]}]},"completions":[]}
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
                    request.path == "/api/me/homework/events" -> MockResponse().setBody("""{"accepted":1}""")
                    request.path == "/api/practice/tts" -> {
                        ttsTexts += Json.parseToJsonElement(body).jsonObject["text"]!!.jsonPrimitive.content
                        MockResponse().setBody("""{"audio_base64":"SUQz","content_type":"audio/mpeg"}""")
                    }
                    request.path == "/api/me/revisit-events" -> {
                        Json.parseToJsonElement(body).jsonObject["events"]!!.jsonArray.forEach { serverRevisit += it.toString() }
                        MockResponse().setBody("""{"accepted":[],"orphans":[],"invalid":[]}""")
                    }
                    request.path == "/api/me/revisit" -> MockResponse().setBody("""{"settings":$settingsJson,"events":[${serverRevisit.joinToString(",")}]}""")
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
        cache = JsonCache(db.platform(), api.json)
        store = LessonStore(cache, outbox, api)
    }

    @After fun tearDown() {
        server.shutdown()
        db.close()
    }

    private val cutoff get() = StudyQueue.cutoff(System.currentTimeMillis(), ZoneId.of("UTC"))

    private fun row(index: Int, correct: Boolean, retry: Int? = null) =
        ExerciseAttempt(0, index, "choice", correct, if (correct) 1 else 0, 1, 1_000, retry = retry)

    @Test fun completionDecidesLocallyThenUploadsItsAttemptOutcomeAndRecording() = runBlocking {
        store.sync(prefetch = false)
        // Both new lessons are to do (Home's card / the Mini Lessons page), oldest first — no daily place any more.
        assertEquals(listOf("L1", "L2"), store.lessonsToDo(cutoff).map { it.id })
        assertEquals("unknown exercise types still decode", 2, store.entry("L1")!!.lesson.spec.sections[0].exercises.size)

        val rec = store.recordingFile().apply { writeBytes(ByteArray(64) { 1 }) }
        val attempt = LessonAttemptData(
            "2026-09-27T10:00:00.000Z", 60_000,
            listOf(ExerciseAttempt(0, 0, "oral_expression", true, 1, 1, 30_000, ExerciseAnswer(selfAssessed = true, recording = AttemptRecording("s0e0", 12_000, "audio/mp4")))),
        )
        val state = store.complete("L1", 1, 1, attempt, listOf(LessonRecording("s0e0", rec, "audio/mp4")), null)

        // Offline right now: the new state is local — everything right first time = done forever.
        assertEquals("done", state.status)
        assertTrue(store.lessonsToDo(cutoff).none { it.id == "L1" })
        assertEquals(1, store.entry("L1")!!.runs.size)
        assertEquals(1, outbox.pendingCount())
        assertEquals(1, store.pendingMediaCount())

        // A media upload before the attempt landed is a 404 → it waits.
        store.uploadMedia()
        assertEquals(1, store.pendingMediaCount())

        // Sync: the outbox sends the completion (attempt + outcome, no rating), then the recording goes up.
        outbox.drain()
        store.sync(prefetch = false)
        val upload = requests.first { it.first == "POST /api/custom-lessons/offline-complete" }.second
        assertTrue(upload.contains("\"attempt\"") && upload.contains("\"media_key\":\"s0e0\"") && upload.contains("\"outcome\""))
        assertTrue(!upload.contains("\"rating\":0") && !upload.contains("\"rating\":2"))
        assertEquals(0, store.pendingMediaCount())
        assertTrue(requests.any { it.first.startsWith("PUT /api/lesson-attempts/") && it.first.endsWith("/media/s0e0") })

        // The server now lists the completion (its legacy fake carries rating 2 and no outcome → done
        // too); the local copy is dropped without double counting.
        val entry = store.entry("L1")!!
        assertEquals(1, entry.runs.size)
        assertEquals("done", entry.learn.status)
    }

    @Test fun aMistakeComesBackAsARevisionInAWeek() = runBlocking {
        store.sync(prefetch = false)
        val now = System.currentTimeMillis()
        val attempt = LessonAttemptData("2026-10-01T10:00:00.000Z", 1, listOf(row(0, false), row(0, true, retry = 1)))
        val state = store.complete("L1", 0, 1, attempt, emptyList(), null, nowMs = now)
        assertEquals("revision", state.status)
        assertEquals(1, state.revision)
        assertEquals(listOf("s0e0"), state.missed)
        assertEquals(now + LessonRevision.GAP_DAYS * 86_400_000L, state.dueMs)
        // Not due today: off Home's to-do list until then; a week later it is the revision.
        assertTrue(store.lessonsToDo(cutoff).none { it.id == "L1" })
        val later = StudyQueue.cutoff(now + 8 * 86_400_000L, ZoneId.of("UTC"))
        assertEquals("L1", store.lessonsToDo(later).first().id)
        assertEquals(listOf("s0e0"), store.entry("L1")!!.revisionKeys())
        assertEquals("1 question · ~1 min", store.entry("L1")!!.revisionSize())
        // The revision put right first time: done forever.
        store.complete("L1", 1, 1, LessonAttemptData("", 1, listOf(row(0, true))), emptyList(), null, nowMs = now + 8 * 86_400_000L)
        assertEquals("done", store.entry("L1")!!.learn.status)
    }

    @Test fun homeworkLessonsGetTheirDoneEvent() = runBlocking {
        // The homework mirror (package E's HomeworkSync fills it on every sync).
        cache.put(HomeworkKeys.ASSIGNMENTS, HomeworkKeys.KIND, listOf(
            HomeworkAssignment(id = "A1", kind = "lesson", target_id = "L2", mode = "one_off", status = "active"),
            HomeworkAssignment(id = "A2", kind = "lesson", target_id = "L1", mode = "both", status = "active"),
        ))
        store.sync(prefetch = false)
        // Home's card lists every new lesson (the homework rows cover the assigned ones).
        assertEquals(listOf("L1", "L2"), store.lessonsToDo(cutoff).map { it.id })

        store.complete("L1", 1, 1, null, emptyList(), null)
        store.complete("L1", 1, 1, null, emptyList(), null) // a second finish doesn't queue again
        outbox.drain()
        val done = requests.filter { it.first == "POST /api/me/homework/events" }
        assertEquals(1, done.size)
        assertTrue(done[0].second.contains("\"assignment_id\":\"A2\"") && done[0].second.contains("\"result\":\"done\""))
        // Written into the same mirror the homework pass reads, so the pass shows it done at once.
        val events = cache.get<List<HomeworkEvent>>(HomeworkKeys.EVENTS).orEmpty()
        assertEquals(listOf("A2" to "done"), events.map { it.assignment_id to it.result })
    }

    @Test fun syncPrefetchesEveryClipOfLessonsToDoAndHomeworkLessonsOnce() = runBlocking {
        // L2 is one-off homework: its pass opens it — its audio comes down too.
        cache.put(HomeworkKeys.ASSIGNMENTS, HomeworkKeys.KIND, listOf(
            HomeworkAssignment(id = "A1", kind = "lesson", target_id = "L2", mode = "one_off", status = "active"),
        ))
        store.sync(prefetch = true, online = true)
        assertEquals(listOf("L1", "L2"), store.lessonsToDo(cutoff).map { it.id })
        assertEquals(setOf("对", "错", "即使他很忙，也每天复习中文。"), ttsTexts.toSet())
        assertEquals("each clip asked for once", 3, ttsTexts.size)
        val scramble = dev.jeromeswannack.chineselearning.lab.core.LessonAudioClip("tts", "即使他很忙，也每天复习中文。", exercise = 0)
        assertTrue(store.media.cachedClip(scramble) != null)
        // On the phone now: the next sync asks for nothing.
        store.sync(prefetch = true, online = true)
        assertEquals(3, ttsTexts.size)
    }

    @Test fun aClipBeingFetchedIsJoinedNotAskedForTwice() = runBlocking {
        val a = async(Dispatchers.IO) { store.media.tts("你好。", online = true) }
        val b = async(Dispatchers.IO) { store.media.tts("你好。", online = true) }
        assertTrue(a.await() != null && b.await() != null)
        assertEquals(listOf("你好。"), ttsTexts.toList())
    }
}
