package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.builtins.ListSerializer
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
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/** The Home homework card's rows (shared/homework/home.ts) — same rows, order, labels and tap routes. */
class HomeHomeworkParityTest {
    private val json = Json { ignoreUnknownKeys = true }

    private fun fixture(): JsonObject {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        return Json.parseToJsonElement(File(dir, "home-homework.json").readText()).jsonObject
    }

    private val JsonElement.str: String? get() = if (this is JsonNull) null else jsonPrimitive.content
    private val JsonElement.intOrNull: Int? get() = if (this is JsonNull) null else jsonPrimitive.int

    @Test
    fun rowsMatchTypeScript() {
        val f = fixture()
        val today = f["today"]!!.str!!
        val cases = f["cases"]!!.jsonArray
        for ((i, c) in cases.withIndex()) {
            val o = c.jsonObject
            val assignments = json.decodeFromJsonElement(ListSerializer(HomeworkAssignment.serializer()), o["assignments"]!!)
            val events = json.decodeFromJsonElement(ListSerializer(HomeworkEvent.serializer()), o["events"]!!)
            val longTerm = o["longTerm"]!!.jsonArray.map {
                val l = it.jsonObject
                LongTermHomework(l["kind"]!!.str!!, l["target_id"]!!.str!!, l["title"]!!.str!!, l["tutor_name"]!!.str, l["sent_at"]!!.str!!, l["met"]!!.intOrNull, l["total"]!!.intOrNull)
            }
            assertEquals(o["active"]!!.jsonArray.map { it.jsonPrimitive.boolean }, longTerm.map(HomeHomework::longTermActive), "case[$i] active")
            val todo = Homework.sortHomeworkItems(Homework.toHomeworkItems(assignments, events, today)).todo
            val card = HomeHomework.build(todo, longTerm, o["limit"]!!.jsonPrimitive.int, o["unreadFrom"]!!.str)
            val expected = o["card"]!!.jsonObject
            assertEquals(expected["heading"]!!.str, card.heading, "case[$i] heading")
            assertEquals(expected["more"]!!.jsonPrimitive.int, card.more, "case[$i] more")
            val rows = expected["rows"]!!.jsonArray
            assertEquals(rows.size, card.rows.size, "case[$i] rows")
            for ((k, e) in rows.withIndex()) {
                val eo = e.jsonObject
                val row = card.rows[k]
                val where = "case[$i] row $k"
                assertEquals(eo["key"]!!.str, row.key, "$where key")
                assertEquals(eo["kind"]!!.str, row.kind, "$where kind")
                assertEquals(eo["icon"]!!.str, row.icon, "$where icon")
                assertEquals(eo["title"]!!.str, row.title, "$where title")
                assertEquals(eo["progress"]!!.str, row.progress, "$where progress")
                val fr = eo["fraction"]!!
                if (fr is JsonNull) assertEquals(null, row.fraction, "$where fraction") else assertEquals(fr.jsonPrimitive.double, row.fraction, "$where fraction")
                assertEquals(eo["due"]!!.str, row.due, "$where due")
                assertEquals(eo["tone"]!!.str, row.tone, "$where tone")
                assertEquals(eo["route"]!!.str, row.route, "$where route")
                assertEquals(eo["tutor_name"]!!.str, row.tutorName, "$where tutor")
            }
        }
        assertTrue(cases.size >= 150)
    }

    @Test
    fun compactDueAndWordsMetMatchTypeScript() {
        val f = fixture()
        val today = f["today"]!!.str!!
        for (d in f["due"]!!.jsonArray) {
            val o = d.jsonObject
            assertEquals(o["text"]!!.str, HomeHomework.compactDue(Homework.dueLabel(o["date"]!!.str, today)), "compactDue ${o["date"]}")
        }
        for ((i, m) in f["met"]!!.jsonArray.withIndex()) {
            val o = m.jsonObject
            val cards = o["cards"]!!.jsonArray.map { val c = it.jsonObject; c["note_id"]!!.str!! to c["queue"]!!.jsonPrimitive.int }
            val (met, total) = HomeHomework.wordsMet(cards, o["noteIds"]!!.jsonArray.map { it.str!! })
            assertEquals(o["result"]!!.jsonObject["met"]!!.jsonPrimitive.int, met, "met[$i]")
            assertEquals(o["result"]!!.jsonObject["total"]!!.jsonPrimitive.int, total, "met[$i] total")
        }
    }
}
