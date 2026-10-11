package dev.jeromeswannack.chineselearning.lab.core.cards

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
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * The AI word tags reproduce shared/cards/word-tags-ai.ts exactly (parity/fixtures/word-tags-ai.ts)
 * over the SHIPPED lexicon: parsing stored verdicts (junk included), the note clean-up, the merge
 * with the lexicon's tags (rank, exclude) and every explanation.
 */
class WordTagsAiParityTest {
    private val data: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "word-tags-ai.json").readText()).jsonObject
    }
    private val lexicon: WordTagLexicon by lazy { assertNotNull(WordTags.shipped, "word-tags.txt is a core resource") }

    private val JsonElement.str: String? get() = if (this is JsonNull) null else jsonPrimitive.content

    private fun tags(e: JsonElement?): List<WordTag> = e!!.jsonArray.map { it.jsonObject }.map {
        WordTag(it["kind"]!!.str!!, it["id"]!!.str!!, it["label"]!!.str!!, it["tone"]!!.str!!, it["ai"]?.jsonPrimitive?.boolean ?: false)
    }

    private fun verdict(e: JsonElement?): AiWordTags? {
        if (e == null || e is JsonNull) return null
        val o = e.jsonObject
        return AiWordTags(
            v = o["v"]!!.jsonPrimitive.int,
            transitivity = o["transitivity"]?.str,
            separable = o["separable"]?.jsonPrimitive?.boolean,
            register = o["register"]?.str,
            registerNote = o["register_note"]?.str,
            confidence = o["confidence"]!!.str!!,
        )
    }

    @Test
    fun parsesStoredVerdictsTheSameWay() {
        for (p in data["parsed"]!!.jsonArray.map { it.jsonObject }) {
            val raw = p["raw"]?.str
            assertEquals(verdict(p["ai"]), WordTagsAi.parse(raw), "parse($raw)")
        }
        for (n in data["notes"]!!.jsonArray.map { it.jsonObject }) {
            val input = n["input"]!!.str!!
            assertEquals(n["out"]!!.str, WordTagsAi.cleanRegisterNote(kotlinx.serialization.json.JsonPrimitive(input)), "note($input)")
        }
        assertEquals(emptyList(), tags(data["no_lexicon"]))
        assertEquals(emptyList(), WordTagsAi.tags("告诉", null, WordTagsAi.parse("""{"v":1,"transitivity":"transitive","confidence":"high"}""")))
    }

    @Test
    fun everyMergeAndExplanationMatches() {
        val cases = data["cases"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.size > 100, "fixture has cases")
        var aiPills = 0
        for (c in cases) {
            val hanzi = c["hanzi"]!!.str!!
            val raw = c["raw"]?.str
            val ai = assertNotNull(WordTagsAi.parse(raw), raw)
            val got = WordTagsAi.tags(hanzi, lexicon, ai)
            assertEquals(tags(c["tags"]), got, "tags($hanzi, $raw)")
            assertEquals(tags(c["with_rank"]), WordTagsAi.tags(hanzi, lexicon, ai, rankLoaded = true, rank = 500), "tags($hanzi, $raw, rank)")
            assertEquals(
                tags(c["excluded"]),
                WordTagsAi.tags(hanzi, lexicon, ai, rankLoaded = true, rank = null, exclude = setOf("frequency", "transitivity", "trad")),
                "tags($hanzi, $raw, exclude)",
            )
            val explained = c["explanations"]!!.jsonArray.map { it.jsonObject }.map {
                WordTagExplanation(
                    it["title"]!!.str!!, it["body"]!!.str!!, it["example"]!!.str!!, it["source"]!!.str!!,
                    ai = it["ai"]?.jsonPrimitive?.boolean ?: false, note = it["note"]?.str ?: "",
                )
            }
            assertEquals(explained, got.map { WordTagsAi.explanation(it, hanzi, lexicon, ai) }, "explanation($hanzi, $raw)")
            aiPills += got.count { it.ai }
        }
        assertTrue(aiPills > 20, "the fixture exercises AI pills")
    }
}
