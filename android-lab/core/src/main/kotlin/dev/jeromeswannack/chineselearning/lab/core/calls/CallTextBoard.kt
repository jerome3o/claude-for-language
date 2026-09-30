package dev.jeromeswannack.chineselearning.lab.core.calls

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray

/** Someone's caret / selection on the board, as the room reports it. */
/** [compose] = what they are composing in a pinyin IME right now (not in the text yet), shown in their name flag. */
data class TextCursor(val clientId: String, val userId: String, val name: String, val sel: TextSelection?, val compose: String? = null)

/** The other person's caret resolved to character indexes of the current text. */
data class RemoteCaret(val clientId: String, val userId: String, val name: String, val color: String, val start: Int, val end: Int, val head: Int, val compose: String? = null)

/**
 * Port of frontend/src/services/calls/textBoard.ts (TextBoardSession): this device's replica of
 * the shared text, the ops not yet confirmed (replayed on a rejoin), the other person's caret,
 * and the IME rule — while a pinyin composition is open nothing is sent and incoming edits wait.
 * [send] returns false when the socket isn't open.
 */
class CallTextBoard(userId: String, private val send: (String) -> Boolean, random: String = java.util.UUID.randomUUID().toString().take(6)) {
    /** An op and the board page it was typed on (null = an older room without pages). */
    private data class Tagged(val page: String?, val op: TextOp)

    /** One site per board: "<user id>:<random>" (the room checks the prefix). */
    val site = "$userId:$random"
    var doc = CallTextDoc(site)
        private set
    /** The board page [doc] is (shared/calls/pages.ts); every op and caret goes out tagged with it. */
    var page: String? = null
        private set
    private val unsent = ArrayList<Tagged>()
    private val sent = ArrayList<Tagged>()
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

    /**
     * The board now holds [snapshot], page [pageId] (a welcome, or a page the room sent). My ops on
     * that page the snapshot lacks are applied and sent again. [resendOthers] (a rejoin): ops typed on
     * OTHER pages that may not have reached the room are sent again tagged with their own page
     * (inserts and deletes are idempotent); otherwise they stay as they were. A composition in
     * progress is dropped with the old page.
     */
    fun load(snapshot: List<TextRun>?, cursorsNow: List<TextCursor>, pageId: String? = page, resendOthers: Boolean = true) {
        if (pageId != page) {
            composing = false
            myAnchor = null; myHead = null
        }
        doc = CallTextDoc(site, snapshot)
        page = pageId
        held.clear() // the snapshot already has them
        val replay = sent + unsent
        sent.clear(); unsent.clear()
        val (here, elsewhere) = replay.partition { it.page == pageId }
        val missing = here.map { it.op }.filter { doc.apply(it) }
        cursors.clear()
        cursorsNow.forEach { if (it.sel != null) cursors[it.clientId] = it }
        push(missing, pageId)
        if (resendOthers) elsewhere.groupBy { it.page }.forEach { (p, ops) -> push(ops.map { it.op }, p) }
        else sent.addAll(0, elsewhere)
        changed()
    }

    /** A rejoin that keeps this page (the room is asked for it again): send everything not confirmed, each with its page. */
    fun resendAll() {
        val replay = sent + unsent
        sent.clear(); unsent.clear()
        replay.groupBy { it.page }.forEach { (p, ops) -> push(ops.map { it.op }, p) }
        cursors.clear()
        changed()
    }

    private fun push(ops: List<TextOp>, pageId: String? = page) {
        ops.chunked(50).forEach { batch ->
            val tagged = batch.map { Tagged(pageId, it) }
            if (send(message(batch, pageId))) sent.addAll(tagged) else unsent.addAll(tagged)
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

    /** Stop composing without an edit (switching page mid composition). */
    fun cancelComposing() {
        composing = false
        held.clear()
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
        if (notify) send(cursorMessage(TextSelection(myAnchor, myHead), page = page))
    }

    fun clearSelection() { send(cursorMessage(null, page = page)) }

    /**
     * While an IME composition is open: tell the other side what is being composed (shown in my
     * name flag, never in the text) at my last selection; null when the composition ends.
     */
    fun sendCompose(compose: String?): Boolean =
        send(cursorMessage(TextSelection(myAnchor, myHead), CallConnection.sanitizeCompose(compose), page))

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
            RemoteCaret(c.clientId, c.userId, c.name, CallTextDoc.presenceColor(c.userId), minOf(a, h), maxOf(a, h), h, c.compose)
        }

    companion object {
        /** [page] = the board page the ops belong to (absent for an older room). */
        fun message(ops: List<TextOp>, page: String? = null): String = buildJsonObject {
            put("type", "text")
            putJsonArray("ops") { ops.forEach { add(it.toJson()) } }
            if (page != null) put("page", page)
        }.toString()

        fun cursorMessage(sel: TextSelection?, compose: String? = null, page: String? = null): String = buildJsonObject {
            put("type", "text_cursor")
            put("sel", sel?.toJson() ?: JsonNull)
            if (compose != null) put("compose", compose)
            if (page != null) put("page", page)
        }.toString()
    }
}
