package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
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

/** Sentence Coach buttons / actions / sentence card reproduce shared/coach exactly (parity/fixtures/coach.ts). */
class CoachParityTest {
    private fun fixture(): JsonObject {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        return Json.parseToJsonElement(File(dir, "coach.json").readText()).jsonObject
    }

    private val JsonElement.str: String? get() = if (this is JsonNull) null else jsonPrimitive.content

    @Test
    fun buttonsMatchTypeScript() {
        val cases = fixture()["buttons"]!!.jsonArray
        assertTrue(cases.size >= 20)
        for (c in cases) {
            val o = c.jsonObject
            val text = o["text"]!!.str!!
            val r = o["result"]!!.jsonObject
            val b = CoachActions.buttons(text)
            assertEquals(r["kind"]!!.str, b.kind, "kind of '$text'")
            assertEquals(r["actions"]!!.jsonArray.map { it.str }, b.actions.map { it.id }, "actions of '$text'")
            assertEquals(r["enabled"]!!.jsonPrimitive.boolean, b.enabled, "enabled of '$text'")
            assertEquals(r["hint"]?.str, b.hint, "hint of '$text'")
        }
    }

    @Test
    fun conversationActionMatchesTypeScript() {
        for (c in fixture()["actions"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o["result"]!!.str, CoachActions.conversationAction(o["action"]?.str, o["input_language"]?.str).id, o.toString())
        }
    }

    @Test
    fun sentenceCardMatchesTypeScript() {
        for (c in fixture()["cards"]!!.jsonArray) {
            val i = c.jsonObject["in"]!!.jsonObject
            val out = c.jsonObject["out"]!!.jsonObject
            val words = i["words"]!!.jsonArray.map { w ->
                val wo = w.jsonObject
                CoachBreakdownWord(wo["hanzi"]!!.str!!, wo["pinyin"]!!.str!!, wo["gloss"]!!.str!!)
            }
            val card = CoachActions.sentenceCard(i["hanzi"]!!.str!!, i["pinyin"]!!.str!!, i["translation"]?.str, words, i["construction"]?.str)
            assertEquals(out["hanzi"]!!.str, card.hanzi)
            assertEquals(out["pinyin"]!!.str, card.pinyin)
            assertEquals(out["english"]!!.str, card.english)
            assertEquals(out["fun_facts"]?.str, card.funFacts, i.toString())
        }
    }
}
