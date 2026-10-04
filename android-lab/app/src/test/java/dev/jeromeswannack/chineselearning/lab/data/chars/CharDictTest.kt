package dev.jeromeswannack.chineselearning.lab.data.chars

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.core.CharWordStatus
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.CardEntity
import dev.jeromeswannack.chineselearning.lab.data.DeckEntity
import dev.jeromeswannack.chineselearning.lab.data.LabDatabase
import dev.jeromeswannack.chineselearning.lab.data.NoteEntity
import dev.jeromeswannack.chineselearning.lab.data.api.CharWordDto
import dev.jeromeswannack.chineselearning.lab.data.platform.JsonCache
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.net.URLDecoder
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

/**
 * The device dictionary (port of frontend/src/services/charDict.ts) against a fake API and an
 * in-memory cache: cache first, 404 = missing for a week, offline / errors, batched prefetch,
 * "More about" cached, and the word statuses from Room.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class CharDictTest {
    private lateinit var server: MockWebServer
    private lateinit var db: LabDatabase
    private lateinit var api: Api
    private lateinit var cache: JsonCache
    private var online = true
    private var now = 1_800_000_000_000L
    private val requests = CopyOnWriteArrayList<String>()
    private val routes = HashMap<String, (RecordedRequest) -> MockResponse>()

    private fun record(c: String) = """{"char":"$c","readings":[{"pinyin":"xíng","english":"to walk"}],"meaning":"to walk","radical":"行","radical_meaning":"walk","decomposition":null,"components":[],"etymology":null,"strokes":6,"rank":32,"words":[{"hanzi":"银行","pinyin":"yínháng","english":"bank"}]}"""

    private fun json(body: String, code: Int = 200) = MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)

    @Before fun setUp() {
        server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = URLDecoder.decode(request.path!!, "UTF-8")
                requests += "${request.method} $path"
                val key = "${request.method} ${path.substringBefore('?')}"
                return routes[key]?.invoke(request) ?: json("""{"error":"no route"}""", 404)
            }
        }
        server.start()
        db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), LabDatabase::class.java).allowMainThreadQueries().build()
        api = Api(server.url("").toString().removeSuffix("/")) { "t" }
        cache = JsonCache(db.platform(), api.json)
    }

    @After fun tearDown() {
        server.shutdown()
        db.close()
    }

    private fun dict() = CharDict(api, cache, online = { online }, now = { now })

    @Test fun lookupIsCacheFirstAndWorksOfflineAfterwards() = runBlocking {
        routes["GET /api/chars/行"] = { json("""{"version":1,"record":${record("行")}}""") }
        val first = dict().lookup("行")
        assertIs<CharDict.Lookup.Ok>(first)
        assertEquals("to walk", first.record.meaning)
        online = false
        val again = dict().lookup("行")
        assertIs<CharDict.Lookup.Ok>(again)
        assertEquals(1, requests.size, "the second look-up came from the device")
    }

    @Test fun missingIsRememberedForAWeek() = runBlocking {
        routes["GET /api/chars/㐀"] = { json("""{"error":"Not in the dictionary"}""", 404) }
        assertEquals(CharDict.Lookup.Missing, dict().lookup("㐀"))
        now += 6L * 24 * 60 * 60 * 1000
        assertEquals(CharDict.Lookup.Missing, dict().lookup("㐀"))
        assertEquals(1, requests.size)
        now += 2L * 24 * 60 * 60 * 1000
        assertEquals(CharDict.Lookup.Missing, dict().lookup("㐀"))
        assertEquals(2, requests.size, "asked again after a week")
    }

    @Test fun offlineAndErrors() = runBlocking {
        online = false
        assertEquals(CharDict.Lookup.Offline, dict().lookup("钱"))
        assertTrue(requests.isEmpty())
        online = true
        routes["GET /api/chars/钱"] = { json("""{"error":"The dictionary is unavailable just now"}""", 502) }
        val err = dict().lookup("钱")
        assertIs<CharDict.Lookup.Error>(err)
        assertEquals("The dictionary is unavailable just now", err.message)
        val unreachable = CharDict(Api("http://127.0.0.1:1") { "t" }, cache, online = { true }, now = { now })
        assertEquals(CharDict.Lookup.Offline, unreachable.lookup("钱"), "no network = offline")
    }

    @Test fun prefetchBatchesAndSkipsWhatTheDeviceHas() = runBlocking {
        val chars = (0 until 150).map { String(Character.toChars(0x4e00 + it)) }
        routes["GET /api/chars"] = { req ->
            val c = URLDecoder.decode(req.path!!, "UTF-8").substringAfter("c=")
            val cps = c.codePoints().toArray().map { String(Character.toChars(it)) }
            val records = cps.drop(1).joinToString(",") { "\"$it\":${record(it)}" }
            json("""{"version":1,"records":{$records},"missing":["${cps.first()}"]}""")
        }
        assertEquals(148, dict().prefetch(chars + listOf("a", "银行", chars[0])))
        assertEquals(2, requests.size, "100 + 50 characters")
        assertTrue(requests[0].contains(chars.take(100).joinToString("")))
        online = false
        assertIs<CharDict.Lookup.Ok>(dict().lookup(chars[5]))
        assertEquals(CharDict.Lookup.Missing, dict().lookup(chars[0]))
        assertEquals(0, dict().prefetch(chars))
        assertEquals(2, requests.size, "nothing left to fetch")
    }

    @Test fun explainIsCached() = runBlocking {
        routes["POST /api/chars/行/explain"] = { json("""{"char":"行","explanation":"A crossroads.","cached":false}""") }
        assertEquals(CharDict.Explain.Ok("A crossroads."), dict().explain("行"))
        online = false
        assertEquals(CharDict.Explain.Ok("A crossroads."), dict().explain("行"))
        assertEquals(CharDict.Explain.Offline, dict().explain("钱"))
        online = true
        routes["POST /api/chars/钱/explain"] = { json("""{"error":"AI is not configured","retryable":false}""", 503) }
        assertEquals(CharDict.Explain.Error("AI is not configured"), dict().explain("钱"))
        assertEquals(2, requests.size)
    }

    @Test fun statusesFromRoom() = runBlocking {
        val dao = db.dao()
        dao.upsertDecks(listOf(DeckEntity("d1", "HSK 3", null, 3, 6, 0, "2026-09-01T00:00:00Z")))
        fun note(id: String, deck: String, hanzi: String) = NoteEntity(id, deck, hanzi, "", "", null, null, null, null, null, null, null, null, null)
        dao.upsertNotes(listOf(note("n1", "d1", "银行"), note("n2", "d1", "不行"), note("n3", "gone", "进行")))
        dao.upsertCards(listOf(
            CardEntity("c1", "n1", "d1", "hanzi_to_meaning", queue = 1, stability = 0.5),
            CardEntity("c2", "n2", "d1", "hanzi_to_meaning", queue = 2, stability = 40.0),
        ))
        val words = listOf(CharWordDto("进行"), CharWordDto("银行"), CharWordDto("不行"), CharWordDto("行业"))
        val rows = CharDict.statuses(dao, words, "我去银行")
        assertEquals(listOf("银行", "进行", "不行", "行业"), rows.map { it.word.hanzi }, "the card's word first")
        assertEquals(listOf(CharWordStatus.InDecks, CharWordStatus.None, CharWordStatus.Known, CharWordStatus.None), rows.map { it.status }, "a note of a deck that's gone doesn't count")
        assertEquals(listOf("n1"), rows[0].noteIds)
        assertTrue(rows[0].current)
    }

    @Test fun pureHelpers() {
        assertTrue(CharDict.isLookupChar("行"))
        assertTrue(!CharDict.isLookupChar("银行") && !CharDict.isLookupChar("a") && !CharDict.isLookupChar(""))
        assertEquals(listOf("银", "行", "不"), CharDict.lookupChars(listOf("银行。", "不行!")))
        val t = 1_000_000_000L
        val cards = listOf(
            CardEntity("a", "late", "d", "x", queue = 2, dueTimestamp = t + 2 * 86_400_000L),
            CardEntity("b", "soon", "d", "x", queue = 2, dueTimestamp = t + 3_600_000L),
            CardEntity("c", "now", "d", "x", queue = 1, dueTimestamp = t),
            CardEntity("d", "new1", "d", "x", queue = 0),
            CardEntity("e", "now", "d", "y", queue = 0),
            CardEntity("f", "new2", "d", "x", queue = 0),
        )
        assertEquals(listOf("now", "soon", "new1"), CharDict.upcomingNoteIds(cards, t, limit = 3))
        assertTrue(CharDict.needsFetch(null, t))
        assertTrue(!CharDict.needsFetch(CharDict.Entry(1, null, t), t + 1))
        assertTrue(CharDict.needsFetch(CharDict.Entry(1, null, t), t + CharDict.MISSING_RETRY_MS))
        assertTrue(CharDict.needsFetch(CharDict.Entry(0, null, t), t))
    }
}
