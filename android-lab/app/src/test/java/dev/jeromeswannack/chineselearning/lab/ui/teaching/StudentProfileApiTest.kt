package dev.jeromeswannack.chineselearning.lab.ui.teaching

import dev.jeromeswannack.chineselearning.lab.core.StudentProfileFields
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.api.saveStudentProfile
import dev.jeromeswannack.chineselearning.lab.data.api.studentProfile
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The student-profile endpoints the web uses (worker routes/student-profile.ts), against a fake server. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class StudentProfileApiTest {
    private lateinit var server: MockWebServer
    private lateinit var api: Api
    private val seen = mutableListOf<Pair<RecordedRequest, String>>()

    @Before fun setUp() {
        server = MockWebServer().apply { start() }
        api = Api(server.url("").toString().removeSuffix("/")) { "t" }
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val body = request.body.readUtf8()
                synchronized(seen) { seen += request to body }
                return when (request.method) {
                    "GET" -> MockResponse().setBody("""{"profile":{"relationship_id":"rel 1","body":"Likes football.","level":"beginner","handwriting":false,"words_per_lesson":15,"updated_at":"2026-09-27T10:00:00Z"}}""")
                    "PUT" -> if (body.contains("\"body\":\"\"")) MockResponse().setBody("""{"profile":null}""")
                    else MockResponse().setBody("""{"profile":{"relationship_id":"rel 1","body":"Now writes.","handwriting":true,"updated_at":"2026-09-27T11:00:00Z"}}""")
                    else -> MockResponse().setResponseCode(404)
                }
            }
        }
    }

    @After fun tearDown() = server.shutdown()

    @Test fun readsAndWritesTheTutorOnlyRoute() = runBlocking {
        val got = api.studentProfile("rel 1").profile!!
        assertEquals("/api/relationships/rel%201/student-profile", seen.last().first.path)
        assertEquals(StudentProfileFields("Likes football.", "beginner", false, 15), got.fields())

        val saved = api.saveStudentProfile("rel 1", StudentProfileFields("Now writes.", null, true, null)).profile!!
        assertEquals("PUT", seen.last().first.method)
        val body = seen.last().second
        assertTrue(body, body.contains("\"body\":\"Now writes.\"") && body.contains("\"handwriting\":true"))
        assertEquals(true, saved.handwriting)

        // An empty profile is deleted on the server: the answer is null.
        assertNull(api.saveStudentProfile("rel 1", StudentProfileFields()).profile)
        assertTrue(seen.last().second.contains("\"body\":\"\""))
    }
}
