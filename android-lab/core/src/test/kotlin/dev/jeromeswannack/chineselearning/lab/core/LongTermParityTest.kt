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
 * "Add to my long-term review" (docs/HOMEWORK.md §3a) must decide exactly what the web decides:
 * the pure rules of shared/decks/long-term.ts and the study queue with opted-in / opted-out
 * words (parity/fixtures/long-term.ts → long-term.json).
 */
class LongTermParityTest {
    private val fixture: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "long-term.json").readText()).jsonObject
    }

    private fun pref(e: JsonElement?): Int? = if (e == null || e is JsonNull) null else e.jsonPrimitive.int

    @Test
    fun rulesMatchTypeScript() {
        for (r in fixture["rules"]!!.jsonArray.map { it.jsonObject }) {
            val p = pref(r["pref"])
            val inReview = r["inReview"]!!.jsonPrimitive.boolean
            val reviewed = r["reviewed"]!!.jsonPrimitive.boolean
            assertEquals(r["isLongTerm"]!!.jsonPrimitive.boolean, LongTerm.isLongTerm(p, inReview, reviewed), "isLongTerm $r")
            assertEquals(r["admits"]!!.jsonPrimitive.boolean, LongTerm.admitsNewCards(p, inReview, reviewed), "admitsNewCards $r")
        }
        for (t in fixture["toggles"]!!.jsonArray.map { it.jsonObject }) {
            assertEquals(pref(t["pref"]), LongTerm.prefForToggle(t["on"]!!.jsonPrimitive.boolean, t["inReview"]!!.jsonPrimitive.boolean), "prefForToggle $t")
        }
        for (c in fixture["caps"]!!.jsonArray.map { it.jsonObject }) {
            val p = c["p"]!!.jsonPrimitive.int
            val s = c["s"]!!.jsonPrimitive.int
            assertEquals(c["inReview"]!!.jsonPrimitive.boolean, LongTerm.deckInDailyReview(p, s))
            val caps = c["caps"]!!.jsonObject
            assertEquals(caps["capPrimary"]!!.jsonPrimitive.int to caps["capSecondary"]!!.jsonPrimitive.int, LongTerm.caps(p, s), "caps $c")
        }
        val summaries = fixture["summaries"]!!.jsonArray.map { it.jsonObject }
        assertTrue(summaries.size >= 50)
        for (s in summaries) {
            val words = s["words"]!!.jsonArray.map { it.jsonObject }.map { LongTerm.Word(pref(it["pref"]), it["reviewed"]!!.jsonPrimitive.boolean) }
            val want = s["summary"]!!.jsonObject
            assertEquals(
                LongTerm.Summary(want["added"]!!.jsonPrimitive.int, want["leftOut"]!!.jsonPrimitive.int),
                LongTerm.summary(words, s["inReview"]!!.jsonPrimitive.boolean),
                "summary $s",
            )
        }
    }

    @Test
    fun studyQueueWithChoicesMatchesTypeScript() {
        val blank = CardScheduler.initialCardState()
        val cases = fixture["queues"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.size >= 200)
        var checked = 0
        var withChoices = 0
        for ((n, c) in cases.withIndex()) {
            val decks = c["decks"]!!.jsonArray.map { it.jsonObject }.map {
                QueueDeck(it["id"]!!.jsonPrimitive.content, it["priority"]!!.jsonPrimitive.int, it["created_at"]!!.jsonPrimitive.content, it["cap_primary"]!!.jsonPrimitive.int, it["cap_secondary"]!!.jsonPrimitive.int)
            }
            val cards = c["cards"]!!.jsonArray.map { it.jsonObject }.map {
                val due = it["due_ms"]!!.let { d -> if (d is JsonNull) null else d.jsonPrimitive.long }
                QueueCard(it["id"]!!.jsonPrimitive.content, it["note_id"]!!.jsonPrimitive.content, it["deck_id"]!!.jsonPrimitive.content, it["card_type"]!!.jsonPrimitive.content, blank.copy(queue = it["queue"]!!.jsonPrimitive.int, dueTimestamp = due))
            }
            val first = c["firstReviewAt"]!!.jsonObject.mapValues { it.value.jsonPrimitive.long }
            val introduced = StudyQueue.introducedToday(cards, first, c["dayStart"]!!.jsonPrimitive.long)
            val b = c["budget"]!!.jsonObject
            val budget = StudyBudget(b["new_cards_per_day"]!!.jsonPrimitive.int, b["secondary_cards_per_day"]!!.jsonPrimitive.int)
            val longTerm = c["longTerm"]!!.jsonObject.mapValues { it.value.jsonPrimitive.int }
            if (longTerm.isNotEmpty()) withChoices++
            val noteHanzi = c["noteHanzi"]!!.let { if (it is JsonNull) null else it.jsonObject.mapValues { e -> e.value.jsonPrimitive.content } }
            for (q in c["queues"]!!.jsonArray.map { it.jsonObject }) {
                val deckId = q["deckId"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.content }
                val where = "case $n deck=$deckId"
                val built = StudyQueue.build(decks, cards, budget, c["bonus"]!!.jsonPrimitive.int, introduced, StudyCutoff(c["cutoff"]!!.jsonPrimitive.long), deckId, noteHanzi, null, longTerm)
                assertEquals(q["due"]!!.jsonArray.map { it.jsonPrimitive.content }, built.dueCards.map { it.id }.sorted(), "$where due")
                assertEquals(q["newOrder"]!!.jsonArray.map { it.jsonPrimitive.content }, built.dueCards.filter { it.queue == CardQueue.NEW }.map { it.id }, "$where new order")
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
                val pools = q["pools"]!!.jsonArray.map { it.jsonObject }.map {
                    listOf(it["deckId"]!!.jsonPrimitive.content, it["totalNew"]!!.jsonPrimitive.int, it["totalSecondaryNew"]!!.jsonPrimitive.int, it["capPrimary"]!!.jsonPrimitive.int, it["capSecondary"]!!.jsonPrimitive.int)
                }
                assertEquals(pools, built.pools.map { listOf(it.deckId, it.totalNew, it.totalSecondaryNew, it.capPrimary, it.capSecondary) }, "$where pools")
                checked++
            }
        }
        assertTrue(checked >= 400)
        assertTrue(withChoices >= 150)
    }

    @Test
    fun finishLineReadsLikeTheWeb() {
        assertEquals("12 words added to daily review · 4 left out", LongTerm.line(12, 4))
        assertEquals("All 16 words go into your daily review", LongTerm.line(16, 0))
        assertEquals("The word goes into your daily review", LongTerm.line(1, 0))
        assertEquals("3 words left out of daily review", LongTerm.line(0, 3))
    }
}
