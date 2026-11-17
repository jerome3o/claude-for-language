package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/** AnswerOrder.kt reproduces shared/study/answerOrder.ts exactly (parity/fixtures/answer-order.ts). */
class AnswerOrderParityTest {
    private val fixture: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "answer-order.json").readText()).jsonObject
    }

    private fun strings(e: JsonElement?): List<String>? = (e as? JsonArray)?.map { it.jsonPrimitive.content }

    @Test
    fun answerOrderMatchesTypeScript() {
        val cases = fixture["cases"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.size >= 100)
        var moved = 0
        for ((i, c) in cases.withIndex()) {
            val keys = strings(c["keys"])!!
            val shown = AnswerOrder.questionKeys(strings(c["listen"]), strings(c["round"]))
            assertEquals(strings(c["shown"]), shown, "shown #$i")
            val order = AnswerOrder.order(keys, shown)
            assertEquals(strings(c["order"]), order, "order #$i")
            if (order != keys) moved++
        }
        assertTrue(moved > 30, "the vectors reorder something")
    }

    @Test
    fun handPickedCases() {
        val keys = listOf("clue:n1", "s1", "s2", "s3")
        assertEquals(keys, AnswerOrder.order(keys, emptyList()))
        assertEquals(listOf("s3", "clue:n1", "s1", "s2"), AnswerOrder.order(keys, listOf("s3", "clue:n1")))
        assertEquals(listOf("s2", "clue:n1", "s1", "s3"), AnswerOrder.order(keys, listOf("gone", "s2", "s2")))
    }
}
