package dev.jeromeswannack.chineselearning.lab.core.claude

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.fail

/** Claude threads on the phone reproduce shared/claude/threadCache.ts (parity/fixtures/claude-thread-cache.ts). */
class ClaudeThreadCacheParityTest {
    private val f: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "claude-thread-cache.json").readText()).jsonObject
    }

    private val JsonElement?.str: String? get() = if (this == null || this is JsonNull) null else jsonPrimitive.content
    private val JsonElement?.intOrNull: Int? get() = if (this == null || this is JsonNull) null else jsonPrimitive.int

    data class Msg(
        val id: String,
        val clientId: String?,
        val role: String,
        val createdAt: String,
        val status: String?,
        val content: String,
        val streaming: Boolean,
        val error: String?,
        val queued: Boolean,
        val seq: Int?,
    )

    private object Lens : ClaudeThreadCache.MessageLens<Msg> {
        override fun id(m: Msg) = m.id
        override fun clientId(m: Msg) = m.clientId
        override fun role(m: Msg) = m.role
        override fun createdAt(m: Msg) = m.createdAt
        override fun status(m: Msg) = m.status
        override fun content(m: Msg) = m.content
        override fun streaming(m: Msg) = m.streaming
        override fun error(m: Msg) = m.error
        override fun queued(m: Msg) = m.queued
        override fun seq(m: Msg) = m.seq
        override fun with(m: Msg, status: String?, content: String, streaming: Boolean, error: String?, seq: Int?) =
            m.copy(status = status, content = content, streaming = streaming, error = error, seq = seq)
    }

    private fun msg(e: JsonElement?): Msg? {
        if (e == null || e is JsonNull) return null
        val o = e.jsonObject
        return Msg(
            id = o["id"].str!!,
            clientId = o["client_id"].str,
            role = o["role"].str!!,
            createdAt = o["created_at"].str!!,
            status = o["status"].str,
            content = o["content"].str!!,
            streaming = o["streaming"]!!.jsonPrimitive.boolean,
            error = o["error"].str,
            queued = o["queued"]?.jsonPrimitive?.boolean ?: false,
            seq = o["_seq"].intOrNull,
        )
    }

    private fun msgs(e: JsonElement?) = e!!.jsonArray.map { msg(it)!! }

    data class Thread(val id: String, val clientId: String?, val local: Boolean?, val title: String, val cursor: String?)

    /** `{ ...old, ...row }`: a key the row doesn't carry keeps the old value. */
    private object ThreadLens : ClaudeThreadCache.ThreadLens<Thread> {
        override fun id(t: Thread) = t.id
        override fun clientId(t: Thread) = t.clientId
        override fun local(t: Thread) = t.local == true
        override fun over(old: Thread, row: Thread) = row.copy(local = row.local ?: old.local, cursor = row.cursor ?: old.cursor)
    }

    private fun thread(e: JsonElement): Thread {
        val o = e.jsonObject
        return Thread(o["id"].str!!, o["client_id"].str, o["local"]?.jsonPrimitive?.boolean, o["title"].str!!, o["cursor"].str)
    }

    private fun threads(e: JsonElement?) = e!!.jsonArray.map { thread(it) }

    @Test
    fun titlesAndPreviews() {
        for (c in f["titles"]!!.jsonArray) {
            val o = c.jsonObject
            val ctx = o["ctx"]!!.jsonObject
            val got = ClaudeChats.titleFor(ClaudeChats.Context(ctx["kind"].str!!, label = ctx["label"].str, scenario = ctx["scenario"].str), o["text"].str!!)
            assertEquals(o["out"].str, got, "titleFor $ctx '${o["text"].str}'")
        }
        for (c in f["previews"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o["out"].str, ClaudeChats.previewOf(o["text"].str!!), "previewOf '${o["text"].str}'")
        }
        assertEquals(f["titleMax"]!!.jsonPrimitive.int, ClaudeChats.TITLE_MAX)
    }

    @Test
    fun sortMessages() {
        for (c in f["sorts"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o["out"]!!.jsonArray.map { it.str }, ClaudeThreadCache.sortMessages(msgs(o["rows"]), Lens).map { it.id }, "sort $o")
        }
    }

    @Test
    fun mergeMessage() {
        for (c in f["merges"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(msg(o["out"]), ClaudeThreadCache.mergeMessage(msg(o["local"]), msg(o["server"])!!, Lens), "merge $o")
        }
    }

    @Test
    fun mergeThreadMessages() {
        for (c in f["threadMerges"]!!.jsonArray) {
            val o = c.jsonObject
            val got = ClaudeThreadCache.mergeThreadMessages(msgs(o["prev"]), msgs(o["server"]), o["full"]!!.jsonPrimitive.boolean, Lens)
            val out = o["out"]!!.jsonObject
            assertEquals(msgs(out["messages"]), got.messages, "messages $o")
            assertEquals(out["removed"]!!.jsonArray.map { it.str }, got.removed, "removed $o")
        }
    }

    @Test
    fun applyTurnFrame() {
        for (c in f["frames"]!!.jsonArray) {
            val o = c.jsonObject
            val fr = o["frame"]!!.jsonObject
            val frame = ClaudeThreadCache.TurnFrame(fr["seq"]!!.jsonPrimitive.int, fr["status"].str!!, fr["text"].str, fr["error"].str)
            assertEquals(msg(o["out"]), ClaudeThreadCache.applyTurnFrame(msg(o["row"])!!, frame, Lens), "frame $o")
        }
    }

    @Test
    fun mergeThreadList() {
        for (c in f["lists"]!!.jsonArray) {
            val o = c.jsonObject
            val got = ClaudeThreadCache.mergeThreadList(threads(o["prev"]), threads(o["rows"]), o["deleted"]!!.jsonArray.map { it.str!! }, ThreadLens)
            val out = o["out"]!!.jsonObject
            assertEquals(threads(out["threads"]), got.threads, "threads $o")
            assertEquals(out["removed"]!!.jsonArray.map { it.str }, got.removed, "removed $o")
            assertEquals(out["moved"]!!.jsonArray.map { it.jsonObject["from"].str!! to it.jsonObject["to"].str!! }, got.moved, "moved $o")
        }
    }
}
