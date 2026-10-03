package dev.jeromeswannack.chineselearning.lab.ui.checks

import android.os.Looper
import dev.jeromeswannack.chineselearning.lab.data.api.DeckCheckScope
import dev.jeromeswannack.chineselearning.lab.ui.decks.DeckViewModel
import dev.jeromeswannack.chineselearning.lab.ui.decks.DecksEnv
import dev.jeromeswannack.chineselearning.lab.ui.decks.DecksFixture
import dev.jeromeswannack.chineselearning.lab.ui.decks.PasteStage
import dev.jeromeswannack.chineselearning.lab.ui.decks.PasteWordsViewModel
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.time.Duration
import java.util.Collections

/** Word checks: the deck page's ⚠ Apply fix / Dismiss, Paste a list's pre-check, the deck check sheet. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class CardChecksTest {
    private lateinit var f: DecksFixture
    private val requests = Collections.synchronizedList(ArrayList<Pair<String, String>>())
    private var jobPolls = 0

    private val issueJson = """[{"id":"i1","field":"pinyin","kind":"tones","current":"yínxíng","proposed":"yínháng","reason":"行 reads háng in 银行"},""" +
        """{"id":"i2","field":"english","kind":"gloss","current":"river","proposed":"bank","reason":"银行 is a bank"}]"""

    private fun job(status: String, checked: Int, applied: Boolean = false) =
        """{"id":"j1","deck_id":"d1","deck_name":"HSK 3","status":"$status","total":2,"checked":$checked,"proposals":[""" +
            """{"id":"p1","note_id":"n2","hanzi":"银行","field":"pinyin","kind":"reading","current":"yínxíng","proposed":"yínháng","reason":"行 reads háng","applied":$applied},""" +
            """{"id":"p2","note_id":"n1","hanzi":"打算","field":"english","kind":"gloss","current":"to plan","proposed":"to plan; to intend","reason":"both senses"}],"cost_usd":0.001,"created_at":"x"}"""

    @Before fun setUp() = runBlocking {
        f = DecksFixture()
        f.seed()
        val dao = f.db.dao()
        dao.upsertNotes(listOf(dao.note("n2")!!.copy(pinyin = "yínxíng", checkIssues = issueJson)))
        f.server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.path.orEmpty()
                val body = request.body.readUtf8()
                requests += path to body
                return when {
                    path == "/api/notes/n2/check-issues/i1/apply" ->
                        MockResponse().setBody("""{"note":{"id":"n2","deck_id":"d1","hanzi":"银行","pinyin":"yínháng","english":"bank","check_issues":"[{\"id\":\"i2\",\"field\":\"english\",\"kind\":\"gloss\",\"current\":\"river\",\"proposed\":\"bank\",\"reason\":\"x\"}]"}}""")
                    path == "/api/notes/n2/check-issues/i2/dismiss" ->
                        MockResponse().setBody("""{"note":{"id":"n2","deck_id":"d1","hanzi":"银行","pinyin":"yínxíng","english":"river","check_issues":null}}""")
                    path == "/api/ai/check-words" ->
                        MockResponse().setBody("""{"issues":[{"index":0,"field":"pinyin","kind":"tone_change","current":"yī yàng","proposed":"yí yàng","reason":"一 changes tone"}]}""")
                    path.startsWith("/api/decks/d1/notes") -> {
                        val hanzi = Json.parseToJsonElement(body).jsonObject["hanzi"]!!.jsonPrimitive.content
                        MockResponse().setResponseCode(201).setBody("""{"id":"new-$hanzi","deck_id":"d1","hanzi":"$hanzi","cards":[]}""")
                    }
                    path == "/api/decks/d1/check" && request.method == "GET" ->
                        MockResponse().setBody("""{"estimate":{"words":2,"batches":1,"usd":0.00108,"label":"~2 words · about less than $0.01"},"job":null,"deck_name":"HSK 3","can_fix_source":false}""")
                    path == "/api/decks/d1/check" -> MockResponse().setResponseCode(202).setBody("""{"job":${job("queued", 0)}}""")
                    path == "/api/relationships/r1/shared-decks/s1/check" ->
                        MockResponse().setBody("""{"estimate":{"words":2,"batches":1,"usd":0.001,"label":"~2 words"},"job":${job("done", 2)},"deck_name":"小明's HSK 3","can_fix_source":true}""")
                    path == "/api/deck-checks/j1" -> {
                        jobPolls++
                        MockResponse().setBody("""{"job":${if (jobPolls < 2) job("running", 1) else job("done", 2)}}""")
                    }
                    path == "/api/deck-checks/j1/apply" ->
                        MockResponse().setBody("""{"applied":["p1"],"source_applied":["p1"],"failed":[],"job":${job("done", 2, applied = true)}}""")
                    else -> MockResponse().setResponseCode(404)
                }
            }
        }
    }

    @After fun tearDown() = f.close()

    private fun await(what: String, cond: () -> Boolean) {
        val end = System.currentTimeMillis() + 8_000
        while (!cond()) {
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(100))
            if (System.currentTimeMillis() > end) fail("timed out waiting for $what")
            Thread.sleep(10)
        }
    }

    @Test fun deckPageShowsLiveIssuesAndApplyFixUpdatesTheNote() {
        val vm = DeckViewModel(f.env, "d1")
        await("issues") { vm.ui.value.notes.any { it.id == "n2" && it.issues.isNotEmpty() } }
        // i2 is stale: the note's English is "bank", not "river".
        assertEquals(listOf("i1"), vm.ui.value.notes.first { it.id == "n2" }.issues.map { it.id })

        vm.applyIssue("n2", vm.ui.value.notes.first { it.id == "n2" }.issues.single())
        await("applied") { vm.ui.value.issueBusy == null && requests.any { it.first.endsWith("/i1/apply") } }
        await("refreshed") { vm.ui.value.notes.first { it.id == "n2" }.pinyin == "yínháng" }
        val note = runBlocking { f.db.dao().note("n2")!! }
        assertEquals("yínháng", note.pinyin)
        assertEquals("bank", note.english)
        // What the server left (i2, about "river") is stored but no longer live.
        assertTrue(note.checkIssues!!.contains("\"i2\""))
        assertTrue(vm.ui.value.notes.first { it.id == "n2" }.issues.isEmpty())
    }

    @Test fun offlineApplyFixSaysSoAndSendsNothing() {
        f.online.value = false
        val vm = DeckViewModel(f.env, "d1")
        await("issues") { vm.ui.value.notes.any { it.id == "n2" && it.issues.isNotEmpty() } }
        await("offline") { !vm.ui.value.online }
        val issue = vm.ui.value.notes.first { it.id == "n2" }.issues.single()
        vm.dismissIssue("n2", issue)
        assertEquals("i1", vm.ui.value.issueError?.first)
        assertTrue(requests.none { it.first.contains("check-issues") })
    }

    @Test fun pasteChecksThePreviewOnceAndSavesCheckedRowsWithCheckNone() {
        val env = DecksEnv(f.db.dao(), f.api, f.writes, f.cache, f.online, f.version, cardCheck = { true })
        val vm = PasteWordsViewModel(env, "d1") { it }
        await("loaded") { vm.ui.value.deckName.isNotEmpty() }
        vm.setText("一样\tyī yàng\tthe same\n面包\tmiànbāo\tbread")
        await("checked") { vm.ui.value.checked.size == 2 }
        assertEquals(1, requests.count { it.first == "/api/ai/check-words" })
        val sent = Json.parseToJsonElement(requests.first { it.first == "/api/ai/check-words" }.second).jsonObject["words"]!!.jsonArray
        assertEquals(listOf("一样", "面包"), sent.map { it.jsonObject["hanzi"]!!.jsonPrimitive.content })
        val row = vm.ui.value.derived!!.rows.first { it.key == "一样" }
        val issue = vm.ui.value.liveIssues(row).single()
        assertEquals("yí yàng", issue.proposed)

        vm.applyIssue("一样", issue)
        val fixed = vm.ui.value.derived!!.rows.first { it.key == "一样" }
        assertEquals("yí yàng", fixed.row.pinyin)
        assertTrue(vm.ui.value.liveIssues(fixed).isEmpty())
        // The fixed word counts as checked: no second call.
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(3))
        assertEquals(1, requests.count { it.first == "/api/ai/check-words" })

        vm.save()
        await("saved") { vm.ui.value.stage == PasteStage.DONE }
        val posts = requests.filter { it.first.startsWith("/api/decks/d1/notes") }.map { it.first }
        assertEquals(listOf("/api/decks/d1/notes?check=none", "/api/decks/d1/notes?check=none"), posts)
    }

    @Test fun pasteWithChecksOffNeverCalls() {
        val vm = PasteWordsViewModel(f.env, "d1") { it }
        await("loaded") { vm.ui.value.deckName.isNotEmpty() }
        vm.setText("一样\tyī yàng\tthe same")
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(3))
        assertTrue(requests.none { it.first == "/api/ai/check-words" })
    }

    @Test fun deckCheckRunsPollsAndApplies() {
        var synced = 0
        val vm = DeckCheckViewModel(f.api, DeckCheckScope.Own("d1"), f.online, onApplied = { synced++ }, pollMs = 50)
        await("intro") { vm.ui.value.stage == DeckCheckStage.INTRO }
        assertEquals("~2 words · about less than $0.01", vm.ui.value.estimate!!.label)
        vm.start()
        await("results") { vm.ui.value.stage == DeckCheckStage.RESULTS }
        assertTrue(jobPolls >= 2)
        assertEquals("2 possible issues in 2 words", vm.ui.value.summary)
        assertEquals(setOf("p1", "p2"), vm.ui.value.selected)
        vm.toggle("p2")
        vm.apply()
        await("applied") { vm.ui.value.toast != null }
        assertEquals("Fixed 1 word", vm.ui.value.toast)
        val body = Json.parseToJsonElement(requests.first { it.first == "/api/deck-checks/j1/apply" }.second).jsonObject
        assertEquals(listOf("p1"), body["proposal_ids"]!!.jsonArray.map { it.jsonPrimitive.content })
        assertEquals(false, body["also_source"]!!.jsonPrimitive.boolean) // own deck: no source
        assertEquals(1, synced)
        assertEquals(listOf("p2"), vm.ui.value.open.map { it.id })
    }

    @Test fun studentCopyOpensOnTheResultsWithTheSourceOption() {
        val vm = DeckCheckViewModel(f.api, DeckCheckScope.Student("r1", "s1"), f.online, onApplied = {}, pollMs = 50)
        await("results") { vm.ui.value.stage == DeckCheckStage.RESULTS }
        assertTrue(vm.ui.value.canFixSource)
        assertTrue(vm.ui.value.alsoSource)
        vm.apply()
        await("applied") { vm.ui.value.toast != null }
        val body = Json.parseToJsonElement(requests.first { it.first == "/api/deck-checks/j1/apply" }.second).jsonObject
        assertEquals(true, body["also_source"]!!.jsonPrimitive.boolean)
        assertNull(vm.ui.value.error)
    }
}
