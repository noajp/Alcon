// A DrawingML chart part (xl/charts/chartN.xml, ppt/charts/chartN.xml)
// read for drawing: its title, its series — each with its own chart type,
// so a bar-and-line combination stays one — the axis each plots against
// (secondary axes kept apart), whether its values are labelled, and its
// colour. Values come from the part's cached points; where a file keeps
// none (Google Sheets exports), `range` reads them from the cells the
// series refers to. Shared by the workbook and deck readers.

export type SeriesType = 'bar' | 'line' | 'area' | 'scatter' | 'pie' | 'stock';
export interface ChartSeries {
  name: string; color: string | null; values: (number | null)[];
  type: SeriesType; axis: 'left' | 'right'; labels: boolean;
}
export interface ChartData {
  title: string | null;
  kind: 'bar' | 'column' | 'line' | 'area' | 'pie' | 'doughnut' | 'scatter' | 'stock' | 'combo';
  stacked: boolean; categories: string[]; series: ChartSeries[];
}

const kids = (el: Element | null | undefined, name: string) => (el ? Array.from(el.children).filter((c) => c.localName === name) : []);
const kid = (el: Element | null | undefined, name: string) => kids(el, name)[0] ?? null;
const desc = (el: Element | Document | null | undefined, name: string) => (el ? Array.from(el.getElementsByTagName('*')).filter((c) => c.localName === name) : []);
const general = (v: number) => (Number.isInteger(v) ? String(v) : String(parseFloat(v.toPrecision(10))));

const ORDER = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'];
const MAP: Record<string, string> = { tx1: 'dk1', bg1: 'lt1', tx2: 'dk2', bg2: 'lt2' };

/** A solid colour under a shape-properties element, as CSS. `theme` is
 *  the theme's colours in scheme order (dk1, lt1, dk2, lt2, accent1–6). */
function colorUnder(el: Element | null, theme: string[]): string | null {
  const c = kid(el, 'solidFill')?.children[0];
  if (!c) return null;
  const v = c.getAttribute('val') ?? '';
  const hex = c.localName === 'srgbClr' ? v : c.localName === 'schemeClr' ? theme[ORDER.indexOf(MAP[v] ?? v)] : c.localName === 'sysClr' ? c.getAttribute('lastClr') : null;
  if (!hex) return null;
  let [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const mod = kid(c, 'lumMod')?.getAttribute('val'), off = kid(c, 'lumOff')?.getAttribute('val');
  if (mod || off) [r, g, b] = [r, g, b].map((x) => Math.round(Math.min(255, x * (mod ? Number(mod) / 100000 : 1) + 255 * (off ? Number(off) / 100000 : 0))));
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

/** Reads a chart part. Null when it holds no chart this view can draw. */
export function readChart(doc: Document, theme: string[], range: (f: string) => (string | number | null)[] = () => []): ChartData | null {
  const plot = desc(doc, 'plotArea')[0];
  const groups = plot ? Array.from(plot.children).filter((c) => c.localName.endsWith('Chart')) : [];
  if (!groups.length) return null;

  // Secondary value axes: those a group plots against that sit on the right
  // (or cross at the maximum).
  const rightAxes = new Set(desc(plot, 'valAx')
    .filter((ax) => kid(ax, 'axPos')?.getAttribute('val') === 'r' || kid(ax, 'crosses')?.getAttribute('val') === 'max')
    .map((ax) => kid(ax, 'axId')?.getAttribute('val') ?? ''));

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

  const typeOf = (t: string): SeriesType => (t.startsWith('bar') ? 'bar' : t.startsWith('line') ? 'line' : t.startsWith('area') ? 'area'
    : t.startsWith('pie') || t === 'doughnutChart' || t === 'ofPieChart' ? 'pie' : t === 'stockChart' ? 'stock' : t === 'scatterChart' || t === 'bubbleChart' ? 'scatter' : 'bar');

  const series: ChartSeries[] = [];
  let categories: (string | number | null)[] = [];
  for (const g of groups) {
    const type = typeOf(g.localName);
    const right = kids(g, 'axId').some((ax) => rightAxes.has(ax.getAttribute('val') ?? ''));
    const groupLabels = kid(kid(g, 'dLbls'), 'showVal')?.getAttribute('val') === '1';
    for (const s of kids(g, 'ser')) {
      if (!categories.length) categories = values(kid(s, 'cat') ?? kid(s, 'xVal'));
      const txF = desc(kid(s, 'tx'), 'f')[0]?.textContent;
      const spPr = kid(s, 'spPr');
      series.push({
        name: desc(kid(s, 'tx'), 'v')[0]?.textContent ?? (txF ? String(range(txF)[0] ?? '') : '') ?? '',
        // A bar's colour is its fill; a line's, its outline.
        color: colorUnder(spPr, theme) ?? colorUnder(kid(spPr, 'ln'), theme),
        values: values(kid(s, 'val') ?? kid(s, 'yVal')).map((v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))),
        type, axis: right ? 'right' : 'left',
        labels: (kid(kid(s, 'dLbls'), 'showVal')?.getAttribute('val') ?? (groupLabels ? '1' : '0')) === '1',
      });
    }
  }
  if (!series.length) return null;
  const first = groups[0].localName;
  const kinds = new Set(series.map((s) => s.type));
  const kind: ChartData['kind'] = kinds.size > 1 ? 'combo'
    : first.startsWith('bar') ? (kid(groups[0], 'barDir')?.getAttribute('val') === 'bar' ? 'bar' : 'column')
    : first === 'doughnutChart' ? 'doughnut' : series[0].type === 'pie' ? 'pie' : series[0].type;
  return {
    title: desc(kid(desc(doc, 'chart')[0], 'title'), 't').map((x) => x.textContent ?? '').join('') || null,
    kind,
    stacked: groups.some((g) => ['stacked', 'percentStacked'].includes(kid(g, 'grouping')?.getAttribute('val') ?? '')),
    categories: categories.map((v) => (v == null ? '' : typeof v === 'number' ? general(v) : String(v))),
    series,
  };
}
