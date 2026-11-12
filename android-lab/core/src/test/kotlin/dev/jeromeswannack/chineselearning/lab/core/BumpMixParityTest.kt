package dev.jeromeswannack.chineselearning.lab.core

import dev.jeromeswannack.chineselearning.lab.core.explorer.Drill
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
 * "⚡ Study it today" mixed with the reviews: the chance, single draws and whole seeded sessions
 * must match the web exactly (parity/fixtures/bump-mix.ts → bump-mix.json, from
 * shared/decks/bumps.ts bumpPickChance / mixBumpedCard).
 */
class BumpMixParityTest {
    private val fixture: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "bump-mix.json").readText()).jsonObject
    }

    private data class C(val id: String, val noteId: String, val queue: Int)

    private fun strings(e: JsonElement?): List<String> = e!!.jsonArray.map { it.jsonPrimitive.content }
    private fun str(e: JsonElement?): String? = if (e == null || e is JsonNull) null else e.jsonPrimitive.content

    @Test
    fun chanceMatchesTypeScript() {
        for (c in fixture["chances"]!!.jsonArray.map { it.jsonObject }) {
            val got = Bumps.bumpPickChance(c["bumped"]!!.jsonPrimitive.int, c["others"]!!.jsonPrimitive.int)
            assertEquals(c["chance"]!!.jsonPrimitive.double, got, "$c")
        }
    }

    @Test
    fun drawsMatchTypeScript() {
        val cases = fixture["draws"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.size >= 400)
        var picked = 0
        var declined = 0
        for ((n, c) in cases.withIndex()) {
            val candidates = c["candidates"]!!.jsonArray.map { it.jsonObject }.map {
                C(it["id"]!!.jsonPrimitive.content, it["note_id"]!!.jsonPrimitive.content, it["queue"]!!.jsonPrimitive.int)
            }
            val bumped = c["bumped"]!!.let { if (it is JsonNull) null else strings(it).toSet() }
            val r = c["r"]!!.jsonPrimitive.double
            var used = false
            val got = Bumps.mixBumpedCard(candidates, bumped, strings(c["recent"]), { used = true; r }, { it.id }, { it.noteId }, { it.queue })
            assertEquals(str(c["pick"]), got?.id, "$n pick")
            assertEquals(c["used"]!!.jsonPrimitive.boolean, used, "$n draw used")
            if (got != null) picked++ else if (used) declined++
        }
        assertTrue(picked > 50 && declined > 10, "picked $picked, declined $declined")
    }

    @Test
    fun seededSessionsMatchTypeScript() {
        for (s in fixture["sessions"]!!.jsonArray.map { it.jsonObject }) {
            val rnd = Drill.seededRandom(s["seed"]!!.jsonPrimitive.long)
            val bumpedN = s["bumped_n"]!!.jsonPrimitive.int
            val perNote = s["cards_per_note"]!!.jsonPrimitive.int
            val cards = ArrayList<C>()
            for (i in 0 until bumpedN) cards += C("b$i", "nb${i / perNote}", if (i % 4 == 3) CardQueue.REVIEW else CardQueue.NEW)
            for (i in 0 until s["review_n"]!!.jsonPrimitive.int) cards += C("r$i", "nr$i", CardQueue.REVIEW)
            for (i in 0 until s["new_n"]!!.jsonPrimitive.int) cards += C("w$i", "nw$i", CardQueue.NEW)
            val ids = cards.filter { it.id.startsWith("b") }.mapTo(HashSet()) { it.id }
            var queue: List<C> = cards
            val recent = ArrayList<String>()
            val order = ArrayList<String>()
            while (queue.isNotEmpty()) {
                val choose = queue.filter { it.noteId !in recent }.ifEmpty { queue }
                val got = Bumps.mixBumpedCard(choose, ids, recent, rnd, { it.id }, { it.noteId }, { it.queue })
                    ?: choose.firstOrNull { it.id !in ids && (it.queue == CardQueue.NEW || it.queue == CardQueue.REVIEW) }
                    ?: choose[0]
                order += got.id
                ids.remove(got.id)
                queue = queue.filter { it.id != got.id }
                recent += got.noteId
                if (recent.size > 5) recent.removeAt(0)
            }
            assertEquals(strings(s["order"]), order, "session ${s["seed"]}")
        }
    }
}
