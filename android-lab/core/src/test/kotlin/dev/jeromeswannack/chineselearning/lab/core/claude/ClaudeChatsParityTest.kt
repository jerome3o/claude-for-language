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
import dev.jeromeswannack.chineselearning.lab.core.chat.ChatListRow
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
            readerId = o["reader_id"].str,
            pageId = o["page_id"].str,
            page = o["page"]?.jsonPrimitive?.int,
            lookedUp = o["looked_up"]?.let { strings(it) } ?: emptyList(),
            saidWrong = o["said_wrong"]?.let { strings(it) } ?: emptyList(),
            lessonId = o["lesson_id"].str,
            exerciseKey = o["exercise_key"].str,
            exerciseType = o["exercise_type"].str,
            // answer_verdict absent = no answer; null = an answer without a check.
            hasAnswer = o.containsKey("answer_verdict"),
            answerVerdict = o["answer_verdict"].str,
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
            val want = o["out"]!!.jsonArray.map { x -> x.jsonObject.let { ClaudeChats.Chip(it["id"].str!!, it["label"].str!!, it["question"].str!!, it["fill"]?.jsonPrimitive?.booleanOrNull ?: false) } }
            assertEquals(want, got, o.toString().take(200))
        }
    }

    @Test
    fun composers() {
        for (c in f["composers"]!!.jsonArray) {
            val o = c.jsonObject
            val got = ClaudeChats.composerFor(o["kind"].str!!, o["text"].str!!, o["started"]!!.jsonPrimitive.boolean, o["readOnly"]!!.jsonPrimitive.boolean)
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
                    ClaudeChats.Link(
                        it["kind"].str!!, noteId = it["note_id"].str, messageId = it["message_id"].str, conversationId = it["conversation_id"].str,
                        readerId = it["reader_id"].str, page = it["page"]?.let { p -> if (p is JsonNull) null else p.jsonPrimitive.int },
                        lessonId = it["lesson_id"].str, exerciseKey = it["exercise_key"].str,
                    )
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
    fun readerPageWords() {
        val words = f["recapWords"]!!.jsonArray.map { w ->
            val o = w.jsonObject
            ClaudeChats.RecapWordLike(o["hanzi"].str!!, o["page"]!!.jsonPrimitive.int, o["pos"]!!.jsonPrimitive.int, strings(o["reasons"]))
        }
        for (c in f["pageWords"]!!.jsonArray) {
            val o = c.jsonObject
            val out = o["out"]!!.jsonObject
            val want = ClaudeChats.PageWords(out["looked_up"]?.let { strings(it) } ?: emptyList(), out["said_wrong"]?.let { strings(it) } ?: emptyList())
            assertEquals(want, ClaudeChats.readerPageWords(words, o["page"]!!.jsonPrimitive.int), o.toString())
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

    // ---------- The unified Chats tab (ClaudeInbox) ----------

    private val lenient = Json { ignoreUnknownKeys = true }

    private val inboxHumans: List<ChatListRow> by lazy {
        f["inboxHumans"]!!.jsonArray.map { lenient.decodeFromJsonElement(ChatListRow.serializer(), it) }
    }

    private val inboxThreads: List<ClaudeInbox.Thread> by lazy {
        f["inboxThreads"]!!.jsonArray.map { e ->
            val o = e.jsonObject
            ClaudeInbox.Thread(
                id = o["id"].str!!,
                title = o["title"].str!!,
                context = ctx(o["ctx"]),
                firstIntent = o["first_intent"].str,
                preview = o["preview"].str,
                lastMessageAt = o["last_message_at"].str,
                createdAt = o["created_at"].str!!,
                unread = o["unread"]!!.jsonPrimitive.int,
                pending = o["pending"]!!.jsonPrimitive.boolean,
                failed = o["failed"]!!.jsonPrimitive.boolean,
                archived = o["archived"]!!.jsonPrimitive.boolean,
                local = o["local"]?.jsonPrimitive?.booleanOrNull ?: false,
            )
        }
    }

    private fun ints(e: JsonElement?) = e!!.jsonArray.map { it.jsonPrimitive.int }

    private fun badge(e: JsonElement?) = if (e == null || e is JsonNull) null else ClaudeChats.Badge(e.jsonObject["icon"].str!!, e.jsonObject["text"].str!!)

    @Test
    fun inbox() {
        var cases = 0
        for (c in f["inbox"]!!.jsonArray) {
            val o = c.jsonObject
            val humans = ints(o["humans"]).map { inboxHumans[it] }
            if (o["recipients"] != null) {
                val want = o["recipients"]!!.jsonArray.map { r ->
                    r.jsonObject.let { ClaudeInbox.Recipient(it["relationship_id"].str!!, it["conversation_id"].str!!, it["name"].str!!) }
                }
                assertEquals(want, ClaudeInbox.composeRecipients(humans), o.toString().take(200))
                continue
            }
            val threads = ints(o["threads"]).map { inboxThreads[it] }
            val items = ClaudeInbox.merge(humans, threads, o["pin"]!!.jsonPrimitive.boolean, o["filter"].str!!)
            val label = o.toString().take(120)
            val want = o["items"]!!.jsonArray.map { it.jsonObject }
            assertEquals(want.map { it["key"].str }, items.map { it.key }, label)
            for ((w, got) in want.zip(items)) {
                assertEquals(w["kind"].str, got.kind, label)
                assertEquals(w["activity_at"].str, got.activityAt, label)
                assertEquals(w["unread"]!!.jsonPrimitive.int, got.unread, label)
                assertEquals(w["pinned"]!!.jsonPrimitive.boolean, got.pinned, label)
                assertEquals(badge(w["badge"]), got.badge, label)
                assertEquals(w["name"].str, ClaudeInbox.rowName(got), label)
                val l = w["label"]!!.jsonObject
                assertEquals(ClaudeInbox.RowLabel(l["icon"].str!!, l["text"].str!!), ClaudeInbox.rowLabel(got.kind), label)
                assertEquals(w["preview"].str, got.thread?.let { ClaudeInbox.claudeRowPreview(it.preview, it.pending, it.failed, it.local, it.title) }, label)
            }
            val filters = o["filters"]!!.jsonArray.map { it.jsonObject.let { x -> ClaudeInbox.FilterChip(x["id"].str!!, x["label"].str!!) } }
            assertEquals(filters, ClaudeInbox.filters(items), label)
            for (s in o["search"]!!.jsonArray) {
                val q = s.jsonObject
                assertEquals(strings(q["keys"]), ClaudeInbox.search(items, q["q"].str!!).map { it.key }, "$label q=${q["q"].str}")
            }
            val t = o["teacher"]!!.jsonObject
            val sections = ClaudeInbox.teacherSections(items)
            assertEquals(strings(t["people"]), sections.people.map { it.key }, label)
            assertEquals(strings(t["claude"]), sections.claude.map { it.key }, label)
            cases++
        }
        assertEquals(true, cases > 100, "inbox cases: $cases")
    }
}
