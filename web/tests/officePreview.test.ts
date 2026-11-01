import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { readOffice, officeKindOf } from '@/ActivitySpace/execution/element/officePreview';

async function zipOf(files: Record<string, string>) {
  const zip = new JSZip();
  for (const [path, body] of Object.entries(files)) zip.file(path, body);
  return zip.generateAsync({ type: 'arraybuffer' });
}

describe('Office preview', () => {
  it('knows the three kinds by extension', () => {
    expect([officeKindOf('a.DOCX'), officeKindOf('b.xlsx'), officeKindOf('c.pptx'), officeKindOf('d.pdf')]).toEqual(['docx', 'xlsx', 'pptx', null]);
  });

  it('reads a Word body as paragraphs with heading levels', async () => {
    const xml = '<w:document><w:body>'
      + '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>事業計画</w:t></w:r></w:p>'
      + '<w:p><w:r><w:t xml:space="preserve">売上 &amp; </w:t></w:r><w:r><w:t>利益</w:t></w:r></w:p>'
      + '</w:body></w:document>';
    const preview = await readOffice('docx', await zipOf({ 'word/document.xml': xml }));
    expect(preview).toEqual({ kind: 'docx', paragraphs: [{ text: '事業計画', heading: 1 }, { text: '売上 & 利益', heading: null }] });
  });

  it('reads Excel sheets as rows, with shared strings, numbers and gaps', async () => {
    const preview = await readOffice('xlsx', await zipOf({
      'xl/workbook.xml': '<workbook><sheets><sheet name="売上" sheetId="1"/></sheets></workbook>',
      'xl/sharedStrings.xml': '<sst><si><t>月</t></si><si><t>金額</t></si></sst>',
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData>'
        + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>'
        + '<row r="2"><c r="A2"><v>4</v></c><c r="C2"><v>1200</v></c></row>'
        + '</sheetData></worksheet>',
    }));
    expect(preview).toEqual({ kind: 'xlsx', sheets: [{ name: '売上', rows: [['月', '', '金額'], ['4', '', '1200']] }] });
  });

  it('shows numbers as the General format of Excel does', async () => {
    const preview = await readOffice('xlsx', await zipOf({
      'xl/workbook.xml': '<workbook><sheets><sheet name="S" sheetId="1"/></sheets></workbook>',
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData>'
        + '<row r="1"><c r="A1"><v>2021.0</v></c><c r="B1"><v>0.13989365340001</v></c><c r="C1"><v>-204421</v></c></row>'
        + '</sheetData></worksheet>',
    }));
    expect(preview).toEqual({ kind: 'xlsx', sheets: [{ name: 'S', rows: [['2021', '0.1398936534', '-204421']] }] });
  });

  it('reads PowerPoint slides in order as lines', async () => {
    const slide = (t: string[]) => `<p:sld>${t.map((x) => `<a:p><a:r><a:t>${x}</a:t></a:r></a:p>`).join('')}</p:sld>`;
    const preview = await readOffice('pptx', await zipOf({
      'ppt/slides/slide10.xml': slide(['最後']),
      'ppt/slides/slide2.xml': slide(['課題', '打ち手']),
      'ppt/slides/slide1.xml': slide(['表紙']),
    }));
    expect(preview).toEqual({ kind: 'pptx', slides: [{ lines: ['表紙'] }, { lines: ['課題', '打ち手'] }, { lines: ['最後'] }] });
  });
});
