package dev.jeromeswannack.chineselearning.lab.core.calls

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray

/** Someone's caret / selection on the board, as the room reports it. */
/** [compose] = what they are composing in a pinyin IME right now (not in the text yet), shown beside their name under the board. */
data class TextCursor(val clientId: String, val userId: String, val name: String, val sel: TextSelection?, val compose: String? = null)

/** The other person's caret resolved to character indexes of the current text. */
data class RemoteCaret(val clientId: String, val userId: String, val name: String, val color: String, val start: Int, val end: Int, val head: Int, val compose: String? = null)

/**
 * A text field's contents the board wants on screen: [text], the selection, and — while an IME
 * composition is kept open across a catch-up — its range ([compStart] ..< [compEnd], UTF-16; -1 = none).
 */
data class BoardField(val text: String, val selStart: Int, val selEnd: Int, val compStart: Int = -1, val compEnd: Int = -1) {
    val composing: Boolean get() = compStart in 0..compEnd && compEnd <= text.length && compEnd > compStart
}

/**
 * Port of frontend/src/services/calls/textBoard.ts (TextBoardSession): this device's replica of
 * the shared text, the ops not yet confirmed (replayed on a rejoin), the other person's caret,
 * and the IME rule. The field shows a [CallTextView] of the document: the other person's edits
 * ALWAYS go into the document at once, but while a composition is open they are not pushed into
 * the field yet ([hasHeld]) — rewriting the field would break the composition. My edits are diffed
 * against the view and applied by character id, so the two never lose each other's typing.
 *
 * The Lab does better than the web here, because Compose tells us the composition's range: the
 * text OUTSIDE the composition is committed text, so an edit there (Gboard commits "hello " while
 * the next word is composing) goes out at once ([composingEdit]); and when the view catches up
 * mid-composition ([catchUp], after COMPOSE_IDLE_MS idle with edits waiting) the field is rebuilt
 * as the document's text with the composition spliced back in at its anchor ([field]), so the
 * composition is moved rather than dropped. [endComposition] (blur) ends it from our side: what was
 * composed counts as typed. [send] returns false when the socket isn't open.
 */
class CallTextBoard(userId: String, private val send: (String) -> Boolean, random: String = java.util.UUID.randomUUID().toString().take(6)) {
    /** An op and the board page it was typed on (null = an older room without pages). */
    private data class Tagged(val page: String?, val op: TextOp)

    /** One site per board: "<user id>:<random>" (the room checks the prefix). */
    val site = "$userId:$random"
    var doc = CallTextDoc(site)
        private set
    /** What the field shows (lags [doc] only while a composition is open). */
    private var view = CallTextView(doc)
    /** The board page [doc] is (shared/calls/pages.ts); every op and caret goes out tagged with it. */
    var page: String? = null
        private set
    private val unsent = ArrayList<Tagged>()
    private val sent = ArrayList<Tagged>()
    private val cursors = LinkedHashMap<String, TextCursor>()
    var composing = false
        private set
    /** Bumped on every change (the UI recomposes on it). */
    var version = 0
        private set

    /** My selection as anchors, so it survives the other person's edits. */
    private var myAnchor: CharId? = null
    private var myHead: CharId? = null

    // The open composition as the field last reported it (Lab only): the view character just before
    // it, its text, and the selection relative to its start.
    private var compAnchor: CharId? = null
    private var compText: String? = null
    private var compSelStart = 0
    private var compSelEnd = 0

    /** The text the field shows (the document's, except during an open composition with edits waiting). */
    val text: String get() = view.text

    /** The other person's edits are in the document but not on screen yet (an open composition). */
    val hasHeld: Boolean get() = composing && !view.inSync(doc)

    private fun changed() { version++ }

    private fun dropComposition() {
        composing = false
        compAnchor = null; compText = null
    }

    /**
     * The board now holds [snapshot], page [pageId] (a welcome, or a page the room sent). My ops on
     * that page the snapshot lacks are applied and sent again. [resendOthers] (a rejoin): ops typed on
     * OTHER pages that may not have reached the room are sent again tagged with their own page
     * (inserts and deletes are idempotent); otherwise they stay as they were. A composition in
     * progress is dropped (the field is rewritten).
     */
    fun load(snapshot: List<TextRun>?, cursorsNow: List<TextCursor>, pageId: String? = page, resendOthers: Boolean = true) {
        if (pageId != page) { myAnchor = null; myHead = null }
        dropComposition()
        doc = CallTextDoc(site, snapshot)
        page = pageId
        val replay = sent + unsent
        sent.clear(); unsent.clear()
        val (here, elsewhere) = replay.partition { it.page == pageId }
        val missing = here.map { it.op }.filter { doc.apply(it) }
        view = CallTextView(doc)
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

    /** The field now says [next] (outside a composition); [caret] is the UTF-16 caret after the edit. Diffed against the view. */
    fun localEdit(next: String, caret: Int? = null) {
        if (composing) return
        commit(next, caret)
    }

    private fun commit(next: String, caret: Int?): Boolean {
        val ops = view.edit(doc, next, caret)
        if (ops.isEmpty()) return false
        push(ops)
        changed()
        return true
    }

    /**
     * Lab: the field changed while a composition is open: [fieldText] with the selection and the
     * composition [compStart] ..< [compEnd] (UTF-16). The text outside the composition is committed:
     * an edit there goes out at once (diffed against the view); the composition itself is only
     * remembered (its anchor, text and caret) so a catch-up can put it back. Returns true when
     * something was sent.
     */
    fun composingEdit(fieldText: String, selStart: Int, selEnd: Int, compStart: Int, compEnd: Int): Boolean {
        composing = true
        val cs = compStart.coerceIn(0, fieldText.length)
        val ce = compEnd.coerceIn(cs, fieldText.length)
        val committed = fieldText.substring(0, cs) + fieldText.substring(ce)
        val compLen = ce - cs
        fun toCommitted(i: Int) = when {
            i <= cs -> i
            i >= ce -> i - compLen
            else -> cs
        }
        val didSend = if (committed != view.text) commit(committed, toCommitted(selEnd)) else false
        compAnchor = view.anchorAt(CallTextDoc.codeUnitToCharIndex(committed, cs))
        compText = fieldText.substring(cs, ce)
        compSelStart = (selStart - cs).coerceIn(0, compLen)
        compSelEnd = (selEnd - cs).coerceIn(0, compLen)
        return didSend
    }

    /** Stop composing without an edit (switching page mid composition). */
    fun cancelComposing() {
        dropComposition()
        if (!view.inSync(doc)) { view.sync(doc); changed() }
    }

    /** What happened to the other person's edits: nothing new, on screen now, or waiting for my composition. */
    enum class Remote { NONE, SHOWN, HELD }

    /** The other person's edits: always into the document; on screen now, or when my composition ends / goes idle. */
    fun applyRemote(ops: List<TextOp>): Remote {
        var any = false
        for (op in ops) any = doc.apply(op) || any
        if (!any) return Remote.NONE
        if (composing) return Remote.HELD
        view.sync(doc)
        changed()
        return Remote.SHOWN
    }

    /**
     * compositionstart → true. Composition end → false with the field's final text: my composed text
     * goes out (diffed against the view the field showed); then call [flushHeld].
     */
    fun setComposing(on: Boolean, finalText: String? = null, caret: Int? = null) {
        if (on) { composing = true; return }
        dropComposition()
        if (finalText != null) localEdit(finalText, caret)
    }

    /** Show the other person's edits that arrived during a composition (the field is rewritten). */
    fun flushHeld(): Boolean {
        if (composing || view.inSync(doc)) return false
        view.sync(doc)
        changed()
        return true
    }

    /**
     * Lab: catch the view up WITHOUT ending the composition (idle with edits waiting). The field
     * is then rebuilt from [field] — the document's text with the composition spliced back in.
     */
    fun catchUp(): Boolean {
        // Without the composition's range (it was never reported) the field can't be rebuilt around it.
        if (composing && compText == null) return false
        if (view.inSync(doc)) return false
        view.sync(doc)
        changed()
        return true
    }

    /**
     * Port of endComposition: end an open composition from our side — the board lost focus (or a
     * web-style idle): what is composed counts as typed, and the field catches up.
     */
    fun endComposition(finalText: String, caret: Int? = null) {
        if (!composing) return
        setComposing(false, finalText, caret)
        flushHeld()
    }

    /**
     * What the field should show now: the view's text, and — while a composition is open — its text
     * spliced back in at its anchor with the composition range and the caret inside it.
     */
    fun field(): BoardField {
        val t = view.text
        val ct = compText
        if (!composing || ct == null) {
            val (s, e) = mySelection()
            return BoardField(t, s.coerceIn(0, t.length), e.coerceIn(0, t.length))
        }
        val at = CallTextDoc.charToCodeUnitIndex(t, indexOf(compAnchor))
        val text = t.substring(0, at) + ct + t.substring(at)
        return BoardField(text, at + compSelStart, at + compSelEnd, at, at + ct.length)
    }

    /** The composition's start in the view text (character index), or null without one (screens map remote carets past it). */
    fun compositionIndex(): Int? = if (composing && compText != null) indexOf(compAnchor) else null

    /** Remember my selection (UTF-16 offsets in the current text) and tell the other side. */
    fun select(start: Int, end: Int, notify: Boolean = true) {
        val t = text
        myAnchor = view.anchorAt(CallTextDoc.codeUnitToCharIndex(t, start))
        myHead = view.anchorAt(CallTextDoc.codeUnitToCharIndex(t, end))
        if (notify) send(cursorMessage(TextSelection(myAnchor, myHead), page = page))
    }

    fun clearSelection() { send(cursorMessage(null, page = page)) }

    /**
     * While an IME composition is open: tell the other side what is being composed (shown beside my
     * name under their board, never in the text) at my last selection; null when the composition ends.
     */
    fun sendCompose(compose: String?): Boolean =
        send(cursorMessage(TextSelection(myAnchor, myHead), CallConnection.sanitizeCompose(compose), page))

    /** My selection in the current text (UTF-16 offsets), after whatever changed since [select]. */
    fun mySelection(): Pair<Int, Int> {
        val t = text
        return CallTextDoc.charToCodeUnitIndex(t, indexOf(myAnchor)) to CallTextDoc.charToCodeUnitIndex(t, indexOf(myHead))
    }

    /** Port of indexOf: character index of an anchor in the text on screen (the view). */
    fun indexOf(anchor: CharId?): Int {
        if (!composing && view.length == doc.length) return doc.indexOfAnchor(anchor)
        val i = view.indexOf(anchor)
        return if (i >= 0) i else minOf(doc.indexOfAnchor(anchor), view.length)
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
            val a = indexOf(sel.anchor)
            val h = indexOf(sel.head)
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
