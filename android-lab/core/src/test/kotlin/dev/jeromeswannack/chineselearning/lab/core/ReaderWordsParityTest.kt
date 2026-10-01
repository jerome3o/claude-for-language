package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
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

/** Reader word chips reproduce shared/reader/words.ts exactly (parity/fixtures/reader-words.ts). */
class ReaderWordsParityTest {
    private val fixture: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "reader-words.json").readText()).jsonObject
    }

    @Test
    fun segmentsMatchTypeScript() {
        val cases = fixture["cases"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.size >= 10)
        for ((n, c) in cases.withIndex()) {
            val text = c["text"]!!.jsonPrimitive.content
            val words = c["words"]!!.jsonArray.map { it.jsonPrimitive.content }
            assertTrue(ReaderWords.matches(words, text), "case $n concat")
            assertEquals(c["tappable"]!!.jsonArray.map { it.jsonPrimitive.boolean }, words.map(ReaderWords::isTappable), "case $n tappable")
            val offsets = ReaderWords.offsets(words)
            assertEquals(c["offsets"]!!.jsonArray.map { it.jsonPrimitive.int }, offsets, "case $n offsets")
            assertEquals(
                c["sentences"]!!.jsonArray.map { it.jsonPrimitive.content },
                words.mapIndexed { i, w -> ReaderWords.sentenceAround(text, offsets[i], offsets[i] + w.length) },
                "case $n sentences",
            )
            assertEquals(
                c["sentencesAt"]!!.jsonArray.map { it.jsonPrimitive.content },
                text.indices.map { ReaderWords.sentenceAround(text, it) },
                "case $n sentencesAt",
            )
        }
    }

    @Test
    fun matchesMatchesTypeScript() {
        for (m in fixture["matches"]!!.jsonArray.map { it.jsonObject }) {
            val words = m["words"]!!.jsonArray.map { it.jsonPrimitive.content }
            val text = m["text"]!!.jsonPrimitive.content
            assertEquals(m["result"]!!.jsonPrimitive.boolean, ReaderWords.matches(words, text), "$words / $text")
        }
    }
}
