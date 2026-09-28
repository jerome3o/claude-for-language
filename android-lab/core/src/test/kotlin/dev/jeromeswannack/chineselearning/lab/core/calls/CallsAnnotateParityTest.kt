package dev.jeromeswannack.chineselearning.lab.core.calls

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/** Package J: drawing on a shared screen reproduces shared/calls/annotate.ts exactly (parity/fixtures/calls-annotate.ts). */
class CallsAnnotateParityTest {
    private val root: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "calls-annotate.json").readText()).jsonObject
    }

    private fun size(e: JsonElement?): VideoFit.Size? = if (e == null || e is JsonNull) null else e.jsonObject.let { VideoFit.Size(it["width"]!!.jsonPrimitive.double, it["height"]!!.jsonPrimitive.double) }
    private fun pair(e: JsonElement?): Pair<Double, Double>? = if (e == null || e is JsonNull) null else e.jsonArray.let { it[0].jsonPrimitive.double to it[1].jsonPrimitive.double }

    private fun canon(el: JsonElement?): String = when (el) {
        null, is JsonNull -> "null"
        is JsonArray -> el.joinToString(",", "[", "]") { canon(it) }
        is JsonObject -> el.entries.sortedBy { it.key }.joinToString(",", "{", "}") { (k, v) -> "$k:${canon(v)}" }
        else -> el.jsonPrimitive.let { p -> if (p.isString) "\"${p.content}\"" else p.content.toDoubleOrNull()?.toString() ?: p.content }
    }

    @Test
    fun normaliseAndBack() {
        val cases = root["normalize"]!!.jsonArray
        assertTrue(cases.size >= 400)
        for ((i, c) in cases.withIndex()) {
            val o = c.jsonObject
            val box = size(o["box"])!!
            val video = size(o["video"])
            val got = CallAnnotate.normalizePoint(o["px"]!!.jsonPrimitive.double, o["py"]!!.jsonPrimitive.double, box, video)
            assertEquals(pair(o["p"]), got, "normalize $i")
            if (got != null) assertEquals(pair(o["back"]), CallAnnotate.denormalizePoint(got, box, video), "back $i")
        }
    }

    @Test
    fun fadingAndPings() {
        for (c in root["alphas"]!!.jsonArray) {
            val o = c.jsonObject
            val doneAt = o["doneAt"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.long }
            assertEquals(o["alpha"]!!.jsonPrimitive.double, CallAnnotate.strokeAlpha(doneAt, o["now"]!!.jsonPrimitive.long), "alpha $o")
        }
        for (c in root["pings"]!!.jsonArray) {
            val o = c.jsonObject
            val want = o["t"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.double }
            assertEquals(want, CallAnnotate.pingProgress(o["at"]!!.jsonPrimitive.long, o["now"]!!.jsonPrimitive.long), "ping $o")
        }
    }

    @Test
    fun sanitizeAndSimplify() {
        for ((i, c) in root["strokes"]!!.jsonArray.withIndex()) {
            val o = c.jsonObject
            assertEquals(canon(o["result"]), canon(CallAnnotate.sanitizeStroke(o["raw"])?.toJson()), "stroke $i ${o["raw"].toString().take(120)}")
        }
        for ((i, c) in root["pingSan"]!!.jsonArray.withIndex()) {
            val o = c.jsonObject
            val want = o["result"]!!.let { if (it is JsonNull) null else it.jsonObject.let { p -> p["x"]!!.jsonPrimitive.double to p["y"]!!.jsonPrimitive.double } }
            assertEquals(want, CallAnnotate.sanitizePing(o["raw"]), "ping sanitize $i ${o["raw"]}")
        }
        for ((i, c) in root["simplify"]!!.jsonArray.withIndex()) {
            val o = c.jsonObject
            val pts = o["points"]!!.jsonArray.map { pair(it)!! }
            assertEquals(o["result"]!!.jsonArray.map { pair(it)!! }, CallAnnotate.simplifyPoints(pts), "simplify $i")
        }
    }
}
