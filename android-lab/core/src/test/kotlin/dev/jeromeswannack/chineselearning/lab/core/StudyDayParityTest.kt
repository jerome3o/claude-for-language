package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/** Active time, resume and celebration reproduce shared/study exactly (parity/fixtures/study.ts). */
class StudyDayParityTest {
    private val fixture: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "study.json").readText()).jsonObject
    }

    private val JsonElement.str: String? get() = if (this is JsonNull) null else jsonPrimitive.content
    private val JsonElement.lng: Long get() = jsonPrimitive.content.toDouble().toLong()

    private fun JsonElement.state(): ActiveTime.State {
        val o = jsonObject
        val totals = o["totals"]!!.jsonObject.mapValues { it.value.lng }
        val last = o["last"]!!.let { if (it is JsonNull) null else ActiveTime.Last(it.jsonObject["at"]!!.lng, it.jsonObject["day"]!!.str!!) }
        return ActiveTime.State(totals, last)
    }

    @Test
    fun activeTimeRunsMatchTypeScript() {
        val runs = fixture["runs"]!!.jsonArray
        assertTrue(runs.size >= 100)
        for ((r, run) in runs.map { it.jsonObject }.withIndex()) {
            var s = ActiveTime.State()
            for ((i, step) in run["steps"]!!.jsonArray.map { it.jsonObject }.withIndex()) {
                val at = step["at"]!!.lng
                s = if (step["op"]!!.str == "interact") ActiveTime.interact(s, at, step["day"]!!.str!!) else ActiveTime.pause(s, at)
                assertEquals(step["state"]!!.state(), s, "run $r step $i state")
                val query = step["query"]!!.lng
                assertEquals(step["pending"]!!.lng, ActiveTime.pending(s, query), "run $r step $i pending")
                for ((day, total) in step["totals"]!!.jsonObject) assertEquals(total.lng, ActiveTime.total(s, day, query), "run $r step $i total $day")
            }
            assertEquals(run["pruned"]!!.state(), ActiveTime.prune(s, run["prunedFrom"]!!.str!!), "run $r pruned")
        }
    }

    @Test
    fun devicesAndTextMatchTypeScript() {
        for (d in fixture["devices"]!!.jsonArray.map { it.jsonObject }) {
            assertEquals(d["result"]!!.lng, ActiveTime.acrossDevices(d["local"]!!.lng, d["total"]!!.lng, d["mine"]!!.lng))
        }
        for (m in fixture["minutes"]!!.jsonArray.map { it.jsonObject }) {
            assertEquals(m["text"]!!.str, ActiveTime.formatMinutes(m["ms"]!!.lng), "minutes ${m["ms"]}")
        }
        for (l in fixture["lines"]!!.jsonArray.map { it.jsonObject }) {
            assertEquals(l["text"]!!.str, ActiveTime.todayLine(l["ms"]!!.lng, l["reviews"]!!.jsonPrimitive.int))
        }
    }

    @Test
    fun resumeMatchesTypeScript() {
        for ((i, c) in fixture["resume"]!!.jsonArray.map { it.jsonObject }.withIndex()) {
            val p = c["point"]!!.let {
                if (it is JsonNull) null else it.jsonObject.let { o ->
                    StudyResume.Point(o["day"]!!.str!!, o["scope"]!!.str!!, o["card_id"]!!.str!!, o["revealed"]!!.jsonPrimitive.boolean, o["answer"]!!.str!!, o["elapsed_ms"]!!.lng)
                }
            }
            val queue = c["queue"]!!.jsonArray.map { it.str!! }
            assertEquals(c["card"]!!.str, StudyResume.cardId(p, c["day"]!!.str!!, c["scope"]!!.str!!, queue), "resume $i")
            assertEquals(c["elapsed"]!!.lng, StudyResume.elapsedMs(p), "elapsed $i")
        }
        for (s in fixture["scopes"]!!.jsonArray.map { it.jsonObject }) {
            assertEquals(s["scope"]!!.str, StudyResume.scope(s["deck"]!!.str))
        }
    }

    @Test
    fun celebrationMatchesTypeScript() {
        for ((i, c) in fixture["celebrate"]!!.jsonArray.map { it.jsonObject }.withIndex()) {
            val mark = c["mark"]!!.let { if (it is JsonNull) null else Celebration.Mark(it.jsonObject["day"]!!.str!!, it.jsonObject["reviews"]!!.jsonPrimitive.int) }
            assertEquals(c["result"]!!.jsonPrimitive.boolean, Celebration.should(mark, c["day"]!!.str!!, c["reviews"]!!.jsonPrimitive.int, c["empty"]!!.jsonPrimitive.boolean), "celebrate $i")
        }
    }
}
