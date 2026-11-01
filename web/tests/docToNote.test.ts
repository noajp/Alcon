// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { docToNoteHtml } from '@/Function/office/docToNote';
import type { DocBlock, DocPara, DocRun } from '@/Function/office/docLayout';
import { sanitizeHtml } from '@/Function/notebook/htmlSanitizer';

const run = (text: string, o: Partial<DocRun> = {}): DocRun => ({ text, bold: false, italic: false, underline: false, strike: false, size: 10.5, color: null, font: null, highlight: null, ...o });
const p = (runs: DocRun[], o: Partial<DocPara> = {}): DocPara => ({ kind: 'p', align: 'left', before: 0, after: 0, line: null, indent: 0, firstLine: 0, marker: null, runs, heading: false, ...o });
const note = (blocks: DocBlock[], footnotes: DocBlock[][] = []) => docToNoteHtml({ blocks, footnotes });

describe('docToNoteHtml', () => {
  it('ranks headings by size and keeps run styles and alignment', () => {
    const html = note([
      p([run('Title', { size: 20 })], { heading: true, align: 'center' }),
      p([run('Section', { size: 14 })], { heading: true }),
      p([run('Sub', { size: 12 })], { heading: true }),
      p([run('Deeper', { size: 11 })], { heading: true }),
      p([run('a', { bold: true }), run('b', { italic: true, underline: true }), run('<c>', { strike: true })], { align: 'right' }),
    ]);
    expect(html).toBe('<h1 data-align="center">Title</h1><h2>Section</h2><h3>Sub</h3><h3>Deeper</h3>'
      + '<p data-align="right"><strong>a</strong><em><u>b</u></em><s>&lt;c&gt;</s></p>');
  });

  it('nests list items by indent and tells bullets from numbers', () => {
    const html = note([
      p([run('one')], { marker: '1.', indent: 48 }),
      p([run('one a')], { marker: '1.a)', indent: 96 }),
      p([run('two')], { marker: '2.', indent: 48 }),
      p([run('dot')], { marker: '•', indent: 48 }),
      p([run('after')]),
    ]);
    expect(html).toBe('<ol><li>one<ol><li>one a</li></ol></li><li>two</li></ol><ul><li>dot</li></ul><p>after</p>');
  });

  it('collapses empty paragraphs, drops breaks and pictures, and adds footnotes', () => {
    const html = note([
      p([]), p([run('x')]), p([]), p([]), { kind: 'break' }, p([run('', { image: { src: 'data:', w: 1, h: 1, float: null } })]), p([run('y\tz')]), p([]),
    ], [[p([run('note one')])]]);
    expect(html).toBe('<p>x</p><p><br></p><p>y z</p><hr><ol><li>note one</li></ol>');
  });

  it('writes tables as Note tables with widths and merges', () => {
    const cell = (t: string, o = {}) => ({ blocks: [p([run(t)])], fill: null, span: 1, rowSpan: 1, skip: false, borders: true, borderColor: null, ...o });
    const html = note([{ kind: 'table', cols: [100, 50], rows: [[cell('A', { span: 2 }), cell('', { skip: true })], [cell('B', { rowSpan: 1 }), { ...cell('C'), blocks: [p([run('C1')]), p([run('C2')], { align: 'center' })] }]] }]);
    expect(html).toBe('<table data-note-table="true"><colgroup><col style="width:100px"><col style="width:50px"></colgroup><tbody>'
      + '<tr><td colspan="2">A</td></tr><tr><td>B</td><td>C1<br>C2</td></tr></tbody></table>');
  });

  it('is already in the shape the Note editor keeps', () => {
    const html = note([
      p([run('H', { size: 16 })], { heading: true }),
      p([run('t', { bold: true })], { align: 'center' }),
      p([run('i')], { marker: '•', indent: 24 }), p([run('j')], { marker: '•', indent: 48 }),
      { kind: 'table', cols: [80], rows: [[{ blocks: [p([run('c')])], fill: null, span: 1, rowSpan: 1, skip: false, borders: true, borderColor: null }]] },
    ], [[p([run('n')])]]);
    expect(sanitizeHtml(html)).toBe(html);
  });
});
