package dev.jeromeswannack.chineselearning.lab.core

import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerAdd
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerAddFillReason
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerAddStep
import kotlinx.serialization.json.Json
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

/**
 * "+ Add as card" in the explorer must decide like the web (parity/fixtures/explorer-add.ts →
 * explorer-add.json, from shared/explorer/addCard.ts): add / gloss / fill for every combination of
 * pinyin, meaning, device reading, online and glossed, and the fill sheet's words.
 */
class ExplorerAddParityTest {
    private val fixture: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "explorer-add.json").readText()).jsonObject
    }

    private fun JsonObject.s(k: String) = this[k]!!.jsonPrimitive.content
    private fun JsonObject.b(k: String) = this[k]!!.jsonPrimitive.boolean

    private fun reason(wire: String) = ExplorerAddFillReason.entries.first { it.wire == wire }

    @Test
    fun stepsMatchTypeScript() {
        val steps = fixture["steps"]!!.jsonArray
        assertTrue(steps.size > 500)
        for (case in steps) {
            val i = case.jsonObject["input"]!!.jsonObject
            val o = case.jsonObject["out"]!!.jsonObject
            val expected: ExplorerAddStep = when (o.s("kind")) {
                "add" -> ExplorerAddStep.Add(o.s("hanzi"), o.s("pinyin"), o.s("english"))
                "gloss" -> ExplorerAddStep.Gloss(o.s("hanzi"), o.s("pinyin"))
                "fill" -> ExplorerAddStep.Fill(o.s("hanzi"), o.s("pinyin"), o.s("english"), reason(o.s("reason")))
                else -> fail("unknown kind ${o.s("kind")}")
            }
            assertEquals(expected, ExplorerAdd.step(i.s("hanzi"), i.s("pinyin"), i.s("english"), i.s("devicePinyin"), i.b("online"), i.b("glossed")), "input $i")
        }
    }

    @Test
    fun copyMatchesTypeScript() {
        val c = fixture["copy"]!!.jsonObject
        for (p in c["prompts"]!!.jsonArray) assertEquals(p.jsonObject.s("out"), ExplorerAdd.prompt(p.jsonObject.s("hanzi")))
        for (h in c["hints"]!!.jsonArray) {
            val o = h.jsonObject
            assertEquals(o.s("out"), ExplorerAdd.hint(reason(o.s("reason")), o.b("has")))
        }
        for (p in c["problems"]!!.jsonArray) {
            val o = p.jsonObject
            val out = o["out"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.content }
            assertEquals(out, ExplorerAdd.problem(o.s("english"), o.b("online")))
        }
        assertEquals(c["wait_ms"]!!.jsonPrimitive.long, ExplorerAdd.WAIT_MS)
    }
}
