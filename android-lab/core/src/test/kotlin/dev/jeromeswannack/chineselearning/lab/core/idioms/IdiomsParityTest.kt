package dev.jeromeswannack.chineselearning.lab.core.idioms

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
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
import kotlin.test.fail

/**
 * 成语 Idioms reproduce shared/idioms exactly (parity/fixtures/idioms.ts): the starter list, the
 * cache key and its problems, the four-character shape, the explorer link rule, the "Try it"
 * score line, the labels and the "+ Add as card" fields — and the entry JSON decodes into the
 * Kotlin data classes.
 */
class IdiomsParityTest {
    private val json = Json { ignoreUnknownKeys = true }
    private val data: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "idioms.json").readText()).jsonObject
    }

    private val JsonElement.str: String? get() = if (this is JsonNull) null else jsonPrimitive.content
    private fun strs(e: JsonElement?) = e?.jsonArray?.map { it.jsonPrimitive.content } ?: emptyList()

    @Test
    fun rolesAndStarterListMatch() {
        val roles = data["roles"]!!.jsonArray.map { it.jsonArray.let { p -> p[0].jsonPrimitive.content to p[1].jsonPrimitive.content } }
        assertEquals(roles, Idioms.ROLES.toList())
        val starter = data["starter"]!!.jsonArray.map { it.jsonObject }.map {
            StarterIdiom(it["hanzi"]!!.str!!, it["pinyin"]!!.str!!, it["english"]!!.str!!, it["kind"]!!.str!!)
        }
        assertEquals(starter, Idioms.STARTER)
    }

    @Test
    fun keysProblemsAndShape() {
        for (k in data["keys"]!!.jsonArray.map { it.jsonObject }) {
            val text = k["text"]!!.str!!
            assertEquals(k["normalized"]!!.str, Idioms.normalize(text), "normalize($text)")
            assertEquals(k["problem"]!!.str, Idioms.keyProblem(text), "keyProblem($text)")
            assertEquals(k["shaped"]!!.jsonPrimitive.boolean, Idioms.isShaped(text), "isShaped($text)")
        }
    }

    @Test
    fun explorerLinkRule() {
        for (l in data["links"]!!.jsonArray.map { it.jsonObject }) {
            val hanzi = l["hanzi"]!!.str!!
            val known = l["known"]?.jsonPrimitive?.boolean ?: false
            assertEquals(l["show"]!!.jsonPrimitive.boolean, Idioms.showLink(hanzi, known, strs(l["senses"])), "showLink($l)")
        }
    }

    @Test
    fun scoreLinesAndLabels() {
        for (s in data["scores"]!!.jsonArray.map { it.jsonObject }) {
            assertEquals(s["line"]!!.str, Idioms.quizScoreLine(s["correct"]!!.jsonPrimitive.int, s["total"]!!.jsonPrimitive.int))
        }
        val labels = data["labels"]!!.jsonObject
        for (p in labels["sentiment"]!!.jsonArray) assertEquals(p.jsonArray[1].str, Idioms.sentimentLabel(p.jsonArray[0].str!!))
        for (p in labels["register"]!!.jsonArray) assertEquals(p.jsonArray[1].str, Idioms.registerLabel(p.jsonArray[0].str!!))
        for (r in labels["roles"]!!.jsonArray.map { it.jsonObject }) assertEquals(r["label"]!!.str, Idioms.rolesLabel(strs(r["roles"])))
    }

    @Test
    fun entriesDecodeAndMakeTheSameCard() {
        val entries = data["entries"]!!.jsonArray.map { it.jsonObject }
        assertEquals(5, entries.size)
        for (e in entries) {
            val entry = json.decodeFromJsonElement(IdiomEntry.serializer(), e["entry"]!!)
            assertEquals(e["origin_line"]!!.str, Idioms.originLine(entry))
            val card = e["card"]!!.jsonObject
            val mine = Idioms.cardFields(entry)
            assertEquals(card["hanzi"]!!.str, mine.hanzi)
            assertEquals(card["pinyin"]!!.str, mine.pinyin)
            assertEquals(card["english"]!!.str, mine.english)
            assertEquals(card["fun_facts"]!!.str, mine.funFacts)
            assertEquals(card["sentence_clue"]?.str, mine.sentenceClue)
            assertEquals(card["sentence_clue_pinyin"]?.str, mine.sentenceCluePinyin)
            assertEquals(card["sentence_clue_translation"]?.str, mine.sentenceClueTranslation)
        }
        val sample = json.decodeFromJsonElement(IdiomEntry.serializer(), entries[0]["entry"]!!)
        assertEquals("画蛇添足", sample.hanzi)
        assertEquals("《战国策·齐策二》", sample.origin.source)
        assertEquals(5, sample.origin.story.size)
    }
}
