'use client';

import { useState, useMemo } from 'react';
import { Circle, Clock, CheckCircle2, XCircle, Ban, Send, ChevronDown } from 'lucide-react';
import type { ExplorerData, AlconObjectWithChildren, ElementWithDetails } from '@/hooks/useSupabase';
import { updateElement } from '@/hooks/useSupabase';
import { ObjectIcon } from '@/shell/icons';
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

// Walk the Object tree and emit one group per Object that has direct elements.
// Depth is preserved so child Object headers can be indented.
function collectObjectGroups(objects: AlconObjectWithChildren[], depth = 0): ObjectGroup[] {
  const out: ObjectGroup[] = [];
  for (const obj of objects) {
    if (obj.elements && obj.elements.length > 0) {
      out.push({ object: obj, elements: obj.elements, depth });
    }
    if (obj.children && obj.children.length > 0) {
      out.push(...collectObjectGroups(obj.children, depth + 1));
    }
  }
  return out;
}

interface ElementsByObjectViewProps {
  explorerData?: ExplorerData;
  onRefresh?: () => void;
}

/**
 * Domain-wide Elements view: every Object that owns Elements appears as a
 * header band, with that Object's Elements listed underneath. Root-level
 * "Personal" Elements (no object_id) get their own band at the top.
 */
export function ElementsByObjectView({ explorerData, onRefresh }: ElementsByObjectViewProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);

  const groups = useMemo<ObjectGroup[]>(() => {
    if (!explorerData) return [];
    return collectObjectGroups(explorerData.objects);
  }, [explorerData]);

  const personalElements = explorerData?.rootElements ?? [];

  const allElementsForLookup = useMemo(() => {
    const m = new Map<string, ElementWithDetails>();
    for (const g of groups) for (const el of g.elements) m.set(el.id, el);
    for (const el of personalElements) m.set(el.id, el);
    return m;
  }, [groups, personalElements]);

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

  const isEmpty = groups.length === 0 && personalElements.length === 0;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-auto">
        {isEmpty ? (
          <div className="flex-1 flex flex-col items-center justify-center py-20 text-muted-foreground">
            <p className="text-sm">No elements yet</p>
            <p className="text-[12px] mt-1 text-muted-foreground/60">
              Elements appear here grouped by their parent Object.
            </p>
          </div>
        ) : (
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

            {/* Personal (root) elements */}
            {personalElements.length > 0 && (
              <ObjectBand
                label="Personal"
                count={personalElements.length}
                depth={0}
                isCollapsed={collapsed.has('__personal__')}
                onToggle={() => toggle('__personal__')}
              >
                {personalElements.map((el) => (
                  <ElementRow
                    key={el.id}
                    element={el}
                    onStatusChange={handleStatusChange}
                    onClick={() => setDetailId(el.id)}
                  />
                ))}
              </ObjectBand>
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
        )}
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
