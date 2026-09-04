'use client';

import { useMemo } from 'react';
import { useObjects, useStrategies } from '@/hooks/useSupabase';
import type { AlconObjectWithChildren } from '@/hooks/useSupabase';
import { useWidgetEmpty, useWidgetMeta } from '../WidgetFrame';
import {
  effortFlow,
  isFoldedNode,
  type AssignmentInput,
  type FlowKind,
  type FlowNode,
} from './effortFlowModel';
import type { WidgetHost } from '../types';

// =============================================================
// Where the people are — Worker → Object → Campaign.
//
// Drawn by hand rather than reached for from a chart library. Two reasons,
// and only one of them is weight: the app already carries recharts (which has
// no Sankey), so a second engine would be two theming paths and two idioms
// for one figure. The other reason is that the nodes here are rows — a Worker,
// an Object, a Campaign — and a ribbon whose ends open the thing they stand
// for is the whole point. A chart library's node is a datum.
//
// Every colour is a token. There are eight themes, and a palette chosen by
// lightness inverts in half of them.
// =============================================================

const HEIGHT = 260;
const NODE_W = 10;
const PAD_Y = 4;
/** Room for the label to the right of each node box. */
const LABEL_GAP = 6;

const KIND_FILL: Record<FlowKind, string> = {
  worker: 'var(--accent-default)',
  object: 'var(--border-strong)',
  campaign: 'var(--text-secondary)',
};

const COLUMN_LABEL: Record<FlowKind, string> = {
  worker: 'Worker',
  object: 'Object',
  campaign: 'Campaign',
};

export function EffortFlowWidget({ host }: { host: WidgetHost }) {
  const { data: strategies } = useStrategies();
  // Object names come from the explorer rather than from `element.objects`,
  // which the type documents as populated only on the views that need it —
  // on this one it is absent, and every node was labelled "Object".
  const { data: explorer } = useObjects(null);

  const objectNames = useMemo(() => {
    const names = new Map<string, string>();
    const walk = (nodes: AlconObjectWithChildren[]) => {
      for (const o of nodes) {
        names.set(o.id, o.name);
        if (o.children) walk(o.children);
      }
    };
    walk(explorer.objects);
    return names;
  }, [explorer.objects]);

  const campaignsByObject = useMemo(() => {
    const map = new Map<string, { id: string; name: string }[]>();
    for (const s of strategies) {
      for (const objectId of s.objectIds) {
        map.set(objectId, [...(map.get(objectId) ?? []), { id: s.id, name: s.name }]);
      }
    }
    return map;
  }, [strategies]);

  // One row per (Element, assignee). An Element with two people on it is two
  // assignments, which is what "where are the people" asks — not how many
  // Elements exist.
  const assignments = useMemo<AssignmentInput[]>(() => {
    const out: AssignmentInput[] = [];
    for (const el of host.elements) {
      if (el.status === 'done' || el.status === 'cancelled') continue;
      const objectId = el.object_id;
      if (!objectId) continue;
      for (const a of el.assignees ?? []) {
        if (!a.worker) continue;
        out.push({
          elementId: el.id,
          workerId: a.worker.id,
          workerName: a.worker.name,
          objectId,
          objectName: objectNames.get(objectId) ?? 'Object',
        });
      }
    }
    return out;
  }, [host.elements, objectNames]);

  const flow = useMemo(
    () => effortFlow(assignments, campaignsByObject),
    [assignments, campaignsByObject],
  );

  useWidgetMeta(
    flow.total === 0 ? null : `${flow.total} open assignment${flow.total === 1 ? '' : 's'}`,
  );
  useWidgetEmpty(flow.total === 0);
  if (flow.total === 0) return null;

  const cols = flow.columns.length;
  // Fractions of the viewBox width. The last column's box sits inboard of the
  // right edge so its label has somewhere to go.
  const colX = (i: number) => (cols === 1 ? 0.5 : 0.06 + (i / (cols - 1)) * 0.62);

  const open = (node: FlowNode) => {
    if (isFoldedNode(node)) return;
    if (node.kind === 'campaign') {
      host.onNavigate?.({ strategyId: node.entityId });
      host.onViewChange?.('strategy');
    } else if (node.kind === 'object') {
      host.onNavigate?.({ objectId: node.entityId });
      host.onViewChange?.('execution');
    }
  };

  const y = (fraction: number) => PAD_Y + fraction * (HEIGHT - PAD_Y * 2);

  return (
    <div className="px-3 py-2">
      <div className="mb-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
        {flow.columns.map((kind, i) => (
          <span key={kind} className={i === 0 ? '' : 'before:mr-2 before:content-["→"]'}>
            {COLUMN_LABEL[kind]}
          </span>
        ))}
      </div>

      <svg
        viewBox={`0 0 100 ${HEIGHT}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height: HEIGHT }}
        role="img"
        aria-label={`${flow.total} open assignments, from Worker to ${
          COLUMN_LABEL[flow.columns[flow.columns.length - 1]]
        }`}
      >
        {/* Ribbons first, so a node box always sits on top of what it joins. */}
        {flow.links.map((link) => {
          const from = flow.nodes.find((n) => n.id === link.from)!;
          const to = flow.nodes.find((n) => n.id === link.to)!;
          const x0 = colX(from.column) * 100 + NODE_W / 100;
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
          const x = colX(node.column) * 100;
          const clickable = !isFoldedNode(node) && node.kind !== 'worker';
          return (
            <g
              key={node.id}
              onClick={clickable ? () => open(node) : undefined}
              className={clickable ? 'cursor-pointer' : undefined}
            >
              <rect
                x={x}
                y={top}
                width={NODE_W / 100}
                height={height}
                rx={0.06}
                fill={KIND_FILL[node.kind]}
              />
              {/* preserveAspectRatio="none" stretches the viewBox, so text is
                  placed in an unscaled foreignObject-free way: a tspan here
                  would be squashed horizontally. The labels live outside the
                  svg instead — see the list below. */}
            </g>
          );
        })}
      </svg>

      {/* Labels as HTML, positioned by the same fractions the svg used. Text
          inside a non-uniformly scaled svg is stretched; this keeps the
          type on the app's own scale and keeps the nodes selectable. */}
      <div className="relative" style={{ marginTop: -HEIGHT, height: HEIGHT }}>
        {flow.nodes.map((node) => {
          const clickable = !isFoldedNode(node) && node.kind !== 'worker';
          const top = y(node.offset);
          return (
            <button
              key={node.id}
              type="button"
              disabled={!clickable}
              onClick={() => open(node)}
              title={`${node.label} · ${node.value}`}
              className={`absolute max-w-[28%] truncate text-left text-[10px] leading-none ${
                isFoldedNode(node) ? 'text-muted-foreground/60' : 'text-muted-foreground'
              } ${clickable ? 'hover:text-foreground hover:underline' : 'cursor-default'}`}
              style={{
                left: `calc(${colX(node.column) * 100}% + ${NODE_W / 100 + LABEL_GAP}px)`,
                top: top + 1,
              }}
            >
              {node.label}
              <span className="ml-1 tabular-nums text-muted-foreground/70">{node.value}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
