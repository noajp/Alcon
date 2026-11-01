'use client';

import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { SheetChart } from './sheetLayout';

// A chart from a workbook, drawn where the sheet places it: column / bar,
// line, area, pie / doughnut, scatter (as points on a line) and stock
// (candles: open, high, low, close). A series keeps the colour the file
// gives it; one without falls back to the workbook-neutral palette.

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

export default function SheetChartView({ chart }: { chart: SheetChart }) {
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
  const lines = series.map((s, j) => ({ key: `s${j}`, name: s.name || `Series ${j + 1}`, color: color(j) }));

  let body: React.ReactElement;
  if (kind === 'pie' || kind === 'doughnut') {
    body = (
      <PieChart>
        <Tooltip {...TIP} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Pie data={rows} dataKey="s0" nameKey="name" innerRadius={kind === 'doughnut' ? '50%' : 0} outerRadius="80%" isAnimationActive={false}>
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
  } else if (kind === 'line' || kind === 'scatter') {
    body = (
      <LineChart data={rows}>
        <CartesianGrid vertical={false} style={{ stroke: 'var(--sheet-grid)' }} />
        <XAxis dataKey="name" {...AXIS} />
        <YAxis {...AXIS} width={72} tickFormatter={grouped} />
        <Tooltip {...TIP} />
        {legend && <Legend wrapperStyle={{ fontSize: 11 }} />}
        {lines.map((l) => <Line key={l.key} dataKey={l.key} name={l.name} stroke={l.color} dot={kind === 'scatter'} strokeWidth={kind === 'scatter' ? 0 : 2} isAnimationActive={false} connectNulls />)}
      </LineChart>
    );
  } else if (kind === 'area') {
    body = (
      <AreaChart data={rows}>
        <CartesianGrid vertical={false} style={{ stroke: 'var(--sheet-grid)' }} />
        <XAxis dataKey="name" {...AXIS} />
        <YAxis {...AXIS} width={72} tickFormatter={grouped} />
        <Tooltip {...TIP} />
        {legend && <Legend wrapperStyle={{ fontSize: 11 }} />}
        {lines.map((l) => <Area key={l.key} dataKey={l.key} name={l.name} stroke={l.color} fill={l.color} fillOpacity={0.35} stackId={chart.stacked ? 'a' : undefined} isAnimationActive={false} />)}
      </AreaChart>
    );
  } else {
    const horizontal = kind === 'bar';
    body = (
      <BarChart data={rows} layout={horizontal ? 'vertical' : 'horizontal'}>
        <CartesianGrid vertical={horizontal} horizontal={!horizontal} style={{ stroke: 'var(--sheet-grid)' }} />
        {horizontal ? <><XAxis type="number" {...AXIS} tickFormatter={grouped} /><YAxis type="category" dataKey="name" {...AXIS} width={80} /></>
          : <><XAxis dataKey="name" {...AXIS} /><YAxis {...AXIS} width={72} tickFormatter={grouped} /></>}
        <Tooltip {...TIP} />
        {legend && <Legend wrapperStyle={{ fontSize: 11 }} />}
        {lines.map((l) => <Bar key={l.key} dataKey={l.key} name={l.name} fill={l.color} stackId={chart.stacked ? 'a' : undefined} isAnimationActive={false} />)}
      </BarChart>
    );
  }

  return (
    <div className="flex h-full w-full flex-col border border-[var(--sheet-grid)] bg-[var(--sheet-paper)] p-2 text-[var(--sheet-text)]">
      {chart.title && <div className="shrink-0 pb-1 text-center text-[13px] font-semibold">{chart.title}</div>}
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">{body}</ResponsiveContainer>
      </div>
    </div>
  );
}
