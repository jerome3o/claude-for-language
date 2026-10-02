package dev.jeromeswannack.chineselearning.lab.core

import dev.jeromeswannack.chineselearning.lab.core.calls.CallConnection
import kotlinx.serialization.json.JsonPrimitive
import org.w3c.dom.Document
import org.w3c.dom.Element
import org.xml.sax.InputSource
import java.io.StringReader
import javax.xml.parsers.DocumentBuilderFactory

/**
 * Port of frontend/src/services/materials/pptx.ts (`readPptx`, `slideText`, `resolvePath`) — PowerPoint
 * (.pptx) → slide models, on the device (lesson materials, calls round 4 PR 5). A .pptx is a zip of XML:
 * each slide's text boxes (position, size, font size, bold, colour, bullets), its pictures (PNG / JPEG /
 * GIF / WebP — EMF / WMF skipped), tables' text, the background colour and the speaker notes. The app's
 * `SlideDrawer` paints a model onto an Android Canvas (web `drawSlide`). An approximation, so the material
 * carries [Materials.PPTX_RENDER_NOTE].
 *
 * Positions are in EMU of the slide size. The web module needs a DOM, so it is not run by the parity
 * generator: `PptxSlidesTest` checks this port against the same deck as the web's pptx.test.ts.
 */
object PptxSlides {
    data class Run(val text: String, val size: Double, val bold: Boolean, val color: String?)
    data class Paragraph(val runs: List<Run>, val bullet: Boolean, val level: Int, val align: String) {
        val text: String get() = runs.joinToString("") { it.text }
    }

    sealed interface Shape { val x: Double; val y: Double; val w: Double; val h: Double }
    data class TextBox(override val x: Double, override val y: Double, override val w: Double, override val h: Double, val placeholder: String?, val paragraphs: List<Paragraph>) : Shape
    data class Picture(override val x: Double, override val y: Double, override val w: Double, override val h: Double, val path: String) : Shape

    data class Slide(val index: Int, val width: Double, val height: Double, val background: String?, val shapes: List<Shape>, val notes: String)

    class NotAPowerPoint : IllegalArgumentException("This isn’t a PowerPoint file (no ppt/presentation.xml)")

    private data class Rel(val target: String, val type: String)

    private fun parse(xml: String): Document {
        val f = DocumentBuilderFactory.newInstance()
        f.isNamespaceAware = false
        runCatching { f.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true) }
        runCatching { f.setFeature("http://xml.org/sax/features/external-general-entities", false) }
        f.isExpandEntityReferences = false
        return f.newDocumentBuilder().parse(InputSource(StringReader(xml)))
    }

    private fun localOf(el: Element) = el.nodeName.substringAfterLast(':')
    private fun children(el: Element?): List<Element> {
        if (el == null) return emptyList()
        val out = ArrayList<Element>()
        val nodes = el.childNodes
        for (i in 0 until nodes.length) (nodes.item(i) as? Element)?.let(out::add)
        return out
    }
    private fun kids(el: Element?, name: String) = children(el).filter { localOf(it) == name }
    private fun kid(el: Element?, name: String) = kids(el, name).firstOrNull()
    /** Descendants (not the element itself) with this local name, in document order. */
    private fun all(el: Element?, name: String): List<Element> {
        if (el == null) return emptyList()
        val nodes = el.getElementsByTagName("*")
        val out = ArrayList<Element>()
        for (i in 0 until nodes.length) { val e = nodes.item(i) as Element; if (localOf(e) == name) out += e }
        return out
    }
    private fun attr(el: Element?, name: String): String? = el?.takeIf { it.hasAttribute(name) }?.getAttribute(name)
    /** An r:… attribute (relationship id). */
    private fun rAttr(el: Element?, name: String): String? = attr(el, "r:$name") ?: attr(el, "rel-$name")
    /** JS `v && Number.isFinite(Number(v)) ? Number(v) : d`. */
    private fun num(v: String?, d: Double = 0.0): Double {
        if (v.isNullOrEmpty()) return d
        val n = CallConnection.jsNumber(JsonPrimitive(v))
        return if (n.isFinite()) n else d
    }

    /** `resolvePath`: "../media/image1.png" against "ppt/slides/slide1.xml". */
    fun resolvePath(base: String, target: String): String {
        if (target.startsWith("/")) return target.substring(1)
        val parts = base.split("/").dropLast(1).toMutableList()
        for (seg in target.split("/")) {
            if (seg == "..") { if (parts.isNotEmpty()) parts.removeAt(parts.size - 1) } else if (seg != ".") parts += seg
        }
        return parts.joinToString("/")
    }

    private fun rels(files: (String) -> String?, partPath: String): Map<String, Rel> {
        val dir = partPath.split("/").dropLast(1).joinToString("/")
        val xml = files("$dir/_rels/${partPath.split("/").last()}.rels") ?: return emptyMap()
        val out = LinkedHashMap<String, Rel>()
        val nodes = parse(xml).getElementsByTagName("Relationship")
        for (i in 0 until nodes.length) {
            val r = nodes.item(i) as Element
            out[r.getAttribute("Id")] = Rel(resolvePath(partPath, r.getAttribute("Target")), r.getAttribute("Type"))
        }
        return out
    }

    private val HEX6 = Regex("[0-9a-fA-F]{6}")
    private fun color(el: Element?): String? {
        val v = attr(all(el, "srgbClr").firstOrNull(), "val")
        return if (v != null && HEX6.matches(v)) "#$v" else null
    }

    private data class Box(val x: Double, val y: Double, val w: Double, val h: Double)

    private fun boxOf(x: Element?): Box? {
        val off = kid(x, "off")
        val ext = kid(x, "ext")
        if (off == null || ext == null) return null
        return Box(num(attr(off, "x")), num(attr(off, "y")), num(attr(ext, "cx")), num(attr(ext, "cy")))
    }

    private fun xfrm(spPr: Element?): Box? = boxOf(kid(spPr, "xfrm"))

    private fun paragraphs(txBody: Element?, isBody: Boolean): List<Paragraph> {
        val out = ArrayList<Paragraph>()
        for (p in kids(txBody, "p")) {
            val pPr = kid(p, "pPr")
            val defSize = num(attr(kid(pPr, "defRPr"), "sz"), 0.0)
            val runs = ArrayList<Run>()
            for (r in children(p)) {
                if (localOf(r) == "br") { runs += Run("\n", 18.0, false, null); continue }
                if (localOf(r) != "r" && localOf(r) != "fld") continue
                val rPr = kid(r, "rPr")
                val t = kid(r, "t")?.textContent ?: ""
                if (t.isEmpty()) continue
                val sz = num(attr(rPr, "sz"), defSize)
                runs += Run(t, if (sz != 0.0 && !sz.isNaN()) sz / 100 else 0.0, attr(rPr, "b") == "1", color(rPr))
            }
            val text = runs.joinToString("") { it.text }
            val noBullet = kid(pPr, "buNone") != null
            val hasBullet = kid(pPr, "buChar") != null || kid(pPr, "buAutoNum") != null
            out += Paragraph(
                runs = runs,
                bullet = NoteSearch.jsTrim(text).isNotEmpty() && !noBullet && (hasBullet || isBody),
                level = num(attr(pPr, "lvl")).toInt(),
                align = attr(pPr, "algn") ?: "l",
            )
        }
        return out
    }

    private val SKIP_FOR_BODY = setOf("title", "ctrTitle", "subTitle", "dt", "ftr", "sldNum")
    private val PICTURE = Regex("\\.(png|jpe?g|gif|webp)$", RegexOption.IGNORE_CASE)

    /** Shapes in a tree (groups flattened, their own offsets ignored). */
    private fun shapes(tree: Element?, rel: Map<String, Rel>): List<Shape> {
        val out = ArrayList<Shape>()
        for (el in children(tree)) {
            when (localOf(el)) {
                "grpSp" -> out += shapes(el, rel)
                "sp" -> {
                    val ph = all(el, "ph").firstOrNull()
                    val phType = if (ph != null) attr(ph, "type") ?: "body" else null
                    val box = xfrm(kid(el, "spPr"))
                    val isBody = phType == "body" || (phType != null && phType !in SKIP_FOR_BODY)
                    if (phType == "dt" || phType == "ftr" || phType == "sldNum") continue
                    val paras = paragraphs(kid(el, "txBody"), isBody)
                    if (paras.none { p -> p.runs.any { NoteSearch.jsTrim(it.text).isNotEmpty() } }) continue
                    out += TextBox(box?.x ?: -1.0, box?.y ?: -1.0, box?.w ?: -1.0, box?.h ?: -1.0, phType, paras)
                }
                "pic" -> {
                    val blip = all(el, "blip").firstOrNull()
                    val target = rel[rAttr(blip, "embed") ?: ""]?.target
                    val box = xfrm(kid(el, "spPr"))
                    if (target != null && box != null && PICTURE.containsMatchIn(target)) out += Picture(box.x, box.y, box.w, box.h, target)
                }
                "graphicFrame" -> {
                    // Tables: their text, one paragraph per row ("cell | cell").
                    val box = boxOf(kid(el, "xfrm"))
                    val rows = all(el, "tr").map { tr -> all(tr, "tc").joinToString(" | ") { tc -> all(tc, "t").joinToString("") { it.textContent ?: "" } } }
                    if (rows.any { NoteSearch.jsTrim(it).isNotEmpty() }) {
                        out += TextBox(box?.x ?: -1.0, box?.y ?: -1.0, box?.w ?: -1.0, box?.h ?: -1.0, null, rows.map { Paragraph(listOf(Run(it, 14.0, false, null)), false, 0, "l") })
                    }
                }
            }
        }
        return out
    }

    private val NOTES_SKIP = setOf("sldImg", "sldNum", "hdr", "ftr", "dt")

    /** `readPptx`: every slide of a presentation, in order. [files] = a zip entry's text by path (null = absent). */
    fun read(files: (String) -> String?): List<Slide> {
        val presXml = files("ppt/presentation.xml") ?: throw NotAPowerPoint()
        val pres = parse(presXml).documentElement
        val sz = all(pres, "sldSz").firstOrNull()
        val width = num(attr(sz, "cx"), 12_192_000.0)
        val height = num(attr(sz, "cy"), 6_858_000.0)
        val presRels = rels(files, "ppt/presentation.xml")
        // `all` skips the element itself; the root is <p:presentation>, never a sldId.
        val order = all(pres, "sldId").mapNotNull { presRels[rAttr(it, "id") ?: ""]?.target }
        val out = ArrayList<Slide>()
        for ((index, path) in order.withIndex()) {
            val xml = files(path) ?: continue
            val doc = parse(xml).documentElement
            val rel = rels(files, path)
            val cSld = if (localOf(doc) == "cSld") doc else all(doc, "cSld").firstOrNull()
            val bg = color(kid(cSld, "bg"))
            val list = shapes(kid(cSld, "spTree"), rel)
            var notes = ""
            val notesPath = rel.values.firstOrNull { it.type.endsWith("/notesSlide") }?.target
            if (notesPath != null) {
                val nx = files(notesPath)
                if (nx != null) {
                    val nd = parse(nx).documentElement
                    notes = NoteSearch.jsTrim(
                        all(nd, "sp")
                            .filter { sp -> attr(all(sp, "ph").firstOrNull(), "type") !in NOTES_SKIP }
                            .joinToString("\n") { sp -> all(sp, "p").joinToString("\n") { p -> all(p, "t").joinToString("") { it.textContent ?: "" } } },
                    )
                }
            }
            out += Slide(index, width, height, bg, list, notes)
        }
        return out
    }

    /** `slideText`: a slide's text, top to bottom (the page text agents read). */
    fun slideText(s: Slide): String {
        val texts = s.shapes.filterIsInstance<TextBox>().sortedWith(
            compareBy<TextBox> { if (it.y < 0) 0.0 else it.y }.thenBy { if (it.x < 0) 0.0 else it.x },
        )
        return NoteSearch.jsTrim(texts.joinToString("\n") { t -> t.paragraphs.joinToString("\n") { p -> (if (p.bullet) "• " else "") + p.text } })
    }
}
