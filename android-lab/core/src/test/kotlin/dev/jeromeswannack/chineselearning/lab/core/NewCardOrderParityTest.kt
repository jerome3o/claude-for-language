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
import dev.jeromeswannack.chineselearning.lab.core.cards.WordTags
import dev.jeromeswannack.chineselearning.lab.core.cards.WordTagsAi

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
        o["known_characters_english_first"]?.jsonPrimitive?.boolean ?: true,
        o["everyday_first"]?.jsonPrimitive?.boolean ?: true,
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
        val englishOff = NewCardOrder.DEFAULT.copy(knownCharactersEnglishFirst = false)
        assertEquals(englishOff, NewCardOrder.parse(englishOff.toJson()))
        val everydayOff = NewCardOrder.DEFAULT.copy(everydayFirst = false)
        assertEquals(everydayOff, NewCardOrder.parse(everydayOff.toJson()))
        assertTrue(cases.any { c -> c["raw"]!!.toString().contains("everyday_first") })
    }

    @Test
    fun settingsRowsMatchTheWeb() {
        val options = fixture["options"]!!.jsonArray.map { it.jsonObject }
        assertEquals(
            options.map { Triple(it["key"]!!.jsonPrimitive.content, it["label"]!!.jsonPrimitive.content, it["hint"]!!.jsonPrimitive.content) },
            NewCardOrder.OPTIONS.map { Triple(it.key, it.label, it.hint) },
        )
        val known = fixture["knownCharactersOption"]!!.jsonObject
        assertEquals(
            Triple(known["key"]!!.jsonPrimitive.content, known["label"]!!.jsonPrimitive.content, known["hint"]!!.jsonPrimitive.content),
            NewCardOrder.KNOWN_CHARACTERS_OPTION.let { Triple(it.key, it.label, it.hint) },
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

    private data class Item(val id: String, val hanzi: String, val group: String, val formality: Int = Formality.NEUTRAL)

    @Test
    fun pickerMatchesTypeScript() {
        val shipped = WordFrequency.shipped!!
        val cases = fixture["picker"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.size >= 500) // 300 random + the new-character-tier cases (most common new character first)
        var nonEmpty = 0
        for ((n, c) in cases.withIndex()) {
            val items = c["items"]!!.jsonArray.map { it.jsonObject }.map {
                Item(
                    it["id"]!!.jsonPrimitive.content, it["hanzi"]!!.jsonPrimitive.content, it["group"]!!.jsonPrimitive.content,
                    it["formality"]?.jsonPrimitive?.int ?: Formality.NEUTRAL,
                )
            }
            val useFormality = c["useFormality"]?.jsonPrimitive?.boolean == true
            val room = c["room"]!!.jsonObject.mapValues { it.value.jsonPrimitive.int }
            val rank = c["rank"]!!.jsonObject.mapValues { it.value.jsonPrimitive.int }
            val studied = NewCardOrdering.studiedFrom(c["studied"]!!.jsonArray.map { it.jsonPrimitive.content }, c["withPieces"]!!.jsonPrimitive.boolean)
            val picked = NewCardOrdering.pickByOrder(
                items, c["take"]!!.jsonPrimitive.int, { it.hanzi }, { it.group }, { rank[it] ?: 0 }, room, { it.id },
                orderOf(c["order"]!!.jsonObject), studied, if (c["useFrequency"]!!.jsonPrimitive.boolean) shipped else null,
                if (useFormality) { item: Item -> item.formality } else null,
            )
            val expected = c["picked"]!!.jsonArray.map { it.jsonPrimitive.content }
            if (expected.isNotEmpty()) nonEmpty++
            assertEquals(expected, picked.map { it.id }, "picker $n")
        }
        assertTrue(nonEmpty > 150)
    }

    /** "Everyday words before formal ones" (shared/decks/formality.ts) over the SHIPPED word-tag lexicon. */
    @Test
    fun formalityMatchesTypeScript() {
        val lexicon = assertNotNull(WordTags.shipped, "shared/data/word-tags/word-tags.txt on the classpath")
        val cases = fixture["formality"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.size >= 800)
        val seen = HashSet<Int>()
        val notes = ArrayList<Formality.Note>()
        for ((n, c) in cases.withIndex()) {
            val hanzi = c["hanzi"]!!.jsonPrimitive.content
            val ai = c["ai"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.content }
            val expected = c["formality"]!!.jsonPrimitive.int
            seen += expected
            assertEquals(expected, Formality.noteFormality(hanzi, lexicon, WordTagsAi.parse(ai)), "formality $n ($hanzi, $ai)")
            notes += Formality.Note("f$n", hanzi, ai)
        }
        assertEquals(setOf(Formality.EVERYDAY, Formality.NEUTRAL, Formality.FORMAL), seen)
        val map = fixture["formalityMap"]!!.jsonObject.mapValues { it.value.jsonPrimitive.int }
        assertEquals(map, Formality.noteFormalityMap(notes, lexicon))
        assertEquals(fixture["formalityNoLexicon"]!!.jsonPrimitive.int, Formality.noteFormalityMap(notes, null).size)
    }
}
