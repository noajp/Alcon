import type { DocBlock, DocLayout, DocPara, DocRun, DocTable } from './docLayout';

// A Word document as a Note's HTML, in the shape the Note editor keeps
// (htmlSanitizer): headings ranked by size into h1–h3, list items nested by
// their indent into ul/ol, runs as strong/em/u/s, centred and right-aligned
// paragraphs as data-align, tables as Note tables with their column widths
// and merges, footnotes as a numbered list after a rule. What a Note cannot
// hold — page layout, header and footer, fonts, colours, pictures — stays
// in the file.

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A list marker that is a symbol rather than a number or letter. */
const isBullet = (marker: string) => !/[0-9a-zA-Zⅰ-ⅿⅠ-Ⅿ一二三四五六七八九十①-⑳]/.test(marker);

function runHtml(r: DocRun): string {
  if (r.image) return '';
  let s = esc(r.text).replace(/\t/g, ' ').replace(/\n/g, '<br>');
  if (!s) return '';
  if (r.strike) s = `<s>${s}</s>`;
  if (r.underline) s = `<u>${s}</u>`;
  if (r.italic) s = `<em>${s}</em>`;
  if (r.bold) s = `<strong>${s}</strong>`;
  return s;
}

const sizeOf = (p: DocPara) => Math.max(0, ...p.runs.map((r) => r.size));
const inline = (p: DocPara) => p.runs.map(runHtml).join('');
const alignAttr = (p: DocPara) => (p.align === 'center' || p.align === 'right' ? ` data-align="${p.align}"` : '');
/** Text boxes inside a paragraph's runs, as blocks of their own after it. */
const boxesOf = (p: DocPara) => p.runs.flatMap((r) => r.box?.blocks ?? []);

function tableHtml(t: DocTable): string {
  const cols = t.cols.some((w) => w > 0) ? `<colgroup>${t.cols.map((w) => (w > 0 ? `<col style="width:${Math.round(w)}px">` : '<col>')).join('')}</colgroup>` : '';
  const rows = t.rows.map((row) => `<tr>${row.filter((c) => !c.skip).map((c) => {
    const span = (c.span > 1 ? ` colspan="${c.span}"` : '') + (c.rowSpan > 1 ? ` rowspan="${c.rowSpan}"` : '');
    // A cell holds inline content: its paragraphs become lines.
    const lines = c.blocks.flatMap((b) => (b.kind === 'p' ? [inline(b)] : b.kind === 'table' ? [plainText(b)] : []));
    const p = c.blocks.find((b): b is DocPara => b.kind === 'p');
    return `<td${span}${p ? alignAttr(p) : ''}>${lines.join('<br>')}</td>`;
  }).join('')}</tr>`).join('');
  return `<table data-note-table="true">${cols}<tbody>${rows}</tbody></table>`;
}

/** A nested table, which a Note cell cannot hold, as its text. */
function plainText(t: DocTable): string {
  return t.rows.map((row) => row.filter((c) => !c.skip).map((c) => c.blocks.map((b) => (b.kind === 'p' ? inline(b) : '')).join(' ')).join(' / ')).join('<br>');
}

interface Ctx { headingRank: Map<number, number> }

/** Heading sizes, largest first, as h1, h2, h3 (the rest h3). */
function rankHeadings(blocks: DocBlock[]): Map<number, number> {
  const sizes = new Set(blocks.flatMap((b) => (b.kind === 'p' && b.heading ? [sizeOf(b)] : [])));
  return new Map([...sizes].sort((a, b) => b - a).map((s, i) => [s, Math.min(3, i + 1)]));
}

function blocksHtml(blocks: DocBlock[], ctx: Ctx): string {
  const out: string[] = [];
  // Open lists, outermost first: each with the indent its items sit at.
  const lists: { tag: 'ul' | 'ol'; indent: number }[] = [];
  let liOpen = false;
  const closeTo = (depth: number) => {
    while (lists.length > depth) {
      if (liOpen) out.push('</li>');
      out.push(`</${lists.pop()!.tag}>`);
      liOpen = lists.length > 0;
    }
  };
  let blank = false;

  for (const b of blocks) {
    if (b.kind === 'break') continue;
    if (b.kind === 'p' && b.marker) {
      const tag = isBullet(b.marker) ? 'ul' : 'ol';
      while (lists.length && lists[lists.length - 1].indent > b.indent) closeTo(lists.length - 1);
      const top = lists[lists.length - 1];
      if (!top || b.indent > top.indent) {
        out.push(`<${tag}>`);
        lists.push({ tag, indent: b.indent });
        liOpen = false;
      } else if (top.tag !== tag) {
        closeTo(lists.length - 1);
        out.push(`<${tag}>`);
        lists.push({ tag, indent: b.indent });
        liOpen = false;
      } else if (liOpen) {
        out.push('</li>');
      }
      out.push(`<li>${inline(b) || '<br>'}`);
      liOpen = true;
      blank = false;
      continue;
    }
    closeTo(0);
    if (b.kind === 'table') {
      out.push(tableHtml(b));
      blank = false;
      continue;
    }
    // A heading is bold already; bold on its runs is the heading's own look.
    const body = inline(b.heading ? { ...b, runs: b.runs.map((r) => ({ ...r, bold: false })) } : b);
    if (!body) {
      // Word spaces with empty paragraphs; a run of them is one blank line.
      if (!blank && out.length) out.push('<p><br></p>');
      blank = true;
    } else if (b.heading) {
      const h = ctx.headingRank.get(sizeOf(b)) ?? 3;
      out.push(`<h${h}${alignAttr(b)}>${body}</h${h}>`);
      blank = false;
    } else {
      out.push(`<p${alignAttr(b)}>${body}</p>`);
      blank = false;
    }
    const boxes = boxesOf(b);
    if (boxes.length) out.push(blocksHtml(boxes, ctx));
  }
  closeTo(0);
  while (out[out.length - 1] === '<p><br></p>') out.pop();
  return out.join('');
}

/** Pure. The document's body (and its footnotes) as Note HTML. */
export function docToNoteHtml(doc: Pick<DocLayout, 'blocks' | 'footnotes'>): string {
  const ctx: Ctx = { headingRank: rankHeadings(doc.blocks) };
  let html = blocksHtml(doc.blocks, ctx);
  const notes = doc.footnotes.map((n) => n.flatMap((b) => (b.kind === 'p' ? [inline(b)] : [])).filter(Boolean).join('<br>'));
  if (notes.some(Boolean)) html += `<hr><ol>${notes.map((n) => `<li>${n || '<br>'}</li>`).join('')}</ol>`;
  return html;
}
