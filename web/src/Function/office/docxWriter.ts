import JSZip from 'jszip';

// A Note written as a Word document: headings as Word's Heading 1–3 (so
// Word's navigation pane and table of contents see them), paragraphs with
// their alignment, bulleted and numbered lists nested as Word lists (each
// numbered list counting from 1), checklists as ☐ / ☑, quotes, code blocks,
// rules, tables with their column widths and merged cells, links, and bold,
// italic, underline, strike and inline code. Read with DOMParser — the
// browser, or jsdom in the tests — and written with JSZip alone.

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

interface Look { b?: boolean; i?: boolean; u?: boolean; s?: boolean; code?: boolean }

function runXml(text: string, look: Look): string {
  const pr = [look.b && '<w:b/>', look.i && '<w:i/>', look.u && '<w:u w:val="single"/>', look.s && '<w:strike/>',
    look.code && '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>']
    .filter(Boolean).join('');
  return `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

class Writer {
  links: string[] = [];
  /** One numbering instance per numbered list, so each counts from 1. */
  numbered = 0;
  out: string[] = [];

  /** Runs for a node's inline content. */
  inline(node: Node, look: Look = {}): string {
    if (node.nodeType === 3) {
      const text = (node.nodeValue ?? '').replace(/\s+/g, ' ');
      return text ? runXml(text, look) : '';
    }
    if (node.nodeType !== 1) return '';
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (tag === 'br') return '<w:r><w:br/></w:r>';
    if (tag === 'ul' || tag === 'ol') return '';
    const next: Look = {
      ...look,
      ...(tag === 'strong' || tag === 'b' ? { b: true } : {}),
      ...(tag === 'em' || tag === 'i' ? { i: true } : {}),
      ...(tag === 'u' ? { u: true } : {}),
      ...(tag === 's' || tag === 'strike' || tag === 'del' ? { s: true } : {}),
      ...(tag === 'code' ? { code: true } : {}),
    };
    const inner = Array.from(el.childNodes).map((c) => this.inline(c, next)).join('');
    if (tag === 'a') {
      const href = el.getAttribute('href') ?? '';
      if (!/^(https?:|mailto:)/i.test(href)) return inner;
      this.links.push(href);
      return `<w:hyperlink r:id="rLink${this.links.length}">${inner.replace(/<w:rPr>/g, '<w:rPr><w:rStyle w:val="Hyperlink"/>').replace(/<w:r>(?!<w:rPr>)/g, '<w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr>')}</w:hyperlink>`;
    }
    return inner;
  }

  para(runs: string, opts: { style?: string; align?: string | null; num?: [number, number]; border?: boolean } = {}): string {
    const pr = [
      opts.style && `<w:pStyle w:val="${opts.style}"/>`,
      opts.num && `<w:numPr><w:ilvl w:val="${opts.num[1]}"/><w:numId w:val="${opts.num[0]}"/></w:numPr>`,
      opts.border && '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="BFBFBF"/></w:pBdr>',
      opts.align === 'center' || opts.align === 'right' ? `<w:jc w:val="${opts.align}"/>` : '',
    ].filter(Boolean).join('');
    return `<w:p>${pr ? `<w:pPr>${pr}</w:pPr>` : ''}${runs}</w:p>`;
  }

  list(el: Element, level: number) {
    const ordered = el.tagName.toLowerCase() === 'ol';
    const checklist = el.getAttribute('data-checklist') === 'true';
    // Bullets share instance 1; each numbered list gets its own instance (2, 3, …).
    const numId = ordered ? 2 + this.numbered++ : 1;
    for (const li of Array.from(el.children)) {
      if (li.tagName.toLowerCase() !== 'li') continue;
      const box = checklist ? runXml(li.getAttribute('data-checked') === 'true' ? '☑ ' : '☐ ', {}) : '';
      const runs = Array.from(li.childNodes).map((c) => this.inline(c)).join('');
      this.out.push(this.para(box + runs, checklist ? { style: 'ListParagraph' } : { style: 'ListParagraph', num: [numId, Math.min(level, 8)] }));
      for (const sub of Array.from(li.children)) {
        const t = sub.tagName.toLowerCase();
        if (t === 'ul' || t === 'ol') this.list(sub, level + 1);
      }
    }
  }

  table(el: Element) {
    const widths = Array.from(el.querySelectorAll('col')).map((c) => Number(c.getAttribute('style')?.match(/width\s*:\s*([\d.]+)px/)?.[1] ?? 0));
    const rows = Array.from(el.querySelectorAll('tr'));
    // Cells still covered by a merge from a row above: column → rows left.
    const covered = new Map<number, { left: number; span: number }>();
    const cols = Math.max(widths.length, ...rows.map((tr) => Array.from(tr.children).reduce((n, td) => n + Math.max(1, Number(td.getAttribute('colspan')) || 1), 0)));
    const grid = Array.from({ length: cols }, (_, i) => Math.round((widths[i] || 120) * 15));
    const body = rows.map((tr) => {
      const cells: string[] = [];
      const tds = Array.from(tr.children).filter((c) => /^t[dh]$/i.test(c.tagName));
      let col = 0;
      const fillCovered = () => {
        while (covered.has(col)) {
          const c = covered.get(col)!;
          cells.push(`<w:tc><w:tcPr>${c.span > 1 ? `<w:gridSpan w:val="${c.span}"/>` : ''}<w:vMerge/></w:tcPr><w:p/></w:tc>`);
          if (--c.left <= 0) covered.delete(col);
          col += c.span;
        }
      };
      for (const td of tds) {
        fillCovered();
        const span = Math.max(1, Number(td.getAttribute('colspan')) || 1);
        const rowSpan = Math.max(1, Number(td.getAttribute('rowspan')) || 1);
        if (rowSpan > 1) covered.set(col, { left: rowSpan - 1, span });
        const lines = td.innerHTML.split(/<br\s*\/?>/i).map((h) => {
          const holder = td.ownerDocument.createElement('div');
          holder.innerHTML = h;
          return this.para(Array.from(holder.childNodes).map((c) => this.inline(c, td.tagName.toLowerCase() === 'th' ? { b: true } : {})).join(''), { align: td.getAttribute('data-align') });
        });
        cells.push(`<w:tc><w:tcPr><w:tcW w:w="${grid.slice(col, col + span).reduce((a, b) => a + b, 0)}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}${rowSpan > 1 ? '<w:vMerge w:val="restart"/>' : ''}</w:tcPr>${lines.join('') || '<w:p/>'}</w:tc>`);
        col += span;
      }
      fillCovered();
      return `<w:tr>${cells.join('')}</w:tr>`;
    }).join('');
    const border = (side: string) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>`;
    this.out.push(`<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr>`
      + `<w:tblGrid>${grid.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${body}</w:tbl>`);
    // Word needs a paragraph between a table and whatever follows it.
    this.out.push('<w:p/>');
  }

  block(node: Node) {
    if (node.nodeType === 3) {
      if ((node.nodeValue ?? '').trim()) this.out.push(this.para(this.inline(node)));
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    const align = el.getAttribute('data-align');
    const runs = () => Array.from(el.childNodes).map((c) => this.inline(c)).join('');
    if (/^h[1-3]$/.test(tag)) this.out.push(this.para(runs(), { style: `Heading${tag[1]}`, align }));
    else if (tag === 'p' || tag === 'div') this.out.push(this.para(runs(), { align }));
    else if (tag === 'blockquote') this.out.push(this.para(runs(), { style: 'Quote', align }));
    else if (tag === 'pre') for (const line of (el.textContent ?? '').replace(/\n$/, '').split('\n')) this.out.push(this.para(runXml(line, {}), { style: 'Code' }));
    else if (tag === 'hr') this.out.push(this.para('', { border: true }));
    else if (tag === 'ul' || tag === 'ol') this.list(el, 0);
    else if (tag === 'table') this.table(el);
    else this.out.push(this.para(runs(), { align }));
  }
}

const STYLES = `${XML}<w:styles ${W_NS}>`
  + '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Yu Gothic" w:cs="Calibri"/><w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="en-US" w:eastAsia="ja-JP"/></w:rPr></w:rPrDefault>'
  + '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
  + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
  + [[1, 32], [2, 28], [3, 24]].map(([n, sz]) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="${360 - n * 60}" w:after="120"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr></w:style>`).join('')
  + '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="40"/></w:pPr></w:style>'
  + '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="BFBFBF"/></w:pBdr><w:ind w:left="240"/></w:pPr><w:rPr><w:i/><w:color w:val="595959"/></w:rPr></w:style>'
  + '<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="19"/></w:rPr></w:style>'
  + '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>'
  + '</w:styles>';

function numbering(numberedLists: number): string {
  const bullets = ['•', '◦', '▪'];
  const level = (i: number, fmt: string, text: string) => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${420 * (i + 1)}" w:hanging="300"/></w:pPr></w:lvl>`;
  const decimal = (i: number) => (['decimal', 'lowerLetter', 'lowerRoman'] as const)[i % 3];
  return `${XML}<w:numbering ${W_NS}>`
    + `<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${Array.from({ length: 9 }, (_, i) => level(i, 'bullet', bullets[i % 3])).join('')}</w:abstractNum>`
    + `<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${Array.from({ length: 9 }, (_, i) => level(i, decimal(i), `%${i + 1}.`)).join('')}</w:abstractNum>`
    + '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>'
    + Array.from({ length: numberedLists }, (_, k) => `<w:num w:numId="${k + 2}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`).join('')
    + '</w:numbering>';
}

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** A Note's HTML as a Word document's bytes, with `title` as its first heading when given. */
export async function writeDocx(html: string, title?: string): Promise<Uint8Array> {
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}`, 'text/html');
  const w = new Writer();
  if (title?.trim()) w.out.push(w.para(runXml(title.trim(), {}), { style: 'Heading1' }));
  for (const node of Array.from(doc.body.childNodes)) w.block(node);
  const body = w.out.join('') || '<w:p/>';
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
    + '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>');
  zip.file('_rels/.rels', `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/_rels/document.xml.rels', `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + '<Relationship Id="rStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    + '<Relationship Id="rNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>'
    + w.links.map((href, i) => `<Relationship Id="rLink${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${esc(href)}" TargetMode="External"/>`).join('')
    + '</Relationships>');
  zip.file('word/styles.xml', STYLES);
  zip.file('word/numbering.xml', numbering(w.numbered));
  // A4 with 25 mm margins.
  zip.file('word/document.xml', `${XML}<w:document ${W_NS}><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1418" w:right="1418" w:bottom="1418" w:left="1418" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr></w:body></w:document>`);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
