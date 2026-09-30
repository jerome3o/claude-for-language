package dev.jeromeswannack.chineselearning.lab.core.calls

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/** Package J: board page labels and titles reproduce shared/calls/pages.ts exactly (parity/fixtures/calls-pages.ts). */
class CallsPagesParityTest {
    private val root: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "calls-pages.json").readText()).jsonObject
    }

    private fun str(o: JsonObject, k: String): String? = o[k]?.takeIf { it !is JsonNull }?.jsonPrimitive?.content

    @Test
    fun constants() = assertEquals(root["maxTitle"]!!.jsonPrimitive.int, CallPages.MAX_PAGE_TITLE)

    @Test
    fun titles() {
        val cases = root["titles"]!!.jsonArray
        assertTrue(cases.size > 500)
        for ((i, c) in cases.withIndex()) {
            val o = c.jsonObject
            assertEquals(str(o, "title"), CallPages.sanitizePageTitle(str(o, "raw")), "case $i: $c")
        }
    }

    @Test
    fun labels() {
        for ((i, c) in root["labels"]!!.jsonArray.withIndex()) {
            val o = c.jsonObject
            assertEquals(str(o, "label"), CallPages.pageLabel(o["index"]!!.jsonPrimitive.int, str(o, "title")), "case $i: $c")
        }
    }
}
