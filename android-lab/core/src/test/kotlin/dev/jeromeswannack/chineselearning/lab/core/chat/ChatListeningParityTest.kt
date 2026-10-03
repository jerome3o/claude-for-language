package dev.jeromeswannack.chineselearning.lab.core.chat

import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail

/** ChatListening reproduces shared/chats/listening.ts exactly (parity/fixtures/chat-listening.ts). */
class ChatListeningParityTest {
    private val json = Json { ignoreUnknownKeys = true }
    private val f: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "chat-listening.json").readText()).jsonObject
    }

    private fun JsonElement?.strOrNull(): String? = if (this == null || this is JsonNull) null else jsonPrimitive.content
    private fun JsonObject.str(key: String): String? = this[key].strOrNull()
    private fun strings(e: JsonElement): List<String> = e.jsonArray.map { it.jsonPrimitive.content }

    private fun message(o: JsonObject) = ChatListening.Message(
        id = o.str("id")!!, senderId = o.str("sender_id")!!, content = o.str("content")!!, createdAt = o.str("created_at")!!,
        deletedAt = o.str("deleted_at"), attachmentKind = o.str("attachment_kind"),
    )

    private fun setting(o: JsonObject) = ChatListening.Setting(o["on"]!!.jsonPrimitive.boolean, o.str("since"))

    private val messages by lazy { f["messages"]!!.jsonArray.map { message(it.jsonObject) } }
    private val settings by lazy { f["settings"]!!.jsonArray.map { setting(it.jsonObject) } }
    private val markers by lazy { f["markers"]!!.jsonArray.map { it.strOrNull() } }
    private val revealedSets by lazy { f["revealedSets"]!!.jsonArray.map { strings(it) } }

    @Test fun constants() {
        val c = f["constants"]!!.jsonObject
        assertEquals(c.str("LISTENING_PREVIEW"), ChatListening.LISTENING_PREVIEW)
        assertEquals(c.str("HIDE_ALL_SINCE"), ChatListening.HIDE_ALL_SINCE)
        assertEquals(c["LISTENING_PREFETCH_COUNT"]!!.jsonPrimitive.int, ChatListening.LISTENING_PREFETCH_COUNT)
        assertEquals(c["REVEALED_MAX"]!!.jsonPrimitive.int, ChatListening.REVEALED_MAX)
    }

    @Test fun candidates() {
        for (key in listOf("candidates", "candidatesThem")) for (c in f[key]!!.jsonArray) {
            val o = c.jsonObject
            val m = message(o["msg"]!!.jsonObject)
            assertEquals(o["result"]!!.jsonPrimitive.boolean, ChatListening.listeningCandidate(m, o.str("viewer")!!), "$key ${m.id}")
        }
        for (c in f["han"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o["result"]!!.jsonPrimitive.boolean, ChatListening.hasHan(o.str("text")!!), o.str("text"))
        }
    }

    @Test fun hideRule() {
        val cases = f["hides"]!!.jsonArray
        assertTrue(cases.size > 5000)
        var hidden = 0
        for (c in cases) {
            val o = c.jsonObject
            val m = messages[o["msg"]!!.jsonPrimitive.int]
            val s = settings[o["setting"]!!.jsonPrimitive.int]
            val k = markers[o["marker"]!!.jsonPrimitive.int]
            val r = revealedSets[o["revealed"]!!.jsonPrimitive.int]
            val expected = o["result"]!!.jsonPrimitive.boolean
            if (expected) hidden++
            assertEquals(expected, ChatListening.shouldHideMessage(m, "me", s, k, r), "$m $s $k $r")
            // A set behaves like the list.
            assertEquals(expected, ChatListening.shouldHideMessage(m, "me", s, k, r.toSet()))
        }
        assertTrue(hidden > 50, "the vectors hide something ($hidden)")
    }

    @Test fun settingsAndThresholds() {
        for (c in f["effective"]!!.jsonArray) {
            val o = c.jsonObject
            val row = o["row"]!!.let { if (it is JsonNull) null else setting(it.jsonObject) }
            assertEquals(setting(o["result"]!!.jsonObject), ChatListening.effectiveListening(row, o["def"]!!.jsonPrimitive.boolean))
        }
        for (c in f["thresholds"]!!.jsonArray) {
            val o = c.jsonObject
            val s = settings[o["setting"]!!.jsonPrimitive.int]
            val k = markers[o["marker"]!!.jsonPrimitive.int]
            assertEquals(o.str("result"), ChatListening.listeningThreshold(s, k), "$s $k")
        }
        for (c in f["sinceCases"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o.str("result"), ChatListening.sinceWhenTurnedOn(strings(o["times"]!!), o.str("now")!!))
        }
    }

    @Test fun revealed() {
        for (c in f["revealedCases"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(strings(o["result"]!!), ChatListening.addRevealed(strings(o["list"]!!), o.str("id")!!, o["max"]!!.jsonPrimitive.int))
        }
    }

    @Test fun inboxPreviews() {
        val lasts = f["lasts"]!!.jsonArray.map { e ->
            if (e is JsonNull) null else e.jsonObject.let { o ->
                ChatListening.LastMessage(
                    id = o.str("id")!!, senderId = o.str("sender_id")!!, createdAt = o.str("created_at")!!, preview = o.str("preview")!!,
                    attachmentKind = o.str("attachment_kind"), deleted = o["deleted"]?.jsonPrimitive?.booleanOrNull ?: false,
                )
            }
        }
        var spoilerFree = 0
        for (c in f["previews"]!!.jsonArray) {
            val o = c.jsonObject
            val last = lasts[o["last"]!!.jsonPrimitive.int]
            val s = settings[o["setting"]!!.jsonPrimitive.int]
            val k = markers[o["marker"]!!.jsonPrimitive.int]
            val expected = o.str("result")
            if (expected != null) spoilerFree++
            assertEquals(expected, ChatListening.listeningPreview(last, "me", s, k, strings(o["revealed"]!!)), "$last $s $k")
        }
        assertTrue(spoilerFree > 10)
    }

    @Test fun prefetch() {
        for (c in f["prefetch"]!!.jsonArray) {
            val o = c.jsonObject
            val limit = o["limit"]!!.jsonPrimitive.int
            assertEquals(strings(o["result"]!!), ChatListening.prefetchSelection(messages, "me", limit) { it }.map { it.id }, "limit $limit")
        }
        assertEquals(strings(f["prefetchDefault"]!!), ChatListening.prefetchSelection(messages.take(30), "them") { it }.map { it.id })
    }

    @Test fun placeholder() {
        for (c in f["speech"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o["result"]!!.jsonPrimitive.double, ChatListening.estimateSpeechSeconds(o.str("text")!!), o.str("text"))
        }
        for (c in f["durations"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o.str("result"), ChatListening.formatListeningDuration(o["s"]!!.jsonPrimitive.double), "${o["s"]}")
        }
        for (c in f["bars"]!!.jsonArray) {
            val o = c.jsonObject
            val expected = o["result"]!!.jsonArray.map { it.jsonPrimitive.double }
            val got = ChatListening.listeningBars(o.str("id")!!)
            assertEquals(24, got.size)
            assertEquals(expected, got, o.str("id"))
        }
        for (c in f["barsCounts"]!!.jsonArray) {
            val o = c.jsonObject
            val expected = o["result"]!!.jsonArray.map { it.jsonPrimitive.double }
            assertEquals(expected, ChatListening.listeningBars(o.str("id")!!, o["count"]!!.jsonPrimitive.int), "count ${o["count"]}")
        }
    }

    @Test fun inboxLiveKeepsAttachmentKind() {
        val row = json.decodeFromJsonElement(ChatListRow.serializer(), f["row"]!!)
        assertEquals("2026-10-03T09:00:00.000Z", row.myReadAt)
        val listSer = ListSerializer(ChatListRow.serializer())
        for (c in f["live"]!!.jsonArray) {
            val o = c.jsonObject
            val m = o["msg"]!!.jsonObject
            val msg = IncomingChatMessage(m.str("id")!!, m.str("conversation_id")!!, m.str("sender_id")!!, m.str("preview")!!, m.str("created_at")!!, m.str("attachment_kind"))
            val got = ChatInbox.applyIncomingMessage(listOf(row), msg, "me")
            val expected = o["result"]!!
            if (expected is JsonNull) assertNull(got) else assertEquals(json.decodeFromJsonElement(listSer, expected), got, msg.id)
        }
    }
}
