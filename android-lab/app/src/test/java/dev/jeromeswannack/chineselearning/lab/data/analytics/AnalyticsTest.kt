package dev.jeromeswannack.chineselearning.lab.data.analytics

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.IOException
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** An in-memory [AnalyticsQueue] (the Room one is tested below). */
private class ListQueue : AnalyticsQueue {
    val rows = ArrayList<UsageEventEntity>()
    private var seq = 0L
    override suspend fun add(id: String, json: String, now: Long) { rows += UsageEventEntity(++seq, id, json, now) }
    override suspend fun oldest(limit: Int) = rows.take(limit)
    override suspend fun remove(seqs: List<Long>) { rows.removeAll { it.seq in seqs } }
    override suspend fun clear() = rows.clear()
    override suspend fun count() = rows.size
    fun events(): List<JsonObject> = rows.map { Json.parseToJsonElement(it.json).jsonObject }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class AnalyticsTest {
    private var now = 1_000_000L
    private var share = true
    private var ids = 0
    private val queue = ListQueue()
    private val uploads = ArrayList<String>()
    private var answer: () -> Int = { 200 }

    private val analytics = Analytics(
        queue = queue,
        appVersion = "0.9 (42)",
        shareUsage = { share },
        scope = CoroutineScope(Dispatchers.Unconfined),
        io = Dispatchers.Unconfined,
        clock = { now },
        newId = { "id-%08d".format(++ids) },
        uploader = { body -> uploads += body; answer() },
        debugLog = {},
    )

    private fun JsonObject.str(key: String) = this[key]?.jsonPrimitive?.content

    @Test
    fun leavingARouteRecordsItsScreenViewWithTheTimeOnIt() {
        analytics.screen(AnalyticsScreens.routeOf("decks", null), "/decks")
        now += 5_000
        analytics.screen(AnalyticsScreens.routeOf("decks/{id}", null), "/decks/abc123def")
        val first = queue.events().single()
        assertEquals("app.screen_view", first.str("event"))
        assertEquals("/decks", first.str("screen"), "the screen LEFT")
        assertEquals(5_000, first["props"]!!.jsonObject["duration_ms"]!!.jsonPrimitive.long)
        assertNull(first["props"]!!.jsonObject["from"], "from is omitted")

        // The same route again (recomposition) records nothing; another deck is another screen.
        analytics.screen("decks/{id}", "/decks/abc123def")
        assertEquals(1, queue.rows.size)
        now += 2_000
        analytics.screen("decks/{id}", "/decks/zzz999yyy")
        assertEquals("/decks/:id", queue.events().last().str("screen"))
        assertEquals(2_000, queue.events().last()["props"]!!.jsonObject["duration_ms"]!!.jsonPrimitive.long)

        // Going to the background gives the last screen its time; coming back restarts its clock.
        now += 3_000
        analytics.onBackground()
        assertEquals(3_000, queue.events().last()["props"]!!.jsonObject["duration_ms"]!!.jsonPrimitive.long)
        assertEquals(3, queue.rows.size)
    }

    @Test
    fun aNewSessionAfterThirtyMinutesAwayEmitsAppOpen() {
        analytics.start()
        val first = analytics.sessionId
        analytics.onBackground()
        now += 10 * 60_000
        analytics.onForeground()
        analytics.onBackground()
        assertEquals(first, analytics.sessionId, "10 min away: same session")
        now += 31 * 60_000
        analytics.onForeground()
        analytics.onBackground()
        assertTrue(first != analytics.sessionId)
        val opens = queue.events().filter { it.str("event") == "app.open" }
        assertEquals(2, opens.size)
        assertEquals("lab", opens.last()["props"]!!.jsonObject.str("install_kind"))
        assertEquals(analytics.sessionId, opens.last().str("session_id"))
    }

    @Test
    fun everyEventCarriesTheWireContext() {
        analytics.screen("/study")
        analytics.track("study.card_rated", mapOf("rating" to "good", "card_type" to "hanzi_to_meaning", "queue" to 2, "time_ms" to 4321L))
        val e = queue.events().single()
        assertEquals("lab", e.str("platform"))
        assertEquals("0.9 (42)", e.str("app_version"))
        assertEquals(analytics.sessionId, e.str("session_id"))
        assertEquals("/study", e.str("screen"))
        assertEquals("1970-01-01T00:16:40.000Z", e.str("ts"))
        assertTrue(e.str("id")!!.length >= 8)
        val props = e["props"]!!.jsonObject
        assertEquals("good", props.str("rating"))
        assertEquals("2", props.str("queue"), "whole numbers go up as integers")
        assertEquals("4321", props.str("time_ms"))
    }

    @Test
    fun aMessageBodyNeverReachesTheQueue() {
        val body = "你好，我明天不能来上课了，对不起！"
        analytics.track("chat.send", mapOf("kind" to body, "text" to "my secret message", "message" to body, "is_ai" to false))
        analytics.track("chat.menu_action", mapOf("action" to "jerome@example.com"))
        analytics.track("error.shown", Analytics.errorProps("Couldn't save: The server said no (400).", "inline_notice"))
        analytics.track("not.a.real.event", mapOf("kind" to "text"))
        analytics.track("server.ai_call", mapOf("model" to "x")) // server-only: never from a client
        val all = queue.rows.joinToString("\n") { it.json }
        assertFalse(body in all)
        assertFalse("你好" in all)
        assertFalse("secret" in all)
        assertFalse("@" in all)
        assertFalse("server said" in all)
        assertEquals(listOf("chat.send", "chat.menu_action", "error.shown"), queue.events().map { it.str("event") })
        assertEquals(setOf("is_ai"), queue.events()[0]["props"]!!.jsonObject.keys)
        assertEquals("http_400", queue.events()[2]["props"]!!.jsonObject.str("code"))
    }

    @Test
    fun uploadClearsOn2xxKeepsOnNetworkFailureDropsOn400() = runBlocking {
        repeat(3) { analytics.track("study.edit_card") }

        answer = { throw IOException("offline") }
        assertEquals(0, analytics.flush())
        assertEquals(3, queue.rows.size, "kept while offline")

        answer = { 503 }
        analytics.flush()
        assertEquals(3, queue.rows.size, "kept on a server error")
        answer = { 429 }
        analytics.flush()
        assertEquals(3, queue.rows.size, "kept when rate-limited")

        answer = { 200 }
        assertEquals(3, analytics.flush())
        assertEquals(0, queue.rows.size, "deleted after a 2xx")
        val body = Json.parseToJsonElement(uploads.last()).jsonObject
        assertEquals(3, body["events"]!!.jsonArray.size)

        analytics.track("study.edit_card")
        answer = { 400 }
        analytics.flush()
        assertEquals(0, queue.rows.size, "a 400 can never succeed: dropped")
    }

    @Test
    fun uploadsInBatchesOfFiveHundred() = runBlocking {
        repeat(1_201) { analytics.track("chat.reaction") }
        uploads.clear()
        assertEquals(1_201, analytics.flush())
        assertEquals(listOf(500, 500, 201), uploads.map { Json.parseToJsonElement(it).jsonObject["events"]!!.jsonArray.size })
    }

    @Test
    fun optingOutStopsRecordingAndClearsTheQueue() = runBlocking {
        analytics.track("study.edit_card")
        // Turning it off: the settings.analytics event goes up with what was queued, then nothing is kept.
        analytics.changeSharing(false) { share = it }
        assertFalse(share)
        assertTrue(uploads.single().contains("\"settings.analytics\""))
        assertTrue(uploads.single().contains("\"on\":false"))
        assertEquals(0, queue.rows.size)

        analytics.track("study.edit_card")
        analytics.screen("/decks")
        now += 1_000
        analytics.screen("/study")
        assertEquals(0, queue.rows.size, "nothing recorded while opted out")

        // Opted out on another device (share_usage from /api/auth/me): the next flush clears, sends nothing.
        share = true
        analytics.track("study.edit_card")
        share = false
        uploads.clear()
        analytics.flush()
        assertEquals(0, queue.rows.size)
        assertTrue(uploads.isEmpty())

        // Back on: recorded again, starting with settings.analytics {on:true}.
        analytics.changeSharing(true) { share = it }
        assertEquals("settings.analytics", queue.events().single().str("event"))
    }

    @Test
    fun screenNamesFromLabRoutes() {
        assertEquals("/", AnalyticsScreens.routeOf(Routes.HOME_ROUTE, null))
        assertEquals("/coach?text=x", AnalyticsScreens.routeOf(Routes.PLACEHOLDER_ROUTE, "/coach?text=x"))
        analytics.screen(AnalyticsScreens.routeOf(Routes.PLACEHOLDER_ROUTE, "/coach?text=你好"))
        assertEquals("/coach", analytics.currentScreen)
        analytics.screen(AnalyticsScreens.routeOf("connections/{relId}/chat/{convId}", null))
        assertEquals("/connections/:id/chat/:id", analytics.currentScreen)
    }

    @Test
    fun roomQueueKeepsOrderAndCaps() = runBlocking {
        val db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), AnalyticsDatabase::class.java).allowMainThreadQueries().build()
        val q = RoomAnalyticsQueue(db.events())
        repeat(RoomAnalyticsQueue.MAX_QUEUED + 100) { q.add("e$it", "{\"n\":$it}", it.toLong()) }
        assertEquals(RoomAnalyticsQueue.MAX_QUEUED, q.count(), "capped to the newest")
        val first = q.oldest(2)
        assertEquals(listOf("e100", "e101"), first.map { it.id })
        q.remove(first.map { it.seq })
        assertEquals("e102", q.oldest(1).single().id)
        q.clear()
        assertEquals(0, q.count())
        db.close()
    }
}
