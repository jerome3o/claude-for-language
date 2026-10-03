package dev.jeromeswannack.chineselearning.lab.ui.teaching

import dev.jeromeswannack.chineselearning.lab.core.HomeworkAssignment
import dev.jeromeswannack.chineselearning.lab.core.HomeworkEvent
import dev.jeromeswannack.chineselearning.lab.core.LibraryItem
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.api.HomeworkLinkBody
import dev.jeromeswannack.chineselearning.lab.data.api.HomeworkLinkUpdateBody
import dev.jeromeswannack.chineselearning.lab.data.api.createHomeworkLink
import dev.jeromeswannack.chineselearning.lab.data.api.relationshipHomeworkLibrary
import dev.jeromeswannack.chineselearning.lab.data.api.sendLinkHomework
import dev.jeromeswannack.chineselearning.lab.data.api.studentCopies
import dev.jeromeswannack.chineselearning.lab.data.api.tutorHomeworkLibrary
import dev.jeromeswannack.chineselearning.lab.data.api.updateHomeworkLink
import dev.jeromeswannack.chineselearning.lab.data.api.updateStudentCopies
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
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

/** The homework hub's endpoints (worker routes/homework-library.ts): paths, bodies and the wire shapes the Lab reads. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class HomeworkLibraryApiTest {
    private lateinit var server: MockWebServer
    private lateinit var api: Api
    private val seen = mutableListOf<Pair<RecordedRequest, String>>()

    private val itemJson = """{"key":"link:as1","kind":"link","relationship_id":"rel 1","student_id":"s1","student_name":"Jerome Swannack",
        "title":"《小幸运》","source_id":"lk1","target_id":"lk1","share_id":null,"sent_at":"2026-10-02T20:15:00.000Z","due_date":"2026-10-03",
        "mode":"one_off","percent":100,"progress":"done","status":"completed","completed_at":"2026-10-03T08:00:00.000Z",
        "assignment_ids":["as1"],"due_assignment_id":null,"behind":0,"url":"https://youtu.be/dQw4w9WgXcQ","instructions":"Listen twice.",
        "thumbnail_url":"https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg","student_note":"我听懂了！","extra_field":1}"""

    @Before fun setUp() {
        server = MockWebServer().apply { start() }
        api = Api(server.url("").toString().removeSuffix("/")) { "t" }
        val routes = mapOf(
            "GET /api/relationships/rel%201/homework-library" to """{"items":[$itemJson],"counts":{"completed":1,"in_progress":0,"overdue":0,"not_started":0},"today":"2026-10-03"}""",
            "GET /api/tutor/homework-library" to """{"students":[{"relationship_id":"rel 1","student_id":"s1","student_name":"Jerome Swannack"}],"items":[$itemJson],"counts":{},"today":"2026-10-03"}""",
            "POST /api/homework-links" to """{"link":{"id":"lk1","title":"《小幸运》","url":"https://youtu.be/dQw4w9WgXcQ","instructions":null,"thumbnail_url":"https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"}}""",
            "PUT /api/homework-links/lk1" to """{"link":{"id":"lk1","title":"New","url":"https://example.com/"},"copies":{"updated":1,"results":[]}}""",
            "POST /api/relationships/rel%201/homework" to """{"assignments":[{"id":"as1","kind":"link","target_id":"lk1","source_id":"lk1","title":"《小幸运》","mode":"one_off"}],"skipped":[],"errors":[]}""",
            "GET /api/student-copies" to """{"copies":[{"relationship_id":"rel 1","student_id":"s1","student_name":"Jerome Swannack","target_id":"t1","share_id":"sh1","behind":3}]}""",
            "POST /api/student-copies/update" to """{"updated":1,"results":[{"relationship_id":"rel 1","student_name":"Jerome Swannack","ok":true,"detail":"added 3 new words"}]}""",
        )
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val body = request.body.readUtf8()
                synchronized(seen) { seen += request to body }
                val answer = routes["${request.method} ${request.path!!.substringBefore('?')}"] ?: return MockResponse().setResponseCode(404).setBody("""{"error":"Not found"}""")
                return MockResponse().setBody(answer)
            }
        }
    }

    @After fun tearDown() = server.shutdown()

    private fun last(method: String, pathPrefix: String) = synchronized(seen) { seen.last { it.first.method == method && it.first.path!!.startsWith(pathPrefix) } }

    @Test fun readsLibraryRows() = runBlocking {
        val lib = api.relationshipHomeworkLibrary("rel 1", "2026-10-03")
        assertEquals("/api/relationships/rel%201/homework-library?today=2026-10-03", last("GET", "/api/relationships").first.path)
        val item = lib.items.single()
        assertEquals("link", item.kind)
        assertEquals("completed", item.status)
        assertEquals(100, item.percent)
        assertEquals(listOf("as1"), item.assignment_ids)
        assertNull(item.due_assignment_id)
        assertEquals("我听懂了！", item.student_note)
        assertEquals("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg", item.thumbnail_url)
        assertEquals(1, lib.counts["completed"])

        val all = api.tutorHomeworkLibrary("2026-10-03")
        assertEquals("Jerome Swannack", all.students.single().student_name)
        assertEquals(item, all.items.single())
    }

    @Test fun createsAndSendsALink() = runBlocking {
        val link = api.createHomeworkLink(HomeworkLinkBody("《小幸运》", "https://youtu.be/dQw4w9WgXcQ", null))
        assertEquals("lk1", link.id)
        val createBody = Json.parseToJsonElement(last("POST", "/api/homework-links").second).toString()
        assertEquals("""{"title":"《小幸运》","url":"https://youtu.be/dQw4w9WgXcQ"}""", createBody)

        val res = api.sendLinkHomework("rel 1", link.id, null)
        assertEquals("as1", res.assignments.single().id)
        val send = last("POST", "/api/relationships/rel%201/homework").second
        assertTrue(send, send.contains(""""items":[{"kind":"link","source_id":"lk1","mode":"one_off"}]"""))
        assertTrue(send, send.contains(""""today":"""))
    }

    @Test fun editsALinkWithOrWithoutTheStudentsCopy() = runBlocking {
        api.updateHomeworkLink("lk1", HomeworkLinkUpdateBody("New", "https://example.com/", "", update_student_copies = listOf("rel 1")))
        assertEquals("""{"title":"New","url":"https://example.com/","instructions":"","update_student_copies":["rel 1"]}""", last("PUT", "/api/homework-links/lk1").second)
        api.updateHomeworkLink("lk1", HomeworkLinkUpdateBody("New", update_student_copies = null))
        assertFalse(last("PUT", "/api/homework-links/lk1").second.contains("update_student_copies"))
    }

    @Test fun listsAndUpdatesStudentCopies() = runBlocking {
        val copies = api.studentCopies("deck", "d 1")
        assertEquals("/api/student-copies?kind=deck&source_id=d%201", last("GET", "/api/student-copies").first.path)
        assertEquals(3, copies.single().behind)
        val res = api.updateStudentCopies("deck", "d 1", listOf("rel 1"))
        assertEquals("""{"kind":"deck","source_id":"d 1","relationship_ids":["rel 1"]}""", last("POST", "/api/student-copies/update").second)
        assertEquals("added 3 new words", res.results.single().detail)
    }

    /** GET /api/me/homework keeps a link's details; a done event carries the note (and omits it when there is none). */
    @Test fun homeworkMirrorKeepsDetailsAndNotes() {
        val json = Json { ignoreUnknownKeys = true; explicitNulls = false }
        val a = json.decodeFromString(HomeworkAssignment.serializer(), """{"id":"as1","kind":"link","target_id":"lk1","mode":"one_off","details":{"url":"https://youtu.be/dQw4w9WgXcQ","instructions":"Listen twice.","thumbnail_url":null}}""")
        assertEquals("https://youtu.be/dQw4w9WgXcQ", a.details?.url)
        assertEquals("Listen twice.", a.details?.instructions)
        assertEquals("""{"id":"e1","assignment_id":"as1","item_id":"lk1","result":"done","created_at":"2026-10-03T08:00:00Z","note":"好听！"}""",
            json.encodeToString(HomeworkEvent.serializer(), HomeworkEvent("e1", "as1", "lk1", "done", "2026-10-03T08:00:00Z", "好听！")))
        assertFalse(json.encodeToString(HomeworkEvent.serializer(), HomeworkEvent("e1", "as1", "lk1", "done", "2026-10-03T08:00:00Z")).contains("note"))
    }

    @Test fun rowOptionsAndPaths() {
        val deck = LibraryItem(key = "deck:t1", kind = "deck", source_id = "d1", target_id = "t1", share_id = "sh1", status = "in_progress", due_assignment_id = "as1", student_name = "Jerome Swannack")
        val o = libraryRowOptions(deck)
        assertTrue(o.canOpen && o.canEdit && o.canUpdate && o.canChangeDue)
        assertEquals("Remove from Jerome's decks", o.removeLabel)
        assertEquals("/decks/d1", HomeworkLibraryViewModel.openPath(deck))
        assertEquals("/library/l1/edit", HomeworkLibraryViewModel.editPath(deck.copy(kind = "lesson", source_id = "l1")))
        assertEquals("/library/l1", HomeworkLibraryViewModel.openPath(deck.copy(kind = "lesson", source_id = "l1")))
        assertEquals("/readers/r1/edit", HomeworkLibraryViewModel.editPath(deck.copy(kind = "reader", source_id = "r1")))
        val gone = libraryRowOptions(deck.copy(source_id = null))
        assertFalse(gone.canOpen || gone.canEdit || gone.canUpdate)
        val link = libraryRowOptions(deck.copy(kind = "link", url = "https://youtu.be/x", status = "completed"))
        assertEquals("Cancel this link", link.removeLabel)
        assertFalse(link.canChangeDue)
        assertEquals("Also update Jerome's copy", alsoUpdateLabel("Jerome Swannack"))
    }
}
