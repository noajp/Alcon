'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  addEdge, Background, BackgroundVariant, Controls, Handle, Panel, Position, ReactFlow, ReactFlowProvider,
  useEdgesState, useNodesState,
  type Connection, type Edge, type Node, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { useI18n } from '@/Function/i18n/I18nProvider';
import { cn } from '@/lib/utils';
import { Diamond, Plus, Zap } from '@/ui/icons';
import {
  WORKFLOW_COLUMN, WORKFLOW_ROW, WORKFLOW_START, type WorkflowEdge, type WorkflowGraph, type WorkflowNode, type WorkflowNodeKind,
} from '@/Function/shared/workflowGraph';

// An automation's workflow, drawn by hand: steps and decisions placed on a
// canvas, dragged where they belong, joined by dragging from one card's
// bottom to another's top. Double-click a card to rename it; select a card
// or an arrow and press Delete to remove it; select an arrow out of a
// decision to say when it is taken. Every change is handed to `onChange`
// as the whole drawing, from which the owner writes the text the run reads.

const NODE_WIDTH = 240;
const SAVE_DELAY_MS = 500;

type CardData = { kind: WorkflowNodeKind | 'start'; label: string };
type CardNode = Node<CardData>;

/** Renames a card in place; the canvas hands it to each card. */
const RenameContext = createContext<(id: string, label: string) => void>(() => {});

const CHROME_VARS = {
  '--xy-controls-button-background-color': 'var(--surface-strong)',
  '--xy-controls-button-background-color-hover': 'var(--surface-strong)',
  '--xy-controls-button-color': 'var(--text-primary)',
  '--xy-controls-button-color-hover': 'var(--text-primary)',
  '--xy-controls-button-border-color': 'var(--border-default)',
  '--xy-controls-box-shadow': 'var(--shadow-island)',
  '--xy-edge-stroke-selected-default': 'var(--text-primary)',
} as CSSProperties;

function Card({ id, data, selected }: NodeProps<CardNode>) {
  const { t } = useI18n();
  const rename = useContext(RenameContext);
  const [draft, setDraft] = useState<string | null>(null);
  const start = data.kind === 'start';
  const condition = data.kind === 'condition';
  const commit = () => {
    if (draft !== null) rename(id, draft.trim());
    setDraft(null);
  };
  return (
    // The Board's card: the title as the headline, what kind of card it is
    // in a chip under it.
    <div
      onDoubleClick={() => { if (!start) setDraft(data.label); }}
      className={cn(
        'rounded-lg border bg-card shadow-[var(--shadow-island)] transition-colors dark:bg-[var(--surface-rail)]',
        condition ? 'border-dashed border-[var(--status-warning)]' : 'border-border',
        selected && 'ring-1 ring-[var(--text-primary)]',
      )}
      style={{ width: NODE_WIDTH }}
    >
      {!start && <Handle type="target" position={Position.Left} className="!size-2 !border-0 !bg-muted-foreground" />}
      <div className="px-3.5 py-3.5">
        {draft !== null ? (
          <input
            className="nodrag w-full rounded border border-[var(--border-strong)] bg-[var(--surface-strong)] px-1.5 text-[14px] font-medium leading-[22px] text-foreground outline-none"
            value={draft} autoFocus aria-label={t('Rename')}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) commit();
              if (e.key === 'Escape') setDraft(null);
            }}
          />
        ) : (
          <p className={cn('line-clamp-2 text-[14px] font-medium leading-[22px]', data.label ? 'text-foreground' : 'text-muted-foreground')}>
            {data.label || t('Double-click to name it')}
          </p>
        )}
        <div className="mt-2 flex items-center gap-1.5">
          <span className={cn('inline-flex h-5 items-center gap-1 rounded-md border px-1.5 text-[11px] font-medium leading-none',
            condition ? 'border-transparent bg-[var(--status-warning-subtle)] text-[var(--status-warning)]'
              : 'border-border/60 bg-muted/40 text-muted-foreground')}>
            {start ? <Zap size={10} /> : condition ? <Diamond size={9} /> : null}
            {start ? t('Start') : condition ? t('Decision') : t('Step')}
          </span>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!size-2 !border-0 !bg-muted-foreground" />
    </div>
  );
}

const NODE_TYPES = { card: Card };

function toNodes(g: WorkflowGraph, trigger: string): CardNode[] {
  return [
    { id: WORKFLOW_START, type: 'card', position: { x: 0, y: 0 }, data: { kind: 'start', label: trigger }, deletable: false, draggable: false },
    ...g.nodes.map((n): CardNode => ({ id: n.id, type: 'card', position: { x: n.x, y: n.y }, data: { kind: n.kind, label: n.label } })),
  ];
}

function edgeStyle(e: WorkflowEdge, fromCondition: boolean): Partial<Edge> {
  return {
    type: 'smoothstep',
    label: e.label,
    labelStyle: { fill: 'var(--text-primary)', fontSize: 11 },
    labelBgStyle: { fill: 'var(--surface-strong)' },
    style: fromCondition ? { stroke: 'var(--status-warning)', strokeDasharray: '5 4' } : { stroke: 'var(--border-strong)' },
  };
}

function toEdges(g: WorkflowGraph): Edge[] {
  const conditions = new Set(g.nodes.filter((n) => n.kind === 'condition').map((n) => n.id));
  return g.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, ...edgeStyle(e, conditions.has(e.source)) }));
}

function toGraph(nodes: CardNode[], edges: Edge[]): WorkflowGraph {
  return {
    nodes: nodes.filter((n) => n.id !== WORKFLOW_START).map((n): WorkflowNode => ({
      id: n.id, kind: n.data.kind === 'condition' ? 'condition' : 'step', label: n.data.label,
      x: Math.round(n.position.x), y: Math.round(n.position.y),
    })),
    edges: edges.map((e): WorkflowEdge => ({
      id: e.id, source: e.source, target: e.target,
      ...(typeof e.label === 'string' && e.label.trim() ? { label: e.label.trim() } : {}),
    })),
  };
}

const newId = (prefix: string) => `${prefix}${Math.random().toString(36).slice(2, 9)}`;

function Canvas({ graph, trigger, onChange, readOnly, className }: { graph: WorkflowGraph; trigger: string; onChange: (g: WorkflowGraph) => void; readOnly?: boolean; className?: string }) {
  const { t } = useI18n();
  const [nodes, setNodes, onNodesChange] = useNodesState<CardNode>(toNodes(graph, trigger));
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(toEdges(graph));
  const saved = useRef(JSON.stringify(graph));

  // The start card names the trigger as it now reads.
  useEffect(() => {
    setNodes((ns) => ns.map((n) => (n.id === WORKFLOW_START ? { ...n, data: { ...n.data, label: trigger } } : n)));
  }, [trigger, setNodes]);

  // Hand the drawing over once it settles: not mid-drag, and only when it
  // changed (a selection is not a change).
  const dragging = nodes.some((n) => n.dragging);
  useEffect(() => {
    if (readOnly || dragging) return;
    const g = toGraph(nodes, edges);
    const key = JSON.stringify(g);
    if (key === saved.current) return;
    const timer = setTimeout(() => { saved.current = key; onChange(g); }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [nodes, edges, dragging, readOnly, onChange]);

  // A decision's arrows are drawn apart, so re-style when a card's kind or
  // the arrows change.
  const conditionIds = useMemo(() => new Set(nodes.filter((n) => n.data.kind === 'condition').map((n) => n.id)), [nodes]);
  const styledEdges = useMemo(
    () => edges.map((e) => ({ ...e, ...edgeStyle({ id: e.id, source: e.source, target: e.target, label: typeof e.label === 'string' ? e.label : undefined }, conditionIds.has(e.source)), selected: e.selected })),
    [edges, conditionIds],
  );

  const rename = useCallback((id: string, label: string) => {
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, label } } : n)));
  }, [setNodes]);

  const onConnect = useCallback((c: Connection) => {
    if (c.source === c.target || c.target === WORKFLOW_START) return;
    setEdges((es) => (es.some((e) => e.source === c.source && e.target === c.target) ? es : addEdge({ ...c, id: newId('e') }, es)));
  }, [setEdges]);

  /** A new card to the right of the selected one (joined to it; under its
   *  other branches), or after the rightmost. */
  const add = (kind: WorkflowNodeKind) => {
    const from = nodes.find((n) => n.selected) ?? [...nodes].sort((a, b) => b.position.x - a.position.x)[0];
    const siblings = from ? edges.filter((e) => e.source === from.id).length : 0;
    const id = newId('n');
    const position = from
      ? { x: from.position.x + WORKFLOW_COLUMN, y: from.position.y + siblings * WORKFLOW_ROW }
      : { x: WORKFLOW_COLUMN, y: 0 };
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), { id, type: 'card', position, data: { kind, label: '' }, selected: true }]);
    if (from) setEdges((es) => addEdge({ id: newId('e'), source: from.id, target: id }, es));
  };

  const selectedEdge = edges.find((e) => e.selected) ?? null;
  const selectedFromCondition = selectedEdge ? conditionIds.has(selectedEdge.source) : false;

  return (
    <RenameContext.Provider value={rename}>
      <div className={cn('relative w-full overflow-hidden rounded-lg border border-border/60 bg-[var(--surface-rail)]', className ?? 'h-[360px]')} style={CHROME_VARS}>
        <ReactFlow
          nodes={nodes}
          edges={styledEdges}
          nodeTypes={NODE_TYPES}
          onNodesChange={readOnly ? undefined : onNodesChange}
          onEdgesChange={readOnly ? undefined : onEdgesChange}
          onConnect={readOnly ? undefined : onConnect}
          nodesDraggable={!readOnly}
          nodesConnectable={!readOnly}
          deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
          defaultViewport={{ x: 32, y: 64, zoom: 0.9 }}
          minZoom={0.3}
          maxZoom={1.5}
          zoomOnScroll={false}
          panOnScroll
          zoomOnDoubleClick={false}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="var(--border-default)" />
          <Controls showInteractive={false} fitViewOptions={{ maxZoom: 1 }} />
          {!readOnly && (
            <Panel position="top-right" className="flex items-center gap-1">
              <button type="button" onClick={() => add('step')}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-default)] bg-[var(--surface-strong)] px-2 text-[12px] text-foreground hover:bg-muted/60">
                <Plus size={12} />{t('Step')}
              </button>
              <button type="button" onClick={() => add('condition')}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-default)] bg-[var(--surface-strong)] px-2 text-[12px] text-foreground hover:bg-muted/60">
                <Diamond size={10} />{t('Decision')}
              </button>
            </Panel>
          )}
          {!readOnly && selectedEdge && selectedFromCondition && (
            <Panel position="bottom-center">
              <label className="flex items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-[var(--surface-strong)] px-2 py-1 text-[12px] text-muted-foreground">
                {t('When')}
                <input key={selectedEdge.id} defaultValue={typeof selectedEdge.label === 'string' ? selectedEdge.label : ''}
                  placeholder={t('e.g. Yes')} aria-label={t('When this arrow is taken')}
                  className="w-32 bg-transparent text-foreground outline-none"
                  onKeyDown={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    const label = e.target.value;
                    setEdges((es) => es.map((x) => (x.id === selectedEdge.id ? { ...x, label } : x)));
                  }} />
              </label>
            </Panel>
          )}
        </ReactFlow>
      </div>
      {!readOnly && (
        <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
          {t('Drag from a card’s right dot to another card to join them. Double-click a card to name it; select a card or arrow and press Delete to remove it.')}
        </p>
      )}
    </RenameContext.Provider>
  );
}

/** The workflow canvas. `graph` is read when it mounts; remount it (a new
 *  `key`) to show a different drawing. */
export function WorkflowCanvas(props: { graph: WorkflowGraph; trigger: string; onChange: (g: WorkflowGraph) => void; readOnly?: boolean; className?: string }) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
