import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { readOffice, officeKindOf } from '@/Function/office/officePreview';

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
