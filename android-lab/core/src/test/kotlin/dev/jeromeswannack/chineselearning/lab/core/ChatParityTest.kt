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

/** Package E: which chat text counts as Chinese reproduces shared/chats exactly (parity/fixtures/chat.ts). */
class ChatParityTest {
    private fun fixture(name: String): JsonObject {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        return Json.parseToJsonElement(File(dir, name).readText()).jsonObject
    }

    @Test
    fun looksLikeChineseMatchesTypeScript() {
        val cases = fixture("chat.json")["chinese"]!!.jsonArray
        assertTrue(cases.size >= 12)
        for (c in cases) {
            assertEquals(c.jsonObject["chinese"]!!.jsonPrimitive.boolean, MessageTools.looksLikeChinese(c.jsonObject["text"]!!.jsonPrimitive.content), c.toString())
        }
    }
}
