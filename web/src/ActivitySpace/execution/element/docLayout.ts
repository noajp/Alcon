import JSZip from 'jszip';

// A Word document read for drawing it as Word lays it out: the page's
// width and margins; paragraphs with their style (followed through
// basedOn to the document defaults), alignment, spacing and indents; runs
// with weight, slant, underline, strike, size, colour, highlight and font
// (theme fonts resolved); numbered and bulleted lists counted as Word
// counts them; tables with column widths, cell shading, merges and
// borders; inline pictures; page breaks. Sizes are CSS pixels (1440 twips
// = 96px). Read with DOMParser — the browser, or jsdom in the tests.

export interface DocRun {
  text: string; bold: boolean; italic: boolean; underline: boolean; strike: boolean;
  size: number; color: string | null; font: string | null; highlight: string | null;
  image?: { src: string; w: number; h: number };
}
export interface DocPara {
  kind: 'p'; align: 'left' | 'center' | 'right' | 'justify';
  before: number; after: number; line: number | null; indent: number; firstLine: number;
  marker: string | null; runs: DocRun[]; heading: boolean;
}
export interface DocCell { blocks: DocBlock[]; fill: string | null; span: number; rowSpan: number; skip: boolean; borders: boolean }
export interface DocTable { kind: 'table'; cols: number[]; rows: DocCell[][] }
export type DocBlock = DocPara | DocTable | { kind: 'break' };
export interface DocLayout { width: number; margin: { top: number; right: number; bottom: number; left: number }; blocks: DocBlock[] }

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const kids = (el: Element | null | undefined, name: string) => (el ? Array.from(el.children).filter((c) => c.localName === name) : []);
const kid = (el: Element | null | undefined, name: string) => kids(el, name)[0] ?? null;
const val = (el: Element | null | undefined, name = 'val') => el?.getAttributeNS(W, name) ?? el?.getAttribute(`w:${name}`) ?? null;
const twip = (v: string | null | undefined) => (v ? Number(v) / 15 : 0);
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
  const zip = await JSZip.loadAsync(bytes);
  const xml = async (p: string) => {
    const f = zip.file(p);
    return f ? new DOMParser().parseFromString(await f.async('string'), 'application/xml') : null;
  };
  const doc = await xml('word/document.xml');
  const body = doc?.getElementsByTagNameNS(W, 'body')[0] ?? null;
  if (!body) throw new Error('No document body');

  const relsDoc = await xml('word/_rels/document.xml.rels');
  const rels = new Map<string, string>();
  for (const r of Array.from(relsDoc?.getElementsByTagName('Relationship') ?? [])) {
    const t = r.getAttribute('Target') ?? '';
    rels.set(r.getAttribute('Id') ?? '', t.startsWith('/') ? t.slice(1) : `word/${t}`);
  }

  // Theme fonts and colours.
  const themeDoc = await xml([...rels.values()].find((t) => t.includes('theme/')) ?? 'word/theme/theme1.xml');
  const themeFace = (group: string, script: 'latin' | 'ea') => {
    const g = themeDoc?.getElementsByTagName(`a:${group}`)[0];
    return Array.from(g?.children ?? []).find((c) => c.localName === script)?.getAttribute('typeface') || null;
  };
  const themeColors: Record<string, string> = {};
  for (const c of Array.from(themeDoc?.getElementsByTagName('a:clrScheme')[0]?.children ?? [])) {
    const v = c.children[0];
    themeColors[c.localName] = v?.getAttribute('val') ?? v?.getAttribute('lastClr') ?? '000000';
  }

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
      highlight: (HIGHLIGHT[val(first('highlight')) ?? ''] ? `#${HIGHLIGHT[val(first('highlight'))!]}` : null) ?? (val(first('shd'), 'fill') && val(first('shd'), 'fill') !== 'auto' ? `#${val(first('shd'), 'fill')!.toLowerCase()}` : null),
    };
  };

  const imageOf = async (drawing: Element): Promise<DocRun['image'] | null> => {
    const blip = drawing.getElementsByTagName('a:blip')[0];
    const rId = blip?.getAttribute('r:embed') ?? blip?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed');
    const target = rId ? rels.get(rId) : null;
    const f = target ? zip.file(target) : null;
    if (!f) return null;
    const ext = drawing.getElementsByTagName('wp:extent')[0];
    const type = target!.split('.').pop()?.toLowerCase();
    const mime = type === 'svg' ? 'image/svg+xml' : type === 'jpg' || type === 'jpeg' ? 'image/jpeg' : `image/${type}`;
    return { src: `data:${mime};base64,${await f.async('base64')}`, w: Number(ext?.getAttribute('cx') ?? 0) / 9525, h: Number(ext?.getAttribute('cy') ?? 0) / 9525 };
  };

  const paragraph = async (p: Element): Promise<DocBlock[]> => {
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
    const walk = async (el: Element) => {
      for (const node of Array.from(el.children)) {
        if (node.localName === 'r') {
          const rPr = kid(node, 'rPr');
          const rStyle = chainOf(val(kid(rPr, 'rStyle'))).map((s) => kid(s, 'rPr'));
          const rPrs = [rPr, ...rStyle, ...styleRPrs].filter((e): e is Element => !!e);
          for (const part of Array.from(node.children)) {
            if (part.localName === 't') runs.push(runOf(rPrs, part.textContent ?? ''));
            else if (part.localName === 'tab') runs.push(runOf(rPrs, '\t'));
            else if (part.localName === 'br') {
              if (val(part, 'type') === 'page') { if (runs.length) { out.push(paraOf()); runs.length = 0; } out.push({ kind: 'break' }); }
              else runs.push(runOf(rPrs, '\n'));
            } else if (part.localName === 'drawing') {
              const image = await imageOf(part);
              if (image) runs.push({ ...runOf(rPrs, ''), image });
            }
          }
        } else if (['hyperlink', 'ins', 'smartTag', 'sdtContent', 'fldSimple'].includes(node.localName)) await walk(node);
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
    out.push(paraOf());
    return out;
  };

  const table = async (tbl: Element): Promise<DocTable> => {
    const cols = kids(kid(tbl, 'tblGrid'), 'gridCol').map((c) => twip(val(c, 'w')));
    const borders = !!kid(kid(tbl, 'tblPr'), 'tblBorders') || !!val(kid(kid(tbl, 'tblPr'), 'tblStyle'));
    const rows: DocCell[][] = [];
    for (const tr of kids(tbl, 'tr')) {
      const row: DocCell[] = [];
      for (const tc of kids(tr, 'tc')) {
        const tcPr = kid(tc, 'tcPr');
        const fill = val(kid(tcPr, 'shd'), 'fill');
        const vMerge = kid(tcPr, 'vMerge');
        const blocks: DocBlock[] = [];
        for (const child of Array.from(tc.children)) {
          if (child.localName === 'p') blocks.push(...await paragraph(child));
          else if (child.localName === 'tbl') blocks.push(await table(child));
        }
        row.push({ blocks, fill: fill && fill !== 'auto' ? `#${fill.toLowerCase()}` : null, span: Number(val(kid(tcPr, 'gridSpan')) ?? 1), rowSpan: 1, skip: !!vMerge && val(vMerge) !== 'restart', borders });
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

  const blocks: DocBlock[] = [];
  for (const child of Array.from(body.children)) {
    if (child.localName === 'p') blocks.push(...await paragraph(child));
    else if (child.localName === 'tbl') blocks.push(await table(child));
    else if (child.localName === 'sdt') for (const p of Array.from(kid(child, 'sdtContent')?.children ?? [])) if (p.localName === 'p') blocks.push(...await paragraph(p));
  }
  const sect = kids(body, 'sectPr')[0];
  const pgSz = kid(sect, 'pgSz'), pgMar = kid(sect, 'pgMar');
  return {
    width: twip(val(pgSz, 'w') ?? '11906'),
    margin: { top: twip(val(pgMar, 'top') ?? '1440'), right: twip(val(pgMar, 'right') ?? '1440'), bottom: twip(val(pgMar, 'bottom') ?? '1440'), left: twip(val(pgMar, 'left') ?? '1440') },
    blocks,
  };
}
