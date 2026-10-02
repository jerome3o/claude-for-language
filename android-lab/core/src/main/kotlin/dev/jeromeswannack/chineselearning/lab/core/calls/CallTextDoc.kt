package dev.jeromeswannack.chineselearning.lab.core.calls

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray

/**
 * Port of shared/calls/textDoc.ts — the call's shared text board as a sequence CRDT (RGA):
 * every character has an id `[counter, site]` and remembers the character it was typed after;
 * concurrent inserts after the same character are ordered by id (higher first); deletes leave
 * tombstones. The room relays ops in arrival order and keeps the document. Parity-tested
 * against the TypeScript (parity/fixtures/calls-text.ts → CallsTextParityTest).
 */
data class CharId(val c: Long, val s: String) {
    fun toJson(): JsonArray = buildJsonArray { add(c); add(s) }
}

sealed interface TextOp {
    fun toJson(): JsonObject

    data class Ins(val id: CharId, val after: CharId?, val text: String) : TextOp {
        override fun toJson() = buildJsonObject {
            put("t", "ins"); put("id", id.toJson()); put("after", after?.toJson() ?: JsonNull); put("text", text)
        }
    }

    data class Del(val ids: List<CharId>) : TextOp {
        override fun toJson() = buildJsonObject { put("t", "del"); putJsonArray("ids") { ids.forEach { add(it.toJson()) } } }
    }
}

/** [counter, site, text, deleted]. */
data class TextRun(val c: Long, val s: String, val text: String, val del: Boolean)

data class TextSelection(val anchor: CharId?, val head: CharId?) {
    fun toJson() = buildJsonObject { put("anchor", anchor?.toJson() ?: JsonNull); put("head", head?.toJson() ?: JsonNull) }
}

class CallTextDoc(val site: String, snapshot: List<TextRun>? = null) {
    private class Node(val c: Long, val s: String, val ch: String, var del: Boolean)

    private val nodes = ArrayList<Node>()
    private val byKey = HashMap<String, Node>()
    private val pending = ArrayList<TextOp>()
    var clock: Long = 0
        private set

    init {
        snapshot?.forEach { r ->
            splitChars(r.text).forEachIndexed { i, ch ->
                val n = Node(r.c + i, r.s, ch, r.del)
                nodes.add(n); byKey[key(n.c, n.s)] = n
                if (n.c > clock) clock = n.c
            }
        }
    }

    val nodeCount: Int get() = nodes.size

    fun text(): String = buildString { nodes.forEach { if (!it.del) append(it.ch) } }

    val length: Int get() = nodes.count { !it.del }

    fun snapshot(): List<TextRun> {
        val runs = ArrayList<TextRun>()
        var cur: Triple<Long, String, Boolean>? = null
        val sb = StringBuilder()
        var next = 0L
        fun flush() { cur?.let { runs.add(TextRun(it.first, it.second, sb.toString(), it.third)) } }
        for (n in nodes) {
            val c = cur
            if (c != null && c.second == n.s && c.third == n.del && n.c == next) {
                sb.append(n.ch)
            } else {
                flush(); sb.clear(); sb.append(n.ch); cur = Triple(n.c, n.s, n.del)
            }
            next = n.c + 1
        }
        flush()
        return runs
    }

    fun has(id: CharId?): Boolean = id == null || byKey.containsKey(key(id.c, id.s))

    private fun integrateChar(c: Long, s: String, ch: String, after: CharId?) {
        if (byKey.containsKey(key(c, s))) return
        var i = 0
        if (after != null) i = nodes.indexOf(byKey[key(after.c, after.s)]!!) + 1
        while (i < nodes.size && compareIds(nodes[i].c, nodes[i].s, c, s) > 0) i++
        val node = Node(c, s, ch, false)
        nodes.add(i, node); byKey[key(c, s)] = node
        if (c > clock) clock = c
    }

    private fun canApply(op: TextOp) = when (op) { is TextOp.Ins -> has(op.after); is TextOp.Del -> op.ids.all { has(it) } }

    private fun applyNow(op: TextOp): Boolean {
        when (op) {
            is TextOp.Ins -> {
                var after = op.after
                var changed = false
                splitChars(op.text).forEachIndexed { i, ch ->
                    val c = op.id.c + i
                    if (!byKey.containsKey(key(c, op.id.s))) changed = true
                    integrateChar(c, op.id.s, ch, after)
                    after = CharId(c, op.id.s)
                }
                return changed
            }
            is TextOp.Del -> {
                var changed = false
                for (id in op.ids) {
                    val n = byKey[key(id.c, id.s)]
                    if (n != null && !n.del) { n.del = true; changed = true }
                    if (id.c > clock) clock = id.c
                }
                return changed
            }
        }
    }

    /** Port of apply: idempotent; an op whose characters aren't here waits. */
    fun apply(op: TextOp): Boolean {
        if (!canApply(op)) { pending.add(op); return false }
        var changed = applyNow(op)
        var progress = true
        while (progress && pending.isNotEmpty()) {
            progress = false
            for (k in pending.indices) {
                if (canApply(pending[k])) {
                    val p = pending.removeAt(k)
                    changed = applyNow(p) || changed
                    progress = true
                    break
                }
            }
        }
        return changed
    }

    private fun nodeIndexOfVisible(index: Int): Int {
        var seen = 0
        for (i in nodes.indices) {
            if (nodes[i].del) continue
            if (seen == index) return i
            seen++
        }
        return nodes.size
    }

    fun anchorAt(index: Int): CharId? {
        if (index <= 0) return null
        var seen = 0
        for (n in nodes) {
            if (n.del) continue
            seen++
            if (seen == index) return CharId(n.c, n.s)
        }
        for (i in nodes.indices.reversed()) if (!nodes[i].del) return CharId(nodes[i].c, nodes[i].s)
        return null
    }

    fun indexOfAnchor(anchor: CharId?): Int {
        if (anchor == null) return 0
        val node = byKey[key(anchor.c, anchor.s)] ?: return 0
        var visible = 0
        for (n in nodes) {
            if (!n.del) visible++
            if (n === node) return visible
        }
        return visible
    }

    fun localInsert(index: Int, text: String): TextOp.Ins? {
        if (text.isEmpty()) return null
        val op = TextOp.Ins(CharId(clock + 1, site), anchorAt(minOf(index, length)), text)
        applyNow(op)
        return op
    }

    fun localDelete(index: Int, count: Int): TextOp.Del? {
        if (count <= 0) return null
        val ids = ArrayList<CharId>()
        var i = nodeIndexOfVisible(index)
        while (i < nodes.size && ids.size < count) {
            val n = nodes[i]
            if (!n.del) ids.add(CharId(n.c, n.s))
            i++
        }
        if (ids.isEmpty()) return null
        val op = TextOp.Del(ids)
        applyNow(op)
        return op
    }

    /** Port of visibleIds: the ids of the visible characters, in order. */
    fun visibleIds(): List<CharId> = nodes.filter { !it.del }.map { CharId(it.c, it.s) }

    /**
     * Port of localInsertAfter: type [text] right after the character [after] (null = the start) — an
     * edit made against an older view of the text ([CallTextView]). A deleted [after] is fine (the
     * text goes where it stood). Returns the op (already applied here).
     */
    fun localInsertAfter(after: CharId?, text: String): TextOp.Ins? {
        if (text.isEmpty() || !has(after)) return null
        val op = TextOp.Ins(CharId(clock + 1, site), after, text)
        applyNow(op)
        return op
    }

    /** Port of localDeleteIds: delete these characters (those still visible; the rest are already gone). */
    fun localDeleteIds(ids: List<CharId>): TextOp.Del? {
        val live = ids.filter { id -> byKey[key(id.c, id.s)]?.let { !it.del } == true }
        if (live.isEmpty()) return null
        val op = TextOp.Del(live)
        applyNow(op)
        return op
    }

    /** Port of replaceText: the field now says [next] → one delete + one insert. [caret] is a UTF-16 offset in [next]. */
    fun replaceText(next: String, caret: Int? = null): List<TextOp> {
        val edit = diffChars(splitChars(text()), splitChars(next), caret?.let { codeUnitToCharIndex(next, it) })
        val ops = ArrayList<TextOp>()
        localDelete(edit.index, edit.remove)?.let(ops::add)
        localInsert(edit.index, edit.insert)?.let(ops::add)
        return ops
    }

    companion object {
        const val MAX_TEXT_DOC_CHARS = 20_000
        const val MAX_TEXT_DOC_NODES = 80_000
        const val MAX_TEXT_OP_CHARS = 5_000
        const val MAX_TEXT_OP_DELETES = 5_000
        private const val MAX_SAFE = 9_007_199_254_740_991L

        val PRESENCE_COLORS = listOf("#e11d48", "#2563eb", "#16a34a", "#d97706", "#7c3aed", "#0891b2")

        private fun key(c: Long, s: String) = "$c@$s"

        fun compareIds(ac: Long, as_: String, bc: Long, bs: String): Int = if (ac != bc) ac.compareTo(bc) else as_.compareTo(bs).coerceIn(-1, 1)

        /** Code points, like Array.from(text) (a lone surrogate stays one element). */
        fun splitChars(text: String): List<String> {
            val out = ArrayList<String>()
            var i = 0
            while (i < text.length) {
                val cp = text.codePointAt(i)
                val n = Character.charCount(cp)
                out.add(text.substring(i, i + n))
                i += n
            }
            return out
        }

        fun codeUnitToCharIndex(text: String, offset: Int): Int = splitChars(text.substring(0, offset.coerceIn(0, text.length))).size

        fun charToCodeUnitIndex(text: String, index: Int): Int {
            val chars = splitChars(text)
            var off = 0
            for (i in 0 until minOf(index, chars.size)) off += chars[i].length
            return off
        }

        data class Edit(val index: Int, val remove: Int, val insert: String)

        /** Port of diffChars. */
        fun diffChars(prev: List<String>, next: List<String>, caret: Int? = null): Edit {
            var start = 0
            val max = minOf(prev.size, next.size)
            while (start < max && prev[start] == next[start]) start++
            var endPrev = prev.size
            var endNext = next.size
            while (endPrev > start && endNext > start && prev[endPrev - 1] == next[endNext - 1]) { endPrev--; endNext-- }
            if (caret != null && caret >= 0 && caret <= next.size) {
                val inserted = endNext - start
                val removed = endPrev - start
                if (removed == 0 && inserted > 0 && caret < endNext && caret - inserted >= 0) {
                    val s = caret - inserted
                    if (next.subList(0, s).joinToString("") == prev.subList(0, s).joinToString("") && next.subList(caret, next.size).joinToString("") == prev.subList(s, prev.size).joinToString("")) {
                        return Edit(s, 0, next.subList(s, caret).joinToString(""))
                    }
                }
                if (inserted == 0 && removed > 0 && caret < start) {
                    val s = caret
                    if (prev.subList(0, s).joinToString("") == next.subList(0, s).joinToString("") && prev.subList(s + removed, prev.size).joinToString("") == next.subList(s, next.size).joinToString("")) {
                        return Edit(s, removed, "")
                    }
                }
            }
            return Edit(start, endPrev - start, next.subList(start, endNext).joinToString(""))
        }

        private fun num(el: JsonElement?): Double? = (el as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull
        private fun str(el: JsonElement?): String? = (el as? JsonPrimitive)?.takeIf { it.isString }?.content

        private fun charId(el: JsonElement?): CharId? {
            val a = el as? JsonArray ?: return null
            if (a.size != 2) return null
            val c = num(a[0]) ?: return null
            val s = str(a[1]) ?: return null
            if (c != Math.floor(c) || c <= 0 || c > MAX_SAFE || s.isEmpty() || s.length > 64) return null
            return CharId(c.toLong(), s)
        }

        /** Port of sanitizeTextOp. */
        fun sanitizeOp(raw: JsonElement?, site: String? = null): TextOp? {
            val o = raw as? JsonObject ?: return null
            when (str(o["t"])) {
                "ins" -> {
                    val id = charId(o["id"]) ?: return null
                    val afterEl = o["after"]
                    val after = if (afterEl is JsonNull) null else (charId(afterEl) ?: return null)
                    val text = str(o["text"]) ?: return null
                    if (text.isEmpty() || text.length > MAX_TEXT_OP_CHARS) return null
                    if (site != null && id.s != site) return null
                    if (after != null && after.c >= id.c) return null
                    return TextOp.Ins(id, after, text)
                }
                "del" -> {
                    val ids = o["ids"] as? JsonArray ?: return null
                    if (ids.isEmpty() || ids.size > MAX_TEXT_OP_DELETES) return null
                    return TextOp.Del(ids.map { charId(it) ?: return null })
                }
                else -> return null
            }
        }

        fun parseSnapshot(raw: JsonElement?): List<TextRun>? {
            val runs = (raw as? JsonObject)?.get("runs") as? JsonArray ?: return null
            return runs.map { r ->
                val a = r as? JsonArray ?: return null
                if (a.size != 4) return null
                val c = num(a[0]) ?: return null
                val s = str(a[1]) ?: return null
                val t = str(a[2]) ?: return null
                val d = num(a[3]) ?: return null
                if (c != Math.floor(c) || c <= 0 || c > MAX_SAFE || (d != 0.0 && d != 1.0)) return null
                TextRun(c.toLong(), s, t, d == 1.0)
            }
        }

        fun snapshotToJson(runs: List<TextRun>) = buildJsonObject {
            put("v", 1)
            putJsonArray("runs") { runs.forEach { r -> add(buildJsonArray { add(r.c); add(r.s); add(r.text); add(if (r.del) 1 else 0) }) } }
        }

        fun parseSelection(raw: JsonElement?): TextSelection? {
            val o = raw as? JsonObject ?: return null
            val a = o["anchor"]; val h = o["head"]
            val anchor = if (a == null || a is JsonNull) null else (charId(a) ?: return null)
            val head = if (h == null || h is JsonNull) null else (charId(h) ?: return null)
            return TextSelection(anchor, head)
        }

        /** Port of presenceColor. */
        fun presenceColor(userId: String): String {
            var h = 0
            for (ch in userId) h = h * 31 + ch.code
            return PRESENCE_COLORS[(Math.abs(h.toLong()) % PRESENCE_COLORS.size).toInt()]
        }
    }
}

/**
 * Port of TextView in shared/calls/textDoc.ts — what the text field shows of a [CallTextDoc]: the
 * visible characters with their ids as of the last time the field was rewritten. The field may lag
 * the document: the other person's edits keep arriving while an IME composition is open, and the
 * field must not be rewritten mid-composition (Gboard keeps a composing span on the last word for
 * as long as you don't type a space). So their edits always go into the document at once, and an
 * edit in the field is diffed against the VIEW and applied to the document by character id
 * ([edit]): nothing they typed in the meantime is lost or duplicated. [sync] brings the view up to
 * the document when the field may be rewritten.
 */
class CallTextView(doc: CallTextDoc? = null) {
    private var ids = ArrayList<CharId>()
    private var chars = ArrayList<String>()

    init {
        if (doc != null) sync(doc)
    }

    fun sync(doc: CallTextDoc) {
        ids = ArrayList(doc.visibleIds())
        chars = ArrayList(CallTextDoc.splitChars(doc.text()))
    }

    val text: String get() = chars.joinToString("")

    val length: Int get() = chars.size

    /** Is the view exactly the document's visible text (same characters, same ids)? */
    fun inSync(doc: CallTextDoc): Boolean = doc.visibleIds() == ids

    /** The id of the character just before view index [index] (null = the start). */
    fun anchorAt(index: Int): CharId? {
        if (index <= 0 || ids.isEmpty()) return null
        return ids[minOf(index, ids.size) - 1]
    }

    /** The view index just after [anchor], or -1 when the view doesn't hold it. */
    fun indexOf(anchor: CharId?): Int {
        if (anchor == null) return 0
        val i = ids.indexOf(anchor)
        return if (i < 0) -1 else i + 1
    }

    /**
     * The field now says [next] (its text outside any open composition); [caret] is the UTF-16
     * caret in [next]. Returns the ops to send (already applied to [doc]).
     */
    fun edit(doc: CallTextDoc, next: String, caret: Int? = null): List<TextOp> {
        val want = CallTextDoc.splitChars(next)
        val e = CallTextDoc.diffChars(chars, want, caret?.let { CallTextDoc.codeUnitToCharIndex(next, it) })
        val ops = ArrayList<TextOp>()
        val del = if (e.remove > 0) doc.localDeleteIds(ids.subList(e.index, e.index + e.remove).toList()) else null
        del?.let(ops::add)
        val ins = doc.localInsertAfter(if (e.index > 0) ids[e.index - 1] else null, e.insert)
        ins?.let(ops::add)
        val insChars = if (ins != null) CallTextDoc.splitChars(e.insert) else emptyList()
        repeat(e.remove) { ids.removeAt(e.index); chars.removeAt(e.index) }
        if (ins != null) {
            ids.addAll(e.index, insChars.indices.map { CharId(ins.id.c + it, ins.id.s) })
            chars.addAll(e.index, insChars)
        }
        return ops
    }
}
