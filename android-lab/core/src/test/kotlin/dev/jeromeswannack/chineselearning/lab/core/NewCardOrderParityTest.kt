package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * "Order new cards by" (NewCardOrder.kt) must match shared/decks/new-card-order.ts +
 * frequency.ts (parity/fixtures/new-card-order.ts): settings parsing, the settings rows'
 * words, the shipped frequency list's ranks, "met" words and the greedy picker. The queue
 * scenarios are in StudyQueueParityTest (`ordered`).
 */
class NewCardOrderParityTest {
    private val fixture: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "new-card-order.json").readText()).jsonObject
    }

    private fun orderOf(o: JsonObject) = NewCardOrder(
        o["new_characters_first"]!!.jsonPrimitive.boolean,
        o["new_words_first"]!!.jsonPrimitive.boolean,
        o["most_common_first"]!!.jsonPrimitive.boolean,
        o["sentences_last"]!!.jsonPrimitive.boolean,
    )

    @Test
    fun settingsParseLikeTypeScript() {
        val cases = fixture["settings"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.size >= 30)
        for (c in cases) {
            val raw = c["raw"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.content }
            assertEquals(orderOf(c["order"]!!.jsonObject), NewCardOrder.parse(raw), "parse($raw)")
        }
        // Round trip through the stored shape.
        val off = NewCardOrder.DEFAULT.copy(sentencesLast = false)
        assertEquals(off, NewCardOrder.parse(off.toJson()))
    }

    @Test
    fun settingsRowsMatchTheWeb() {
        val options = fixture["options"]!!.jsonArray.map { it.jsonObject }
        assertEquals(
            options.map { Triple(it["key"]!!.jsonPrimitive.content, it["label"]!!.jsonPrimitive.content, it["hint"]!!.jsonPrimitive.content) },
            NewCardOrder.OPTIONS.map { Triple(it.key, it.label, it.hint) },
        )
    }

    @Test
    fun shippedFrequencyListRanksLikeTypeScript() {
        val shipped = assertNotNull(WordFrequency.shipped, "shared/data/frequency/word-freq.txt on the classpath")
        val f = fixture["frequency"]!!.jsonObject
        assertEquals(f["words"]!!.jsonPrimitive.int, shipped.words.size)
        assertEquals(f["chars"]!!.jsonPrimitive.int, shipped.chars.size)
        for (r in f["ranks"]!!.jsonArray.map { it.jsonObject }) {
            val hanzi = r["hanzi"]!!.jsonPrimitive.content
            assertEquals(r["rank"]!!.jsonPrimitive.int, WordFrequency.rank(hanzi, shipped), "rank($hanzi)")
        }
    }

    @Test
    fun metWordsMatchTypeScript() {
        for (p in fixture["pieces"]!!.jsonArray.map { it.jsonObject }) {
            val hanzi = p["hanzi"]!!.jsonPrimitive.content
            assertEquals(p["pieces"]!!.jsonArray.map { it.jsonPrimitive.content }, NewCardOrdering.wordPieces(hanzi), "wordPieces($hanzi)")
        }
        for ((n, c) in fixture["studied"]!!.jsonArray.map { it.jsonObject }.withIndex()) {
            val index = NewCardOrdering.studiedFrom(c["studied"]!!.jsonArray.map { it.jsonPrimitive.content })
            for (probe in c["probes"]!!.jsonArray.map { it.jsonObject }) {
                val hanzi = probe["hanzi"]!!.jsonPrimitive.content
                assertEquals(probe["newWord"]!!.jsonPrimitive.boolean, NewCardOrdering.isNewWord(hanzi, index), "studied $n isNewWord($hanzi)")
            }
        }
    }

    private data class Item(val id: String, val hanzi: String, val group: String)

    @Test
    fun pickerMatchesTypeScript() {
        val shipped = WordFrequency.shipped!!
        val cases = fixture["picker"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.size >= 500) // 300 random + the new-character-tier cases (most common new character first)
        var nonEmpty = 0
        for ((n, c) in cases.withIndex()) {
            val items = c["items"]!!.jsonArray.map { it.jsonObject }.map {
                Item(it["id"]!!.jsonPrimitive.content, it["hanzi"]!!.jsonPrimitive.content, it["group"]!!.jsonPrimitive.content)
            }
            val room = c["room"]!!.jsonObject.mapValues { it.value.jsonPrimitive.int }
            val rank = c["rank"]!!.jsonObject.mapValues { it.value.jsonPrimitive.int }
            val studied = NewCardOrdering.studiedFrom(c["studied"]!!.jsonArray.map { it.jsonPrimitive.content }, c["withPieces"]!!.jsonPrimitive.boolean)
            val picked = NewCardOrdering.pickByOrder(
                items, c["take"]!!.jsonPrimitive.int, { it.hanzi }, { it.group }, { rank[it] ?: 0 }, room, { it.id },
                orderOf(c["order"]!!.jsonObject), studied, if (c["useFrequency"]!!.jsonPrimitive.boolean) shipped else null,
            )
            val expected = c["picked"]!!.jsonArray.map { it.jsonPrimitive.content }
            if (expected.isNotEmpty()) nonEmpty++
            assertEquals(expected, picked.map { it.id }, "picker $n")
        }
        assertTrue(nonEmpty > 150)
    }
}
