// Charts inside the AI's answer. The model writes a fenced block
//
//   ```chart
//   {"type":"bar","title":"…","data":[{"name":"4月","売上":120}, …]}
//   ```
//
// and the answer shows it as a chart. The block is data only: anything that
// does not parse into a spec stays visible as code, never runs.

export type ChartType = 'bar' | 'line' | 'area' | 'pie';

export interface ChartSpec {
  type: ChartType;
  title?: string;
  /** One row per category; `name` labels it, the other keys are numbers. */
  data: Array<{ name: string } & Record<string, string | number>>;
  /** The numeric keys drawn, in order. */
  series: string[];
  stacked?: boolean;
}

export type AnswerPart = { kind: 'text'; text: string } | { kind: 'chart'; spec: ChartSpec } | { kind: 'pending' };

const TYPES: ChartType[] = ['bar', 'line', 'area', 'pie'];
const MAX_ROWS = 200;

/** A spec from the block's JSON, or null when it is not one. */
export function parseChartSpec(raw: string): ChartSpec | null {
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return null; }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const type = TYPES.includes(o.type as ChartType) ? (o.type as ChartType) : null;
  if (!type || !Array.isArray(o.data) || o.data.length === 0 || o.data.length > MAX_ROWS) return null;
  const data: ChartSpec['data'] = [];
  for (const row of o.data) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
    const r = row as Record<string, unknown>;
    const out: Record<string, string | number> = { name: String(r.name ?? r.label ?? '') };
    for (const [k, val] of Object.entries(r)) {
      if (k === 'name' || k === 'label') continue;
      if (typeof val === 'number' && Number.isFinite(val)) out[k] = val;
    }
    data.push(out as ChartSpec['data'][number]);
  }
  const found = [...new Set(data.flatMap((r) => Object.keys(r).filter((k) => k !== 'name')))];
  const asked = Array.isArray(o.series) ? o.series.filter((s): s is string => typeof s === 'string' && found.includes(s)) : [];
  const series = asked.length ? asked : found;
  if (series.length === 0) return null;
  return {
    type,
    ...(typeof o.title === 'string' && o.title.trim() ? { title: o.title.trim().slice(0, 120) } : {}),
    data,
    series: type === 'pie' ? series.slice(0, 1) : series.slice(0, 6),
    ...(o.stacked === true ? { stacked: true } : {}),
  };
}

const FENCE = /```chart[^\n]*\n([\s\S]*?)```/g;

/** Splits an answer into prose and charts. A chart block still being
 *  streamed (opened, not yet closed) is `pending`; a block that is not a
 *  valid spec stays in the prose as code. */
export function splitAnswer(content: string): AnswerPart[] {
  const parts: AnswerPart[] = [];
  let last = 0;
  for (const m of content.matchAll(FENCE)) {
    const before = content.slice(last, m.index);
    const spec = parseChartSpec(m[1]);
    if (spec) {
      if (before.trim()) parts.push({ kind: 'text', text: before });
      parts.push({ kind: 'chart', spec });
    } else {
      parts.push({ kind: 'text', text: before + m[0] });
    }
    last = m.index! + m[0].length;
  }
  const rest = content.slice(last);
  const open = rest.indexOf('```chart');
  if (open >= 0) {
    if (rest.slice(0, open).trim()) parts.push({ kind: 'text', text: rest.slice(0, open) });
    parts.push({ kind: 'pending' });
  } else if (rest.trim()) {
    parts.push({ kind: 'text', text: rest });
  }
  // Adjacent prose pieces read as one.
  return parts.reduce<AnswerPart[]>((acc, p) => {
    const prev = acc[acc.length - 1];
    if (p.kind === 'text' && prev?.kind === 'text') prev.text += p.text;
    else acc.push(p);
    return acc;
  }, []);
}
