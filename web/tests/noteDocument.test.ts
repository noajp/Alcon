// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { docToHtml, htmlToDoc, isEmptyDoc, keepSpaces, plainSpaces } from '@/Function/notebook/pm/html';
import { schema } from '@/Function/notebook/pm/schema';

const round = (html: string) => docToHtml(htmlToDoc(html));

describe('Note documents keep the HTML they are saved as', () => {
  it.each([
    ['paragraphs and headings', '<h1>Title</h1><p>Body <strong>bold</strong> <em>it</em> <u>u</u> <s>s</s> <code>c</code></p>'],
    ['alignment', '<p data-align="center">mid</p><h2 data-align="right">r</h2>'],
    ['quotes and dividers', '<blockquote><p>q</p></blockquote><hr>'],
    ['code with its language', '<pre data-lang="mermaid">graph TD; A--&gt;B</pre>'],
    ['a live block', '<pre data-lang="clayware">{"view":"gantt"}</pre>'],
    ['lists', '<ul><li>a<ul><li>a1</li></ul></li></ul><ol><li>b</li></ol><ul data-style="dashed"><li>c</li></ul>'],
    ['checklists and linked lines', '<ul data-checklist="true"><li data-checked="true">done</li><li data-element-id="e1">linked</li></ul>'],
    ['links', '<p><a href="https://example.com" rel="noopener noreferrer" target="_blank">x</a></p>'],
  ])('%s', (_name, html) => {
    expect(round(html)).toBe(html);
  });

  it('gives a checklist line that says nothing of its box an unchecked one', () => {
    expect(round('<ul data-checklist="true"><li>a</li><li data-element-id="e1">b</li></ul><ul><li>plain</li></ul>'))
      .toBe('<ul data-checklist="true"><li data-checked="false">a</li><li data-element-id="e1">b</li></ul><ul><li>plain</li></ul>');
  });

  it('reads list items written with a paragraph inside', () => {
    expect(round('<ul data-checklist="true"><li data-element-id="e2"><p>plain</p></li></ul>'))
      .toBe('<ul data-checklist="true"><li data-element-id="e2">plain</li></ul>');
  });

  it('keeps a table with its widths, spans and marker', () => {
    const html = '<table data-note-table="true"><colgroup><col style="width:120px"><col style="width:80px"></colgroup>'
      + '<tbody><tr><th>h1</th><th>h2</th></tr><tr><td colspan="2">wide</td></tr></tbody></table>';
    const out = round(html);
    expect(out).toContain('data-note-table="true"');
    expect(out).toContain('<col style="width:120px"><col style="width:80px">');
    expect(out).toContain('colspan="2"');
    expect(out).not.toContain('data-colwidth');
  });

  it('drops what a Note cannot hold', () => {
    expect(round('<p>a<script>x</script><span style="color:red">b</span></p><img src="x">')).toBe('<p>ab</p>');
    expect(round('<p><a href="javascript:alert(1)">x</a></p>')).toBe('<p>x</p>');
  });

  it('tells an empty body', () => {
    expect(isEmptyDoc(htmlToDoc(''))).toBe(true);
    expect(isEmptyDoc(htmlToDoc('<p>x</p>'))).toBe(false);
  });
});

describe('spaces a person typed are still there after a save', () => {
  const p = (...kids: (string | null)[]) => schema.node('paragraph', null, kids.map((k) => (k === null ? schema.node('hard_break') : schema.text(k))));

  it('at the start and end of a line, several in a row, and after a line break', () => {
    const doc = schema.node('doc', null, [p('a  b '), p(' lead'), p('   '), p('x ', null, ' y  z'), p('one two')]);
    const saved = docToHtml(doc);
    expect(saved).toContain('&nbsp;');
    expect(saved).toContain('<p>one two</p>');
    expect(htmlToDoc(saved).eq(doc)).toBe(true);
  });

  it('across bold and plain text', () => {
    const doc = schema.node('doc', null, [schema.node('paragraph', null, [
      schema.text('a '), schema.text(' b ', [schema.marks.strong.create()]), schema.text(' c'),
    ])]);
    expect(htmlToDoc(docToHtml(doc)).eq(doc)).toBe(true);
  });

  it('is the exact reverse for any run of spaces and breaks', () => {
    let seed = 7;
    const rand = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    for (let n = 0; n < 500; n++) {
      const texts: (string | null)[] = [];
      for (let i = rand(5); i >= 0; i--) {
        if (rand(5) === 0) { texts.push(null); continue; }
        let text = '';
        for (let j = rand(6); j >= 0; j--) text += rand(2) ? ' ' : 'a';
        texts.push(text);
      }
      expect(plainSpaces(keepSpaces(texts))).toEqual(texts);
    }
  });

  it('reads the no-break spaces a browser wrote for them as plain spaces', () => {
    const doc = htmlToDoc('<p>a&nbsp; b&nbsp;</p><p>&nbsp;c</p>');
    expect(doc.child(0).textContent).toBe('a  b ');
    expect(doc.child(1).textContent).toBe(' c');
  });

  it('leaves alone a no-break space typed inside a line, and the spaces in code', () => {
    expect(htmlToDoc('<p>10&nbsp;km</p>').textContent).toBe('10\u00a0km');
    expect(round('<pre>  two\n    four  </pre>')).toBe('<pre>  two\n    four  </pre>');
  });
});

describe("a body is other people's HTML: reading it runs nothing", () => {
  it('is read in a document of its own, never in the page', () => {
    const make = vi.spyOn(document, 'createElement');
    const doc = htmlToDoc('<p>before</p><img src="x.png" onerror="globalThis.__ran = 1"><p onmouseover="globalThis.__ran = 2">after</p><svg onload="globalThis.__ran = 3"></svg>');
    expect(make).not.toHaveBeenCalled();
    make.mockRestore();
    expect(docToHtml(doc)).toBe('<p>before</p><p>after</p>');
  });

  it('never writes an unsafe address into the page, however it got into the document', () => {
    const link = (href: string) => schema.node('doc', null, [schema.node('paragraph', null, [schema.text('x', [schema.marks.link.create({ href })])])]);
    expect(docToHtml(link('javascript:alert(1)'))).toBe('<p><a>x</a></p>');
    expect(docToHtml(link('https://example.com'))).toContain('href="https://example.com"');
  });
});
