'use client';

import { useMemo } from 'react';
import { useObjects, useStrategies } from '@/hooks/useSupabase';
import { useWidgetEmpty, useWidgetMeta } from '../WidgetFrame';
import { effortFlow, isFoldedNode, type FlowNode } from './effortFlowModel';
import { DimensionPicker } from '../DimensionPicker';
import { DIMENSION_LABEL, type Dimension, type DimensionContext } from '@/Function/shared/dimensions';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { WidgetParams, WidgetProps } from '../types';

// =============================================================
// Where the people are — Worker → Object → Strategy.
//
// Drawn by hand rather than reached for from a chart library. Two reasons,
// and only one of them is weight: the app already carries recharts (which has
// no Sankey), so a second engine would be two theming paths and two idioms
// for one figure. The other reason is that the nodes here are rows — a Worker,
// an Object, a Strategy — and a ribbon whose ends open the thing they stand
// for is the whole point. A chart library's node is a datum.
//
// Every colour is a token. There are eight themes, and a palette chosen by
// lightness inverts in half of them.
// =============================================================

const HEIGHT = 260;
/** Node width in viewBox units, where the box is 100 wide. `preserveAspect
 *  Ratio="none"` stretches x, so this is a share of the figure, not pixels. */
const NODE_W = 1.2;
const PAD_Y = 4;
/** Room for the label to the right of each node box. */
const LABEL_GAP = 6;

export interface FlowParams {
  /** The columns, left to right. Two or three; a column that collapses to a
   *  single bucket is dropped by the model. */
  dimensions: Dimension[];
}

export function EffortFlowWidget({ host, params, setParams }: WidgetProps) {
  const { t } = useI18n();
  const { dimensions } = params as unknown as FlowParams;
  const { data: strategies } = useStrategies();
  // Object and Strategy buckets are uuids; the names come from the explorer,
  // not from `element.objects`, which the type documents as populated only on
  // the views that need it.
  const { data: explorer } = useObjects(null);

  const ctx = useMemo<DimensionContext>(() => {
    const objectNames = new Map(explorer.objects.map((o) => [o.id, o.name]));

    const initiativesByObject = new Map<string, { id: string; name: string }[]>();
    for (const s of strategies) {
      for (const objectId of s.objectIds) {
        initiativesByObject.set(objectId, [
          ...(initiativesByObject.get(objectId) ?? []),
          { id: s.id, name: s.name },
        ]);
      }
    }
    return { objectNames, initiativesByObject };
  }, [explorer.objects, strategies]);

  // Finished work is not where the people are. The filter is the widget's,
  // not the model's — a flow of closed Elements is a fine question, just not
  // the one this default asks.
  const open = useMemo(
    () => host.elements.filter((e) => e.status !== 'done' && e.status !== 'cancelled'),
    [host.elements],
  );

  const flow = useMemo(() => effortFlow(open, dimensions, ctx), [open, dimensions, ctx]);

  useWidgetMeta(flow.total === 0 ? null : t('{n} open', { n: flow.total }));
  useWidgetEmpty(flow.total === 0 || flow.columns.length < 2);
  if (flow.total === 0 || flow.columns.length < 2) return null;

  const cols = flow.columns.length;
  const title = flow.columns.map((d) => t(DIMENSION_LABEL[d])).join(' → ');
  const colX = (i: number) => 0.06 + (i / (cols - 1)) * 0.62;

  const open_ = (node: FlowNode) => {
    if (isFoldedNode(node)) return;
    if (node.dimension === 'campaign') {
      host.onNavigate?.({ strategyId: node.entityId });
      host.onViewChange?.('strategy');
    } else if (node.dimension === 'object') {
      host.onNavigate?.({ objectId: node.entityId });
      // 'objects' is the view id for the Object surface — 'execution' is the
      // rail MODE, and setting it as a view lands on a view that does not exist.
      host.onViewChange?.('objects');
    }
  };

  const y = (fraction: number) => PAD_Y + fraction * (HEIGHT - PAD_Y * 2);
  const openable = (node: FlowNode) =>
    !isFoldedNode(node) && (node.dimension === 'object' || node.dimension === 'campaign');

  return (
    <>
      <FlowDimensionPicker dimensions={dimensions} onChange={setParams} />
      <div className="py-2">
        <div className="mb-1.5 text-[11px] text-muted-foreground">{title}</div>

        <svg
          viewBox={`0 0 100 ${HEIGHT}`}
          preserveAspectRatio="none"
          className="w-full"
          style={{ height: HEIGHT }}
          role="img"
          aria-label={t('{n} Elements, {title}', { n: flow.total, title })}
        >
          {/* Ribbons first, so a node box always sits on top of what it joins. */}
          {flow.links.map((link) => {
            const from = flow.nodes.find((n) => n.id === link.from)!;
            const to = flow.nodes.find((n) => n.id === link.to)!;
            const x0 = colX(from.column) * 100 + NODE_W;
            const x1 = colX(to.column) * 100;
            const mid = (x0 + x1) / 2;
            const y0 = y(link.fromOffset);
            const y0b = y(link.fromOffset + link.fromHeight);
            const y1 = y(link.toOffset);
            const y1b = y(link.toOffset + link.toHeight);
            return (
              <path
                key={link.id}
                d={`M${x0},${y0} C${mid},${y0} ${mid},${y1} ${x1},${y1} L${x1},${y1b} C${mid},${y1b} ${mid},${y0b} ${x0},${y0b} Z`}
                fill="var(--text-secondary)"
                opacity={0.16}
              />
            );
          })}

          {flow.nodes.map((node) => {
            const top = y(node.offset);
            const height = Math.max(1.5, y(node.offset + node.height) - top);
            return (
              <rect
                key={node.id}
                x={colX(node.column) * 100}
                y={top}
                width={NODE_W}
                height={height}
                rx={0.4}
                fill={node.column === 0 ? 'var(--accent-default)' : 'var(--border-strong)'}
                onClick={openable(node) ? () => open_(node) : undefined}
                className={openable(node) ? 'cursor-pointer' : undefined}
              />
            );
          })}
        </svg>

        {/* Labels as HTML, positioned by the same fractions the svg used: text
            inside a non-uniformly scaled svg is stretched. `pointer-events-none`
            on the layer, restored per label, so the node boxes under it stay
            reachable. */}
        <div
          className="relative pointer-events-none"
          style={{ marginTop: -HEIGHT, height: HEIGHT }}
        >
          {flow.nodes.map((node) => (
            <button
              key={node.id}
              type="button"
              disabled={!openable(node)}
              onClick={() => open_(node)}
              title={`${node.label} · ${Math.round(node.value * 10) / 10}`}
              className={`pointer-events-auto absolute max-w-[28%] truncate text-left text-[10px] leading-none ${
                isFoldedNode(node) ? 'text-muted-foreground/60' : 'text-muted-foreground'
              } ${openable(node) ? 'hover:text-foreground hover:underline' : 'cursor-default'}`}
              style={{
                left: `calc(${colX(node.column) * 100 + NODE_W}% + ${LABEL_GAP}px)`,
                top: y(node.offset) + 1,
              }}
            >
              {node.label}
              <span className="ml-1 tabular-nums text-muted-foreground/70">
                {Math.round(node.value * 10) / 10}
              </span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

/** Three dropdowns, one per column. The third can be cleared to two columns. */
function FlowDimensionPicker({
  dimensions,
  onChange,
}: {
  dimensions: Dimension[];
  onChange: (params: WidgetParams) => void;
}) {
  return (
    <>
      {[0, 1, 2].map((i) => {
        const value = dimensions[i];
        if (i === 2 && !value) return null;
        return (
          <DimensionPicker
            key={i}
            value={value}
            onChange={(next) => {
              const dimension = next.dimension as Dimension;
              const nextDimensions = [...dimensions];
              nextDimensions[i] = dimension;
              onChange({ dimensions: nextDimensions });
            }}
          />
        );
      })}
    </>
  );
}
