package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
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
 * The study queue — what is due today, how many new cards were introduced today, what
 * Home shows — must match shared/decks/study-queue.ts, the definition the web app's
 * getStudyQueue / Home / deck counts use (parity/fixtures/study-queue.ts). Before this
 * the rule lived only in frontend/ and the two apps disagreed on Jerome's account
 * (27 Sep 2026: Lab 37 due, web 0).
 */
class StudyQueueParityTest {
    private val fixture: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "study-queue.json").readText()).jsonObject
    }

    private val blank = CardScheduler.initialCardState()

    @Test
    fun introducedTodayQueueAndCountsMatchTypeScript() {
        val cases = fixture["cases"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.size >= 200)
        assertTrue(check(cases, "case") >= 400)
    }

    /** "New characters first" (shared/decks/novelty.ts): the same brand-new notes, in the same pick order. */
    @Test
    fun newCharactersFirstMatchesTypeScript() {
        val cases = fixture["novelty"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.size >= 200)
        assertTrue(check(cases, "novelty") >= 400)
    }

    /** "⚡ Study it today" (shared/decks/bumps.ts): the pocket heads the queue, NEW over the budget. */
    @Test
    fun bumpPocketMatchesTypeScript() {
        val cases = fixture["bumped"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.size >= 200)
        assertTrue(check(cases, "bumped") >= 400)
        // The fixture exercises every state: active, done, NEW over a spent budget, an early review.
        assertTrue(cases.any { it["pocket"]!!.jsonObject["done"]!!.jsonArray.isNotEmpty() })
        assertTrue(cases.any { it["pocket"]!!.jsonObject["active"]!!.jsonArray.isNotEmpty() })
    }

    private fun strings(e: kotlinx.serialization.json.JsonElement?) = e!!.jsonArray.map { it.jsonPrimitive.content }

    private fun check(cases: List<JsonObject>, label: String): Int {
        var queues = 0
        for ((n, c) in cases.withIndex()) {
            val i = "$label $n"
            val noteHanzi = c["noteHanzi"]?.jsonObject?.mapValues { it.value.jsonPrimitive.content }
            val seenNoteIds = c["seenNoteIds"]?.let { if (it is JsonNull) null else it.jsonArray.map { e -> e.jsonPrimitive.content } }
            val decks = c["decks"]!!.jsonArray.map { it.jsonObject }.map {
                QueueDeck(
                    it["id"]!!.jsonPrimitive.content,
                    it["priority"]!!.jsonPrimitive.int,
                    it["created_at"]!!.jsonPrimitive.content,
                    it["cap_primary"]!!.jsonPrimitive.int,
                    it["cap_secondary"]!!.jsonPrimitive.int,
                )
            }
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
            val first = c["firstReviewAt"]!!.jsonObject.mapValues { it.value.jsonPrimitive.long }
            val dayStart = c["dayStart"]!!.jsonPrimitive.long
            val budgetJson = c["budget"]!!.jsonObject
            val budget = StudyBudget(budgetJson["new_cards_per_day"]!!.jsonPrimitive.int, budgetJson["secondary_cards_per_day"]!!.jsonPrimitive.int)
            val bonus = c["bonus"]!!.jsonPrimitive.int
            val cutoff = StudyCutoff(c["cutoff"]!!.jsonPrimitive.long)

            val bumps = c["bumps"]?.let { b ->
                QueueBumps(
                    b.jsonArray.map { it.jsonObject }.map { QueueBump(it["note_id"]!!.jsonPrimitive.content, it["created_ms"]!!.jsonPrimitive.long) },
                    c["lastReviewAt"]!!.jsonObject.mapValues { it.value.jsonPrimitive.long },
                    first,
                )
            }
            c["pocket"]?.jsonObject?.let { p ->
                val pocket = Bumps.bumpPocket(cards, bumps, cutoff.ts)
                assertEquals(strings(p["cards"]), pocket.cards.map { it.id }, "$i pocket cards")
                assertEquals(strings(p["active"]), pocket.activeNoteIds, "$i pocket active")
                assertEquals(strings(p["done"]), pocket.doneNoteIds, "$i pocket done")
            }

            val introduced = StudyQueue.introducedToday(cards, first, dayStart)
            val expectedIntro = c["introduced"]!!.jsonArray.map { it.jsonObject }.associate {
                it["deckId"]!!.jsonPrimitive.content to Introduced(it["primary"]!!.jsonPrimitive.int, it["secondary"]!!.jsonPrimitive.int)
            }
            assertEquals(expectedIntro, introduced, "$i introducedToday")

            for (q in c["queues"]!!.jsonArray.map { it.jsonObject }) {
                val deckId = q["deckId"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.content }
                val where = "$i deck=$deckId"
                val built = StudyQueue.build(decks, cards, budget, bonus, introduced, cutoff, deckId, noteHanzi, seenNoteIds, bumps = bumps)
                q["bumped"]?.let { assertEquals(strings(it), built.bumped.map { c -> c.id }, "$where bumped cards in order") }
                q["bumpedNoteIds"]?.let { assertEquals(strings(it), built.bumpedNoteIds, "$where bumped note ids") }
                if (q["bumped"] != null) assertEquals(built.bumped, built.dueCards.take(built.bumped.size), "$where pocket heads the queue")
                assertEquals(q["due"]!!.jsonArray.map { it.jsonPrimitive.content }, built.dueCards.map { it.id }.sorted(), "$where due cards")
                assertEquals(
                    q["newOrder"]!!.jsonArray.map { it.jsonPrimitive.content },
                    built.dueCards.filter { it.queue == CardQueue.NEW }.map { it.id },
                    "$where new cards in pick order",
                )
                val counts = q["counts"]!!.jsonObject
                assertEquals(
                    QueueCounts(counts["new"]!!.jsonPrimitive.int, counts["secondaryNew"]!!.jsonPrimitive.int, counts["learning"]!!.jsonPrimitive.int, counts["review"]!!.jsonPrimitive.int),
                    StudyQueue.counts(built.dueCards, built.reviewedNoteIds),
                    "$where counts",
                )
                assertEquals(q["hasMoreNew"]!!.jsonPrimitive.boolean, built.hasMoreNew, "$where hasMoreNew")
                val alloc = q["allocation"]!!.jsonArray.map { it.jsonObject }.associate {
                    it["deckId"]!!.jsonPrimitive.content to DeckAllocation(it["primary"]!!.jsonPrimitive.int, it["secondary"]!!.jsonPrimitive.int)
                }
                assertEquals(alloc, built.allocation.toMap(), "$where allocation")
                queues++
            }
        }
        return queues
    }
}
