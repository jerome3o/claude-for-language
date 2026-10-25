package dev.jeromeswannack.chineselearning.lab.core

import dev.jeromeswannack.chineselearning.lab.core.feedback.FeedbackRules
import dev.jeromeswannack.chineselearning.lab.core.feedback.Shake
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/** In-app feedback (shared/feedback): the shake rule, route patterns, the context line, the copy — parity/fixtures/feedback.ts. */
class FeedbackParityTest {
    private val fixture: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "feedback.json").readText()).jsonObject
    }

    private fun num(e: JsonElement): Double = e.jsonPrimitive.content.let { if (it == "NaN") Double.NaN else it.toDouble() }
    private fun str(e: JsonElement?): String? = if (e == null || e is JsonNull) null else e.jsonPrimitive.content

    @Test
    fun shakeMatchesTypeScript() {
        val cases = fixture["shake"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.size >= 100)
        var total = 0
        for ((n, c) in cases.withIndex()) {
            val expected = c["shakes"]!!.jsonArray.map { it.jsonPrimitive.int }
            var state = Shake.State()
            val got = mutableListOf<Int>()
            c["samples"]!!.jsonArray.forEachIndexed { i, s ->
                val v = s.jsonArray.map(::num)
                val out = Shake.step(state, v[0], v[1], v[2], v[3])
                state = out.state
                if (out.shake) got += i
            }
            assertEquals(expected, got, "case $n")
            total += got.size
        }
        assertTrue(total > 5, "the vectors include real shakes")
    }

    @Test
    fun routesLinesAndCopyMatch() {
        for (r in fixture["routes"]!!.jsonArray.map { it.jsonObject }) {
            assertEquals(str(r["out"]), FeedbackRules.routePattern(str(r["input"])!!), str(r["input"]))
        }
        for (l in fixture["lines"]!!.jsonArray.map { it.jsonObject }) {
            val c = l["ctx"]!!.jsonObject
            val line = FeedbackRules.contextLine(str(c["platform"]), str(c["app_version"]), str(c["screen"]), str(c["device"]), str(c["os"]), c["online"]?.jsonPrimitive?.boolean, str(c["via"]))
            assertEquals(str(l["out"]), line)
        }
        val copy = fixture["copy"]!!.jsonObject
        assertEquals(str(copy["title"]), FeedbackRules.Copy.TITLE)
        assertEquals(str(copy["bugChip"]), FeedbackRules.Copy.BUG_CHIP)
        assertEquals(str(copy["ideaChip"]), FeedbackRules.Copy.IDEA_CHIP)
        assertEquals(str(copy["placeholder"]), FeedbackRules.Copy.PLACEHOLDER)
        assertEquals(str(copy["screenshotOn"]), FeedbackRules.Copy.SCREENSHOT_ON)
        assertEquals(str(copy["screenshotNote"]), FeedbackRules.Copy.SCREENSHOT_NOTE)
        assertEquals(str(copy["sent"]), FeedbackRules.Copy.SENT)
        assertEquals(str(copy["queued"]), FeedbackRules.Copy.QUEUED)
        assertEquals(str(copy["shakeSetting"]), FeedbackRules.Copy.SHAKE_SETTING)
    }
}
