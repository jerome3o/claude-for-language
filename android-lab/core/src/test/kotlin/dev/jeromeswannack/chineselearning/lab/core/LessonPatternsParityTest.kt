package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/** Structure cards (shared/lesson/pattern.ts): the note view, the parser, the aligner, colours, classes, text blocks. */
class LessonPatternsParityTest {
    private fun fixture(): JsonObject {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        return Json.parseToJsonElement(File(dir, "lesson-patterns.json").readText()).jsonObject
    }

    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }
    private val JsonElement.str: String? get() = if (this is JsonNull) null else jsonPrimitive.content

    @Serializable private data class B(val kind: String, val text: String)
    @Serializable private data class Ex(val hanzi: String, val pinyin: String? = null, val english: String? = null, val parts: List<PatternExamplePart>)
    @Serializable private data class C(val pattern: LessonPattern, val examples: List<Ex>, val blocks: List<B>)
    @Serializable private data class V(val source: String, val intro: List<B>, val cards: List<C>, val extras: List<LessonSentence>)
    @Serializable private data class A(val parts: List<PatternExamplePart>, val matched: Boolean, val score: Int)
    @Serializable private data class P(val marker: String, val pieces: List<PatternPiece>)

    private fun pieces(e: JsonElement) = json.decodeFromJsonElement(ListSerializer(PatternPiece.serializer()), e)

    private fun blocks(list: List<LessonPatterns.Block>) = list.map { B(it.kind, it.text) }

    @Test
    fun noteViewsMatchTypeScript() {
        val cases = fixture()["views"]!!.jsonArray
        assertTrue(cases.size > 150)
        var parsed = 0
        for (c in cases) {
            val o = c.jsonObject
            val note = LessonJson.decodeFromJsonElement(LessonExercise.serializer(), o["note"]!!) as NoteExercise
            val expected = o["view"]!!.takeIf { it !is JsonNull }?.let { json.decodeFromJsonElement(V.serializer(), it) }
            val got = LessonPatterns.noteView(note.body, note.sentences, note.patterns)?.let { v ->
                V(v.source, blocks(v.intro), v.cards.map { card -> C(card.pattern, card.examples.map { Ex(it.hanzi, it.pinyin, it.english, it.parts) }, blocks(card.blocks)) }, v.extras)
            }
            assertEquals(expected, got, "note ${note.title} / ${note.body?.take(40)}")
            if (got?.source == "parsed") parsed++
        }
        assertTrue(parsed > 100)
    }

    @Test
    fun parserMatchesTypeScript() {
        for (c in fixture()["parse"]!!.jsonArray) {
            val o = c.jsonObject
            val line = o["line"]!!.str!!
            val english = o["english"]?.str
            val expected = o["out"]!!.takeIf { it !is JsonNull }?.let { json.decodeFromJsonElement(P.serializer(), it) }
            val got = LessonPatterns.parsePatternLine(line, english)?.let { P(it.marker, it.pieces) }
            assertEquals(expected, got, "parsePatternLine($line, $english)")
        }
    }

    @Test
    fun alignerMatchesTypeScript() {
        val cases = fixture()["align"]!!.jsonArray
        assertTrue(cases.size > 50)
        for (c in cases) {
            val o = c.jsonObject
            val hanzi = o["hanzi"]!!.str!!
            val expected = json.decodeFromJsonElement(A.serializer(), o["out"]!!)
            val got = LessonPatterns.alignExample(pieces(o["pieces"]!!), hanzi).let { A(it.parts, it.matched, it.score) }
            assertEquals(expected, got, "align $hanzi")
        }
    }

    @Test
    fun helpersMatchTypeScript() {
        val f = fixture()
        for (c in f["helpers"]!!.jsonArray) {
            val o = c.jsonObject
            val ps = pieces(o["pieces"]!!)
            assertEquals(o["tones"]!!.jsonArray.map { it.str }, LessonPatterns.pieceTones(ps))
            assertEquals(o["classes"]!!.jsonArray.map { it.str }, ps.map(LessonPatterns::slotClass))
            assertEquals(o["line"]!!.str, LessonPatterns.patternLine(ps))
            assertEquals(o["name"]!!.str, LessonPatterns.patternName(LessonPattern(pieces = ps)))
            assertEquals(o["edit"]!!.str, LessonPatterns.editText(ps))
            val reparsed = LessonPatterns.parsePatternLine(LessonPatterns.editText(ps))?.pieces
            assertEquals(o["reparsed"]!!.takeIf { it !is JsonNull }?.let(::pieces), reparsed)
            assertEquals(pieces(o["merged"]!!), LessonPatterns.mergeDetails(reparsed ?: emptyList(), ps))
        }
        for (c in f["classes"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o["out"]!!.str, LessonPatterns.slotClass(PatternPiece(slot = o["slot"]!!.str, zh = o["zh"]!!.str)))
        }
        for (c in f["blocks"]!!.jsonArray) {
            val o = c.jsonObject
            val expected = json.decodeFromJsonElement(ListSerializer(B.serializer()), o["out"]!!)
            assertEquals(expected, blocks(LessonPatterns.textBlocks(o["text"]!!.str)))
        }
    }
}
