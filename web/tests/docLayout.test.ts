// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { readDocLayout, type DocPara, type DocTable } from '@/Function/office/docLayout';

const w = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

async function docx(body: string, extra: Record<string, string | Uint8Array> = {}) {
  const zip = new JSZip();
  zip.file('word/document.xml', `<w:document ${w}><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1080" w:bottom="1440" w:left="1080"/></w:sectPr></w:body></w:document>`);
  zip.file('word/styles.xml', `<w:styles ${w}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:eastAsiaTheme="minorEastAsia"/><w:sz w:val="21"/></w:rPr></w:rPrDefault></w:docDefaults>`
    + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="120"/></w:pPr></w:style>'
    + '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="240"/><w:jc w:val="center"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/><w:color w:val="2F5496"/></w:rPr></w:style></w:styles>');
  zip.file('word/theme/theme1.xml', '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:fontScheme><a:majorFont><a:latin typeface="Calibri Light"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface="Yu Mincho"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>');
  for (const [k, v] of Object.entries(extra)) zip.file(k, v);
  return readDocLayout(await zip.generateAsync({ type: 'arraybuffer' }));
}

describe('readDocLayout', () => {
  it('reads the page, a heading through its style chain, and theme fonts', async () => {
    const doc = await docx('<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>概要</w:t></w:r></w:p><w:p><w:r><w:rPr><w:i/></w:rPr><w:t>本文</w:t></w:r></w:p>');
    expect(doc.width).toBeCloseTo(793.7, 0);
    expect(doc.margin).toEqual({ top: 96, right: 72, bottom: 96, left: 72 });
    const [h, p] = doc.blocks as DocPara[];
    expect(h).toMatchObject({ kind: 'p', align: 'center', before: 16, after: 8, heading: true, runs: [{ text: '概要', bold: true, size: 16, color: '#2f5496', font: 'Yu Mincho' }] });
    expect(p).toMatchObject({ align: 'left', heading: false, runs: [{ text: '本文', italic: true, size: 10.5 }] });
  });

  it('counts numbered lists per level and draws bullets', async () => {
    const numbering = `<w:numbering ${w}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:pPr><w:ind w:left="720"/></w:pPr></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%1.%2)"/></w:lvl></w:abstractNum>`
      + '<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>';
    const item = (num: number, lvl: number, t: string) => `<w:p><w:pPr><w:numPr><w:ilvl w:val="${lvl}"/><w:numId w:val="${num}"/></w:numPr></w:pPr><w:r><w:t>${t}</w:t></w:r></w:p>`;
    const doc = await docx(item(1, 0, 'a') + item(1, 1, 'b') + item(1, 1, 'c') + item(1, 0, 'd') + item(2, 0, 'e'), { 'word/numbering.xml': numbering });
    expect((doc.blocks as DocPara[]).map((b) => b.marker)).toEqual(['1.', '1.a)', '1.b)', '2.', '•']);
    expect((doc.blocks[0] as DocPara).indent).toBe(48);
  });

  it('reads tables with spans and vertical merges, and page breaks', async () => {
    const cell = (t: string, pr = '') => `<w:tc><w:tcPr>${pr}</w:tcPr><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:tc>`;
    const doc = await docx(
      `<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single" w:color="8EAADB"/><w:insideH w:val="single"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="1500"/><w:gridCol w:w="3000"/></w:tblGrid>`
      + `<w:tr>${cell('区分', '<w:vMerge w:val="restart"/><w:shd w:fill="D9E2F3"/>')}${cell('上期')}</w:tr>`
      + `<w:tr>${cell('', '<w:vMerge/>')}${cell('下期')}</w:tr></w:tbl>`
      + '<w:p><w:r><w:br w:type="page"/></w:r></w:p><w:p><w:r><w:t>次</w:t></w:r></w:p>');
    const table = doc.blocks[0] as DocTable;
    expect(table.cols).toEqual([100, 200]);
    expect(table.rows[0][0]).toMatchObject({ fill: '#d9e2f3', rowSpan: 2, skip: false, borders: true, borderColor: '#8eaadb' });
    expect(table.rows[1][0].skip).toBe(true);
    expect(doc.blocks.some((b) => b.kind === 'break')).toBe(true);
  });

  it('reads the header, footer, footnotes, columns, a floating picture and a text box', async () => {
    const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
    const wp = 'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"';
    const zip = new JSZip();
    zip.file('word/document.xml', `<w:document ${w} ${R} ${wp}><w:body>`
      + '<w:p><w:r><w:t>本文</w:t></w:r><w:r><w:footnoteReference w:id="5"/></w:r><w:r><w:t>と続き</w:t></w:r><w:r><w:footnoteReference w:id="2"/></w:r></w:p>'
      + '<w:p><w:r><w:drawing><wp:anchor><wp:positionH relativeFrom="column"><wp:align>right</wp:align></wp:positionH><wp:extent cx="952500" cy="476250"/><a:graphic><a:graphicData><a:blip r:embed="rId9"/></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>'
      + '<w:p><w:r><w:drawing><wp:inline><wp:extent cx="1905000" cy="476250"/><a:graphic><a:graphicData><wps:wsp><wps:txbx><w:txbxContent><w:p><w:r><w:t>囲み</w:t></w:r></w:p></w:txbxContent></wps:txbx></wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>'
      + '<w:sectPr><w:headerReference w:type="default" r:id="rId1"/><w:footerReference w:type="default" r:id="rId2"/><w:pgSz w:w="11906"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/><w:cols w:num="2"/></w:sectPr></w:body></w:document>');
    zip.file('word/_rels/document.xml.rels', '<Relationships><Relationship Id="rId1" Target="header1.xml"/><Relationship Id="rId2" Target="footer1.xml"/><Relationship Id="rId9" Target="media/image1.png"/></Relationships>');
    zip.file('word/media/image1.png', 'png');
    zip.file('word/header1.xml', `<w:hdr ${w}><w:p><w:r><w:t>社外秘</w:t></w:r></w:p></w:hdr>`);
    zip.file('word/footer1.xml', `<w:ftr ${w}><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>- 1 -</w:t></w:r></w:p></w:ftr>`);
    zip.file('word/footnotes.xml', `<w:footnotes ${w}><w:footnote w:id="2"><w:p><w:r><w:t>出典 B</w:t></w:r></w:p></w:footnote><w:footnote w:id="5"><w:p><w:r><w:t>出典 A</w:t></w:r></w:p></w:footnote></w:footnotes>`);
    const doc = await readDocLayout(await zip.generateAsync({ type: 'arraybuffer' }));
    expect(doc.columns).toBe(2);
    expect((doc.header[0] as DocPara).runs[0].text).toBe('社外秘');
    expect(doc.footer[0]).toMatchObject({ align: 'center', runs: [{ text: '- 1 -' }] });
    // Footnotes numbered by first reference: id 5 is 1, id 2 is 2.
    const [p1, p2, p3] = doc.blocks as DocPara[];
    expect(p1.runs.filter((r) => r.script === 'super').map((r) => r.text)).toEqual(['1', '2']);
    expect(doc.footnotes.map((n) => (n[0] as DocPara).runs[0].text)).toEqual(['出典 A', '出典 B']);
    expect(p2.runs[0].image).toMatchObject({ w: 100, h: 50, float: 'right' });
    expect(p3.runs[0].box).toMatchObject({ w: 200, float: null, blocks: [{ runs: [{ text: '囲み' }] }] });
  });

  it('applies a table style: header row bold and shaded, banded rows, borders', async () => {
    const styles = `<w:styles ${w}><w:style w:type="paragraph" w:default="1" w:styleId="Normal"/>`
      + '<w:style w:type="table" w:styleId="GridAccent"><w:tblPr><w:tblBorders><w:top w:val="single" w:color="4472C4"/><w:insideH w:val="single" w:color="4472C4"/></w:tblBorders></w:tblPr>'
      + '<w:tblStylePr w:type="firstRow"><w:rPr><w:b/><w:color w:val="FFFFFF"/></w:rPr><w:tcPr><w:shd w:fill="4472C4"/></w:tcPr></w:tblStylePr>'
      + '<w:tblStylePr w:type="band1Horz"><w:tcPr><w:shd w:fill="D9E2F3"/></w:tcPr></w:tblStylePr></w:style></w:styles>';
    const cell = (t: string) => `<w:tc><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:tc>`;
    const doc = await docx(`<w:tbl><w:tblPr><w:tblStyle w:val="GridAccent"/><w:tblLook w:firstRow="1" w:noHBand="0"/></w:tblPr><w:tblGrid><w:gridCol w:w="1500"/></w:tblGrid>`
      + `<w:tr>${cell('見出し')}</w:tr><w:tr>${cell('1行目')}</w:tr><w:tr>${cell('2行目')}</w:tr></w:tbl>`, { 'word/styles.xml': styles });
    const t = doc.blocks[0] as DocTable;
    expect(t.rows[0][0]).toMatchObject({ fill: '#4472c4', borders: true, borderColor: '#4472c4', blocks: [{ runs: [{ bold: true, color: '#ffffff' }] }] });
    expect(t.rows[1][0].fill).toBe('#d9e2f3');
    expect(t.rows[2][0].fill).toBeNull();
  });

  it('de-obfuscates an embedded font with its key', async () => {
    const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
    const key = '{01234567-89AB-CDEF-0123-456789ABCDEF}';
    const hex = key.replace(/[{}-]/g, '');
    const keyBytes = Array.from({ length: 16 }, (_, i) => parseInt(hex.slice(30 - i * 2, 32 - i * 2), 16));
    const font = new Uint8Array(40).map((_, i) => i);
    const stored = font.map((b, i) => (i < 32 ? b ^ keyBytes[i % 16] : b));
    const doc = await docx('<w:p/>', {
      'word/fontTable.xml': `<w:fonts ${w} ${R}><w:font w:name="Brand Sans"><w:embedRegular r:id="rId1" w:fontKey="${key}"/></w:font></w:fonts>`,
      'word/_rels/fontTable.xml.rels': '<Relationships><Relationship Id="rId1" Target="fonts/font1.odttf"/></Relationships>',
      'word/fonts/font1.odttf': stored,
    });
    expect(doc.fonts).toHaveLength(1);
    expect(doc.fonts[0]).toMatchObject({ family: 'Brand Sans', bold: false, italic: false });
    expect(Array.from(new Uint8Array(doc.fonts[0].data))).toEqual(Array.from(font));
  });
});
