package dev.jeromeswannack.chineselearning.lab.core.explorer

import dev.jeromeswannack.chineselearning.lab.core.Known

/*
 * Port of shared/explorer/stack.ts — the language explorer's navigation stack
 * (docs/LANGUAGE_EXPLORER.md): a stack of views — a Character view or a Word view — that the
 * learner pushes by tapping Chinese inside a view, pops with ← or the breadcrumb, and closes
 * with ✕. Parity-tested (parity/fixtures/explorer.ts → ExplorerParityTest).
 */

/** Port of `ExplorerItem`: `CharItem` | `WordItem`. */
sealed class ExplorerItem {
    /** Port of `CharItem`. */
    data class Char(val char: String) : ExplorerItem()

    /**
     * Port of `WordItem`. [pinyin] / [gloss] = what the place it was tapped in already knows (a
     * reader word chip, a breakdown row); [sentence] = the sentence it was tapped in.
     */
    data class Word(
        val hanzi: String,
        val pinyin: String? = null,
        val gloss: String? = null,
        val sentence: String? = null,
    ) : ExplorerItem()

    val kind: String get() = if (this is Char) "char" else "word"
}

/** Port of `ExplorerAction`. */
sealed class ExplorerAction {
    data class Open(val item: ExplorerItem) : ExplorerAction()
    data class Push(val item: ExplorerItem) : ExplorerAction()
    data object Pop : ExplorerAction()
    data class PopTo(val index: Int) : ExplorerAction()
    data object Close : ExplorerAction()
}

/** Port of `Crumb`: a view in the trail, or the gap (…). */
sealed class Crumb {
    data class Item(val label: String, val index: Int, val current: Boolean) : Crumb()
    data object Gap : Crumb()
}

object ExplorerStack {
    /** Port of EXPLORER_MAX_DEPTH: deepest the stack gets; pushing more drops the oldest views. */
    const val MAX_DEPTH = 24

    private fun codePoints(text: String): List<String> =
        text.codePoints().toArray().map { String(Character.toChars(it)) }

    /** Port of `hanOnly`: the Han characters of a text, in order. */
    fun hanOnly(text: String): String {
        val sb = StringBuilder()
        for (cp in text.codePoints().toArray()) if (Known.isHan(cp)) sb.appendCodePoint(cp)
        return sb.toString()
    }

    /**
     * Port of `itemForText`: one Han character → the Character view, several → the Word view
     * (punctuation and spaces dropped; blank hints dropped), none → null.
     */
    fun itemForText(text: String, pinyin: String? = null, gloss: String? = null, sentence: String? = null): ExplorerItem? {
        val han = hanOnly(text)
        val n = codePoints(han).size
        if (n == 0) return null
        if (n == 1) return ExplorerItem.Char(han)
        return ExplorerItem.Word(han, pinyin?.ifEmpty { null }, gloss?.ifEmpty { null }, sentence?.ifEmpty { null })
    }

    /** Port of `itemKey`: the same character / word is the same view whatever hint it carries. */
    fun itemKey(item: ExplorerItem): String = when (item) {
        is ExplorerItem.Char -> "c:${item.char}"
        is ExplorerItem.Word -> "w:${item.hanzi}"
    }

    /** Port of `itemLabel`. */
    fun itemLabel(item: ExplorerItem): String = when (item) {
        is ExplorerItem.Char -> item.char
        is ExplorerItem.Word -> item.hanzi
    }

    /**
     * Port of `explorerReducer`:
     * - open: a fresh stack with this one view;
     * - push: the item on top — unless already the top (no-op), or further down the trail (back to it);
     * - pop: one back (an empty stack = closed); popTo: back to that breadcrumb; close: empty.
     */
    fun reduce(stack: List<ExplorerItem>, action: ExplorerAction): List<ExplorerItem> = when (action) {
        is ExplorerAction.Open -> listOf(action.item)
        is ExplorerAction.Push -> {
            val key = itemKey(action.item)
            val at = stack.indexOfFirst { itemKey(it) == key }
            if (at >= 0) stack.subList(0, at + 1).toList()
            else {
                val next = stack + action.item
                if (next.size > MAX_DEPTH) next.subList(next.size - MAX_DEPTH, next.size).toList() else next
            }
        }
        ExplorerAction.Pop -> if (stack.isEmpty()) emptyList() else stack.subList(0, stack.size - 1).toList()
        is ExplorerAction.PopTo -> if (action.index >= 0 && action.index < stack.size) stack.subList(0, action.index + 1).toList() else stack.toList()
        ExplorerAction.Close -> emptyList()
    }

    /**
     * Port of `breadcrumbTrail`: every view while it fits ([max]), else the first, a gap and the
     * last `max - 2` — the current view is always the last crumb.
     */
    fun breadcrumbTrail(stack: List<ExplorerItem>, max: Int = 4): List<Crumb> {
        fun crumb(i: Int) = Crumb.Item(itemLabel(stack[i]), i, i == stack.size - 1)
        if (stack.size <= max) return stack.indices.map { crumb(it) }
        val tail = maxOf(1, max - 2)
        return listOf(crumb(0), Crumb.Gap) + (0 until tail).map { j -> crumb(stack.size - tail + j) }
    }
}
