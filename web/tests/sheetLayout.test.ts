// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { readWorkbook } from '@/Function/office/sheetLayout';

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

/** A one-sheet workbook with a number per row, each in its own format;
 *  returns the texts and colours as drawn. */
async function formatted(cases: [number, string][]) {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', `<workbook ${NS}><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>');
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  zip.file('xl/styles.xml', `<styleSheet ${NS}><numFmts>${cases.map(([, f], i) => `<numFmt numFmtId="${200 + i}" formatCode="${esc(f)}"/>`).join('')}</numFmts>`
    + `<fonts><font><sz val="11"/><name val="Calibri"/></font></fonts><fills><fill/></fills><borders><border/></borders><cellXfs>${cases.map((_, i) => `<xf numFmtId="${200 + i}"/>`).join('')}</cellXfs></styleSheet>`);
  zip.file('xl/worksheets/sheet1.xml', `<worksheet ${NS}><sheetData>${cases.map(([v], i) => `<row r="${i + 1}"><c r="A${i + 1}" s="${i}"><v>${v}</v></c></row>`).join('')}</sheetData></worksheet>`);
  const [sheet] = await readWorkbook(await zip.generateAsync({ type: 'arraybuffer' }));
  return sheet.rows.map((r) => [r.cells[0].text, r.cells[0].style?.color ?? null]);
}

describe('number formats', () => {
  it('shows numbers as their Excel formats do', async () => {
    expect(await formatted([
      [2021, 'General'], [0.13989365340001, 'General'], [0.32035, '0.0%'], [1580783, '"¥"#,##0'],
      [-7996, '"¥"#,##0_);[Red]\\("¥"#,##0\\)'], [1234.5, '#,##0.00'], [45000, 'yyyy/m/d'],
      // Sections with their own conditions: the first that holds is used.
      [150, '[Red][>100]"high "0;[<0]"neg "0;"ok "0'], [-3, '[Red][>100]"high "0;[<0]"neg "0;"ok "0'], [50, '[Red][>100]"high "0;[<0]"neg "0;"ok "0'],
    ])).toEqual([
      ['2021', null], ['0.1398936534', null], ['32.0%', null], ['¥1,580,783', null],
      ['(¥7,996)', 'var(--sheet-negative)'], ['1,234.50', null], ['2023/3/15', null],
      ['high 150', 'var(--sheet-negative)'], ['-neg 3', null], ['ok 50', null],
    ]);
  });
});

describe('readWorkbook', () => {
  it('reads styles, merges, widths and a chart whose values live in another sheet', async () => {
    const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
    const zip = new JSZip();
    zip.file('xl/workbook.xml', `<workbook ${ns}><sheets><sheet name="Summary" sheetId="1" r:id="rId1"/><sheet name="Data" sheetId="2" r:id="rId2"/></sheets></workbook>`);
    zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>');
    zip.file('xl/styles.xml', `<styleSheet ${ns}><numFmts><numFmt numFmtId="165" formatCode="0.0%"/></numFmts>`
      + '<fonts><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>'
      + '<fills><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF3D85C6"/></patternFill></fill></fills>'
      + '<borders><border/><border><bottom style="medium"><color rgb="FF1F3864"/></bottom></border></borders>'
      + '<cellXfs><xf/><xf fontId="1" fillId="2" borderId="1"><alignment horizontal="center"/></xf><xf numFmtId="165"/></cellXfs></styleSheet>');
    zip.file('xl/sharedStrings.xml', `<sst ${ns}><si><t>Title</t></si><si><t>Jan</t></si><si><t>Feb</t></si></sst>`);
    zip.file('xl/worksheets/sheet1.xml', `<worksheet ${ns}><sheetViews><sheetView showGridLines="0"/></sheetViews><cols><col min="1" max="1" width="20"/></cols>`
      + '<sheetData><row r="1" ht="30"><c r="A1" s="1" t="s"><v>0</v></c></row><row r="2"><c r="A2" s="2"><v>0.25</v></c></row></sheetData>'
      + '<mergeCells><mergeCell ref="A1:B1"/></mergeCells><drawing r:id="rId1"/></worksheet>');
    zip.file('xl/worksheets/_rels/sheet1.xml.rels', '<Relationships><Relationship Id="rId1" Target="../drawings/drawing1.xml"/></Relationships>');
    zip.file('xl/drawings/drawing1.xml', '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>2</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="3810000" cy="1905000"/>'
      + '<xdr:graphicFrame><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData><c:chart r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame></xdr:oneCellAnchor></xdr:wsDr>');
    zip.file('xl/drawings/_rels/drawing1.xml.rels', '<Relationships><Relationship Id="rId1" Target="../charts/chart1.xml"/></Relationships>');
    zip.file('xl/charts/chart1.xml', '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:plotArea><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/>'
      + "<c:ser><c:tx><c:v>Sales</c:v></c:tx><c:cat><c:strRef><c:f>'Data'!$A$1:$A$2</c:f></c:strRef></c:cat><c:val><c:numRef><c:f>Data!$B$1:$B$2</c:f></c:numRef></c:val></c:ser></c:barChart></c:plotArea></c:chart></c:chartSpace>");
    zip.file('xl/worksheets/sheet2.xml', `<worksheet ${ns}><sheetData><row r="1"><c r="A1" t="s"><v>1</v></c><c r="B1"><v>10</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>20</v></c></row></sheetData></worksheet>`);

    const [summary] = await readWorkbook(await zip.generateAsync({ type: 'arraybuffer' }));
    expect(summary.name).toBe('Summary');
    expect(summary.gridLines).toBe(false);
    expect(summary.cols[0]).toBe(145); // 20 characters of Calibri 11pt digits (7px) + 5
    expect(summary.rows[0].h).toBe(40);
    expect(summary.rows[0].cells[0]).toMatchObject({ text: 'Title', colSpan: 2, style: { bg: '#3d85c6', color: '#ffffff', bold: true, align: 'center', borders: { bottom: '2px solid #1f3864' } } });
    expect(summary.rows[0].cells[1].hidden).toBe(true);
    expect(summary.rows[1].cells[0]).toMatchObject({ text: '25.0%', numeric: true });
    expect(summary.charts[0]).toMatchObject({ kind: 'column', x: 0, y: 40 + 20, w: 400, h: 200, categories: ['Jan', 'Feb'], series: [{ name: 'Sales', values: [10, 20] }] });
  });
});

describe('conditional formats, rich text and pictures', () => {
  it('applies value rules, colour scales, data bars, top-N and duplicates; keeps rich text; places pictures', async () => {
    const zip = new JSZip();
    zip.file('xl/workbook.xml', `<workbook ${NS}><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`);
    zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>');
    zip.file('xl/styles.xml', `<styleSheet ${NS}><fonts><font><sz val="11"/><name val="Calibri"/></font></fonts><fills><fill/></fills><borders><border/></borders><cellXfs><xf/></cellXfs>`
      + '<dxfs><dxf><font><b/><color rgb="FF9C0006"/></font><fill><patternFill><bgColor rgb="FFFFC7CE"/></patternFill></fill></dxf></dxfs></styleSheet>');
    zip.file('xl/sharedStrings.xml', `<sst ${NS}><si><r><rPr><b/><color rgb="FFFF0000"/></rPr><t>重要</t></r><r><t>: 確認</t></r></si></sst>`);
    const row = (r: number, a: number, b: number, c: number) => `<row r="${r}"><c r="A${r}"><v>${a}</v></c><c r="B${r}"><v>${b}</v></c><c r="C${r}"><v>${c}</v></c></row>`;
    zip.file('xl/worksheets/sheet1.xml', `<worksheet ${NS}><sheetData>${row(1, -5, 0, 1)}${row(2, 3, 50, 1)}${row(3, 8, 100, 2)}<row r="4"><c r="D4" t="s"><v>0</v></c></row></sheetData>`
      + '<conditionalFormatting sqref="A1:A3"><cfRule type="cellIs" dxfId="0" priority="1" operator="lessThan"><formula>0</formula></cfRule></conditionalFormatting>'
      + '<conditionalFormatting sqref="B1:B3"><cfRule type="colorScale" priority="2"><colorScale><cfvo type="min"/><cfvo type="max"/><color rgb="FFFFFFFF"/><color rgb="FF63BE7B"/></colorScale></cfRule></conditionalFormatting>'
      + '<conditionalFormatting sqref="A1:A3"><cfRule type="dataBar" priority="3"><dataBar><cfvo type="min"/><cfvo type="max"/><color rgb="FF638EC6"/></dataBar></cfRule></conditionalFormatting>'
      + '<conditionalFormatting sqref="C1:C3"><cfRule type="duplicateValues" dxfId="0" priority="4"/></conditionalFormatting>'
      + '<drawing r:id="rId1"/></worksheet>');
    zip.file('xl/worksheets/_rels/sheet1.xml.rels', '<Relationships><Relationship Id="rId1" Target="../drawings/drawing1.xml"/></Relationships>');
    zip.file('xl/drawings/drawing1.xml', '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<xdr:oneCellAnchor><xdr:from><xdr:col>4</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="952500" cy="476250"/><xdr:pic><xdr:blipFill><a:blip r:embed="rId3"/></xdr:blipFill></xdr:pic></xdr:oneCellAnchor></xdr:wsDr>');
    zip.file('xl/drawings/_rels/drawing1.xml.rels', '<Relationships><Relationship Id="rId3" Target="../media/image1.png"/></Relationships>');
    zip.file('xl/media/image1.png', 'png');
    const [sheet] = await readWorkbook(await zip.generateAsync({ type: 'arraybuffer' }));
    const at = (r: number, c: number) => sheet.rows[r].cells[c];
    expect(at(0, 0).style).toMatchObject({ bg: '#ffc7ce', color: '#9c0006', bold: true });
    expect(at(1, 0).style?.bg ?? null).toBeNull();
    expect([at(0, 1), at(1, 1), at(2, 1)].map((c) => c.style?.bg)).toEqual(['#ffffff', '#b1dfbd', '#63be7b']);
    expect([at(0, 0), at(1, 0), at(2, 0)].map((c) => c.bar?.pct)).toEqual([0, expect.closeTo(0.615, 2), 1]);
    expect([at(0, 2), at(1, 2), at(2, 2)].map((c) => c.style?.bold ?? false)).toEqual([true, true, false]);
    expect(at(3, 3).runs).toEqual([
      { text: '重要', bold: true, italic: false, underline: false, color: '#ff0000', size: null, font: null },
      { text: ': 確認', bold: false, italic: false, underline: false, color: null, size: null, font: null },
    ]);
    expect(sheet.images[0]).toMatchObject({ y: 0, w: 100, h: 50 });
    expect(sheet.images[0].src.startsWith('data:image/png;base64,')).toBe(true);
  });
});

describe('legacy colours and rule operands', () => {
  it('reads indexed colours (and a workbook’s own palette), and rules that compare with another cell', async () => {
    const zip = new JSZip();
    zip.file('xl/workbook.xml', `<workbook ${NS}><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`);
    zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>');
    zip.file('xl/styles.xml', `<styleSheet ${NS}><fonts><font><sz val="11"/><name val="Calibri"/></font><font><color indexed="10"/></font></fonts>`
      + '<fills><fill/><fill/><fill><patternFill patternType="solid"><fgColor indexed="47"/></patternFill></fill></fills><borders><border/></borders>'
      + '<cellXfs><xf/><xf fillId="2" fontId="1"/></cellXfs><dxfs><dxf><fill><patternFill><bgColor rgb="FFC6EFCE"/></patternFill></fill></dxf></dxfs></styleSheet>');
    zip.file('xl/worksheets/sheet1.xml', `<worksheet ${NS}><sheetData>`
      + '<row r="1"><c r="A1" s="1"><v>5</v></c><c r="B1"><v>3</v></c></row><row r="2"><c r="A2"><v>2</v></c><c r="B2"><v>4</v></c></row></sheetData>'
      + '<conditionalFormatting sqref="A1:A2"><cfRule type="cellIs" dxfId="0" priority="1" operator="greaterThan"><formula>B1</formula></cfRule></conditionalFormatting></worksheet>');
    const [sheet] = await readWorkbook(await zip.generateAsync({ type: 'arraybuffer' }));
    // A1 > B1 (5 > 3) — the rule's B1 moves with the cell, so A2 compares with B2 (2 > 4: no).
    expect(sheet.rows[0].cells[0].style).toMatchObject({ bg: '#c6efce', color: '#ff0000' });
    expect(sheet.rows[1].cells[0].style?.bg ?? null).toBeNull();

    // Without the rule, the indexed fill shows: 47 is FFCC99 in Excel's palette.
    const plain = new JSZip();
    for (const [k, v] of Object.entries(zip.files)) if (!v.dir) plain.file(k, await v.async('string'));
    plain.file('xl/worksheets/sheet1.xml', `<worksheet ${NS}><sheetData><row r="1"><c r="A1" s="1"><v>5</v></c></row></sheetData></worksheet>`);
    const [p1] = await readWorkbook(await plain.generateAsync({ type: 'arraybuffer' }));
    expect(p1.rows[0].cells[0].style?.bg).toBe('#ffcc99');
    plain.file('xl/styles.xml', (await plain.file('xl/styles.xml')!.async('string')).replace('<fonts>', '<colors><indexedColors>' + '<rgbColor rgb="FF123456"/>'.repeat(48) + '</indexedColors></colors><fonts>'));
    const [p2] = await readWorkbook(await plain.generateAsync({ type: 'arraybuffer' }));
    expect(p2.rows[0].cells[0].style?.bg).toBe('#123456');
  });
});

