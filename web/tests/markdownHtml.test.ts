// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { htmlToMarkdown, markdownToHtml } from '@/Function/shared/markdownHtml';
import { parseMarkdown } from '@/Function/shared/markdownParse';
import { sanitizeHtml } from '@/Function/notebook/htmlSanitizer';

const md = [
  '## 観察',
  'APL_Div の Object は **どれも** `strategy_objects` に行がない。',
  '## 受け入れ条件',
  '- 開くと見える\n- 紐づけると切り替わる',
  '1. first\n2. second',
  '> 引用',
  '```\nconst a = 1;\n```',
  '| a | b |\n| --- | --- |\n| 1 | 2 |',
  '[link](https://example.com) and *em*',
  '```mermaid\ngraph TD\n  A --> B\n```',
].join('\n\n');

describe('markdown ↔ note html', () => {
  it('renders markdown as the note editor’s html, escaping text', () => {
    expect(markdownToHtml('## T\n\na <b>&')).toBe('<h2>T</h2><p>a &lt;b&gt;&amp;</p>');
    expect(markdownToHtml('- x\n- y')).toBe('<ul><li>x</li><li>y</li></ul>');
    expect(markdownToHtml('```Mermaid\ngraph TD\n```')).toBe('<pre data-lang="mermaid">graph TD</pre>');
  });

  it('comes back to the same markdown', () => {
    expect(htmlToMarkdown(markdownToHtml(md))).toBe(md);
  });

  it('reads what the editor writes: divs, line breaks, unsafe links', () => {
    expect(htmlToMarkdown('<div>one</div><div>two<br>three</div>')).toBe('one\n\ntwo\nthree');
    expect(htmlToMarkdown('<p><a href="javascript:x">t</a> <u>u</u></p>')).toBe('t u');
    expect(htmlToMarkdown('<p></p><h1> </h1>plain')).toBe('plain');
  });

  // What the description editor offers beyond plain lists and marks: these
  // must survive a save (html → markdown) and a reload (markdown → html,
  // sanitized by the editor) without changing.
  const rich = [
    '- [ ] first\n- [x] second **done**\n- [ ] third',
    '~~gone~~ and ~~**both**~~',
    '- a\n  - a.1\n    - a.1.i\n  - a.2\n- b',
    '1. one\n   - one.a\n2. two',
    '- [x] parent\n  - [ ] child',
  ];

  it.each(rich)('keeps %j through html, the sanitizer and back', (src) => {
    expect(htmlToMarkdown(markdownToHtml(src))).toBe(src);
    expect(htmlToMarkdown(sanitizeHtml(markdownToHtml(src)))).toBe(src);
  });

  it('writes a task list as the editor’s checklist', () => {
    expect(markdownToHtml('- [ ] a\n- [x] b')).toBe('<ul data-checklist="true"><li data-checked="false">a</li><li data-checked="true">b</li></ul>');
    expect(markdownToHtml('- a\n  - b')).toBe('<ul><li>a<ul><li>b</li></ul></li></ul>');
    expect(markdownToHtml('~~x~~')).toBe('<p><s>x</s></p>');
  });

  it('reads the editor’s checklist, strike and indented lists', () => {
    // A box checked in the editor, and the browser's <strike>.
    expect(htmlToMarkdown('<ul data-checklist="true"><li data-checked="false">a</li><li data-checked="true">b</li></ul><p><strike>c</strike></p>'))
      .toBe('- [ ] a\n- [x] b\n\n~~c~~');
    // The browser's indent puts the sub-list beside the item; the
    // sanitizer then wraps it in an empty <li>. Both nest under "a".
    const indented = '<ul><li>a</li><ul><li>b</li></ul><li>c</li></ul>';
    expect(htmlToMarkdown(indented)).toBe('- a\n  - b\n- c');
    expect(htmlToMarkdown(sanitizeHtml(indented))).toBe('- a\n  - b\n- c');
    // A checklist made from a bullet that has no box state yet.
    expect(htmlToMarkdown('<ul data-checklist="true"><li>a</li></ul>')).toBe('- [ ] a');
  });

  it('still reads descriptions saved before: flat lists, star bullets, plain text', () => {
    expect(htmlToMarkdown(markdownToHtml('* x\n* y'))).toBe('- x\n- y');
    expect(markdownToHtml('- [link](https://a.io) [not a box]')).toBe('<ul><li><a href="https://a.io">link</a> [not a box]</li></ul>');
    expect(markdownToHtml('a ~ b ~~ c')).toBe('<p>a ~ b ~~ c</p>');
    // A bullet list and a task list side by side stay two lists.
    expect(parseMarkdown('- a\n- [ ] b').map((b) => b.t === 'ul' && !!b.task)).toEqual([false, true]);
  });
});
