package dev.jeromeswannack.chineselearning.lab.ui.kit

/*
 * The Markdown the web renders with react-markdown + remark-gfm (Ask Claude answers, fun_facts,
 * coach and discussion chats): CommonMark blocks and inlines plus the GFM extensions (tables,
 * strikethrough, task lists, autolinks). Pure Kotlin — no Android — so it is unit-tested on the
 * JVM (`MarkdownParserTest`); `Markdown.kt` renders the tree with Lab theming.
 *
 * Deliberately lenient where Claude's output is sloppy and CommonMark would be unhelpful:
 * - a newline inside a paragraph is a line break (fun_facts are "3–6 short lines");
 * - nested lists nest with 2+ spaces under any marker; block starts may be indented;
 * - a table may start straight after a paragraph line; `<br>` in a cell is a line break;
 * - `**注意：**这个` is bold (CommonMark's flanking rules miss CJK next to full-width punctuation).
 * It never throws: every prefix of a reply parses (streaming), unclosed `**` / ``` stay literal /
 * run to the end, and a table whose delimiter row is still arriving already renders as a table.
 */

sealed interface MdInline {
    data class Text(val text: String) : MdInline
    data class Strong(val children: List<MdInline>) : MdInline
    data class Emphasis(val children: List<MdInline>) : MdInline
    data class Strike(val children: List<MdInline>) : MdInline
    data class Code(val code: String) : MdInline
    data class Link(val url: String, val children: List<MdInline>) : MdInline
    data object LineBreak : MdInline
}

enum class MdAlign { Start, Center, End }

data class MdListItem(val blocks: List<MdBlock>, val checked: Boolean? = null)

sealed interface MdBlock {
    data class Heading(val level: Int, val content: List<MdInline>) : MdBlock
    data class Paragraph(val content: List<MdInline>) : MdBlock
    data class ListBlock(val ordered: Boolean, val start: Int, val items: List<MdListItem>) : MdBlock
    data class Quote(val blocks: List<MdBlock>) : MdBlock
    data object Rule : MdBlock
    data class CodeBlock(val language: String?, val code: String) : MdBlock
    data class Table(val header: List<List<MdInline>>, val align: List<MdAlign>, val rows: List<List<List<MdInline>>>) : MdBlock
}

object MarkdownParser {
    fun parse(src: String): List<MdBlock> {
        val lines = src.replace("\r\n", "\n").replace('\r', '\n').replace("\t", "    ").split('\n')
        return Blocks(lines).parse()
    }

    fun parseInline(text: String): List<MdInline> = Inlines(text).parse()

    /** The visible text of [inlines] (tests, accessibility, the one-line [markdownLite]). */
    fun plainText(inlines: List<MdInline>): String = buildString { appendPlain(inlines) }

    private fun StringBuilder.appendPlain(inlines: List<MdInline>) {
        for (n in inlines) when (n) {
            is MdInline.Text -> append(n.text)
            is MdInline.Code -> append(n.code)
            is MdInline.Strong -> appendPlain(n.children)
            is MdInline.Emphasis -> appendPlain(n.children)
            is MdInline.Strike -> appendPlain(n.children)
            is MdInline.Link -> appendPlain(n.children)
            MdInline.LineBreak -> append('\n')
        }
    }

    // ---------------------------------------------------------------- blocks

    private val FENCE = Regex("^(`{3,}|~{3,})\\s*([^`\\s]*).*$")
    private val ATX = Regex("^(#{1,6})(?:[ ]+(.*?))?(?:[ ]+#+)?[ ]*$")
    private val RULE = Regex("^([-*_])(?:[ ]*\\1){2,}[ ]*$")
    private val SETEXT = Regex("^(=+|-+)[ ]*$")
    private val MARKER = Regex("^( *)([-*+]|(\\d{1,9})([.)]))(?:( +)(.*))?$")
    private val TASK = Regex("^\\[([ xX])\\](?: +|$)(.*)$")
    private val DELIM_CELL = Regex("^:?-+:?$")
    private val PARTIAL_DELIM = Regex("^[|: -]*-[|: -]*$|^\\|[|: ]*$")

    private fun indentOf(line: String): Int = line.length - line.trimStart(' ').length

    private data class Marker(
        val indent: Int, val ordered: Boolean, val bullet: Char, val number: Int, val contentIndent: Int, val rest: String,
    )

    private fun marker(line: String): Marker? {
        val m = MARKER.matchEntire(line) ?: return null
        val indent = m.groupValues[1].length
        val raw = m.groupValues[2]
        val ordered = m.groupValues[3].isNotEmpty()
        val spaces = m.groupValues[5].length
        val rest = m.groupValues[6]
        val markerEnd = indent + raw.length
        val contentIndent = if (spaces in 1..4 && rest.isNotEmpty()) markerEnd + spaces else markerEnd + 1
        return Marker(
            indent, ordered, if (ordered) m.groupValues[4][0] else raw[0],
            if (ordered) m.groupValues[3].toInt() else 1, contentIndent,
            if (spaces > 4) " ".repeat(spaces - 1) + rest else rest,
        )
    }

    /** Would [line] start a block (so it can't be a lazy continuation of a paragraph)? */
    private fun startsBlock(line: String): Boolean {
        val t = line.trimStart(' ')
        if (t.isEmpty()) return true
        if (FENCE.matches(t) || ATX.matches(t) || RULE.matches(t) || t.startsWith(">")) return true
        val m = marker(t) ?: return false
        return m.rest.isNotBlank() && (!m.ordered || m.number == 1)
    }

    private fun splitRow(line: String): List<String> {
        var s = line.trim()
        if (s.startsWith("|")) s = s.substring(1)
        if (s.endsWith("|") && !s.endsWith("\\|")) s = s.dropLast(1)
        val cells = mutableListOf<String>()
        val cur = StringBuilder()
        var i = 0
        while (i < s.length) {
            val c = s[i]
            if (c == '\\' && i + 1 < s.length && s[i + 1] == '|') { cur.append('|'); i += 2; continue }
            if (c == '|') { cells += cur.toString().trim(); cur.clear() } else cur.append(c)
            i++
        }
        cells += cur.toString().trim()
        return cells
    }

    private fun isDelimiterRow(line: String, columns: Int): Boolean {
        if (!line.contains('-')) return false
        if (!line.contains('|') && columns > 1) return false
        val cells = splitRow(line)
        return cells.size == columns && cells.all { DELIM_CELL.matches(it) }
    }

    private fun alignOf(cell: String): MdAlign = when {
        cell.startsWith(":") && cell.endsWith(":") && cell.length > 1 -> MdAlign.Center
        cell.endsWith(":") -> MdAlign.End
        else -> MdAlign.Start
    }

    private class Blocks(val lines: List<String>) {
        private val out = mutableListOf<MdBlock>()
        private val para = mutableListOf<String>()

        private fun flushPara() {
            if (para.isEmpty()) return
            out += MdBlock.Paragraph(parseInline(para.joinToString("\n") { it.trim() }))
            para.clear()
        }

        fun parse(): List<MdBlock> {
            var i = 0
            while (i < lines.size) i = step(i)
            flushPara()
            return out
        }

        /** Consumes the block starting at line [i]; returns the next line to look at. */
        private fun step(i: Int): Int {
            val line = lines[i]
            if (line.isBlank()) { flushPara(); return i + 1 }
            val t = line.trimStart(' ')

            FENCE.matchEntire(t)?.let { m ->
                flushPara()
                val fence = m.groupValues[1]
                val indent = indentOf(line)
                val code = mutableListOf<String>()
                var j = i + 1
                while (j < lines.size) {
                    val l = lines[j].trimStart(' ')
                    if (l.startsWith(fence) && l.trimEnd().all { it == fence[0] }) { j++; break }
                    code += lines[j].drop(minOf(indent, indentOf(lines[j])))
                    j++
                }
                out += MdBlock.CodeBlock(m.groupValues[2].ifEmpty { null }, code.joinToString("\n"))
                return j
            }
            ATX.matchEntire(t)?.let { m ->
                flushPara()
                out += MdBlock.Heading(m.groupValues[1].length, parseInline(m.groupValues[2].trim()))
                return i + 1
            }
            // A lone `-` on the last line is a list item being typed (streaming), not an underline.
            if (para.isNotEmpty() && SETEXT.matches(t) && !(t.trim() == "-" && i == lines.lastIndex)) {
                val text = para.joinToString("\n") { it.trim() }
                para.clear()
                out += MdBlock.Heading(if (t.startsWith("=")) 1 else 2, parseInline(text))
                return i + 1
            }
            if (RULE.matches(t)) { flushPara(); out += MdBlock.Rule; return i + 1 }
            if (t.startsWith(">")) { flushPara(); return quote(i) }
            marker(t)?.let { m ->
                if (para.isEmpty() || (m.rest.isNotBlank() && (!m.ordered || m.number == 1))) {
                    flushPara()
                    return list(i)
                }
            }
            if (t.contains('|') && i + 1 < lines.size) {
                val header = splitRow(t)
                val next = lines[i + 1].trim()
                val streamingHeader = i + 1 == lines.lastIndex && PARTIAL_DELIM.matches(next) && splitRow(next).size <= header.size
                if (isDelimiterRow(next, header.size) || streamingHeader) {
                    flushPara()
                    return table(i, header, streamingHeader)
                }
            }
            para += line
            return i + 1
        }

        private fun quote(start: Int): Int {
            val inner = mutableListOf<String>()
            var j = start
            while (j < lines.size) {
                val l = lines[j]
                val t = l.trimStart(' ')
                if (t.startsWith(">")) {
                    inner += t.substring(1).let { if (it.startsWith(" ")) it.substring(1) else it }
                } else if (l.isNotBlank() && inner.isNotEmpty() && inner.last().isNotBlank() && !startsBlock(l)) {
                    inner += t // lazy continuation of the quoted paragraph
                } else break
                j++
            }
            out += MdBlock.Quote(Blocks(inner).parse())
            return j
        }

        private fun list(start: Int): Int {
            val first = marker(lines[start].trimStart(' '))!!
            val baseIndent = indentOf(lines[start])
            val items = mutableListOf<MdListItem>()
            var i = start
            while (i < lines.size) {
                val m = marker(lines[i].trimStart(' ')) ?: break
                if (items.isNotEmpty() && (m.ordered != first.ordered || m.bullet != first.bullet)) break
                if (indentOf(lines[i]) > baseIndent + 1 && items.isNotEmpty()) break
                val childMin = baseIndent + 2
                val strip = indentOf(lines[i]) + m.contentIndent
                var rest = m.rest
                var checked: Boolean? = null
                TASK.matchEntire(rest)?.let { tm -> checked = tm.groupValues[1] != " "; rest = tm.groupValues[2] }
                val body = mutableListOf(rest)
                i++
                while (i < lines.size) {
                    val l = lines[i]
                    if (l.isBlank()) {
                        var j = i
                        while (j < lines.size && lines[j].isBlank()) j++
                        if (j < lines.size && indentOf(lines[j]) >= childMin) {
                            repeat(j - i) { body += "" }
                            i = j
                            continue
                        }
                        break
                    }
                    val ind = indentOf(l)
                    if (ind >= childMin) { body += l.substring(minOf(ind, strip)); i++; continue }
                    if (body.last().isNotBlank() && !startsBlock(l) && marker(l.trimStart(' ')) == null && !l.trimStart().startsWith("|")) {
                        body += l.trim(); i++; continue
                    }
                    break
                }
                items += MdListItem(Blocks(body).parse(), checked)
                // A blank line between two items of the same list keeps the list going.
                if (i < lines.size && lines[i].isBlank()) {
                    var j = i
                    while (j < lines.size && lines[j].isBlank()) j++
                    val next = if (j < lines.size) marker(lines[j].trimStart(' ')) else null
                    if (next != null && next.ordered == first.ordered && next.bullet == first.bullet && indentOf(lines[j]) <= baseIndent + 1) i = j else break
                }
            }
            out += MdBlock.ListBlock(first.ordered, first.number, items)
            return i
        }

        private fun table(start: Int, headerCells: List<String>, streamingHeader: Boolean): Int {
            val cols = headerCells.size
            val align = if (streamingHeader) List(cols) { MdAlign.Start } else splitRow(lines[start + 1]).map(::alignOf)
            val rows = mutableListOf<List<List<MdInline>>>()
            var j = start + 2
            while (j < lines.size) {
                val l = lines[j]
                if (l.isBlank() || !l.contains('|')) break
                val t = l.trimStart(' ')
                if (t.startsWith(">") || FENCE.matches(t)) break
                val cells = splitRow(l)
                rows += List(cols) { c -> parseInline(cells.getOrElse(c) { "" }) }
                j++
            }
            out += MdBlock.Table(headerCells.map(::parseInline), align, rows)
            return j
        }
    }

    // ---------------------------------------------------------------- inlines

    private val AUTOLINK = Regex("^<((?:https?|mailto|ftp)://[^\\s<>]+|mailto:[^\\s<>]+|[^\\s@<>]+@[^\\s@<>]+\\.[^\\s@<>]+)>")
    private val BR = Regex("^<br\\s*/?>", RegexOption.IGNORE_CASE)
    private val ENTITY = Regex("^&(amp|lt|gt|quot|apos|nbsp|#39);")
    private val ENTITIES = mapOf("amp" to "&", "lt" to "<", "gt" to ">", "quot" to "\"", "apos" to "'", "nbsp" to " ", "#39" to "'")
    private val BARE_URL = Regex("^(?:https?://|www\\.)[^\\s<]+")
    private const val ASCII_PUNCT = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~"

    private fun isPunct(c: Char): Boolean = c in ASCII_PUNCT || when (Character.getType(c).toByte()) {
        Character.CONNECTOR_PUNCTUATION, Character.DASH_PUNCTUATION, Character.START_PUNCTUATION, Character.END_PUNCTUATION,
        Character.INITIAL_QUOTE_PUNCTUATION, Character.FINAL_QUOTE_PUNCTUATION, Character.OTHER_PUNCTUATION,
        Character.MATH_SYMBOL, Character.CURRENCY_SYMBOL, Character.MODIFIER_SYMBOL, Character.OTHER_SYMBOL -> true
        else -> false
    }

    private fun isCjk(c: Char): Boolean = Character.UnicodeScript.of(c.code).let {
        it == Character.UnicodeScript.HAN || it == Character.UnicodeScript.HIRAGANA || it == Character.UnicodeScript.KATAKANA || it == Character.UnicodeScript.HANGUL
    }

    private class Delim(val char: Char, var count: Int, val canOpen: Boolean, val canClose: Boolean) {
        val orig = count
    }

    private class Inlines(val s: String) {
        /** Inline nodes and still-unmatched `*` `_` `~` runs, in order. */
        private val nodes = mutableListOf<Any>()
        private val text = StringBuilder()

        private fun flushText() {
            if (text.isEmpty()) return
            nodes += MdInline.Text(text.toString())
            text.clear()
        }

        private fun emit(node: MdInline) { flushText(); nodes += node }

        fun parse(): List<MdInline> {
            var i = 0
            while (i < s.length) i = step(i)
            flushText()
            processEmphasis()
            return finish(nodes)
        }

        private fun step(i: Int): Int {
            val c = s[i]
            when (c) {
                '\\' -> {
                    if (i + 1 < s.length && s[i + 1] == '\n') { trimTrailingSpaces(); emit(MdInline.LineBreak); return skipSpaces(i + 2) }
                    if (i + 1 < s.length && s[i + 1] in ASCII_PUNCT) { text.append(s[i + 1]); return i + 2 }
                    text.append(c); return i + 1
                }
                '\n' -> { trimTrailingSpaces(); emit(MdInline.LineBreak); return skipSpaces(i + 1) }
                '`' -> {
                    var n = i
                    while (n < s.length && s[n] == '`') n++
                    val run = n - i
                    var j = n
                    while (j < s.length) {
                        if (s[j] == '`') {
                            var k = j
                            while (k < s.length && s[k] == '`') k++
                            if (k - j == run) {
                                var code = s.substring(n, j).replace('\n', ' ')
                                if (code.length >= 2 && code.startsWith(" ") && code.endsWith(" ") && code.isNotBlank()) code = code.substring(1, code.length - 1)
                                emit(MdInline.Code(code))
                                return k
                            }
                            j = k
                        } else j++
                    }
                    text.append(s, i, n); return n
                }
                '!' -> if (i + 1 < s.length && s[i + 1] == '[') link(i + 1)?.let { return it }
                '[' -> link(i)?.let { return it }
                '<' -> {
                    val rest = s.substring(i)
                    AUTOLINK.find(rest)?.let { m ->
                        val target = m.groupValues[1]
                        val url = if (!target.contains("://") && !target.startsWith("mailto:")) "mailto:$target" else target
                        emit(MdInline.Link(url, listOf(MdInline.Text(target.removePrefix("mailto:")))))
                        return i + m.value.length
                    }
                    BR.find(rest)?.let { m -> trimTrailingSpaces(); emit(MdInline.LineBreak); return i + m.value.length }
                }
                '&' -> ENTITY.find(s.substring(i, minOf(s.length, i + 8)))?.let { m ->
                    text.append(ENTITIES.getValue(m.groupValues[1])); return i + m.value.length
                }
                '*', '_', '~' -> return delimiterRun(i)
                'h', 'w' -> if ((s.startsWith("http", i) || s.startsWith("www.", i)) && (i == 0 || s[i - 1].isWhitespace() || s[i - 1] in "(*_~")) {
                    BARE_URL.find(s.substring(i))?.let { m ->
                        var url = m.value
                        while (url.isNotEmpty() && url.last() in "?!.,:;*_~'\"") url = url.dropLast(1)
                        while (url.endsWith(")") && url.count { it == ')' } > url.count { it == '(' }) url = url.dropLast(1)
                        if (url.length > 7) {
                            emit(MdInline.Link(if (url.startsWith("www.")) "http://$url" else url, listOf(MdInline.Text(url))))
                            return i + url.length
                        }
                    }
                }
            }
            text.append(c)
            return i + 1
        }

        private fun trimTrailingSpaces() {
            while (text.isNotEmpty() && text.last() == ' ') text.setLength(text.length - 1)
        }

        private fun skipSpaces(from: Int): Int {
            var j = from
            while (j < s.length && s[j] == ' ') j++
            return j
        }

        /** `[text](url "title")` starting at the `[` at [open]; null when it isn't a link. */
        private fun link(open: Int): Int? {
            var depth = 0
            var j = open
            while (j < s.length) {
                when (s[j]) {
                    '\\' -> j++
                    '[' -> depth++
                    ']' -> { depth--; if (depth == 0) break }
                    '`' -> { val close = s.indexOf('`', j + 1); if (close > 0) j = close }
                }
                j++
            }
            if (j >= s.length || j + 1 >= s.length || s[j + 1] != '(') return null
            var k = j + 2
            var parens = 1
            while (k < s.length) {
                when (s[k]) {
                    '\\' -> k++
                    '(' -> parens++
                    ')' -> { parens--; if (parens == 0) break }
                    '\n' -> return null
                }
                k++
            }
            if (k >= s.length) return null
            val dest = s.substring(j + 2, k).trim().let { d ->
                val url = if (d.startsWith("<")) d.substringAfter('<').substringBefore('>') else d.split(' ').first()
                url
            }
            val label = s.substring(open + 1, j)
            emit(MdInline.Link(dest, parseInline(label)))
            return k + 1
        }

        private fun delimiterRun(i: Int): Int {
            val c = s[i]
            var n = i
            while (n < s.length && s[n] == c) n++
            val count = n - i
            if (c == '~' && count > 2) { text.append(s, i, n); return n }
            val before = if (i == 0) ' ' else s[i - 1]
            val after = if (n >= s.length) ' ' else s[n]
            val bWs = before.isWhitespace(); val aWs = after.isWhitespace()
            val bP = isPunct(before); val aP = isPunct(after)
            // CommonMark flanking, with CJK letters counted as a boundary next to punctuation.
            val left = !aWs && (!aP || bWs || bP || isCjk(before))
            val right = !bWs && (!bP || aWs || aP || isCjk(after))
            val canOpen: Boolean
            val canClose: Boolean
            if (c == '_') {
                canOpen = left && (!right || bP)
                canClose = right && (!left || aP)
            } else {
                canOpen = left
                canClose = right
            }
            flushText()
            nodes += Delim(c, count, canOpen, canClose)
            return n
        }

        private fun processEmphasis() {
            var c = 0
            while (c < nodes.size) {
                val closer = nodes[c]
                if (closer !is Delim || !closer.canClose || closer.count == 0) { c++; continue }
                var found = -1
                var o = c - 1
                while (o >= 0) {
                    val op = nodes[o]
                    if (op is Delim && op.char == closer.char && op.canOpen && op.count > 0) {
                        val ok = if (closer.char == '~') op.count == closer.count
                        else !((op.canClose || closer.canOpen) && (op.orig + closer.orig) % 3 == 0 && !(op.orig % 3 == 0 && closer.orig % 3 == 0))
                        if (ok) { found = o; break }
                    }
                    o--
                }
                if (found < 0) { c++; continue }
                val opener = nodes[found] as Delim
                val use = if (closer.char == '~') closer.count else if (opener.count >= 2 && closer.count >= 2) 2 else 1
                val inner = finish(nodes.subList(found + 1, c).toList())
                val wrapped: MdInline = when {
                    closer.char == '~' -> MdInline.Strike(inner)
                    use == 2 -> MdInline.Strong(inner)
                    else -> MdInline.Emphasis(inner)
                }
                opener.count -= use
                closer.count -= use
                repeat(c - found - 1) { nodes.removeAt(found + 1) }
                nodes.add(found + 1, wrapped)
                c = found + 2
                if (opener.count == 0) { nodes.removeAt(found); c-- }
                if (closer.count == 0) nodes.removeAt(c)
            }
        }

        /** Leftover delimiter runs become text; neighbouring text merges. */
        private fun finish(list: List<Any>): List<MdInline> {
            val result = mutableListOf<MdInline>()
            for (n in list) {
                val node: MdInline = if (n is Delim) MdInline.Text(n.char.toString().repeat(n.count)) else n as MdInline
                if (node is MdInline.Text && node.text.isEmpty()) continue
                val last = result.lastOrNull()
                if (node is MdInline.Text && last is MdInline.Text) result[result.lastIndex] = MdInline.Text(last.text + node.text)
                else result += node
            }
            return result
        }
    }
}
