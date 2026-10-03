package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.fail

/** Create, then send (shared/homework/send.ts) — the same unsent items and words, character for character. */
class HomeworkSendParityTest {
    private fun fixture(): JsonObject {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        return Json.parseToJsonElement(File(dir, "homework-send.json").readText()).jsonObject
    }

    private val JsonElement?.str: String? get() = if (this == null || this is JsonNull) null else jsonPrimitive.content

    private fun result(e: JsonElement?): SendJobResult? {
        if (e == null || e is JsonNull) return null
        val o = e.jsonObject
        return SendJobResult(
            deck = o["deck"]?.jsonObject?.let { d -> SendJobDeck(d["id"].str!!, d["name"].str!!, d["note_count"]!!.jsonPrimitive.int, d["target_deck_id"].str, d["removed_at"].str) },
            lessons = o["lessons"]?.jsonArray?.map { l -> l.jsonObject.let { SendJobLesson(it["library_item_id"].str!!, it["title"].str!!, it["lesson_id"].str, it["removed_at"].str) } }.orEmpty(),
            reader = o["reader"]?.jsonObject?.let { r -> SendJobReader(r["id"].str!!, r["title_english"].str!!, r["target_reader_id"].str, r["removed_at"].str) },
        )
    }

    @Test
    fun unsentItemsMatchTypeScript() {
        val cases = fixture()["results"]!!.jsonArray
        assertEquals(200, cases.size)
        var nonEmpty = 0
        for ((i, c) in cases.withIndex()) {
            val o = c.jsonObject
            val expected = o["unsent"]!!.jsonArray.map { u -> u.jsonObject.let { UnsentItem(it["key"].str!!, it["kind"].str!!, it["source_id"].str!!, it["title"].str!!) } }
            if (expected.isNotEmpty()) nonEmpty++
            assertEquals(expected, HomeworkSend.unsentJobItems(result(o["result"])), "result[$i]")
        }
        assert(nonEmpty > 20) { "fixture should exercise unsent items" }
    }

    @Test
    fun labelsMatchTypeScript() {
        for ((i, l) in fixture()["labels"]!!.jsonArray.withIndex()) {
            val o = l.jsonObject
            assertEquals(o["sendTo"].str, HomeworkSend.sendToLabel(o["name"].str), "label[$i] sendTo")
            assertEquals(o["sendAll"].str, HomeworkSend.sendAllLabel(o["count"]!!.jsonPrimitive.int, o["name"].str), "label[$i] sendAll")
        }
    }

    @Test
    fun confirmAndToastMatchTypeScript() {
        for ((i, c) in fixture()["copy"]!!.jsonArray.withIndex()) {
            val o = c.jsonObject
            val titles = o["titles"]!!.jsonArray.map { it.str!! }
            assertEquals(o["confirm"].str, HomeworkSend.sendConfirmText(titles, o["name"].str), "copy[$i] confirm")
            assertEquals(o["toast"].str, HomeworkSend.sentToast(titles, o["name"].str), "copy[$i] toast")
        }
    }

    /** The cases of send.test.ts, spelled out so a failure reads plainly. */
    @Test
    fun webUnitCases() {
        assertEquals(
            listOf("deck", "lesson:l2", "reader"),
            HomeworkSend.unsentJobItems(
                SendJobResult(
                    deck = SendJobDeck("d", "饭馆", 12),
                    lessons = listOf(SendJobLesson("l1", "把", lessonId = "x"), SendJobLesson("l2", "了")),
                    reader = SendJobReader("r", "At the restaurant"),
                ),
            ).map { it.key },
        )
        assertEquals(emptyList(), HomeworkSend.unsentJobItems(SendJobResult(deck = SendJobDeck("d", "x", 0))))
        assertEquals(emptyList(), HomeworkSend.unsentJobItems(SendJobResult(deck = SendJobDeck("d", "x", 3, removedAt = "t"))))
        assertEquals(emptyList(), HomeworkSend.unsentJobItems(SendJobResult(reader = SendJobReader("r", "x", targetReaderId = "y"))))
        assertEquals(emptyList(), HomeworkSend.unsentJobItems(null))
        assertEquals("Send to Jerome", HomeworkSend.sendToLabel("Jerome Swannack"))
        assertEquals("Send all 3 to Jerome", HomeworkSend.sendAllLabel(3, "Jerome Swannack"))
        assertEquals("Send \"饭馆\" to Jerome as homework? It shows up in their app on their next sync.", HomeworkSend.sendConfirmText(listOf("饭馆"), "Jerome"))
        assertEquals("Send 2 items (\"a\", \"b\") to Jerome as homework? It shows up in their app on their next sync.", HomeworkSend.sendConfirmText(listOf("a", "b"), "Jerome"))
        assertEquals("Sent \"饭馆\" to Jerome", HomeworkSend.sentToast(listOf("饭馆"), "Jerome"))
        assertEquals("Sent 2 items to your student", HomeworkSend.sentToast(listOf("a", "b"), null))
    }
}
