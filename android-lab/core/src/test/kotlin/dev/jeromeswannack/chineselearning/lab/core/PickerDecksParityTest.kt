package dev.jeromeswannack.chineselearning.lab.core

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
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail

/** The add-card pickers' deck order + default reproduce shared/decks/queue.ts exactly (parity/fixtures/deck-picker.ts). */
class PickerDecksParityTest {
    private data class D(val id: String, val priority: Int?, val createdAt: String?)

    private val root: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "deck-picker.json").readText()).jsonObject
    }

    @Test
    fun orderAndDefaultMatchTheWeb() {
        val cases = root["cases"]!!.jsonArray
        assertTrue(cases.size >= 400)
        for ((i, c) in cases.withIndex()) {
            val o = c.jsonObject
            val decks = o["decks"]!!.jsonArray.map { e ->
                val d = e.jsonObject
                D(
                    d["id"]!!.jsonPrimitive.content,
                    d["study_priority"]?.takeIf { it != JsonNull }?.jsonPrimitive?.int,
                    d["created_at"]?.takeIf { it != JsonNull }?.jsonPrimitive?.content,
                )
            }
            val preferred = o["preferred"]?.takeIf { it != JsonNull }?.jsonPrimitive?.content
            val order = o["order"]!!.jsonArray.map { it.jsonPrimitive.content }
            assertEquals(order, PickerDecks.inQueueOrder(decks, { it.priority }, { it.createdAt }).map { it.id }, "case $i order")
            val want = o["default"]!!.jsonPrimitive.content
            val got = PickerDecks.defaultId(decks, { it.id }, { it.priority }, { it.createdAt }, preferred)
            assertEquals(want, got.orEmpty(), "case $i default")
        }
    }

    @Test
    fun topOfTheQueueIsTheDefault() {
        val decks = listOf(
            D("hsk", 0, "2026-01-01 10:00:00"),
            D("homework", 5, "2026-03-01 10:00:00"),
            D("chats", 0, "2026-02-01 10:00:00"),
            D("starter", 5, "2025-12-01 10:00:00"),
        )
        assertEquals(listOf("homework", "starter", "chats", "hsk"), PickerDecks.inQueueOrder(decks, { it.priority }, { it.createdAt }).map { it.id })
        assertEquals("homework", PickerDecks.defaultId(decks, { it.id }, { it.priority }, { it.createdAt }))
        assertEquals("hsk", PickerDecks.defaultId(decks, { it.id }, { it.priority }, { it.createdAt }, preferred = "hsk"))
        assertEquals("homework", PickerDecks.defaultId(decks, { it.id }, { it.priority }, { it.createdAt }, preferred = "deleted"))
        assertNull(PickerDecks.defaultId(emptyList<D>(), { it.id }, { it.priority }, { it.createdAt }))
    }
}
