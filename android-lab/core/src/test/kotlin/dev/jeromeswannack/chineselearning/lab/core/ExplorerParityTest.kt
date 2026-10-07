package dev.jeromeswannack.chineselearning.lab.core

import dev.jeromeswannack.chineselearning.lab.core.explorer.CharWordList
import dev.jeromeswannack.chineselearning.lab.core.explorer.Crumb
import dev.jeromeswannack.chineselearning.lab.core.explorer.DecalKind
import dev.jeromeswannack.chineselearning.lab.core.explorer.DictWord
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorableSegment
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorableSegments
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerAction
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerItem
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerStack
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerWord
import dev.jeromeswannack.chineselearning.lab.core.explorer.FrequencyDecals
import dev.jeromeswannack.chineselearning.lab.core.explorer.RelatedWords
import dev.jeromeswannack.chineselearning.lab.core.explorer.WORD_BATCH_MAX
import dev.jeromeswannack.chineselearning.lab.core.explorer.WORD_DICT_VERSION
import dev.jeromeswannack.chineselearning.lab.core.explorer.WordNoteLike
import dev.jeromeswannack.chineselearning.lab.core.explorer.WordRecord
import dev.jeromeswannack.chineselearning.lab.core.explorer.WordSegmentInput
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
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
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * The language explorer's rules must match the web exactly (parity/fixtures/explorer.ts →
 * explorer.json, from shared/explorer): stack reducer, breadcrumbs, itemForText, wordChars,
 * wordFrequencyLabel, resolveWord, relatedWords and the explorable segments.
 */
class ExplorerParityTest {
    private val fixture: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "explorer.json").readText()).jsonObject
    }

    private fun JsonElement?.str(): String? = if (this == null || this is JsonNull) null else jsonPrimitive.content
    private fun JsonElement?.intOrNull(): Int? = if (this == null || this is JsonNull) null else jsonPrimitive.int
    private fun JsonElement?.strings(): List<String>? = if (this == null || this is JsonNull) null else jsonArray.map { it.jsonPrimitive.content }

    private fun item(e: JsonElement): ExplorerItem {
        val o = e.jsonObject
        return if (o["kind"].str() == "char") ExplorerItem.Char(o["char"].str()!!)
        else ExplorerItem.Word(o["hanzi"].str()!!, o["pinyin"].str(), o["gloss"].str(), o["sentence"].str())
    }

    private fun itemOrNull(e: JsonElement?): ExplorerItem? = if (e == null || e is JsonNull) null else item(e)

    private fun action(e: JsonElement): ExplorerAction {
        val o = e.jsonObject
        return when (o["type"].str()) {
            "open" -> ExplorerAction.Open(item(o["item"]!!))
            "push" -> ExplorerAction.Push(item(o["item"]!!))
            "pop" -> ExplorerAction.Pop
            "popTo" -> ExplorerAction.PopTo(o["index"]!!.jsonPrimitive.int)
            "close" -> ExplorerAction.Close
            else -> fail("unknown action $o")
        }
    }

    @Test
    fun constantsMatchTypeScript() {
        val c = fixture["constants"]!!.jsonObject
        assertEquals(c["max_depth"]!!.jsonPrimitive.int, ExplorerStack.MAX_DEPTH)
        assertEquals(c["word_dict_version"]!!.jsonPrimitive.int, WORD_DICT_VERSION)
        assertEquals(c["word_batch_max"]!!.jsonPrimitive.int, WORD_BATCH_MAX)
    }

    @Test
    fun reducerMatchesTypeScript() {
        val seqs = fixture["sequences"]!!.jsonArray
        assertTrue(seqs.size > 100)
        for ((i, seq) in seqs.withIndex()) {
            val actions = seq.jsonObject["actions"]!!.jsonArray.map(::action)
            val stacks = seq.jsonObject["stacks"]!!.jsonArray.map { s -> s.jsonArray.map(::item) }
            var s = emptyList<ExplorerItem>()
            for ((j, a) in actions.withIndex()) {
                s = ExplorerStack.reduce(s, a)
                assertEquals(stacks[j], s, "sequence $i step $j ($a)")
            }
        }
    }

    @Test
    fun breadcrumbsMatchTypeScript() {
        for (c in fixture["crumbs"]!!.jsonArray.map { it.jsonObject }) {
            val stack = c["stack"]!!.jsonArray.map(::item)
            val expected = c["trail"]!!.jsonArray.map { e ->
                val o = e.jsonObject
                if (o["kind"].str() == "gap") Crumb.Gap
                else Crumb.Item(o["label"].str()!!, o["index"]!!.jsonPrimitive.int, o["current"]!!.jsonPrimitive.boolean)
            }
            assertEquals(expected, ExplorerStack.breadcrumbTrail(stack, c["max"]!!.jsonPrimitive.int), "trail of $stack")
        }
    }

    @Test
    fun itemForTextMatchesTypeScript() {
        for (c in fixture["for_text"]!!.jsonArray.map { it.jsonObject }) {
            val hint = c["hint"]!!.jsonObject
            val got = ExplorerStack.itemForText(c["text"].str()!!, hint["pinyin"].str(), hint["gloss"].str(), hint["sentence"].str())
            assertEquals(itemOrNull(c["item"]), got, "itemForText(${c["text"]}, $hint)")
        }
    }

    @Test
    fun wordCharsMatchTypeScript() {
        for (c in fixture["chars"]!!.jsonArray.map { it.jsonObject }) {
            val got = ExplorerWord.wordChars(c["hanzi"].str()!!, c["pinyin"].str(), c["syllables"].strings())
            val expected = c["out"]!!.jsonArray.map { it.jsonObject }
            assertEquals(expected.size, got.size, "wordChars(${c["hanzi"]}, ${c["pinyin"]})")
            for ((e, g) in expected.zip(got)) {
                assertEquals(e["char"].str(), g.char)
                assertEquals(e["syllable"].str(), g.syllable, "syllable of ${g.char} in ${c["hanzi"]} / ${c["pinyin"]}")
                assertEquals(e["tone"].intOrNull(), g.tone, "tone of ${g.char} in ${c["hanzi"]} / ${c["pinyin"]}")
            }
        }
    }

    @Test
    fun frequencyLabelMatchesTypeScript() {
        for (c in fixture["freq"]!!.jsonArray.map { it.jsonObject }) {
            val got = ExplorerWord.wordFrequencyLabel(c["rank"].intOrNull())
            val out = c["out"]!!.jsonObject
            assertEquals(out["text"].str(), got.text, "label of ${c["rank"]}")
            assertEquals(out["tier"].str(), got.tier.wire, "tier of ${c["rank"]}")
        }
    }

    @Test
    fun frequencyDecalMatchesTypeScript() {
        val cases = fixture["decals"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.size > 50)
        for (c in cases) {
            val rank = c["rank"].intOrNull()
            assertEquals(c["word"].str(), FrequencyDecals.tier(rank, DecalKind.WORD)?.wire, "word decal of $rank")
            assertEquals(c["char"].str(), FrequencyDecals.tier(rank, DecalKind.CHAR)?.wire, "char decal of $rank")
            assertEquals(c["default"].str(), FrequencyDecals.tier(rank)?.wire, "default decal of $rank")
        }
        val key = fixture["decal_key"]!!.jsonObject
        assertEquals(key["line"].str(), FrequencyDecals.keyLine())
        val entries = key["entries"]!!.jsonArray.map { it.jsonObject }
        assertEquals(entries.map { Triple(it["tier"].str(), it["colour"].str(), it["label"].str()) }, FrequencyDecals.KEY.map { Triple(it.tier.wire, it.colour, it.label) })
    }

    @Test
    fun resolveWordMatchesTypeScript() {
        for (c in fixture["resolved"]!!.jsonArray.map { it.jsonObject }) {
            val src = c["sources"]!!.jsonObject
            val record = src["record"]?.jsonObject?.let { r ->
                WordRecord(r["hanzi"].str()!!, r["pinyin"].str()!!, r["syllables"].strings()!!, r["english"].str()!!, r["senses"].strings()!!, r["rank"].intOrNull())
            }
            val charWords = src["charWords"]?.jsonArray?.map { w -> w.jsonObject.let { DictWord(it["hanzi"].str()!!, it["pinyin"].str()!!, it["english"].str()!!) } }
            val notes = src["notes"]?.jsonArray?.map { n -> n.jsonObject.let { WordNoteLike(it["hanzi"].str()!!, it["pinyin"].str(), it["english"].str()) } }
            val hint = src["hint"]?.jsonObject
            val got = ExplorerWord.resolveWord(
                c["hanzi"].str()!!, record, charWords, notes,
                hintPinyin = hint?.get("pinyin").str(), hintGloss = hint?.get("gloss").str(), rank = src["rank"].intOrNull(),
            )
            val out = c["out"]!!.jsonObject
            val label = "resolveWord($src)"
            assertEquals(out["hanzi"].str(), got.hanzi, label)
            assertEquals(out["pinyin"].str(), got.pinyin, label)
            assertEquals(out["english"].str(), got.english, label)
            assertEquals(out["senses"].strings(), got.senses, label)
            assertEquals(out["syllables"].strings(), got.syllables, label)
            assertEquals(out["rank"].intOrNull(), got.rank, label)
            assertEquals(out["source"].str(), got.source.wire, label)
        }
    }

    @Test
    fun relatedWordsMatchTypeScript() {
        val cases = fixture["related"]!!.jsonArray.map { it.jsonObject }
        var nonEmpty = 0
        for ((i, c) in cases.withIndex()) {
            val records = c["records"]!!.jsonArray.map { r ->
                CharWordList(r.jsonObject["char"].str()!!, r.jsonObject["words"]!!.jsonArray.map { w -> w.jsonObject.let { DictWord(it["hanzi"].str()!!, it["pinyin"].str()!!, it["english"].str()!!) } })
            }
            val ranks = c["ranks"]!!.jsonObject
            val got = RelatedWords.relatedWords(c["hanzi"].str()!!, records, { it.hanzi }, { h -> ranks[h].intOrNull() }, c["limit"]!!.jsonPrimitive.int)
            val expected = c["out"]!!.jsonArray.map { it.jsonObject }
            assertEquals(expected.size, got.size, "related count, case $i")
            for ((e, g) in expected.zip(got)) {
                assertEquals(e["hanzi"].str(), g.word.hanzi, "case $i")
                assertEquals(e["english"].str(), g.word.english, "first entry kept, case $i")
                assertEquals(e["shared"].strings(), g.shared, "shared of ${g.word.hanzi}, case $i")
                assertEquals(e["rank"]!!.jsonPrimitive.int, g.rank, "rank of ${g.word.hanzi}, case $i")
            }
            if (got.isNotEmpty()) nonEmpty++
        }
        assertTrue(nonEmpty > 40, "the vectors exercise real lists")
    }

    @Test
    fun segmentsMatchTypeScript() {
        fun parse(a: JsonElement): List<ExplorableSegment> = a.jsonArray.map { s -> ExplorableSegment(s.jsonObject["text"].str()!!, itemOrNull(s.jsonObject["item"])) }
        for (c in fixture["segments"]!!.jsonArray.map { it.jsonObject }) {
            val text = c["text"].str()!!
            val segs = (c["segments"] as? JsonArray)?.map { s ->
                s.jsonObject.let { WordSegmentInput(it["text"].str()!!, it["pinyin"].str(), it["gloss"].str()) }
            }
            assertEquals(parse(c["chars"]!!), ExplorableSegments.charSegments(text), "charSegments($text)")
            assertEquals(parse(c["words"]!!), ExplorableSegments.explorableSegments(text, segs) { s, e -> "$s:$e:$text" }, "explorableSegments($text)")
            assertEquals(parse(c["words_no_sentence"]!!), ExplorableSegments.explorableSegments(text, segs), "explorableSegments($text) without sentences")
        }
    }
}
