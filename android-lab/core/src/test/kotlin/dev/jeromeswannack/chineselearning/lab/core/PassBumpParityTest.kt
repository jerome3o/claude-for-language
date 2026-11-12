package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
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
 * The homework pass's ⚡ must bump exactly what the web bumps — the listening card of an unstarted
 * word, else its lead card, a started word whole, with the same long-term choice and copy — and the
 * queue must hold the bumped note's other NEW cards back the same way
 * (parity/fixtures/pass-bump.ts → pass-bump.json, from shared/homework/pass-bump.ts +
 * shared/decks/study-queue.ts).
 */
class PassBumpParityTest {
    private val fixture: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "pass-bump.json").readText()).jsonObject
    }
    private val blank = CardScheduler.initialCardState()

    private fun strings(e: JsonElement?): List<String> = e!!.jsonArray.map { it.jsonPrimitive.content }
    private fun stringsOrNull(e: JsonElement?): List<String>? = if (e == null || e is JsonNull) null else strings(e)
    private fun intOrNull(e: JsonElement?): Int? = if (e == null || e is JsonNull) null else e.jsonPrimitive.int

    @Test
    fun plansMatchTypeScript() {
        val cases = fixture["plans"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.size >= 400)
        val kinds = HashSet<String>()
        for ((n, c) in cases.withIndex()) {
            val cards = c["cards"]!!.jsonArray.map { it.jsonObject }.map { PassBump.NoteCard(it["card_type"]!!.jsonPrimitive.content, it["queue"]!!.jsonPrimitive.int) }
            val known = c["known"]!!.jsonPrimitive.boolean
            val got = PassBump.plan(
                cards,
                c["started"]!!.jsonPrimitive.boolean,
                c["hasAudio"]!!.jsonPrimitive.boolean,
                intOrNull(c["longTermPref"]),
                c["deckInReview"]!!.jsonPrimitive.boolean,
            ) { known }
            val want = c["plan"]!!.jsonObject
            assertEquals(want["kind"]!!.jsonPrimitive.content, got.kind, "$n kind")
            assertEquals(stringsOrNull(want["cardTypes"]), got.cardTypes, "$n cardTypes")
            val lt = want["longTerm"]!!
            val keep = lt is JsonPrimitive && lt.isString && lt.content == "keep"
            assertEquals(!keep, got.setLongTerm, "$n setLongTerm")
            if (!keep) assertEquals(intOrNull(lt), got.longTerm, "$n longTerm")
            kinds += got.kind
        }
        assertEquals(setOf(PassBump.LISTENING, PassBump.LEAD, PassBump.WHOLE), kinds)
    }

    @Test
    fun copyMatchesTypeScript() {
        for (c in fixture["copy"]!!.jsonArray.map { it.jsonObject }) {
            val kind = c["kind"]!!.jsonPrimitive.content
            assertEquals(c["off"]!!.jsonPrimitive.content, PassBump.label(kind, false))
            assertEquals(c["on"]!!.jsonPrimitive.content, PassBump.label(kind, true))
            assertEquals(c["hint"]!!.jsonPrimitive.content, PassBump.hint(kind))
        }
        for (r in fixture["rows"]!!.jsonArray.map { it.jsonObject }) {
            assertEquals(r["kind"]!!.jsonPrimitive.content, PassBump.kindOfRow(stringsOrNull(r["cardTypes"])))
        }
    }

    @Test
    fun queuesMatchTypeScript() {
        val cases = fixture["queues"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.size >= 250)
        var withPocket = 0
        for ((n, c) in cases.withIndex()) {
            val decks = c["decks"]!!.jsonArray.map { it.jsonObject }.map {
                QueueDeck(it["id"]!!.jsonPrimitive.content, it["priority"]!!.jsonPrimitive.int, it["created_at"]!!.jsonPrimitive.content, it["cap_primary"]!!.jsonPrimitive.int, it["cap_secondary"]!!.jsonPrimitive.int)
            }
            val cards = c["cards"]!!.jsonArray.map { it.jsonObject }.map {
                val due = it["due_ms"]!!.let { d -> if (d is JsonNull) null else d.jsonPrimitive.long }
                QueueCard(it["id"]!!.jsonPrimitive.content, it["note_id"]!!.jsonPrimitive.content, it["deck_id"]!!.jsonPrimitive.content, it["card_type"]!!.jsonPrimitive.content, blank.copy(queue = it["queue"]!!.jsonPrimitive.int, dueTimestamp = due))
            }
            val b = c["budget"]!!.jsonObject
            val budget = StudyBudget(b["new_cards_per_day"]!!.jsonPrimitive.int, b["secondary_cards_per_day"]!!.jsonPrimitive.int)
            val introduced = c["introduced"]!!.jsonObject.mapValues { (_, v) -> Introduced(v.jsonObject["primary"]!!.jsonPrimitive.int, v.jsonObject["secondary"]!!.jsonPrimitive.int) }
            val longTerm = c["longTerm"]!!.jsonObject.mapValues { it.value.jsonPrimitive.int }
            val bumps = QueueBumps(
                c["bumps"]!!.jsonArray.map { it.jsonObject }.map { QueueBump(it["note_id"]!!.jsonPrimitive.content, it["created_ms"]!!.jsonPrimitive.long, stringsOrNull(it["card_types"])) },
                c["last"]!!.jsonObject.mapValues { it.value.jsonPrimitive.long },
                c["first"]!!.jsonObject.mapValues { it.value.jsonPrimitive.long },
            )
            val upNext = stringsOrNull(c["upNext"])
            val cutoff = StudyCutoff(c["cutoff"]!!.jsonPrimitive.long)
            for (q in c["queues"]!!.jsonArray.map { it.jsonObject }) {
                val deckId = q["deckId"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.content }
                val where = "case $n deck=$deckId"
                val built = StudyQueue.build(decks, cards, budget, 0, introduced, cutoff, deckId, longTerm = longTerm, bumps = bumps, upNext = upNext)
                assertEquals(strings(q["due"]), built.dueCards.map { it.id }.sorted(), "$where due")
                assertEquals(strings(q["newOrder"]), built.dueCards.filter { it.queue == CardQueue.NEW }.map { it.id }, "$where new order")
                assertEquals(strings(q["bumped"]), built.bumped.map { it.id }, "$where bumped")
                assertEquals(strings(q["upNext"]), built.upNext.map { it.id }, "$where upNext")
                if (built.bumped.isNotEmpty()) withPocket++
            }
        }
        assertTrue(withPocket > 50, "enough queues with a pocket ($withPocket)")
    }
}
