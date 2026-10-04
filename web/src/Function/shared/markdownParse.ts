// A small Markdown reader for what agents write: headings, paragraphs,
// lists, tables, fenced code, quotes, rules, and inline bold / italic /
// code / links. Pure — it returns a tree; MarkdownLite renders it as React
// elements, so no HTML from the text ever reaches the DOM. Links are kept
// only for http(s) and mailto.

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'strong'; c: Inline[] }
  | { t: 'em'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; c: Inline[] };

export type Block =
  | { t: 'h'; level: 1 | 2 | 3; c: Inline[] }
  | { t: 'p'; c: Inline[] }
  | { t: 'ul' | 'ol'; items: Inline[][] }
  | { t: 'table'; head: Inline[][]; rows: Inline[][][] }
  | { t: 'code'; v: string }
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
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
      i++;
      blocks.push({ t: 'code', v: body.join('\n') });
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
    if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      flushPara();
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: Inline[][] = [];
      while (i < lines.length && (ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*+]\s+/).test(lines[i])) {
        items.push(parseInline(lines[i].replace(ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*+]\s+/, '')));
        i++;
      }
      blocks.push({ t: ordered ? 'ol' : 'ul', items });
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
