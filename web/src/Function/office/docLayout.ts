import { first, kid, kids, openPackage, relId, relOfType, themeColors as readThemeColors, twip } from './ooxml';

// A Word document read for drawing it as Word lays it out: the page's
// width and margins; paragraphs with their style (followed through
// basedOn to the document defaults), alignment, spacing and indents; runs
// with weight, slant, underline, strike, size, colour, highlight and font
// (theme fonts resolved); numbered and bulleted lists counted as Word
// counts them; tables with column widths, cell shading, merges, borders
// and their table style (header row, banded rows); pictures inline or
// floating, and text boxes; footnotes; the page's header and footer; its
// columns; and the fonts the document embeds. Sizes are CSS pixels (1440
// twips = 96px). Read with DOMParser — the browser, or jsdom in the tests.

export interface DocRun {
  text: string; bold: boolean; italic: boolean; underline: boolean; strike: boolean;
  size: number; color: string | null; font: string | null; highlight: string | null;
  script?: 'super' | 'sub';
  image?: { src: string; w: number; h: number; float: 'left' | 'right' | null };
  /** A text box: its own paragraphs, at its width, floating or in line. */
  box?: { blocks: DocBlock[]; w: number; float: 'left' | 'right' | null };
}
export interface DocPara {
  kind: 'p'; align: 'left' | 'center' | 'right' | 'justify';
  before: number; after: number; line: number | null; indent: number; firstLine: number;
  marker: string | null; runs: DocRun[]; heading: boolean;
  /** Where the paragraph is in document.xml (its order among every w:p),
   *  when its text is plain runs only and so can be edited as text. */
  src?: number;
}
export interface DocCell { blocks: DocBlock[]; fill: string | null; span: number; rowSpan: number; skip: boolean; borders: boolean; borderColor: string | null }
export interface DocTable { kind: 'table'; cols: number[]; rows: DocCell[][] }
export type DocBlock = DocPara | DocTable | { kind: 'break' };
export interface DocFont { family: string; data: ArrayBuffer; bold: boolean; italic: boolean }
export interface DocLayout {
  width: number; margin: { top: number; right: number; bottom: number; left: number }; columns: number;
  blocks: DocBlock[]; header: DocBlock[]; footer: DocBlock[];
  /** Footnotes in the order they are referenced, numbered from 1. */
  footnotes: DocBlock[][];
  fonts: DocFont[];
}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const val = (el: Element | null | undefined, name = 'val') => el?.getAttributeNS(W, name) ?? el?.getAttribute(`w:${name}`) ?? null;
const on = (el: Element | null) => !!el && !['0', 'false', 'off'].includes(val(el) ?? '');

// Word's highlight names as the file format defines them (hex, no #).
const HIGHLIGHT: Record<string, string> = {
  yellow: 'ffff00', green: '00ff00', cyan: '00ffff', magenta: 'ff00ff', blue: '0000ff', red: 'ff0000',
  darkBlue: '000080', darkCyan: '008080', darkGreen: '008000', darkMagenta: '800080', darkRed: '800000',
  darkYellow: '808000', darkGray: '808080', lightGray: 'c0c0c0', black: '000000',
};

/** Pure. A list counter in Word's number formats. */
function counter(n: number, fmt: string): string {
  if (fmt === 'lowerLetter' || fmt === 'upperLetter') {
    let s = '';
    for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(97 + ((x - 1) % 26)) + s;
    return fmt === 'upperLetter' ? s.toUpperCase() : s;
  }
  if (fmt === 'lowerRoman' || fmt === 'upperRoman') {
    const map: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
    let s = '', x = n;
    for (const [v, r] of map) while (x >= v) { s += r; x -= v; }
    return fmt === 'upperRoman' ? s.toUpperCase() : s;
  }
  if (fmt === 'decimalFullWidth') return String(n).replace(/\d/g, (d) => String.fromCharCode(0xff10 + Number(d)));
  return String(n);
}

/** Reads a .docx's bytes into its layout. */
export async function readDocLayout(bytes: ArrayBuffer): Promise<DocLayout> {
  const pkg = await openPackage(bytes);
  const { xml } = pkg;
  const doc = await xml('word/document.xml');
  const body = doc?.getElementsByTagNameNS(W, 'body')[0] ?? null;
  if (!body) throw new Error('No document body');
  // Every paragraph of the body part in document order: an edit names a
  // paragraph by this index (see officeEdits).
  const paraIndex = new Map(Array.from(doc!.getElementsByTagNameNS(W, 'p')).map((p, i) => [p, i]));

  /** A part's relationships: id → part path. */
  const relsOf = async (part: string) => new Map([...(await pkg.rels(part)).entries()].map(([id, r]) => [id, r.target]));
  const rels = await relsOf('word/document.xml');
  const rid = (el: Element | null | undefined, name: string) => relId(el, name);

  const sect = kids(body, 'sectPr')[0] ?? null;
  const pgSz = kid(sect, 'pgSz'), pgMar = kid(sect, 'pgMar');
  const pageWidth = twip(val(pgSz, 'w') ?? '11906');
  const marginL = twip(val(pgMar, 'left') ?? '1440'), marginR = twip(val(pgMar, 'right') ?? '1440');
  const noteOrder: string[] = [];

  // Theme fonts and colours.
  const themeDoc = await xml(relOfType(await pkg.rels('word/document.xml'), 'theme') ?? 'word/theme/theme1.xml');
  const themeFace = (group: string, script: 'latin' | 'ea') => kid(first(themeDoc, group), script)?.getAttribute('typeface') || null;
  const themeColors = readThemeColors(themeDoc);

  // Styles: each resolved through basedOn into ordered property elements.
  const stylesDoc = await xml('word/styles.xml');
  const styles = new Map<string, Element>();
  for (const s of Array.from(stylesDoc?.getElementsByTagNameNS(W, 'style') ?? [])) styles.set(val(s, 'styleId') ?? '', s);
  const defaultPara = Array.from(stylesDoc?.getElementsByTagNameNS(W, 'style') ?? []).find((s) => val(s, 'type') === 'paragraph' && val(s, 'default') === '1');
  const docDefaults = stylesDoc?.getElementsByTagNameNS(W, 'docDefaults')[0];
  const chainOf = (id: string | null, seen = new Set<string>()): Element[] => {
    const s = id ? styles.get(id) : null;
    if (!s || seen.has(id!)) return [];
    seen.add(id!);
    return [s, ...chainOf(val(kid(s, 'basedOn')), seen)];
  };

  // Numbering: numId → level → format, text, indent.
  const numberingDoc = await xml('word/numbering.xml');
  const abstracts = new Map<string, Element>();
  for (const a of Array.from(numberingDoc?.getElementsByTagNameNS(W, 'abstractNum') ?? [])) abstracts.set(val(a, 'abstractNumId') ?? '', a);
  const nums = new Map<string, Element>();
  for (const n of Array.from(numberingDoc?.getElementsByTagNameNS(W, 'num') ?? [])) {
    const a = abstracts.get(val(kid(n, 'abstractNumId')) ?? '');
    if (a) nums.set(val(n, 'numId') ?? '', a);
  }
  const counters = new Map<string, number[]>();

  const color = (el: Element | null): string | null => {
    if (!el) return null;
    const v = val(el);
    const th = val(el, 'themeColor');
    if (th) {
      const map: Record<string, string> = { text1: 'dk1', background1: 'lt1', text2: 'dk2', background2: 'lt2', dark1: 'dk1', light1: 'lt1', dark2: 'dk2', light2: 'lt2' };
      const hex = themeColors[map[th] ?? th];
      if (hex) return `#${hex.toLowerCase()}`;
    }
    return v && v !== 'auto' ? `#${v.toLowerCase()}` : null;
  };

  /** A run's properties, nearest first: the run, its character style, the
   *  paragraph style chain, the document defaults. */
  const runOf = (rPrs: Element[], text: string): DocRun => {
    const first = (name: string) => rPrs.map((r) => kid(r, name)).find(Boolean) ?? null;
    const fonts = first('rFonts');
    const face = (attr: string) => (fonts ? val(fonts, attr) : null);
    const themeAttr = face('eastAsiaTheme') ?? face('asciiTheme');
    const font = face('eastAsia') ?? face('ascii')
      ?? (themeAttr ? themeFace(themeAttr.startsWith('major') ? 'majorFont' : 'minorFont', themeAttr.includes('EastAsia') ? 'ea' : 'latin')
        ?? themeFace(themeAttr.startsWith('major') ? 'majorFont' : 'minorFont', 'latin') : null);
    const u = first('u');
    return {
      text,
      bold: on(first('b')), italic: on(first('i')),
      underline: !!u && val(u) !== 'none', strike: on(first('strike')),
      size: first('sz') ? Number(val(first('sz'))) / 2 : 10.5,
      color: color(first('color')),
      font,
      ...(val(first('vertAlign')) === 'superscript' ? { script: 'super' as const } : val(first('vertAlign')) === 'subscript' ? { script: 'sub' as const } : {}),
      highlight: (HIGHLIGHT[val(first('highlight')) ?? ''] ? `#${HIGHLIGHT[val(first('highlight'))!]}` : null) ?? (val(first('shd'), 'fill') && val(first('shd'), 'fill') !== 'auto' ? `#${val(first('shd'), 'fill')!.toLowerCase()}` : null),
    };
  };

  const dataUrl = (target: string | null | undefined) => pkg.dataUrl(target);
  /** Where a floating drawing sits: right when aligned or offset past the
   *  middle of the text column, else left; null for one in line. */
  const floatOf = (drawing: Element): 'left' | 'right' | null => {
    const anchor = Array.from(drawing.children).find((c) => c.localName === 'anchor');
    if (!anchor) return null;
    const posH = Array.from(anchor.children).find((c) => c.localName === 'positionH');
    const align = Array.from(posH?.children ?? []).find((c) => c.localName === 'align')?.textContent;
    if (align) return align === 'right' || align === 'outside' ? 'right' : 'left';
    const off = Number(Array.from(posH?.children ?? []).find((c) => c.localName === 'posOffset')?.textContent ?? 0) / 9525;
    return off > (pageWidth - marginL - marginR) / 2 ? 'right' : 'left';
  };
  /** A drawing: a picture, or a text box with its own paragraphs. */
  const drawingOf = async (drawing: Element, partRels: Map<string, string>, rPrs: Element[]): Promise<DocRun | null> => {
    const ext = drawing.getElementsByTagName('wp:extent')[0];
    const w = Number(ext?.getAttribute('cx') ?? 0) / 9525, h = Number(ext?.getAttribute('cy') ?? 0) / 9525;
    const float = floatOf(drawing);
    const txbx = Array.from(drawing.getElementsByTagName('*')).find((e) => e.localName === 'txbxContent');
    if (txbx) return { ...runOf(rPrs, ''), box: { blocks: await blocksOf(txbx, partRels), w, float } };
    const blip = drawing.getElementsByTagName('a:blip')[0];
    const src = await dataUrl(partRels.get(rid(blip, 'embed') ?? ''));
    return src ? { ...runOf(rPrs, ''), image: { src, w, h, float } } : null;
  };
  /** Legacy VML (<w:pict>): a text box or an image. */
  const pictOf = async (pict: Element, partRels: Map<string, string>, rPrs: Element[]): Promise<DocRun | null> => {
    const txbx = Array.from(pict.getElementsByTagName('*')).find((e) => e.localName === 'txbxContent');
    const shape = Array.from(pict.getElementsByTagName('*')).find((e) => e.localName === 'shape' || e.localName === 'rect');
    const width = Number(/width:\s*([\d.]+)pt/.exec(shape?.getAttribute('style') ?? '')?.[1] ?? 0) * 4 / 3;
    if (txbx) return { ...runOf(rPrs, ''), box: { blocks: await blocksOf(txbx, partRels), w: width, float: null } };
    const img = Array.from(pict.getElementsByTagName('*')).find((e) => e.localName === 'imagedata');
    const src = await dataUrl(partRels.get(rid(img, 'id') ?? ''));
    return src ? { ...runOf(rPrs, ''), image: { src, w: width, h: 0, float: null } } : null;
  };

  const paragraph = async (p: Element, partRels: Map<string, string> = rels): Promise<DocBlock[]> => {
    const pPr = kid(p, 'pPr');
    const styleId = val(kid(pPr, 'pStyle')) ?? (defaultPara ? val(defaultPara, 'styleId') : null);
    const chain = chainOf(styleId);
    const pPrs = [pPr, ...chain.map((s) => kid(s, 'pPr')), kid(kid(docDefaults, 'pPrDefault'), 'pPr')].filter((e): e is Element => !!e);
    const styleRPrs = [...chain.map((s) => kid(s, 'rPr')), kid(kid(docDefaults, 'rPrDefault'), 'rPr')].filter((e): e is Element => !!e);
    const pFirst = (name: string) => pPrs.map((x) => kid(x, name)).find(Boolean) ?? null;
    const spacing = pPrs.map((x) => kid(x, 'spacing')).filter((e): e is Element => !!e);
    const spAttr = (a: string) => spacing.map((s) => val(s, a)).find((v) => v != null) ?? null;
    const ind = pPrs.map((x) => kid(x, 'ind')).filter((e): e is Element => !!e);
    const indAttr = (...a: string[]) => ind.map((s) => a.map((n) => val(s, n)).find((v) => v != null)).find((v) => v != null) ?? null;
    const jc = val(pFirst('jc'));

    // A list item's marker, counted per list and level as Word does.
    let marker: string | null = null;
    let listIndent: number | null = null;
    const numPr = pFirst('numPr');
    const numId = val(kid(numPr, 'numId'));
    if (numId && numId !== '0' && nums.has(numId)) {
      const ilvl = Number(val(kid(numPr, 'ilvl')) ?? 0);
      const abs = nums.get(numId)!;
      const lvls = kids(abs, 'lvl');
      const lvl = lvls.find((l) => Number(val(l, 'ilvl')) === ilvl);
      const counts = counters.get(numId) ?? [];
      counts[ilvl] = (counts[ilvl] ?? Number(val(kid(lvl, 'start')) ?? 1) - 1) + 1;
      counts.length = ilvl + 1;
      counters.set(numId, counts);
      const fmt = val(kid(lvl, 'numFmt')) ?? 'decimal';
      const text = val(kid(lvl, 'lvlText')) ?? '';
      marker = fmt === 'bullet' ? (text && !/[-]/.test(text) ? text : '•')
        : text.replace(/%(\d)/g, (_, d) => counter(counts[Number(d) - 1] ?? 1, val(kid(lvls.find((l) => Number(val(l, 'ilvl')) === Number(d) - 1), 'numFmt')) ?? 'decimal'));
      listIndent = twip(val(kid(kid(lvl, 'pPr'), 'ind'), 'left') ?? val(kid(kid(lvl, 'pPr'), 'ind'), 'start'));
    }

    const out: DocBlock[] = [];
    if (on(pFirst('pageBreakBefore'))) out.push({ kind: 'break' });
    const runs: DocRun[] = [];
    // Plain: text runs only — tabs and line breaks included, but no picture,
    // note mark or field — in one piece: such a paragraph can be edited as text.
    let plain = true;
    const walk = async (el: Element) => {
      for (const node of Array.from(el.children)) {
        if (node.localName === 'r') {
          const rPr = kid(node, 'rPr');
          const rStyle = chainOf(val(kid(rPr, 'rStyle'))).map((s) => kid(s, 'rPr'));
          const rPrs = [rPr, ...rStyle, ...styleRPrs].filter((e): e is Element => !!e);
          for (const part of Array.from(node.children)) {
            if (part.localName === 't') runs.push(runOf(rPrs, part.textContent ?? ''));
            // A field's code or result is the field's, not text to retype; a
            // picture or note mark has no text. Tabs and line breaks are text.
            else if (['drawing', 'pict', 'footnoteReference', 'fldChar', 'instrText'].includes(part.localName)
              || (part.localName === 'br' && val(part, 'type') === 'page')) plain = false;
            if (part.localName === 't') continue;
            else if (part.localName === 'tab') runs.push(runOf(rPrs, '\t'));
            else if (part.localName === 'br') {
              if (val(part, 'type') === 'page') { if (runs.length) { out.push(paraOf()); runs.length = 0; } out.push({ kind: 'break' }); }
              else runs.push(runOf(rPrs, '\n'));
            } else if (part.localName === 'drawing') {
              const run = await drawingOf(part, partRels, rPrs);
              if (run) runs.push(run);
            } else if (part.localName === 'pict') {
              const run = await pictOf(part, partRels, rPrs);
              if (run) runs.push(run);
            } else if (part.localName === 'footnoteReference') {
              // Numbered in the order footnotes are referenced, as Word does.
              const id = val(part, 'id') ?? '';
              if (!noteOrder.includes(id)) noteOrder.push(id);
              runs.push({ ...runOf(rPrs, String(noteOrder.indexOf(id) + 1)), script: 'super' });
            }
          }
        } else if (['hyperlink', 'ins', 'smartTag', 'sdtContent', 'fldSimple'].includes(node.localName)) {
          if (node.localName === 'fldSimple') plain = false;
          await walk(node);
        }
        else if (node.localName === 'sdt') await walk(kid(node, 'sdtContent') ?? node);
      }
    };
    const paraOf = (): DocPara => ({
      kind: 'p',
      align: jc === 'center' ? 'center' : jc === 'right' || jc === 'end' ? 'right' : jc === 'both' || jc === 'distribute' ? 'justify' : 'left',
      before: twip(spAttr('before')), after: twip(spAttr('after') ?? '0'),
      line: spAttr('line') && (spAttr('lineRule') ?? 'auto') === 'auto' ? Number(spAttr('line')) / 240 : null,
      indent: listIndent ?? twip(indAttr('left', 'start')),
      firstLine: indAttr('hanging') ? -twip(indAttr('hanging')) : twip(indAttr('firstLine')),
      marker, runs: [...runs],
      heading: /^(heading|title|見出し)/i.test(styleId ?? '') || chain.some((s) => /^heading/i.test(val(kid(s, 'name')) ?? '')),
    });
    await walk(p);
    const para = paraOf();
    const index = paraIndex.get(p);
    if (plain && index !== undefined) para.src = index;
    out.push(para);
    return out;
  };

  // Tables nest; past this depth an inner table is read as its text only,
  // so a pathological file (thousands deep) cannot exhaust the stack.
  let tableDepth = 0;
  const MAX_TABLE_DEPTH = 24;
  const table = async (tbl: Element, partRels: Map<string, string> = rels): Promise<DocTable> => {
    if (tableDepth >= MAX_TABLE_DEPTH) {
      const text = (tbl.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 2000);
      return { kind: 'table', cols: [0], rows: [[{ blocks: [{ kind: 'p', align: 'left', before: 0, after: 0, line: null, indent: 0, firstLine: 0, marker: null, heading: false, runs: [{ text, bold: false, italic: false, underline: false, strike: false, size: 10.5, color: null, font: null, highlight: null }] }], fill: null, span: 1, rowSpan: 1, skip: false, borders: false, borderColor: null }]] };
    }
    tableDepth++;
    try { return await tableAt(tbl, partRels); } finally { tableDepth--; }
  };
  const tableAt = async (tbl: Element, partRels: Map<string, string>): Promise<DocTable> => {
    const cols = kids(kid(tbl, 'tblGrid'), 'gridCol').map((c) => twip(val(c, 'w')));
    const tblPr = kid(tbl, 'tblPr');
    // The table style: its borders, and what it does to the header row,
    // first column and banded rows — as far as the table's look asks.
    const style = chainOf(val(kid(tblPr, 'tblStyle')));
    const tblBorders = [kid(tblPr, 'tblBorders'), ...style.map((st) => kid(kid(st, 'tblPr'), 'tblBorders'))].find(Boolean) ?? null;
    const lines = tblBorders ? Array.from(tblBorders.children).filter((b) => !['nil', 'none'].includes(val(b) ?? '')) : [];
    // "Table Grid" is the grid; a file that names it without defining it
    // still means one.
    const borders = lines.length > 0 || (!style.length && /grid/i.test(val(kid(tblPr, 'tblStyle')) ?? ''));
    const borderColor = lines.map((b) => val(b, 'color')).filter((c) => c && c !== 'auto').map((c) => `#${c!.toLowerCase()}`)[0] ?? null;
    const part = (type: string) => style.flatMap((st) => kids(st, 'tblStylePr')).find((x) => val(x, 'type') === type) ?? null;
    const partFill = (x: Element | null) => { const f = val(kid(kid(x, 'tcPr'), 'shd'), 'fill'); return f && f !== 'auto' ? `#${f.toLowerCase()}` : null; };
    const look = kid(tblPr, 'tblLook');
    const lookVal = parseInt(val(look) ?? '04A0', 16);
    const lookOn = (attr: string, bit: number) => (look && val(look, attr) != null ? val(look, attr) === '1' : (lookVal & bit) !== 0);
    const firstRow = lookOn('firstRow', 0x20) ? part('firstRow') : null;
    const firstCol = lookOn('firstColumn', 0x80) ? part('firstCol') : null;
    const band = !lookOn('noHBand', 0x200) ? part('band1Horz') : null;
    const rows: DocCell[][] = [];
    for (const [r, tr] of kids(tbl, 'tr').entries()) {
      const row: DocCell[] = [];
      for (const [c, tc] of kids(tr, 'tc').entries()) {
        const tcPr = kid(tc, 'tcPr');
        const own = val(kid(tcPr, 'shd'), 'fill');
        const vMerge = kid(tcPr, 'vMerge');
        const blocks: DocBlock[] = [];
        for (const child of Array.from(tc.children)) {
          if (child.localName === 'p') blocks.push(...await paragraph(child, partRels));
          else if (child.localName === 'tbl') blocks.push(await table(child, partRels));
        }
        const region = r === 0 && firstRow ? firstRow : c === 0 && firstCol ? firstCol : null;
        if (region) {
          const rPr = kid(region, 'rPr');
          const bold = on(kid(rPr, 'b')), textColor = color(kid(rPr, 'color'));
          for (const b of blocks) if (b.kind === 'p') for (const run of b.runs) {
            if (bold) run.bold = true;
            if (textColor && !run.color) run.color = textColor;
          }
        }
        const fill = own && own !== 'auto' ? `#${own.toLowerCase()}` : partFill(region) ?? (band && (r - (firstRow ? 1 : 0)) % 2 === 0 && !(r === 0 && firstRow) ? partFill(band) : null);
        row.push({ blocks, fill, span: Number(val(kid(tcPr, 'gridSpan')) ?? 1), rowSpan: 1, skip: !!vMerge && val(vMerge) !== 'restart', borders, borderColor });
      }
      rows.push(row);
    }
    // A vertical merge: the restarting cell spans the continuing ones below.
    rows.forEach((row, r) => {
      let col = 0;
      row.forEach((cell) => {
        if (!cell.skip) {
          let below = r + 1;
          const at = (rr: number) => { let c = 0; return rows[rr]?.find((x) => { const hit = c === col; c += x.span; return hit; }); };
          while (at(below)?.skip) { cell.rowSpan++; below++; }
        }
        col += cell.span;
      });
    });
    return { kind: 'table', cols, rows };
  };

  /** The blocks (paragraphs, tables) directly inside a container. */
  async function blocksOf(container: Element, partRels: Map<string, string>): Promise<DocBlock[]> {
    const out: DocBlock[] = [];
    for (const child of Array.from(container.children)) {
      if (child.localName === 'p') out.push(...await paragraph(child, partRels));
      else if (child.localName === 'tbl') out.push(await table(child, partRels));
      else if (child.localName === 'sdt') out.push(...await blocksOf(kid(child, 'sdtContent') ?? child, partRels));
    }
    return out;
  }

  const blocks = await blocksOf(body, rels);

  // The page's header and footer: the default ones of the last section.
  const partBlocks = async (refName: string) => {
    const ref = kids(sect, refName).find((h) => (val(h, 'type') ?? 'default') === 'default') ?? kids(sect, refName)[0];
    const target = ref ? rels.get(rid(ref, 'id') ?? '') : null;
    const doc = target ? await xml(target) : null;
    return doc?.documentElement ? blocksOf(doc.documentElement, await relsOf(target!)) : [];
  };
  const header = await partBlocks('headerReference');
  const footer = await partBlocks('footerReference');

  // Footnotes, in the order the text referenced them.
  const notesDoc = await xml('word/footnotes.xml');
  const notesRels = await relsOf('word/footnotes.xml');
  const footnotes: DocBlock[][] = [];
  for (const id of noteOrder) {
    const note = Array.from(notesDoc?.getElementsByTagNameNS(W, 'footnote') ?? []).find((f) => val(f, 'id') === id);
    if (note) footnotes.push(await blocksOf(note, notesRels));
  }

  // Embedded fonts, de-obfuscated: the first 32 bytes are XORed with the
  // font key, a GUID read backwards (ECMA-376 Part 1, 17.8.1).
  const fonts: DocFont[] = [];
  const fontTable = await xml('word/fontTable.xml');
  const fontRels = await relsOf('word/fontTable.xml');
  for (const font of Array.from(fontTable?.getElementsByTagNameNS(W, 'font') ?? [])) {
    for (const [name, bold, italic] of [['embedRegular', false, false], ['embedBold', true, false], ['embedItalic', false, true], ['embedBoldItalic', true, true]] as const) {
      const e = kid(font, name);
      const target = e ? fontRels.get(rid(e, 'id') ?? '') : null;
      const f = target ? pkg.file(target) : null;
      const key = val(e, 'fontKey')?.replace(/[{}-]/g, '');
      if (!f || !key || key.length !== 32) continue;
      const data = new Uint8Array(await f.async('uint8array'));
      const keyBytes = Array.from({ length: 16 }, (_, i) => parseInt(key.slice(30 - i * 2, 32 - i * 2), 16));
      for (let i = 0; i < 32 && i < data.length; i++) data[i] ^= keyBytes[i % 16];
      fonts.push({ family: val(font, 'name') ?? '', data: data.buffer, bold, italic });
    }
  }

  return {
    width: pageWidth,
    margin: { top: twip(val(pgMar, 'top') ?? '1440'), right: marginR, bottom: twip(val(pgMar, 'bottom') ?? '1440'), left: marginL },
    columns: Math.max(1, Number(val(kid(sect, 'cols'), 'num') ?? 1)),
    blocks, header, footer, footnotes, fonts,
  };
}
