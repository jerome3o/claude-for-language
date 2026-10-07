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
            transcriptStatus = a?.str("transcript_status"),
            attachmentTranslation = a?.str("translation"),
            translation = o.str("translation"),
            hasCorrection = o.obj("correction") != null,
            correctionText = o.obj("correction")?.str("text"),
            checkStatus = o.str("check_status"),
            autoCheckStatus = o.obj("auto_check")?.str("status"),
            autoCheckText = o.obj("auto_check")?.str("text"),
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
    fun queueLabelsMatchTypeScript() {
        val cases = f["queueLabels"]!!.jsonArray
        assertTrue(cases.size >= 10)
        for (c in cases) {
            val o = c.jsonObject
            assertEquals(o.str("label"), ChatDrafts.queueLabel(o["waiting"]!!.jsonPrimitive.int, o.bool("online")), "queueLabel $o")
        }
    }

    @Test
    fun draftsMatchTypeScript() {
        var drafts: List<ChatDrafts.Draft> = emptyList()
        val ops = f["draftOps"]!!.jsonArray
        assertTrue(ops.size >= 300)
        for (c in ops) {
            val o = c.jsonObject
            drafts = ChatDrafts.save(drafts, o.str("conv"), o.str("text")!!, o["now"]!!.jsonPrimitive.long)
            assertTrue(drafts.size <= ChatDrafts.MAX)
            for (l in o["loads"]!!.jsonArray) {
                val lo = l.jsonObject
                assertEquals(lo.str("text"), ChatDrafts.load(drafts, lo.str("conv")), "loadDraft after $o")
            }
        }
        val final = f["finalDrafts"]!!.jsonArray
        assertEquals(ChatDrafts.MAX, final.count { it.jsonObject.str("text")!!.isNotEmpty() }, "the vectors reach the cap")
        for (l in final) assertEquals(l.jsonObject.str("text"), ChatDrafts.load(drafts, l.jsonObject.str("conv")))
    }

    @Test
    fun sayBetterMatchesTypeScript() {
        val cases = f["sayBetter"]!!.jsonArray
        assertTrue(cases.size > 500)
        for (c in cases) {
            val o = c.jsonObject
            val m = o.obj("message")!!
            val corr = m.obj("correction")
            val auto = m.obj("auto_check")
            val got = SayBetter.state(
                m.str("sender_id")!!, m.str("content")!!, m.str("deleted_at"), m.obj("attachment")?.str("kind"),
                corr != null, corr?.str("text"), auto?.str("status"), auto?.str("text"), "me",
            )
            assertEquals(o.str("result"), got, "sayBetterState $m")
        }
        for (c in f["sayBetterLabels"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o.str("label"), SayBetter.label(o.str("state"), o.str("name")), "sayBetterLabel $o")
        }
        for (c in f["settingShown"]!!.jsonArray) {
            val o = c.jsonObject
            val setting = o["setting"]?.takeIf { it !is JsonNull }?.jsonPrimitive?.boolean
            assertEquals(o["shown"]!!.jsonPrimitive.boolean, SayBetter.settingShown(setting, o.str("role")), "autoCheckSettingShown $o")
        }
    }

    @Test
    fun openInCoachMatchesTypeScript() {
        val cases = f["coachMsgs"]!!.jsonArray
        assertTrue(cases.size > 1000)
        for (c in cases) {
            val o = c.jsonObject
            val m = o.obj("message")!!
            val a = m.obj("attachment")
            val corr = m.obj("correction")
            val auto = m.obj("auto_check")
            val sender = m.str("sender_id")!!
            val content = m.str("content")!!
            val kind = a?.str("kind")
            val transcript = a?.str("transcript")
            val ts = a?.str("transcript_status")
            assertEquals(o.str("text"), SayBetter.autoCheckText(content, kind, transcript, ts), "autoCheckText $m")
            assertEquals(
                o.str("sayBetter"),
                SayBetter.state(sender, content, m.str("deleted_at"), kind, corr != null, corr?.str("text"), auto?.str("status"), auto?.str("text"), "me", transcript, ts),
                "sayBetterState $m",
            )
            val want = o.obj("coach")?.let { SayBetter.CoachRequest(it.str("text")!!, it.str("action")!!) }
            val got = SayBetter.openInCoachRequest(sender, content, m.str("deleted_at"), kind, transcript, ts, "me")
            assertEquals(want, got, "openInCoachRequest $m")
            assertEquals(o.bool("chip"), SayBetter.showCoachChip(sender, content, m.str("deleted_at"), kind, transcript, ts, auto?.str("status"), auto?.str("text"), "me"), "showCoachChip $m")
            assertEquals(o.str("link"), got?.let { SayBetter.coachDeepLink(it, if (sender == "me") "msg-1" else null) }, "coachDeepLink $m")
        }
        for (c in f["coachLinks"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o.str("link"), SayBetter.coachDeepLink(SayBetter.CoachRequest(o.str("text")!!, o.str("action")!!), o.str("id")), "coachDeepLink $o")
        }
    }

    @Test
    fun openInCoachIsSecondAfterSayBetter() {
        val photo = MessageMenu.Message("me", "我昨天去了商店买东西了", attachmentKind = "image", autoCheckStatus = "improvable", autoCheckText = "我昨天去了商店买东西了")
        assertEquals(listOf("say_better", "open_coach", "reply"), MessageMenu.messageMenu(photo, "student", false, "me").items.take(3).map { it.id })
        // A tutor's own message: no Open in Coach; the student's message for the tutor: explained, after Save as flashcard.
        assertTrue(MessageMenu.messageMenu(photo.copy(autoCheckStatus = null), "tutor", false, "me").items.none { it.id == "open_coach" })
        val ids = MessageMenu.messageMenu(photo.copy(senderId = "them"), "tutor", false, "me").items.map { it.id }
        assertEquals(ids.indexOf("save_card") + 1, ids.indexOf("open_coach"))
        // English: nothing to open.
        assertTrue(MessageMenu.messageMenu(MessageMenu.Message("them", "See you"), "student", false, "me").items.none { it.id == "open_coach" })
    }

    @Test
    fun theTsTestsExamples() {
        // A couple of the vitest cases, readable here.
        val base = MessageMenu.Message("them", "你好，今天怎么样？")
        assertEquals(
            listOf("reply", "copy", "forward", "translate", "pinyin", "explain", "save_card", "open_coach", "select_cards", "play", "discuss", "pin", "info", "select"),
            MessageMenu.messageMenu(base, "student", false, "me").items.map { it.id },
        )
        assertEquals("https://example.com", ChatBubbles.firstLink("see https://example.com."))
        assertTrue(MessageMenu.messageMenu(base.copy(senderId = "me"), "student", false, "me").items.first { it.id == "delete" }.danger)
    }
}
