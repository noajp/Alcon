'use client';

import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { ChartSpec } from './chartSpec';

// A chart the AI drew inside its answer. The spec is data only (chartSpec.ts
// validates it); colors are the key color's family, from the theme's tokens.

// Built around the key color (the accent blue): the accent first, then it
// lifted toward the text color and sunk toward the card by turns — one
// family, far enough apart to tell slices apart, so a chart reads as part of
// the UI rather than a rainbow.
const lift = (pct: number) => `color-mix(in oklab, var(--accent-default), var(--text-primary) ${pct}%)`;
const sink = (pct: number) => `color-mix(in oklab, var(--accent-default), var(--card) ${pct}%)`;
const COLORS = ['var(--accent-default)', lift(40), sink(35), lift(65), lift(20), sink(55)];
const AXIS = { stroke: 'var(--text-tertiary)', fontSize: 11, tickLine: false } as const;
const TOOLTIP = {
  contentStyle: { background: 'var(--surface-overlay)', borderColor: 'var(--border-subtle)', borderRadius: 8, fontSize: 12 },
  labelStyle: { color: 'var(--text-secondary)' },
} as const;

export default function ChatChart({ spec }: { spec: ChartSpec }) {
  const { type, data, series } = spec;
  const many = series.length > 1;
  return (
    <figure className="rounded-lg border border-border/60 p-2 animate-fade-in">
      {spec.title && <figcaption className="px-1 pb-1 text-[12px] font-medium text-foreground">{spec.title}</figcaption>}
      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {type === 'pie' ? (
            <PieChart>
              <Tooltip {...TOOLTIP} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Pie data={data} dataKey={series[0]} nameKey="name" innerRadius="45%" outerRadius="80%" paddingAngle={1} stroke="var(--card)" strokeWidth={2}>
                {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
            </PieChart>
          ) : type === 'line' ? (
            <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid stroke="var(--border-subtle)" vertical={false} />
              <XAxis dataKey="name" {...AXIS} />
              <YAxis {...AXIS} />
              <Tooltip {...TOOLTIP} />
              {many && <Legend wrapperStyle={{ fontSize: 11 }} />}
              {series.map((key, i) => <Line key={key} dataKey={key} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} />)}
            </LineChart>
          ) : type === 'area' ? (
            <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid stroke="var(--border-subtle)" vertical={false} />
              <XAxis dataKey="name" {...AXIS} />
              <YAxis {...AXIS} />
              <Tooltip {...TOOLTIP} />
              {many && <Legend wrapperStyle={{ fontSize: 11 }} />}
              {series.map((key, i) => <Area key={key} dataKey={key} stroke={COLORS[i % COLORS.length]} fill={COLORS[i % COLORS.length]} fillOpacity={0.15} />)}
            </AreaChart>
          ) : (
            <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid stroke="var(--border-subtle)" vertical={false} />
              <XAxis dataKey="name" {...AXIS} />
              <YAxis {...AXIS} />
              <Tooltip {...TOOLTIP} cursor={{ fill: 'var(--surface-strong)' }} />
              {many && <Legend wrapperStyle={{ fontSize: 11 }} />}
              {series.map((key, i) => <Bar key={key} dataKey={key} fill={COLORS[i % COLORS.length]} radius={[4, 4, 0, 0]} stackId={spec.stacked ? 's' : undefined} />)}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
