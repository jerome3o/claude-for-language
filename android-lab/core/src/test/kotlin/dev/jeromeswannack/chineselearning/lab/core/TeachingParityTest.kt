package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/** HomeworkPlan (LoadPlan.kt) must match shared/homework/due.ts + split.ts + plan.ts defaultHomeworkDueDate exactly (parity/fixtures/teaching.ts). */
class TeachingParityTest {
    private fun fixture(name: String): JsonObject {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        return Json.parseToJsonElement(File(dir, name).readText()).jsonObject
    }

    private val JsonElement.str: String? get() = if (this is JsonNull) null else jsonPrimitive.content
    private val f by lazy { fixture("teaching.json") }

    private fun assertLabel(expected: JsonObject, actual: HomeworkPlan.DueLabel, where: String) {
        assertEquals(expected["text"]!!.str, actual.text, "$where text")
        assertEquals(expected["tone"]!!.str, actual.tone.name.lowercase(), "$where tone")
        assertEquals(expected["days"]?.let { if (it is JsonNull) null else it.jsonPrimitive.int }, actual.days, "$where days")
    }

    @Test
    fun datesAndDueLabelsMatch() {
        var n = 0
        for (d in f["dates"]!!.jsonArray) {
            val today = d.jsonObject["today"]!!.str!!
            for (a in d.jsonObject["add"]!!.jsonArray) {
                assertEquals(a.jsonObject["date"]!!.str, HomeworkPlan.addDays(today, a.jsonObject["n"]!!.jsonPrimitive.int), "addDays $today")
            }
            for (l in d.jsonObject["labels"]!!.jsonArray) {
                val due = l.jsonObject["due"]!!.str!!
                assertEquals(l.jsonObject["between"]!!.jsonPrimitive.int, HomeworkPlan.daysBetween(today, due), "daysBetween $today $due")
                assertLabel(l.jsonObject["label"]!!.jsonObject, HomeworkPlan.dueLabel(due, today), "dueLabel $due @ $today")
                assertEquals(l.jsonObject["short"]!!.str, HomeworkPlan.shortDay(due), "shortDay $due")
                n++
            }
        }
        assertTrue(n > 500)
        for (v in f["validity"]!!.jsonArray) {
            val s = v.jsonObject["s"]!!.str!!
            assertEquals(v.jsonObject["valid"]!!.jsonPrimitive.content.toBoolean(), HomeworkPlan.isDateString(s), "isDateString '$s'")
            assertLabel(v.jsonObject["label"]!!.jsonObject, HomeworkPlan.dueLabel(s, "2026-09-27"), "dueLabel '$s'")
            assertEquals(v.jsonObject["short"]!!.str, HomeworkPlan.shortDay(s), "shortDay '$s'")
        }
        assertLabel(f["nullLabel"]!!.jsonObject, HomeworkPlan.dueLabel(null, "2026-09-27"), "dueLabel null")
        for (c in f["compares"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o["r"]!!.jsonPrimitive.int, HomeworkPlan.compareDue(o["a"]!!.str, o["b"]!!.str), "compareDue $o")
        }
    }

    @Test
    fun splitMatches() {
        for (s in f["splits"]!!.jsonArray) {
            val o = s.jsonObject
            val count = o["count"]!!.jsonPrimitive.int
            val parts = HomeworkPlan.splitIntoDays((0 until count).toList(), o["days"]!!.jsonPrimitive.int, o["first"]!!.str!!)
            assertEquals(o["sizes"]!!.jsonArray.map { it.jsonPrimitive.int }, parts.map { it.items.size }, "sizes $o")
            assertEquals(o["dues"]!!.jsonArray.map { it.str }, parts.map { it.dueDate }, "dues $o")
            assertEquals((0 until count).toList(), parts.flatMap { it.items }, "order kept $o")
        }
        for (c in f["clamps"]!!.jsonArray) {
            val o = c.jsonObject
            val days = o["days"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.double }
            assertEquals(o["r"]!!.jsonPrimitive.int, HomeworkPlan.clampSplitDays(days, o["count"]!!.jsonPrimitive.int), "clamp $o")
        }
        for (c in f["dueDefaults"]!!.jsonArray) {
            val o = c.jsonObject
            val lessons = o["lessons"]!!.jsonArray.map { it.str }
            assertEquals(o["r"]!!.str, HomeworkPlan.defaultHomeworkDueDate(o["today"]!!.str!!, lessons), "defaultHomeworkDueDate $o")
        }
        for (c in f["suggest"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o["r"]!!.jsonPrimitive.int, HomeworkPlan.suggestSplitDays(o["n"]!!.jsonPrimitive.int, o["per"]!!.jsonPrimitive.int), "suggest $o")
        }
    }
}
