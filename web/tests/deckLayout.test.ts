// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { readDeck } from '@/ActivitySpace/execution/element/deckLayout';

const ns = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';

async function deckOf(slideTree: string): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file('ppt/presentation.xml', `<p:presentation ${ns}><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="9525000" cy="5715000"/></p:presentation>`);
  zip.file('ppt/_rels/presentation.xml.rels', '<Relationships><Relationship Id="rId1" Target="theme/theme1.xml"/><Relationship Id="rId2" Target="slides/slide1.xml"/></Relationships>');
  zip.file('ppt/theme/theme1.xml', `<a:theme ${ns}><a:themeElements><a:clrScheme><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:accent1><a:srgbClr val="4472C4"/></a:accent1></a:clrScheme></a:themeElements></a:theme>`);
  zip.file('ppt/slides/slide1.xml', `<p:sld ${ns}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="F5F5F0"/></a:solidFill></p:bgPr></p:bg><p:spTree>${slideTree}</p:spTree></p:cSld></p:sld>`);
  return zip.generateAsync({ type: 'arraybuffer' });
}

describe('readDeck', () => {
  it('reads the slide size, background, and a filled text box where the deck puts it', async () => {
    const deck = await readDeck(await deckOf(
      '<p:sp><p:spPr><a:xfrm><a:off x="952500" y="476250"/><a:ext cx="1905000" cy="952500"/></a:xfrm><a:prstGeom prst="rect"/><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></p:spPr>'
      + '<p:txBody><a:bodyPr anchor="ctr"/><a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="2400" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ea typeface="Yu Gothic"/></a:rPr><a:t>提案</a:t></a:r></a:p></p:txBody></p:sp>'));
    expect(deck.width).toBe(1000);
    expect(deck.height).toBe(600);
    const [slide] = deck.slides;
    expect(slide.background).toBe('#f5f5f0');
    expect(slide.items[0]).toMatchObject({
      kind: 'shape', geom: 'rect', x: 100, y: 50, w: 200, h: 100, fill: '#4472c4',
      text: { anchor: 'middle', paras: [{ align: 'center', runs: [{ text: '提案', size: 24, bold: true, color: '#ffffff', font: 'Yu Gothic' }] }] },
    });
  });

  it('places a group’s children from its child space onto the slide, and reads lines and tables', async () => {
    const deck = await readDeck(await deckOf(
      '<p:grpSp><p:grpSpPr><a:xfrm><a:off x="952500" y="952500"/><a:ext cx="1905000" cy="1905000"/><a:chOff x="0" y="0"/><a:chExt cx="952500" cy="952500"/></a:xfrm></p:grpSpPr>'
      + '<p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="476250" cy="476250"/></a:xfrm><a:prstGeom prst="ellipse"/></p:spPr></p:sp></p:grpSp>'
      + '<p:cxnSp><p:spPr><a:xfrm flipV="1"><a:off x="0" y="0"/><a:ext cx="952500" cy="0"/></a:xfrm><a:prstGeom prst="line"/><a:ln w="19050"><a:solidFill><a:srgbClr val="333333"/></a:solidFill></a:ln></p:spPr></p:cxnSp>'
      + '<p:graphicFrame><p:xfrm><a:off x="0" y="0"/><a:ext cx="1905000" cy="952500"/></p:xfrm><a:graphic><a:graphicData><a:tbl><a:tblGrid><a:gridCol w="952500"/><a:gridCol w="952500"/></a:tblGrid>'
      + '<a:tr h="476250"><a:tc gridSpan="2"><a:txBody><a:p><a:r><a:t>見出し</a:t></a:r></a:p></a:txBody><a:tcPr><a:solidFill><a:srgbClr val="EEEEEE"/></a:solidFill></a:tcPr></a:tc><a:tc hMerge="1"/></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>'));
    const [ellipse, line, table] = deck.slides[0].items;
    expect(ellipse).toMatchObject({ kind: 'shape', geom: 'ellipse', x: 100, y: 100, w: 100, h: 100 });
    expect(line).toMatchObject({ kind: 'shape', geom: 'line', flipV: true, stroke: { color: '#333333', width: 2 } });
    expect(table).toMatchObject({ kind: 'table', cols: [100, 100], rows: [{ h: 50, cells: [{ span: 2, fill: '#eeeeee', skip: false }, { skip: true }] }] });
  });
});
