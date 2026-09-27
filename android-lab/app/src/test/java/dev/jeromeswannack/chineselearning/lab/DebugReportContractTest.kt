package dev.jeromeswannack.chineselearning.lab

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.DebugReporter
import dev.jeromeswannack.chineselearning.lab.data.LabDatabase
import dev.jeromeswannack.chineselearning.lab.data.Prefs
import dev.jeromeswannack.chineselearning.lab.data.Repository
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The Lab app's debug report upload against a REAL worker (opt-in like SyncContractTest):
 * sync through the real Repository / Api, send the report through DebugReporter, read it back,
 * then compare it with a "web" copy through GET /api/debug/compare.
 * `LAB_E2E_API=http://localhost:8787 ./gradlew :app:testDebugUnitTest --tests '*DebugReportContractTest*'`
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class DebugReportContractTest {
    private val base = System.getenv("LAB_E2E_API")
    private val http = OkHttpClient()
    private val json = Json { ignoreUnknownKeys = true }

    private fun call(method: String, path: String, token: String?, body: String? = null): String {
        val b = Request.Builder().url("$base$path")
        token?.let { b.header("Authorization", "Bearer $it") }
        b.method(method, body?.toRequestBody("application/json".toMediaType()))
        http.newCall(b.build()).execute().use { res ->
            val text = res.body!!.string()
            check(res.isSuccessful) { "$method $path → ${res.code}: $text" }
            return text
        }
    }

    private fun obj(s: String) = json.parseToJsonElement(s).jsonObject

    @Test
    fun uploadsAReportAfterSyncAndTheServerComparesIt() = runBlocking {
        assumeTrue("set LAB_E2E_API to run against a local worker", base != null)
        val token = obj(call("POST", "/api/test/auth", null, """{"email":"lab-debug-${UUID.randomUUID()}@example.com","name":"Lab"}"""))["session_token"]!!.jsonPrimitive.content
        val deckId = obj(call("POST", "/api/decks", token, """{"name":"调试 deck"}"""))["id"]!!.jsonPrimitive.content
        for ((h, p, e) in listOf(Triple("打算", "dǎsuàn", "to plan"), Triple("周末", "zhōumò", "weekend"))) {
            call("POST", "/api/decks/$deckId/notes", token, """{"hanzi":"$h","pinyin":"$p","english":"$e"}""")
        }
        val card = obj(call("GET", "/api/decks/$deckId", token))["notes"]!!.jsonArray[0].jsonObject["cards"]!!.jsonArray[0].jsonObject["id"]!!.jsonPrimitive.content
        call("POST", "/api/reviews", token, """{"events":[{"id":"${UUID.randomUUID()}","card_id":"$card","rating":2,"reviewed_at":"2026-09-20T08:00:00.000Z"}]}""")

        val ctx = ApplicationProvider.getApplicationContext<android.app.Application>()
        val db = Room.inMemoryDatabaseBuilder(ctx, LabDatabase::class.java).allowMainThreadQueries().build()
        val prefs = Prefs(ctx).apply { clearAccount(); sessionToken = token }
        val repo = Repository(ctx, db, Api(base!!) { prefs.sessionToken }, prefs)
        repo.sync()
        assertEquals(null, repo.status.value.error)

        val sent = DebugReporter(ctx, repo, "0.9-contract").send()
        assertTrue(sent.summary.contains("6 cards"), sent.summary)

        // Listed, and readable section by section.
        val list = obj(call("GET", "/api/debug/reports?client=lab", token))["reports"]!!.jsonArray
        assertEquals(sent.id, list[0].jsonObject["id"]!!.jsonPrimitive.content)
        assertEquals("0.9-contract", list[0].jsonObject["app_version"]!!.jsonPrimitive.content)
        val overview = obj(call("GET", "/api/debug/reports/${sent.id}", token))
        assertEquals(6, overview["card_rows"]!!.jsonPrimitive.int)
        val cardsPage = obj(call("GET", "/api/debug/reports/${sent.id}?section=cards&limit=2", token))
        assertEquals(6, cardsPage["total"]!!.jsonPrimitive.int)
        assertEquals(2, cardsPage["cards"]!!.jsonArray.size)

        // The same state as a "web" report → the diff finds nothing and no missing events.
        val full = obj(call("GET", "/api/debug/reports/${sent.id}?section=full", token))
        val web = JsonObject(full.filterKeys { it != "meta" && it != "section" } + ("client" to JsonPrimitive("web")))
        call("POST", "/api/debug/reports", token, buildJsonObject { put("client", "web"); put("app_version", "test"); put("report", web) }.toString())
        val cmp = obj(call("GET", "/api/debug/compare", token))
        assertEquals(0, cmp["headline"]!!.jsonObject["home.total"]!!.jsonObject["diff"]!!.jsonPrimitive.int)
        assertEquals(0, cmp["cards"]!!.jsonObject["differing"]!!.jsonPrimitive.int)
        val server = cmp["events"]!!.jsonObject["server"]!!.jsonObject
        assertEquals(1, server["total"]!!.jsonPrimitive.int)
        assertEquals(0, server["missing_from_a"]!!.jsonPrimitive.int)
        db.close()
    }
}
