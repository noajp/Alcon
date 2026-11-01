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

  it('follows a PowerPoint-made placeholder to its layout and master: position, type, bullets, background, theme font', async () => {
    const zip = new JSZip();
    zip.file('ppt/presentation.xml', `<p:presentation ${ns}><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="9525000" cy="5715000"/></p:presentation>`);
    zip.file('ppt/_rels/presentation.xml.rels', '<Relationships><Relationship Id="rId2" Target="slides/slide1.xml"/></Relationships>');
    zip.file('ppt/theme/theme1.xml', `<a:theme ${ns}><a:themeElements><a:clrScheme><a:dk1><a:srgbClr val="111111"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F3864"/></a:dk2><a:lt2><a:srgbClr val="EEEEEE"/></a:lt2><a:accent1><a:srgbClr val="C00000"/></a:accent1></a:clrScheme>`
      + '<a:fontScheme><a:majorFont><a:latin typeface="Georgia"/><a:ea typeface="Yu Mincho"/></a:majorFont><a:minorFont><a:latin typeface="Arial"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>');
    zip.file('ppt/slideMasters/slideMaster1.xml', `<p:sldMaster ${ns}><p:cSld><p:bg><p:bgPr><a:solidFill><a:schemeClr val="lt2"/></a:solidFill></p:bgPr></p:bg><p:spTree>`
      + '<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="476250" y="190500"/><a:ext cx="8572500" cy="952500"/></a:xfrm></p:spPr></p:sp>'
      + '<p:sp><p:nvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="476250" y="1428750"/><a:ext cx="8572500" cy="3810000"/></a:xfrm></p:spPr></p:sp>'
      + '<p:sp><p:spPr><a:xfrm><a:off x="0" y="5524500"/><a:ext cx="9525000" cy="190500"/></a:xfrm><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></p:spPr></p:sp>'
      + '</p:spTree></p:cSld><p:txStyles><p:titleStyle><a:lvl1pPr algn="ctr"><a:defRPr sz="4400" b="1"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill><a:latin typeface="+mj-lt"/><a:ea typeface="+mj-ea"/></a:defRPr></a:lvl1pPr></p:titleStyle>'
      + '<p:bodyStyle><a:lvl1pPr marL="228600"><a:buChar char="▪"/><a:defRPr sz="2800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:defRPr></a:lvl1pPr></p:bodyStyle><p:otherStyle/></p:txStyles></p:sldMaster>');
    zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', '<Relationships><Relationship Id="rId1" Target="../theme/theme1.xml"/></Relationships>');
    zip.file('ppt/slideLayouts/slideLayout1.xml', `<p:sldLayout ${ns}><p:cSld><p:spTree>`
      + '<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="952500" y="381000"/><a:ext cx="7620000" cy="762000"/></a:xfrm></p:spPr></p:sp>'
      + '</p:spTree></p:cSld></p:sldLayout>');
    zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', '<Relationships><Relationship Id="rId1" Target="../slideMasters/slideMaster1.xml"/></Relationships>');
    zip.file('ppt/slides/slide1.xml', `<p:sld ${ns}><p:cSld><p:spTree>`
      + '<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:t>四半期の振り返り</a:t></a:r></a:p></p:txBody></p:sp>'
      + '<p:sp><p:nvSpPr><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr><a:normAutofit fontScale="50000"/></a:bodyPr><a:p><a:r><a:t>売上は前年比 120%</a:t></a:r></a:p></p:txBody></p:sp>'
      + '</p:spTree></p:cSld></p:sld>');
    zip.file('ppt/slides/_rels/slide1.xml.rels', '<Relationships><Relationship Id="rId1" Target="../slideLayouts/slideLayout1.xml"/></Relationships>');

    const deck = await readDeck(await zip.generateAsync({ type: 'arraybuffer' }));
    const [slide] = deck.slides;
    expect(slide.background).toBe('#eeeeee');
    const [band, title, body] = slide.items;
    // The master's own band sits under the slide's content.
    expect(band).toMatchObject({ kind: 'shape', fill: '#c00000', y: 580 });
    // The title takes the layout's position and the master's title style, in the theme's heading font.
    expect(title).toMatchObject({ x: 100, y: 40, w: 800, h: 80, text: { paras: [{ align: 'center', runs: [{ text: '四半期の振り返り', size: 44, bold: true, color: '#1f3864', font: 'Yu Mincho' }] }] } });
    // The body (no layout entry) takes the master's position, bullet and size — halved by shrink-on-overflow.
    expect(body).toMatchObject({ x: 50, y: 150, text: { paras: [{ bullet: '▪', indent: 24, runs: [{ size: 14, color: '#111111' }] }] } });
  });

  it('crops a picture by its source rectangle', async () => {
    const zip = new JSZip();
    zip.file('ppt/presentation.xml', `<p:presentation ${ns}><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="9525000" cy="5715000"/></p:presentation>`);
    zip.file('ppt/_rels/presentation.xml.rels', '<Relationships><Relationship Id="rId2" Target="slides/slide1.xml"/></Relationships>');
    zip.file('ppt/media/image1.png', 'png');
    zip.file('ppt/slides/slide1.xml', `<p:sld ${ns}><p:cSld><p:spTree><p:pic><p:blipFill><a:blip r:embed="rId9"/><a:srcRect l="10000" r="20000"/></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="952500" cy="952500"/></a:xfrm></p:spPr></p:pic></p:spTree></p:cSld></p:sld>`);
    zip.file('ppt/slides/_rels/slide1.xml.rels', '<Relationships><Relationship Id="rId9" Target="../media/image1.png"/></Relationships>');
    const deck = await readDeck(await zip.generateAsync({ type: 'arraybuffer' }));
    expect(deck.slides[0].items[0]).toMatchObject({ kind: 'image', w: 100, crop: { l: 0.1, t: 0, r: 0.2, b: 0 } });
    expect((deck.slides[0].items[0] as { src: string }).src.startsWith('data:image/png;base64,')).toBe(true);
  });
});
