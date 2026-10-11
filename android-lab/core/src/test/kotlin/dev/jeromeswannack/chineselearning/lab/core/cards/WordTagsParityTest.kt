package dev.jeromeswannack.chineselearning.lab.core.cards

import dev.jeromeswannack.chineselearning.lab.core.WordFrequency
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
import kotlin.test.fail

/**
 * Word tags reproduce shared/cards/word-tags.ts exactly (parity/fixtures/word-tags.ts) over the
 * SHIPPED lexicon the app reads from its core resources: the parse (size, markers, entries), the
 * lookup key, the tags with / without a frequency rank and with an exclude, every explanation,
 * the marker scan and the labels.
 */
class WordTagsParityTest {
    private val data: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "word-tags.json").readText()).jsonObject
    }
    private val lexicon: WordTagLexicon by lazy { assertNotNull(WordTags.shipped, "word-tags.txt is a core resource") }

    private val JsonElement.str: String? get() = if (this is JsonNull) null else jsonPrimitive.content
    private fun strs(e: JsonElement?) = e?.jsonArray?.map { it.jsonPrimitive.content } ?: emptyList()

    private fun tags(e: JsonElement?): List<WordTag> = e!!.jsonArray.map { it.jsonObject }.map {
        WordTag(it["kind"]!!.str!!, it["id"]!!.str!!, it["label"]!!.str!!, it["tone"]!!.str!!)
    }

    @Test
    fun parsesTheShippedLexiconTheSameWay() {
        assertEquals(data["word_count"]!!.jsonPrimitive.int, lexicon.words.size)
        val markers = data["markers"]!!.jsonArray.map { it.jsonObject }.map {
            WordTagMarker(it["text"]!!.str!!, it["register"]!!.str!!, it["clauseStart"]!!.jsonPrimitive.boolean)
        }
        assertEquals(markers, lexicon.markers)
        for (e in data["entries"]!!.jsonArray.map { it.jsonObject }) {
            val hanzi = e["hanzi"]!!.str!!
            val want = e["entry"]
            if (want == null || want is JsonNull) {
                assertEquals(null, lexicon.words[hanzi], hanzi)
                continue
            }
            val o = want.jsonObject
            val expected = WordTagEntry(
                pos = strs(o["pos"]),
                register = strs(o["register"]),
                measures = o["measures"]!!.jsonArray.map { it.jsonObject }.map { WordTagMeasure(it["char"]!!.str!!, it["pinyin"]!!.str!!) },
                hsk = o["hsk"]?.str?.toInt(),
                trad = o["trad"]?.str,
                separable = o["separable"]?.str,
            )
            assertEquals(expected, lexicon.words[hanzi], hanzi)
        }
    }

    @Test
    fun everyCaseMatches() {
        for (c in data["cases"]!!.jsonArray.map { it.jsonObject }) {
            val hanzi = c["hanzi"]!!.str!!
            val rank = c["rank"]?.str?.toInt()
            assertEquals(c["key"]!!.str, WordTags.key(hanzi), "key($hanzi)")
            assertEquals(tags(c["tags"]), WordTags.tags(hanzi, lexicon), "tags($hanzi)")
            assertEquals(tags(c["with_rank"]), WordTags.tags(hanzi, lexicon, rankLoaded = true, rank = rank), "tags($hanzi, rank $rank)")
            assertEquals(tags(c["rare"]), WordTags.tags(hanzi, lexicon, rankLoaded = true, rank = null), "tags($hanzi, unranked)")
            assertEquals(
                tags(c["excluded"]),
                WordTags.tags(hanzi, lexicon, rankLoaded = true, rank = rank, exclude = setOf("frequency", "trad", "pos")),
                "tags($hanzi, exclude)",
            )
            val withRank = WordTags.tags(hanzi, lexicon, rankLoaded = true, rank = rank)
            val explained = c["explanations"]!!.jsonArray.map { it.jsonObject }.map {
                WordTagExplanation(it["title"]!!.str!!, it["body"]!!.str!!, it["example"]!!.str!!, it["source"]!!.str!!)
            }
            assertEquals(explained, withRank.map { WordTags.explanation(it, hanzi, lexicon) }, "explanation($hanzi)")
        }
    }

    @Test
    fun ranksMarkersAndLabels() {
        for (r in data["ranks"]!!.jsonArray.map { it.jsonObject }) {
            val hanzi = r["hanzi"]!!.str!!
            val rank = r["rank"]!!.jsonPrimitive.int
            assertEquals(tags(r["tags"]), WordTags.tags(hanzi, lexicon, rankLoaded = true, rank = rank), "tags($hanzi, $rank)")
        }
        for (m in data["marker_scans"]!!.jsonArray.map { it.jsonObject }) {
            val text = m["text"]!!.str!!
            assertEquals(strs(m["codes"]), WordTags.markerRegister(text, lexicon.markers), "markerRegister($text)")
        }
        for (h in data["hsk_labels"]!!.jsonArray.map { it.jsonArray }) {
            assertEquals(h[1].jsonPrimitive.content, WordTags.hskLabel(h[0].jsonPrimitive.int))
        }
        assertEquals(emptyList(), WordTags.tags("书", null))
    }

    @Test
    fun theShippedFrequencyListGivesTheSameRanks() {
        // The app passes WordFrequency.shipped's rank; the fixture used the same file.
        val freq = assertNotNull(WordFrequency.shipped)
        for (c in data["cases"]!!.jsonArray.map { it.jsonObject }) {
            val key = c["key"]!!.str!!
            if (key.isEmpty()) continue
            val rank = if (key.codePointCount(0, key.length) == 1) freq.chars[key] else freq.words[key]
            assertEquals(c["rank"]?.str?.toInt(), rank, "rank($key)")
        }
    }
}
