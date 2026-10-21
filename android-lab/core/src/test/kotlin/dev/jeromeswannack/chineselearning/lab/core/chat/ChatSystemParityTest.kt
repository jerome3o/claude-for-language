package dev.jeromeswannack.chineselearning.lab.core.chat

import dev.jeromeswannack.chineselearning.lab.core.ChatBubbles
import dev.jeromeswannack.chineselearning.lab.core.MessageMenu
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * System messages reproduce shared/chats/system.ts exactly (parity/fixtures/chat-system.ts): the
 * view / text per kind and side, the install steps, and how layoutBubbles, messageMenu,
 * listeningCandidate and the inbox preview treat them.
 */
class ChatSystemParityTest {
    private val json = Json { ignoreUnknownKeys = true }
    private val f: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "chat-system.json").readText()).jsonObject
    }

    private fun JsonObject.str(key: String): String? = this[key]?.let { if (it is JsonNull) null else it.jsonPrimitive.content }
    private fun JsonObject.bool(key: String): Boolean = this[key]?.let { if (it is JsonNull) false else it.jsonPrimitive.booleanOrNull } ?: false
    private fun JsonObject.el(key: String): JsonElement? = this[key]?.let { if (it is JsonNull) null else it }

    @Test
    fun kindsMatch() {
        assertEquals(f["kinds"]!!.jsonArray.map { it.jsonPrimitive.content }, SystemMessages.KINDS)
    }

    @Test
    fun viewsMatchTypeScript() {
        val cases = f["views"]!!.jsonArray
        assertTrue(cases.size > 200)
        for (c in cases) {
            val o = c.jsonObject
            val msg = o["msg"]!!.jsonObject
            val ctx = o["ctx"]!!.jsonObject
            val context = SystemMessages.Context(ctx.bool("viewerIsSender"), ctx.str("otherName"), ctx.str("relationshipId"))
            val got = SystemMessages.view(msg.str("system_kind"), msg.el("system_data"), msg.str("content"), context)
            val want = o.el("view")?.jsonObject?.let { v ->
                SystemMessages.View(
                    kind = v.str("kind")!!,
                    icon = v.str("icon")!!,
                    text = v.str("text")!!,
                    quote = v.str("quote"),
                    body = v.str("body"),
                    action = v.el("action")?.jsonObject?.let { a -> SystemMessages.Action(a.str("label")!!, a.str("path")!!) },
                    quiet = v.bool("quiet"),
                )
            }
            assertEquals(want, got, "view $o")
            assertEquals(o.str("text"), SystemMessages.text(msg.str("system_kind"), msg.el("system_data"), msg.str("content"), context), "text $o")
        }
    }

    @Test
    fun installStepsMatch() {
        for (c in f["steps"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o.str("text"), SystemMessages.installHowToSteps(o.str("url")), "steps ${o["url"]}")
        }
    }

    @Test
    fun layoutsKeepSystemRowsApart() {
        var systems = 0
        for (c in f["layouts"]!!.jsonArray) {
            val o = c.jsonObject
            val msgs = o["messages"]!!.jsonArray.map { e ->
                val m = e.jsonObject
                ChatBubbles.Message(
                    m.str("id")!!, m.str("sender_id")!!, m.str("created_at")!!, m.str("deleted_at"), m.str("pending"),
                    attachmentKind = m.str("attachment_kind"), content = m.str("content"), albumId = m.str("album_id"), systemKind = m.str("system_kind"),
                )
            }
            val got = ChatBubbles.layoutBubbles(msgs, "me", o.str("readAt"), o["offset"]!!.jsonPrimitive.int)
            val want = o["result"]!!.jsonArray.map { e ->
                val r = e.jsonObject
                ChatBubbles.Layout(
                    r.str("id")!!, r.bool("mine"), r.bool("firstInGroup"), r.bool("lastInGroup"), r.bool("newDay"), r.str("day")!!,
                    ChatBubbles.Tick.entries.first { it.id == r.str("tick") },
                    album = r.str("kind") == "album",
                    messageIds = r["messageIds"]!!.jsonArray.map { it.jsonPrimitive.content },
                    captionId = r.str("captionId"),
                    system = r.str("kind") == "system",
                )
            }
            systems += want.count { it.system }
            assertEquals(want, got, "layout ${o["messages"]}")
            assertEquals(want.map { it.kind }, got.map { it.kind })
        }
        assertTrue(systems > 40, "only $systems system rows in the vectors")
    }

    @Test
    fun menusAreCopyOnly() {
        for (c in f["menus"]!!.jsonArray) {
            val o = c.jsonObject
            val m = o["message"]!!.jsonObject
            val got = MessageMenu.messageMenu(
                MessageMenu.Message(senderId = m.str("sender_id")!!, content = m.str("content")!!, deletedAt = m.str("deleted_at"), systemKind = m.str("system_kind")),
                o.str("role")!!, false, "me",
            )
            val r = o["result"]!!.jsonObject
            val want = MessageMenu.Menu(r.bool("reactions"), r["items"]!!.jsonArray.map { e ->
                val it = e.jsonObject
                MessageMenu.Item(it.str("id")!!, it.str("label")!!, it.str("icon")!!, it.bool("needsInternet"), it.bool("active"), it.bool("danger"))
            })
            assertEquals(want, got, "menu $o")
        }
    }

    @Test
    fun neverHiddenByListeningMode() {
        for (c in f["candidates"]!!.jsonArray) {
            val o = c.jsonObject
            val m = o["msg"]!!.jsonObject
            val msg = ChatListening.Message(m.str("id")!!, m.str("sender_id")!!, m.str("content")!!, m.str("created_at")!!, systemKind = m.str("system_kind"))
            assertEquals(o.bool("result"), ChatListening.listeningCandidate(msg, "me"), "candidate $o")
        }
    }

    @Test
    fun inboxPreviewsFromMySide() {
        for (c in f["previews"]!!.jsonArray) {
            val o = c.jsonObject
            val row = json.decodeFromJsonElement(ChatListRow.serializer(), o["row"]!!)
            assertEquals(o.str("result"), ChatInbox.rowPreview(row, "me"), "preview $o")
        }
        for (c in f["incoming"]!!.jsonArray) {
            val o = c.jsonObject
            val rows = json.decodeFromJsonElement(ListSerializer(ChatListRow.serializer()), o["rows"]!!)
            val m = o["msg"]!!.jsonObject
            val msg = IncomingChatMessage(
                m.str("id")!!, m.str("conversation_id")!!, m.str("sender_id")!!, m.str("preview")!!, m.str("created_at")!!,
                systemKind = m.str("system_kind"), systemData = m.el("system_data"),
            )
            val got = ChatInbox.applyIncomingMessage(rows, msg, "me")
            val want = o.el("result")?.let { json.decodeFromJsonElement(ListSerializer(ChatListRow.serializer()), it) }
            assertEquals(want, got, "incoming $o")
            assertEquals(o.el("previews")?.jsonArray?.map { it.jsonPrimitive.content }, got?.map { ChatInbox.rowPreview(it, "me") }, "incoming previews $o")
        }
    }
}
