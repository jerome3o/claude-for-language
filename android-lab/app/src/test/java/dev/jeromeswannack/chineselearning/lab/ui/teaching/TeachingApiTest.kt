package dev.jeromeswannack.chineselearning.lab.ui.teaching

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.LabDatabase
import dev.jeromeswannack.chineselearning.lab.data.api.AssignItemDto
import dev.jeromeswannack.chineselearning.lab.data.api.AssignmentPatchBody
import dev.jeromeswannack.chineselearning.lab.data.api.MyRelationshipsDto
import dev.jeromeswannack.chineselearning.lab.data.api.RelationshipDto
import dev.jeromeswannack.chineselearning.lab.data.api.RelationshipHomeworkDto
import dev.jeromeswannack.chineselearning.lab.data.api.StudentOverviewDto
import dev.jeromeswannack.chineselearning.lab.data.api.TutorDashboardDto
import dev.jeromeswannack.chineselearning.lab.data.api.assignHomework
import dev.jeromeswannack.chineselearning.lab.data.api.moveSharedDeck
import dev.jeromeswannack.chineselearning.lab.data.api.updateHomeworkAssignment
import dev.jeromeswannack.chineselearning.lab.data.platform.LabPlatform
import dev.jeromeswannack.chineselearning.lab.data.platform.SyncContext
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavKeys
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.encodeToString
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

/** TeachingApi paths/bodies and TeachingSync's offline cache, against a fake server. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class TeachingApiTest {
    private lateinit var server: MockWebServer
    private lateinit var db: LabDatabase
    private lateinit var api: Api
    private lateinit var platform: LabPlatform
    private val seen = mutableListOf<RecordedRequest>()

    @Before fun setUp() {
        server = MockWebServer().apply { start() }
        db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), LabDatabase::class.java).allowMainThreadQueries().build()
        api = Api(server.url("").toString().removeSuffix("/")) { "t" }
        platform = LabPlatform(db, api, File(ApplicationProvider.getApplicationContext<android.app.Application>().filesDir, "teach-test"))
    }

    @After fun tearDown() {
        server.shutdown()
        db.close()
    }

    private fun serve(routes: Map<String, String>) {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                synchronized(seen) { seen += request }
                val path = request.path!!.substringBefore('?')
                val body = routes["${request.method} $path"] ?: return MockResponse().setResponseCode(404).setBody("""{"error":"no route $path"}""")
                return MockResponse().setBody(body)
            }
        }
    }

    @Test fun syncCachesTheDashboardAndEveryStudentPage() = runBlocking {
        val dash = TeachingSamples.dashboard
        serve(
            mapOf(
                "GET /api/auth/me" to """{"id":"u-t","can_invite":true}""",
                "GET /api/tutor/dashboard" to api.json.encodeToString(dash),
                "GET /api/relationships/rel-jerome/homework" to api.json.encodeToString(TeachingSamples.homework),
                "GET /api/relationships/rel-lily/homework" to api.json.encodeToString(TeachingSamples.homework.copy(assignments = emptyList())),
            ),
        )
        platform.cache.put(NavKeys.RELATIONSHIPS, NavKeys.KIND, MyRelationshipsDto(students = listOf(RelationshipDto("rel-jerome", status = "active"))))
        val ctx = SyncContext(api, platform.cache, platform.outbox, db, full = false)

        TeachingSync.sync(ctx)

        assertEquals(dash, platform.cache.get<TutorDashboardDto>(TeachingKeys.DASHBOARD))
        assertEquals(TeachingSamples.lilyOverview, platform.cache.get<StudentOverviewDto>(TeachingKeys.overview("rel-lily")))
        assertEquals(4, platform.cache.get<RelationshipHomeworkDto>(TeachingKeys.homework("rel-jerome"))!!.assignments.size)
        assertTrue(platform.cache.get<dev.jeromeswannack.chineselearning.lab.data.api.TeachingMeDto>(TeachingKeys.ME)!!.can_invite)
        assertTrue(seen.first { it.path!!.startsWith("/api/tutor/dashboard") }.path!!.contains("tz_offset="))

        // Fresh within 10 minutes: a second sync fetches nothing.
        val before = seen.size
        TeachingSync.sync(ctx)
        assertEquals(before, seen.size)
    }

    @Test fun syncSkipsAccountsWithoutStudents() = runBlocking {
        serve(emptyMap())
        platform.cache.put(NavKeys.RELATIONSHIPS, NavKeys.KIND, MyRelationshipsDto(tutors = listOf(RelationshipDto("r1", status = "active"))))
        TeachingSync.sync(SyncContext(api, platform.cache, platform.outbox, db, full = true))
        assertTrue(seen.isEmpty())
    }

    @Test fun writesHitTheWebRoutes() = runBlocking {
        serve(
            mapOf(
                "POST /api/relationships/rel%201/homework" to """{"assignments":[{"id":"a1","title":"交通","due_date":"2026-09-29"}],"skipped":[{"source_id":"d1","hanzi":["地铁"]}]}""",
                "PATCH /api/relationships/rel%201/homework/a1" to """{"assignment":{"id":"a1"}}""",
                "POST /api/relationships/rel%201/shared-decks/sd1/move" to """{"shared_deck_id":"sd1","queue_position":1,"queue_total":4}""",
            ),
        )
        val res = api.assignHomework("rel 1", listOf(AssignItemDto("deck", "d1", "one_off", "2026-09-29", 3, "core", true)))
        assertEquals(listOf("地铁"), res.skipped.single().hanzi)
        val body = seen.last().body.readUtf8()
        assertTrue(body, body.contains("\"split_days\":3") && body.contains("\"skip_known\":true") && body.contains("\"today\":"))

        api.updateHomeworkAssignment("rel 1", "a1", AssignmentPatchBody(status = "cancelled"))
        assertEquals("PATCH", seen.last().method)
        assertEquals("""{"status":"cancelled"}""", seen.last().body.readUtf8())

        val moved = api.moveSharedDeck("rel 1", "sd1", "top")
        assertEquals(1, moved.queue_position)
        assertNotNull(seen.last().body.readUtf8().takeIf { it == """{"to":"top"}""" })
    }
}
