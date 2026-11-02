import { parseMarkdown, type Block, type Inline, type ListBlock } from './markdownParse';

// Markdown ↔ the Note editor's HTML, for text kept as Markdown (an
// Element's description — agents write it so) but read and edited formatted
// in place: what is shown and what is typed into are the same page, so a
// click never swaps the text for its source.
//
// The HTML side covers what Markdown can say — headings, paragraphs, lists
// (nested, and checklists as GFM task lists), quotes, code, rules, tables;
// bold, italic, strikethrough, code, links. What it cannot (underline,
// alignment) is dropped on the way back, so the description editor does not
// offer it.

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inlineHtml(nodes: Inline[]): string {
  return nodes.map((n) => {
    switch (n.t) {
      case 'text': return esc(n.v).replace(/\n/g, '<br>');
      case 'strong': return `<strong>${inlineHtml(n.c)}</strong>`;
      case 'em': return `<em>${inlineHtml(n.c)}</em>`;
      case 'del': return `<s>${inlineHtml(n.c)}</s>`;
      case 'code': return `<code>${esc(n.v)}</code>`;
      case 'link': return `<a href="${esc(n.href)}">${inlineHtml(n.c)}</a>`;
    }
  }).join('');
}

function listHtml(b: ListBlock): string {
  const items = b.items.map((it) => {
    const checked = b.task ? ` data-checked="${it.checked ? 'true' : 'false'}"` : '';
    return `<li${checked}>${inlineHtml(it.c)}${it.sub ? listHtml(it.sub) : ''}</li>`;
  }).join('');
  return b.task ? `<ul data-checklist="true">${items}</ul>` : `<${b.t}>${items}</${b.t}>`;
}

function blockHtml(b: Block): string {
  switch (b.t) {
    case 'h': return `<h${b.level}>${inlineHtml(b.c)}</h${b.level}>`;
    case 'p': return `<p>${inlineHtml(b.c)}</p>`;
    case 'ul': case 'ol': return listHtml(b);
    case 'code': return b.lang ? `<pre data-lang="${esc(b.lang)}">${esc(b.v)}</pre>` : `<pre>${esc(b.v)}</pre>`;
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

const isList = (el: Element) => el.tagName === 'UL' || el.tagName === 'OL';

function inlineMd(node: Node): string {
  let out = '';
  node.childNodes.forEach((c) => {
    if (c.nodeType === 3) { out += (c.textContent ?? '').replace(/ /g, ' '); return; }
    if (c.nodeType !== 1) return;
    const el = c as Element;
    const tag = el.tagName.toLowerCase();
    if (isList(el)) return; // a nested list is its own lines (listMd)
    const inner = inlineMd(el);
    if (tag === 'br') out += '\n';
    else if (tag === 'strong' || tag === 'b') out += inner.trim() ? `**${inner}**` : inner;
    else if (tag === 'em' || tag === 'i') out += inner.trim() ? `*${inner}*` : inner;
    else if (tag === 's' || tag === 'strike' || tag === 'del') out += inner.trim() ? `~~${inner}~~` : inner;
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

/** A list as Markdown lines, its nested lists indented under their item by
 *  the item marker's width. A nested list may sit inside its <li> or — as
 *  the browser's indent leaves it — right after it as the list's own child
 *  (or alone in an otherwise empty <li>); both belong to the item before. */
function listMd(el: Element, pad: string): string[] {
  const ordered = el.tagName === 'OL';
  const task = el.getAttribute('data-checklist') === 'true';
  const items: { text: string; checked: boolean; subs: Element[] }[] = [];
  for (const c of [...el.children]) {
    if (isList(c)) {
      if (items.length) items[items.length - 1].subs.push(c);
      else items.push({ text: '', checked: false, subs: [c] });
      continue;
    }
    if (c.tagName !== 'LI') continue;
    const text = oneLine(inlineMd(c));
    const subs = [...c.children].filter(isList);
    if (!text && subs.length && items.length) { items[items.length - 1].subs.push(...subs); continue; }
    if (!text && !subs.length) continue;
    items.push({ text, checked: c.getAttribute('data-checked') === 'true', subs });
  }
  const out: string[] = [];
  items.forEach((it, i) => {
    const marker = ordered ? `${i + 1}.` : '-';
    if (it.text) out.push(`${pad}${marker} ${task ? `[${it.checked ? 'x' : ' '}] ` : ''}${it.text}`);
    // An item with no text of its own: its nested items take its place.
    const subPad = it.text ? pad + ' '.repeat(marker.length + 1) : pad;
    for (const sub of it.subs) out.push(...listMd(sub, subPad));
  });
  return out;
}

function blockMd(el: Element): string | null {
  const tag = el.tagName.toLowerCase();
  switch (tag) {
    case 'h1': case 'h2': case 'h3': {
      const text = oneLine(inlineMd(el));
      return text ? `${'#'.repeat(Number(tag[1]))} ${text}` : null;
    }
    case 'ul': case 'ol': {
      const lines = listMd(el, '');
      return lines.length ? lines.join('\n') : null;
    }
    case 'pre': {
      const text = (el.textContent ?? '').replace(/\n+$/, '');
      const lang = el.getAttribute('data-lang') ?? '';
      return text ? `\`\`\`${lang}\n${text}\n\`\`\`` : null;
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
    if (['strong', 'b', 'em', 'i', 'code', 'a', 'span', 'u', 's', 'strike', 'del', 'br'].includes(el.tagName.toLowerCase())) {
      const wrap = doc.createElement('span'); wrap.appendChild(el.cloneNode(true)); loose += inlineMd(wrap); return;
    }
    flush();
    const md = blockMd(el);
    if (md) blocks.push(md);
  });
  flush();
  return blocks.join('\n\n');
}
