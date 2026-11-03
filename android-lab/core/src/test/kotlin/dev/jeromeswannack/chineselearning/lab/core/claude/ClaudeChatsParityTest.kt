package dev.jeromeswannack.chineselearning.lab.core.claude

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
import kotlin.test.fail

/** Claude threads' screen rules reproduce shared/claude/contexts.ts (parity/fixtures/claude-chats.ts). */
class ClaudeChatsParityTest {
    private val f: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "claude-chats.json").readText()).jsonObject
    }

    private val JsonElement?.str: String? get() = if (this == null || this is JsonNull) null else jsonPrimitive.content
    private fun strings(e: JsonElement?) = e!!.jsonArray.map { it.str!! }

    private fun ctx(e: JsonElement?): ClaudeChats.Context {
        val o = e!!.jsonObject
        return ClaudeChats.Context(
            kind = o["kind"].str!!,
            noteId = o["note_id"].str,
            messageId = o["message_id"].str,
            conversationId = o["conversation_id"].str,
            scenario = o["scenario"].str,
            label = o["label"].str,
            typed = o["typed"]?.jsonPrimitive?.booleanOrNull ?: false,
        )
    }

    @Test
    fun chips() {
        for (c in f["chips"]!!.jsonArray) {
            val o = c.jsonObject
            val got = ClaudeChats.chipsFor(
                ctx(o["ctx"]),
                language = o["language"].str!!,
                typedAnswer = o["typedAnswer"]!!.jsonPrimitive.boolean,
                hasSentence = o["hasSentence"]!!.jsonPrimitive.boolean,
                replies = o["replies"]!!.jsonPrimitive.int,
                used = strings(o["used"]),
            )
            val want = o["out"]!!.jsonArray.map { x -> x.jsonObject.let { ClaudeChats.Chip(it["id"].str!!, it["label"].str!!, it["question"].str!!) } }
            assertEquals(want, got, o.toString().take(200))
        }
    }

    @Test
    fun composers() {
        for (c in f["composers"]!!.jsonArray) {
            val o = c.jsonObject
            val got = ClaudeChats.composerFor(o["kind"].str!!, o["text"].str!!, o["started"]!!.jsonPrimitive.boolean)
            val w = o["out"]!!.jsonObject
            val want = ClaudeChats.Composer(strings(w["intents"]), w["primary"].str, w["enabled"]!!.jsonPrimitive.boolean, w["hint"].str, w["readOnly"]!!.jsonPrimitive.boolean)
            assertEquals(want, got, o.toString())
        }
    }

    @Test
    fun badgesAndHeaderChips() {
        for (c in f["badges"]!!.jsonArray) {
            val o = c.jsonObject
            val w = o["out"]
            val want = if (w == null || w is JsonNull) null else ClaudeChats.Badge(w.jsonObject["icon"].str!!, w.jsonObject["text"].str!!)
            assertEquals(want, ClaudeChats.contextBadge(ctx(o["ctx"]), o["firstIntent"].str), o.toString())
        }
        for (c in f["headerChips"]!!.jsonArray) {
            val o = c.jsonObject
            val w = o["out"]
            val want = if (w == null || w is JsonNull) null else w.jsonObject.let { h ->
                val l = h["link"]
                val link = if (l == null || l is JsonNull) null else l.jsonObject.let {
                    ClaudeChats.Link(it["kind"].str!!, noteId = it["note_id"].str, messageId = it["message_id"].str, conversationId = it["conversation_id"].str)
                }
                ClaudeChats.HeaderChip(h["icon"].str!!, h["text"].str!!, link)
            }
            assertEquals(want, ClaudeChats.headerChipFor(ctx(o["ctx"])), o.toString())
        }
    }

    @Test
    fun resume() {
        val now = f["now"]!!.jsonPrimitive.long
        val threads = f["threads"]!!.jsonArray.map { t ->
            val o = t.jsonObject
            ClaudeChats.ResumeCandidate(o["id"].str!!, ctx(o["ctx"]), o["last_message_at"].str, o["created_at"].str!!, o["archived"]?.jsonPrimitive?.booleanOrNull ?: false)
        }
        for (c in f["resume"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o["out"].str, ClaudeChats.resumeThreadFor(threads, ctx(o["ctx"]), now), o.toString())
        }
    }

    @Test
    fun pollsAndStatusLines() {
        for (c in f["polls"]!!.jsonArray) {
            val o = c.jsonObject
            val live = o["live"]
            val (open, since) = if (live == null || live is JsonNull) false to null else live.jsonObject.let { l ->
                l["open"]!!.jsonPrimitive.boolean to l["sinceEventMs"].let { s -> if (s == null || s is JsonNull) null else s.jsonPrimitive.long }
            }
            assertEquals(o["out"]!!.jsonPrimitive.long, ClaudeChats.replyPollMs(o["pendingForMs"]!!.jsonPrimitive.long, open, since), o.toString())
        }
        for (c in f["statuses"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o["out"].str, ClaudeChats.turnStatusLine(o["status"].str, o["tool"].str, o["language"].str!!), o.toString())
        }
    }

    @Test
    fun copy() {
        val c = f["copy"]!!.jsonObject
        assertEquals(c["chipsAfterReplyMax"]!!.jsonPrimitive.int, ClaudeChats.CHIPS_AFTER_REPLY_MAX)
        assertEquals(c["practiceReadOnly"].str, ClaudeChats.PRACTICE_READ_ONLY_NOTE)
        assertEquals(c["resumeWindowMs"]!!.jsonPrimitive.long, ClaudeChats.RESUME_WINDOW_MS)
        assertEquals(c["pollFastMs"]!!.jsonPrimitive.long, ClaudeChats.POLL_FAST_MS)
        assertEquals(c["pollFastForMs"]!!.jsonPrimitive.long, ClaudeChats.POLL_FAST_FOR_MS)
        assertEquals(c["pollSlowMs"]!!.jsonPrimitive.long, ClaudeChats.POLL_SLOW_MS)
        assertEquals(c["liveFreshMs"]!!.jsonPrimitive.long, ClaudeChats.LIVE_FRESH_MS)
        val labels = c["intentLabels"]!!.jsonObject.mapValues { it.value.str!! }
        assertEquals(labels, ClaudeChats.INTENT_LABELS)
    }
}
