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
 * Suspend & snooze (shared/decks/holds.ts): local-date arithmetic, which holds are on today,
 * labels, the management list's search, sibling burying, and the queue leaving held cards out
 * (a held NEW card frees its budget slot) — parity/fixtures/card-holds.ts.
 */
class CardHoldsParityTest {
    private val fixture: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "card-holds.json").readText()).jsonObject
    }
    private val blank = CardScheduler.initialCardState()

    private fun str(e: JsonElement?): String? = if (e == null || e is JsonNull) null else e.jsonPrimitive.content
    private fun strings(e: JsonElement?): List<String> = e!!.jsonArray.map { it.jsonPrimitive.content }

    private fun hold(o: JsonObject) = CardHold(o["id"]!!.jsonPrimitive.content, o["card_id"]!!.jsonPrimitive.content, o["kind"]!!.jsonPrimitive.content, str(o["until"]), o["created_at"]!!.jsonPrimitive.content)

    @Test
    fun datesMatchTypeScript() {
        val cases = fixture["dates"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.size >= 300)
        for (c in cases) {
            val d = c["date"]!!.jsonPrimitive.content
            assertEquals(c["n"]!!.jsonPrimitive.long, CardHolds.dayNumber(d), d)
            assertEquals(d, CardHolds.dateOfDayNumber(CardHolds.dayNumber(d)), d)
            c["plus1"]?.let { assertEquals(it.jsonPrimitive.content, CardHolds.addDays(d, 1), "$d +1") }
            c["plus7"]?.let { assertEquals(it.jsonPrimitive.content, CardHolds.addDays(d, 7), "$d +7") }
            c["minus40"]?.let { assertEquals(it.jsonPrimitive.content, CardHolds.addDays(d, -40), "$d -40") }
            c["month"]?.let { assertEquals(it.jsonPrimitive.content, CardHolds.addMonths(d, 1), "$d +1 month") }
            c["year"]?.let { assertEquals(it.jsonPrimitive.content, CardHolds.addMonths(d, 12), "$d +12 months") }
            c["k"]?.let { assertEquals(c["plusK"]!!.jsonPrimitive.content, CardHolds.addDays(d, it.jsonPrimitive.int), "$d + k") }
            c["m"]?.let { assertEquals(c["plusM"]!!.jsonPrimitive.content, CardHolds.addMonths(d, it.jsonPrimitive.int), "$d + m months") }
            assertEquals(c["tomorrow"]!!.jsonPrimitive.content, CardHolds.snoozeUntil(d, "tomorrow"))
            assertEquals(c["week"]!!.jsonPrimitive.content, CardHolds.snoozeUntil(d, "week"))
            assertEquals(c["monthSnooze"]!!.jsonPrimitive.content, CardHolds.snoozeUntil(d, "month"))
        }
        for (v in fixture["valid"]!!.jsonArray.map { it.jsonObject }) {
            assertEquals(v["ok"]!!.jsonPrimitive.boolean, CardHolds.isLocalDate(v["s"]!!.jsonPrimitive.content), v["s"].toString())
        }
    }

    @Test
    fun holdsAndLabelsMatchTypeScript() {
        val cases = fixture["holds"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.size >= 300)
        for ((n, c) in cases.withIndex()) {
            val today = c["today"]!!.jsonPrimitive.content
            val holds = c["holds"]!!.jsonArray.map { hold(it.jsonObject) }
            assertEquals(c["active"]!!.jsonArray.map { it.jsonPrimitive.boolean }, holds.map { CardHolds.isActive(it, today) }, "$n active")
            assertEquals(strings(c["held"]), CardHolds.heldCardIds(holds, today).toList(), "$n held")
            assertEquals(str(c["best"]), CardHolds.activeHoldFor(holds, today)?.id, "$n best")
            assertEquals(strings(c["labels"]), holds.map { CardHolds.statusLabel(it.kind, it.until, today) }, "$n labels")
            val tags = c["tags"]!!.jsonArray.map { it.jsonObject.let { t -> t["icon"]!!.jsonPrimitive.content to t["text"]!!.jsonPrimitive.content } }
            assertEquals(tags, holds.map { CardHolds.tag(it.kind, it.until, today) }, "$n tags")
            val byCard = holds.associateBy { it.cardId }
            val noteTag = c["noteTag"]!!.let { if (it is JsonNull) null else it.jsonObject.let { t -> t["icon"]!!.jsonPrimitive.content to t["text"]!!.jsonPrimitive.content } }
            assertEquals(noteTag, CardHolds.noteTag(strings(c["noteCards"]), byCard, today), "$n note tag")
            val count = c["count"]!!.jsonPrimitive.int
            assertEquals(c["suspendMessage"]!!.jsonPrimitive.content, CardHolds.message(CardHolds.SUSPEND, count), "$n suspend message")
            assertEquals(c["snoozeMessage"]!!.jsonPrimitive.content, CardHolds.message(CardHolds.SNOOZE, count, c["length"]!!.jsonPrimitive.content), "$n snooze message")
            assertEquals(c["releaseMessage"]!!.jsonPrimitive.content, CardHolds.releaseMessage(count), "$n release message")
        }
    }

    @Test
    fun managementListMatchesTypeScript() {
        val cases = fixture["rows"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.size >= 200)
        for ((n, c) in cases.withIndex()) {
            val rows = c["rows"]!!.jsonArray.map { it.jsonObject }.map { r ->
                val h = r["hold"]!!.jsonObject
                val id = r["card_id"]!!.jsonPrimitive.content
                HoldListRow(id, CardHold("h-$id", id, h["kind"]!!.jsonPrimitive.content, str(h["until"]), h["created_at"]!!.jsonPrimitive.content),
                    r["hanzi"]!!.jsonPrimitive.content, r["pinyin"]!!.jsonPrimitive.content, r["english"]!!.jsonPrimitive.content)
            }
            assertEquals(strings(c["result"]), CardHolds.filterRows(rows, c["query"]!!.jsonPrimitive.content, c["filter"]!!.jsonPrimitive.content).map { it.cardId }, "$n rows")
        }
    }

    private fun cards(c: JsonObject) = c["cards"]!!.jsonArray.map { it.jsonObject }.map {
        val due = it["due_ms"]!!.let { d -> if (d is JsonNull) null else d.jsonPrimitive.long }
        QueueCard(it["id"]!!.jsonPrimitive.content, it["note_id"]!!.jsonPrimitive.content, it["deck_id"]!!.jsonPrimitive.content, it["card_type"]!!.jsonPrimitive.content,
            blank.copy(queue = it["queue"]!!.jsonPrimitive.int, dueTimestamp = due))
    }

    @Test
    fun siblingBuryingMatchesTypeScript() {
        val cases = fixture["buried"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.any { strings(it["result"]).isNotEmpty() })
        for ((n, c) in cases.withIndex()) {
            assertEquals(strings(c["result"]), CardHolds.siblingBuriedCardIds(cards(c), strings(c["reviewedToday"]).toSet(), strings(c["exempt"])).toList(), "$n buried")
        }
    }

    @Test
    fun queueLeavesHeldCardsOutLikeTypeScript() {
        val cases = fixture["queues"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.size >= 300)
        var checked = 0
        for ((n, c) in cases.withIndex()) {
            val decks = c["decks"]!!.jsonArray.map { it.jsonObject }.map {
                QueueDeck(it["id"]!!.jsonPrimitive.content, it["priority"]!!.jsonPrimitive.int, it["created_at"]!!.jsonPrimitive.content, it["cap_primary"]!!.jsonPrimitive.int, it["cap_secondary"]!!.jsonPrimitive.int)
            }
            val cards = cards(c)
            val first = c["firstReviewAt"]!!.jsonObject.mapValues { it.value.jsonPrimitive.long }
            val last = c["lastReviewAt"]!!.jsonObject.mapValues { it.value.jsonPrimitive.long }
            val budgetJson = c["budget"]!!.jsonObject
            val budget = StudyBudget(budgetJson["new_cards_per_day"]!!.jsonPrimitive.int, budgetJson["secondary_cards_per_day"]!!.jsonPrimitive.int)
            val bumps = c["bumps"]!!.let { b -> if (b is JsonNull) null else QueueBumps(b.jsonArray.map { it.jsonObject }.map { QueueBump(it["note_id"]!!.jsonPrimitive.content, it["created_ms"]!!.jsonPrimitive.long) }, last, first) }
            val upNext = c["upNextList"]!!.let { if (it is JsonNull) null else strings(it) }
            val holds = QueueHolds(strings(c["held"]).toSet(), c["reviewedToday"]!!.let { if (it is JsonNull) null else strings(it).toSet() })
            val introduced = StudyQueue.introducedToday(cards, first, c["dayStart"]!!.jsonPrimitive.long)
            for (q in c["queues"]!!.jsonArray.map { it.jsonObject }) {
                val deckId = str(q["deckId"])
                val where = "$n deck=$deckId"
                val built = StudyQueue.build(decks, cards, budget, c["bonus"]!!.jsonPrimitive.int, introduced, StudyCutoff(c["cutoff"]!!.jsonPrimitive.long), deckId, bumps = bumps, upNext = upNext, holds = holds)
                assertEquals(strings(q["due"]), built.dueCards.map { it.id }.sorted(), "$where due")
                assertEquals(strings(q["newOrder"]), built.dueCards.filter { it.queue == CardQueue.NEW }.map { it.id }, "$where new order")
                assertEquals(strings(q["bumped"]), built.bumped.map { it.id }, "$where bumped")
                assertEquals(strings(q["upNext"]), built.upNext.map { it.id }, "$where up next")
                val counts = q["counts"]!!.jsonObject
                assertEquals(
                    QueueCounts(counts["new"]!!.jsonPrimitive.int, counts["secondaryNew"]!!.jsonPrimitive.int, counts["learning"]!!.jsonPrimitive.int, counts["review"]!!.jsonPrimitive.int),
                    StudyQueue.counts(built.dueCards, built.reviewedNoteIds), "$where counts",
                )
                assertEquals(q["hasMoreNew"]!!.jsonPrimitive.boolean, built.hasMoreNew, "$where hasMoreNew")
                val alloc = q["allocation"]!!.jsonArray.map { it.jsonObject }.associate { it["deckId"]!!.jsonPrimitive.content to DeckAllocation(it["primary"]!!.jsonPrimitive.int, it["secondary"]!!.jsonPrimitive.int) }
                assertEquals(alloc, built.allocation.toMap(), "$where allocation")
                // Nothing held is ever in the queue.
                assertTrue(built.dueCards.none { it.id in holds.held }, "$where held left out")
                checked++
            }
        }
        assertTrue(checked >= 600)
    }
}
