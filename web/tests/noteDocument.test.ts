// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { docToHtml, htmlToDoc, isEmptyDoc } from '@/Function/notebook/pm/html';

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
