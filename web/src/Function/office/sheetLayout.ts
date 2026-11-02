import { readChart, type ChartData } from './chartLayout';
import { desc, kid, kids, openPackage, relId, relOfType, SCHEME_ORDER, themeColors, breather } from './ooxml';

// An Excel workbook read for drawing it as Excel does: each sheet's cells
// with their fills, fonts, borders, alignment and number formats, the
// column widths and row heights, merged cells, whether gridlines show, and
// the charts and pictures placed over the cells (a chart's series read from
// the cells it refers to when the file keeps no cached values, as Google
// Sheets exports do), conditional formatting (rules comparing values,
// colour scales, data bars, text matches, top / bottom, above average,
// duplicates) and rich text within a cell. Sizes are CSS pixels. Read with DOMParser — the browser, or jsdom
// in the tests.

export interface CellStyle {
  bg: string | null; color: string | null; bold: boolean; italic: boolean; underline: boolean; strike: boolean;
  size: number | null; font: string | null;
  align: 'left' | 'center' | 'right' | null; valign: 'top' | 'middle' | 'bottom'; wrap: boolean;
  borders: { top: string | null; right: string | null; bottom: string | null; left: string | null };
}
export interface CellRun { text: string; bold: boolean; italic: boolean; underline: boolean; color: string | null; size: number | null; font: string | null }
export interface Cell {
  text: string; numeric: boolean; style: CellStyle | null; colSpan: number; rowSpan: number; hidden: boolean;
  /** A number's stored value, before its format (1580783 for "¥1,580,783"). */
  value?: number;
  /** Text in more than one format (rich text), when the cell has it. */
  runs?: CellRun[];
  /** A conditional-format data bar: its length (0–1) and colour. */
  bar?: { pct: number; color: string };
  /** The cell is worked out by a formula (shown here as its last result). */
  formula?: boolean;
}
export interface SheetImage { x: number; y: number; w: number; h: number; src: string }
/** A chart over a sheet: the chart, and where the sheet anchors it. */
export type SheetChart = ChartData & { x: number; y: number; w: number; h: number };
export interface WorkSheet {
  name: string; cols: number[]; rows: { h: number; cells: Cell[] }[];
  gridLines: boolean; defaultCol: number; defaultRow: number; charts: SheetChart[]; images: SheetImage[];
}


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

// Excel's legacy indexed palette (indexes 8–63; 0–7 repeat 8–15), as hex
// without the leading #. A workbook may replace it with its own
// <indexedColors>.
const INDEXED = ['000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF', '800000', '008000', '000080', '808000', '800080', '008080',
  'C0C0C0', '808080', '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF', '000080', 'FF00FF', 'FFFF00', '00FFFF',
  '800080', '800000', '008080', '0000FF', '00CCFF', 'CCFFFF', 'CCFFCC', 'FFFF99', '99CCFF', 'FF99CC', 'CC99FF', 'FFCC99', '3366FF', '33CCCC',
  '99CC00', 'FFCC00', 'FF9900', 'FF6600', '666699', '969696', '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333'];

/** A SpreadsheetML colour (<color rgb|theme|indexed tint>) as CSS. Theme
 *  slots 0–3 are light/dark swapped from the theme's own order, as Excel
 *  reads them. */
function sheetColor(el: Element | null, theme: string[], indexed: string[] = INDEXED): string | null {
  if (!el) return null;
  let hex: string | null = null;
  const rgb = el.getAttribute('rgb'), th = el.getAttribute('theme'), idx = el.getAttribute('indexed');
  if (rgb) hex = rgb.length === 8 ? rgb.slice(2) : rgb;
  else if (th != null) hex = theme[[1, 0, 3, 2][Number(th)] ?? Number(th)] ?? null;
  // 64 and 65 are the system's text and window colours: automatic.
  else if (idx != null) hex = indexed[Number(idx)] ?? null;
  if (!hex) return null;
  const tint = Number(el.getAttribute('tint') ?? 0);
  return `#${(tint ? tinted(hex, tint) : hex).toLowerCase()}`;
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
  // Sections may carry their own conditions ([>100], [<=0]): the first that
  // holds is used, a section without one is the rest. Otherwise sections
  // are positive; negative (shown without its sign); zero.
  const COND = /\[(<=|>=|<>|<|>|=)(-?[\d.]+)\]/;
  const conditional = sections.some((x) => COND.test(x));
  if (conditional) {
    const holds = (x: string) => {
      const m = COND.exec(x);
      if (!m) return null;
      const k = Number(m[2]);
      return m[1] === '<' ? n < k : m[1] === '<=' ? n <= k : m[1] === '>' ? n > k : m[1] === '>=' ? n >= k : m[1] === '=' ? n === k : n !== k;
    };
    const pick = sections.find((x) => holds(x) === true) ?? sections.find((x) => holds(x) === null);
    if (!pick) return { text: generalNumber(n), red: false };
    section = pick;
    value = Math.abs(n);
    if (n < 0) section = section.replace(/^((?:\[[^\]]*\])*)/, '$1"-"');
  } else if (n < 0 && sections[1]) { section = sections[1]; value = -n; }
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

// Rows read per sheet. The view draws only those in sight, so this bounds
// memory, not drawing.
const MAX_ROWS = 20000;

const BORDER_CSS: Record<string, string> = {
  thin: '1px solid', hair: '1px dotted', dotted: '1px dotted', dashed: '1px dashed', dashDot: '1px dashed', dashDotDot: '1px dashed',
  medium: '2px solid', mediumDashed: '2px dashed', mediumDashDot: '2px dashed', mediumDashDotDot: '2px dashed', slantDashDot: '2px dashed',
  thick: '3px solid', double: '3px double',
};

interface Raw { value: string | number | null; style: number; runs?: CellRun[] }

/** Reads a .xlsx's bytes into its sheets, as drawn. */
export async function readWorkbook(bytes: ArrayBuffer): Promise<WorkSheet[]> {
  const pkg = await openPackage(bytes);
  const { xml } = pkg;
  const relsOf = async (p: string) => new Map([...(await pkg.rels(p)).entries()].map(([id, r]) => [id, r.target]));

  const wbRels = await pkg.rels('xl/workbook.xml');
  const themePath = relOfType(wbRels, 'theme');
  // The theme's colours by name (charts), and in scheme order (cell colours
  // index them).
  const themeByName = themeColors(themePath ? await xml(themePath) : null);
  const theme = SCHEME_ORDER.slice(0, 10).map((k) => themeByName[k] ?? '000000');

  // Styles: each cellXfs entry resolved to a CellStyle and a number format.
  const styles = await xml('xl/styles.xml');
  const numFmts = new Map<number, string>(Object.entries(BUILTIN_FORMATS).map(([k, v]) => [Number(k), v]));
  for (const f of desc(styles, 'numFmt')) numFmts.set(Number(f.getAttribute('numFmtId')), f.getAttribute('formatCode') ?? 'General');
  const custom = kids(desc(styles, 'indexedColors')[0], 'rgbColor').map((c) => (c.getAttribute('rgb') ?? '').slice(-6));
  const indexed = custom.length ? custom : INDEXED;
  const cellColor = (el: Element | null) => sheetColor(el, theme, indexed);
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
      return css ? `${css} ${cellColor(kid(s, 'color')) ?? 'var(--sheet-text)'}` : null;
    };
    const h = al?.getAttribute('horizontal');
    const v = al?.getAttribute('vertical');
    return {
      format: numFmts.get(Number(xf.getAttribute('numFmtId') ?? 0)) ?? 'General',
      style: {
        bg: fill?.getAttribute('patternType') === 'solid' ? cellColor(kid(fill, 'fgColor')) : null,
        color: cellColor(kid(font, 'color')),
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

  // Shared strings, with their runs where a string mixes formats.
  const runsOf = (si: Element): CellRun[] | undefined => {
    const rs = kids(si, 'r');
    if (rs.length < 2 && !kid(rs[0], 'rPr')) return undefined;
    return rs.map((r) => {
      const pr = kid(r, 'rPr');
      return {
        text: kid(r, 't')?.textContent ?? '',
        bold: bool(kid(pr, 'b')), italic: bool(kid(pr, 'i')), underline: !!kid(pr, 'u'),
        color: cellColor(kid(pr, 'color')),
        size: kid(pr, 'sz') ? Number(kid(pr, 'sz')!.getAttribute('val')) : null,
        font: kid(pr, 'rFont')?.getAttribute('val') ?? null,
      };
    });
  };
  const sis = desc(await xml('xl/sharedStrings.xml'), 'si');
  const shared = sis.map((si) => desc(si, 't').map((t) => t.textContent ?? '').join(''));
  const sharedRuns = sis.map(runsOf);

  // Differential formats: what a conditional format applies.
  const dxfs = kids(desc(styles, 'dxfs')[0], 'dxf').map((dxf) => {
    const font = kid(dxf, 'font'), fill = kid(kid(dxf, 'fill'), 'patternFill');
    return {
      color: cellColor(kid(font, 'color')),
      bold: kid(font, 'b') ? bool(kid(font, 'b')) : null,
      italic: kid(font, 'i') ? bool(kid(font, 'i')) : null,
      bg: cellColor(kid(fill, 'bgColor')) ?? cellColor(kid(fill, 'fgColor')),
    };
  });

  const wb = await xml('xl/workbook.xml');
  const sheetDefs = desc(wb, 'sheet').map((s) => ({
    name: s.getAttribute('name') ?? '',
    path: wbRels.get(relId(s) ?? '')?.target ?? '',
  })).filter((s) => s.path);

  // First pass: every sheet's raw cells, so a chart can read another sheet.
  const rawBySheet = new Map<string, Map<string, Raw>>();
  const docs = new Map<string, Document>();
  const breathe = breather(4000);
  for (const def of sheetDefs) {
    const doc = await xml(def.path);
    if (!doc) continue;
    docs.set(def.name, doc);
    const cells = new Map<string, Raw>();
    for (const c of desc(doc, 'c')) {
      await breathe();
      const t = c.getAttribute('t');
      const v = kid(c, 'v')?.textContent ?? null;
      const value = t === 's' ? shared[Number(v)] ?? ''
        : t === 'inlineStr' ? desc(c, 't').map((x) => x.textContent ?? '').join('')
        : t === 'str' || t === 'e' ? v
        : t === 'b' ? (v === '1' ? 'TRUE' : 'FALSE')
        : v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : v;
      const runs = t === 's' ? sharedRuns[Number(v)] : t === 'inlineStr' && kid(c, 'is') ? runsOf(kid(c, 'is')!) : undefined;
      cells.set(c.getAttribute('r') ?? '', { value, style: Number(c.getAttribute('s') ?? 0), ...(runs ? { runs } : {}) });
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
    // Hand the page back between sheets, so a big workbook never freezes it.
    await new Promise((r) => setTimeout(r, 0));
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
      await breathe();
      const r = Number(row.getAttribute('r')) - 1;
      if (r >= MAX_ROWS) break;
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
        cells[col] = {
          text, numeric, style: xf ? { ...xf.style, color } : null, colSpan: 1, rowSpan: 1, hidden: false,
          ...(cell?.runs ? { runs: cell.runs } : {}), ...(typeof cell?.value === 'number' ? { value: cell.value } : {}),
          ...(kid(c, 'f') ? { formula: true } : {}),
        };
        if (text || xf?.style.bg) maxCol = Math.max(maxCol, col);
      }
      rows[r] = { h: row.getAttribute('ht') ? Math.round(Number(row.getAttribute('ht')) * 4 / 3) : defaultRow, cells };
    }
    for (let r = 0; r < rows.length; r++) rows[r] ??= { h: defaultRow, cells: [] };
    for (const mc of desc(doc, 'mergeCell')) {
      const [a, b] = (mc.getAttribute('ref') ?? '').split(':');
      if (!a || !b) continue;
      const [r1, c1] = cellRef(a), [r2, c2] = cellRef(b);
      maxCol = Math.max(maxCol, c2);
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) {
        rows[r] ??= { h: defaultRow, cells: [] };
        const cell = rows[r].cells[c] ?? { text: '', numeric: false, style: null, colSpan: 1, rowSpan: 1, hidden: false };
        rows[r].cells[c] = r === r1 && c === c1 ? { ...cell, colSpan: c2 - c1 + 1, rowSpan: r2 - r1 + 1 } : { ...cell, hidden: true };
      }
    }

    applyConditionalFormats(doc, rows, raw, dxfs, theme, indexed);

    // Charts and pictures: where each drawing anchors them.
    const colX = (c: number) => { let x = 0; for (let i = 0; i < c; i++) x += cols[i] ?? defaultCol; return x; };
    const rowY = (r: number) => { let y = 0; for (let i = 0; i < r; i++) y += rows[i]?.h ?? defaultRow; return y; };
    const charts: SheetChart[] = [];
    const images: SheetImage[] = [];
    const sheetRels = await relsOf(def.path);
    for (const d of desc(doc, 'drawing')) {
      const drawingPath = sheetRels.get(relId(d) ?? '');
      const drawing = drawingPath ? await xml(drawingPath) : null;
      if (!drawing || !drawingPath) continue;
      const drawingRels = await relsOf(drawingPath);
      for (const anchor of [...desc(drawing, 'oneCellAnchor'), ...desc(drawing, 'twoCellAnchor'), ...desc(drawing, 'absoluteAnchor')]) {
        const chartRef = desc(anchor, 'chart')[0];
        const chartPath = chartRef ? drawingRels.get(relId(chartRef) ?? '') : null;
        const chartDoc = chartPath ? await xml(chartPath) : null;
        const blip = desc(anchor, 'blip')[0];
        const picPath = !chartDoc && blip ? drawingRels.get(relId(blip, 'embed') ?? '') : null;
        if (!chartDoc && !picPath) continue;
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
        if (picPath) {
          const src = await pkg.dataUrl(picPath);
          if (src) images.push({ x: from.x, y: from.y, w, h, src });
        } else {
          const chart = readChart(chartDoc!, themeByName, range);
          if (!chart) continue;
          charts.push({ ...chart, x: from.x, y: from.y, w, h });
        }
        maxCol = Math.max(maxCol, Number(kid(kid(anchor, 'from'), 'col')?.textContent ?? 0) + Math.ceil(w / defaultCol));
      }
    }
    // A few empty columns past the last used one, as a sheet runs on.
    while (cols.length < Math.max(maxCol + 4, 10)) cols.push(defaultCol);
    for (let i = 0; i < cols.length; i++) cols[i] ??= defaultCol;
    sheets.push({
      name: def.name, cols, rows, defaultCol, defaultRow, charts, images,
      gridLines: desc(doc, 'sheetView')[0]?.getAttribute('showGridLines') !== '0',
    });
  }
  return sheets;
}

type Dxf = { color: string | null; bold: boolean | null; italic: boolean | null; bg: string | null };

/** Pure. A colour between two #rrggbb colours, t from 0 to 1. */
function mix(a: string, b: string, t: number): string {
  const ca = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16)), cb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `#${ca.map((v, i) => Math.round(v + (cb[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

/** Applies a sheet's conditional formats to its cells, as Excel would show
 *  them: each rule over its ranges, the higher-priority rule winning where
 *  two set the same thing. Rules that need a formula evaluated are left
 *  out rather than guessed. */
function applyConditionalFormats(doc: Document, rows: { h: number; cells: Cell[] }[], raw: Map<string, Raw>, dxfs: Dxf[], theme: string[], indexed: string[]) {
  const rules: { rule: Element; refs: [number, number][]; anchor: [number, number] }[] = [];
  for (const cf of desc(doc, 'conditionalFormatting')) {
    const refs: [number, number][] = [];
    for (const part of (cf.getAttribute('sqref') ?? '').split(/\s+/).filter(Boolean)) {
      const [a, b] = part.split(':');
      const [r1, c1] = cellRef(a), [r2, c2] = b ? cellRef(b) : [r1, c1];
      for (let r = r1; r <= Math.min(r2, r1 + MAX_ROWS); r++) for (let c = c1; c <= Math.min(c2, c1 + 200); c++) refs.push([r, c]);
    }
    for (const rule of kids(cf, 'cfRule')) rules.push({ rule, refs, anchor: refs[0] ?? [0, 0] });
  }
  // Lowest priority number wins, so apply the rest first.
  rules.sort((x, y) => Number(y.rule.getAttribute('priority') ?? 0) - Number(x.rule.getAttribute('priority') ?? 0));
  const name = (r: number, c: number) => { let col = ''; for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) col = String.fromCharCode(65 + ((n - 1) % 26)) + col; return `${col}${r + 1}`; };
  const valueAt = (r: number, c: number) => raw.get(name(r, c))?.value ?? null;
  const cellAt = (r: number, c: number) => {
    rows[r] ??= { h: 20, cells: [] };
    return (rows[r].cells[c] ??= { text: '', numeric: false, style: null, colSpan: 1, rowSpan: 1, hidden: false });
  };
  const restyle = (r: number, c: number, d: Dxf) => {
    const cell = cellAt(r, c);
    const base: CellStyle = cell.style ?? { bg: null, color: null, bold: false, italic: false, underline: false, strike: false, size: null, font: null, align: null, valign: 'bottom', wrap: false, borders: { top: null, right: null, bottom: null, left: null } };
    cell.style = { ...base, bg: d.bg ?? base.bg, color: d.color ?? base.color, bold: d.bold ?? base.bold, italic: d.italic ?? base.italic };
  };
  const colorOfCfvo = (el: Element | null) => sheetColorLoose(el, theme, indexed);
  for (const { rule, refs, anchor } of rules) {
    const type = rule.getAttribute('type');
    const dxf = dxfs[Number(rule.getAttribute('dxfId') ?? -1)];
    const nums = refs.map(([r, c]) => valueAt(r, c)).filter((v): v is number => typeof v === 'number');
    const threshold = (cfvo: Element | null, fallback: number) => {
      const t = cfvo?.getAttribute('type'), v = Number(cfvo?.getAttribute('val') ?? 0);
      const sorted = [...nums].sort((a, b) => a - b);
      if (t === 'min' || !sorted.length) return t === 'max' ? Math.max(...nums, fallback) : sorted[0] ?? fallback;
      if (t === 'max') return sorted[sorted.length - 1];
      if (t === 'num') return v;
      if (t === 'percent') return sorted[0] + (sorted[sorted.length - 1] - sorted[0]) * v / 100;
      if (t === 'percentile') return sorted[Math.min(sorted.length - 1, Math.floor((v / 100) * (sorted.length - 1)))];
      return fallback;
    };
    if (type === 'colorScale' || type === 'dataBar') {
      const host = kid(rule, type);
      const cfvos = kids(host, 'cfvo');
      const colors = kids(host, 'color').map(colorOfCfvo).filter((x): x is string => !!x);
      const lo = threshold(cfvos[0], Math.min(...nums)), hi = threshold(cfvos[cfvos.length - 1], Math.max(...nums));
      for (const [r, c] of refs) {
        const v = valueAt(r, c);
        if (typeof v !== 'number') continue;
        const t = hi > lo ? Math.max(0, Math.min(1, (v - lo) / (hi - lo))) : 0.5;
        if (type === 'dataBar') { if (colors[0]) cellAt(r, c).bar = { pct: t, color: colors[0] }; continue; }
        if (colors.length === 3) {
          const mid = threshold(cfvos[1], (lo + hi) / 2);
          const color = v <= mid ? mix(colors[0], colors[1], mid > lo ? (v - lo) / (mid - lo) : 0) : mix(colors[1], colors[2], hi > mid ? (v - mid) / (hi - mid) : 1);
          restyle(r, c, { bg: color, color: null, bold: null, italic: null });
        } else if (colors.length >= 2) restyle(r, c, { bg: mix(colors[0], colors[1], t), color: null, bold: null, italic: null });
      }
      continue;
    }
    if (!dxf) continue;
    // A rule's operands: numbers, quoted text, or a single cell — a relative
    // reference moving with each cell as Excel moves it from the range's
    // top-left. Anything else needs a formula engine and leaves the rule out.
    const operand = (f: string, r: number, c: number): number | string | null => {
      const t = f.trim();
      if (t !== '' && Number.isFinite(Number(t))) return Number(t);
      const q = /^"(.*)"$/.exec(t);
      if (q) return q[1];
      const m = /^(\$?)([A-Z]+)(\$?)(\d+)$/.exec(t);
      if (!m) return null;
      const [rr, cc] = cellRef(`${m[2]}${m[4]}`);
      const v = valueAt(m[3] ? rr : rr + r - anchor[0], m[1] ? cc : cc + c - anchor[1]);
      return v == null ? null : v;
    };
    const formulaText = kids(rule, 'formula').map((f) => f.textContent ?? '');
    const avg = nums.reduce((a, b) => a + b, 0) / (nums.length || 1);
    const counts = new Map<string, number>();
    for (const [r, c] of refs) { const k = String(valueAt(r, c) ?? ''); counts.set(k, (counts.get(k) ?? 0) + 1); }
    for (const [r, c] of refs) {
      const v = valueAt(r, c);
      let hit = false;
      const ops = formulaText.map((f) => operand(f, r, c));
      if (type === 'cellIs' && v != null && ops.length && ops.every((o) => o != null) && typeof ops[0] === typeof v) {
        // Text compares as Excel does, case-blind.
        const key = (x: number | string) => (typeof x === 'string' ? x.toLowerCase() : x);
        const [x, a, b] = [v, ...(ops as (number | string)[])].map(key);
        const [lo, hi] = b === undefined ? [a, a] : a <= b ? [a, b] : [b, a];
        const op = rule.getAttribute('operator');
        hit = op === 'greaterThan' ? x > a : op === 'lessThan' ? x < a : op === 'greaterThanOrEqual' ? x >= a : op === 'lessThanOrEqual' ? x <= a
          : op === 'equal' ? x === a : op === 'notEqual' ? x !== a : op === 'between' ? x >= lo && x <= hi
          : op === 'notBetween' ? x < lo || x > hi : false;
      } else if (type === 'containsText' || type === 'notContainsText' || type === 'beginsWith' || type === 'endsWith') {
        const text = rule.getAttribute('text') ?? '', s = String(v ?? '');
        hit = type === 'containsText' ? s.includes(text) : type === 'notContainsText' ? !s.includes(text) : type === 'beginsWith' ? s.startsWith(text) : s.endsWith(text);
      } else if (type === 'top10' && typeof v === 'number') {
        const rank = Number(rule.getAttribute('rank') ?? 10);
        const n = rule.getAttribute('percent') === '1' ? Math.max(1, Math.floor((nums.length * rank) / 100)) : rank;
        const sorted = [...nums].sort((a, b) => (rule.getAttribute('bottom') === '1' ? a - b : b - a));
        const edge = sorted[Math.min(n, sorted.length) - 1];
        hit = rule.getAttribute('bottom') === '1' ? v <= edge : v >= edge;
      } else if (type === 'aboveAverage' && typeof v === 'number') {
        const above = rule.getAttribute('aboveAverage') !== '0', eq = rule.getAttribute('equalAverage') === '1';
        hit = above ? (eq ? v >= avg : v > avg) : (eq ? v <= avg : v < avg);
      } else if (type === 'duplicateValues' || type === 'uniqueValues') {
        const k = String(v ?? '');
        hit = k !== '' && (type === 'duplicateValues' ? (counts.get(k) ?? 0) > 1 : counts.get(k) === 1);
      } else if (type === 'containsBlanks' || type === 'notContainsBlanks') {
        hit = (v == null || v === '') === (type === 'containsBlanks');
      }
      if (hit) restyle(r, c, dxf);
    }
  }
}

/** A conditional format's colour element (rgb or theme) as #rrggbb. */
function sheetColorLoose(el: Element | null, theme: string[], indexed: string[]): string | null {
  const c = sheetColor(el, theme, indexed);
  return c && /^#[0-9a-f]{6}$/.test(c) ? c : null;
}
