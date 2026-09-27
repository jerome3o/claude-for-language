package dev.jeromeswannack.chineselearning.lab.ui.editor

import android.os.Looper
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.core.spec.JsJson
import dev.jeromeswannack.chineselearning.lab.core.spec.LessonCatalogue
import dev.jeromeswannack.chineselearning.lab.core.spec.str
import dev.jeromeswannack.chineselearning.lab.core.spec.with
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.LabDatabase
import dev.jeromeswannack.chineselearning.lab.data.platform.JsonCache
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * The editors' ViewModels against a fake API (MockWebServer) and an in-memory offline cache:
 * load, live validation, save (and its 400 problems), drafts that survive the screen, the
 * offline copy, the co-editor chat (send / 503 / accept), reader image polling and assist.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class EditorViewModelTest {
    private lateinit var server: MockWebServer
    private lateinit var db: LabDatabase
    private lateinit var deps: EditorDeps
    private var online = true
    private val requests = CopyOnWriteArrayList<Pair<String, String>>()
    private val routes = HashMap<String, (String) -> MockResponse>()

    private val lesson: JsonObject = LessonCatalogue.sample("choice")!!.spec

    @Before fun setUp() {
        server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val key = "${request.method} ${request.path}"
                val body = request.body.readUtf8()
                requests += key to body
                return routes[key]?.invoke(body) ?: MockResponse().setResponseCode(404).setBody("""{"error":"no route $key"}""")
            }
        }
        server.start()
        db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), LabDatabase::class.java).allowMainThreadQueries().build()
        val api = Api(server.url("").toString().removeSuffix("/")) { "t" }
        deps = EditorDeps(api, JsonCache(db.platform(), api.json), online = { online })
    }

    @After fun tearDown() {
        server.shutdown()
        db.close()
    }

    private fun json(body: String, code: Int = 200) = MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)

    private fun route(key: String, body: () -> String) { routes[key] = { json(body()) } }

    private fun await(what: String, timeoutMs: Long = 5_000, cond: () -> Boolean) {
        val end = System.currentTimeMillis() + timeoutMs
        while (!cond()) {
            shadowOf(Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(50))
            if (System.currentTimeMillis() > end) throw AssertionError("timed out waiting for $what; requests=${requests.map { it.first }}")
            Thread.sleep(10)
        }
    }

    private fun libraryItem(spec: JsonObject) = """{"id":"L1","title":"t","spec":$spec,"tags":[],"version":1,"assignment_count":0}"""

    private fun emptyChat() = route("GET /api/editor-chat/library/L1") { """{"chat":{"id":"c"},"ai_available":true,"messages":[]}""" }

    @Test fun loadsEditsValidatesAndSaves() {
        route("GET /api/lesson-library/L1") { libraryItem(lesson) }
        emptyChat()
        var saved: JsonObject? = null
        routes["PUT /api/lesson-library/L1"] = { req ->
            saved = Json.parseToJsonElement(req).jsonObject["spec"]!!.jsonObject
            json(libraryItem(saved!!))
        }
        val vm = LessonEditorViewModel(deps, "library", "L1")
        await("load") { vm.ui.value.spec != null }
        assertFalse(vm.ui.value.dirty)
        assertEquals(emptyList(), vm.ui.value.errors)
        assertEquals("Library master copy", vm.subtitle)

        // Blank title → a live problem and Save is refused.
        vm.setSpec(lesson.with("title", ""))
        assertTrue(vm.ui.value.dirty)
        assertEquals(listOf("lesson needs a non-empty \"title\""), vm.ui.value.errors)
        vm.save()
        assertFalse(vm.ui.value.saving)

        vm.setSpec(lesson.with("title", "新的标题"))
        vm.save()
        await("saved") { !vm.ui.value.dirty && vm.ui.value.notice == "Saved" }
        assertEquals("新的标题", saved!!.str("title"))
    }

    @Test fun saveShowsTheServersProblems() {
        route("GET /api/lesson-library/L1") { libraryItem(lesson) }
        emptyChat()
        routes["PUT /api/lesson-library/L1"] = { json("""{"error":"Invalid","problems":["sections[0]: nope"]}""", 400) }
        val vm = LessonEditorViewModel(deps, "library", "L1")
        await("load") { vm.ui.value.spec != null }
        vm.setSpec(lesson.with("title", "x"))
        vm.save()
        await("error") { vm.ui.value.notice?.startsWith("Not saved") == true }
        assertEquals("Not saved: sections[0]: nope", vm.ui.value.notice)
        assertTrue(vm.ui.value.noticeIsError)
        assertTrue(vm.ui.value.dirty)
    }

    @Test fun unsavedEditsComeBackAndCanBeDiscarded() {
        route("GET /api/lesson-library/L1") { libraryItem(lesson) }
        emptyChat()
        val first = LessonEditorViewModel(deps, "library", "L1")
        await("load") { first.ui.value.spec != null }
        first.setSpec(lesson.with("title", "草稿"))
        await("draft written") { kotlinx.coroutines.runBlocking { deps.cache.get("editor/draft/library/L1", JsonObject.serializer()) } != null }

        val second = LessonEditorViewModel(deps, "library", "L1")
        await("reload") { second.ui.value.spec != null }
        assertTrue(second.ui.value.restoredDraft)
        assertEquals("草稿", second.ui.value.spec!!.str("title"))
        assertTrue(second.ui.value.dirty)

        second.discardDraft()
        await("discarded") { !second.ui.value.restoredDraft }
        assertEquals(lesson.str("title"), second.ui.value.spec!!.str("title"))
    }

    @Test fun opensTheCachedCopyOffline() {
        route("GET /api/lesson-library/L1") { libraryItem(lesson) }
        emptyChat()
        val vm = LessonEditorViewModel(deps, "library", "L1")
        await("load") { vm.ui.value.spec != null }
        online = false
        routes.clear()
        val offline = LessonEditorViewModel(deps, "library", "L1")
        await("offline load") { offline.ui.value.spec != null }
        assertEquals(JsJson.canonical(lesson), JsJson.canonical(offline.ui.value.spec))
        assertTrue(offline.ui.value.notice!!.startsWith("You're offline"))
    }

    @Test fun chatSendsTheCurrentSpecAndAcceptsAProposal() {
        route("GET /api/lesson-library/L1") { libraryItem(lesson) }
        emptyChat()
        val proposed = lesson.with("title", "Claude's version")
        route("POST /api/editor-chat/library/L1/messages") {
            """{"user_message":{"id":"u1","role":"user","content":"Make it easier","author_changes":[]},
               "message":{"id":"a1","role":"assistant","content":"Here you go","proposal_status":"pending","proposed_spec":$proposed,
               "proposal_diff":{"changed":true,"meta":[{"field":"title","before":"x","after":"Claude's version"}],"sections":[],"exercises":[]},"author_changes":[]}}"""
        }
        route("POST /api/editor-chat/library/L1/messages/a1/accept") { "{}" }
        val vm = LessonEditorViewModel(deps, "library", "L1")
        await("load") { vm.ui.value.spec != null && !vm.chat.ui.value.loading }
        vm.chat.send("Make it easier", vm.ui.value.spec!!, emptyList())
        await("reply") { vm.chat.ui.value.messages.size == 2 && !vm.chat.ui.value.sending }
        val sent = Json.parseToJsonElement(requests.first { it.first == "POST /api/editor-chat/library/L1/messages" }.second).jsonObject
        assertEquals("Make it easier", sent["message"]!!.str())
        assertEquals(JsJson.canonical(lesson), JsJson.canonical(sent["current_spec"]))

        vm.chat.decide(vm.chat.ui.value.messages[1], accept = true)
        await("accepted") { requests.any { it.first.endsWith("/a1/accept") } }
        assertEquals("Claude's version", vm.ui.value.spec!!.str("title"))
        assertEquals("accepted", vm.chat.ui.value.messages[1].proposal_status)
        assertTrue(vm.ui.value.dirty)
        // The author's own edits since the accepted proposal are listed for Claude.
        val edited = vm.ui.value.spec!!.with("title", "Mine again")
        assertEquals(listOf("title: \"Claude's version\" → \"Mine again\""), pendingChangesFor(vm.chat.ui.value.messages, edited, EditorChatKind.LESSON))
    }

    @Test fun chatSays503IsNotConfigured() {
        route("GET /api/lesson-library/L1") { libraryItem(lesson) }
        emptyChat()
        routes["POST /api/editor-chat/library/L1/messages"] = { json("""{"error":"no key"}""", 503) }
        val vm = LessonEditorViewModel(deps, "library", "L1")
        await("load") { vm.ui.value.spec != null && !vm.chat.ui.value.loading }
        vm.chat.send("hi", lesson, emptyList())
        await("error") { vm.chat.ui.value.error != null }
        assertEquals("Claude is not configured on this server.", vm.chat.ui.value.error)
        assertEquals("hi", vm.chat.ui.value.draft)
        assertTrue(vm.chat.ui.value.messages.isEmpty())
    }

    // ---------------- reader ----------------

    private val reader = Json.parseToJsonElement(
        """{"title_chinese":"长春的冬天","title_english":"Winter in Changchun","difficulty_level":"beginner","topic":"winter","vocabulary_used":[],
            "pages":[{"id":"p1","content_chinese":"长春的冬天很冷。","content_pinyin":"","content_english":"Winter is cold.","image_prompt":"A snowy street","image_url":null}]}""",
    ).jsonObject

    private fun readerBody(spec: JsonObject, jobs: Int = 0) = """{"id":"R1","status":"ready","is_published":1,"spec":$spec,"image_jobs":$jobs}"""

    @Test fun readerSavePollsForIllustrations() {
        var calls = 0
        routes["GET /api/readers/R1/spec"] = {
            calls++
            json(readerBody(if (calls >= 3) reader.withObjs("pages", reader.objs("pages").map { it.with("image_url", "images/p1.png") }) else reader))
        }
        route("GET /api/editor-chat/reader/R1") { """{"ai_available":true,"messages":[]}""" }
        routes["PUT /api/readers/R1/spec"] = { req -> json(readerBody(Json.parseToJsonElement(req).jsonObject["spec"]!!.jsonObject, jobs = 1)) }
        val vm = ReaderEditorViewModel(deps, "R1", pollMs = 20)
        await("load") { vm.ui.value.spec != null }
        vm.setSpec(reader.with("title_english", "Cold winter"))
        vm.save()
        await("image adopted") { vm.ui.value.spec!!.objs("pages")[0].str("image_url") == "images/p1.png" }
        assertEquals("Cold winter", vm.ui.value.spec!!.str("title_english"))
        assertFalse(vm.ui.value.dirty)
    }

    @Test fun readerAssistTranslatesThePage() {
        route("GET /api/readers/R1/spec") { readerBody(reader) }
        route("GET /api/editor-chat/reader/R1") { """{"ai_available":true,"messages":[]}""" }
        route("POST /api/readers/R1/assist") { """{"text":"Winter in Changchun is very cold."}""" }
        val vm = ReaderEditorViewModel(deps, "R1")
        await("load") { vm.ui.value.spec != null }
        vm.assist(0, "english")
        await("translated") { vm.ui.value.spec!!.objs("pages")[0].str("content_english") == "Winter in Changchun is very cold." }
        val body = Json.parseToJsonElement(requests.first { it.first == "POST /api/readers/R1/assist" }.second).jsonObject
        assertEquals("english", body["field"]!!.str())
        assertEquals("长春的冬天很冷。", body["chinese"]!!.str())
        assertTrue(vm.ui.value.busy.isEmpty())
        assertNotNull(vm.ui.value.spec)
    }

    @Test fun rawJsonIsValidatedBeforeItIsApplied() {
        route("GET /api/readers/R1/spec") { readerBody(reader) }
        route("GET /api/editor-chat/reader/R1") { """{"ai_available":true,"messages":[]}""" }
        val vm = ReaderEditorViewModel(deps, "R1")
        await("load") { vm.ui.value.spec != null }
        assertTrue(vm.applyRawJson("{not json").single().startsWith("Not valid JSON"))
        assertEquals(listOf("pages must be an array"), vm.applyRawJson("""{"title_chinese":"a","title_english":"b","difficulty_level":"beginner"}"""))
        assertEquals(emptyList(), vm.applyRawJson(JsJson.stringifyPretty(reader.with("title_chinese", "夏天"))))
        assertEquals("夏天", vm.ui.value.spec!!.str("title_chinese"))
    }

    private fun kotlinx.serialization.json.JsonElement.str(): String = JsJson.str(this)!!
}
