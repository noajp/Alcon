'use client';

import { useMemo } from 'react';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { ActionState, MissionGraph as Graph, MissionNode } from './missionModel';
import type { MeasureState } from '../initiativeMeasureModel';

// The mission as a graph, left to right: the Strategy, what it is held to,
// the actions that serve each, what they produced. Columns, not a force
// layout — a reader follows intent to outcome along one axis, and the same
// mission draws the same way every time. Dependencies between actions are
// the dashed curves inside the action column.

const COL_W = 220;
const COL_GAP = 56;
const NODE_H = 44;
const ROW_GAP = 14;
const PAD = 16;

const KIND_LABEL: Record<MissionNode['kind'], string> = {
  initiative: 'Strategy',
  measure: 'Objective',
  action: 'Action',
  artifact: 'Deliverable',
};

const STATE_LABEL: Record<ActionState | MeasureState, string> = {
  done: 'Done', running: 'Running', waiting: 'Waiting', blocked: 'Blocked', failed: 'Failed', todo: 'To do', cancelled: 'Cancelled',
  met: 'Met', missed: 'Missed', unmeasured: 'Not measured', unstated: 'No target',
};

function stateColor(state: MissionNode['state']): string {
  switch (state) {
    case 'done': case 'met': return 'var(--status-success)';
    case 'running': return 'var(--status-info)';
    case 'waiting': return 'var(--status-warning)';
    case 'blocked': case 'failed': case 'missed': return 'var(--status-danger)';
    default: return 'var(--text-tertiary)';
  }
}

export function MissionGraph({ graph, onOpenAction }: {
  graph: Graph;
  onOpenAction?: (elementId: string) => void;
}) {
  const { t } = useI18n();
  const layout = useMemo(() => {
    // A column with nothing in it (no objectives yet, no deliverables yet)
    // takes no room: the columns that have nodes close up.
    const used = [...new Set(graph.nodes.map((n) => n.column))].sort((a, b) => a - b);
    const slot = new Map(used.map((c, i) => [c, i]));
    const pos = new Map<string, { x: number; y: number }>();
    const rows = [0, 0, 0, 0];
    for (const n of graph.nodes) {
      const r = rows[n.column]++;
      pos.set(n.id, { x: PAD + slot.get(n.column)! * (COL_W + COL_GAP), y: PAD + r * (NODE_H + ROW_GAP) });
    }
    const height = PAD * 2 + Math.max(1, ...rows) * (NODE_H + ROW_GAP);
    // Dependencies arc out to the right of the action column; leave them room.
    const arcs = graph.edges.some((e) => e.kind === 'depends') ? 48 : 0;
    const width = PAD * 2 + used.length * COL_W + Math.max(0, used.length - 1) * COL_GAP + arcs;
    return { pos, width, height };
  }, [graph]);

  return (
    <div className="max-h-[560px] overflow-auto rounded-lg border border-border/60 bg-[var(--surface-muted)]">
      <div className="relative" style={{ width: layout.width, height: layout.height }}>
        <svg className="absolute inset-0" width={layout.width} height={layout.height} aria-hidden="true">
          {graph.edges.map((e, i) => {
            const a = layout.pos.get(e.from);
            const b = layout.pos.get(e.to);
            if (!a || !b) return null;
            const depends = e.kind === 'depends';
            // Within a column a dependency arcs out to the right; across
            // columns an edge runs from one card's right side to the next's left.
            const x1 = depends ? a.x + COL_W : a.x + COL_W;
            const y1 = a.y + NODE_H / 2;
            const x2 = depends ? b.x + COL_W : b.x;
            const y2 = b.y + NODE_H / 2;
            const bend = depends ? 40 : (x2 - x1) / 2;
            const d = depends
              ? `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 + bend} ${y2}, ${x2} ${y2}`
              : `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
            return (
              <path key={i} d={d} fill="none"
                stroke={e.kind === 'produces' ? 'var(--status-success)' : depends ? 'var(--status-warning)' : 'var(--border-strong)'}
                strokeWidth={1.25} strokeDasharray={depends || e.draft ? '4 4' : undefined} opacity={0.8} />
            );
          })}
        </svg>
        {graph.nodes.map((n) => {
          const p = layout.pos.get(n.id)!;
          const clickable = n.kind === 'action' && n.elementId && onOpenAction;
          return (
            <button key={n.id} type="button" disabled={!clickable}
              onClick={clickable ? () => onOpenAction!(n.elementId!) : undefined}
              title={n.label}
              className={`absolute flex flex-col justify-center rounded-md border bg-card px-2.5 text-left transition-colors ${clickable ? 'hover:bg-muted/40 cursor-pointer' : 'cursor-default'} ${n.draft ? 'border-dashed border-border' : 'border-border/70'}`}
              style={{ left: p.x, top: p.y, width: COL_W, height: NODE_H }}>
              <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <span>{t(KIND_LABEL[n.kind])}</span>
                {n.state && (
                  <span className="inline-flex items-center gap-1" style={{ color: stateColor(n.state) }}>
                    <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: stateColor(n.state) }} />
                    {t(STATE_LABEL[n.state])}
                  </span>
                )}
                {n.draft && <span>· {t('Draft')}</span>}
              </span>
              <span className="truncate text-[12px] font-medium text-foreground">{n.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
