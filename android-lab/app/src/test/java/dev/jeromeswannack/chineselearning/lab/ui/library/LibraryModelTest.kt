package dev.jeromeswannack.chineselearning.lab.ui.library

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.LabDatabase
import dev.jeromeswannack.chineselearning.lab.data.api.LibraryItemSummary
import dev.jeromeswannack.chineselearning.lab.data.api.MyRelationshipsDto
import dev.jeromeswannack.chineselearning.lab.data.platform.JsonCache
import dev.jeromeswannack.chineselearning.lab.ui.catalogue.CatalogueModel
import dev.jeromeswannack.chineselearning.lab.ui.catalogue.catalogueGroups
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavKeys
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.job
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
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
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.concurrent.CopyOnWriteArrayList

/** The library models against a fake server: the web's calls, bodies and messages. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class LibraryModelTest {
    private lateinit var server: MockWebServer
    private lateinit var db: LabDatabase
    private lateinit var deps: LibraryDeps
    private lateinit var scope: CoroutineScope
    private val requests = CopyOnWriteArrayList<Pair<String, String>>()
    private val routes = HashMap<String, MockResponse>()

    private val itemsJson = """{"items":[{"id":"lib1","title":"把 sentences in the kitchen","exercise_count":8,"assignment_count":1,"updated_at":"2026-09-27 09:30:00","tags":["grammar"]},{"id":"lib2","title":"Checking in at a hotel","exercise_count":3,"updated_at":"2026-09-24T08:15:00Z"}]}"""
    private val itemJson = """{"id":"new1","title":"New lesson","version":1,"spec":{"title":"New lesson","sections":[]}}"""

    @Before fun setUp() {
        server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val key = "${request.method} ${request.path}"
                requests += key to request.body.readUtf8()
                return routes[key] ?: MockResponse().setResponseCode(404).setBody("""{"error":"no route $key"}""")
            }
        }
        server.start()
        db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), LabDatabase::class.java).allowMainThreadQueries().build()
        val api = Api(server.url("").toString().removeSuffix("/")) { "t" }
        deps = LibraryDeps(api, JsonCache(db.platform(), api.json), today = { LocalDate.of(2026, 9, 27) }, noticeMs = 60_000)
        scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        routes["GET /api/lesson-library"] = ok(itemsJson)
    }

    @After fun tearDown() {
        // Wait for the models' coroutines to finish before closing the database. `cancel()` alone
        // returns while a Room query of a CachedResource flow is still running on an IO thread; it
        // then fails on the closed database, and kotlinx-coroutines-test reports that uncaught
        // exception in the NEXT test that uses runTest (CI: ReaderWordsComposeTest failed with
        // UncaughtExceptionsBeforeTest, "connection pool has been closed").
        runBlocking { scope.coroutineContext.job.cancelAndJoin() }
        server.shutdown()
        db.close()
    }

    private fun ok(body: String, code: Int = 200) = MockResponse().setResponseCode(code).setBody(body)
    private fun body(key: String) = requests.last { it.first == key }.second
    private suspend fun <T> await(flow: kotlinx.coroutines.flow.Flow<T>, test: (T) -> Boolean): T = withTimeout(10_000) { flow.first(test) }

    @Test fun listLoadsAndIsCached() = runBlocking {
        val model = LibraryModel(scope, deps)
        val ui = await(model.ui) { it.list.data != null }
        assertEquals(listOf("lib1", "lib2"), ui.list.data!!.map { it.id })
        assertEquals(2, deps.cache.get(LibraryKeys.LIST, ListSerializer(LibraryItemSummary.serializer()))!!.size)
    }

    @Test fun longTermAssignUsesTheLibraryEndpointAndTheWebMessage() = runBlocking {
        deps.cache.put(NavKeys.RELATIONSHIPS, NavKeys.KIND, LibrarySamples.relationships, MyRelationshipsDto.serializer())
        routes["GET /api/relationships"] = ok(Json.encodeToString(MyRelationshipsDto.serializer(), LibrarySamples.relationships))
        routes["GET /api/lesson-library/lib1/assignments"] = ok("""{"assignments":[{"lesson_id":"cl1","relationship_id":"rel-jerome","student":{"id":"u-jerome","name":"Jerome"}}]}""")
        routes["POST /api/lesson-library/lib1/assign"] = ok("""{"assigned":[{"relationship_id":"rel-tom"}],"already_had":[{"relationship_id":"rel-mei"}],"errors":[]}""")
        val model = LibraryModel(scope, deps)
        model.assign(LibrarySamples.items[0])
        val open = await(model.ui) { it.assign?.students?.any { s -> s.name == "Jerome" && s.hasIt } == true }.assign!!
        assertEquals(listOf(true, false, false), open.students!!.map { it.hasIt })
        assertEquals(HomeworkMode.BOTH, open.mode) // the default, like the Send homework sheet
        model.assign.setMode(HomeworkMode.FSRS)
        model.assign.toggle("rel-tom")
        model.assign.toggle("rel-mei")
        model.assign.submit()
        val done = await(model.ui) { it.assign == null && it.notice != null }
        assertEquals("“把 sentences in the kitchen” assigned to 1 student, 1 already had it", done.notice!!.text)
        assertEquals(NoticeKind.Success, done.notice!!.kind)
        val ids = Json.parseToJsonElement(body("POST /api/lesson-library/lib1/assign")).jsonObject["relationship_ids"]!!.jsonArray.map { it.jsonPrimitive.content }.toSet()
        assertEquals(setOf("rel-tom", "rel-mei"), ids)
    }

    @Test fun oneOffAssignPostsHomeworkPerStudentWithTheDueDate() = runBlocking {
        deps.cache.put(NavKeys.RELATIONSHIPS, NavKeys.KIND, LibrarySamples.relationships, MyRelationshipsDto.serializer())
        routes["POST /api/relationships/rel-tom/homework"] = ok("""{"assignments":[{"id":"a1"}],"errors":[]}""", 201)
        val model = LibraryModel(scope, deps)
        model.assign(LibrarySamples.items[0])
        await(model.ui) { it.assign?.students != null }
        model.assign.toggle("rel-tom")
        model.assign.setMode(HomeworkMode.ONE_OFF)
        model.assign.setDue(LocalDate.of(2026, 10, 4))
        model.assign.submit()
        val done = await(model.ui) { it.assign == null && it.notice != null }
        assertEquals("Assigned “把 sentences in the kitchen” to 1 student — due Sun 4 Oct", done.notice!!.text)
        val item = Json.parseToJsonElement(body("POST /api/relationships/rel-tom/homework")).jsonObject
        val first = item["items"]!!.jsonArray[0].jsonObject
        assertEquals("lesson", first["kind"]!!.jsonPrimitive.content)
        assertEquals("lib1", first["source_id"]!!.jsonPrimitive.content)
        assertEquals("one_off", first["mode"]!!.jsonPrimitive.content)
        assertEquals("2026-10-04", first["due_date"]!!.jsonPrimitive.content)
        assertEquals("2026-09-27", item["today"]!!.jsonPrimitive.content)
    }

    @Test fun assignFailureStaysInTheSheet() = runBlocking {
        deps.cache.put(NavKeys.RELATIONSHIPS, NavKeys.KIND, LibrarySamples.relationships, MyRelationshipsDto.serializer())
        routes["POST /api/relationships/rel-tom/homework"] = ok("""{"error":"Only the tutor can assign"}""", 403)
        val model = LibraryModel(scope, deps)
        model.assign(LibrarySamples.items[0])
        await(model.ui) { it.assign?.students != null }
        model.assign.toggle("rel-tom")
        model.assign.submit() // Both by default → the homework model's call
        val ui = await(model.ui) { it.assign?.error != null }
        assertEquals("Only the tutor can assign", ui.assign!!.error)
        assertEquals(false, ui.assign!!.busy)
    }

    @Test fun startBlankPostsTheWebBlankSpecAndOpensTheEditor() = runBlocking {
        routes["POST /api/lesson-library"] = ok(itemJson, 201)
        val model = LibraryModel(scope, deps)
        val effect = async(start = kotlinx.coroutines.CoroutineStart.UNDISPATCHED) { withTimeout(10_000) { model.effects.first() } }
        model.openNewLesson()
        model.startBlank()
        assertEquals(LibraryEffect.Open(Routes.libraryEdit("new1")), effect.await())
        val spec = Json.parseToJsonElement(body("POST /api/lesson-library")).jsonObject["spec"]!!.jsonObject
        assertEquals(blankLessonSpec(), spec)
        assertEquals(null, await(model.ui) { it.newLesson == null }.newLesson)
    }

    @Test fun draftWithoutClaudeSaysStartBlank() = runBlocking {
        routes["POST /api/lesson-library"] = ok("""{"error":"AI not configured"}""", 503)
        val model = LibraryModel(scope, deps)
        model.openNewLesson()
        model.editNewLesson { it.copy(situation = "Booking a hotel room by phone", level = CONVERSATION_LEVELS[1]) }
        model.draftConversation()
        val ui = await(model.ui) { it.newLesson?.error != null }
        assertEquals(LibraryText.CLAUDE_MISSING, ui.newLesson!!.error)
        val prompt = Json.parseToJsonElement(body("POST /api/lesson-library")).jsonObject["generate"]!!.jsonObject["prompt"]!!.jsonPrimitive.content
        assertEquals(conversationLessonPrompt("Booking a hotel room by phone", "Elementary (HSK 3)").trim(), prompt)
        assertTrue(prompt.startsWith("A conversation lesson for a Elementary (HSK 3) learner. Situation: Booking a hotel room by phone."))
    }

    @Test fun importUnwrapsAnExportAndOpensTheItem() = runBlocking {
        routes["POST /api/lesson-library/import"] = ok("""{"id":"imp1","title":"Weather","spec":{"title":"Weather","sections":[]}}""", 201)
        val model = LibraryModel(scope, deps)
        val effect = async(start = kotlinx.coroutines.CoroutineStart.UNDISPATCHED) { withTimeout(10_000) { model.effects.first() } }
        model.importJson("""{"version":1,"spec":{"title":"Weather","sections":[]}}""")
        assertEquals(LibraryEffect.Open(Routes.libraryItem("imp1")), effect.await())
        assertEquals("Weather", Json.parseToJsonElement(body("POST /api/lesson-library/import")).jsonObject["spec"]!!.jsonObject["title"]!!.jsonPrimitive.content)
        assertEquals("Imported “Weather”", await(model.ui) { it.notice != null }.notice!!.text)
    }

    @Test fun importOfJunkSaysSo() = runBlocking {
        val model = LibraryModel(scope, deps)
        model.importJson("not json {")
        assertEquals("Import failed: not a lesson JSON file", await(model.ui) { it.notice != null }.notice!!.text)
    }

    @Test fun archiveRemovesTheItem() = runBlocking {
        routes["DELETE /api/lesson-library/lib2"] = ok("""{"ok":true}""")
        val model = LibraryModel(scope, deps)
        val item = await(model.ui) { it.list.data != null }.list.data!![1]
        routes["GET /api/lesson-library"] = ok("""{"items":[{"id":"lib1","title":"把 sentences in the kitchen"}]}""")
        model.archive(item)
        val ui = await(model.ui) { it.notice?.text == "Archived" && it.list.data?.size == 1 }
        assertEquals(listOf("lib1"), ui.list.data!!.map { it.id })
    }

    @Test fun pushUpdateReportsCopies() = runBlocking {
        routes["GET /api/lesson-library/lib1"] = ok(Json.encodeToString(dev.jeromeswannack.chineselearning.lab.data.api.LibraryItemDto.serializer(), LibrarySamples.item))
        routes["GET /api/lesson-library/lib1/assignments"] = ok("""{"assignments":[]}""")
        routes["POST /api/lesson-library/lib1/push-update"] = ok("""{"updated":2,"skipped":1}""")
        val model = LibraryItemModel(scope, deps, "lib1")
        await(model.ui) { it.item.data != null }
        model.push()
        assertEquals("Updated 2 student copies, 1 already current", await(model.ui) { it.notice != null }.notice!!.text)
    }

    @Test fun catalogueCopyCreatesALibraryItemAndOpensItsEditor() = runBlocking {
        routes["POST /api/lesson-library"] = ok(itemJson, 201)
        val model = CatalogueModel(scope, deps)
        val open = async(start = kotlinx.coroutines.CoroutineStart.UNDISPATCHED) { withTimeout(10_000) { model.opens.first() } }
        val sample = LibrarySamples.conversationSample
        model.copy(sample)
        assertEquals(Routes.libraryEdit("new1"), open.await())
        assertEquals(sample.spec, Json.parseToJsonElement(body("POST /api/lesson-library")).jsonObject["spec"] as JsonObject)
    }

    @Test fun catalogueGroupsFollowTheWebSkillOrder() {
        assertEquals(listOf("listening", "speaking", "writing", "reading", "teaching"), catalogueGroups(null).map { it.skill })
        assertEquals(15, catalogueGroups(null).sumOf { it.types.size })
        assertEquals(listOf("speaking"), catalogueGroups("speaking").map { it.skill })
    }

    @Test fun studentsAreTheNonTutorSide() {
        val options = studentOptions(LibrarySamples.relationships, LibrarySamples.assignments)
        assertEquals(listOf("Jerome", "王美丽 Mei", "Tom Baker"), options.map { it.name })
        assertEquals(listOf(true, true, false), options.map { it.hasIt })
    }

    @Test fun datesReadAsUtcWithoutAZone() {
        val utc = ZoneOffset.UTC
        val tokyo = java.time.ZoneId.of("Asia/Tokyo")
        assertEquals("Sep 27", LibraryText.shortDate("2026-09-27 09:30:00", utc))
        assertEquals("Sep 28", LibraryText.shortDate("2026-09-27 20:30:00", tokyo))
        assertEquals("Sep 28", LibraryText.shortDate("2026-09-27T20:30:00Z", tokyo))
        assertEquals("—", LibraryText.shortDate(null))
        assertEquals("Mon 28 Sep", LibraryText.shortDay(LocalDate.of(2026, 9, 28)))
    }
}
