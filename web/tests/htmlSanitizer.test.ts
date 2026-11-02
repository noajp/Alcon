// @vitest-environment jsdom
// sanitizeHtml is the only barrier between another person's Note HTML and the
// editor's innerHTML. These cases pin the allowlist: anything not on it is
// unwrapped to its text, attributes are rebuilt from scratch (never copied),
// and links survive only for http/https/mailto.
import { describe, expect, it } from 'vitest';
import { hasInvalidStructure, htmlToPlainText, normalizeStructure, sanitizeHtml } from '@/Function/notebook/htmlSanitizer';

/** Parse the sanitized output the way the editor does (innerHTML on a live
 *  element) and report every element, attribute and URL that came through. */
function reparse(html: string) {
  const host = document.createElement('div');
  host.innerHTML = sanitizeHtml(html);
  const elements = Array.from(host.querySelectorAll('*'));
  return {
    host,
    tags: elements.map((e) => e.tagName.toLowerCase()),
    attrs: elements.flatMap((e) => Array.from(e.attributes).map((a) => [a.name.toLowerCase(), a.value] as const)),
  };
}

const ALLOWED_TAGS = new Set([
  'h1', 'h2', 'h3', 'p', 'blockquote', 'pre', 'ul', 'ol', 'li', 'hr', 'br',
  'strong', 'em', 'u', 's', 'code', 'a', 'span',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'colgroup', 'col',
]);
const ALLOWED_ATTRS = new Set([
  'href', 'rel', 'target', 'data-align', 'data-checklist', 'data-checked',
  'data-element-id', 'data-note-table', 'colspan', 'rowspan', 'style',
]);

/** The invariant every hostile input must satisfy after a round trip. */
function expectInert(html: string) {
  const { tags, attrs } = reparse(html);
  for (const t of tags) expect(ALLOWED_TAGS, `tag <${t}> from ${html}`).toContain(t);
  for (const [name, value] of attrs) {
    expect(ALLOWED_ATTRS, `attr ${name} from ${html}`).toContain(name);
    expect(name.startsWith('on')).toBe(false);
    if (name === 'href') expect(value.trim().toLowerCase()).toMatch(/^(https?:\/\/|mailto:)/);
    if (name === 'style') expect(value).toMatch(/^width:\d+px$/);
  }
}

describe('sanitizeHtml — executable content is removed', () => {
  it.each([
    '<script>alert(1)</script>',
    '<SCRIPT SRC="https://evil.example/x.js"></SCRIPT>',
    '<p>a<script>alert(1)</script>b</p>',
    '<iframe src="https://evil.example"></iframe>',
    '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
    '<object data="javascript:alert(1)"></object>',
    '<embed src="javascript:alert(1)">',
    '<frameset><frame src="javascript:alert(1)"></frameset>',
    '<style>body{background:url(javascript:alert(1))}</style>',
    '<link rel="stylesheet" href="https://evil.example/x.css">',
    '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
    '<base href="https://evil.example/">',
    '<form action="https://evil.example"><input name="q"><button>go</button></form>',
    '<textarea><img src=x onerror=alert(1)></textarea>',
    '<template><img src=x onerror=alert(1)></template>',
    '<noscript><img src=x onerror=alert(1)></noscript>',
    '<img src=x onerror=alert(1)>',
    '<video><source onerror=alert(1)></video>',
    '<audio src=x onerror=alert(1)></audio>',
  ])('%s', (html) => {
    expectInert(html);
  });

  it('keeps the text of a script as inert text, never as markup', () => {
    const { host, tags } = reparse('<p>x<script>alert("hi")</script></p>');
    expect(tags).toEqual(['p']);
    expect(host.textContent).toBe('xalert("hi")');
  });

  it('escapes markup-looking text so it cannot re-parse into an element', () => {
    const out = sanitizeHtml('<textarea></p><img src=x onerror=alert(1)></textarea>');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
    expectInert('<textarea></p><img src=x onerror=alert(1)></textarea>');
  });

  it('drops comments and CDATA', () => {
    expect(sanitizeHtml('<p>a<!-- <script>alert(1)</script> -->b</p>')).toBe('<p>ab</p>');
    expectInert('<![CDATA[<script>alert(1)</script>]]>');
  });
});

describe('sanitizeHtml — attributes are rebuilt, never copied', () => {
  it.each([
    '<p onclick="alert(1)">x</p>',
    '<p ONCLICK="alert(1)">x</p>',
    '<strong onmouseover=alert(1)>x</strong>',
    '<a href="https://ok.example" onclick="alert(1)">x</a>',
    '<li data-checked="true" onfocus="alert(1)" autofocus tabindex=0>x</li>',
    '<td onpointerenter=alert(1) colspan=2>x</td>',
    '<span style="background:url(javascript:alert(1))" class="x" id="y">x</span>',
    '<p style="behavior:url(x.htc);text-align:center">x</p>',
    '<col style="width:expression(alert(1))">',
    '<p data-align="center\" onclick=\"alert(1)">x</p>',
  ])('%s', (html) => {
    expectInert(html);
  });

  it('strips everything but the allowlist from an inline element', () => {
    expect(sanitizeHtml('<span class="x" id="y" style="color:red" title="t">x</span>')).toBe('<span>x</span>');
  });

  it('keeps only an exact data-align value, and derives one from text-align', () => {
    expect(sanitizeHtml('<p data-align="center">x</p>')).toBe('<p data-align="center">x</p>');
    expect(sanitizeHtml('<p data-align="center;x">x</p>')).toBe('<p>x</p>');
    expect(sanitizeHtml('<p style="text-align: RIGHT">x</p>')).toBe('<p data-align="right">x</p>');
    // left is the default, so it is not written.
    expect(sanitizeHtml('<h2 data-align="left">x</h2>')).toBe('<h2>x</h2>');
    // Not on inline tags.
    expect(sanitizeHtml('<p><span data-align="center">x</span></p>')).toBe('<p><span>x</span></p>');
  });

  it('keeps col width only as a rounded pixel number', () => {
    expect(sanitizeHtml('<table><colgroup><col style="width: 120.6px; color: red"></colgroup></table>'))
      .toBe('<table><colgroup><col style="width:121px"></colgroup></table>');
    expect(sanitizeHtml('<table><colgroup><col style="width:50%"></colgroup></table>'))
      .toBe('<table><colgroup><col></colgroup></table>');
  });

  it('keeps only sane cell spans', () => {
    const out = sanitizeHtml('<table><tbody><tr><td colspan="3" rowspan="0">a</td><td colspan="2x">b</td><td rowspan="-4">c</td></tr></tbody></table>');
    expect(out).toBe('<table><tbody><tr><td colspan="3">a</td><td colspan="2">b</td><td>c</td></tr></tbody></table>');
  });
});

describe('sanitizeHtml — links', () => {
  it.each([
    'https://example.com/a?b=c#d',
    'http://example.com',
    'mailto:someone@example.com',
    '  HTTPS://Example.com',
  ])('keeps %s with rel/target forced', (href) => {
    const { host } = reparse(`<a href="${href}" target="_self" rel="opener">x</a>`);
    const a = host.querySelector('a')!;
    expect(a.getAttribute('href')).toBe(href);
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    expect(a.getAttribute('target')).toBe('_blank');
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
    'java&#x09;script:alert(1)',
    '&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;&#58;alert(1)',
    '&#x6A;avascript:alert(1)',
    'javascript&colon;alert(1)',
    '\u0001javascript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    'DATA:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'VBScript:msgbox(1)',
    'file:///etc/passwd',
    '//evil.example/x',
    '/relative/path',
    '#fragment',
    '',
  ])('unwraps a link to %j and keeps its text', (href) => {
    const { host, tags } = reparse(`<p><a href="${href}">click</a></p>`);
    expect(tags).toEqual(['p']);
    expect(host.textContent).toBe('click');
  });

  it('unwraps an anchor with no href', () => {
    expect(sanitizeHtml('<p><a name="x">t</a></p>')).toBe('<p>t</p>');
  });

  it('does not let an http-looking prefix hide a script scheme', () => {
    // "http://" must be the scheme, not a substring further along.
    expectInert('<a href="javascript:alert(\'http://\')">x</a>');
    expect(reparse('<a href="javascript:alert(\'http://\')">x</a>').tags).toEqual([]);
  });
});

describe('sanitizeHtml — svg, math and namespace tricks', () => {
  it.each([
    '<svg onload=alert(1)><circle r=1></circle></svg>',
    '<svg><script>alert(1)</script></svg>',
    '<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>',
    '<svg><a href="javascript:alert(1)">x</a></svg>',
    '<svg><animate attributeName="href" to="javascript:alert(1)"/></svg>',
    '<svg><foreignObject><img src=x onerror=alert(1)></foreignObject></svg>',
    '<svg><style><img src=x onerror=alert(1)></style></svg>',
    '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)></style></mglyph></table></mtext></math>',
    '<math><maction actiontype="statusline" xlink:href="javascript:alert(1)">x</maction></math>',
    '<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>',
    '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>',
  ])('%s', (html) => {
    expectInert(html);
  });

  it('a link inside svg survives only with a safe href, as a plain HTML link', () => {
    const { host } = reparse('<svg><a href="https://ok.example">x</a></svg>');
    const a = host.querySelector('a');
    expect(a?.namespaceURI).toBe('http://www.w3.org/1999/xhtml');
    expect(a?.getAttribute('href')).toBe('https://ok.example');
  });
});

describe('sanitizeHtml — malformed and nested markup', () => {
  it.each([
    '<p><b>unclosed <i>tags',
    '<<script>script>alert(1)<</script>/script>',
    '<scr<script>ipt>alert(1)</script>',
    '<img """><script>alert(1)</script>">',
    '<p title="<script>alert(1)</script>">x</p>',
    '<a href="https://ok.example"<script>alert(1)</script>>x</a>',
    '<div><div><div><script>alert(1)</script></div></div></div>',
    '</p></div><script>alert(1)</script>',
    '<table><script>alert(1)</script><tr><td>x</td></tr></table>',
    '<table><tr><td><img src=x onerror=alert(1)></td></tr></table>',
    '<select><option><img src=x onerror=alert(1)></option></select>',
    '<xmp><img src=x onerror=alert(1)></xmp>',
    '<plaintext><img src=x onerror=alert(1)>',
  ])('%s', (html) => {
    expectInert(html);
  });

  it('is idempotent: sanitizing the output again changes nothing', () => {
    const inputs = [
      '<h1 style="text-align:center">T</h1><ul data-checklist="true"><li data-checked="true">a<ul><li>b</li></ul></li></ul>',
      '<div>one</div><b>two</b><i>three</i><strike>four</strike>',
      '<ul><h1>x</h1><p>y</p></ul>',
      '<table data-note-table="true"><tbody><tr><td colspan="2" style="text-align:right">x</td></tr></tbody></table>',
    ];
    for (const html of inputs) {
      const once = sanitizeHtml(html);
      expect(sanitizeHtml(once)).toBe(once);
    }
  });

  it('returns empty for empty input', () => {
    expect(sanitizeHtml('')).toBe('');
  });
});

describe('sanitizeHtml — the editor’s own shapes survive', () => {
  it('renames legacy tags to the canonical ones', () => {
    expect(sanitizeHtml('<div>a</div><p><b>b</b><i>c</i><strike>d</strike></p>'))
      .toBe('<p>a</p><p><strong>b</strong><em>c</em><s>d</s></p>');
  });

  it('keeps blocks, inline marks and code', () => {
    const html = '<h1>a</h1><h2>b</h2><h3>c</h3><blockquote>d</blockquote><pre>e</pre>'
      + '<p><strong>f</strong><em>g</em><u>h</u><s>i</s><code>j</code><br></p><hr>';
    expect(sanitizeHtml(html)).toBe(html);
  });

  it('keeps checklists, checked state and the Element link', () => {
    const html = '<ul data-checklist="true"><li data-checked="true" data-element-id="el-1">a</li><li data-checked="false">b</li></ul>';
    expect(sanitizeHtml(html)).toBe(html);
    expect(sanitizeHtml('<ul data-checklist="yes"><li data-checked="maybe">a</li></ul>')).toBe('<ul><li>a</li></ul>');
  });

  it('keeps an intentional table marker only when exactly true', () => {
    expect(sanitizeHtml('<table data-note-table="true"><tbody><tr><td>x</td></tr></tbody></table>'))
      .toBe('<table data-note-table="true"><tbody><tr><td>x</td></tr></tbody></table>');
    expect(sanitizeHtml('<table data-note-table="1"><tbody><tr><td>x</td></tr></tbody></table>'))
      .toBe('<table><tbody><tr><td>x</td></tr></tbody></table>');
  });

  it('unwraps unknown wrappers but keeps their allowed children', () => {
    expect(sanitizeHtml('<section><article><p>a <font color="red">b</font></p></article></section>'))
      .toBe('<p>a b</p>');
  });

  it('repairs bad nesting: lists hold only li, blocks never wrap blocks', () => {
    expect(sanitizeHtml('<ul><h1>x</h1></ul>')).toBe('<ul><li>x</li></ul>');
    expect(sanitizeHtml('<h1><p>x</p></h1>')).toBe('<h1>x</h1>');
    expect(sanitizeHtml('<ul><li><h1><p>x</p></h1><ul><li>y</li></ul></li></ul>'))
      .toBe('<ul><li>x<ul><li>y</li></ul></li></ul>');
  });
});

describe('structure helpers', () => {
  const el = (html: string) => {
    const d = document.createElement('div');
    d.innerHTML = html;
    return d;
  };

  it('hasInvalidStructure spots stray list children and nested flow blocks only', () => {
    expect(hasInvalidStructure(el('<ul><li>a<ul><li>b</li></ul></li></ul><p><strong>c</strong></p>'))).toBe(false);
    expect(hasInvalidStructure(el('<ul><li>a</li><p>b</p></ul>'))).toBe(true);
    expect(hasInvalidStructure(el('<li><h2>x</h2></li>'))).toBe(true);
    expect(hasInvalidStructure(el('<blockquote><p>x</p></blockquote>'))).toBe(true);
  });

  it('normalizeStructure moves text nodes instead of recreating them', () => {
    const root = el('<ul><li><p>keep</p></li></ul>');
    const text = root.querySelector('p')!.firstChild!;
    normalizeStructure(root);
    expect(root.innerHTML).toBe('<ul><li>keep</li></ul>');
    expect(root.querySelector('li')!.firstChild).toBe(text);
  });
});

describe('htmlToPlainText', () => {
  it('drops markup and breaks lines at blocks', () => {
    expect(htmlToPlainText('<h1>Title</h1><p>a <strong>b</strong></p><ul><li>x</li><li>y</li></ul>'))
      .toBe('Title\na b\nx\ny');
  });

  it('never surfaces script source as markup', () => {
    expect(htmlToPlainText('<p>a</p><img src=x onerror=alert(1)>')).toBe('a');
  });

  it('is empty for empty input', () => {
    expect(htmlToPlainText('')).toBe('');
  });
});
