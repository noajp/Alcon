// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { writeDocx } from '@/Function/office/docxWriter';
import { readDocLayout, type DocPara, type DocTable } from '@/Function/office/docLayout';
import { docToNoteHtml } from '@/Function/office/docToNote';

const buf = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const roundTrip = async (html: string, title?: string) => readDocLayout(buf(await writeDocx(html, title)));

describe('writeDocx', () => {
  it('writes headings, alignment and run styles Word (and our reader) understands', async () => {
    const doc = await roundTrip('<h2>Plan</h2><p data-align="center"><strong>bold</strong> <em>it</em> <u>u</u> <s>s</s> <code>x</code></p>', 'Title');
    const [t, h, p] = doc.blocks as DocPara[];
    expect(t).toMatchObject({ heading: true, runs: [{ text: 'Title', bold: true, size: 16 }] });
    expect(h).toMatchObject({ heading: true, runs: [{ text: 'Plan', bold: true, size: 14 }] });
    expect(p.align).toBe('center');
    const look = Object.fromEntries(p.runs.filter((r) => r.text.trim()).map((r) => [r.text, r]));
    expect(look.bold.bold).toBe(true);
    expect(look.it.italic).toBe(true);
    expect(look.u.underline).toBe(true);
    expect(look.s.strike).toBe(true);
    expect(look.x.font).toBe('Consolas');
  });

  it('numbers each list from 1, nests by level, and marks checklists', async () => {
    const doc = await roundTrip('<ol><li>a<ol><li>a1</li></ol></li><li>b</li></ol><ol><li>c</li></ol><ul><li>dot</li></ul><ul data-checklist="true"><li data-checked="true">done</li><li data-checked="false">todo</li></ul>');
    expect((doc.blocks as DocPara[]).map((b) => [b.marker, b.runs.map((r) => r.text).join('')])).toEqual([
      ['1.', 'a'], ['a.', 'a1'], ['2.', 'b'], ['1.', 'c'], ['•', 'dot'], [null, '☑ done'], [null, '☐ todo'],
    ]);
  });

  it('writes tables with widths, column and row merges', async () => {
    const doc = await roundTrip('<table data-note-table="true"><colgroup><col style="width:100px"><col style="width:50px"></colgroup><tbody>'
      + '<tr><td colspan="2">A</td></tr><tr><td rowspan="2">B</td><td>C</td></tr><tr><td>D</td></tr></tbody></table><p>after</p>');
    const t = doc.blocks[0] as DocTable;
    expect(t.cols.map(Math.round)).toEqual([100, 50]);
    expect(t.rows[0][0]).toMatchObject({ span: 2 });
    expect(t.rows[1][0]).toMatchObject({ rowSpan: 2 });
    expect(t.rows[2][0].skip).toBe(true);
    expect((t.rows[2][1].blocks[0] as DocPara).runs[0].text).toBe('D');
  });

  it('comes back to the same Note through import', async () => {
    const html = '<h1>H</h1><p>text <strong>b</strong></p><ul><li>one<ul><li>two</li></ul></li></ul><ol><li>n</li></ol>';
    expect(docToNoteHtml(await roundTrip(html))).toBe(html);
  });

  it('links external addresses only, and escapes text', async () => {
    const bytes = await writeDocx('<p><a href="https://example.com/?a=1&amp;b=2">site</a> <a href="javascript:x">bad</a> 1 &lt; 2</p>');
    const zip = await JSZip.loadAsync(bytes);
    const rels = await zip.file('word/_rels/document.xml.rels')!.async('string');
    const body = await zip.file('word/document.xml')!.async('string');
    expect(rels).toContain('Target="https://example.com/?a=1&amp;b=2" TargetMode="External"');
    expect(rels).not.toContain('javascript');
    expect(body).toContain('<w:hyperlink r:id="rLink1"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t xml:space="preserve">site</w:t></w:r></w:hyperlink>');
    expect(body).toContain('1 &lt; 2');
  });
});
