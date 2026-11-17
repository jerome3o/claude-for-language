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

/**
 * The ⋯ menu's other-card tiles must say exactly what the web says: the same status, line,
 * strength, tone and offers for every card (parity/fixtures/sibling-status.ts →
 * sibling-status.json, from shared/decks/sibling-status.ts).
 */
class SiblingStatusParityTest {
    private val fixture: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "sibling-status.json").readText()).jsonObject
    }

    private fun strings(e: JsonElement?): List<String> = e!!.jsonArray.map { it.jsonPrimitive.content }
    private fun str(e: JsonElement?): String? = if (e == null || e is JsonNull) null else e.jsonPrimitive.content
    private fun lng(e: JsonElement?): Long? = if (e == null || e is JsonNull) null else e.jsonPrimitive.long
    private fun dbl(e: JsonElement?): Double? = if (e == null || e is JsonNull) null else e.jsonPrimitive.double

    @Test
    fun tilesMatchTypeScript() {
        val cases = fixture["tiles"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.size >= 500)
        val statuses = HashSet<String>()
        for ((n, c) in cases.withIndex()) {
            val cards = c["cards"]!!.jsonArray.map { it.jsonObject }.map {
                SiblingStatus.Card(
                    it["id"]!!.jsonPrimitive.content,
                    it["card_type"]!!.jsonPrimitive.content,
                    it["queue"]!!.jsonPrimitive.int,
                    lng(it["due_ms"]),
                    dbl(it["stability"]),
                    it["lapses"]!!.jsonPrimitive.int,
                )
            }
            val holds = c["holds"]!!.jsonArray.map { it.jsonObject }.associate {
                val id = it["card_id"]!!.jsonPrimitive.content
                id to CardHold("h-$id", id, it["kind"]!!.jsonPrimitive.content, str(it["until"]), "")
            }
            val ctx = SiblingStatus.Context(
                c["cutoff"]!!.jsonPrimitive.long,
                c["today"]!!.jsonPrimitive.content,
                holds,
                strings(c["inToday"]).toSet(),
                c["canBump"]!!.jsonPrimitive.boolean,
            )
            val current = c["current"]!!.jsonPrimitive.content
            val tiles = SiblingStatus.tiles(cards, current, ctx)
            val expected = c["tiles"]!!.jsonArray.map { it.jsonObject }
            val inSession = c["in_session"]!!.jsonPrimitive.boolean
            assertEquals(expected.size, tiles.size, "$n count")
            for ((k, e) in expected.withIndex()) {
                val t = tiles[k]
                val at = "$n.$k"
                assertEquals(e["card_id"]!!.jsonPrimitive.content, t.cardId, "$at id")
                assertEquals(e["symbol"]!!.jsonPrimitive.content, t.symbol, "$at symbol")
                assertEquals(e["name"]!!.jsonPrimitive.content, t.name, "$at name")
                assertEquals(e["detail"]!!.jsonPrimitive.content, t.detail, "$at detail")
                assertEquals(e["status"]!!.jsonPrimitive.content, t.status, "$at status")
                assertEquals(e["line"]!!.jsonPrimitive.content, t.line, "$at line")
                assertEquals(e["strength"]!!.jsonPrimitive.int, t.strength, "$at strength")
                assertEquals(e["tone"]!!.jsonPrimitive.content, t.tone, "$at tone")
                assertEquals(str(e["bump"]), t.bump, "$at bump")
                assertEquals(str(e["bump_note"]), t.bumpNote, "$at bump note")
                assertEquals(str(e["release"]), t.release, "$at release")
                assertEquals(e["can_forget"]!!.jsonPrimitive.boolean, t.canForget, "$at forget")
                assertEquals(e["label"]!!.jsonPrimitive.content, SiblingStatus.tileLabel(t), "$at label")
                assertEquals(e["bump_label"]!!.jsonPrimitive.content, SiblingStatus.bumpLabel(t.bump), "$at bump label")
                assertEquals(e["message"]!!.jsonPrimitive.content, SiblingStatus.bumpedMessage(t.detail, inSession), "$at message")
                statuses += t.status
            }
            val currentType = cards.first { it.id == current }.cardType
            assertEquals(strings(c["missing"]), SiblingStatus.missingTypes(cards.map { it.cardType }, currentType), "$n missing")
        }
        assertEquals(
            setOf(
                SiblingStatus.NOT_STARTED, SiblingStatus.NEW_TODAY, SiblingStatus.LEARNING, SiblingStatus.DUE, SiblingStatus.REVIEW,
                SiblingStatus.KNOWN, SiblingStatus.SUSPENDED, SiblingStatus.SNOOZED, SiblingStatus.LEECH,
            ),
            statuses,
        )
    }

    @Test
    fun helpersMatchTypeScript() {
        for (d in fixture["next"]!!.jsonArray.map { it.jsonObject }) {
            assertEquals(d["label"]!!.jsonPrimitive.content, SiblingStatus.nextInLabel(d["due"]!!.jsonPrimitive.long, d["cutoff"]!!.jsonPrimitive.long))
        }
        for (s in fixture["strengths"]!!.jsonArray.map { it.jsonObject }) {
            assertEquals(s["strength"]!!.jsonPrimitive.int, SiblingStatus.strength(s["queue"]!!.jsonPrimitive.int, dbl(s["stability"])))
        }
    }
}
