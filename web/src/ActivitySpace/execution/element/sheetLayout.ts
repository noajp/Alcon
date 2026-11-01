import JSZip from 'jszip';

// An Excel workbook read for drawing it as Excel does: each sheet's cells
// with their fills, fonts, borders, alignment and number formats, the
// column widths and row heights, merged cells, whether gridlines show, and
// the charts placed over the cells (their series read from the cells they
// refer to when the file keeps no cached values, as Google Sheets exports
// do). Sizes are CSS pixels. Read with DOMParser — the browser, or jsdom
// in the tests.

export interface CellStyle {
  bg: string | null; color: string | null; bold: boolean; italic: boolean; underline: boolean; strike: boolean;
  size: number | null; font: string | null;
  align: 'left' | 'center' | 'right' | null; valign: 'top' | 'middle' | 'bottom'; wrap: boolean;
  borders: { top: string | null; right: string | null; bottom: string | null; left: string | null };
}
export interface Cell { text: string; numeric: boolean; style: CellStyle | null; colSpan: number; rowSpan: number; hidden: boolean }
export interface SheetChart {
  x: number; y: number; w: number; h: number; title: string | null;
  kind: 'bar' | 'column' | 'line' | 'area' | 'pie' | 'doughnut' | 'scatter' | 'stock';
  stacked: boolean; categories: string[];
  series: { name: string; color: string | null; values: (number | null)[] }[];
}
export interface WorkSheet {
  name: string; cols: number[]; rows: { h: number; cells: Cell[] }[];
  gridLines: boolean; defaultCol: number; defaultRow: number; charts: SheetChart[];
}

const kids = (el: Element | null | undefined, name: string) => (el ? Array.from(el.children).filter((c) => c.localName === name) : []);
const kid = (el: Element | null | undefined, name: string) => kids(el, name)[0] ?? null;
const desc = (el: Element | Document | null | undefined, name: string) => (el ? Array.from(el.getElementsByTagName('*')).filter((c) => c.localName === name) : []);

// ── Colour ────────────────────────────────────────────────────────────────

/** Pure. Excel's tint: towards white (> 0) or black (< 0), in HSL lightness. */
function tinted(hex: string, tint: number): string {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  l = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
  const hue = (p: number, q: number, t: number) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const out = s === 0 ? [l, l, l] : [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)];
  return out.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}

/** A SpreadsheetML colour (<color rgb|theme|indexed tint>) as CSS. Theme
 *  slots 0–3 are light/dark swapped from the theme's own order, as Excel
 *  reads them. */
function sheetColor(el: Element | null, theme: string[]): string | null {
  if (!el) return null;
  let hex: string | null = null;
  const rgb = el.getAttribute('rgb'), th = el.getAttribute('theme'), idx = el.getAttribute('indexed');
  if (rgb) hex = rgb.length === 8 ? rgb.slice(2) : rgb;
  else if (th != null) hex = theme[[1, 0, 3, 2][Number(th)] ?? Number(th)] ?? null;
  else if (idx != null) hex = ({ 8: '000000', 9: 'FFFFFF', 10: 'FF0000', 11: '00FF00', 12: '0000FF', 13: 'FFFF00' } as Record<string, string>)[idx] ?? null;
  if (!hex) return null;
  const tint = Number(el.getAttribute('tint') ?? 0);
  return `#${(tint ? tinted(hex, tint) : hex).toLowerCase()}`;
}

/** A DrawingML colour (charts) as CSS. */
function drawingColor(el: Element | null, theme: string[]): string | null {
  const fill = el ? kid(el, 'solidFill') : null;
  const c = fill?.children[0];
  if (!c) return null;
  const order = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'];
  const hex = c.localName === 'srgbClr' ? c.getAttribute('val') : c.localName === 'schemeClr' ? theme[order.indexOf(c.getAttribute('val') ?? '')] : null;
  return hex ? `#${hex.toLowerCase()}` : null;
}

// ── Number formats ────────────────────────────────────────────────────────

const BUILTIN_FORMATS: Record<number, string> = {
  0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%', 11: '0.00E+00',
  14: 'yyyy/m/d', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy', 22: 'yyyy/m/d h:mm', 37: '#,##0 ;(#,##0)', 38: '#,##0 ;[Red](#,##0)',
  49: '@',
};

/** Pure. A number in Excel's General format: no trailing ".0", at most 10
 *  significant digits. */
function generalNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(parseFloat(n.toPrecision(10)));
}

/** Pure. A number shown through an Excel number format — the common
 *  shapes: General, fixed decimals, thousands separators, percentages,
 *  scientific, literal text and currency signs, a negative section in
 *  parentheses or red, and dates. Anything stranger falls back to General.
 *  Returns the text and, for a [Red] section, that colour. */
function formatNumber(n: number, code: string): { text: string; red: boolean } {
  if (!code || code === 'General' || code === '@') return { text: generalNumber(n), red: false };
  const sections = code.split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  let section = sections[0];
  let value = n;
  if (n < 0 && sections[1]) { section = sections[1]; value = -n; }
  else if (n === 0 && sections[2]) section = sections[2];
  const red = /\[Red\]/i.test(section);
  section = section.replace(/\[[^\]]*\]/g, '');
  const plain = section.replace(/"[^"]*"/g, '').replace(/\\./g, '');
  if (/[ymdhs]/i.test(plain) && !/[0#]/.test(plain)) return { text: excelDate(value, plain), red };
  const lit = (s: string) => s.replace(/"([^"]*)"/g, '$1').replace(/\\(.)/g, '$1').replace(/_./g, ' ');
  const m = section.match(/^(.*?)([#0,.]+(?:E[+-]0+)?)(%?)(.*)$/);
  if (!m) return { text: generalNumber(n), red };
  const [, pre, num, pct, post] = m;
  let v = pct ? value * 100 : value;
  let body: string;
  if (/E/i.test(num)) {
    const decimals = (num.split('.')[1] ?? '').replace(/E.*/i, '').length;
    body = v.toExponential(decimals).toUpperCase().replace(/E([+-])(\d)$/, 'E$10$2');
  } else {
    const decimals = (num.split('.')[1] ?? '').replace(/[^0#]/g, '').length;
    const grouped = num.includes(',') && /[0#],[0#]/.test(num);
    const scaleCommas = (num.match(/,+$/)?.[0].length ?? 0);
    v = v / 1000 ** scaleCommas;
    body = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: grouped });
    if (v < 0 && sections.length < 2) body = `-${body}`;
  }
  return { text: `${lit(pre)}${body}${pct}${lit(post)}`.trim(), red };
}

/** Pure. An Excel date serial through a date format (years, months, days,
 *  hours, minutes). */
function excelDate(serial: number, code: string): string {
  const d = new Date(Math.round((serial - 25569) * 86400000));
  const pad = (x: number) => String(x).padStart(2, '0');
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return code
    .replace(/yyyy/gi, String(d.getUTCFullYear())).replace(/yy/gi, String(d.getUTCFullYear()).slice(2))
    .replace(/mmmm/gi, MON[d.getUTCMonth()]).replace(/mmm/gi, MON[d.getUTCMonth()])
    .replace(/(h+[^a-z]*)mm/gi, (_, h) => `${h}${pad(d.getUTCMinutes())}`)
    .replace(/mm/gi, pad(d.getUTCMonth() + 1)).replace(/m/gi, String(d.getUTCMonth() + 1))
    .replace(/dd/gi, pad(d.getUTCDate())).replace(/d/gi, String(d.getUTCDate()))
    .replace(/hh/gi, pad(d.getUTCHours())).replace(/h/gi, String(d.getUTCHours()))
    .replace(/ss/gi, pad(d.getUTCSeconds()))
    .replace(/\\(.)/g, '$1').replace(/"([^"]*)"/g, '$1');
}

// ── Cell references ───────────────────────────────────────────────────────

/** Pure. "C12" → [row 11, col 2]. */
function cellRef(ref: string): [number, number] {
  const m = /^\$?([A-Z]+)\$?(\d+)$/.exec(ref) ?? ['', 'A', '1'];
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return [Number(m[2]) - 1, col - 1];
}

// ── Reading ───────────────────────────────────────────────────────────────

const BORDER_CSS: Record<string, string> = {
  thin: '1px solid', hair: '1px dotted', dotted: '1px dotted', dashed: '1px dashed', dashDot: '1px dashed', dashDotDot: '1px dashed',
  medium: '2px solid', mediumDashed: '2px dashed', mediumDashDot: '2px dashed', mediumDashDotDot: '2px dashed', slantDashDot: '2px dashed',
  thick: '3px solid', double: '3px double',
};

interface Raw { value: string | number | null; style: number }

/** Reads a .xlsx's bytes into its sheets, as drawn. */
export async function readWorkbook(bytes: ArrayBuffer): Promise<WorkSheet[]> {
  const zip = await JSZip.loadAsync(bytes);
  const xml = async (p: string) => {
    const f = zip.file(p);
    return f ? new DOMParser().parseFromString(await f.async('string'), 'application/xml') : null;
  };
  const relsOf = async (p: string) => {
    const dir = p.slice(0, p.lastIndexOf('/'));
    const doc = await xml(`${dir}/_rels/${p.slice(dir.length + 1)}.rels`);
    const map = new Map<string, string>();
    for (const r of desc(doc, 'Relationship')) {
      const target = r.getAttribute('Target') ?? '';
      map.set(r.getAttribute('Id') ?? '', target.startsWith('/') ? target.slice(1) : new URL(target, `http://x/${dir}/`).pathname.slice(1));
    }
    return map;
  };

  const wbRels = await relsOf('xl/workbook.xml');
  const themePath = [...wbRels.values()].find((t) => t.includes('theme/'));
  const theme: string[] = [];
  for (const c of Array.from(desc(themePath ? await xml(themePath) : null, 'clrScheme')[0]?.children ?? [])) {
    const v = c.children[0];
    theme.push(v?.getAttribute('val') ?? v?.getAttribute('lastClr') ?? '000000');
  }

  // Styles: each cellXfs entry resolved to a CellStyle and a number format.
  const styles = await xml('xl/styles.xml');
  const numFmts = new Map<number, string>(Object.entries(BUILTIN_FORMATS).map(([k, v]) => [Number(k), v]));
  for (const f of desc(styles, 'numFmt')) numFmts.set(Number(f.getAttribute('numFmtId')), f.getAttribute('formatCode') ?? 'General');
  const fonts = kids(desc(styles, 'fonts')[0], 'font');
  const fills = kids(desc(styles, 'fills')[0], 'fill');
  const borders = kids(desc(styles, 'borders')[0], 'border');
  const xfs = kids(desc(styles, 'cellXfs')[0], 'xf');
  const bool = (el: Element | null) => !!el && el.getAttribute('val') !== '0' && el.getAttribute('val') !== 'false';
  const xfStyle = xfs.map((xf): { style: CellStyle; format: string } => {
    const font = fonts[Number(xf.getAttribute('fontId') ?? 0)];
    const fill = kid(fills[Number(xf.getAttribute('fillId') ?? 0)], 'patternFill');
    const border = borders[Number(xf.getAttribute('borderId') ?? 0)];
    const al = kid(xf, 'alignment');
    const side = (name: string) => {
      const s = kid(border, name);
      const css = s ? BORDER_CSS[s.getAttribute('style') ?? ''] : undefined;
      return css ? `${css} ${sheetColor(kid(s, 'color'), theme) ?? 'var(--sheet-text)'}` : null;
    };
    const h = al?.getAttribute('horizontal');
    const v = al?.getAttribute('vertical');
    return {
      format: numFmts.get(Number(xf.getAttribute('numFmtId') ?? 0)) ?? 'General',
      style: {
        bg: fill?.getAttribute('patternType') === 'solid' ? sheetColor(kid(fill, 'fgColor'), theme) : null,
        color: sheetColor(kid(font, 'color'), theme),
        bold: bool(kid(font, 'b')), italic: bool(kid(font, 'i')), underline: !!kid(font, 'u'), strike: bool(kid(font, 'strike')),
        size: kid(font, 'sz') ? Number(kid(font, 'sz')!.getAttribute('val')) : null,
        font: kid(font, 'name')?.getAttribute('val') ?? null,
        align: h === 'center' || h === 'centerContinuous' ? 'center' : h === 'right' ? 'right' : h === 'left' ? 'left' : null,
        valign: v === 'top' ? 'top' : v === 'center' ? 'middle' : 'bottom',
        wrap: al?.getAttribute('wrapText') === '1',
        borders: { top: side('top'), right: side('right'), bottom: side('bottom'), left: side('left') },
      },
    };
  });

  // Column widths are counted in the default font's digit width, as Excel
  // does: wider for Arial than Calibri, wider at 12pt than at 11pt.
  const baseFont = fonts[0];
  const basePt = Number(kid(baseFont, 'sz')?.getAttribute('val') ?? 11);
  const baseName = (kid(baseFont, 'name')?.getAttribute('val') ?? 'Calibri').toLowerCase();
  const digitEm = /arial|helvetica|meiryo|ms p?gothic|yu gothic|游/.test(baseName) ? 0.556 : 0.507;
  const mdw = Math.max(5, Math.round(basePt * 4 / 3 * digitEm));
  const colPx = (chars: number) => Math.round(chars * mdw + 5);

  const shared = desc(await xml('xl/sharedStrings.xml'), 'si').map((si) => desc(si, 't').map((t) => t.textContent ?? '').join(''));

  const wb = await xml('xl/workbook.xml');
  const sheetDefs = desc(wb, 'sheet').map((s) => ({
    name: s.getAttribute('name') ?? '',
    path: wbRels.get(s.getAttribute('r:id') ?? s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ?? '') ?? '',
  })).filter((s) => s.path);

  // First pass: every sheet's raw cells, so a chart can read another sheet.
  const rawBySheet = new Map<string, Map<string, Raw>>();
  const docs = new Map<string, Document>();
  for (const def of sheetDefs) {
    const doc = await xml(def.path);
    if (!doc) continue;
    docs.set(def.name, doc);
    const cells = new Map<string, Raw>();
    for (const c of desc(doc, 'c')) {
      const t = c.getAttribute('t');
      const v = kid(c, 'v')?.textContent ?? null;
      const value = t === 's' ? shared[Number(v)] ?? ''
        : t === 'inlineStr' ? desc(c, 't').map((x) => x.textContent ?? '').join('')
        : t === 'str' || t === 'e' ? v
        : t === 'b' ? (v === '1' ? 'TRUE' : 'FALSE')
        : v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : v;
      cells.set(c.getAttribute('r') ?? '', { value, style: Number(c.getAttribute('s') ?? 0) });
    }
    rawBySheet.set(def.name, cells);
  }

  /** The values of a range like 'Sheet 1'!$D$2:$D$67, in order. */
  const range = (f: string): (string | number | null)[] => {
    const m = /^(?:'?(.*?)'?!)?\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/.exec(f.trim());
    if (!m) return [];
    const cells = rawBySheet.get(m[1] ?? '') ?? new Map<string, Raw>();
    const [r1, c1] = cellRef(`${m[2]}${m[3]}`);
    const [r2, c2] = m[4] ? cellRef(`${m[4]}${m[5]}`) : [r1, c1];
    const out: (string | number | null)[] = [];
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) {
      let col = '';
      for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) col = String.fromCharCode(65 + ((n - 1) % 26)) + col;
      out.push(cells.get(`${col}${r + 1}`)?.value ?? null);
    }
    return out;
  };

  const sheets: WorkSheet[] = [];
  for (const def of sheetDefs) {
    const doc = docs.get(def.name);
    const raw = rawBySheet.get(def.name);
    if (!doc || !raw) continue;
    const fmtPr = desc(doc, 'sheetFormatPr')[0];
    const defaultCol = colPx(Number(fmtPr?.getAttribute('defaultColWidth') ?? 8.43));
    const defaultRow = Math.round(Number(fmtPr?.getAttribute('defaultRowHeight') ?? 15) * 4 / 3);
    const cols: number[] = [];
    for (const c of desc(doc, 'col')) {
      const w = c.getAttribute('hidden') === '1' ? 0 : colPx(Number(c.getAttribute('width') ?? 8.43));
      for (let i = Number(c.getAttribute('min')) - 1; i < Number(c.getAttribute('max')) && i < 200; i++) cols[i] = w;
    }
    const rows: { h: number; cells: Cell[] }[] = [];
    let maxCol = 0;
    for (const row of desc(doc, 'row')) {
      const r = Number(row.getAttribute('r')) - 1;
      if (r > 2000) break;
      const cells: Cell[] = [];
      for (const c of kids(row, 'c')) {
        const [, col] = cellRef(c.getAttribute('r') ?? 'A1');
        if (col > 200) continue;
        const cell = raw.get(c.getAttribute('r') ?? '');
        const xf = xfStyle[cell?.style ?? 0];
        let text = '', numeric = false, color = xf?.style.color ?? null;
        if (typeof cell?.value === 'number') {
          const out = formatNumber(cell.value, xf?.format ?? 'General');
          text = out.text; numeric = true;
          if (out.red) color = 'var(--sheet-negative)';
        } else if (cell?.value != null) text = String(cell.value);
        cells[col] = { text, numeric, style: xf ? { ...xf.style, color } : null, colSpan: 1, rowSpan: 1, hidden: false };
        if (text || xf?.style.bg) maxCol = Math.max(maxCol, col);
      }
      rows[r] = { h: row.getAttribute('ht') ? Math.round(Number(row.getAttribute('ht')) * 4 / 3) : defaultRow, cells };
    }
    for (let r = 0; r < rows.length; r++) rows[r] ??= { h: defaultRow, cells: [] };
    for (const mc of desc(doc, 'mergeCell')) {
      const [a, b] = (mc.getAttribute('ref') ?? '').split(':');
      if (!a || !b) continue;
      const [r1, c1] = cellRef(a), [r2, c2] = cellRef(b);
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) {
        rows[r] ??= { h: defaultRow, cells: [] };
        const cell = rows[r].cells[c] ?? { text: '', numeric: false, style: null, colSpan: 1, rowSpan: 1, hidden: false };
        rows[r].cells[c] = r === r1 && c === c1 ? { ...cell, colSpan: c2 - c1 + 1, rowSpan: r2 - r1 + 1 } : { ...cell, hidden: true };
      }
    }

    // Charts: where each drawing anchors them, and their series.
    const colX = (c: number) => { let x = 0; for (let i = 0; i < c; i++) x += cols[i] ?? defaultCol; return x; };
    const rowY = (r: number) => { let y = 0; for (let i = 0; i < r; i++) y += rows[i]?.h ?? defaultRow; return y; };
    const charts: SheetChart[] = [];
    const sheetRels = await relsOf(def.path);
    for (const d of desc(doc, 'drawing')) {
      const drawingPath = sheetRels.get(d.getAttribute('r:id') ?? '');
      const drawing = drawingPath ? await xml(drawingPath) : null;
      if (!drawing || !drawingPath) continue;
      const drawingRels = await relsOf(drawingPath);
      for (const anchor of [...desc(drawing, 'oneCellAnchor'), ...desc(drawing, 'twoCellAnchor'), ...desc(drawing, 'absoluteAnchor')]) {
        const chartRef = desc(anchor, 'chart')[0];
        const chartPath = chartRef ? drawingRels.get(chartRef.getAttribute('r:id') ?? chartRef.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ?? '') : null;
        const chartDoc = chartPath ? await xml(chartPath) : null;
        if (!chartDoc) continue;
        const at = (el: Element | null) => el ? {
          x: colX(Number(kid(el, 'col')?.textContent ?? 0)) + Number(kid(el, 'colOff')?.textContent ?? 0) / 9525,
          y: rowY(Number(kid(el, 'row')?.textContent ?? 0)) + Number(kid(el, 'rowOff')?.textContent ?? 0) / 9525,
        } : { x: 0, y: 0 };
        const from = anchor.localName === 'absoluteAnchor'
          ? { x: Number(kid(anchor, 'pos')?.getAttribute('x') ?? 0) / 9525, y: Number(kid(anchor, 'pos')?.getAttribute('y') ?? 0) / 9525 }
          : at(kid(anchor, 'from'));
        const ext = kid(anchor, 'ext');
        const to = kid(anchor, 'to') ? at(kid(anchor, 'to')) : null;
        const w = to ? to.x - from.x : Number(ext?.getAttribute('cx') ?? 0) / 9525;
        const h = to ? to.y - from.y : Number(ext?.getAttribute('cy') ?? 0) / 9525;
        const plot = desc(chartDoc, 'plotArea')[0];
        const typeEl = plot ? Array.from(plot.children).find((c) => c.localName.endsWith('Chart')) : null;
        if (!typeEl) continue;
        const t = typeEl.localName;
        const kind: SheetChart['kind'] = t === 'barChart' || t === 'bar3DChart' ? (kid(typeEl, 'barDir')?.getAttribute('val') === 'bar' ? 'bar' : 'column')
          : t.startsWith('line') ? 'line' : t.startsWith('area') ? 'area' : t.startsWith('pie') || t === 'ofPieChart' ? 'pie'
          : t === 'doughnutChart' ? 'doughnut' : t === 'scatterChart' || t === 'bubbleChart' ? 'scatter' : t === 'stockChart' ? 'stock' : 'column';
        const values = (el: Element | null): (string | number | null)[] => {
          if (!el) return [];
          const cache = desc(el, 'pt');
          if (cache.length) {
            const count = Number(desc(el, 'ptCount')[0]?.getAttribute('val') ?? cache.length);
            const out: (string | number | null)[] = Array(count).fill(null);
            for (const pt of cache) out[Number(pt.getAttribute('idx'))] = kid(pt, 'v')?.textContent ?? null;
            return out;
          }
          const f = desc(el, 'f')[0]?.textContent;
          return f ? range(f) : [];
        };
        const sers = kids(typeEl, 'ser');
        const firstCats = values(kid(sers[0], 'cat') ?? kid(sers[0], 'xVal'));
        const title = desc(kid(desc(chartDoc, 'chart')[0], 'title'), 't').map((x) => x.textContent ?? '').join('') || null;
        charts.push({
          x: from.x, y: from.y, w, h, title, kind,
          stacked: ['stacked', 'percentStacked'].includes(kid(typeEl, 'grouping')?.getAttribute('val') ?? ''),
          categories: firstCats.map((v) => (v == null ? '' : typeof v === 'number' ? generalNumber(v) : String(v))),
          series: sers.map((s, i) => ({
            name: desc(kid(s, 'tx'), 'v')[0]?.textContent ?? (() => { const f = desc(kid(s, 'tx'), 'f')[0]?.textContent; return f ? String(range(f)[0] ?? '') : ''; })() ?? `Series ${i + 1}`,
            // A bar's colour is its fill; a line's, its outline.
            color: drawingColor(kid(s, 'spPr'), theme) ?? drawingColor(kid(kid(s, 'spPr'), 'ln'), theme),
            values: values(kid(s, 'val') ?? kid(s, 'yVal')).map((v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))),
          })),
        });
        maxCol = Math.max(maxCol, Number(kid(kid(anchor, 'from'), 'col')?.textContent ?? 0) + Math.ceil(w / defaultCol));
      }
    }
    while (cols.length <= maxCol) cols.push(defaultCol);
    for (let i = 0; i < cols.length; i++) cols[i] ??= defaultCol;
    sheets.push({
      name: def.name, cols, rows, defaultCol, defaultRow, charts,
      gridLines: desc(doc, 'sheetView')[0]?.getAttribute('showGridLines') !== '0',
    });
  }
  return sheets;
}
