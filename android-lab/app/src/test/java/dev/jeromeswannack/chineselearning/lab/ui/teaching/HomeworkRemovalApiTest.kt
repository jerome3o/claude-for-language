package dev.jeromeswannack.chineselearning.lab.ui.teaching

import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.api.SessionJobDto
import dev.jeromeswannack.chineselearning.lab.data.api.previewDeckRemoval
import dev.jeromeswannack.chineselearning.lab.data.api.previewLessonRemoval
import dev.jeromeswannack.chineselearning.lab.data.api.previewReaderRemoval
import dev.jeromeswannack.chineselearning.lab.data.api.removeStudentDeck
import dev.jeromeswannack.chineselearning.lab.data.api.removeStudentLesson
import dev.jeromeswannack.chineselearning.lab.data.api.removeStudentReader
import dev.jeromeswannack.chineselearning.lab.data.api.sharedReaders
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

/** Take homework back: the Lab calls exactly the worker's routes (routes/homework-removal.ts) and reads their answers. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class HomeworkRemovalApiTest {
    private lateinit var server: MockWebServer
    private lateinit var api: Api
    private val seen = mutableListOf<RecordedRequest>()

    @Before fun setUp() {
        server = MockWebServer().apply { start() }
        api = Api(server.url("").toString().removeSuffix("/")) { "t" }
        val routes = mapOf(
            "GET /api/relationships/rel%201/shared-decks/sd1/removal" to
                """{"kind":"deck","shared_deck_id":"sd1","target_deck_id":"t1","deck_name":null,"source_deck_id":"d1","source_deck_name":"HSK 1","words_total":319,"words_met":0,"reviews":0,"can_delete_source":true}""",
            "DELETE /api/relationships/rel%201/shared-decks/sd1" to """{"removed":true,"words_met":0,"reviews":0,"assignments_cancelled":1,"source_deleted":true}""",
            "GET /api/relationships/rel%201/student-lessons/l1/removal" to """{"kind":"lesson","lesson_id":"l1","title":"Tones","completions":2,"library_item_id":"lib1"}""",
            "DELETE /api/relationships/rel%201/student-lessons/l1" to """{"removed":true,"words_met":0,"reviews":0,"assignments_cancelled":0,"source_deleted":false}""",
            "GET /api/relationships/rel%201/shared-readers/sr1/removal" to """{"kind":"reader","shared_reader_id":"sr1","target_reader_id":"tr1","title":"小猫","page_count":8,"readings":3}""",
            "DELETE /api/relationships/rel%201/shared-readers/sr1" to """{"removed":true,"words_met":0,"reviews":0,"assignments_cancelled":0,"source_deleted":false}""",
            "GET /api/relationships/rel%201/shared-readers" to
                """[{"id":"sr1","relationship_id":"rel 1","source_reader_id":"r1","target_reader_id":"tr1","shared_at":"2026-09-24T10:00:00Z","source_title_chinese":null,"source_title_english":"Kitten","target_title_chinese":"小猫","target_title_english":null,"target_deleted":false,"page_count":8,"read_count":3,"last_read_at":null}]""",
        )
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                synchronized(seen) { seen += request }
                val body = routes["${request.method} ${request.path!!.substringBefore('?')}"] ?: return MockResponse().setResponseCode(404).setBody("""{"error":"Not found"}""")
                return MockResponse().setBody(body)
            }
        }
    }

    @After fun tearDown() = server.shutdown()

    @Test fun deckPreviewAndRemove() = runBlocking {
        val p = api.previewDeckRemoval("rel 1", "sd1")
        assertNull(p.deck_name) // the student already deleted their copy
        assertEquals(319, p.words_total)
        assertTrue(p.can_delete_source)

        val r = api.removeStudentDeck("rel 1", "sd1", deleteSource = true)
        assertEquals("DELETE", seen.last().method)
        assertEquals("/api/relationships/rel%201/shared-decks/sd1?delete_source=1", seen.last().path)
        assertTrue(r.source_deleted)

        api.removeStudentDeck("rel 1", "sd1", deleteSource = false)
        assertEquals("/api/relationships/rel%201/shared-decks/sd1", seen.last().path)
    }

    @Test fun lessonAndReader() = runBlocking {
        assertEquals(2, api.previewLessonRemoval("rel 1", "l1").completions)
        assertFalse(api.removeStudentLesson("rel 1", "l1").source_deleted)
        assertEquals("DELETE", seen.last().method)

        val p = api.previewReaderRemoval("rel 1", "sr1")
        assertEquals(3, p.readings)
        api.removeStudentReader("rel 1", "sr1")
        assertEquals("/api/relationships/rel%201/shared-readers/sr1", seen.last().path)

        val list = api.sharedReaders("rel 1")
        assertEquals("小猫", list.single().title) // source Chinese title missing → the copy's
    }

    @Test fun jobResultsCarryRemovedAt() {
        val job = api.json.decodeFromString(
            SessionJobDto.serializer(),
            """{"id":"j1","status":"done","created_at":"2026-10-02T10:00:00Z","result":{"deck":{"id":"d1","name":"HSK 1","note_count":319,"target_deck_id":"t1","removed_at":"2026-10-03T08:00:00Z"},"lessons":[{"library_item_id":"lib1","title":"Tones","lesson_id":"l1"}],"reader":{"id":"r1","title_english":"Kitten","target_reader_id":"tr1","removed_at":"2026-10-03T08:00:00Z"}}}""",
        )
        assertEquals("2026-10-03T08:00:00Z", job.result.deck!!.removed_at)
        assertNull(job.result.lessons.single().removed_at)
        assertEquals("2026-10-03T08:00:00Z", job.result.reader!!.removed_at)
    }
}
