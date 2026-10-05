package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * Port of shared/materials/toc.ts — a material's Contents (round 6): the list both people open in a call
 * (and on the material viewer) to jump to a section. The server stores what the uploader's device read
 * (`materials.toc`: the PDF outline via pdf.js on the web, PowerPoint slide titles — [slideTitlesToc], also
 * here); nothing stored (older materials, a PDF without an outline, a PDF uploaded from this phone —
 * Android's PdfRenderer can't read outlines) → one row per page with its first line ([pageListToc]).
 * `outlineToToc` is web-only (pdf.js). Parity-tested (parity/fixtures/materials.ts → MaterialsParityTest).
 */
object MaterialToc {
    data class Entry(val title: String, val page: Int, val level: Int)

    enum class Source(val wire: String) { OUTLINE("outline"), PAGES("pages") }

    data class Contents(val entries: List<Entry>, val source: Source)

    const val MAX_TOC_ENTRIES = 200
    const val MAX_TOC_TITLE = 100
    const val CONTENTS_LABEL = "Contents"

    private const val JS_WS = "\\t\\n\\u000B\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF"
    private val JS_SPACES = Regex("[$JS_WS]+")
    private val LETTER = Regex("\\p{L}")

    private fun String.jsSlice(n: Int) = if (length <= n) this else substring(0, n)

    /** `cleanTocTitle`: whitespace collapsed, trimmed, bounded ("" = none). */
    fun cleanTitle(raw: String?): String = if (raw == null) "" else NoteSearch.jsTrim(JS_SPACES.replace(raw, " ")).jsSlice(MAX_TOC_TITLE)

    fun cleanTitle(raw: JsonElement?): String = cleanTitle((raw as? JsonPrimitive)?.takeIf { it.isString }?.content)

    /** JS `typeof x === 'number'` for a JSON value (null when it isn't one). */
    private fun jsonNumber(el: JsonElement?): Double? {
        val p = el as? JsonPrimitive ?: return null
        if (p.isString || p.content == "true" || p.content == "false" || p.content == "null") return null
        return p.content.toDoubleOrNull()
    }

    private fun isPage(page: Double?, pageCount: Int): Boolean =
        page != null && page.isFinite() && page == Math.floor(page) && page >= 0 && page < pageCount

    /** `slideTitlesToc`: a PowerPoint's slide titles ("" = none) → entries. */
    fun slideTitlesToc(titles: List<String?>): List<Entry> {
        val out = ArrayList<Entry>()
        for ((i, t) in titles.withIndex()) {
            if (out.size >= MAX_TOC_ENTRIES) break
            val title = cleanTitle(t)
            if (title.isNotEmpty()) out += Entry(title, i, 0)
        }
        return out
    }

    /** `sanitizeToc`: stored / sent Contents, checked (null = not a list at all). */
    fun sanitize(raw: JsonElement?, pageCount: Int): List<Entry>? {
        val arr = raw as? JsonArray ?: return null
        val out = ArrayList<Entry>()
        for (r in arr) {
            if (out.size >= MAX_TOC_ENTRIES) break
            val o = r as? JsonObject ?: continue
            val title = cleanTitle(o["title"])
            val page = jsonNumber(o["page"])
            if (title.isEmpty() || !isPage(page, pageCount)) continue
            val level = jsonNumber(o["level"])
            out += Entry(title, page!!.toInt(), if (level != null && level >= 1) 1 else 0)
        }
        return out
    }

    /** `firstLineOf`: a page's first line with a letter in it (skips page numbers / rules), "" when none. */
    fun firstLineOf(text: String?): String {
        for (line in (text ?: "").split('\n')) {
            val t = cleanTitle(line)
            if (t.isNotEmpty() && LETTER.containsMatchIn(t)) return t
        }
        return ""
    }

    data class PageText(val pageIndex: Int, val text: String?)

    /** `pageListToc`: one row per page — its first line of text, else "Page N". */
    fun pageListToc(pageCount: Int, pages: List<PageText>): List<Entry> {
        val text = HashMap<Int, String>()
        for (p in pages) if (!text.containsKey(p.pageIndex)) text[p.pageIndex] = p.text ?: ""
        val n = Math.min(Math.max(0, pageCount), Materials.MAX_MATERIAL_PAGES)
        return (0 until n).map { i -> Entry(firstLineOf(text[i]).ifEmpty { "Page ${i + 1}" }, i, 0) }
    }

    /** `materialContents`: the stored outline when it has entries, else the page list. */
    fun contents(toc: JsonElement?, pageCount: Int, pages: List<PageText>): Contents {
        val outline = sanitize(toc, pageCount)
        if (!outline.isNullOrEmpty()) return Contents(outline, Source.OUTLINE)
        return Contents(pageListToc(pageCount, pages), Source.PAGES)
    }

    /** `currentTocIndex`: the entry for the page on show — the last one at or before it (-1 = before the first). */
    fun currentIndex(entries: List<Entry>, page: Int): Int {
        var best = -1
        for (i in entries.indices) {
            if (entries[i].page <= page && (best < 0 || entries[i].page >= entries[best].page)) best = i
        }
        return best
    }
}
