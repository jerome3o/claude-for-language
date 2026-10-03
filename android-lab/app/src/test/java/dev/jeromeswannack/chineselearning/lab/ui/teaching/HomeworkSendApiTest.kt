package dev.jeromeswannack.chineselearning.lab.ui.teaching

import dev.jeromeswannack.chineselearning.lab.core.HomeworkSend
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.api.CallHomeworkRequest
import dev.jeromeswannack.chineselearning.lab.data.api.JobDeckDto
import dev.jeromeswannack.chineselearning.lab.data.api.JobLessonDto
import dev.jeromeswannack.chineselearning.lab.data.api.JobReaderDto
import dev.jeromeswannack.chineselearning.lab.data.api.JobResultDto
import dev.jeromeswannack.chineselearning.lab.data.api.makeCallHomework
import dev.jeromeswannack.chineselearning.lab.data.api.sendSessionNotesItems
import dev.jeromeswannack.chineselearning.lab.data.api.toSendResult
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Create, then send: the Lab calls the worker's send route (routes/tutor-notes.ts) and never auto-shares a call's homework. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class HomeworkSendApiTest {
    private lateinit var server: MockWebServer
    private lateinit var api: Api
    private val seen = mutableListOf<Pair<RecordedRequest, String>>()

    private val job = """{"id":"j 1","status":"done","result":{"deck":{"id":"d1","name":"饭馆","note_count":8,"target_deck_id":"t1"},"lessons":[{"library_item_id":"lib1","title":"把","lesson_id":"l1"}]}}"""

    @Before fun setUp() {
        server = MockWebServer().apply { start() }
        api = Api(server.url("").toString().removeSuffix("/")) { "t" }
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                synchronized(seen) { seen += request to request.body.readUtf8() }
                return when ("${request.method} ${request.path}") {
                    "POST /api/relationships/rel%201/session-notes/j%201/send" -> MockResponse().setBody(
                        """{"job":$job,"sent":[{"key":"deck","kind":"deck","source_id":"d1","title":"饭馆"},{"key":"lesson:lib1","kind":"lesson","source_id":"lib1","title":"把"}],"errors":[{"source_id":"r1","error":"Reader not ready"}],"assignments":[],"skipped":[],"copies":[]}""",
                    )
                    "POST /api/calls/c1/homework" -> MockResponse().setResponseCode(202).setBody("""{"job":$job}""")
                    else -> MockResponse().setResponseCode(404).setBody("""{"error":"Not found"}""")
                }
            }
        }
    }

    @After fun tearDown() = server.shutdown()

    @Test fun sendsTheChosenKeys() = runBlocking {
        val r = api.sendSessionNotesItems("rel 1", "j 1", listOf("deck", "lesson:lib1"))
        assertEquals("POST", seen.last().first.method)
        assertEquals("""{"items":["deck","lesson:lib1"]}""", seen.last().second)
        assertEquals(listOf("饭馆", "把"), r.sent.map { it.title })
        assertEquals("Reader not ready", r.errors.single().error)
        assertEquals("t1", r.job.result.deck?.target_deck_id)
        assertEquals("Sent 2 items to Jerome", HomeworkSend.sentToast(r.sent.map { it.title }, "Jerome Swannack"))
    }

    @Test fun emptyKeysMeanEverythingUnsent() = runBlocking {
        api.sendSessionNotesItems("rel 1", "j 1", emptyList())
        assertEquals("{}", seen.last().second)
    }

    @Test fun callHomeworkIsNeverAutoShared() = runBlocking {
        assertFalse(CallHomeworkRequest().auto_share)
        api.makeCallHomework("c1")
        val body = Json.parseToJsonElement(seen.last().second).jsonObject
        // The worker's default is false too; the Lab never sends true.
        assertFalse(body["auto_share"]?.jsonPrimitive?.boolean ?: false)
    }

    @Test fun jobResultMapsToTheSharedRule() {
        val result = JobResultDto(
            deck = JobDeckDto("d1", "饭馆", 8),
            lessons = listOf(JobLessonDto("lib1", "把", lesson_id = "l1"), JobLessonDto("lib2", "了")),
            reader = JobReaderDto("r1", "At the restaurant", "在饭馆", 6, removed_at = "2026-10-03T08:00:00Z"),
        )
        assertEquals(listOf("deck", "lesson:lib2"), HomeworkSend.unsentJobItems(result.toSendResult()).map { it.key })
    }
}
