package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
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
 * "Practise this word other ways…" must offer exactly what the web offers: the same rows,
 * states, actions, default tick and copy, the same merge of a card-level request into an
 * active bump, and the same sibling spacing (parity/fixtures/other-card-types.ts →
 * other-card-types.json, from shared/decks/other-card-types.ts + shared/decks/bumps.ts).
 */
class OtherCardTypesParityTest {
    private val fixture: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "other-card-types.json").readText()).jsonObject
    }
    private val blank = CardScheduler.initialCardState()

    private fun strings(e: JsonElement?): List<String> = e!!.jsonArray.map { it.jsonPrimitive.content }
    private fun stringsOrNull(e: JsonElement?): List<String>? = if (e == null || e is JsonNull) null else strings(e)
    private fun str(e: JsonElement?): String? = if (e == null || e is JsonNull) null else e.jsonPrimitive.content

    @Test
    fun rowsMatchTypeScript() {
        val cases = fixture["rows"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.size >= 400)
        val actions = HashSet<String?>()
        for ((n, c) in cases.withIndex()) {
            val cards = c["cards"]!!.jsonArray.map { it.jsonObject }.map {
                val due = it["due_ms"]!!.let { d -> if (d is JsonNull) null else d.jsonPrimitive.long }
                QueueCard(
                    it["id"]!!.jsonPrimitive.content,
                    it["note_id"]!!.jsonPrimitive.content,
                    it["deck_id"]!!.jsonPrimitive.content,
                    it["card_type"]!!.jsonPrimitive.content,
                    blank.copy(queue = it["queue"]!!.jsonPrimitive.int, dueTimestamp = due),
                )
            }
            val rows = OtherCardTypes.rows(
                cards,
                c["current"]!!.jsonPrimitive.content,
                c["cutoff"]!!.jsonPrimitive.long,
                strings(c["inToday"]).toSet(),
                c["whole"]!!.jsonPrimitive.boolean,
            )
            val expected = c["rows"]!!.jsonArray.map { it.jsonObject }
            assertEquals(expected.size, rows.size, "$n row count")
            for ((k, e) in expected.withIndex()) {
                val r = rows[k]
                assertEquals(e["card_id"]!!.jsonPrimitive.content, r.cardId, "$n.$k card")
                assertEquals(e["card_type"]!!.jsonPrimitive.content, r.cardType, "$n.$k type")
                assertEquals(e["label"]!!.jsonPrimitive.content, r.label, "$n.$k label")
                assertEquals(e["status"]!!.jsonPrimitive.content, r.status, "$n.$k status")
                assertEquals(str(e["action"]), r.action, "$n.$k action")
                assertEquals(e["is_current"]!!.jsonPrimitive.boolean, r.isCurrent, "$n.$k current")
                actions += r.action
            }
            assertEquals(strings(c["picks"]), OtherCardTypes.defaultPicks(rows), "$n picks")
        }
        assertEquals(setOf(null, OtherCardTypes.ACTION_ADD, OtherCardTypes.ACTION_EARLY), actions)
    }

    @Test
    fun copyMatchesTypeScript() {
        for (d in fixture["due"]!!.jsonArray.map { it.jsonObject }) {
            assertEquals(d["label"]!!.jsonPrimitive.content, OtherCardTypes.dueInLabel(d["due"]!!.jsonPrimitive.long, d["cutoff"]!!.jsonPrimitive.long))
        }
        for (c in fixture["copy"]!!.jsonArray.map { it.jsonObject }) {
            assertEquals(c["button"]!!.jsonPrimitive.content, OtherCardTypes.buttonLabel(c["count"]!!.jsonPrimitive.int))
            assertEquals(c["message"]!!.jsonPrimitive.content, OtherCardTypes.addedMessage(strings(c["labels"])))
        }
        for (p in fixture["props"]!!.jsonArray.map { it.jsonObject }) {
            assertEquals(p["prop"]!!.jsonPrimitive.content, OtherCardTypes.typesProp(strings(p["types"])))
        }
    }

    @Test
    fun mergeMatchesTypeScript() {
        val cases = fixture["merges"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.size >= 300)
        val seen = HashSet<String>()
        for ((n, c) in cases.withIndex()) {
            val got = Bumps.mergeBumpCardTypes(
                c["hasExisting"]!!.jsonPrimitive.boolean,
                stringsOrNull(c["existing"]),
                strings(c["stillOpen"]),
                stringsOrNull(c["incoming"]),
            )
            val r = c["result"]!!.jsonObject
            assertEquals(r["action"]!!.jsonPrimitive.content, got.action, "$n action")
            assertEquals(stringsOrNull(r["card_types"]), got.cardTypes, "$n card types")
            seen += got.action
        }
        assertEquals(setOf("add", "already", "replace"), seen)
    }

    @Test
    fun siblingSpacingMatchesTypeScript() {
        data class C(val id: String, val noteId: String)
        val cases = fixture["spacing"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.size >= 300)
        var picked = 0
        var held = 0
        for ((n, c) in cases.withIndex()) {
            val candidates = c["candidates"]!!.jsonArray.map { it.jsonObject }.map { C(it["id"]!!.jsonPrimitive.content, it["note_id"]!!.jsonPrimitive.content) }
            val bumped = stringsOrNull(c["bumped"])?.toSet()
            val got = Bumps.pickBumpedCard(candidates, bumped, strings(c["recent"]), { it.id }, { it.noteId })
            assertEquals(str(c["pick"]), got?.id, "$n pick")
            if (got != null) picked++
            else if (bumped != null && candidates.any { it.id in bumped }) held++
        }
        assertTrue(picked > 50 && held > 20, "picked $picked, held back $held")
    }
}
