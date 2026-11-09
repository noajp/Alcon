'use client';

// The definition flow canvas (Sim-incorporation prototype design §5):
// a definition body drawn from its own structure, for judging a flow
// at a glance. The one renderer for both surfaces — the promotion
// review and an Automation's expansion — over the one projection
// (Function/shared/flowProjection); there is no second implementation.
//
// Read-only, as the piece's scope fixes: positions come from the
// projection and are never stored, nodes cannot be dragged or
// connected, and nothing here writes. Panning and zooming are view
// state only. The body remains the single truth — this is a
// projection of it, the way the Execution Chain projects Elements.

import { useMemo, type CSSProperties } from 'react';
import {
  Controls, Handle, Panel, Position, ReactFlow,
  type Edge, type Node, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { useI18n } from '@/Function/i18n/I18nProvider';
import {
  FLOW_NODE_WIDTH, projectDefinitionFlow,
  type FlowContext, type FlowNode, type FlowNodeKind,
} from '@/Function/shared/flowProjection';
import { cn } from '@/lib/utils';
import { Diamond } from '@/ui/icons';
import { parseDefinition } from './harnessDefinition';

const KIND_LABEL: Record<FlowNodeKind, string> = {
  trigger: 'Trigger',
  target: 'Element target',
  step: 'Step',
  condition: 'Condition step',
  checks: 'Checks gate',
  output: 'Output shape',
  stop: 'Stop when',
};

/** The chip tone per kind, in the shared status/surface vocabulary —
 *  warning for the declared conditions, success for the gate, danger
 *  for the terminal stop; the rest sit on the neutral surface. */
const KIND_CHIP: Record<FlowNodeKind, string> = {
  trigger: 'bg-[var(--surface-strong)] text-foreground',
  target: 'bg-[var(--surface-strong)] text-foreground',
  step: 'bg-[var(--surface-strong)] text-muted-foreground',
  condition: 'bg-[var(--status-warning-subtle)] text-[var(--status-warning)]',
  checks: 'bg-[var(--status-success-subtle)] text-[var(--status-success)]',
  output: 'bg-[var(--surface-strong)] text-foreground',
  stop: 'bg-[var(--status-danger-subtle)] text-[var(--status-danger)]',
};

/** One flow card: the kind chip, then the definition's own line as
 *  the summary, then the rest of that block as detail. A conditional
 *  step leans diamond — dashed warning border and the diamond glyph —
 *  so it reads apart from the steps it hangs off. */
function FlowCard({ data }: NodeProps<Node<{ node: FlowNode }>>) {
  const { t } = useI18n();
  const node = data.node;
  const title = node.title
    || (node.triggerKind === 'webhook' ? t('Posted from outside') : t('Started by a person'));
  return (
    <div
      className={cn(
        'rounded-lg border bg-[var(--surface-rail)] px-3 py-2 shadow-[var(--shadow-island)]',
        node.kind === 'condition'
          ? 'border-dashed border-[var(--status-warning)]'
          : 'border-border/60',
      )}
      style={{ width: FLOW_NODE_WIDTH }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} isConnectable={false} />
      <div className="flex items-center gap-1.5">
        <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', KIND_CHIP[node.kind])}>
          {node.kind === 'condition' ? <Diamond size={9} /> : null}
          {t(KIND_LABEL[node.kind])}
        </span>
        {node.badge ? (
          <span className="ml-auto truncate text-[11px] text-muted-foreground">{node.badge}</span>
        ) : null}
      </div>
      <p className="mt-1.5 line-clamp-2 text-[12px] font-medium leading-snug text-foreground" title={title}>
        {title}
      </p>
      {node.detail ? (
        <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-[11px] leading-snug text-muted-foreground" title={node.detail}>
          {node.detail}
        </p>
      ) : null}
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} isConnectable={false} />
    </div>
  );
}

const NODE_TYPES = { definition: FlowCard };

/** xyflow's own chrome restated in the app's tokens, so the controls
 *  sit in the same dark surface as everything else. */
const CHROME_VARS = {
  '--xy-controls-button-background-color': 'var(--surface-strong)',
  '--xy-controls-button-background-color-hover': 'var(--surface-strong)',
  '--xy-controls-button-color': 'var(--text-primary)',
  '--xy-controls-button-color-hover': 'var(--text-primary)',
  '--xy-controls-button-border-color': 'var(--border-default)',
  '--xy-controls-box-shadow': 'var(--shadow-island)',
} as CSSProperties;

/** The read-only flow of one definition body, under the row it runs
 *  under (`context`: its trigger and its Object). Same body and same
 *  row always draw the same graph. */
export function DefinitionFlow({ body, context, heightClassName = 'h-[340px]' }: {
  body: string;
  context: FlowContext;
  heightClassName?: string;
}) {
  const { t } = useI18n();
  const contextKey = JSON.stringify(context);
  const projection = useMemo(
    () => projectDefinitionFlow(parseDefinition(body), JSON.parse(contextKey) as FlowContext),
    [body, contextKey],
  );
  const nodes = useMemo<Node<{ node: FlowNode }>[]>(
    () => projection.nodes.map((node) => ({
      id: node.id,
      type: 'definition',
      position: node.position,
      data: { node },
      draggable: false,
      connectable: false,
      selectable: false,
    })),
    [projection],
  );
  const edges = useMemo<Edge[]>(
    () => projection.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'smoothstep',
      style: edge.kind === 'branch'
        ? { stroke: 'var(--status-warning)', strokeDasharray: '5 4' }
        : { stroke: 'var(--border-strong)' },
    })),
    [projection],
  );
  const hasSteps = projection.nodes.some((n) => n.kind === 'step' || n.kind === 'condition');

  if (projection.empty) {
    return (
      <p className="rounded-lg border border-border/60 bg-[var(--surface-rail)] px-3 py-4 text-[12px] text-muted-foreground">
        {t('No flow to draw — this definition has no procedure written yet.')}
      </p>
    );
  }
  return (
    <div>
      <div
        className={cn('relative w-full overflow-hidden rounded-lg border border-border/60 bg-[var(--surface-rail)]', heightClassName)}
        style={CHROME_VARS}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          defaultViewport={{ x: 16, y: 16, zoom: 0.9 }}
          minZoom={0.35}
          maxZoom={1.4}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnDrag
          zoomOnPinch
          zoomOnScroll={false}
          zoomOnDoubleClick={false}
        >
          <Controls showInteractive={false} showZoom showFitView fitViewOptions={{ maxZoom: 1 }} />
          {projection.connectors.length > 0 || projection.assignment ? (
            <Panel position="top-right" style={{ pointerEvents: 'none' }}>
              <div className="flex max-w-[240px] flex-col items-end gap-1">
                {projection.connectors.length > 0 ? (
                  <span className="rounded-full bg-[var(--surface-strong)] px-2 py-0.5 text-[11px] text-muted-foreground">
                    {t('Connectors')}: {projection.connectors.join(', ')}
                  </span>
                ) : null}
                {projection.assignment ? (
                  <span className="rounded-full bg-[var(--surface-strong)] px-2 py-0.5 text-[11px] text-muted-foreground" title={projection.assignment}>
                    {t('How work is assigned')}: {projection.assignment}
                  </span>
                ) : null}
              </div>
            </Panel>
          ) : null}
        </ReactFlow>
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
        {t('Dashed lines are conditions written in the definition text — declared intent, not fixed routes. The engine reads the text; it does not follow the drawing.')}
      </p>
      {!hasSteps ? (
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
          {t('No flow to draw — this definition has no procedure written yet.')}
        </p>
      ) : null}
    </div>
  );
}
