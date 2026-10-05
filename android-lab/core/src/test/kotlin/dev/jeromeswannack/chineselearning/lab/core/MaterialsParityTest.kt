package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/** Calls round 4 PR 5: lesson materials reproduce shared/materials/index.ts exactly (parity/fixtures/materials.ts). */
class MaterialsParityTest {
    private val root: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "materials.json").readText()).jsonObject
    }

    private fun str(e: JsonElement?): String? = e?.takeIf { it !is JsonNull }?.jsonPrimitive?.content
    private fun JsonObject.arr(k: String) = this[k]!!.jsonArray.map { it.jsonObject }

    @Test fun constants() {
        val c = root["constants"]!!.jsonObject
        assertEquals(c["MAX_MATERIAL_BYTES"]!!.jsonPrimitive.long, Materials.MAX_MATERIAL_BYTES)
        assertEquals(c["MAX_PAGE_IMAGE_BYTES"]!!.jsonPrimitive.long, Materials.MAX_PAGE_IMAGE_BYTES)
        assertEquals(c["MAX_MATERIAL_PAGES"]!!.jsonPrimitive.int, Materials.MAX_MATERIAL_PAGES)
        assertEquals(c["MAX_MATERIAL_TITLE"]!!.jsonPrimitive.int, Materials.MAX_MATERIAL_TITLE)
        assertEquals(c["MAX_PAGE_TEXT"]!!.jsonPrimitive.int, Materials.MAX_PAGE_TEXT)
        assertEquals(c["MATERIAL_RENDER_WIDTH"]!!.jsonPrimitive.int, Materials.MATERIAL_RENDER_WIDTH)
        assertEquals(str(c["PPTX_RENDER_NOTE"]), Materials.PPTX_RENDER_NOTE)
        assertEquals(c["MAX_TOC_ENTRIES"]!!.jsonPrimitive.int, MaterialToc.MAX_TOC_ENTRIES)
        assertEquals(c["MAX_TOC_TITLE"]!!.jsonPrimitive.int, MaterialToc.MAX_TOC_TITLE)
        assertEquals(str(c["CONTENTS_LABEL"]), MaterialToc.CONTENTS_LABEL)
    }

    private fun entries(e: JsonElement?): List<MaterialToc.Entry>? = (e as? kotlinx.serialization.json.JsonArray)?.map {
        val o = it.jsonObject
        MaterialToc.Entry(str(o["title"])!!, o["page"]!!.jsonPrimitive.int, o["level"]!!.jsonPrimitive.int)
    }

    private fun pageTexts(e: JsonElement?) = e!!.jsonArray.map { val p = it.jsonObject; MaterialToc.PageText(p["page_index"]!!.jsonPrimitive.int, str(p["text"])) }

    /** Round 6: a material's Contents (shared/materials/toc.ts). */
    @Test fun contents() {
        val t = root["toc"]!!.jsonObject
        for (o in t.arr("clean")) assertEquals(str(o["title"]), MaterialToc.cleanTitle(o["raw"]), "clean toc title $o")
        val cases = t.arr("cases")
        assertTrue(cases.size > 100)
        for (o in cases) {
            val count = o["page_count"]!!.jsonPrimitive.int
            val pages = pageTexts(o["pages"])
            assertEquals(entries(o["sanitized"]), MaterialToc.sanitize(o["raw"], count), "sanitize $o")
            val want = o["contents"]!!.jsonObject
            val got = MaterialToc.contents(o["raw"], count, pages)
            assertEquals(entries(want["entries"]), got.entries, "contents $o")
            assertEquals(str(want["source"]), got.source.wire, "contents source $o")
            assertEquals(entries(o["page_list"]), MaterialToc.pageListToc(count, pages), "page list $o")
        }
        for (o in t.arr("first_lines")) assertEquals(str(o["first"]), MaterialToc.firstLineOf(str(o["text"])), "first line $o")
        for (o in t.arr("slide_titles")) {
            val titles = o["titles"]!!.jsonArray.map { str(it) }
            assertEquals(entries(o["toc"]), MaterialToc.slideTitlesToc(titles), "slide titles $o")
        }
        for (o in t.arr("current")) {
            assertEquals(o["index"]!!.jsonPrimitive.int, MaterialToc.currentIndex(entries(o["entries"])!!, o["page"]!!.jsonPrimitive.int), "current $o")
        }
    }

    @Test fun kindsAndProblems() {
        val kinds = root.arr("kinds")
        assertTrue(kinds.size > 300)
        for (o in kinds) assertEquals(str(o["kind"]), Materials.kindOf(str(o["name"])!!, str(o["mime"]))?.wire, "kind $o")
        val problems = root.arr("problems")
        assertTrue(problems.size > 3000)
        for (o in problems) {
            val sizeEl = o["size"]!!.jsonPrimitive
            val size = if (sizeEl.isString) Double.NaN else sizeEl.double
            assertEquals(str(o["problem"]), Materials.fileProblem(str(o["name"])!!, str(o["mime"]), size), "problem $o")
        }
    }

    @Test fun titlesAndText() {
        for (o in root.arr("titles")) assertEquals(str(o["title"]), Materials.titleFromFileName(str(o["name"])!!), "title $o")
        for (o in root.arr("clean_titles")) assertEquals(str(o["title"]), Materials.cleanTitle(o["raw"]), "clean title $o")
        for (o in root.arr("page_texts")) assertEquals(str(o["text"]), Materials.cleanPageText(o["raw"]), "page text $o")
        for (o in root.arr("text_cases")) {
            val pages = o["pages"]!!.jsonArray.map { val p = it.jsonObject; Materials.PageText(p["page_index"]!!.jsonPrimitive.int, str(p["text"]), str(p["notes"])) }
            assertEquals(str(o["text"]), Materials.materialText(pages, o["max"]!!.jsonPrimitive.int), "material text $o")
        }
    }

    @Test fun targetsAndTurns() {
        for (o in root.arr("targets")) assertEquals(str(o["target"]), Materials.target(str(o["id"])!!, o["page"]!!.jsonPrimitive.int))
        for (o in root.arr("parsed")) {
            val raw = o["raw"]!!.let { if (it is JsonNull || !it.jsonPrimitive.isString) null else it.jsonPrimitive.content }
            val want = (o["parsed"] as? JsonObject)?.let { Materials.Target(str(it["materialId"])!!, it["page"]!!.jsonPrimitive.int) }
            assertEquals(want, Materials.parseTarget(raw), "parse $o")
        }
        val turns = root.arr("turns")
        assertTrue(turns.size >= 300)
        for (o in turns) {
            assertEquals(o["result"]!!.jsonPrimitive.int, Materials.turnPage(o["page"]!!.jsonPrimitive.double, o["delta"]!!.jsonPrimitive.double, o["count"]!!.jsonPrimitive.int), "turn $o")
        }
    }

    @Test fun presented() {
        for (o in root.arr("presented")) {
            val want = (o["presented"] as? JsonObject)?.let {
                PresentedMaterial(str(it["material_id"])!!, str(it["title"])!!, it["page"]!!.jsonPrimitive.int, it["page_count"]!!.jsonPrimitive.int, str(it["by"])!!, str(it["by_name"])!!)
            }
            val got = Materials.sanitizePresented(o["raw"])
            assertEquals(want, got, "presented $o")
            // What the Lab app would send back reads the same.
            if (got != null) assertEquals(got, Materials.sanitizePresented(got.toJson()))
        }
    }
}
