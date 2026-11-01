// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { readWorkbook } from '@/ActivitySpace/execution/element/sheetLayout';

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
    ])).toEqual([
      ['2021', null], ['0.1398936534', null], ['32.0%', null], ['¥1,580,783', null],
      ['(¥7,996)', 'var(--sheet-negative)'], ['1,234.50', null], ['2023/3/15', null],
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
