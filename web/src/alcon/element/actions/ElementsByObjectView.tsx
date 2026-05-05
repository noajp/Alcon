'use client';

import { useState, useMemo } from 'react';
import { Circle, Clock, CheckCircle2, XCircle, Ban, Send, ChevronDown, Plus } from 'lucide-react';
import type { ExplorerData, AlconObjectWithChildren, ElementWithDetails } from '@/hooks/useSupabase';
import { updateElement, createElement } from '@/hooks/useSupabase';
import { ObjectIcon } from '@/shell/icons';
import { NavMyTasksIcon } from '@/shell/sidebar/NavIcons';
import { ElementDetailView } from '@/alcon/element/ElementDetailView';

const STATUS_CONFIG: Record<string, { label: string; icon: typeof Circle; color: string }> = {
  backlog:     { label: 'Backlog',     icon: Circle,       color: 'text-neutral-400' },
  todo:        { label: 'To Do',       icon: Circle,       color: 'text-neutral-500' },
  in_progress: { label: 'In Progress', icon: Clock,        color: 'text-amber-600' },
  review:      { label: 'In Review',   icon: Send,         color: 'text-blue-600' },
  done:        { label: 'Done',        icon: CheckCircle2, color: 'text-emerald-600' },
  blocked:     { label: 'Blocked',     icon: XCircle,      color: 'text-red-600' },
  cancelled:   { label: 'Cancelled',   icon: Ban,          color: 'text-neutral-400' },
};

const PRIORITY_CONFIG: Record<string, { label: string; badgeBg: string }> = {
  urgent: { label: 'Urgent', badgeBg: 'bg-red-50 text-red-700' },
  high:   { label: 'High',   badgeBg: 'bg-amber-50 text-amber-700' },
  medium: { label: 'Medium', badgeBg: 'bg-neutral-100 text-neutral-600' },
  low:    { label: 'Low',    badgeBg: 'bg-neutral-100 text-neutral-400' },
};

interface ObjectGroup {
  object: AlconObjectWithChildren;
  elements: ElementWithDetails[];
  depth: number;
}

// One group per Object that has direct elements. Hierarchy is flat
// (Domain > Object > Element), so depth is always 0.
function collectObjectGroups(objects: AlconObjectWithChildren[]): ObjectGroup[] {
  return objects
    .filter(o => o.elements && o.elements.length > 0)
    .map(o => ({ object: o, elements: o.elements!, depth: 0 }));
}

interface ElementsByObjectViewProps {
  explorerData?: ExplorerData;
  onRefresh?: () => void;
}

/**
 * Domain-wide Elements view. Every Object that owns Elements appears as a
 * header band; that Object's Elements are listed underneath. Domain-direct
 * Elements (no parent Object — created with the toolbar's `+` here, never
 * from inside an Object) get their own "Domain" band at the top.
 */
export function ElementsByObjectView({ explorerData, onRefresh }: ElementsByObjectViewProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);

  const groups = useMemo<ObjectGroup[]>(() => {
    if (!explorerData) return [];
    return collectObjectGroups(explorerData.objects);
  }, [explorerData]);

  const domainElements = explorerData?.rootElements ?? [];

  const allElementsForLookup = useMemo(() => {
    const m = new Map<string, ElementWithDetails>();
    for (const g of groups) for (const el of g.elements) m.set(el.id, el);
    for (const el of domainElements) m.set(el.id, el);
    return m;
  }, [groups, domainElements]);

  const detailElement = detailId ? allElementsForLookup.get(detailId) ?? null : null;

  if (detailElement) {
    return (
      <ElementDetailView
        element={detailElement}
        onBack={() => setDetailId(null)}
        onRefresh={onRefresh}
      />
    );
  }

  const toggle = (key: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const handleStatusChange = async (id: string, status: string) => {
    try {
      await updateElement(id, { status: status as 'todo' });
      onRefresh?.();
    } catch (e) { console.error(e); }
  };

  // Sidebar Elements view always creates Domain-direct Elements (no Object).
  // Element creation under a specific Object happens from that Object's screen.
  const handleAddDomainElement = async () => {
    try {
      await createElement({ title: 'New Element', object_id: null });
      onRefresh?.();
    } catch (e) { console.error('Failed to create Element', e); }
  };

  const isEmpty = groups.length === 0 && domainElements.length === 0;

  if (isEmpty) {
    // Empty state owns the pane — same 4-icon + heading + CTA pattern as the
    // Domain Objects / Object Elements empty states. Toolbar is suppressed so
    // the centered Create Element button is the only affordance.
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <ElementsDomainEmptyState onAdd={handleAddDomainElement} />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar — adds a Domain-direct Element */}
      <div className="flex items-center justify-end px-6 py-2 border-b border-border bg-card flex-shrink-0">
        <button
          type="button"
          onClick={handleAddDomainElement}
          className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground hover:text-foreground border border-border/60 hover:bg-muted px-2.5 py-1 rounded-md transition-colors"
          title="Create a Domain-direct Element"
        >
          <Plus size={12} />
          Add Element
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        <div>
          {/* Column header */}
            <div className="flex items-center px-6 py-2 border-b border-border text-[11px] font-medium text-muted-foreground uppercase tracking-wider sticky top-0 z-10 bg-card">
              <div className="w-8" />
              <div className="w-20">ID</div>
              <div className="flex-1">Name</div>
              <div className="w-24 text-center">Priority</div>
              <div className="w-32">Due date</div>
              <div className="w-20 text-right">Assignee</div>
            </div>

            {/* Domain-direct Elements (no parent Object) */}
            {domainElements.length > 0 && (
              <DomainBand
                count={domainElements.length}
                isCollapsed={collapsed.has('__domain__')}
                onToggle={() => toggle('__domain__')}
              >
                {domainElements.map((el) => (
                  <ElementRow
                    key={el.id}
                    element={el}
                    onStatusChange={handleStatusChange}
                    onClick={() => setDetailId(el.id)}
                  />
                ))}
              </DomainBand>
            )}

            {groups.map((g) => (
              <ObjectBand
                key={g.object.id}
                label={g.object.name}
                count={g.elements.length}
                depth={g.depth}
                isCollapsed={collapsed.has(g.object.id)}
                onToggle={() => toggle(g.object.id)}
              >
                {g.elements.map((el) => (
                  <ElementRow
                    key={el.id}
                    element={el}
                    onStatusChange={handleStatusChange}
                    onClick={() => setDetailId(el.id)}
                  />
                ))}
              </ObjectBand>
          ))}
        </div>
      </div>
    </div>
  );
}

function ObjectBand({
  label,
  count,
  depth,
  isCollapsed,
  onToggle,
  children,
}: {
  label: string;
  count: number;
  depth: number;
  isCollapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-6 py-2 bg-muted/40 border-y border-border hover:bg-muted/60 transition-colors text-left"
        style={{ paddingLeft: 24 + depth * 16 }}
      >
        <ChevronDown
          size={14}
          className={`text-muted-foreground transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
        />
        <span className="text-foreground/70"><ObjectIcon size={13} /></span>
        <span className="text-[13px] font-semibold text-foreground truncate">{label}</span>
        <span className="text-[12px] text-muted-foreground tabular-nums">{count}</span>
      </button>
      {!isCollapsed && children}
    </div>
  );
}

function DomainBand({
  count,
  isCollapsed,
  onToggle,
  children,
}: {
  count: number;
  isCollapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-6 py-2 bg-muted/40 border-y border-border hover:bg-muted/60 transition-colors text-left"
      >
        <ChevronDown
          size={14}
          className={`text-muted-foreground transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
        />
        <span className="text-[13px] font-semibold text-foreground truncate">Domain</span>
        <span className="text-[12px] text-muted-foreground tabular-nums">{count}</span>
        <span className="text-[10px] text-muted-foreground/60 ml-1">no parent Object</span>
      </button>
      {!isCollapsed && children}
    </div>
  );
}

function ElementRow({
  element,
  onStatusChange,
  onClick,
}: {
  element: ElementWithDetails;
  onStatusChange: (id: string, status: string) => void;
  onClick: () => void;
}) {
  const statusConf = STATUS_CONFIG[element.status || 'todo'] || STATUS_CONFIG.todo;
  const priorityConf = PRIORITY_CONFIG[element.priority || 'medium'] || PRIORITY_CONFIG.medium;
  const StatusIcon = statusConf.icon;
  const isOverdue = element.due_date && new Date(element.due_date) < new Date() && element.status !== 'done';
  const shortId = element.display_id || element.id.substring(0, 6).toUpperCase();
  const isDone = element.status === 'done';

  return (
    <div
      className={`flex items-center px-6 py-2.5 border-b border-border hover:bg-muted/20 transition-colors group cursor-pointer ${isDone ? 'opacity-60' : ''}`}
      onClick={onClick}
    >
      <div className="w-8 flex-shrink-0">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onStatusChange(element.id, isDone ? 'todo' : 'done');
          }}
        >
          <StatusIcon size={16} className={statusConf.color} />
        </button>
      </div>
      <div className="w-20 flex-shrink-0">
        <span className="text-[12px] text-muted-foreground font-mono">{shortId}</span>
      </div>
      <div className="flex-1 min-w-0 mr-3">
        <span className={`text-[13px] truncate block ${isDone ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
          {element.title}
        </span>
      </div>
      <div className="w-24 flex-shrink-0 text-center">
        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${priorityConf.badgeBg}`}>
          {priorityConf.label}
        </span>
      </div>
      <div className="w-32 flex-shrink-0">
        {element.due_date ? (
          <span className={`text-[12px] ${isOverdue ? 'text-red-600 font-medium' : 'text-muted-foreground'}`}>
            {new Date(element.due_date).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
        ) : (
          <span className="text-[12px] text-muted-foreground/40">Add date</span>
        )}
      </div>
      <div className="w-20 flex justify-end flex-shrink-0">
        <div className="flex -space-x-1.5">
          {element.assignees?.slice(0, 3).map((a) => (
            <div
              key={a.id}
              className="w-6 h-6 rounded-full bg-muted border-2 border-card flex items-center justify-center text-[9px] font-medium text-muted-foreground"
              title={a.worker?.name}
            >
              {a.worker?.name?.charAt(0) || '?'}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ElementsDomainEmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center py-20 px-6 select-none">
      <div className="grid grid-cols-2 gap-3 mb-6">
        {[0.18, 0.35, 0.55, 1].map((opacity, i) => (
          <div
            key={i}
            className="w-14 h-14 rounded-xl border-2 border-muted-foreground flex items-center justify-center"
            style={{ opacity, borderStyle: i === 0 ? 'dashed' : 'solid' }}
          >
            <NavMyTasksIcon size={22} />
          </div>
        ))}
      </div>
      <h2 className="text-[15px] font-semibold text-foreground mb-1.5">Add Elements to this Domain</h2>
      <p className="text-[13px] text-muted-foreground text-center max-w-xs mb-2">
        Elements are the smallest unit you track — anything actionable or worth recording.
      </p>
      <p className="text-[12px] text-muted-foreground/60 text-center max-w-xs mb-6">
        Domain-direct Elements live at the top level. Open an Object to add Elements there.
      </p>
      <button
        onClick={onAdd}
        className="flex items-center gap-2 px-4 py-2 rounded-full bg-foreground text-background text-[13px] font-medium hover:bg-foreground/90 transition-colors"
      >
        <Plus size={14} />
        Create Element
      </button>
    </div>
  );
}
