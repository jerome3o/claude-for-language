package dev.jeromeswannack.chineselearning.lab.ui.strokes

import dev.jeromeswannack.chineselearning.lab.data.strokes.StrokeLoad
import dev.jeromeswannack.chineselearning.lab.data.strokes.StrokeStore
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

/** StrokeStore: file cache → network, SPA fallback = missing, offline, Save all. */
class StrokeStoreTest {
    @get:Rule val tmp = TemporaryFolder()
    private val server = MockWebServer()
    private val requests = mutableListOf<String>()
    private var down = false

    @Before fun start() {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.path.orEmpty()
                requests += path
                if (down) return MockResponse().setResponseCode(503)
                val name = path.removePrefix("/strokes/")
                val cp = name.removeSuffix(".json").toIntOrNull(16)
                val char = cp?.let { String(Character.toChars(it)) }
                val json = char?.let { TestStrokes.json(it) }
                return when {
                    json != null -> MockResponse().setHeader("Content-Type", "application/json").setBody(json)
                    char == "〇" -> MockResponse().setResponseCode(404)
                    else -> MockResponse().setHeader("Content-Type", "text/html").setBody("<!doctype html><title>app</title>")
                }
            }
        }
        server.start()
    }

    @After fun stop() = server.shutdown()

    private fun store(now: () -> Long = System::currentTimeMillis) = StrokeStore(tmp.root, server.url("/").toString().trimEnd('/'), now = now)

    @Test
    fun fetchesOnceThenServesFromFileEvenOffline() = runBlocking<Unit> {
        val s = store()
        val r = s.get("你")
        assertIs<StrokeLoad.Ok>(r)
        assertEquals(7, r.data.strokes.size)
        assertEquals(listOf("/strokes/4f60.json"), requests)
        down = true
        assertIs<StrokeLoad.Ok>(store().get("你"), "a new store (app restart) reads the file")
        assertEquals(1, requests.size)
        assertEquals(setOf("你"), s.cached(listOf("你", "好")))
    }

    @Test
    fun spaFallbackAnd404AreMissingAndRememberedForAWeek() = runBlocking<Unit> {
        var now = 1_000_000L
        val s = store { now }
        assertEquals(StrokeLoad.Missing, s.get("龘"))
        assertEquals(StrokeLoad.Missing, s.get("〇"))
        val before = requests.size
        assertEquals(StrokeLoad.Missing, store { now }.get("龘"))
        assertEquals(before, requests.size, "not asked again within the week")
        now += StrokeStore.MISSING_TTL_MS + 1
        store { now }.get("龘")
        assertEquals(before + 1, requests.size)
    }

    @Test
    fun serverDownIsOfflineAndNotRemembered() = runBlocking<Unit> {
        down = true
        assertEquals(StrokeLoad.Offline, store().get("好"))
        down = false
        assertIs<StrokeLoad.Ok>(store().get("好"))
    }

    @Test
    fun saveAllDownloadsWhatIsMissing() = runBlocking<Unit> {
        val s = store()
        s.get("十")
        val progress = mutableListOf<Pair<Int, Int>>()
        val r = s.prefetch(listOf("十", "你", "好", "三", "龘", "你")) { d, t -> synchronized(progress) { progress += d to t } }
        assertEquals(StrokeStore.PrefetchResult(saved = 3, missing = 1, failed = 0), r)
        assertEquals(setOf("十", "你", "好", "三"), s.cached(listOf("十", "你", "好", "三", "龘")))
        assertTrue(progress.contains(4 to 4))
        assertEquals("~2 KB", StrokeStore.sizeLabel(1))
        assertEquals("~1.2 MB", StrokeStore.sizeLabel(600))
    }
}
