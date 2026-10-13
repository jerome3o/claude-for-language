package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/** NewCharacters.kt reproduces shared/study/newCharacters.ts exactly (parity/fixtures/new-characters.ts). */
class NewCharactersParityTest {
    private val fixture: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "new-characters.json").readText()).jsonObject
    }

    private fun strings(o: JsonObject, key: String) = o[key]!!.jsonArray.map { it.jsonPrimitive.content }

    @Test
    fun seenSetNewCharactersMaskAndLabelMatchTypeScript() {
        val cases = fixture["cases"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.size >= 100)
        var withNew = 0
        for (c in cases) {
            val reviewed = strings(c, "reviewed")
            val seen = NewCharacters.seenCharactersOf(reviewed)
            assertEquals(strings(c, "seen"), seen.sorted(), "seen of $reviewed")
            for (card in c["cards"]!!.jsonArray.map { it.jsonObject }) {
                val hanzi = card["hanzi"]!!.jsonPrimitive.content
                val fresh = NewCharacters.newCharactersIn(hanzi, seen)
                assertEquals(strings(card, "new"), fresh, "new in $hanzi")
                assertEquals(card["mask"]!!.jsonArray.map { it.jsonPrimitive.boolean }, NewCharacters.newCharacterMask(hanzi, seen), "mask $hanzi")
                assertEquals(card["label"]!!.jsonPrimitive.content, NewCharacters.label(fresh), "label $hanzi")
                if (fresh.isNotEmpty()) withNew++
                if (card["rated"]!!.jsonPrimitive.boolean) NewCharacters.markCharactersSeen(seen, hanzi)
            }
        }
        assertTrue(withNew > 50)
    }
}
