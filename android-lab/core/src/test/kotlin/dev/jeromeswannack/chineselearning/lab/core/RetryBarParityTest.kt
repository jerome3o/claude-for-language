package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
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

/** The retry progress bar (docs/HOMEWORK.md §3c) reproduces shared/homework/retry-bar.ts exactly. */
class RetryBarParityTest {
    private val json = Json { ignoreUnknownKeys = true }
    private val exercise = RetryBarUnit("exercise", "exercises")

    private fun fixture(): JsonObject {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        return Json.parseToJsonElement(File(dir, "retry-bar.json").readText()).jsonObject
    }

    private val JsonElement.str: String? get() = if (this is JsonNull) null else jsonPrimitive.content
    private fun JsonObject.int(k: String) = this[k]!!.jsonPrimitive.int

    private fun check(o: JsonObject, bar: RetryBar, where: String) {
        val e = o["bar"]!!.jsonObject
        assertEquals(e.int("answered"), bar.answered, "$where answered")
        assertEquals(e.int("fresh"), bar.fresh, "$where fresh")
        assertEquals(e.int("retries"), bar.retries, "$where retries")
        assertEquals(e.int("itemsDone"), bar.itemsDone, "$where itemsDone")
        assertEquals(e.int("items"), bar.items, "$where items")
        assertEquals(e.int("slots"), bar.slots, "$where slots")
        assertEquals(e["doneFraction"]!!.jsonPrimitive.double, bar.doneFraction, "$where doneFraction")
        assertEquals(e["retryFraction"]!!.jsonPrimitive.double, bar.retryFraction, "$where retryFraction")
        assertEquals(e["onRetries"]!!.jsonPrimitive.boolean, bar.onRetries, "$where onRetries")
        assertEquals(e["complete"]!!.jsonPrimitive.boolean, bar.complete, "$where complete")
        assertEquals(o["label"]!!.str, RetryBars.label(bar), "$where label")
        assertEquals(o["label_exercises"]!!.str, RetryBars.label(bar, exercise), "$where label exercises")
        assertEquals(o["badge"]!!.str, RetryBars.badge(bar), "$where badge")
        assertEquals(o["note"]!!.str, RetryBars.note(bar), "$where note")
    }

    @Test
    fun passBarsMatchTypeScript() {
        val passes = fixture()["passes"]!!.jsonArray
        for ((i, c) in passes.withIndex()) {
            val o = c.jsonObject
            val events = json.decodeFromJsonElement(ListSerializer(HomeworkEvent.serializer()), JsonArray(o["events"]!!.jsonArray.map { e ->
                JsonObject(e.jsonObject + ("assignment_id" to JsonPrimitive("a")))
            }))
            val ids = o["item_ids"]!!.jsonArray.map { it.str!! }
            check(o, RetryBars.passRetryBar(ids, events), "pass[$i]")
        }
        assertTrue(passes.size >= 300)
        assertTrue(passes.any { it.jsonObject["bar"]!!.jsonObject["onRetries"]!!.jsonPrimitive.boolean }, "some vectors are on retries")
    }

    @Test
    fun countBarsMatchTypeScript() {
        val counts = fixture()["counts"]!!.jsonArray
        for ((i, c) in counts.withIndex()) {
            val o = c.jsonObject
            val input = o["input"]!!.jsonObject
            check(o, RetryBars.retryBar(input.int("answered"), input.int("fresh"), input.int("retries"), input.int("itemsDone"), input.int("items")), "counts[$i]")
        }
        assertTrue(counts.size >= 150)
    }
}
