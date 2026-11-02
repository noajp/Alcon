// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { htmlToMarkdown, markdownToHtml } from '@/Function/shared/markdownHtml';

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
});
