'use client';

import React, { useState, useEffect, useMemo } from 'react';
import type { NavigationState } from './AppSidebar';
import type { AlconObjectWithChildren, ElementWithDetails, ExplorerData, CustomColumnWithValues, CustomColumnType, Worker } from '@/hooks/useSupabase';
import {
  createElement,
  createObject,
  addElementToObject,
  updateElement,
  deleteElement,
  addElementAssignee,
  fetchAllWorkers,
  groupElementsBySection,
  fetchCustomColumnsWithValues,
  createCustomColumn,
  updateCustomColumn,
  deleteCustomColumn,
  setCustomColumnValue,
  useObjectTabs,
  createObjectTab,
  updateObjectTab,
  deleteObjectTab,
  reorderElements,
  moveObject,
} from '@/hooks/useSupabase';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

type SortableListeners = ReturnType<typeof useSortable>['listeners'];
import type { ObjectTabType } from '@/types/database';
import type { Json } from '@/types/database';

// Layout components
import { TabBar } from './TabBar';

// Views
import { NotesView, ActionsView } from '@/components/views';
import { MyTasksView } from '@/components/views/MyTasksView';
import { HomeView } from '@/components/home';
import {
  PageView,
  NotesSidebar,
  BriefsEmptyState,
  BriefsListView,
  BriefDialog,
  BriefViewDialog,
  ObjectDraftDialog,
  type BriefStructured,
} from '@/components/brief';
import type { BriefDraft } from '@/components/brief/BriefDialog';
import { createObject as createObjectRow, createElement as createElementRow } from '@/hooks/useSupabase';
import type { ObjectDraftElement } from '@/components/brief/objectDraft';
import { useNotes, useNoteContent, useBriefs, useDefaultFileId } from '@/hooks/useNotesDb';

// Column components
import {
  AddColumnModal,
  ColumnHeader,
  BuiltInColumnHeader,
  DEFAULT_BUILTIN_COLUMNS,
} from '@/components/columns';
import type { BuiltInColumn } from '@/components/columns';

// Element components
import { ElementTableRow, ElementPropertiesPanel, ElementDetailView, InlineAddRow } from '@/components/elements';

// Other components
import { ObjectIcon } from '@/components/icons';
import { ChevronRight, ChevronDown, ChevronLeft, Check, Plus, ListPlus, FolderPlus, Heading, MessageSquare, Inbox as InboxIcon, Video, Bot, Plug, X, Trash2, Users, Link2, ArrowRight, FileText, Loader2, Sparkles, Filter, ArrowUpDown, MoreHorizontal, Copy, Pencil } from 'lucide-react';
import { NavHubIcon } from './AppSidebar';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel } from '@/components/ui/dropdown-menu';
import { ObjectPicker } from '@/components/objects/ObjectPicker';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ReportPreview } from '@/components/reports/ReportPreview';
import { supabase } from '@/lib/supabase';
import { CalendarView } from '@/components/calendar/CalendarView';
import { SummaryView } from '@/components/summary/SummaryView';
import { OverviewView } from '@/components/overview/OverviewView';
import { GanttView } from '@/components/gantt';

// ============================================
// System Header (top of Object tree panel)
// ============================================
const SystemIconSvg = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2L2 7l10 5 10-5-10-5z" />
    <path d="M2 17l10 5 10-5" />
    <path d="M2 12l10 5 10-5" />
  </svg>
);

const SYSTEMS = [
  { id: 'alcon-dev', name: 'Alcon 開発' },
  { id: 'personal', name: 'Personal' },
];

const ACTIVE_SYSTEM_KEY = 'alcon:active-system';

// Shared hook: active System state synced via localStorage + storage event
function useActiveSystem() {
  const [activeId, setActiveId] = useState(SYSTEMS[0].id);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = localStorage.getItem(ACTIVE_SYSTEM_KEY);
    if (saved && SYSTEMS.some((s) => s.id === saved)) setActiveId(saved);

    const handleStorage = (e: StorageEvent) => {
      if (e.key === ACTIVE_SYSTEM_KEY && e.newValue && SYSTEMS.some((s) => s.id === e.newValue)) {
        setActiveId(e.newValue);
      }
    };
    const handleCustom = (e: Event) => {
      const ce = e as CustomEvent<string>;
      if (ce.detail && SYSTEMS.some((s) => s.id === ce.detail)) setActiveId(ce.detail);
    };
    window.addEventListener('storage', handleStorage);
    window.addEventListener('alcon:active-system-change', handleCustom as EventListener);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('alcon:active-system-change', handleCustom as EventListener);
    };
  }, []);

  const setActive = (id: string) => {
    setActiveId(id);
    if (typeof window !== 'undefined') {
      localStorage.setItem(ACTIVE_SYSTEM_KEY, id);
      window.dispatchEvent(new CustomEvent('alcon:active-system-change', { detail: id }));
    }
  };

  const active = SYSTEMS.find((s) => s.id === activeId) ?? SYSTEMS[0];
  return { active, setActive };
}

function SystemHeader() {
  const [open, setOpen] = useState(false);
  const { active, setActive } = useActiveSystem();
  const ref = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 h-9 rounded-lg border border-border bg-card hover:bg-muted/40 transition-colors"
      >
        <SystemIconSvg size={13} />
        <span className="text-[12px] font-medium text-foreground truncate flex-1 text-left">{active.name}</span>
        <ChevronDown size={12} className={`text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 top-full mt-1 bg-popover border border-border rounded-lg shadow-lg z-50 py-1">
            {SYSTEMS.map(sys => (
              <button
                key={sys.id}
                type="button"
                onClick={() => { setActive(sys.id); setOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-foreground hover:bg-accent transition-colors"
              >
                <SystemIconSvg size={12} />
                <span className="flex-1 text-left truncate">{sys.name}</span>
                {sys.id === active.id && <Check size={12} className="text-foreground shrink-0" />}
              </button>
            ))}
            <div className="border-t border-border mt-1 pt-1">
              <button
                type="button"
                className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                <Plus size={12} />
                <span>New System</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ============================================
// Systems Management View
// ============================================
function SystemsView({
  explorerData,
  onOpen,
}: {
  explorerData: ExplorerData;
  onOpen: (systemId: string) => void;
}) {
  const { active, setActive } = useActiveSystem();
  const [drillInId, setDrillInId] = useState<string | null>(null);

  const drillIn = (systemId: string) => {
    setActive(systemId);
    setDrillInId(systemId);
  };

  // ===== Drill-in: hierarchy + management =====
  if (drillInId) {
    const system = SYSTEMS.find((s) => s.id === drillInId);
    if (!system) return null;
    return (
      <SystemDetailView
        system={system}
        explorerData={explorerData}
        onBack={() => setDrillInId(null)}
        onOpenWorkspace={() => {
          setActive(system.id);
          onOpen(system.id);
        }}
      />
    );
  }

  // ===== List view =====
  return (
    <div className="h-full overflow-y-auto bg-card">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div>
          <h1 className="text-lg font-semibold text-foreground tracking-tight">Systems</h1>
          <p className="text-[13px] text-muted-foreground mt-1">
            Top-level containers for organizations, tenants, or domains. Each System holds Objects and Elements.
          </p>
        </div>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          {SYSTEMS.map((sys) => {
            const isActive = sys.id === active.id;
            return (
              <button
                key={sys.id}
                type="button"
                onClick={() => drillIn(sys.id)}
                className="text-left rounded-2xl bg-white dark:bg-card border border-border/60 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.03)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] hover:border-border transition-all p-5 group"
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center text-muted-foreground shrink-0">
                    <SystemIconSvg size={20} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-[15px] font-medium text-foreground tracking-tight truncate">{sys.name}</h3>
                      {isActive && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          Current
                        </span>
                      )}
                    </div>
                    <p className="text-[12px] text-muted-foreground mt-0.5">
                      Open Object
                    </p>
                  </div>
                  <ChevronRight size={14} className="text-muted-foreground/30 group-hover:text-foreground transition-colors mt-1.5" />
                </div>
              </button>
            );
          })}

          {/* Add new system card */}
          <button
            type="button"
            className="rounded-2xl border border-dashed border-border/60 hover:border-foreground/30 hover:bg-muted/30 transition-colors p-5 flex items-center justify-center text-muted-foreground hover:text-foreground"
          >
            <Plus size={16} className="mr-2" />
            <span className="text-[13px] font-medium">New System</span>
          </button>
        </div>

        <div className="mt-8 text-[12px] text-muted-foreground">
          <p>
            <span className="font-medium">Coming soon:</span> Multi-tenant isolation, member management,
            cross-System views, and per-System permissions.
          </p>
        </div>
      </div>
    </div>
  );
}

// ============================================
// System Detail View (hierarchy + management)
// ============================================
function SystemDetailView({
  system,
  explorerData,
  onBack,
  onOpenWorkspace,
}: {
  system: { id: string; name: string };
  explorerData: ExplorerData;
  onBack: () => void;
  onOpenWorkspace: () => void;
}) {
  const objectCount = collectAllObjects(explorerData).length;
  const elementCount = collectAllElements(explorerData.objects).length;

  return (
    <div className="h-full overflow-y-auto bg-card">
      <div className="max-w-4xl mx-auto px-6 py-6">
        {/* Back navigation */}
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ChevronLeft size={14} />
          <span>Systems</span>
        </button>

        {/* System header */}
        <div className="flex items-start gap-4 mb-8">
          <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center text-muted-foreground shrink-0">
            <SystemIconSvg size={24} />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-semibold text-foreground tracking-tight">{system.name}</h1>
            <p className="text-[12px] text-muted-foreground mt-1">
              {objectCount} objects · {elementCount} elements
            </p>
          </div>
          <button
            onClick={onOpenWorkspace}
            className="shrink-0 px-3 py-1.5 bg-foreground text-background rounded-md text-[12px] font-medium hover:bg-foreground/90 transition-colors"
          >
            Open Object
          </button>
        </div>

        {/* Hierarchy */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              Hierarchy
            </h2>
            <span className="text-[11px] text-muted-foreground/60">
              {explorerData.objects.length} top-level
            </span>
          </div>
          <div className="rounded-xl border border-border/60 bg-card py-2">
            {explorerData.objects.length > 0 ? (
              explorerData.objects.map((obj) => (
                <ObjectTreeItem
                  key={obj.id}
                  object={obj}
                  selectedId={null}
                  onSelect={() => {
                    /* Detail view is read-only preview; use Open workspace to interact */
                  }}
                  depth={0}
                />
              ))
            ) : (
              <div className="px-4 py-6 text-center text-[12px] text-muted-foreground">
                No Objects yet. Open the workspace to create one.
              </div>
            )}
          </div>
        </div>

        {/* Management cards */}
        <div>
          <h2 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Management
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <ManagementCard title="Members" hint="0 members" comingSoon />
            <ManagementCard title="Permissions" hint="Roles & access control" comingSoon />
            <ManagementCard title="Integrations" hint="Slack, GitHub, …" comingSoon />
            <ManagementCard title="Billing & Usage" hint="Plan and limits" comingSoon />
          </div>
        </div>
      </div>
    </div>
  );
}

function ManagementCard({
  title,
  hint,
  comingSoon,
}: {
  title: string;
  hint: string;
  comingSoon?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="text-[13px] font-medium text-foreground">{title}</h3>
          {comingSoon && (
            <span className="text-[10px] text-muted-foreground/70 border border-border/60 rounded-full px-1.5 py-0.5">
              Soon
            </span>
          )}
        </div>
        <p className="text-[12px] text-muted-foreground mt-0.5">{hint}</p>
      </div>
    </div>
  );
}

// ============================================
// My Objects — flat list of Objects the user participates in.
// Hierarchy now lives in the Systems view.
// ============================================
function MyObjectsList({
  explorerData,
  onSelect,
}: {
  explorerData: ExplorerData;
  onSelect: (objectId: string) => void;
}) {
  // For MVP, show top-level Objects. Once ownership/membership exists,
  // filter by user's actual involvement.
  const objects = explorerData.objects;

  // Count elements (including descendants) for each top-level Object
  const countDescendants = (obj: AlconObjectWithChildren): { objects: number; elements: number } => {
    const selfElements = obj.elements?.length ?? 0;
    let objCount = 0;
    let elCount = selfElements;
    if (obj.children?.length) {
      for (const c of obj.children) {
        objCount += 1;
        const sub = countDescendants(c);
        objCount += sub.objects;
        elCount += sub.elements;
      }
    }
    return { objects: objCount, elements: elCount };
  };

  return (
    <div className="h-full overflow-y-auto bg-card">
      <div className="max-w-4xl mx-auto px-6 py-6">
        <div className="mb-5">
          <h1 className="text-lg font-semibold text-foreground tracking-tight">My Objects</h1>
          <p className="text-[13px] text-muted-foreground mt-1">
            Objects you belong to. For the full hierarchy, open the{' '}
            <span className="font-medium text-foreground/80">Systems</span> view.
          </p>
        </div>

        {objects.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 px-6 py-12 text-center">
            <p className="text-[13px] text-muted-foreground">You have no Objects yet.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-border/60 bg-card divide-y divide-border/60 overflow-hidden">
            {objects.map((obj) => {
              const { objects: subCount, elements: elCount } = countDescendants(obj);
              return (
                <button
                  key={obj.id}
                  type="button"
                  onClick={() => onSelect(obj.id)}
                  className="w-full text-left flex items-stretch hover:bg-muted/40 transition-colors group"
                >
                  {/* Name cell */}
                  <div className="flex items-center gap-3 px-4 py-3 flex-1 min-w-0 border-r border-border/40">
                    <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center text-muted-foreground shrink-0">
                      <ObjectIcon size={16} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-[14px] font-medium text-foreground truncate">{obj.name}</h3>
                      {obj.description && (
                        <p className="text-[12px] text-muted-foreground truncate mt-0.5">
                          {obj.description}
                        </p>
                      )}
                    </div>
                  </div>
                  {/* Stats cell */}
                  <div className="hidden sm:flex items-center gap-4 px-4 py-3 text-[11px] text-muted-foreground shrink-0 border-r border-border/40">
                    {subCount > 0 && <span>{subCount} sub</span>}
                    <span className="tabular-nums">{elCount} element{elCount === 1 ? '' : 's'}</span>
                  </div>
                  {/* Expand cell */}
                  <div className="flex items-center justify-center px-3 shrink-0" title="Open Object">
                    <ChevronRight size={14} className="text-muted-foreground/40 group-hover:text-foreground transition-colors" />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// My Objects Sidebar — flat list of top-level Objects (drag-reorderable).
// Children of each Object are rendered indented underneath; only top-level
// Objects can be dragged. Brief-generated Objects appear at the top.
// ============================================
function MyObjectsSidebar({
  objects,
  selectedId,
  onSelect,
  onRefresh,
}: {
  objects: AlconObjectWithChildren[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRefresh?: () => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const newIndex = objects.findIndex((o) => o.id === over.id);
    if (newIndex < 0) return;
    try {
      await moveObject(String(active.id), null, newIndex);
      onRefresh?.();
    } catch (err) {
      console.error('Failed to reorder Object', err);
    }
  };

  return (
    <div className="w-52 flex-shrink-0 flex flex-col overflow-hidden bg-transparent">
      {/* System switcher (rounded pill) */}
      <div className="px-3 pt-3 pb-2 flex-shrink-0">
        <SystemHeader />
      </div>

      {/* Flat sortable list */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden pb-2">
        {objects.length === 0 && (
          <div className="px-3 py-4 text-[11px] text-muted-foreground/60 text-center">
            No Objects yet
          </div>
        )}

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={objects.map((o) => o.id)} strategy={verticalListSortingStrategy}>
            {objects.map((obj) => (
              <SortableObjectRow
                key={obj.id}
                object={obj}
                selectedId={selectedId}
                onSelect={onSelect}
              />
            ))}
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
}

function SortableObjectRow({
  object,
  selectedId,
  onSelect,
}: {
  object: AlconObjectWithChildren;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: object.id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <ObjectTreeRow
        object={object}
        selectedId={selectedId}
        onSelect={onSelect}
        depth={0}
        boldRoot
        dragAttributes={attributes}
        dragListeners={listeners}
      />
    </div>
  );
}

// Recursive tree row with chevron expand/collapse. Drag handle is only
// applied at depth 0 (top-level Objects); nested children are not draggable.
function ObjectTreeRow({
  object,
  selectedId,
  onSelect,
  depth,
  boldRoot,
  dragAttributes,
  dragListeners,
}: {
  object: AlconObjectWithChildren;
  selectedId: string | null;
  onSelect: (id: string) => void;
  depth: number;
  boldRoot?: boolean;
  dragAttributes?: React.HTMLAttributes<HTMLElement>;
  dragListeners?: SortableListeners;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = !!object.children?.length;
  const isSelected = object.id === selectedId;
  const indent = 8 + depth * 12;

  return (
    <div>
      <div
        className={`group w-full flex items-center h-[26px] mx-1 rounded-md transition-colors ${
          isSelected ? 'bg-accent text-foreground' : 'text-foreground hover:bg-muted/40'
        }`}
        style={{ paddingLeft: `${indent}px`, paddingRight: '8px' }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            className="w-4 h-4 flex items-center justify-center flex-shrink-0 text-muted-foreground hover:text-foreground"
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className={`transition-transform ${expanded ? 'rotate-90' : ''}`}
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        ) : (
          <div className="w-4 h-4 flex-shrink-0" />
        )}
        <button
          type="button"
          onClick={() => onSelect(object.id)}
          {...(dragAttributes || {})}
          {...(dragListeners || {})}
          className="flex-1 min-w-0 flex items-center gap-2 text-left cursor-pointer"
          title={object.name}
        >
          <div className="w-4 h-4 flex items-center justify-center flex-shrink-0 text-muted-foreground">
            <ObjectIcon size={13} />
          </div>
          <span
            className={`text-[13px] truncate ${
              boldRoot && depth === 0 && hasChildren ? 'font-semibold' : ''
            }`}
          >
            {object.name}
          </span>
        </button>
      </div>

      {hasChildren && expanded && (
        <div>
          {object.children!.map((child) => (
            <ObjectTreeRow
              key={child.id}
              object={child}
              selectedId={selectedId}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================
// Hub — 外部入力 (Chat / Inbox / Meetings / AI) を Brief/Element に変換する集約点
// ============================================
type HubLeaf = {
  id: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ size?: number }>;
  soon?: boolean;
};

type HubGroup = {
  id: string;
  label: string;
  items: HubLeaf[];
};

const HUB_TREE: HubGroup[] = [
  {
    id: 'communication',
    label: 'Communication',
    items: [
      { id: 'chat', label: 'Chat', description: 'チーム会話 → Brief 化', icon: MessageSquare, soon: true },
      { id: 'meetings', label: 'Meetings', description: '会議ノート → Element 抽出', icon: Video, soon: true },
      { id: 'inbox', label: 'Inbox', description: 'メール / 外部受信をまとめる', icon: InboxIcon, soon: true },
    ],
  },
  {
    id: 'intelligence',
    label: 'Intelligence',
    items: [
      { id: 'ai-assistant', label: 'AI Assistant', description: 'AI と対話して整理', icon: Bot, soon: true },
      { id: 'integrations', label: 'Integrations', description: 'Slack / GitHub など外部連携', icon: Plug, soon: true },
    ],
  },
];

function findHubLeaf(id: string | null): HubLeaf | null {
  if (!id) return null;
  for (const group of HUB_TREE) {
    for (const leaf of group.items) if (leaf.id === id) return leaf;
  }
  return null;
}

function HubSidebar({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const total = HUB_TREE.reduce((n, g) => n + g.items.length, 0);
  return (
    <div className="w-52 flex-shrink-0 flex flex-col overflow-hidden bg-transparent">
      {/* Header */}
      <div className="h-10 flex items-center justify-between px-3 flex-shrink-0">
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
          Hub
        </span>
        <span className="text-[10px] text-muted-foreground/60 tabular-nums">
          {total}
        </span>
      </div>

      {/* Grouped tree */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-2">
        {HUB_TREE.map((group) => (
          <div key={group.id} className="mb-3">
            {/* Group header (bold, non-selectable) */}
            <div className="w-full flex items-center gap-2 h-[26px] px-2 mx-1 text-foreground">
              <div className="w-4 h-4 flex items-center justify-center flex-shrink-0 text-muted-foreground">
                <NavHubIcon size={13} />
              </div>
              <span className="text-[13px] font-semibold truncate">{group.label}</span>
            </div>

            {/* Leaves */}
            {group.items.map((leaf) => {
              const Icon = leaf.icon;
              const isSelected = leaf.id === selectedId;
              return (
                <button
                  key={leaf.id}
                  type="button"
                  onClick={() => onSelect(leaf.id)}
                  className={`w-full flex items-center gap-2 h-[26px] pl-6 pr-2 mx-1 rounded-md transition-colors ${
                    isSelected
                      ? 'bg-accent text-foreground'
                      : 'text-foreground/75 hover:bg-muted/40'
                  }`}
                  title={leaf.label}
                >
                  <div className="w-3.5 h-3.5 flex items-center justify-center flex-shrink-0 text-muted-foreground/70">
                    <Icon size={11} />
                  </div>
                  <span className="text-[12px] truncate flex-1 text-left">{leaf.label}</span>
                  {leaf.soon && (
                    <span className="text-[8px] px-1 py-0.5 rounded bg-muted text-muted-foreground/80 uppercase tracking-wider shrink-0">
                      Soon
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function HubEmpty() {
  return (
    <div className="h-full flex items-center justify-center bg-card">
      <div className="text-center max-w-sm px-6">
        <div className="w-12 h-12 mx-auto mb-4 flex items-center justify-center rounded-xl bg-muted text-foreground/60">
          <NavHubIcon size={24} />
        </div>
        <h2 className="text-[15px] font-semibold text-foreground mb-1">Hub</h2>
        <p className="text-[12px] text-muted-foreground leading-relaxed">
          外部の会話・メール・会議・AI 対話を取り込み、Brief や Element に落とす入口。左から機能を選択してください。
        </p>
      </div>
    </div>
  );
}

function HubLeafView({ leaf }: { leaf: HubLeaf }) {
  const Icon = leaf.icon;
  return (
    <div className="h-full overflow-y-auto bg-card">
      <div className="max-w-3xl mx-auto px-6 py-8">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-muted text-foreground/70 shrink-0">
            <Icon size={20} />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold text-foreground tracking-tight">{leaf.label}</h1>
              {leaf.soon && (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase tracking-wider">
                  Soon
                </span>
              )}
            </div>
            <p className="text-[13px] text-muted-foreground mt-0.5">{leaf.description}</p>
          </div>
        </div>

        <div className="mt-6 border border-dashed border-border rounded-lg p-8 bg-muted/20">
          <p className="text-[12px] text-muted-foreground/80 text-center">
            この機能は準備中です。実装されると、ここから {leaf.label} のデータを閲覧・
            Brief/Element に変換できるようになります。
          </p>
        </div>
      </div>
    </div>
  );
}

// ============================================
// MainContent Props
// ============================================
interface MainContentProps {
  activeActivity: string;
  navigation: NavigationState;
  onNavigate: (nav: Partial<NavigationState>) => void;
  onViewChange?: (view: string) => void;
  explorerData: ExplorerData;
  onRefresh?: () => void;
}

// ============================================
// Helper: Find object by ID (recursive for nested objects)
// ============================================
function findObjectById(objects: AlconObjectWithChildren[], objectId: string): AlconObjectWithChildren | null {
  for (const obj of objects) {
    if (obj.id === objectId) return obj;
    if (obj.children) {
      const found = findObjectById(obj.children, objectId);
      if (found) return found;
    }
  }
  return null;
}

// ============================================
// Helper: Collect all elements from objects (recursive for nested objects)
// ============================================
function collectAllElements(objects: AlconObjectWithChildren[]): ElementWithDetails[] {
  let elements: ElementWithDetails[] = [];
  for (const obj of objects) {
    if (obj.elements) {
      elements = elements.concat(obj.elements);
    }
    if (obj.children) {
      elements = elements.concat(collectAllElements(obj.children));
    }
  }
  return elements;
}

// ============================================
// Helper: Collect all objects (flatten nested structure)
// ============================================
function collectAllObjects(explorerData: ExplorerData): AlconObjectWithChildren[] {
  function flatten(objects: AlconObjectWithChildren[]): AlconObjectWithChildren[] {
    let result: AlconObjectWithChildren[] = [];
    for (const obj of objects) {
      result.push(obj);
      if (obj.children) {
        result = result.concat(flatten(obj.children));
      }
    }
    return result;
  }
  return flatten(explorerData.objects);
}

// ============================================
// Helper: Find object in explorer data (recursive through nested objects)
// ============================================
function findObjectInExplorerData(explorerData: ExplorerData, objectId: string): AlconObjectWithChildren | null {
  return findObjectById(explorerData.objects, objectId);
}

// Island Card wrapper — now renders flush (VSCode-style), no rounded/shadow/border
function IslandCard({ children, className = '' }: { children: React.ReactNode; className?: string; noPadding?: boolean }) {
  return (
    <div className={`bg-card ${className}`}>
      {children}
    </div>
  );
}

export function MainContent({ activeActivity, navigation, onNavigate, onViewChange, explorerData, onRefresh }: MainContentProps) {
  const [hubSelectedId, setHubSelectedId] = useState<string | null>(null);
  const hubLeaf = findHubLeaf(hubSelectedId);

  const { nodes, createNode, renameNode, deleteNode } = useNotes();
  const { briefs, createBrief, deleteBrief } = useBriefs();
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const resolvedFileId = useDefaultFileId(nodes, selectedFileId);
  const { content, loading: contentLoading, save: saveContent } = useNoteContent(resolvedFileId);
  const [briefDialogOpen, setBriefDialogOpen] = useState(false);
  const [viewingBriefId, setViewingBriefId] = useState<string | null>(null);
  const [objectizeBriefId, setObjectizeBriefId] = useState<string | null>(null);
  // Per-file drafts for the Brief dialog so closing + reopening keeps
  // the user's edits / the AI extraction alive without re-running.
  const [briefDrafts, setBriefDrafts] = useState<Record<string, BriefDraft>>({});

  const selectedFile = resolvedFileId
    ? nodes.find((n) => n.id === resolvedFileId && n.type === 'file') ?? null
    : null;
  const viewingBrief = viewingBriefId
    ? briefs.find((t) => t.id === viewingBriefId) ?? null
    : null;

  const handleTitleChange = async (newTitle: string) => {
    if (!selectedFile) return;
    try { await renameNode(selectedFile.id, newTitle); } catch (e) { console.error(e); }
  };
  const handleCreateNode = async (type: 'file' | 'folder') => {
    try {
      const defaultName = type === 'folder' ? 'New Folder' : 'Untitled';
      const node = await createNode(type, defaultName, null);
      if (type === 'file') setSelectedFileId(node.id);
    } catch (e) { console.error(e); }
  };
  const handleDeleteNode = async (id: string) => {
    try {
      await deleteNode(id);
      if (resolvedFileId === id) setSelectedFileId(null);
    } catch (e) { console.error(e); }
  };
  // Throws on failure so BriefDialog can display the error inline.
  const handleCreateBrief = async (input: {
    title: string;
    summary: string;
    structured?: BriefStructured;
  }) => {
    if (!selectedFile) return;
    await createBrief({
      sourceNoteId: selectedFile.id,
      sourceNoteName: selectedFile.name,
      title: input.title,
      summary: input.summary,
      structured: input.structured,
      sourceSnapshot: content,
    });
    setBriefDrafts((prev) => {
      const next = { ...prev };
      delete next[selectedFile.id];
      return next;
    });
    setBriefDialogOpen(false);
  };
  const handleDeleteBrief = async (id: string) => {
    try {
      await deleteBrief(id);
      setViewingBriefId(null);
    } catch (e) { console.error(e); }
  };

  const objectizeBrief = objectizeBriefId
    ? briefs.find((t) => t.id === objectizeBriefId) ?? null
    : null;

  // Throws on failure so the ObjectDraftDialog can surface it.
  const handleCreateObjectFromBrief = async (input: {
    name: string;
    description?: string;
    color?: string;
    elements: ObjectDraftElement[];
  }) => {
    const created = await createObjectRow({
      name: input.name,
      description: input.description,
      color: input.color,
    });
    // Brief-generated Objects appear at the top of My Objects so they're
    // immediately visible. User can drag-reorder afterwards.
    try {
      await moveObject(created.id, null, 0);
    } catch (err) {
      console.error('Failed to move Brief Object to top', err);
    }
    // Create Elements sequentially so order_index is stable. createElement
    // already dual-writes to element_objects but swallows junction errors, so
    // re-assert the junction row via addElementToObject (idempotent on
    // duplicate — safely ignored).
    for (const el of input.elements) {
      try {
        const row = await createElementRow({
          title: el.title,
          object_id: created.id,
          description: el.description,
          priority: el.priority ?? 'medium',
        });
        try {
          await addElementToObject(row.id, created.id, true);
        } catch {
          // Junction likely already written by createElement's dual-write.
        }
      } catch (err) {
        console.error('Failed to create Element', el.title, err);
      }
    }
    onRefresh?.();
    setObjectizeBriefId(null);
    setViewingBriefId(null);
    onNavigate({ objectId: created.id });
    onViewChange?.('projects');
  };

  return (
    <div className="flex-1 flex flex-col bg-card overflow-hidden">
      {activeActivity === 'note' && (
        <div className="flex-1 flex overflow-hidden bg-card">
          <NotesSidebar
            nodes={nodes}
            selectedFileId={resolvedFileId}
            onSelectFile={setSelectedFileId}
            briefs={briefs}
            onSelectBrief={setViewingBriefId}
            onCreateNode={handleCreateNode}
            onDeleteNode={handleDeleteNode}
          />
          {selectedFile && !contentLoading ? (
            <PageView
              key={selectedFile.id}
              fileId={selectedFile.id}
              title={selectedFile.name}
              icon={selectedFile.icon}
              content={content}
              onTitleChange={handleTitleChange}
              onContentChange={saveContent}
              onBrief={() => setBriefDialogOpen(true)}
            />
          ) : (
            <BriefsEmptyState />
          )}

          {briefDialogOpen && selectedFile && (
            <BriefDialog
              defaultTitle={selectedFile.name}
              sourceFileName={selectedFile.name}
              sourceContent={content}
              initialDraft={briefDrafts[selectedFile.id]}
              onDraftChange={(draft) =>
                setBriefDrafts((prev) => ({ ...prev, [selectedFile.id]: draft }))
              }
              onClose={() => setBriefDialogOpen(false)}
              onCreate={handleCreateBrief}
            />
          )}
          {viewingBrief && (
            <BriefViewDialog
              brief={viewingBrief}
              onClose={() => setViewingBriefId(null)}
              onOpenSource={() => {
                setSelectedFileId(viewingBrief.sourceFileId);
                setViewingBriefId(null);
              }}
              onDelete={() => handleDeleteBrief(viewingBrief.id)}
              onObjectize={() => setObjectizeBriefId(viewingBrief.id)}
            />
          )}
          {objectizeBrief && (
            <ObjectDraftDialog
              brief={objectizeBrief}
              onClose={() => setObjectizeBriefId(null)}
              onCreate={handleCreateObjectFromBrief}
            />
          )}
        </div>
      )}
      {activeActivity === 'brief' && (
        <div className="flex-1 flex overflow-hidden bg-card">
          <BriefsListView
            briefs={briefs}
            onOpenSource={(fileId) => {
              setSelectedFileId(fileId);
              onViewChange?.('note');
            }}
            onDelete={handleDeleteBrief}
            onObjectize={(briefId) => setObjectizeBriefId(briefId)}
          />
          {objectizeBrief && (
            <ObjectDraftDialog
              brief={objectizeBrief}
              onClose={() => setObjectizeBriefId(null)}
              onCreate={handleCreateObjectFromBrief}
            />
          )}
        </div>
      )}
      {/* Hub: hierarchical sidebar (Communication / Intelligence) + detail */}
      {activeActivity === 'hub' && (
        <div className="flex-1 flex overflow-hidden bg-card">
          <HubSidebar selectedId={hubSelectedId} onSelect={setHubSelectedId} />
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
            {hubLeaf ? <HubLeafView leaf={hubLeaf} /> : <HubEmpty />}
          </div>
        </div>
      )}
      {activeActivity === 'home' && (
        <div className="flex-1 overflow-auto bg-card">
          <HomeView explorerData={explorerData} />
        </div>
      )}
      {/* Systems: management page */}
      {activeActivity === 'systems' && (
        <div className="flex-1 overflow-auto bg-card">
          <SystemsView explorerData={explorerData} onOpen={() => onViewChange?.('projects')} />
        </div>
      )}
      {/* My Tasks */}
      {activeActivity === 'mytasks' && (
        <div className="flex-1 flex flex-col overflow-hidden bg-card">
          <MyTasksView />
        </div>
      )}
      {/* Obj: flat sidebar + main content (hierarchy lives in Systems) */}
      {activeActivity === 'projects' && (
        <div className="flex-1 flex overflow-hidden bg-card">
          {/* Flat Object list sidebar */}
          <MyObjectsSidebar
            objects={explorerData.objects}
            selectedId={navigation.objectId}
            onSelect={(id) => onNavigate({ objectId: id })}
            onRefresh={onRefresh}
          />
          {/* Main content */}
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
            {navigation.objectId ? (
              <ObjectsView
                explorerData={explorerData}
                navigation={navigation}
                onNavigate={onNavigate}
                onRefresh={onRefresh}
              />
            ) : (
              <MyObjectsList
                explorerData={explorerData}
                onSelect={(id) => onNavigate({ objectId: id })}
              />
            )}
          </div>
        </div>
      )}
      {activeActivity === 'notes' && (
        <div className="flex-1 overflow-auto bg-card">
          <NotesView navigation={navigation} onNavigate={onNavigate} />
        </div>
      )}
      {activeActivity === 'actions' && (
        <div className="flex-1 overflow-auto bg-card">
          <ActionsView navigation={navigation} onNavigate={onNavigate} />
        </div>
      )}
    </div>
  );
}

// ============================================
// Simple Object Tree Item (for the integrated sidebar)
// ============================================
function ObjectTreeItem({ object, selectedId, onSelect, depth }: {
  object: AlconObjectWithChildren;
  selectedId: string | null;
  onSelect: (id: string) => void;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(true);
  const isSelected = selectedId === object.id;
  const hasChildren = object.children && object.children.length > 0;

  return (
    <div>
      <div
        className={`flex items-center h-[28px] cursor-pointer transition-colors rounded mx-1 ${
          isSelected ? 'bg-accent text-foreground' : 'hover:bg-muted/50'
        }`}
        style={{ paddingLeft: `${8 + depth * 14}px`, paddingRight: '8px' }}
        onClick={() => onSelect(object.id)}
      >
        <button
          className={`w-4 h-4 flex items-center justify-center flex-shrink-0 text-muted-foreground transition-transform ${
            hasChildren ? '' : 'invisible'
          } ${expanded ? 'rotate-90' : ''}`}
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
        <div className="w-4 h-4 flex items-center justify-center flex-shrink-0 text-muted-foreground ml-0.5 mr-1">
          <ObjectIcon size={13} />
        </div>
        <span className="text-[13px] truncate">{object.name}</span>
      </div>
      {expanded && hasChildren && object.children!.map(child => (
        <ObjectTreeItem key={child.id} object={child} selectedId={selectedId} onSelect={onSelect} depth={depth + 1} />
      ))}
    </div>
  );
}

export { IslandCard };

// ============================================
// Objects View - Shows object contents
// ============================================
function ObjectsView({ explorerData, navigation, onNavigate, onRefresh }: {
  explorerData: ExplorerData;
  navigation: NavigationState;
  onNavigate: (nav: Partial<NavigationState>) => void;
  onRefresh?: () => void;
}) {
  // If an object is selected, show object detail
  if (navigation.objectId) {
    const selectedObject = findObjectInExplorerData(explorerData, navigation.objectId);
    if (!selectedObject) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-[var(--text-muted)]">Object not found</div>
        </div>
      );
    }
    return (
      <ObjectDetailView
        object={selectedObject}
        onNavigate={onNavigate}
        onRefresh={onRefresh}
        explorerData={explorerData}
      />
    );
  }

  // No selection - show message to select an object
  return (
    <div className="flex-1 flex items-center justify-center bg-[var(--content-bg)]">
      <div className="text-center">
        <div className="text-muted-foreground mb-2">
          <ObjectIcon size={48} />
        </div>
        <p className="text-muted-foreground">Select an Object from the sidebar</p>
      </div>
    </div>
  );
}

// OverviewView is now imported from @/components/overview/OverviewView

// ============================================
// Object List Row
// ============================================
function ObjectListRow({ object, rowNumber, onClick }: {
  object: AlconObjectWithChildren;
  rowNumber: number;
  onClick: () => void;
}) {
  const elementCount = object.elements?.length || 0;
  const doneCount = object.elements?.filter(e => e.status === 'done').length || 0;
  const progress = elementCount > 0 ? Math.round((doneCount / elementCount) * 100) : 0;

  return (
    <div
      className="flex items-center px-4 py-3 border-b border-border cursor-pointer hover:bg-muted transition-colors"
      onClick={onClick}
    >
      <span className="w-10 text-xs text-muted-foreground">{rowNumber}</span>
      <div className="flex items-center gap-2.5 flex-1 min-w-0">
        <span className="text-muted-foreground"><ObjectIcon size={16} /></span>
        <span className="text-[13px] text-foreground truncate">{object.name}</span>
      </div>
      <span className="w-24 text-xs text-muted-foreground">{elementCount} elements</span>
      <div className="w-28 flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-foreground rounded-full transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-[10px] text-muted-foreground w-8">{progress}%</span>
      </div>
    </div>
  );
}

// ============================================
// Object Table Row
// ============================================
function ObjectTableRow({ object, rowNumber, onClick }: {
  object: AlconObjectWithChildren;
  rowNumber: number;
  onClick: () => void;
}) {
  const elementCount = object.elements?.length || 0;
  const doneCount = object.elements?.filter(e => e.status === 'done').length || 0;
  const progress = elementCount > 0 ? Math.round((doneCount / elementCount) * 100) : 0;

  return (
    <tr
      className="border-b border-border cursor-pointer hover:bg-muted transition-colors"
      onClick={onClick}
    >
      <td className="px-4 py-3 text-xs text-muted-foreground">{rowNumber}</td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-2.5">
          <span className="text-muted-foreground"><ObjectIcon size={16} /></span>
          <span className="text-[13px] text-foreground">{object.name}</span>
        </div>
      </td>
      <td className="px-3 py-3 text-xs text-muted-foreground">{elementCount} elements</td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-foreground rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-[10px] text-muted-foreground w-8">{progress}%</span>
        </div>
      </td>
    </tr>
  );
}

// ============================================
// Section Header Component (simple)
// ============================================
function SectionHeader({ label }: { label: string }) {
  return (
    <div className="px-4 pt-6 pb-2">
      <div className="text-sm font-semibold text-foreground">
        {label}
      </div>
    </div>
  );
}

// Components imported from @/components/columns:
// - AddColumnModal, ColumnHeader, BuiltInColumnHeader, CustomColumnCell
// - EditPropertyModal, EditBuiltInPropertyModal
// - DEFAULT_BUILTIN_COLUMNS, BuiltInColumn type
// - COLUMN_TYPES

// Components imported from @/components/elements:
// - ElementTableRow, SubelementRow, ElementInlineDetail

// Components imported from @/components/home:
// - HomeView
// ============================================
// Object Detail View - Shows Object with Elements by Section
// ============================================
function ObjectDetailView({ object, onNavigate, onRefresh, explorerData }: {
  object: AlconObjectWithChildren;
  onNavigate: (nav: Partial<NavigationState>) => void;
  onRefresh?: () => void;
  explorerData: ExplorerData;
}) {
  // Get all objects for Matrix View column source selection
  const allObjects = collectAllObjects(explorerData);
  const [isAddingElement, setIsAddingElement] = useState(false);
  const [addMode, setAddMode] = useState<'element' | 'object'>('element');
  const [newTitle, setNewTitle] = useState('');
  const [newSection, setNewSection] = useState('');
  // Inline add: tracks which row is in input mode. Key examples: "object", "section:Backend", "section:__no_section__"
  const [inlineAddKey, setInlineAddKey] = useState<string | null>(null);
  const [inlineAddText, setInlineAddText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedElement, setSelectedElement] = useState<ElementWithDetails | null>(null);

  // Element detail view state
  const [detailElementId, setDetailElementId] = useState<string | null>(null);

  // Multi-select elements state (scoped to section)
  const [selectedElementIds, setSelectedElementIds] = useState<Set<string>>(new Set());
  const [lastSelectedElementIndex, setLastSelectedElementIndex] = useState<number | null>(null);
  const [selectionSectionIndex, setSelectionSectionIndex] = useState<number | null>(null);

  // Section collapse state (key = section name; '__no_section__' for elements without one)
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  const toggleSectionCollapse = (key: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Section CRUD — sections live as a string column on Element rows, so each
  // operation fans out to the matching elements.
  const handleRenameSection = async (oldName: string) => {
    const newName = window.prompt('セクション名を変更', oldName);
    if (!newName || !newName.trim() || newName === oldName) return;
    const trimmed = newName.trim();
    const inSection = elements.filter((e) => e.section === oldName);
    try {
      await Promise.all(inSection.map((e) => updateElement(e.id, { section: trimmed })));
      onRefresh?.();
    } catch (e) {
      console.error('Failed to rename section:', e);
    }
  };

  const handleDuplicateSection = async (name: string) => {
    const newName = `${name} (copy)`;
    const inSection = elements.filter((e) => e.section === name);
    try {
      await Promise.all(
        inSection.map((e) =>
          createElement({
            title: e.title,
            description: e.description,
            object_id: object.id,
            section: newName,
            status: e.status || 'todo',
            priority: e.priority || 'medium',
          }),
        ),
      );
      onRefresh?.();
    } catch (e) {
      console.error('Failed to duplicate section:', e);
    }
  };

  const handleDeleteSection = async (name: string) => {
    const inSection = elements.filter((e) => e.section === name);
    if (inSection.length === 0) return;
    if (!window.confirm(`セクション "${name}" の Element ${inSection.length}件をすべて削除します。よろしいですか?`)) return;
    try {
      await Promise.all(inSection.map((e) => deleteElement(e.id)));
      onRefresh?.();
    } catch (e) {
      console.error('Failed to delete section:', e);
    }
  };

  // Object-level AI report (opened from the action bar button)
  const [reportOpen, setReportOpen] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [report, setReport] = useState<{ signedUrl: string; filename: string } | null>(null);

  const handleGenerateObjectReport = async () => {
    setReportOpen(true);
    setReportLoading(true);
    setReportError(null);
    setReport(null);
    try {
      const { data, error } = await supabase.functions.invoke('generate-object-report', {
        body: { object_id: object.id },
      });
      if (error) throw error;
      if (!data?.signed_url) throw new Error('No signed URL returned');
      setReport({ signedUrl: data.signed_url, filename: data.filename ?? 'report.docx' });
    } catch (e: any) {
      setReportError(String(e?.message ?? e));
    } finally {
      setReportLoading(false);
    }
  };

  // Bulk action UI state (opened from the selection toolbar)
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const [bulkAddOpen, setBulkAddOpen] = useState(false);
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const [allWorkers, setAllWorkers] = useState<Worker[]>([]);

  const clearSelection = React.useCallback(() => {
    setSelectedElementIds(new Set());
    setLastSelectedElementIndex(null);
    setSelectionSectionIndex(null);
  }, []);

  // Escape clears selection
  useEffect(() => {
    if (selectedElementIds.size === 0) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clearSelection();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedElementIds.size, clearSelection]);

  // Fetch workers lazily when the bulk Assign picker is opened
  useEffect(() => {
    if (!bulkAssignOpen || allWorkers.length > 0) return;
    fetchAllWorkers().then(setAllWorkers).catch(console.error);
  }, [bulkAssignOpen, allWorkers.length]);

  const bulkIds = React.useMemo(() => Array.from(selectedElementIds), [selectedElementIds]);

  const handleBulkDelete = async () => {
    try {
      await Promise.all(bulkIds.map((id) => deleteElement(id)));
      setBulkDeleteConfirmOpen(false);
      clearSelection();
      onRefresh?.();
    } catch (e) {
      console.error('Failed to bulk delete:', e);
    }
  };

  const handleBulkMoveTo = async (targetObjectId: string) => {
    try {
      await Promise.all(bulkIds.map((id) => updateElement(id, { object_id: targetObjectId })));
      setBulkMoveOpen(false);
      clearSelection();
      onRefresh?.();
    } catch (e) {
      console.error('Failed to bulk move:', e);
    }
  };

  // Multi-home: register the SAME Element in another Object (no copy).
  const handleBulkAddTo = async (targetObjectId: string) => {
    try {
      await Promise.all(bulkIds.map((id) => addElementToObject(id, targetObjectId, false)));
      setBulkAddOpen(false);
      clearSelection();
      onRefresh?.();
    } catch (e) {
      console.error('Failed to bulk add-to-object:', e);
    }
  };

  const handleBulkAssign = async (workerId: string) => {
    try {
      await Promise.all(
        bulkIds.map((id) => addElementAssignee({ element_id: id, worker_id: workerId, role: 'assignee' }))
      );
      setBulkAssignOpen(false);
      clearSelection();
      onRefresh?.();
    } catch (e) {
      console.error('Failed to bulk assign:', e);
    }
  };

  // Multi-select columns state (key: "sectionIndex-colIndex")
  const [selectedColumnKeys, setSelectedColumnKeys] = useState<Set<string>>(new Set());
  const [lastSelectedColumnKey, setLastSelectedColumnKey] = useState<{ sectionIndex: number; colIndex: number } | null>(null);

  // Tabs state
  const { tabs, loading: tabsLoading, refetch: refetchTabs } = useObjectTabs(object.id);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  // Track which objects we've already initialized default tabs for (ref to survive re-renders)
  const initializedTabsRef = React.useRef<Set<string>>(new Set());
  const creatingTabsRef = React.useRef(false);

  // Auto-create default tabs if none exist (wait for loading to complete first)
  useEffect(() => {
    const initializeDefaultTabs = async () => {
      if (tabsLoading) return;
      if (tabs.length > 0) return;
      if (initializedTabsRef.current.has(object.id)) return;
      if (creatingTabsRef.current) return;
      initializedTabsRef.current.add(object.id);
      creatingTabsRef.current = true;
      try {
        const defaults: { type: ObjectTabType; title: string }[] = [
          { type: 'overview', title: 'Overview' },
          { type: 'elements', title: 'List' },
          { type: 'gantt', title: 'Gantt' },
          { type: 'summary', title: 'Dashboard' },
          { type: 'calendar', title: 'Calendar' },
        ];
        for (let i = 0; i < defaults.length; i++) {
          await createObjectTab({
            object_id: object.id,
            tab_type: defaults[i].type,
            title: defaults[i].title,
            order_index: i,
          });
        }
        await refetchTabs();
      } catch (e) {
        console.error('Failed to create default tabs:', e);
        initializedTabsRef.current.delete(object.id);
      } finally {
        creatingTabsRef.current = false;
      }
    };
    initializeDefaultTabs();
  }, [tabsLoading, tabs.length, object.id, refetchTabs]);

  // When object changes or tabs load, default to first tab (Overview)
  useEffect(() => {
    if (tabs.length > 0) {
      setActiveTabId(tabs[0].id);
    } else {
      setActiveTabId(null);
    }
  }, [object.id, tabs]);

  const activeTab = tabs.find(t => t.id === activeTabId);

  const handleTabCreate = async (type: ObjectTabType, title: string) => {
    console.log('[MainContent] handleTabCreate called:', { type, title, objectId: object.id });
    try {
      const newTab = await createObjectTab({
        object_id: object.id,
        tab_type: type,
        title,
      });
      console.log('[MainContent] Tab created successfully:', newTab);
      await refetchTabs();
      setActiveTabId(newTab.id);
    } catch (e) {
      console.error('[MainContent] Failed to create tab:', e);
    }
  };

  const handleTabClose = async (tabId: string) => {
    try {
      await deleteObjectTab(tabId);
      await refetchTabs();
      // If we closed the active tab, switch to Elements tab
      if (tabId === activeTabId) {
        const elementsTab = tabs.find(t => t.tab_type === 'elements' && t.id !== tabId);
        setActiveTabId(elementsTab?.id || null);
      }
    } catch (e) {
      console.error('Failed to close tab:', e);
    }
  };

  // Custom columns state
  const [customColumns, setCustomColumns] = useState<CustomColumnWithValues[]>([]);
  const [showAddColumnModal, setShowAddColumnModal] = useState(false);

  // Built-in columns state (stored globally in localStorage - shared across all objects)
  // Use parent_object_id if available, otherwise use 'global' to share across all objects
  const configKey = object.parent_object_id || 'global';
  const [builtInColumns, setBuiltInColumns] = useState<BuiltInColumn[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(`builtInColumns_${configKey}`);
      return saved ? JSON.parse(saved) : DEFAULT_BUILTIN_COLUMNS;
    }
    return DEFAULT_BUILTIN_COLUMNS;
  });

  // Save built-in columns to localStorage (shared across all objects)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(`builtInColumns_${configKey}`, JSON.stringify(builtInColumns));
    }
  }, [builtInColumns, configKey]);

  const allElements = object.elements || [];
  const elements = allElements;

  // Collect ALL elements including children Objects (for Gantt/Dashboard/Calendar/Overview)
  // Uses Set for dedup (multi-homing) and cycle prevention
  const allDescendantElements = useMemo(() => {
    const seen = new Set<string>();
    const result: ElementWithDetails[] = [];
    const addElements = (els: ElementWithDetails[]) => {
      for (const el of els) {
        if (!seen.has(el.id)) { seen.add(el.id); result.push(el); }
      }
    };
    addElements(allElements);
    const visitedObjects = new Set<string>();
    const collectFromChildren = (children?: AlconObjectWithChildren[]) => {
      if (!children) return;
      for (const child of children) {
        if (visitedObjects.has(child.id)) continue; // cycle guard
        visitedObjects.add(child.id);
        if (child.elements) addElements(child.elements);
        collectFromChildren(child.children);
      }
    };
    collectFromChildren(object.children);
    return result;
  }, [allElements, object.children]);
  const elementsBySection = groupElementsBySection(elements);

  // DnD sensors for element row reorder
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const handleElementDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = elements.findIndex(e => e.id === active.id);
    const newIndex = elements.findIndex(e => e.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(elements, oldIndex, newIndex);
    const updates = reordered.map((e, idx) => ({ id: e.id, order_index: idx }));

    try {
      await reorderElements(updates);
      onRefresh?.();
    } catch (err) {
      console.error('Failed to reorder elements:', err);
    }
  };

  // Update selected element when elements change
  const currentSelectedElement = selectedElement
    ? elements.find(e => e.id === selectedElement.id) || null
    : null;

  // Get unique sections for dropdown
  const existingSections = [...new Set(elements.map(e => e.section).filter(Boolean))] as string[];

  // Fetch custom columns (shared across project - use first object's columns as template)
  useEffect(() => {
    fetchCustomColumnsWithValues(object.id).then(setCustomColumns).catch(console.error);
  }, [object.id]);

  // Cell selection state for drag selection
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set());
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ rowIndex: number; colIndex: number } | null>(null);

  // Handle mouse down to start drag selection
  const handleCellMouseDown = (rowIndex: number, colIndex: number, event: React.MouseEvent) => {
    event.preventDefault();
    setIsDragging(true);
    setDragStart({ rowIndex, colIndex });
    setSelectedCells(new Set([`${rowIndex}-${colIndex}`]));
  };

  // Handle mouse enter during drag to extend selection
  const handleCellMouseEnter = (rowIndex: number, colIndex: number) => {
    if (isDragging && dragStart) {
      const startRow = Math.min(dragStart.rowIndex, rowIndex);
      const endRow = Math.max(dragStart.rowIndex, rowIndex);
      const startCol = Math.min(dragStart.colIndex, colIndex);
      const endCol = Math.max(dragStart.colIndex, colIndex);

      const newSelection = new Set<string>();
      for (let r = startRow; r <= endRow; r++) {
        for (let c = startCol; c <= endCol; c++) {
          newSelection.add(`${r}-${c}`);
        }
      }
      setSelectedCells(newSelection);
    }
  };

  // Handle mouse up to end drag selection
  useEffect(() => {
    const handleMouseUp = () => {
      setIsDragging(false);
    };
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, []);

  // Clear selection on click outside table
  const handleTableClick = (event: React.MouseEvent) => {
    const target = event.target as HTMLElement;
    if (!target.closest('td') && !target.closest('th')) {
      setSelectedCells(new Set());
    }
  };


  const handleUpdateBuiltInColumn = (columnId: string, updates: Partial<BuiltInColumn>) => {
    setBuiltInColumns(prev => prev.map(col =>
      col.id === columnId ? { ...col, ...updates } : col
    ));
  };

  const handleDeleteBuiltInColumn = (columnId: string) => {
    setBuiltInColumns(prev => prev.filter(col => col.id !== columnId));
  };

  // Add a built-in column back (for restoring deleted columns)
  const handleAddBuiltInColumn = (builtinType: 'assignees' | 'priority' | 'status' | 'due_date') => {
    const defaultCol = DEFAULT_BUILTIN_COLUMNS.find(c => c.builtinType === builtinType);
    if (defaultCol && !builtInColumns.find(c => c.builtinType === builtinType)) {
      setBuiltInColumns(prev => [...prev, { ...defaultCol }]);
    }
  };

  // Parse bulk text input (Asana-style)
  // - Each non-empty line = one item
  // - Lines starting with "# " or "## " = section header for following items
  // - Strip leading bullet markers: "- ", "* ", "• ", "[ ] ", "[x] "
  const parseBulkInput = (raw: string, defaultSection: string | null) => {
    const lines = raw.split('\n').map(s => s.trim()).filter(Boolean);
    let currentSection = defaultSection;
    const items: { title: string; section: string | null }[] = [];
    for (const line of lines) {
      if (/^#+\s+/.test(line)) {
        currentSection = line.replace(/^#+\s+/, '').trim();
        continue;
      }
      const cleaned = line
        .replace(/^[-*•]\s+/, '')
        .replace(/^\[\s*[xX ]?\s*\]\s+/, '')
        .trim();
      if (cleaned) items.push({ title: cleaned, section: currentSection });
    }
    return items;
  };

  // Compute parsed items for live preview
  const parsedAddItems = useMemo(
    () => parseBulkInput(newTitle, newSection.trim() || null),
    [newTitle, newSection]
  );

  const handleAddElement = async () => {
    const items = parsedAddItems;
    if (items.length === 0) return;

    setIsLoading(true);
    try {
      for (const item of items) {
        await createElement({
          title: item.title,
          object_id: object.id,
          section: item.section,
          status: 'todo',
          priority: 'medium',
        });
      }
      setNewTitle('');
      setNewSection('');
      setIsAddingElement(false);
      onRefresh?.();
    } catch (e) {
      console.error('Failed to create element(s):', e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddObjectsBulk = async () => {
    const items = parsedAddItems;
    if (items.length === 0) return;

    setIsLoading(true);
    try {
      for (const item of items) {
        await createObject({
          name: item.title,
          parent_object_id: object.id,
        });
      }
      setNewTitle('');
      setNewSection('');
      setIsAddingElement(false);
      onRefresh?.();
    } catch (e) {
      console.error('Failed to create object(s):', e);
    } finally {
      setIsLoading(false);
    }
  };

  // Single-step open of bulk form
  const handleOpenAddForm = (mode: 'element' | 'object') => {
    setAddMode(mode);
    setNewTitle('');
    setNewSection('');
    setIsAddingElement(true);
  };

  // Inline add submission — Elements only. Objects are added via the Add dropdown.
  // Parallel inserts, single refresh at the end.
  const handleInlineAddSubmit = async (key: string, raw: string) => {
    if (!raw.trim() || !key.startsWith('section:')) return;

    try {
      const sectionName = key.slice('section:'.length);
      const defaultSection = sectionName === '__no_section__' ? null : sectionName;
      const items = parseBulkInput(raw, defaultSection);
      await Promise.all(
        items.map((item) =>
          createElement({
            title: item.title,
            object_id: object.id,
            section: item.section,
            status: 'todo',
            priority: 'medium',
          })
        )
      );
      onRefresh?.();
    } catch (e) {
      console.error('Failed to inline-add:', e);
    }
  };

  const handleSubmitAdd = () => {
    if (addMode === 'object') return handleAddObjectsBulk();
    return handleAddElement();
  };

  // Legacy: handleAddSubObject still used by Object tree contextual creation
  const handleAddSubObject = async () => {
    setIsLoading(true);
    try {
      await createObject({
        name: 'New Object',
        parent_object_id: object.id,
      });
      onRefresh?.();
    } catch (e) {
      console.error('Failed to create sub-object:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddSection = () => {
    setAddMode('element');
    setNewSection('');
    setIsAddingElement(true);
    // Pre-focus section field hint: keep title empty so user types section first
    setTimeout(() => {
      const sectionInput = document.querySelector<HTMLInputElement>('input[placeholder="Section (optional)"]');
      sectionInput?.focus();
    }, 50);
  };

  const handleStatusChange = async (elementId: string, newStatus: string) => {
    try {
      await updateElement(elementId, { status: newStatus as any });
      onRefresh?.();
    } catch (e) {
      console.error('Failed to update element:', e);
    }
  };

  const handleAddColumn = async (name: string, type: CustomColumnType) => {
    try {
      let options: Record<string, unknown> = {};

      if (type === 'select' || type === 'multi_select' || type === 'status') {
        options = { options: [{ value: 'Option 1' }, { value: 'Option 2' }] };
      }

      await createCustomColumn({
        object_id: object.id,
        name,
        column_type: type,
        options,
      });
      const updated = await fetchCustomColumnsWithValues(object.id);
      setCustomColumns(updated);
      setShowAddColumnModal(false);
    } catch (e) {
      console.error('Failed to create column:', e);
    }
  };

  const handleRenameColumn = async (columnId: string, name: string) => {
    try {
      await updateCustomColumn(columnId, { name });
      const updated = await fetchCustomColumnsWithValues(object.id);
      setCustomColumns(updated);
    } catch (e) {
      console.error('Failed to rename column:', e);
    }
  };

  const handleDeleteColumn = async (columnId: string) => {
    try {
      await deleteCustomColumn(columnId);
      const updated = await fetchCustomColumnsWithValues(object.id);
      setCustomColumns(updated);
    } catch (e) {
      console.error('Failed to delete column:', e);
    }
  };

  const handleUpdateColumn = async (columnId: string, updates: { name?: string; options?: { options?: { value: string; color?: string }[] } }) => {
    try {
      await updateCustomColumn(columnId, updates);
      const updated = await fetchCustomColumnsWithValues(object.id);
      setCustomColumns(updated);
    } catch (e) {
      console.error('Failed to update column:', e);
    }
  };

  const handleDuplicateColumn = async (column: CustomColumnWithValues) => {
    try {
      await createCustomColumn({
        object_id: object.id,
        name: `${column.name} (copy)`,
        column_type: column.column_type,
        options: column.options,
      });
      const updated = await fetchCustomColumnsWithValues(object.id);
      setCustomColumns(updated);
    } catch (e) {
      console.error('Failed to duplicate column:', e);
    }
  };

  const handleColumnValueChange = async (columnId: string, elementId: string, value: Json) => {
    try {
      await setCustomColumnValue(columnId, elementId, value);
      const updated = await fetchCustomColumnsWithValues(object.id);
      setCustomColumns(updated);
    } catch (e) {
      console.error('Failed to update column value:', e);
    }
  };

  // Handle column header click for multi-select (scoped to section)
  const handleColumnHeaderClick = (sectionIndex: number, colIndex: number, event: React.MouseEvent) => {
    const key = `${sectionIndex}-${colIndex}`;

    if (event.shiftKey) {
      // Shift+click: range select columns within same section
      event.preventDefault();
      if (lastSelectedColumnKey !== null && lastSelectedColumnKey.sectionIndex === sectionIndex) {
        const start = Math.min(lastSelectedColumnKey.colIndex, colIndex);
        const end = Math.max(lastSelectedColumnKey.colIndex, colIndex);
        const newSelection = new Set<string>();
        for (let i = start; i <= end; i++) {
          newSelection.add(`${sectionIndex}-${i}`);
        }
        setSelectedColumnKeys(newSelection);
      } else {
        // Different section or no previous selection
        setSelectedColumnKeys(new Set([key]));
        setLastSelectedColumnKey({ sectionIndex, colIndex });
      }
    } else if (event.ctrlKey || event.metaKey) {
      // Ctrl/Cmd+click: toggle column in selection (same section only)
      if (lastSelectedColumnKey === null || lastSelectedColumnKey.sectionIndex === sectionIndex) {
        const newSelection = new Set(selectedColumnKeys);
        if (newSelection.has(key)) {
          newSelection.delete(key);
        } else {
          newSelection.add(key);
        }
        setSelectedColumnKeys(newSelection);
        setLastSelectedColumnKey({ sectionIndex, colIndex });
      } else {
        // Different section - start fresh
        setSelectedColumnKeys(new Set([key]));
        setLastSelectedColumnKey({ sectionIndex, colIndex });
      }
    } else {
      // Normal click: single select
      setSelectedColumnKeys(new Set([key]));
      setLastSelectedColumnKey({ sectionIndex, colIndex });
    }
  };

  // Calculate total table columns: row num + name + visible built-in columns + custom columns + add button
  const visibleBuiltInCount = builtInColumns.filter(col => col.isVisible).length;
  const totalColumns = 2 + visibleBuiltInCount + customColumns.length + 1;

  // Detail view check (computed AFTER all hooks to avoid hook-order violation)
  const detailElement = detailElementId ? allElements.find(e => e.id === detailElementId) : null;

  // Build breadcrumb path for this object
  const objectPath = useMemo(() => {
    const findPath = (objs: AlconObjectWithChildren[], path: { id: string; name: string }[]): { id: string; name: string }[] | null => {
      for (const obj of objs) {
        const currentPath = [...path, { id: obj.id, name: obj.name }];
        if (obj.id === object.id) return currentPath;
        if (obj.children) {
          const found = findPath(obj.children, currentPath);
          if (found) return found;
        }
      }
      return null;
    };
    return findPath(explorerData.objects, []) || [];
  }, [explorerData.objects, object.id]);

  // Early return AFTER all hooks have been called
  if (detailElement) {
    return (
      <ElementDetailView
        element={detailElement}
        objectName={object.name}
        onBack={() => setDetailElementId(null)}
        onRefresh={onRefresh}
      />
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Breadcrumb + Tab Bar + Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
          {/* Breadcrumb path — parents only; the current Object becomes a title row below */}
          <div className="flex items-center gap-1 px-4 pt-3 pb-1 min-h-[28px]">
            {objectPath.slice(0, -1).map((seg, i) => (
              <div key={seg.id} className="flex items-center gap-1 min-w-0">
                {i > 0 && <ChevronRight size={12} className="text-muted-foreground/50 flex-shrink-0" />}
                <button
                  onClick={() => onNavigate({ objectId: seg.id })}
                  className="flex items-center gap-1 text-[13px] truncate max-w-[200px] text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <ObjectIcon size={12} />
                  <span className="truncate">{seg.name}</span>
                </button>
              </div>
            ))}
          </div>
          {/* Current Object — title row */}
          <div className="flex items-center gap-3 px-4 pb-3 min-w-0">
            <span className="text-foreground/80 shrink-0"><ObjectIcon size={22} /></span>
            <h1 className="text-2xl font-semibold text-foreground tracking-tight truncate">
              {object.name}
            </h1>
            <span
              className="font-mono text-[11px] px-2 py-0.5 bg-muted rounded text-muted-foreground/80 cursor-pointer hover:bg-muted/80 transition-colors shrink-0"
              title="Click to copy Object ID"
              onClick={(e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(object.display_id ?? `obj-${object.id.slice(0, 8)}`);
              }}
            >
              {object.display_id ?? `obj-${object.id.slice(0, 8)}`}
            </span>
          </div>
          {/* Tab Bar */}
          <TabBar
            tabs={tabs}
            activeTabId={activeTabId}
            onTabSelect={setActiveTabId}
            onTabClose={handleTabClose}
            onTabCreate={handleTabCreate}
          />

      {/* Tab Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Elements Tab Content */}
        {activeTab?.tab_type === 'elements' && (
          <>
          <div className="flex-1 flex flex-col">
            {/* Elements Action Bar — left-aligned (Asana style). Object name + ID
                 live in the title row above so they're not repeated here. */}
            <div className="px-5 py-2 border-b border-border bg-card flex items-center gap-2 flex-shrink-0">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="inline-flex items-center gap-1.5 text-[13px] font-medium text-foreground/80 hover:text-foreground border border-border/60 hover:bg-muted px-2.5 py-1 rounded-md transition-colors"
                  >
                    Add Elements
                    <ChevronDown size={11} className="opacity-60" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[220px]">
                  <DropdownMenuLabel className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Add to {object.name}
                  </DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => handleOpenAddForm('object')} className="gap-2.5 items-start py-2">
                    <span className="w-4 h-4 flex items-center justify-center text-muted-foreground shrink-0 mt-0.5">
                      <FolderPlus size={15} strokeWidth={1.75} />
                    </span>
                    <div className="flex flex-col">
                      <span>Object</span>
                      <span className="text-[11px] text-muted-foreground">Single or bulk (one per line)</span>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleOpenAddForm('element')} className="gap-2.5 items-start py-2">
                    <span className="w-4 h-4 flex items-center justify-center text-muted-foreground shrink-0 mt-0.5">
                      <ListPlus size={15} strokeWidth={1.75} />
                    </span>
                    <div className="flex flex-col">
                      <span>Element</span>
                      <span className="text-[11px] text-muted-foreground">Single or bulk (one per line)</span>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleAddSection} className="gap-2.5 items-start py-2">
                    <span className="w-4 h-4 flex items-center justify-center text-muted-foreground shrink-0 mt-0.5">
                      <Heading size={15} strokeWidth={1.75} />
                    </span>
                    <div className="flex flex-col">
                      <span>Section</span>
                      <span className="text-[11px] text-muted-foreground">Group elements together</span>
                    </div>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <button
                disabled
                className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground/70 border border-border/60 px-2.5 py-1 rounded-md cursor-not-allowed opacity-60"
                title="Filter (coming soon)"
              >
                <Filter size={13} />
                Filter
              </button>
              <button
                disabled
                className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground/70 border border-border/60 px-2.5 py-1 rounded-md cursor-not-allowed opacity-60"
                title="Sort (coming soon)"
              >
                <ArrowUpDown size={13} />
                Sort
              </button>

              <div className="flex-1" />

              <button
                onClick={handleGenerateObjectReport}
                className="inline-flex items-center gap-1.5 text-[13px] font-medium text-foreground/80 hover:text-foreground border border-border/60 hover:bg-muted px-2.5 py-1 rounded-md transition-colors"
                title="この Object のレポートを AI で生成"
              >
                <Sparkles size={13} />
                レポート
              </button>
            </div>

            {/* Bulk action bar — shown when rows are multi-selected */}
            {selectedElementIds.size > 0 && (
              <div className="flex items-center gap-2 px-5 py-2 bg-foreground text-background flex-shrink-0 border-b border-border">
                <span className="text-[12px] font-medium tabular-nums">
                  {selectedElementIds.size} selected
                </span>
                <div className="flex-1" />
                <DropdownMenu open={bulkAssignOpen} onOpenChange={setBulkAssignOpen}>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="inline-flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1 rounded-md hover:bg-background/15 transition-colors"
                      title="Assign a worker to selected elements"
                    >
                      <Users size={13} />
                      Assign
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-[200px] max-h-72 overflow-y-auto">
                    <DropdownMenuLabel className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Add assignee to {selectedElementIds.size}
                    </DropdownMenuLabel>
                    {allWorkers.length === 0 ? (
                      <DropdownMenuItem disabled className="text-[12px] text-muted-foreground">
                        Loading workers…
                      </DropdownMenuItem>
                    ) : (
                      allWorkers.map((w) => (
                        <DropdownMenuItem
                          key={w.id}
                          onClick={() => handleBulkAssign(w.id)}
                          className="text-[12px]"
                        >
                          {w.name}
                          <span className="ml-auto text-[10px] text-muted-foreground capitalize">{w.type}</span>
                        </DropdownMenuItem>
                      ))
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
                <button
                  onClick={() => setBulkAddOpen(true)}
                  className="inline-flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1 rounded-md hover:bg-background/15 transition-colors"
                  title="Multi-home selected elements in another Object (same Elements, new parent)"
                >
                  <Link2 size={13} />
                  Add to…
                </button>
                <button
                  onClick={() => setBulkMoveOpen(true)}
                  className="inline-flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1 rounded-md hover:bg-background/15 transition-colors"
                  title="Move selected elements to another primary Object"
                >
                  <ArrowRight size={13} />
                  Move to…
                </button>
                <button
                  onClick={() => setBulkDeleteConfirmOpen(true)}
                  className="inline-flex items-center gap-1.5 text-[12px] font-medium text-red-300 hover:text-red-100 px-2.5 py-1 rounded-md hover:bg-background/15 transition-colors"
                >
                  <Trash2 size={13} />
                  Delete
                </button>
                <button
                  onClick={clearSelection}
                  className="p-1 rounded-md hover:bg-background/15 transition-colors"
                  title="Clear selection (Esc)"
                >
                  <X size={14} />
                </button>
              </div>
            )}

            {/* Main scrollable content */}
            <div className="flex-1 overflow-auto">
        <div className="px-5 pt-4 pb-5">
        {/* Bulk Add Form (Asana-style) */}
        {isAddingElement && (
          <div className="mb-4 p-4 bg-muted/40 rounded-lg border border-border">
            <div className="flex flex-col gap-3">
              {/* Mode toggle */}
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Add</span>
                <div className="inline-flex items-center bg-card rounded-md p-0.5 border border-border/60">
                  {(['element', 'object'] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setAddMode(m)}
                      className={`px-2.5 py-0.5 text-[11px] font-medium rounded transition-colors capitalize ${
                        addMode === m ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
                <span className="text-[11px] text-muted-foreground ml-auto">
                  {parsedAddItems.length > 0 ? (
                    <>
                      <span className="font-medium text-foreground tabular-nums">{parsedAddItems.length}</span>{' '}
                      {addMode}{parsedAddItems.length > 1 ? 's' : ''} ready
                    </>
                  ) : (
                    <span className="text-muted-foreground/70">⌘Enter to add</span>
                  )}
                </span>
              </div>

              {/* Multi-line textarea */}
              <textarea
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    handleSubmitAdd();
                  }
                  if (e.key === 'Escape') {
                    setIsAddingElement(false);
                    setNewTitle('');
                    setNewSection('');
                  }
                }}
                rows={Math.min(8, Math.max(3, newTitle.split('\n').length))}
                placeholder={
                  addMode === 'element'
                    ? `Element title...\n\nPaste multiple lines for bulk add.\n# Section heads will group following items.`
                    : `Object name...\n\nPaste multiple lines to create multiple Objects.`
                }
                className="w-full px-3 py-2 bg-card border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20 focus:border-foreground resize-none font-mono leading-relaxed"
                autoFocus
                disabled={isLoading}
              />

              {/* Bottom row: section input + actions */}
              <div className="flex items-center gap-2">
                {addMode === 'element' && (
                  <>
                    <input
                      type="text"
                      value={newSection}
                      onChange={(e) => setNewSection(e.target.value)}
                      placeholder="Default section (optional)"
                      list="sections"
                      className="flex-1 px-3 py-1.5 bg-card border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20 focus:border-foreground"
                      disabled={isLoading}
                    />
                    <datalist id="sections">
                      {existingSections.map(s => (
                        <option key={s} value={s} />
                      ))}
                    </datalist>
                  </>
                )}
                {addMode === 'object' && <div className="flex-1" />}
                <button
                  onClick={handleSubmitAdd}
                  disabled={parsedAddItems.length === 0 || isLoading}
                  className="px-3 py-1.5 bg-foreground text-background text-sm font-medium rounded-md hover:bg-foreground/90 transition-colors disabled:opacity-50"
                >
                  {isLoading
                    ? 'Adding...'
                    : parsedAddItems.length > 1
                      ? `Add ${parsedAddItems.length}`
                      : 'Add'}
                </button>
                <button
                  onClick={() => {
                    setIsAddingElement(false);
                    setNewTitle('');
                    setNewSection('');
                  }}
                  className="px-3 py-1.5 text-muted-foreground text-sm hover:bg-card rounded-md transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Child Objects Section — only render when there are children */}
        {object.children && object.children.length > 0 && (
          <div className="mb-6">
            <div className="overflow-x-auto">
              <table className="w-full bg-card border-collapse">
                <tbody>
                  {object.children?.map((childObj, index) => {
                  const childElementCount = childObj.elements?.length || 0;
                  const childDoneCount = childObj.elements?.filter(e => e.status === 'done').length || 0;
                  const childProgress = childElementCount > 0 ? Math.round((childDoneCount / childElementCount) * 100) : 0;
                  return (
                    <tr
                      key={childObj.id}
                      className="group border-b border-border/60 hover:bg-muted/20 transition-colors cursor-pointer animate-row-in"
                      style={{ ['--row-i' as keyof React.CSSProperties]: index } as React.CSSProperties}
                      onClick={() => onNavigate({ objectId: childObj.id })}
                    >
                      <td className="px-2 py-2 text-[11px] text-muted-foreground/60 text-center">{index + 1}</td>
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-4" />
                          <span className="text-muted-foreground"><ObjectIcon size={14} /></span>
                          <span className="text-sm font-medium text-foreground truncate flex-1 min-w-0">
                            {childObj.name}
                          </span>
                          {childObj.children && childObj.children.length > 0 && (
                            <span className="text-[10px] text-muted-foreground shrink-0">
                              {childObj.children.length} sub
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="hidden md:table-cell px-3 py-2 text-xs text-muted-foreground">
                        {childElementCount} elements
                      </td>
                      <td className="hidden md:table-cell px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-muted/40 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-foreground/70 rounded-full transition-all"
                              style={{ width: `${childProgress}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-muted-foreground w-8">{childProgress}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </div>
        )}

        {/* Elements by Section */}
        {elements.length === 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full bg-card border-collapse">
              <thead>
                <tr className="border-b border-border/60">
                  <th className="w-10 px-2 py-2 text-center text-[11px] font-medium text-muted-foreground"></th>
                  <th className="min-w-[200px] px-3 py-2 text-left text-[11px] font-medium text-muted-foreground">Element</th>
                </tr>
              </thead>
              <tbody>
                <InlineAddRow
                  active={inlineAddKey === 'section:__no_section__'}
                  text={inlineAddText}
                  setText={setInlineAddText}
                  onActivate={() => { setInlineAddKey('section:__no_section__'); setInlineAddText(''); }}
                  onCancel={() => { setInlineAddKey(null); setInlineAddText(''); }}
                  onSubmit={(t) => handleInlineAddSubmit('section:__no_section__', t)}
                  placeholder="Add element... (paste multiple lines for bulk)"
                  colSpan={2}
                  isLoading={isLoading}
                />
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full bg-card border-collapse">
              {/* Column Headers - Asana style sticky header */}
              <thead className="sticky top-0 z-20 bg-card">
                <tr className="border-b border-border">
                  <th className="w-8 px-1 py-2.5 text-center text-[11px] font-medium text-muted-foreground bg-card"></th>
                  <th
                    className={`md:min-w-[280px] px-3 py-2.5 text-left text-[11px] font-medium text-muted-foreground cursor-pointer hover:bg-muted/50 transition-colors border-r border-border/40 ${selectedColumnKeys.has('0-0') ? 'bg-muted/60' : 'bg-card'}`}
                    onClick={(e) => handleColumnHeaderClick(0, 0, e)}
                  >
                    Name
                  </th>
                  {/* Built-in Columns - hidden on small screens */}
                  {builtInColumns.filter(col => col.isVisible).map((col, idx) => {
                    const colIndex = idx + 1;
                    return (
                      <th
                        key={col.id}
                        className={`hidden md:table-cell px-3 py-2.5 text-left text-[11px] font-medium text-muted-foreground cursor-pointer hover:bg-muted/50 transition-colors border-r border-border/40 ${selectedColumnKeys.has(`0-${colIndex}`) ? 'bg-muted/60' : 'bg-card'}`}
                        style={{ width: col.width }}
                        onClick={(e) => handleColumnHeaderClick(0, colIndex, e)}
                      >
                        <BuiltInColumnHeader
                          column={col}
                          onUpdate={(updates) => handleUpdateBuiltInColumn(col.id, updates)}
                          onDelete={() => handleDeleteBuiltInColumn(col.id)}
                        />
                      </th>
                    );
                  })}
                  {/* Custom Columns - hidden on small screens */}
                  {customColumns.map((col, idx) => {
                    const colIndex = builtInColumns.filter(c => c.isVisible).length + 1 + idx;
                    return (
                      <th
                        key={col.id}
                        className={`hidden md:table-cell px-3 py-2.5 text-left text-[11px] font-medium text-muted-foreground cursor-pointer hover:bg-muted/50 transition-colors border-r border-border/40 ${selectedColumnKeys.has(`0-${colIndex}`) ? 'bg-muted/60' : 'bg-card'}`}
                        style={{ width: col.width || 120 }}
                        onClick={(e) => handleColumnHeaderClick(0, colIndex, e)}
                      >
                        <ColumnHeader
                          column={col}
                          onRename={(name) => handleRenameColumn(col.id, name)}
                          onDelete={() => handleDeleteColumn(col.id)}
                          onUpdate={(updates) => handleUpdateColumn(col.id, updates)}
                          onDuplicate={() => handleDuplicateColumn(col)}
                        />
                      </th>
                    );
                  })}
                  {/* Rightmost action column — Add column (desktop) */}
                  <th className="w-10 px-1 py-2.5 text-center bg-card">
                    <button
                      onClick={() => setShowAddColumnModal(true)}
                      className="hidden md:inline-flex w-6 h-6 items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
                      title="Add column"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                      </svg>
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  let globalRowIndex = 0;
                  return elementsBySection.map(({ section, elements: sectionElements }, sectionIndex) => {
                    const sectionKey = section || '__no_section__';
                    const isCollapsed = collapsedSections.has(sectionKey);
                    return (
                  <React.Fragment key={sectionKey}>
                    {/* Section Header Row — collapsible + context menu (rename/duplicate/delete).
                         Uses the same gutter + name-cell layout as element rows so the bold
                         section title lines up exactly with the ○ status icon below it. */}
                    {section && (
                      <tr className="group">
                        <td className="w-8 px-1 pt-4 pb-1.5"></td>
                        <td colSpan={totalColumns - 1} className="pt-4 pb-1.5 px-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <button
                              type="button"
                              onClick={() => toggleSectionCollapse(sectionKey)}
                              className="w-4 h-4 flex items-center justify-center rounded hover:bg-muted transition-colors shrink-0"
                              aria-label={isCollapsed ? 'セクションを展開' : 'セクションを折りたたむ'}
                            >
                              <ChevronDown
                                size={12}
                                className={`text-muted-foreground transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                              />
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleSectionCollapse(sectionKey)}
                              className="text-base font-bold text-foreground hover:bg-muted/40 px-1 py-0.5 rounded transition-colors min-w-0 truncate text-left"
                            >
                              {section}
                              <span className="ml-1.5 text-muted-foreground/60 font-normal text-sm tabular-nums">
                                {sectionElements.length}
                              </span>
                            </button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  type="button"
                                  className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded hover:bg-muted text-muted-foreground transition-opacity shrink-0"
                                  aria-label="セクション操作"
                                >
                                  <MoreHorizontal size={12} />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="start" className="min-w-[180px]">
                                <DropdownMenuItem onClick={() => handleRenameSection(section)} className="gap-2 text-[13px]">
                                  <Pencil size={12} />
                                  セクション名を変更
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleDuplicateSection(section)} className="gap-2 text-[13px]">
                                  <Copy size={12} />
                                  セクションを複製
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => handleDeleteSection(section)} className="gap-2 text-[13px] text-destructive focus:text-destructive">
                                  <Trash2 size={12} />
                                  セクションを削除
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </td>
                      </tr>
                    )}
                    {/* Element Rows — hidden when section is collapsed */}
                    {!isCollapsed && (
                    <DndContext
                      sensors={dndSensors}
                      collisionDetection={closestCenter}
                      onDragEnd={handleElementDragEnd}
                    >
                      <SortableContext
                        items={sectionElements.map(e => e.id)}
                        strategy={verticalListSortingStrategy}
                      >
                    {sectionElements.map((element, index) => {
                      const localIndex = index;
                      const currentGlobalRowIndex = globalRowIndex++;
                      return (
                        <ElementTableRow
                          key={element.id}
                          element={element}
                          rowNumber={index + 1}
                          rowIndex={currentGlobalRowIndex}
                          isSelected={currentSelectedElement?.id === element.id}
                          isMultiSelected={selectedElementIds.has(element.id)}
                          onSelect={(event) => {
                            if (event?.shiftKey) {
                              if (lastSelectedElementIndex !== null && selectionSectionIndex === sectionIndex) {
                                const start = Math.min(lastSelectedElementIndex, localIndex);
                                const end = Math.max(lastSelectedElementIndex, localIndex);
                                const newSelection = new Set<string>();
                                for (let i = start; i <= end; i++) {
                                  if (sectionElements[i]) newSelection.add(sectionElements[i].id);
                                }
                                setSelectedElementIds(newSelection);
                              } else {
                                setSelectedElementIds(new Set([element.id]));
                                setLastSelectedElementIndex(localIndex);
                                setSelectionSectionIndex(sectionIndex);
                              }
                            } else if (event?.ctrlKey || event?.metaKey) {
                              if (selectionSectionIndex === null || selectionSectionIndex === sectionIndex) {
                                const newSelection = new Set(selectedElementIds);
                                if (newSelection.has(element.id)) {
                                  newSelection.delete(element.id);
                                } else {
                                  newSelection.add(element.id);
                                }
                                setSelectedElementIds(newSelection);
                                setLastSelectedElementIndex(localIndex);
                                setSelectionSectionIndex(sectionIndex);
                              } else {
                                setSelectedElementIds(new Set([element.id]));
                                setLastSelectedElementIndex(localIndex);
                                setSelectionSectionIndex(sectionIndex);
                              }
                            } else {
                              setSelectedElementIds(new Set());
                              setLastSelectedElementIndex(localIndex);
                              setSelectionSectionIndex(sectionIndex);
                              setSelectedElement(currentSelectedElement?.id === element.id ? null : element);
                            }
                          }}
                          onStatusChange={(status) => handleStatusChange(element.id, status)}
                          onRefresh={onRefresh}
                          allElements={elements}
                          customColumns={customColumns}
                          onColumnValueChange={handleColumnValueChange}
                          totalColumns={totalColumns}
                          builtInColumns={builtInColumns}
                          selectedCells={selectedCells}
                          onCellMouseDown={handleCellMouseDown}
                          onCellMouseEnter={handleCellMouseEnter}
                          explorerData={explorerData}
                        />
                      );
                    })}
                      </SortableContext>
                    </DndContext>
                    )}
                    {/* Inline add element row, scoped to this section. Hidden when collapsed. */}
                    {!isCollapsed && (
                    <InlineAddRow
                      active={inlineAddKey === `section:${section ?? '__no_section__'}`}
                      text={inlineAddText}
                      setText={setInlineAddText}
                      onActivate={() => {
                        setInlineAddKey(`section:${section ?? '__no_section__'}`);
                        setInlineAddText('');
                      }}
                      onCancel={() => { setInlineAddKey(null); setInlineAddText(''); }}
                      onSubmit={(t) => handleInlineAddSubmit(`section:${section ?? '__no_section__'}`, t)}
                      placeholder={section ? `Add element to ${section}...` : 'Add element... (paste multiple lines for bulk)'}
                      colSpan={totalColumns}
                      isLoading={isLoading}
                    />
                    )}
                  </React.Fragment>
                  );
                });
                })()}
              </tbody>
            </table>
          </div>
        )}
        </div>
            </div>
          </div>

          {/* Element Properties Panel - Right Sidebar */}
          {currentSelectedElement && (
            <ElementPropertiesPanel
              element={currentSelectedElement}
              onClose={() => setSelectedElement(null)}
              onOpenDetail={(elementId) => {
                setSelectedElement(null);
                setDetailElementId(elementId);
              }}
              onRefresh={onRefresh}
              allElements={elements}
              objectName={object.name}
            />
          )}
          </>
        )}

        {/* Overview Tab Content — Project Overview (Asana-style) */}
        {activeTab?.tab_type === 'overview' && (
          <div className="flex-1 overflow-auto bg-card">
            <OverviewView
              elements={allDescendantElements}
              object={object}
              explorerData={explorerData}
              onRefresh={onRefresh}
            />
          </div>
        )}

        {/* Summary/Dashboard Tab Content — uses all descendants */}
        {activeTab?.tab_type === 'summary' && (
          <div className="flex-1 overflow-auto bg-card">
            <SummaryView elements={allDescendantElements} object={object} />
          </div>
        )}

        {/* Gantt Tab Content — uses all descendants */}
        {activeTab?.tab_type === 'gantt' && (
          <div className="flex-1 overflow-hidden bg-card">
            <GanttView
              elements={allDescendantElements}
              object={object}
              onRefresh={onRefresh}
            />
          </div>
        )}

        {/* Calendar Tab Content — uses all descendants */}
        {activeTab?.tab_type === 'calendar' && (
          <div className="flex-1 overflow-hidden bg-card">
            <CalendarView
              elements={allDescendantElements}
              onElementClick={(element) => setSelectedElement(element)}
              onRefresh={onRefresh}
            />
          </div>
        )}

        {/* Workers Tab Content */}
        {activeTab?.tab_type === 'workers' && (
          <div className="flex-1 overflow-auto bg-card p-8">
            <div className="text-center text-muted-foreground">
              <p>Workers list coming soon...</p>
            </div>
          </div>
        )}

      </div>

      {/* Add Column Modal */}
      {showAddColumnModal && (
        <AddColumnModal
          onClose={() => setShowAddColumnModal(false)}
          onAdd={handleAddColumn}
          deletedBuiltInColumns={DEFAULT_BUILTIN_COLUMNS.filter(
            defaultCol => !builtInColumns.find(col => col.builtinType === defaultCol.builtinType)
          )}
          onRestoreBuiltIn={handleAddBuiltInColumn}
        />
      )}

      {/* Bulk Move — change primary Object for all selected */}
      {bulkMoveOpen && (
        <ObjectPicker
          open={bulkMoveOpen}
          onClose={() => setBulkMoveOpen(false)}
          onSelect={handleBulkMoveTo}
          title={`Move ${selectedElementIds.size} element${selectedElementIds.size === 1 ? '' : 's'}`}
          description="Choose the new primary Object. Each element's primary parent will be replaced."
          excludeIds={[object.id]}
          explorerData={explorerData}
        />
      )}

      {/* Bulk Multi-Home — register the same Elements in another Object */}
      {bulkAddOpen && (
        <ObjectPicker
          open={bulkAddOpen}
          onClose={() => setBulkAddOpen(false)}
          onSelect={handleBulkAddTo}
          title={`Add ${selectedElementIds.size} element${selectedElementIds.size === 1 ? '' : 's'} to…`}
          description="The same Elements will also belong to the chosen Object. No copies are created; edits stay synchronized."
          excludeIds={[object.id]}
          explorerData={explorerData}
        />
      )}

      {/* Bulk Delete confirmation */}
      <Dialog open={bulkDeleteConfirmOpen} onOpenChange={setBulkDeleteConfirmOpen}>
        <DialogContent className="sm:max-w-[360px] p-6" showCloseButton={false}>
          <div className="text-center">
            <DialogTitle className="text-[15px] font-semibold mb-1">
              Delete {selectedElementIds.size} element{selectedElementIds.size === 1 ? '' : 's'}?
            </DialogTitle>
            <p className="text-[13px] text-muted-foreground mb-5">This action cannot be undone.</p>
            <div className="flex flex-col gap-2">
              <Button
                onClick={handleBulkDelete}
                className="w-full bg-destructive hover:bg-destructive/90 text-white"
              >
                Delete
              </Button>
              <Button
                variant="outline"
                onClick={() => setBulkDeleteConfirmOpen(false)}
                className="w-full"
              >
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Object Report — Word-style preview in a wide modal */}
      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent className="max-w-[1080px] w-[96vw] p-0 gap-0 overflow-hidden" showCloseButton={false}>
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-card">
            <div className="flex items-center gap-2 min-w-0">
              <Sparkles size={14} className="text-foreground shrink-0" />
              <DialogTitle className="text-[14px] font-semibold truncate">
                {object.name} のレポート
              </DialogTitle>
            </div>
            <button
              onClick={() => setReportOpen(false)}
              className="p-1 rounded-md hover:bg-muted transition-colors"
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </div>
          <div className="p-4 bg-card">
            {reportLoading ? (
              <div className="flex items-center justify-center gap-2 text-muted-foreground text-[13px] py-16">
                <Loader2 size={14} className="animate-spin" />
                Claude が docx を生成中… (10〜60秒程度かかります)
              </div>
            ) : reportError ? (
              <div className="text-[13px] text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">
                {reportError}
              </div>
            ) : report ? (
              <ReportPreview signedUrl={report.signedUrl} filename={report.filename} />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}

