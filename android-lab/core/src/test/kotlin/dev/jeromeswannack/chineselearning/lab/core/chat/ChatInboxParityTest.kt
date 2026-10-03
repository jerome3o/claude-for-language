package dev.jeromeswannack.chineselearning.lab.core.chat

import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail

/** ChatInbox reproduces shared/chats/inbox.ts exactly (parity/fixtures/chat-inbox.ts). */
class ChatInboxParityTest {
    private val json = Json { ignoreUnknownKeys = true }
    private val f: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "chat-inbox.json").readText()).jsonObject
    }
    private val rows: List<ChatListRow> by lazy { json.decodeFromJsonElement(ListSerializer(ChatListRow.serializer()), f["rows"]!!) }
    private fun JsonObject.str(key: String): String? = this[key]?.let { if (it is JsonNull) null else it.jsonPrimitive.content }
    private fun ids(key: String, o: JsonObject = f) = o[key]!!.jsonArray.map { it.jsonPrimitive.content }

    @Test fun previews() {
        val cases = f["previews"]!!.jsonArray
        assertTrue(cases.size >= 10)
        for (c in cases) {
            val input = c.jsonObject["input"]!!.jsonObject
            val deleted = input["deleted"]?.jsonPrimitive?.boolean ?: false
            val got = ChatInbox.messagePreview(input.str("content")!!, input.str("attachment_kind"), deleted, input.str("attachment_name"))
            assertEquals(c.jsonObject.str("result"), got, input.toString())
        }
    }

    @Test fun namesAndInitials() {
        for (c in f["people"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o.str("display"), ChatInbox.personName(o.str("name")), "name ${o["name"]}")
            assertEquals(o.str("initial"), ChatInbox.initial(o.str("name")), "initial ${o["name"]}")
        }
    }

    @Test fun sortGroupTitlesPreviewsBadge() {
        assertEquals(8, rows.size)
        assertEquals(ids("sorted"), ChatInbox.sort(rows).map { it.conversationId })
        val g = ChatInbox.group(rows)
        val eg = f["group"]!!.jsonObject
        assertEquals(ids("people", eg), g.people.map { it.conversationId })
        assertEquals(ids("practice", eg), g.practice.map { it.conversationId })
        f["titles"]!!.jsonArray.forEachIndexed { i, t ->
            val o = t.jsonObject
            assertEquals(ChatInbox.RowTitle(o.str("name")!!, o.str("subtitle")), ChatInbox.rowTitle(rows[i], rows), "title $i")
        }
        f["rowPreviews"]!!.jsonArray.forEachIndexed { i, p -> assertEquals(p.jsonPrimitive.content, ChatInbox.rowPreview(rows[i], "me"), "preview $i") }
        assertEquals(f["unreadCount"]!!.jsonPrimitive.int, ChatInbox.unreadConversationCount(rows))
        val slices = listOf(emptyList(), rows.subList(0, 1), rows.subList(3, 5), rows.filter { it.isAi })
        f["unreadCounts"]!!.jsonArray.forEachIndexed { i, n -> assertEquals(n.jsonPrimitive.int, ChatInbox.unreadConversationCount(slices[i]), "slice $i") }
    }

    @Test fun relativeTime() {
        val cases = f["relative"]!!.jsonArray
        assertTrue(cases.size > 1000)
        for (c in cases) {
            val o = c.jsonObject
            val iso = o.str("iso")!!
            val now = o["now"]!!.jsonPrimitive.long
            val off = o["off"]!!.jsonPrimitive.int
            assertEquals(o.str("result"), ChatInbox.relativeTime(iso, now, off), "relativeTime($iso, $now, $off)")
        }
    }

    @Test fun search() {
        for (c in f["search"]!!.jsonArray) {
            val o = c.jsonObject
            val q = o.str("query")!!
            assertEquals(ids("ids", o), ChatInbox.filter(rows, q).map { it.conversationId }, "filter(\"$q\")")
        }
    }

    @Test fun liveUpdates() {
        val listSer = ListSerializer(ChatListRow.serializer())
        for (c in f["live"]!!.jsonArray) {
            val o = c.jsonObject
            val m = o["msg"]!!.jsonObject
            val msg = IncomingChatMessage(m.str("id")!!, m.str("conversation_id")!!, m.str("sender_id")!!, m.str("preview")!!, m.str("created_at")!!, m.str("attachment_kind"))
            val got = ChatInbox.applyIncomingMessage(rows, msg, "me")
            val expected = o["result"]!!
            if (expected is JsonNull) assertNull(got, msg.id) else assertEquals(json.decodeFromJsonElement(listSer, expected), got, msg.id)
        }
        for (c in f["reads"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(json.decodeFromJsonElement(listSer, o["result"]!!), ChatInbox.applyReadMarker(rows, o.str("id")!!), o.str("id"))
        }
    }
}
