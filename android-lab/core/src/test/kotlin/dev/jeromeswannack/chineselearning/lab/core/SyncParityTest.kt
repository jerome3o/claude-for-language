package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/** Package K: ghost-deck detection must match shared/decks/ghosts.ts (parity/fixtures/sync.ts). */
class SyncParityTest {
    private val fixture: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "sync.json").readText()).jsonObject
    }

    private val JsonElement.str: String? get() = if (this is JsonNull) null else jsonPrimitive.content

    @Test
    fun parseServerTimeMatches() {
        val cases = fixture["parse"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.size > 10)
        for (c in cases) {
            val want = c["ms"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.long }
            assertEquals(want, GhostDecks.parseServerTime(c["input"]!!.str), "parseServerTime(${c["input"]})")
        }
    }

    @Test
    fun findGhostDecksMatches() {
        val cases = fixture["ghosts"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.any { it["ghosts"]!!.jsonArray.isNotEmpty() })
        for ((i, c) in cases.withIndex()) {
            val decks = c["decks"]!!.jsonArray.map { d ->
                GhostDecks.LocalDeck(d.jsonObject["id"]!!.jsonPrimitive.content, d.jsonObject["created_at"]!!.str)
            }
            val live = c["live"]!!.jsonArray.map { it.jsonPrimitive.content }
            val want = c["ghosts"]!!.jsonArray.map { it.jsonPrimitive.content }
            assertEquals(want, GhostDecks.find(decks, live, c["at"]!!.str), "case $i")
        }
    }
}
