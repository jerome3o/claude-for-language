import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { readPptx, resolvePath, slideText, slideTitle } from './pptx';

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const RELNS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';

async function deck(): Promise<JSZip> {
  const zip = new JSZip();
  zip.file('ppt/presentation.xml', `<p:presentation ${NS}><p:sldIdLst><p:sldId id="257" r:id="rId3"/><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`);
  zip.file('ppt/_rels/presentation.xml.rels', `<Relationships ${RELNS}><Relationship Id="rId2" Type="x/slide" Target="slides/slide1.xml"/><Relationship Id="rId3" Type="x/slide" Target="slides/slide2.xml"/></Relationships>`);
  // Slide 2 is FIRST in the order.
  zip.file('ppt/slides/slide2.xml', `<p:sld ${NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFF7ED"/></a:solidFill></p:bgPr></p:bg><p:spTree>
    <p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:p><a:r><a:rPr sz="4400" b="1"/><a:t>第五课：把字句</a:t></a:r></a:p></p:txBody></p:sp>
    <p:sp><p:nvSpPr><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="600000" y="1600000"/><a:ext cx="11000000" cy="4000000"/></a:xfrm></p:spPr><p:txBody>
      <a:p><a:r><a:rPr sz="2400"/><a:t>我把作业做完了。</a:t></a:r></a:p>
      <a:p><a:pPr lvl="1"/><a:r><a:t>把 + object + verb + result</a:t></a:r></a:p>
      <a:p><a:pPr><a:buNone/></a:pPr><a:r><a:t>No bullet here</a:t></a:r></a:p>
    </p:txBody></p:sp>
    <p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>2</a:t></a:r></a:p></p:txBody></p:sp>
    <p:pic><p:blipFill><a:blip r:embed="rId5"/></p:blipFill><p:spPr><a:xfrm><a:off x="9000000" y="300000"/><a:ext cx="2000000" cy="1500000"/></a:xfrm></p:spPr></p:pic>
    <p:pic><p:blipFill><a:blip r:embed="rId6"/></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="10" cy="10"/></a:xfrm></p:spPr></p:pic>
  </p:spTree></p:cSld></p:sld>`);
  zip.file('ppt/slides/_rels/slide2.xml.rels', `<Relationships ${RELNS}><Relationship Id="rId5" Type="x/image" Target="../media/image1.png"/><Relationship Id="rId6" Type="x/image" Target="../media/image2.emf"/><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>`);
  zip.file('ppt/notesSlides/notesSlide1.xml', `<p:notes ${NS}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr></p:sp><p:sp><p:nvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Ask for three examples</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`);
  zip.file('ppt/slides/slide1.xml', `<p:sld ${NS}><p:cSld><p:spTree><p:graphicFrame><p:xfrm><a:off x="100" y="100"/><a:ext cx="1000" cy="1000"/></p:xfrm><a:graphic><a:graphicData><a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>把</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>bǎ</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>`);
  return zip;
}

describe('pptx → slides', () => {
  it('reads the slides in presentation order with text, bullets, pictures, background and speaker notes', async () => {
    const slides = await readPptx(await deck());
    expect(slides).toHaveLength(2);
    const [first, second] = slides;
    expect(first.background).toBe('#FFF7ED');
    expect(first.width).toBe(12192000);
    expect(first.notes).toBe('Ask for three examples');
    // The slide number placeholder is left out; the picture in EMF is skipped.
    expect(first.shapes.map((s) => s.kind)).toEqual(['text', 'text', 'picture']);
    expect(first.shapes[2]).toMatchObject({ kind: 'picture', path: 'ppt/media/image1.png', x: 9000000 });
    const body = first.shapes[1];
    expect(body.kind === 'text' && body.paragraphs.map((p) => [p.bullet, p.level])).toEqual([[true, 0], [true, 1], [false, 0]]);
    expect(body.kind === 'text' && body.paragraphs[0].runs[0].size).toBe(24);
    expect(slideText(first)).toBe('第五课：把字句\n• 我把作业做完了。\n• 把 + object + verb + result\nNo bullet here');
    // Tables: their cells' text.
    expect(slideText(second)).toBe('把 | bǎ');
    // Contents: the title placeholder's text; a slide without one has none.
    expect(slides.map(slideTitle)).toEqual(['第五课：把字句', '']);
  });

  it('resolves relationship targets', () => {
    expect(resolvePath('ppt/slides/slide1.xml', '../media/image1.png')).toBe('ppt/media/image1.png');
    expect(resolvePath('ppt/presentation.xml', 'slides/slide1.xml')).toBe('ppt/slides/slide1.xml');
    expect(resolvePath('ppt/slides/slide1.xml', '/ppt/media/x.png')).toBe('ppt/media/x.png');
  });

  it('says plainly when the file is not a PowerPoint', async () => {
    await expect(readPptx(new JSZip())).rejects.toThrow(/isn’t a PowerPoint/);
  });
});
