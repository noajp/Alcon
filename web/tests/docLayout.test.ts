// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { readDocLayout, type DocPara, type DocTable } from '@/ActivitySpace/execution/element/docLayout';

const w = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

async function docx(body: string, extra: Record<string, string> = {}) {
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
      `<w:tbl><w:tblPr><w:tblBorders/></w:tblPr><w:tblGrid><w:gridCol w:w="1500"/><w:gridCol w:w="3000"/></w:tblGrid>`
      + `<w:tr>${cell('区分', '<w:vMerge w:val="restart"/><w:shd w:fill="D9E2F3"/>')}${cell('上期')}</w:tr>`
      + `<w:tr>${cell('', '<w:vMerge/>')}${cell('下期')}</w:tr></w:tbl>`
      + '<w:p><w:r><w:br w:type="page"/></w:r></w:p><w:p><w:r><w:t>次</w:t></w:r></w:p>');
    const table = doc.blocks[0] as DocTable;
    expect(table.cols).toEqual([100, 200]);
    expect(table.rows[0][0]).toMatchObject({ fill: '#d9e2f3', rowSpan: 2, skip: false, borders: true });
    expect(table.rows[1][0].skip).toBe(true);
    expect(doc.blocks.some((b) => b.kind === 'break')).toBe(true);
  });
});
