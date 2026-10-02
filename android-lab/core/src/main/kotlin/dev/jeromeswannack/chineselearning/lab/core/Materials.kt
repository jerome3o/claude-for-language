package dev.jeromeswannack.chineselearning.lab.core

import dev.jeromeswannack.chineselearning.lab.core.calls.CallConnection
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Port of shared/materials/index.ts — lesson materials (calls round 4, PR 5): a tutor's PDFs, pictures and
 * PowerPoints. The uploader's device renders every page to a picture (web services/materials/render.ts;
 * the Lab app data/materials/MaterialRenderer.kt), so viewers and calls only ever show pictures.
 * Parity-tested (parity/fixtures/materials.ts → MaterialsParityTest).
 */
object Materials {
    enum class Kind(val wire: String) {
        PDF("pdf"), IMAGE("image"), PPTX("pptx");

        companion object {
            fun of(wire: String?): Kind? = entries.firstOrNull { it.wire == wire }
        }
    }

    /** `MAX_MATERIAL_BYTES`: the original file may be at most this big. */
    const val MAX_MATERIAL_BYTES = 50L * 1024 * 1024
    /** `MAX_PAGE_IMAGE_BYTES`: a rendered page picture. */
    const val MAX_PAGE_IMAGE_BYTES = 8L * 1024 * 1024
    const val MAX_MATERIAL_PAGES = 300
    const val MAX_MATERIAL_TITLE = 120
    const val MAX_PAGE_TEXT = 8_000
    const val MAX_MATERIAL_TEXT = 200_000
    /** `MATERIAL_RENDER_WIDTH`: pages are rendered this wide (px) on the uploader's device. */
    const val MATERIAL_RENDER_WIDTH = 1600
    const val PPTX_RENDER_NOTE = "Slides drawn from their text and pictures — for exact slides, export the PowerPoint as PDF and upload that."

    private val EXT_KIND = mapOf(
        "pdf" to Kind.PDF, "pptx" to Kind.PPTX,
        "png" to Kind.IMAGE, "jpg" to Kind.IMAGE, "jpeg" to Kind.IMAGE, "webp" to Kind.IMAGE, "gif" to Kind.IMAGE,
    )
    private val IMAGE_MIME = Regex("image/(png|jpeg|webp|gif)")

    /** JS `(fileName.split('.').pop() ?? '').toLowerCase()`. */
    private fun extOf(fileName: String) = fileName.substringAfterLast('.').lowercase()

    /** `materialKindOf`: what kind a file is, from its name and type; null = not supported (old .ppt, .key, .docx…). */
    fun kindOf(fileName: String, mime: String?): Kind? {
        EXT_KIND[extOf(fileName)]?.let { return it }
        val m = (mime ?: "").lowercase()
        if (m == "application/pdf") return Kind.PDF
        if (m == "application/vnd.openxmlformats-officedocument.presentationml.presentation") return Kind.PPTX
        if (IMAGE_MIME.matches(m)) return Kind.IMAGE
        return null
    }

    /** `materialFileProblem`: why a file can't be added, in plain words (null = fine). */
    fun fileProblem(fileName: String, mime: String?, size: Double): String? {
        val ext = extOf(fileName)
        if (ext == "ppt") return "Old .ppt files can’t be read — save it as .pptx (or PDF) in PowerPoint and upload that."
        if (ext == "key") return "Keynote files can’t be read — export it as PDF and upload that."
        if (kindOf(fileName, mime) == null) return "Upload a PDF, a PowerPoint (.pptx) or a picture (JPEG, PNG, WebP)."
        if (!(size > 0)) return "The file is empty."
        if (size > MAX_MATERIAL_BYTES) return "The file is ${Js.numberToString(Js.round(size / 1024 / 1024))} MB — 50 MB at most."
        return null
    }

    private val LAST_EXT = Regex("\\.[^.]+$")
    private const val JS_WS = "\\t\\n\\u000B\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF"
    private val JS_SPACES = Regex("[$JS_WS]+")
    private val UNDERSCORES = Regex("_+")

    /** JS `String.prototype.slice(0, n)` (UTF-16 units). */
    private fun String.jsSlice(n: Int) = if (length <= n) this else substring(0, n)

    /** `titleFromFileName`: "Lesson 5 – 把字句.pptx" → "Lesson 5 – 把字句". */
    fun titleFromFileName(fileName: String): String {
        // JS `$` (no m flag) is the very end of the string — never before a final newline.
        val noExt = LAST_EXT.find(fileName)?.takeIf { it.range.last == fileName.length - 1 }?.let { fileName.substring(0, it.range.first) } ?: fileName
        val base = NoteSearch.jsTrim(JS_SPACES.replace(UNDERSCORES.replace(noExt, " "), " "))
        return base.ifEmpty { "Untitled" }.jsSlice(MAX_MATERIAL_TITLE)
    }

    /** `cleanMaterialTitle`. */
    fun cleanTitle(raw: JsonElement?): String? {
        val s = (raw as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return null
        val t = NoteSearch.jsTrim(JS_SPACES.replace(s, " ")).jsSlice(MAX_MATERIAL_TITLE)
        return t.ifEmpty { null }
    }

    private val INLINE_SPACES = Regex("[ \\t\\f\\u000B]+")
    private val SPACED_NEWLINE = Regex(" *\\n *")
    private val MANY_NEWLINES = Regex("\\n{3,}")

    /** `cleanPageText`: one page's text as stored — whitespace tidied, bounded. */
    fun cleanPageText(raw: JsonElement?): String {
        val s = (raw as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return ""
        return cleanPageText(s)
    }

    fun cleanPageText(raw: String): String {
        val t = MANY_NEWLINES.replace(SPACED_NEWLINE.replace(INLINE_SPACES.replace(raw, " "), "\n"), "\n\n")
        return NoteSearch.jsTrim(t).jsSlice(MAX_PAGE_TEXT)
    }

    data class PageText(val pageIndex: Int, val text: String?, val notes: String?)

    /** `materialText`: all pages' text for an agent ("— Page 3 —\n…" + speaker notes), bounded. */
    fun materialText(pages: List<PageText>, max: Int = MAX_MATERIAL_TEXT): String {
        val parts = ArrayList<String>()
        for (p in pages.sortedBy { it.pageIndex }) {
            val text = NoteSearch.jsTrim(p.text ?: "")
            val notes = NoteSearch.jsTrim(p.notes ?: "")
            if (text.isEmpty() && notes.isEmpty()) continue
            parts += "— Page ${p.pageIndex + 1} —" + (if (text.isNotEmpty()) "\n$text" else "") + (if (notes.isNotEmpty()) "\n(Speaker notes: $notes)" else "")
        }
        val all = parts.joinToString("\n\n")
        return if (all.length > max) "${all.substring(0, max)}\n[… cut for length …]" else all
    }

    /** `materialTarget`: drawings / text on a material page use the annotation messages with this `target`. */
    fun target(materialId: String, page: Int): String = "material:$materialId:$page"

    private val TARGET = Regex("material:([A-Za-z0-9_-]{1,64}):([0-9]{1,4})")

    data class Target(val materialId: String, val page: Int)

    /** `parseMaterialTarget`. */
    fun parseTarget(raw: String?): Target? {
        val m = TARGET.matchEntire(raw ?: return null) ?: return null
        return Target(m.groupValues[1], m.groupValues[2].toInt())
    }

    /** `turnPage`: the page after a turn, kept inside the material. */
    fun turnPage(page: Double, delta: Double, pageCount: Int): Int {
        if (pageCount <= 0) return 0
        return Math.max(0.0, Math.min((pageCount - 1).toDouble(), Js.round(page + delta))).toInt()
    }

    fun turnPage(page: Int, delta: Int, pageCount: Int): Int = turnPage(page.toDouble(), delta.toDouble(), pageCount)

    private val MATERIAL_ID = Regex("[A-Za-z0-9_-]{1,64}")

    /** `sanitizePresented`: what the call room says is being presented (null = nothing / malformed). */
    fun sanitizePresented(raw: JsonElement?): PresentedMaterial? {
        val r = raw as? JsonObject ?: return null
        val id = (r["material_id"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return null
        if (!MATERIAL_ID.matches(id)) return null
        val count = CallConnection.jsNumber(r["page_count"])
        val page = CallConnection.jsNumber(r["page"])
        if (!count.isFinite() || count != Math.floor(count) || count < 1 || count > MAX_MATERIAL_PAGES) return null
        fun str(k: String) = (r[k] as? JsonPrimitive)?.takeIf { it.isString }?.content
        return PresentedMaterial(
            materialId = id,
            title = str("title")?.jsSlice(MAX_MATERIAL_TITLE) ?: "",
            page = turnPage(if (page.isFinite()) page else 0.0, 0.0, count.toInt()),
            pageCount = count.toInt(),
            by = str("by") ?: "",
            byName = str("by_name")?.jsSlice(80) ?: "",
        )
    }
}

/** `PresentedMaterial`: what the call room says is being presented. [by] / [byName] = who opened it. */
data class PresentedMaterial(
    val materialId: String,
    val title: String,
    val page: Int,
    val pageCount: Int,
    val by: String,
    val byName: String,
) {
    /** The annotation target of the page on show. */
    val target: String get() = Materials.target(materialId, page)

    fun toJson() = buildJsonObject {
        put("material_id", materialId); put("title", title); put("page", page); put("page_count", pageCount); put("by", by); put("by_name", byName)
    }
}
