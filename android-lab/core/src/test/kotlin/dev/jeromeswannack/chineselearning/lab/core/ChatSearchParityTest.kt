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

/** ChatSearch reproduces shared/chats/search.ts exactly (parity/fixtures/chat-search.ts). */
class ChatSearchParityTest {
    private fun fixture(name: String): JsonObject {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        return Json.parseToJsonElement(File(dir, name).readText()).jsonObject
    }

    private fun JsonObject.str(key: String): String? = this[key]?.let { if (it is JsonNull) null else it.jsonPrimitive.content }

    private fun message(e: JsonElement): ChatSearch.Message {
        val o = e.jsonObject
        val att = o["attachment"]?.takeIf { it !is JsonNull }?.jsonObject
        val words = o["words"]?.takeIf { it !is JsonNull }?.jsonArray?.map { w -> ChatSearch.Word(w.jsonObject.str("text")!!, w.jsonObject.str("pinyin")) }
        return ChatSearch.Message(
            id = o.str("id")!!,
            content = o.str("content"),
            translation = o.str("translation"),
            deletedAt = o.str("deleted_at"),
            transcript = att?.str("transcript"),
            attachmentTranslation = att?.str("translation"),
            words = words,
        )
    }

    @Test
    fun searchMatchesTypeScript() {
        val f = fixture("chat-search.json")
        val messages = f["messages"]!!.jsonArray.map(::message)
        val cases = f["cases"]!!.jsonArray
        assertTrue(cases.size >= 30)
        for (c in cases) {
            val o = c.jsonObject
            val q = o.str("query")!!
            assertEquals(o["ids"]!!.jsonArray.map { it.jsonPrimitive.content }, ChatSearch.search(messages, q), "search(\"$q\")")
            val each = o["each"]!!.jsonArray.map { it.jsonPrimitive.boolean }
            assertEquals(each, messages.map { ChatSearch.matches(it, q) }, "matches(\"$q\")")
        }
    }
}
