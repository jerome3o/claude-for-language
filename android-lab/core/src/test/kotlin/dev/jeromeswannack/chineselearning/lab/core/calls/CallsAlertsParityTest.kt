package dev.jeromeswannack.chineselearning.lab.core.calls

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/** Package J: the call banner / ring rules reproduce shared/calls/alerts.ts exactly (parity/fixtures/calls-alerts.ts). */
class CallsAlertsParityTest {
    private val root: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "calls-alerts.json").readText()).jsonObject
    }

    private fun str(e: JsonElement?): String? = if (e == null || e is JsonNull) null else e.jsonPrimitive.content

    private fun calls(e: JsonElement) = e.jsonArray.map {
        val o = it.jsonObject
        CallAlerts.LiveCall(str(o["id"])!!, str(o["relationship_id"]), str(o["created_by"])!!, str(o["status"])!!, str(o["created_at"])!!, str(o["other_user_name"]))
    }

    @Test
    fun timesAndPaths() {
        for (t in root["times"]!!.jsonArray) {
            val o = t.jsonObject
            assertEquals(o["ms"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.long }, CallAlerts.parseCallTime(str(o["value"])), "time ${o["value"]}")
        }
        for (p in root["paths"]!!.jsonArray) {
            val o = p.jsonObject
            assertEquals(str(o["id"]), CallAlerts.callIdFromPath(str(o["path"])!!), "path ${o["path"]}")
        }
    }

    @Test
    fun bannerMatchesTypeScript() {
        val now = root["now"]!!.jsonPrimitive.long
        val cases = root["banners"]!!.jsonArray
        assertTrue(cases.size >= 400)
        var shown = 0
        for ((i, c) in cases.withIndex()) {
            val o = c.jsonObject
            val got = CallAlerts.pickCallBanner(
                calls(o["calls"]!!), "me", str(o["path"])!!, now,
                dismissed = o["dismissed"]!!.jsonArray.map { it.jsonPrimitive.content },
                relationshipId = str(o["relationship_id"]),
                includeTest = o["include_test"]!!.jsonPrimitive.boolean,
            )
            val want = o["result"]!!
            if (want is JsonNull) { assertEquals(null, got, "banner case $i"); continue }
            shown++
            val w = want.jsonObject
            assertEquals(str(w["call_id"]), got?.callId, "banner case $i id")
            assertEquals(str(w["kind"]), got?.kind?.wire, "banner case $i kind")
            assertEquals(str(w["title"]), got?.title, "banner case $i title")
            assertEquals(str(w["action"]), got?.action, "banner case $i action")
            assertEquals(str(w["url"]), got?.url, "banner case $i url")
            assertEquals(str(w["name"]), got?.name, "banner case $i name")
            assertEquals(str(w["relationship_id"]), got?.relationshipId, "banner case $i rel")
        }
        assertTrue(shown > 50, "enough banners shown ($shown)")
    }

    @Test
    fun ringMatchesTypeScript() {
        val now = root["now"]!!.jsonPrimitive.long
        var rang = 0
        for ((i, c) in root["rings"]!!.jsonArray.withIndex()) {
            val o = c.jsonObject
            val got = CallAlerts.callToRing(
                calls(o["calls"]!!), "me", now, o["rung"]!!.jsonArray.map { it.jsonPrimitive.content },
                o["silent"]!!.jsonPrimitive.boolean, str(o["path"])!!,
            )
            assertEquals(str(o["result"]), got?.id, "ring case $i")
            if (got != null) rang++
        }
        assertTrue(rang > 20, "enough rings ($rang)")
    }
}
