package dev.jeromeswannack.chineselearning.lab.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs

/** The same deck as frontend/src/services/materials/pptx.test.ts: the Kotlin port reads it the same way. */
class PptxSlidesTest {
    private val ns = """xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships""""
    private val relns = """xmlns="http://schemas.openxmlformats.org/package/2006/relationships""""

    private fun deck(): Map<String, String> = mapOf(
        "ppt/presentation.xml" to """<p:presentation $ns><p:sldIdLst><p:sldId id="257" r:id="rId3"/><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>""",
        "ppt/_rels/presentation.xml.rels" to """<Relationships $relns><Relationship Id="rId2" Type="x/slide" Target="slides/slide1.xml"/><Relationship Id="rId3" Type="x/slide" Target="slides/slide2.xml"/></Relationships>""",
        "ppt/slides/slide2.xml" to """<p:sld $ns><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFF7ED"/></a:solidFill></p:bgPr></p:bg><p:spTree>
    <p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:p><a:r><a:rPr sz="4400" b="1"/><a:t>第五课：把字句</a:t></a:r></a:p></p:txBody></p:sp>
    <p:sp><p:nvSpPr><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="600000" y="1600000"/><a:ext cx="11000000" cy="4000000"/></a:xfrm></p:spPr><p:txBody>
      <a:p><a:r><a:rPr sz="2400"/><a:t>我把作业做完了。</a:t></a:r></a:p>
      <a:p><a:pPr lvl="1"/><a:r><a:t>把 + object + verb + result</a:t></a:r></a:p>
      <a:p><a:pPr><a:buNone/></a:pPr><a:r><a:t>No bullet here</a:t></a:r></a:p>
    </p:txBody></p:sp>
    <p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>2</a:t></a:r></a:p></p:txBody></p:sp>
    <p:pic><p:blipFill><a:blip r:embed="rId5"/></p:blipFill><p:spPr><a:xfrm><a:off x="9000000" y="300000"/><a:ext cx="2000000" cy="1500000"/></a:xfrm></p:spPr></p:pic>
    <p:pic><p:blipFill><a:blip r:embed="rId6"/></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="10" cy="10"/></a:xfrm></p:spPr></p:pic>
  </p:spTree></p:cSld></p:sld>""",
        "ppt/slides/_rels/slide2.xml.rels" to """<Relationships $relns><Relationship Id="rId5" Type="x/image" Target="../media/image1.png"/><Relationship Id="rId6" Type="x/image" Target="../media/image2.emf"/><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>""",
        "ppt/notesSlides/notesSlide1.xml" to """<p:notes $ns><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr></p:sp><p:sp><p:nvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Ask for three examples</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>""",
        "ppt/slides/slide1.xml" to """<p:sld $ns><p:cSld><p:spTree><p:graphicFrame><p:xfrm><a:off x="100" y="100"/><a:ext cx="1000" cy="1000"/></p:xfrm><a:graphic><a:graphicData><a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>把</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>bǎ</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>""",
    )

    @Test fun readsSlidesInOrderWithTextBulletsPicturesBackgroundAndNotes() {
        val d = deck()
        val slides = PptxSlides.read { d[it] }
        assertEquals(2, slides.size)
        val (first, second) = slides
        assertEquals("#FFF7ED", first.background)
        assertEquals(12192000.0, first.width)
        assertEquals("Ask for three examples", first.notes)
        // The slide number placeholder is left out; the picture in EMF is skipped.
        assertEquals(listOf("text", "text", "picture"), first.shapes.map { if (it is PptxSlides.Picture) "picture" else "text" })
        val pic = first.shapes[2]
        assertIs<PptxSlides.Picture>(pic)
        assertEquals("ppt/media/image1.png", pic.path)
        assertEquals(9000000.0, pic.x)
        val body = first.shapes[1] as PptxSlides.TextBox
        assertEquals(listOf(true to 0, true to 1, false to 0), body.paragraphs.map { it.bullet to it.level })
        assertEquals(24.0, body.paragraphs[0].runs[0].size)
        assertEquals("第五课：把字句\n• 我把作业做完了。\n• 把 + object + verb + result\nNo bullet here", PptxSlides.slideText(first))
        assertEquals("把 | bǎ", PptxSlides.slideText(second))
        // The title had no xfrm: -1 (its box comes from the layout's fallback when drawn).
        assertEquals(-1.0, (first.shapes[0] as PptxSlides.TextBox).w)
    }

    @Test fun resolvesRelationshipTargets() {
        assertEquals("ppt/media/image1.png", PptxSlides.resolvePath("ppt/slides/slide1.xml", "../media/image1.png"))
        assertEquals("ppt/slides/slide1.xml", PptxSlides.resolvePath("ppt/presentation.xml", "slides/slide1.xml"))
        assertEquals("ppt/media/x.png", PptxSlides.resolvePath("ppt/slides/slide1.xml", "/ppt/media/x.png"))
    }

    @Test fun saysPlainlyWhenNotAPowerPoint() {
        val e = assertFailsWith<PptxSlides.NotAPowerPoint> { PptxSlides.read { null } }
        assertEquals("This isn’t a PowerPoint file (no ppt/presentation.xml)", e.message)
    }
}
