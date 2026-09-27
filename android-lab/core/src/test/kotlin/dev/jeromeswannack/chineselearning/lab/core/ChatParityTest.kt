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

/** Package E: chat message tools + Ask-Claude threads reproduce shared/chats exactly (parity/fixtures/chat.ts). */
class ChatParityTest {
    private fun fixture(name: String): JsonObject {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        return Json.parseToJsonElement(File(dir, name).readText()).jsonObject
    }

    private val JsonElement.str: String? get() = if (this is JsonNull) null else jsonPrimitive.content

    private fun toolsJson(list: List<MessageTool>) = list.map { listOf(it.id, it.label, it.icon, it.needsInternet.toString()) }
    private fun toolsJson(arr: JsonElement) = arr.jsonArray.map { val o = it.jsonObject; listOf(o["id"]!!.str, o["label"]!!.str, o["icon"]!!.str, o["needsInternet"]!!.jsonPrimitive.boolean.toString()) }

    @Test
    fun messageToolsMatchTypeScript() {
        val cases = fixture("chat.json")["tools"]!!.jsonArray
        for ((i, c) in cases.withIndex()) {
            val o = c.jsonObject
            val m = o["message"]!!.jsonObject
            val actual = MessageTools.toolsForMessage(
                senderId = m["sender_id"]!!.str!!,
                content = m["content"]!!.str!!,
                checkStatus = m["check_status"]?.str,
                hasDiscussion = m["has_discussion"]!!.jsonPrimitive.boolean,
                viewerRole = o["role"]!!.str!!,
                isAiConversation = o["ai"]!!.jsonPrimitive.boolean,
                viewerId = "me",
            )
            val r = o["result"]!!.jsonObject
            assertEquals(toolsJson(r["inline"]!!), toolsJson(actual.inline), "tools[$i] inline")
            assertEquals(toolsJson(r["menu"]!!), toolsJson(actual.menu), "tools[$i] menu")
            assertEquals(r["isMine"]!!.jsonPrimitive.boolean, actual.isMine)
            assertEquals(r["hasChinese"]!!.jsonPrimitive.boolean, actual.hasChinese)
        }
        assertTrue(cases.size >= 768)
        for (c in fixture("chat.json")["chinese"]!!.jsonArray) {
            assertEquals(c.jsonObject["chinese"]!!.jsonPrimitive.boolean, MessageTools.looksLikeChinese(c.jsonObject["text"]!!.str!!), c.toString())
        }
    }

    private data class Row(override val id: String, override val note_id: String, override val asked_at: String) : QuestionRowLike

    @Test
    fun questionThreadsMatchTypeScript() {
        val f = fixture("chat.json")
        for ((i, c) in f["threads"]!!.jsonArray.withIndex()) {
            val rows = c.jsonObject["rows"]!!.jsonArray.map { val o = it.jsonObject; Row(o["id"]!!.str!!, o["note_id"]!!.str!!, o["asked_at"]!!.str!!) }
            val actual = QuestionThreads.group(rows).map { listOf(it.id, it.noteId, it.questions.joinToString(",") { q -> q.id }, it.startedAt, it.lastAt) }
            val expected = c.jsonObject["threads"]!!.jsonArray.map { val o = it.jsonObject; listOf(o["id"]!!.str, o["note_id"]!!.str, o["questions"]!!.jsonArray.joinToString(",") { q -> q.str!! }, o["started_at"]!!.str, o["last_at"]!!.str) }
            assertEquals(expected, actual, "threads[$i]")
        }
        for (c in f["sqlite"]!!.jsonArray) assertEquals(c.jsonObject["out"]!!.str, QuestionThreads.sqliteToIso(c.jsonObject["in"]!!.str!!))
    }
}
