package dev.jeromeswannack.chineselearning.lab.core.calls

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray

/** Someone's caret / selection on the board, as the room reports it. */
data class TextCursor(val clientId: String, val userId: String, val name: String, val sel: TextSelection?)

/** The other person's caret resolved to character indexes of the current text. */
data class RemoteCaret(val clientId: String, val userId: String, val name: String, val color: String, val start: Int, val end: Int, val head: Int)

/**
 * Port of frontend/src/services/calls/textBoard.ts (TextBoardSession): this device's replica of
 * the shared text, the ops not yet confirmed (replayed on a rejoin), the other person's caret,
 * and the IME rule — while a pinyin composition is open nothing is sent and incoming edits wait.
 * [send] returns false when the socket isn't open.
 */
class CallTextBoard(userId: String, private val send: (String) -> Boolean, random: String = java.util.UUID.randomUUID().toString().take(6)) {
    /** One site per board: "<user id>:<random>" (the room checks the prefix). */
    val site = "$userId:$random"
    var doc = CallTextDoc(site)
        private set
    private val unsent = ArrayList<TextOp>()
    private val sent = ArrayList<TextOp>()
    private val held = ArrayList<TextOp>()
    private val cursors = LinkedHashMap<String, TextCursor>()
    var composing = false
        private set
    /** Bumped on every change (the UI recomposes on it). */
    var version = 0
        private set

    /** My selection as anchors, so it survives the other person's edits. */
    private var myAnchor: CharId? = null
    private var myHead: CharId? = null

    val text: String get() = doc.text()

    private fun changed() { version++ }

    fun load(snapshot: List<TextRun>?, cursorsNow: List<TextCursor>) {
        doc = CallTextDoc(site, snapshot)
        val replay = sent + unsent
        sent.clear(); unsent.clear()
        val missing = replay.filter { doc.apply(it) }
        cursors.clear()
        cursorsNow.forEach { if (it.sel != null) cursors[it.clientId] = it }
        push(missing)
        changed()
    }

    private fun push(ops: List<TextOp>) {
        ops.chunked(50).forEach { batch ->
            if (send(message(batch))) sent.addAll(batch) else unsent.addAll(batch)
        }
        while (sent.size > 2000) sent.removeAt(0)
    }

    /** The field now says [next]; [caret] is the UTF-16 caret after the edit. */
    fun localEdit(next: String, caret: Int? = null) {
        if (composing) return
        val ops = doc.replaceText(next, caret)
        if (ops.isEmpty()) return
        push(ops)
        changed()
    }

    fun applyRemote(ops: List<TextOp>) {
        if (composing) { held.addAll(ops); return }
        var any = false
        for (op in ops) any = doc.apply(op) || any
        if (any) changed()
    }

    fun setComposing(on: Boolean, finalText: String? = null, caret: Int? = null) {
        if (on) { composing = true; return }
        composing = false
        if (finalText != null) localEdit(finalText, caret)
    }

    fun flushHeld() {
        if (held.isEmpty()) return
        val h = ArrayList(held)
        held.clear()
        applyRemote(h)
    }

    /** Remember my selection (UTF-16 offsets in the current text) and tell the other side. */
    fun select(start: Int, end: Int, notify: Boolean = true) {
        val t = text
        myAnchor = doc.anchorAt(CallTextDoc.codeUnitToCharIndex(t, start))
        myHead = doc.anchorAt(CallTextDoc.codeUnitToCharIndex(t, end))
        if (notify) send(cursorMessage(TextSelection(myAnchor, myHead)))
    }

    fun clearSelection() { send(cursorMessage(null)) }

    /** My selection in the current text (UTF-16 offsets), after whatever changed since [select]. */
    fun mySelection(): Pair<Int, Int> {
        val t = text
        return CallTextDoc.charToCodeUnitIndex(t, doc.indexOfAnchor(myAnchor)) to CallTextDoc.charToCodeUnitIndex(t, doc.indexOfAnchor(myHead))
    }

    fun setCursor(c: TextCursor) {
        if (c.sel == null) cursors.remove(c.clientId) else cursors[c.clientId] = c
        changed()
    }

    fun dropCursor(clientId: String) {
        if (cursors.remove(clientId) != null) changed()
    }

    val remoteCarets: List<RemoteCaret>
        get() = cursors.values.mapNotNull { c ->
            val sel = c.sel ?: return@mapNotNull null
            val a = doc.indexOfAnchor(sel.anchor)
            val h = doc.indexOfAnchor(sel.head)
            RemoteCaret(c.clientId, c.userId, c.name, CallTextDoc.presenceColor(c.userId), minOf(a, h), maxOf(a, h), h)
        }

    companion object {
        fun message(ops: List<TextOp>): String = buildJsonObject {
            put("type", "text")
            putJsonArray("ops") { ops.forEach { add(it.toJson()) } }
        }.toString()

        fun cursorMessage(sel: TextSelection?): String = buildJsonObject {
            put("type", "text_cursor")
            put("sel", sel?.toJson() ?: JsonNull)
        }.toString()
    }
}
