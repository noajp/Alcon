import { parseMarkdown, type Block, type Inline } from './markdownParse';

// Markdown ↔ the Note editor's HTML, for text kept as Markdown (an
// Element's description — agents write it so) but read and edited formatted
// in place: what is shown and what is typed into are the same page, so a
// click never swaps the text for its source.
//
// The HTML side covers what Markdown can say — headings, paragraphs, lists,
// quotes, code, rules, tables; bold, italic, code, links. What it cannot
// (underline, alignment) is dropped on the way back.

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inlineHtml(nodes: Inline[]): string {
  return nodes.map((n) => {
    switch (n.t) {
      case 'text': return esc(n.v).replace(/\n/g, '<br>');
      case 'strong': return `<strong>${inlineHtml(n.c)}</strong>`;
      case 'em': return `<em>${inlineHtml(n.c)}</em>`;
      case 'code': return `<code>${esc(n.v)}</code>`;
      case 'link': return `<a href="${esc(n.href)}">${inlineHtml(n.c)}</a>`;
    }
  }).join('');
}

function blockHtml(b: Block): string {
  switch (b.t) {
    case 'h': return `<h${b.level}>${inlineHtml(b.c)}</h${b.level}>`;
    case 'p': return `<p>${inlineHtml(b.c)}</p>`;
    case 'ul': case 'ol': return `<${b.t}>${b.items.map((it) => `<li>${inlineHtml(it)}</li>`).join('')}</${b.t}>`;
    case 'code': return `<pre>${esc(b.v)}</pre>`;
    case 'quote': return `<blockquote>${inlineHtml(b.c)}</blockquote>`;
    case 'hr': return '<hr>';
    case 'table': return `<table data-note-table="true"><thead><tr>${b.head.map((c) => `<th>${inlineHtml(c)}</th>`).join('')}</tr></thead><tbody>${
      b.rows.map((r) => `<tr>${r.map((c) => `<td>${inlineHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }
}

/** Pure. Markdown as the Note editor's HTML. */
export function markdownToHtml(md: string): string {
  return parseMarkdown(md).map(blockHtml).join('');
}

// ── back to Markdown ─────────────────────────────────────────────────────

function inlineMd(node: Node): string {
  let out = '';
  node.childNodes.forEach((c) => {
    if (c.nodeType === 3) { out += (c.textContent ?? '').replace(/ /g, ' '); return; }
    if (c.nodeType !== 1) return;
    const el = c as Element;
    const tag = el.tagName.toLowerCase();
    const inner = inlineMd(el);
    if (tag === 'br') out += '\n';
    else if (tag === 'strong' || tag === 'b') out += inner.trim() ? `**${inner}**` : inner;
    else if (tag === 'em' || tag === 'i') out += inner.trim() ? `*${inner}*` : inner;
    else if (tag === 'code') out += inner ? `\`${el.textContent ?? ''}\`` : '';
    else if (tag === 'a') {
      const href = el.getAttribute('href') ?? '';
      out += /^(https?:\/\/|mailto:)/i.test(href) ? `[${inner}](${href})` : inner;
    } else out += inner;
  });
  return out;
}

/** One line per table cell or list item: inner line breaks become spaces. */
const oneLine = (s: string) => s.replace(/\s*\n\s*/g, ' ').trim();

function blockMd(el: Element): string | null {
  const tag = el.tagName.toLowerCase();
  switch (tag) {
    case 'h1': case 'h2': case 'h3': {
      const text = oneLine(inlineMd(el));
      return text ? `${'#'.repeat(Number(tag[1]))} ${text}` : null;
    }
    case 'ul': case 'ol': {
      const items = [...el.children].filter((c) => c.tagName.toLowerCase() === 'li').map((li) => oneLine(inlineMd(li))).filter(Boolean);
      return items.length ? items.map((it, i) => `${tag === 'ol' ? `${i + 1}.` : '-'} ${it}`).join('\n') : null;
    }
    case 'pre': {
      const text = (el.textContent ?? '').replace(/\n+$/, '');
      return text ? `\`\`\`\n${text}\n\`\`\`` : null;
    }
    case 'blockquote': {
      const text = inlineMd(el).trim();
      return text ? text.split('\n').map((l) => `> ${l}`).join('\n') : null;
    }
    case 'hr': return '---';
    case 'table': {
      const rows = [...el.querySelectorAll('tr')].map((tr) => [...tr.children].map((c) => oneLine(inlineMd(c)).replace(/\|/g, '\\|')));
      if (!rows.length) return null;
      const width = Math.max(...rows.map((r) => r.length));
      const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? '').join(' | ')} |`;
      return [line(rows[0]), line(Array(width).fill('---')), ...rows.slice(1).map(line)].join('\n');
    }
    default: {
      const text = inlineMd(el).replace(/\n+$/, '');
      return text.trim() ? text : null;
    }
  }
}

/** The Note editor's HTML as Markdown. Needs a DOM (the browser). */
export function htmlToMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const blocks: string[] = [];
  let loose = '';
  const flush = () => { if (loose.trim()) blocks.push(loose.trim()); loose = ''; };
  doc.body.childNodes.forEach((n) => {
    if (n.nodeType === 3) { loose += n.textContent ?? ''; return; }
    if (n.nodeType !== 1) return;
    const el = n as Element;
    if (['strong', 'b', 'em', 'i', 'code', 'a', 'span', 'u', 's', 'br'].includes(el.tagName.toLowerCase())) {
      const wrap = doc.createElement('span'); wrap.appendChild(el.cloneNode(true)); loose += inlineMd(wrap); return;
    }
    flush();
    const md = blockMd(el);
    if (md) blocks.push(md);
  });
  flush();
  return blocks.join('\n\n');
}
