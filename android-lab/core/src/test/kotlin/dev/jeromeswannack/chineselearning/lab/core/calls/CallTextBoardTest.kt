package dev.jeromeswannack.chineselearning.lab.core.calls

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
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

    // ---- round 4: a composing span that never closes (Gboard) — ports of the web tests

    @Test fun aComposingSpanThatNeverClosesNeverHoldsTheOtherPersonBackForGood() {
        val p = Pair2()
        p.a.localEdit("今天", 2); p.deliver()
        // b's IME opens a span on the last word and keeps it open: the field says "今天hao".
        p.b.setComposing(true)
        // a keeps typing — all of it goes into b's document at once…
        p.a.localEdit("今天天气", 4); p.deliver()
        p.a.localEdit("今天天气很好", 6); p.deliver()
        assertEquals("今天天气很好", p.b.doc.text())
        assertTrue(p.b.hasHeld)
        assertEquals("今天", p.b.text) // …while the field (the view) is left alone mid-composition
        // Idle / blur: b ends the composition from our side. What was composed counts as typed, after 今天.
        p.b.endComposition("今天hao", 5); p.deliver()
        assertFalse(p.b.hasHeld)
        assertFalse(p.b.composing)
        assertEquals("今天hao天气很好", p.b.text)
        assertEquals("今天hao天气很好", p.a.text)
    }

    @Test fun anEditTypedAgainstAnOlderViewKeepsWhatTheOtherPersonAddedAndRemoved() {
        val p = Pair2()
        p.a.localEdit("abc def", 7); p.deliver()
        p.b.setComposing(true)
        p.a.localEdit("Xabc", 1); p.deliver() // a adds X at the start and deletes " def"
        // b's field still shows the old text with the composition committed in the middle.
        p.b.setComposing(false, "abc 你 def", 5)
        p.b.flushHeld(); p.deliver()
        assertEquals("Xabc 你", p.b.text)
        assertEquals("Xabc 你", p.a.text)
    }

    @Test fun nothingWaitsWhenNobodyComposes() {
        val p = Pair2()
        p.a.localEdit("好", 1); p.deliver()
        assertFalse(p.b.hasHeld)
        assertFalse(p.b.flushHeld())
        assertEquals("好", p.b.text)
    }

    // ---- round 4, Lab: Compose reports the composition range (a fake IME span that never closes)

    @Test fun textOutsideTheCompositionGoesOutAtOnceAndRemoteEditsWaitForTheCatchUp() {
        val p = Pair2()
        p.a.localEdit("你好", 2); p.deliver()
        // Gboard: "hello " committed, "wor" composing — and the span never closes.
        var f = "你好hello wor"
        p.b.composingEdit(f, f.length, f.length, 8, 11)
        p.deliver()
        assertEquals("你好hello ", p.a.text) // the committed part reached a at once
        assertTrue(p.b.composing)
        // a types at the start and deletes 好 meanwhile.
        p.a.localEdit("!你hello ", 1); p.deliver()
        assertEquals("!你hello ", p.b.doc.text()) // in b's document…
        assertTrue(p.b.hasHeld)
        assertEquals("你好hello ", p.b.text) // …but b's field isn't rewritten mid-composition
        // More composing keystrokes: still nothing committed, still held.
        f = "你好hello worl"
        p.b.composingEdit(f, f.length, f.length, 8, 12)
        p.deliver()
        assertEquals("!你hello ", p.a.text)
        assertTrue(p.b.hasHeld)
        // Idle: the view catches up; the field is the document with the composition spliced back in.
        assertTrue(p.b.catchUp())
        assertFalse(p.b.hasHeld)
        assertTrue(p.b.composing)
        val field = p.b.field()
        assertEquals("!你hello worl", field.text)
        assertEquals(8 to 12, field.compStart to field.compEnd)
        assertEquals(12 to 12, field.selStart to field.selEnd)
        // The IME carries on in the rebuilt field and finally commits "world ".
        p.b.composingEdit("!你hello world", 13, 13, 8, 13)
        p.b.setComposing(false, "!你hello world ", 14)
        p.b.flushHeld(); p.deliver()
        assertEquals("!你hello world ", p.b.text)
        assertEquals("!你hello world ", p.a.text)
    }

    @Test fun blurEndsALingeringCompositionAndBothSidesConverge() {
        val p = Pair2()
        p.a.localEdit("我们", 2); p.deliver()
        p.b.composingEdit("我们hao", 5, 5, 2, 5)
        p.a.localEdit("我们去", 3); p.deliver()
        p.a.localEdit("他们去", 1); p.deliver() // replaces 我 under b's feet
        assertTrue(p.b.hasHeld)
        assertEquals("我们", p.b.text)
        // Blur: the composed pinyin counts as typed after 们, the field catches up.
        p.b.endComposition("我们hao", 5); p.deliver()
        assertFalse(p.b.composing)
        assertEquals(p.a.text, p.b.text)
        assertEquals("他们hao去", p.b.text)
        assertEquals(p.b.doc.text(), p.a.doc.text())
    }

    @Test fun compositionAtTheStartAndRemoteCaretsMapPastIt() {
        val p = Pair2()
        p.a.localEdit("abc", 3); p.deliver()
        p.b.composingEdit("niabc", 2, 2, 0, 2)
        p.a.localEdit("abcd", 4); p.deliver()
        assertTrue(p.b.catchUp())
        val f = p.b.field()
        assertEquals("niabcd", f.text)
        assertEquals(0 to 2, f.compStart to f.compEnd)
        assertEquals(0, p.b.compositionIndex())
        // a's caret after "abcd" is index 4 in the view; the screen shifts it past the composition.
        p.b.setCursor(TextCursor("c-a", "user-a", "A", TextSelection(p.a.doc.anchorAt(4), p.a.doc.anchorAt(4))))
        assertEquals(4, p.b.remoteCarets.single().head)
    }

    @Test fun aCaughtUpViewWithoutCompositionKeepsMyCaret() {
        val p = Pair2()
        p.a.localEdit("abc", 3); p.deliver()
        p.b.select(3, 3, notify = false)
        p.b.composingEdit("abcx", 4, 4, 3, 4)
        p.a.localEdit("Zabc", 1); p.deliver()
        p.b.cancelComposing()
        assertFalse(p.b.hasHeld)
        assertEquals("Zabc", p.b.field().text)
        assertEquals(4, p.b.field().selEnd)
    }
}
