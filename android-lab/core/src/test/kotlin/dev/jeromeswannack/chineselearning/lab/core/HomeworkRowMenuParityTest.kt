package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
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

/** "Skip handwriting exercises" (shared/lesson/handwriting.ts) and the row menu (shared/homework/row-actions.ts). */
class HomeworkRowMenuParityTest {
    private fun fixture(): JsonObject {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        return Json.parseToJsonElement(File(dir, "homework-row-menu.json").readText()).jsonObject
    }

    private val JsonElement.str: String? get() = if (this is JsonNull) null else jsonPrimitive.content
    private fun strings(e: JsonElement?): List<String>? = if (e == null || e is JsonNull) null else e.jsonArray.map { it.jsonPrimitive.content }

    @Test
    fun skipHandwritingMatchesTypeScript() {
        val lessons = fixture()["lessons"]!!.jsonArray
        var bars = 0
        for ((i, c) in lessons.withIndex()) {
            val o = c.jsonObject
            val where = "lesson[$i]"
            val sections = o["sections"]!!.jsonArray.map { strings(it)!! }
            val skip = o["skip"]!!.jsonPrimitive.boolean
            val only = strings(o["only"])
            assertEquals(strings(o["steps"]), LessonRun.stepsOfTypes(sections, only, skip).map { it.key }, "$where steps")
            assertEquals(strings(o["keys"]), Handwriting.handwritingKeysOfTypes(sections), "$where keys")
            val rows = o["rows"]!!.jsonArray.map { it.jsonObject }
            val actual = Handwriting.skippedRowsOfTypes(sections, only)
            assertEquals(rows.size, actual.size, "$where rows")
            rows.zip(actual).forEach { (e, a) ->
                assertEquals(e["section"]!!.jsonPrimitive.int, a.section)
                assertEquals(e["index"]!!.jsonPrimitive.int, a.index)
                assertEquals(e["skipped"]!!.str, a.skipped)
                assertEquals(null, a.correct)
            }
            val saved = o["saved"]!!
            val bar = if (saved is JsonNull) LessonRun.savedRunBar(null, null, null, null, "L1", sections, skip) else {
                val s = saved.jsonObject
                val st = s["state"]!!.jsonObject
                val state = LessonRun.State(st["pos"]!!.jsonPrimitive.int, strings(st["owed"])!!, st["fixed"]!!.jsonPrimitive.int, st["retried"]!!.jsonPrimitive.int)
                LessonRun.savedRunBar(s["lesson_id"]!!.str, s["shape"]!!.str, state, strings(s["keys"]), "L1", sections, skip)
            }
            val eb = o["bar"]!!
            if (eb is JsonNull) assertEquals(null, bar, "$where bar") else {
                bars++
                val b = bar ?: fail("$where bar missing")
                val e = eb.jsonObject
                assertEquals(e["answered"]!!.jsonPrimitive.int, b.answered, "$where answered")
                assertEquals(e["fresh"]!!.jsonPrimitive.int, b.fresh, "$where fresh")
                assertEquals(e["retries"]!!.jsonPrimitive.int, b.retries, "$where retries")
                assertEquals(e["doneFraction"]!!.jsonPrimitive.double, b.doneFraction, "$where done")
            }
            val runs = o["runs"]!!.jsonArray.map {
                val r = it.jsonObject
                val oc = r["outcome"]!!.jsonObject
                LessonRevision.RunRecord(r["id"]!!.str!!, r["at"]!!.str!!, LessonRevision.Outcome(strings(oc["keys"])!!, strings(oc["missed"])!!), null)
            }
            val st = LessonRevision.state(runs, emptyList(), strings(o["ignore"])!!)
            val es = o["state"]!!.jsonObject
            assertEquals(es["status"]!!.str, st.status, "$where status")
            assertEquals(strings(es["missed"]), st.missed, "$where missed")
            assertEquals(es["revision"]!!.jsonPrimitive.int, st.revision, "$where revision")
            assertEquals(es["due_ms"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.long }, st.dueMs, "$where due")
        }
        assertTrue(bars > 20, "enough bars")
    }

    @Test
    fun rowMenuMatchesTypeScript() {
        val f = fixture()
        for ((i, c) in f["menus"]!!.jsonArray.withIndex()) {
            val o = c.jsonObject
            val kind = o["kind"]!!.str!!
            val tutor = o["tutor"]!!.str
            val actions = HomeworkRowActions.actions(kind, o["assignment_id"]!!.str, o["lesson_id"]!!.str, o["has_handwriting"]!!.jsonPrimitive.boolean, o["skip_handwriting"]!!.jsonPrimitive.boolean)
            val where = "menu[$i]"
            assertEquals(strings(o["actions"]), actions, "$where actions")
            assertEquals(strings(o["labels"]), actions.map { HomeworkRowActions.label(it, kind) }, "$where labels")
            assertEquals(strings(o["icons"]), actions.map(HomeworkRowActions::icon), "$where icons")
            assertEquals(o["confirms"]!!.jsonArray.map { it.str }, actions.map { HomeworkRowActions.confirm(it, "把 sentences", tutor) }, "$where confirms")
            assertEquals(strings(o["toasts"]), actions.map { HomeworkRowActions.toast(it, tutor) }, "$where toasts")
            assertEquals(o["undoable"]!!.jsonArray.map { it.jsonPrimitive.boolean }, actions.map(HomeworkRowActions::undoable), "$where undoable")
        }
        for (k in f["rowKinds"]!!.jsonArray) {
            val o = k.jsonObject
            assertEquals(o["kind"]!!.str, HomeworkRowActions.homeRowKind(o["key"]!!.str!!), "rowKind ${o["key"]}")
        }
    }
}
