'use client';

import React, { useState, useEffect, useRef } from 'react';
import type { AlconObjectWithChildren, ElementWithDetails, ExplorerData } from '@/hooks/useSupabase';
import { moveObject } from '@/hooks/useSupabase';
import type { NavigationState } from '@/types/navigation';
import { ObjectIcon } from '@/components/icons';
import { ChevronRight, ChevronLeft, ChevronDown, Plus, Trash2, Check, GripVertical } from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel, DropdownMenuCheckboxItem } from '@/ui/dropdown-menu';
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { ObjectTreeItem, ChildObjectsTable, collectAllObjects, collectAllElements } from '@/alcon/object/ObjectsView';

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

import { useSystems, getActiveSystemId, setActiveSystemId } from './systemsStore';

// Shared hook: active System state synced via localStorage + storage event
function useActiveSystem() {
  const SYSTEMS = useSystems();
  const [activeId, setActiveId] = useState<string>(() => getActiveSystemId() ?? SYSTEMS[0]?.id ?? '');

  useEffect(() => {
    const saved = getActiveSystemId();
    if (saved && SYSTEMS.some((s) => s.id === saved)) setActiveId(saved);
    else if (SYSTEMS[0]) setActiveId(SYSTEMS[0].id);

    const handleCustom = (e: Event) => {
      const ce = e as CustomEvent<string>;
      if (ce.detail) setActiveId(ce.detail);
    };
    window.addEventListener('alcon:active-system-change', handleCustom as EventListener);
    return () => {
      window.removeEventListener('alcon:active-system-change', handleCustom as EventListener);
    };
  }, [SYSTEMS]);

  const setActive = (id: string) => {
    setActiveId(id);
    setActiveSystemId(id);
  };

  const active = SYSTEMS.find((s) => s.id === activeId) ?? SYSTEMS[0];
  return { active, setActive, systems: SYSTEMS };
}

export function SystemHeader() {
  const [open, setOpen] = useState(false);
  const { active, setActive, systems: SYSTEMS } = useActiveSystem();
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
        <span className="text-[12px] font-medium text-foreground truncate flex-1 text-left">{active?.name ?? ''}</span>
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
                {sys.id === active?.id && <Check size={12} className="text-foreground shrink-0" />}
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
export function SystemsView({
  explorerData,
  onOpen,
}: {
  explorerData: ExplorerData;
  onOpen: (systemId: string) => void;
}) {
  const { active, setActive, systems: SYSTEMS } = useActiveSystem();
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
            const isActive = sys.id === active?.id;
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
// ============================================


