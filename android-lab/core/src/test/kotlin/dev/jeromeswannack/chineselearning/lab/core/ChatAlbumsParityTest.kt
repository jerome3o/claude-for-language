package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
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
 * Photo albums in ChatBubbles reproduce shared/chats/bubbles.ts exactly (parity/fixtures/chat-albums.ts):
 * album ids, the old 10 s rule, deleted / pending members, ticks, captions, tiles and the counter.
 */
class ChatAlbumsParityTest {
    private val f: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "chat-albums.json").readText()).jsonObject
    }

    private fun JsonObject.str(key: String): String? = this[key]?.let { if (it is JsonNull) null else it.jsonPrimitive.content }
    private fun JsonObject.bool(key: String): Boolean = this[key]?.let { if (it is JsonNull) false else it.jsonPrimitive.booleanOrNull } ?: false

    private fun bubble(e: JsonElement): ChatBubbles.Message {
        val o = e.jsonObject
        return ChatBubbles.Message(
            o.str("id")!!, o.str("sender_id")!!, o.str("created_at")!!, o.str("deleted_at"), o.str("pending"),
            attachmentKind = o.str("attachment_kind"), content = o.str("content"), albumId = o.str("album_id"),
        )
    }

    @Test
    fun constantsMatch() {
        assertEquals(f["legacyGapMs"]!!.jsonPrimitive.long, ChatBubbles.ALBUM_LEGACY_GAP_MS)
        assertEquals(f["maxPhotos"]!!.jsonPrimitive.int, ChatBubbles.ALBUM_MAX_PHOTOS)
    }

    @Test
    fun layoutsMatchTypeScript() {
        val cases = f["layouts"]!!.jsonArray
        assertTrue(cases.size > 300)
        var albums = 0
        for (c in cases) {
            val o = c.jsonObject
            val msgs = o["messages"]!!.jsonArray.map(::bubble)
            val got = ChatBubbles.layoutBubbles(msgs, o.str("viewer")!!, o.str("readAt"), o["offset"]!!.jsonPrimitive.int)
            val want = o["result"]!!.jsonArray.map { e ->
                val r = e.jsonObject
                ChatBubbles.Layout(
                    r.str("id")!!, r.bool("mine"), r.bool("firstInGroup"), r.bool("lastInGroup"), r.bool("newDay"), r.str("day")!!,
                    ChatBubbles.Tick.entries.first { it.id == r.str("tick") },
                    album = r.str("kind") == "album",
                    messageIds = r["messageIds"]!!.jsonArray.map { it.jsonPrimitive.content },
                    captionId = r.str("captionId"),
                )
            }
            albums += want.count { it.album }
            assertEquals(want, got, "layout ${o["messages"]} readAt=${o.str("readAt")} offset=${o["offset"]}")
        }
        // The vectors really exercise albums.
        assertTrue(albums > 50, "only $albums albums in the vectors")
    }

    @Test
    fun albumMenusMatchTypeScript() {
        val cases = f["albumMenus"]!!.jsonArray
        assertTrue(cases.size > 100)
        for (c in cases) {
            val o = c.jsonObject
            val m = o["message"]!!.jsonObject
            val msg = MessageMenu.Message(
                senderId = m.str("sender_id")!!, content = m.str("content")!!, attachmentKind = "image", pinnedAt = m.str("pinned_at"),
            )
            val r = o["result"]!!.jsonObject
            val want = MessageMenu.Menu(r.bool("reactions"), r["items"]!!.jsonArray.map { e ->
                val it = e.jsonObject
                MessageMenu.Item(it.str("id")!!, it.str("label")!!, it.str("icon")!!, it.bool("needsInternet"), it.bool("active"), it.bool("danger"))
            })
            val got = MessageMenu.albumMenu(MessageMenu.messageMenu(msg, o.str("role")!!, o.bool("ai"), "me"), o["count"]!!.jsonPrimitive.int)
            assertEquals(want, got, "albumMenu $o")
        }
    }

    @Test
    fun tilesAndCounterMatchTypeScript() {
        for (c in f["tiles"]!!.jsonArray) {
            val o = c.jsonObject
            val r = o["result"]!!.jsonObject
            assertEquals(ChatBubbles.Tiles(r["tiles"]!!.jsonPrimitive.int, r["more"]!!.jsonPrimitive.int), ChatBubbles.albumTiles(o["count"]!!.jsonPrimitive.int), "tiles $o")
        }
        for (c in f["counters"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o.str("text"), ChatBubbles.albumCounter(o["index"]!!.jsonPrimitive.int, o["count"]!!.jsonPrimitive.int), "counter $o")
        }
    }
}
