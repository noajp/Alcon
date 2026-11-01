'use client';

import {
  Area, Bar, CartesianGrid, Cell, ComposedChart, LabelList, Legend, Line, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { ChartData } from './chartLayout';

// A chart from a workbook or a deck, drawn where its file places it:
// column / bar, line, area, scatter (points), combinations of these with a
// secondary axis where the file uses one, value labels where it shows
// them, pie / doughnut and stock (candles: open, high, low, close). A
// series keeps the colour the file gives it; one without falls back to
// Office's default series colours.

const PALETTE = ['var(--sheet-series-1)', 'var(--sheet-series-2)', 'var(--sheet-series-3)', 'var(--sheet-series-4)', 'var(--sheet-series-5)', 'var(--sheet-series-6)'];
const AXIS = { stroke: 'var(--sheet-head-text)', fontSize: 11, tickLine: false } as const;
// Axis numbers grouped, as the sheet shows them (3,400,000, not 3400000).
const grouped = (v: unknown) => (typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(v));
const TIP = { contentStyle: { fontSize: 12, borderRadius: 6 }, labelStyle: { color: 'var(--sheet-text)' } } as const;

type Row = Record<string, string | number | null | [number, number]>;

/** A candle: the high–low wick through the open–close body, rising candles
 *  hollow-coloured, falling ones filled. recharts hands the shape the
 *  pixel box of the [low, high] range; the body is placed inside it. */
function Candle(props: { x?: number; y?: number; width?: number; height?: number; payload?: Row }) {
  const { x = 0, y = 0, width = 0, height = 0, payload } = props;
  const vals = ['o', 'h', 'l', 'c'].map((k) => payload?.[k]);
  if (vals.some((v) => typeof v !== 'number')) return null;
  // The wick spans all four values, whichever column holds the high: files
  // disagree on the order (Excel: open, high, low, close; Google Sheets
  // exports theirs as written).
  const [o, , , c] = vals as number[];
  const h = Math.max(...(vals as number[])), l = Math.min(...(vals as number[]));
  if (!(h > l)) return <line x1={x} x2={x + width} y1={y} y2={y} style={{ stroke: 'var(--sheet-head-text)' }} />;
  const at = (v: number) => y + ((h - v) / (h - l)) * height;
  const up = c >= o;
  const top = at(Math.max(o, c)), bottom = at(Math.min(o, c));
  const mid = x + width / 2;
  const color = up ? 'var(--sheet-up)' : 'var(--sheet-down)';
  return (
    <g>
      <line x1={mid} x2={mid} y1={y} y2={y + height} style={{ stroke: color }} />
      <rect x={x + width * 0.15} width={width * 0.7} y={top} height={Math.max(1, bottom - top)} style={{ fill: color, stroke: color }} />
    </g>
  );
}

export default function SheetChartView({ chart, framed = true }: { chart: ChartData; framed?: boolean }) {
  const { kind, categories, series } = chart;
  const color = (i: number) => series[i]?.color ?? PALETTE[i % PALETTE.length];
  const rows: Row[] = categories.map((name, i) => {
    const row: Row = { name };
    series.forEach((s, j) => { row[`s${j}`] = s.values[i] ?? null; });
    return row;
  });
  // A category axis needs categories; a series with none is indexed.
  if (!rows.length) series[0]?.values.forEach((_, i) => rows.push(Object.fromEntries([['name', String(i + 1)], ...series.map((s, j) => [`s${j}`, s.values[i] ?? null])])));
  const legend = series.length > 1 && kind !== 'stock';

  let body: React.ReactElement;
  if (kind === 'pie' || kind === 'doughnut') {
    body = (
      <PieChart>
        <Tooltip {...TIP} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Pie data={rows} dataKey="s0" nameKey="name" innerRadius={kind === 'doughnut' ? '50%' : 0} outerRadius="80%" isAnimationActive={false}
          label={series[0]?.labels ? { fontSize: 11 } : false}>
          {rows.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
        </Pie>
      </PieChart>
    );
  } else if (kind === 'stock') {
    // Open, high, low, close in the file's series order.
    const candles = rows
      .filter((r) => [r.s0, r.s1, r.s2, r.s3].every((v) => typeof v === 'number'))
      .map((r) => {
        const v = [r.s0, r.s1, r.s2, r.s3] as number[];
        return { name: r.name, o: v[0], h: v[1], l: v[2], c: v[3], range: [Math.min(...v), Math.max(...v)] as [number, number] };
      });
    body = (
      <ComposedChart data={candles}>
        <CartesianGrid vertical={false} style={{ stroke: 'var(--sheet-grid)' }} />
        <XAxis dataKey="name" {...AXIS} />
        <YAxis {...AXIS} domain={['auto', 'auto']} width={72} tickFormatter={grouped} />
        <Tooltip {...TIP} />
        <Bar dataKey="range" shape={<Candle />} isAnimationActive={false} />
      </ComposedChart>
    );
  } else {
    // Every other kind is one composed chart: each series drawn as its own
    // type, against the left or the right axis.
    const horizontal = kind === 'bar';
    const twoAxes = series.some((s) => s.axis === 'right');
    body = (
      // Room above the tallest bar for its value label.
      <ComposedChart data={rows} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 16, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={horizontal} horizontal={!horizontal} style={{ stroke: 'var(--sheet-grid)' }} />
        {horizontal
          ? <><XAxis type="number" {...AXIS} tickFormatter={grouped} /><YAxis type="category" dataKey="name" {...AXIS} width={80} /></>
          : <>
              <XAxis dataKey="name" {...AXIS} />
              <YAxis yAxisId="left" {...AXIS} width={72} tickFormatter={grouped} />
              {twoAxes && <YAxis yAxisId="right" orientation="right" {...AXIS} width={72} tickFormatter={grouped} />}
            </>}
        <Tooltip {...TIP} />
        {legend && <Legend wrapperStyle={{ fontSize: 11 }} />}
        {series.map((s, j) => {
          const common = { dataKey: `s${j}`, name: s.name || `Series ${j + 1}`, isAnimationActive: false, ...(horizontal ? {} : { yAxisId: s.axis }) };
          const labels = s.labels && <LabelList dataKey={`s${j}`} position="top" formatter={grouped} style={{ fontSize: 10, fill: 'var(--sheet-text)' }} />;
          if (s.type === 'line' || s.type === 'scatter') {
            return <Line key={j} {...common} stroke={color(j)} dot={s.type === 'scatter'} strokeWidth={s.type === 'scatter' ? 0 : 2} connectNulls>{labels}</Line>;
          }
          if (s.type === 'area') return <Area key={j} {...common} stroke={color(j)} fill={color(j)} fillOpacity={0.35} stackId={chart.stacked ? 'a' : undefined}>{labels}</Area>;
          return <Bar key={j} {...common} fill={color(j)} stackId={chart.stacked ? 'a' : undefined}>{labels}</Bar>;
        })}
      </ComposedChart>
    );
  }

  return (
    <div className={`flex h-full w-full flex-col p-2 text-[var(--sheet-text)] ${framed ? 'border border-[var(--sheet-grid)] bg-[var(--sheet-paper)]' : ''}`}>
      {chart.title && <div className="shrink-0 pb-1 text-center text-[13px] font-semibold">{chart.title}</div>}
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">{body}</ResponsiveContainer>
      </div>
    </div>
  );
}
