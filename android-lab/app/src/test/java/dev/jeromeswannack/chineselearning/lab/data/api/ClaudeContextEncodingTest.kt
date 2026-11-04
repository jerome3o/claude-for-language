package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.data.Api
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test

/** A new Chats-tab chat once sent `context: {}` (the API's Json drops defaults) and the server refused it. */
class ClaudeContextEncodingTest {
    private val json = Api(baseUrl = "http://test") { null }.json

    @Test
    fun generalContextKeepsItsKind() {
        val body = ClaudeCreateBody(client_id = "t1", message_client_id = "m1", context = ClaudeContextDto(), intent = "ask", text = "你好")
        val ctx = json.encodeToJsonElement(ClaudeCreateBody.serializer(), body).jsonObject["context"]!!.jsonObject
        assertEquals("general", ctx["kind"]!!.jsonPrimitive.content)
    }

    @Test
    fun cardContextKeepsItsKind() {
        val ctx = json.encodeToJsonElement(ClaudeContextDto.serializer(), ClaudeContextDto(kind = "card", note_id = "n1")).jsonObject
        assertEquals("card", ctx["kind"]!!.jsonPrimitive.content)
        assertEquals("n1", ctx["note_id"]!!.jsonPrimitive.content)
    }
}
