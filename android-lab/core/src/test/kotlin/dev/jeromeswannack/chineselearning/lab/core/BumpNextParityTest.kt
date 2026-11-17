package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * "⚡ Study it today" during a session: where a bump's cards go (next / the ⚡ mix) and the next card must match
 * the web exactly (parity/fixtures/bump-next.ts → bump-next.json, from shared/decks/bump-next.ts).
 */
class BumpNextParityTest {
    private val fixture: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "bump-next.json").readText()).jsonObject
    }

    private data class C(val id: String, val cardType: String)

    private fun strings(e: JsonElement?): List<String> = e!!.jsonArray.map { it.jsonPrimitive.content }
    private fun str(e: JsonElement?): String? = if (e == null || e is JsonNull) null else e.jsonPrimitive.content

    @Test
    fun plansMatchTypeScript() {
        val cases = fixture["plans"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.size >= 300)
        var nexts = 0
        for ((n, c) in cases.withIndex()) {
            val pocket = c["pocket"]!!.jsonArray.map { it.jsonObject }.map { C(it["id"]!!.jsonPrimitive.content, it["card_type"]!!.jsonPrimitive.content) }
            val got = BumpNext.sessionPlan(
                pocket, c["started"]!!.jsonPrimitive.boolean, c["nearby"]!!.jsonPrimitive.boolean, c["byEar"]!!.jsonPrimitive.boolean,
            ) { it.cardType }
            assertEquals(str(c["next"]), got.next?.id, "$n next")
            assertEquals(strings(c["mixed"]), got.mixed.map { it.id }, "$n mixed")
            if (got.next != null) nexts++
        }
        assertTrue(nexts > 50, "nexts $nexts")
    }

    @Test
    fun picksMatchTypeScript() {
        for ((n, c) in fixture["picks"]!!.jsonArray.map { it.jsonObject }.withIndex()) {
            val queue = strings(c["queue"])
            val next = c["next"]!!.let { if (it is JsonNull) null else strings(it) }
            assertEquals(str(c["pick"]), BumpNext.pickNextUp(queue, next) { it }, "$n pick")
        }
    }

    @Test
    fun theNextUpCardComesBeforeEverythingInTheSession() {
        val now = 1_800_000_000_000L
        val cutoff = StudyCutoff(now + 3_600_000)
        fun card(id: String, note: String, type: String, queue: Int, due: Long? = null) =
            QueueCard(id, note, "d1", type, CardScheduler.initialCardState().copy(queue = queue, dueTimestamp = due))
        val learningDue = card("l", "nl", CardTypes.HANZI_TO_MEANING, CardQueue.LEARNING, now - 60_000)
        val review = card("r", "nr", CardTypes.HANZI_TO_MEANING, CardQueue.REVIEW, now - 60_000)
        val w1 = card("w1-a", "nw1", CardTypes.AUDIO_TO_HANZI, CardQueue.NEW)
        val w2 = card("w2-a", "nw2", CardTypes.AUDIO_TO_HANZI, CardQueue.NEW)
        val queue = listOf(learningDue, review, w1, w2)
        // He just asked for it: before the learning card due now too, in the order bumped.
        assertEquals("w2-a", StudyQueue.selectNext(queue, emptySet(), emptyList(), null, now, cutoff, Random(1), setOf("w1-a", "w2-a"), nextUpIds = listOf("w2-a", "w1-a"))?.id)
        assertEquals("w1-a", StudyQueue.selectNext(queue - w2, emptySet(), emptyList(), null, now, cutoff, Random(1), setOf("w1-a"), nextUpIds = listOf("w2-a", "w1-a"))?.id)
        // Without it: the learning card due now first, as before.
        assertEquals("l", StudyQueue.selectNext(queue, emptySet(), emptyList(), null, now, cutoff, Random(1), setOf("w1-a", "w2-a"))?.id)
    }
}
