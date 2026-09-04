'use client';

import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useObjects, useStrategies } from '@/hooks/useSupabase';
import type { AlconObjectWithChildren } from '@/hooks/useSupabase';
import {
  tallyInNaturalOrder,
  type Dimension,
  type DimensionContext,
  type Tallied,
} from '@/alcon/shared/dimensions';
import { useWidgetEmpty, useWidgetMeta } from '../WidgetFrame';
import { DimensionPicker } from '../DimensionPicker';
import type { WidgetParams, WidgetProps } from '../types';

// recharts is ~400KB and only the donut needs it, so the donut is the only
// thing that pulls it — a board showing bars never fetches the library.
const BreakdownDonut = dynamic(
  () => import('./BreakdownDonut').then((m) => m.BreakdownDonut),
  { ssr: false, loading: () => <div className="h-[140px] animate-pulse rounded-md bg-muted/30" /> },
);

// =============================================================
// Breakdown — how many, by whatever you choose.
//
// This was two widgets: a status bar chart and a priority donut. They ran the
// same count against a different column and differed only in the shape they
// drew, so the axis was a property of the placement pretending to be a
// property of the widget — and "by label" or "by assignee", which the data
// has always supported, could not be asked at all.
//
// Now the question is configuration. `dimension` says what to count by,
// `shape` says how to draw it, and both live on the board beside the widget.
// =============================================================

export type BreakdownShape = 'bar' | 'donut';

export interface BreakdownParams extends WidgetParams {
  dimension: Dimension;
  shape: BreakdownShape;
}

export function BreakdownWidget({ host, params, setParams }: WidgetProps) {
  const { dimension, shape } = params as BreakdownParams;
  const { data: strategies } = useStrategies();
  const { data: explorer } = useObjects(null);

  // Only the Object and Campaign dimensions need names the rows cannot supply.
  const ctx = useMemo<DimensionContext>(() => {
    const objectNames = new Map<string, string>();
    const walk = (nodes: AlconObjectWithChildren[]) => {
      for (const o of nodes) {
        objectNames.set(o.id, o.name);
        if (o.children) walk(o.children);
      }
    };
    walk(explorer.objects);

    const campaignsByObject = new Map<string, { id: string; name: string }[]>();
    for (const s of strategies) {
      for (const objectId of s.objectIds) {
        campaignsByObject.set(objectId, [
          ...(campaignsByObject.get(objectId) ?? []),
          { id: s.id, name: s.name },
        ]);
      }
    }
    return { objectNames, campaignsByObject };
  }, [explorer.objects, strategies]);

  const rows = useMemo(
    () => tallyInNaturalOrder(host.elements, dimension, ctx),
    [host.elements, dimension, ctx],
  );

  // The parts sum to the buckets, not to the Elements: on a multi-valued
  // dimension an Element is genuinely in two of them, and dividing by the
  // Element count would give percentages that add past a hundred.
  const total = rows.reduce((sum, r) => sum + r.value, 0);

  useWidgetMeta(total === 0 ? null : `${total}`);
  useWidgetEmpty(rows.length === 0);
  if (rows.length === 0) return null;

  return (
    <>
      <DimensionPicker value={dimension} shape={shape} onChange={setParams} />
      <div className="px-3 py-2">
        {shape === 'donut' ? (
          <BreakdownDonut rows={rows} total={total} />
        ) : (
          <BreakdownBars rows={rows} total={total} />
        )}
      </div>
    </>
  );
}

function BreakdownBars({ rows, total }: { rows: Tallied[]; total: number }) {
  return (
    <div className="space-y-2">
      {rows.map((row) => {
        const pct = total > 0 ? Math.round((row.value / total) * 100) : 0;
        return (
          <div key={row.id} className="flex items-center gap-3">
            <span className="w-24 shrink-0 truncate text-right text-[11px] text-muted-foreground">
              {row.label}
            </span>
            <div className="relative h-4 flex-1 overflow-hidden rounded-md bg-muted/40">
              <div
                className="h-full rounded-md"
                // A dimension whose values are user data has no palette of its
                // own; borrowing one would be colour that means nothing.
                style={{
                  width: `${Math.max(pct, row.value > 0 ? 3 : 0)}%`,
                  backgroundColor: row.color ?? 'var(--border-strong)',
                }}
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-medium tabular-nums text-foreground/70">
                {row.value}
              </span>
            </div>
            <span className="w-8 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
              {pct}%
            </span>
          </div>
        );
      })}
    </div>
  );
}
