package dev.jeromeswannack.chineselearning.lab.core.calls

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Port of frontend/src/services/calls/textBoard.test.ts: two boards through a fake room. */
class CallTextBoardTest {
    private class Pair2 {
        val room = CallTextDoc("room")
        val inbox = mutableMapOf("a" to mutableListOf<TextOp>(), "b" to mutableListOf())
        var aOnline = true
        private fun sender(other: String, online: () -> Boolean): (String) -> Boolean = { m ->
            if (!online()) false else {
                val o = Json.parseToJsonElement(m).jsonObject
                if (o["type"].toString() == "\"text\"") {
                    val ops = o["ops"]!!.jsonArray.map { CallTextDoc.sanitizeOp(it)!! }
                    ops.forEach { room.apply(it) }
                    inbox[other]!!.addAll(ops)
                }
                true
            }
        }
        val a = CallTextBoard("user-a", sender("b") { aOnline }, "aa")
        val b = CallTextBoard("user-b", sender("a") { true }, "bb")
        fun deliver() {
            a.applyRemote(inbox["a"]!!.toList().also { inbox["a"]!!.clear() })
            b.applyRemote(inbox["b"]!!.toList().also { inbox["b"]!!.clear() })
        }
    }

    @Test fun sendsAndApplies() {
        val p = Pair2()
        p.a.localEdit("我要一杯咖啡", 6); p.deliver()
        assertEquals("我要一杯咖啡", p.b.text)
        p.b.localEdit("我要一杯热咖啡", 5); p.deliver()
        assertEquals("我要一杯热咖啡", p.a.text)
    }

    @Test fun holdsDuringComposition() {
        val p = Pair2()
        p.a.localEdit("你好", 2); p.deliver()
        p.b.setComposing(true)
        p.b.localEdit("你好ni", 4)
        p.a.localEdit("!你好", 1); p.deliver()
        assertEquals("你好", p.b.text)
        p.b.setComposing(false, "你好你们", 4)
        p.b.flushHeld(); p.deliver()
        assertEquals("!你好你们", p.b.text)
        assertEquals("!你好你们", p.a.text)
    }

    @Test fun replaysAfterRejoin() {
        val p = Pair2()
        p.a.localEdit("上课", 2); p.deliver()
        p.aOnline = false
        p.a.localEdit("上课了", 3)
        p.aOnline = true
        p.a.load(p.room.snapshot(), emptyList()); p.deliver()
        assertEquals("上课了", p.room.text())
        assertEquals("上课了", p.b.text)
    }

    @Test fun myCaretFollowsTheOtherPersonsEdit() {
        val p = Pair2()
        p.a.localEdit("abc", 3); p.deliver()
        p.b.select(1, 1, notify = false)
        p.a.localEdit("XXabc", 2); p.deliver()
        assertEquals(3 to 3, p.b.mySelection())
        p.b.setCursor(TextCursor("c-a", "user-a", "A", TextSelection(p.a.doc.anchorAt(2), p.a.doc.anchorAt(4))))
        val caret = p.b.remoteCarets.single()
        assertEquals(2, caret.start); assertEquals(4, caret.end); assertEquals(4, caret.head)
        assertTrue(caret.color.startsWith("#"))
        p.b.dropCursor("c-a")
        assertTrue(p.b.remoteCarets.isEmpty())
    }

    @Test fun composePreviewRidesOnTheCursorAndNeverTouchesTheText() {
        val sent = mutableListOf<String>()
        val a = CallTextBoard("user-a", { sent += it; true }, "aa")
        a.localEdit("我要", 2)
        a.select(2, 2)
        sent.clear()
        a.setComposing(true)
        a.sendCompose("ka\nfei")
        val msg = Json.parseToJsonElement(sent.single()).jsonObject
        val cursor = CallProtocol.parseServer(msg.toString().replace("\"type\":\"text_cursor\"", "\"type\":\"text_cursor\",\"client_id\":\"c1\",\"user_id\":\"user-a\",\"name\":\"A\""))
        val c = (cursor as ServerMessage.TextCursorMsg).cursor
        assertEquals("ka fei", c.compose)
        // The other side draws it in the flag at my caret; the text stays as it was.
        val b = CallTextBoard("user-b", { true }, "bb")
        b.load(a.doc.snapshot(), emptyList())
        b.setCursor(c)
        val caret = b.remoteCarets.single()
        assertEquals("ka fei", caret.compose)
        assertEquals(2, caret.head)
        assertEquals("我要", b.text)
        assertEquals("我要", a.text)
    }
}
