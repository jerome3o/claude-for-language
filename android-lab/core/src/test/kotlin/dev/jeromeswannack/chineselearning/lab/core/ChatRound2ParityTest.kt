package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * MessageMenu + ChatBubbles reproduce shared/chats/messageMenu.ts and shared/chats/bubbles.ts
 * exactly (parity/fixtures/chat-round2.ts).
 */
class ChatRound2ParityTest {
    private val f: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "chat-round2.json").readText()).jsonObject
    }

    private fun JsonObject.str(key: String): String? = this[key]?.let { if (it is JsonNull) null else it.jsonPrimitive.content }
    private fun JsonObject.bool(key: String): Boolean = this[key]?.let { if (it is JsonNull) false else it.jsonPrimitive.booleanOrNull } ?: false
    private fun JsonObject.obj(key: String): JsonObject? = this[key]?.takeIf { it !is JsonNull }?.jsonObject

    private fun menuMessage(o: JsonObject): MessageMenu.Message {
        val a = o.obj("attachment")
        return MessageMenu.Message(
            senderId = o.str("sender_id")!!,
            content = o.str("content")!!,
            deletedAt = o.str("deleted_at"),
            pending = o.bool("pending"),
            attachmentKind = a?.str("kind"),
            transcript = a?.str("transcript"),
            attachmentTranslation = a?.str("translation"),
            translation = o.str("translation"),
            hasCorrection = o.obj("correction") != null,
            checkStatus = o.str("check_status"),
            hasDiscussion = o.bool("has_discussion"),
            pinnedAt = o.str("pinned_at"),
        )
    }

    private fun item(e: JsonElement): MessageMenu.Item {
        val o = e.jsonObject
        return MessageMenu.Item(o.str("id")!!, o.str("label")!!, o.str("icon")!!, o.bool("needsInternet"), o.bool("active"), o.bool("danger"))
    }

    @Test
    fun menusMatchTypeScript() {
        val cases = f["menus"]!!.jsonArray
        assertTrue(cases.size > 1000)
        for (c in cases) {
            val o = c.jsonObject
            val msg = menuMessage(o.obj("message")!!)
            val state = o.obj("state")!!
            val role = o.str("role")!!
            val ai = o.bool("ai")
            assertEquals(o.str("text"), MessageMenu.menuText(msg), "menuText $o")
            val r = o.obj("result")!!
            val expected = MessageMenu.Menu(r.bool("reactions"), r["items"]!!.jsonArray.map(::item))
            assertEquals(expected, MessageMenu.messageMenu(msg, role, ai, "me", state.bool("pinyinOn"), state.bool("translateOn")), "messageMenu ${o["message"]} $role ai=$ai $state")
        }
    }

    private fun bubble(e: JsonElement): ChatBubbles.Message {
        val o = e.jsonObject
        return ChatBubbles.Message(o.str("id")!!, o.str("sender_id")!!, o.str("created_at")!!, o.str("deleted_at"), o.str("pending"))
    }

    @Test
    fun layoutsMatchTypeScript() {
        assertEquals(f["groupGapMs"]!!.jsonPrimitive.long, ChatBubbles.GROUP_GAP_MS)
        for (c in f["layouts"]!!.jsonArray) {
            val o = c.jsonObject
            val msgs = o["messages"]!!.jsonArray.map(::bubble)
            val got = ChatBubbles.layoutBubbles(msgs, o.str("viewer")!!, o.str("readAt"), o["offset"]!!.jsonPrimitive.int)
            val want = o["result"]!!.jsonArray.map { e ->
                val r = e.jsonObject
                ChatBubbles.Layout(r.str("id")!!, r.bool("mine"), r.bool("firstInGroup"), r.bool("lastInGroup"), r.bool("newDay"), r.str("day")!!, ChatBubbles.Tick.entries.first { it.id == r.str("tick") })
            }
            assertEquals(want, got, "layout ${o["messages"]} readAt=${o.str("readAt")} offset=${o["offset"]}")
        }
    }

    @Test
    fun ticksMatchTypeScript() {
        for (c in f["ticks"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o.str("tick"), ChatBubbles.tickFor(bubble(o["message"]!!), "me", o.str("readAt")).id, "tick $o")
        }
    }

    @Test
    fun daysMatchTypeScript() {
        for (c in f["days"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o.str("day"), ChatBubbles.localDay(o.str("iso")!!, o["offset"]!!.jsonPrimitive.int), "localDay $o")
        }
    }

    @Test
    fun linksMatchTypeScript() {
        val cases = f["links"]!!.jsonArray
        assertTrue(cases.size >= 50)
        for (c in cases) {
            val o = c.jsonObject
            assertEquals(o.str("link"), ChatBubbles.firstLink(o.str("text")), "firstLink(${o.str("text")})")
        }
    }

    @Test
    fun theTsTestsExamples() {
        // A couple of the vitest cases, readable here.
        val base = MessageMenu.Message("them", "你好，今天怎么样？")
        assertEquals(
            listOf("reply", "copy", "translate", "pinyin", "explain", "save_card", "select_cards", "play", "discuss", "pin", "select"),
            MessageMenu.messageMenu(base, "student", false, "me").items.map { it.id },
        )
        assertEquals("https://example.com", ChatBubbles.firstLink("see https://example.com."))
        assertTrue(MessageMenu.messageMenu(base.copy(senderId = "me"), "student", false, "me").items.first { it.id == "delete" }.danger)
    }
}
