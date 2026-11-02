// A small Markdown reader for what agents write: headings, paragraphs,
// lists (nested by indentation, and GFM task lists `- [ ]` / `- [x]`),
// tables, fenced code, quotes, rules, and inline bold / italic / strike /
// code / links. Pure — it returns a tree; MarkdownLite renders it as React
// elements, so no HTML from the text ever reaches the DOM. Links are kept
// only for http(s) and mailto.

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'strong'; c: Inline[] }
  | { t: 'em'; c: Inline[] }
  | { t: 'del'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; c: Inline[] };

/** One list item. `checked` is set only in a task list; `sub` is the list
 *  indented under it. */
export type ListItem = { c: Inline[]; checked?: boolean; sub?: ListBlock };

/** `task`: a GFM task list — every item carries `checked`. */
export type ListBlock = { t: 'ul' | 'ol'; items: ListItem[]; task?: true };

export type Block =
  | { t: 'h'; level: 1 | 2 | 3; c: Inline[] }
  | { t: 'p'; c: Inline[] }
  | ListBlock
  | { t: 'table'; head: Inline[][]; rows: Inline[][][] }
  /** `lang`: the fence's language (```mermaid → 'mermaid'), lower-cased. */
  | { t: 'code'; v: string; lang?: string }
  | { t: 'quote'; c: Inline[] }
  | { t: 'hr' };

const SAFE_HREF = /^(https?:\/\/|mailto:)/i;

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  const flush = () => { if (buf) { out.push({ t: 'text', v: buf }); buf = ''; } };
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    let m: RegExpMatchArray | null;
    if ((m = rest.match(/^`([^`]+)`/))) { flush(); out.push({ t: 'code', v: m[1] }); i += m[0].length; continue; }
    if ((m = rest.match(/^\*\*([^*]+?)\*\*/)) || (m = rest.match(/^__([^_]+?)__/))) { flush(); out.push({ t: 'strong', c: parseInline(m[1]) }); i += m[0].length; continue; }
    if ((m = rest.match(/^~~([^~]+?)~~/))) { flush(); out.push({ t: 'del', c: parseInline(m[1]) }); i += m[0].length; continue; }
    if ((m = rest.match(/^\*([^*\s][^*]*?)\*/))) { flush(); out.push({ t: 'em', c: parseInline(m[1]) }); i += m[0].length; continue; }
    if ((m = rest.match(/^\[([^\]]+)\]\(([^)\s]+)\)/))) {
      flush();
      if (SAFE_HREF.test(m[2])) out.push({ t: 'link', href: m[2], c: parseInline(m[1]) });
      else out.push({ t: 'text', v: m[1] });
      i += m[0].length;
      continue;
    }
    buf += src[i];
    i++;
  }
  flush();
  return out;
}

function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

const isTableSep = (line: string) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TASK = /^\[([ xX])\]\s+/;

const indentOf = (s: string) => s.replace(/\t/g, '    ').length;

/** The list starting at `lines[start]`, and the line after it. Items at the
 *  first item's indent belong to it; a deeper-indented item starts a list
 *  under the item before it. The list ends at a line that is not an item, an
 *  item indented less, or an item whose kind (bullet / numbered / task)
 *  differs. */
function parseList(lines: string[], start: number): [ListBlock, number] {
  const first = lines[start].match(LIST_ITEM)!;
  const indent = indentOf(first[1]);
  const ordered = /\d/.test(first[2]);
  const task = !ordered && TASK.test(first[3]);
  const items: ListItem[] = [];
  let i = start;
  while (i < lines.length) {
    const m = lines[i].match(LIST_ITEM);
    if (!m) break;
    const ind = indentOf(m[1]);
    if (ind < indent) break;
    if (ind > indent) {
      const prev = items[items.length - 1];
      if (!prev || prev.sub) break;
      const [sub, next] = parseList(lines, i);
      prev.sub = sub;
      i = next;
      continue;
    }
    const tm = ordered ? null : m[3].match(TASK);
    if (/\d/.test(m[2]) !== ordered || !!tm !== task) break;
    items.push(tm ? { c: parseInline(m[3].slice(tm[0].length)), checked: tm[1] !== ' ' } : { c: parseInline(m[3]) });
    i++;
  }
  return [task ? { t: 'ul', items, task: true } : { t: ordered ? 'ol' : 'ul', items }, i];
}

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) { blocks.push({ t: 'p', c: parseInline(para.join('\n')) }); para = []; }
  };
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      flushPara();
      const lang = line.slice(3).trim().toLowerCase().match(/^[a-z0-9+#-]{1,20}/)?.[0];
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
      i++;
      blocks.push(lang ? { t: 'code', v: body.join('\n'), lang } : { t: 'code', v: body.join('\n') });
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { flushPara(); blocks.push({ t: 'h', level: Math.min(3, h[1].length) as 1 | 2 | 3, c: parseInline(h[2]) }); i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flushPara(); blocks.push({ t: 'hr' }); i++; continue; }
    if (/^\s*\|/.test(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      flushPara();
      const head = splitRow(line).map(parseInline);
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(splitRow(lines[i++]).map(parseInline));
      blocks.push({ t: 'table', head, rows });
      continue;
    }
    if (LIST_ITEM.test(line)) {
      flushPara();
      const [list, next] = parseList(lines, i);
      blocks.push(list);
      i = next;
      continue;
    }
    if (/^>\s?/.test(line)) {
      flushPara();
      const body: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ''));
      blocks.push({ t: 'quote', c: parseInline(body.join('\n')) });
      continue;
    }
    if (!line.trim()) { flushPara(); i++; continue; }
    para.push(line);
    i++;
  }
  flushPara();
  return blocks;
}
