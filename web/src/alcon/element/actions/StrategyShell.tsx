'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, LayoutGrid, List, Plus, Search, Target, X } from 'lucide-react';
import {
  createStrategy,
  fetchStrategyElements,
  setStrategyObjects,
  useDomains,
  useObjects,
  useStrategies,
  type AlconObject,
  type ElementWithDetails,
  type StrategyWithObjects,
} from '@/hooks/useSupabase';
import { GanttView } from '@/alcon/element/gantt/GanttView';
import { ResourceView } from './ResourceView';
import { ObjectIcon } from '@/shell/icons';
import { STATUS } from '@/shared/designTokens';

// =============================================================
// StrategyShell — Action Space's "Strategy" entry. Mirrors the
// DomainView header pattern: a hierarchy/title row on top with
// the active Strategy as a breadcrumb-style picker, then a pill
// TabBar (Strategy / Timeline / Resource) whose right edge holds
// the view-mode (List / Grid) toggle.
// =============================================================

type TabKey = 'strategy' | 'timeline' | 'resource';
type ViewMode = 'list' | 'grid';

const ACTIVE_STRATEGY_KEY = 'strategy:activeId';
const ACTIVE_TAB_KEY = 'strategy:activeTab';
const VIEW_MODE_KEY = 'strategy:viewMode';

export function StrategyShell() {
  const { data: strategies, loading: strategiesLoading, refetch: refetchStrategies } = useStrategies();

  const [activeStrategyId, setActiveStrategyId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(ACTIVE_STRATEGY_KEY);
  });

  useEffect(() => {
    if (!activeStrategyId) return;
    // Drop a stale id pointing to a deleted Strategy. Default is "no active".
    if (!strategiesLoading && !strategies.find((s) => s.id === activeStrategyId)) {
      setActiveStrategyId(null);
    }
  }, [strategiesLoading, strategies, activeStrategyId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (activeStrategyId) window.localStorage.setItem(ACTIVE_STRATEGY_KEY, activeStrategyId);
    else window.localStorage.removeItem(ACTIVE_STRATEGY_KEY);
  }, [activeStrategyId]);

  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    if (typeof window === 'undefined') return 'strategy';
    const saved = window.localStorage.getItem(ACTIVE_TAB_KEY);
    return saved === 'timeline' || saved === 'resource' || saved === 'strategy' ? saved : 'strategy';
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(ACTIVE_TAB_KEY, activeTab);
  }, [activeTab]);

  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window === 'undefined') return 'list';
    const saved = window.localStorage.getItem(VIEW_MODE_KEY);
    return saved === 'grid' ? 'grid' : 'list';
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(VIEW_MODE_KEY, viewMode);
  }, [viewMode]);

  const activeStrategy = useMemo(
    () => strategies.find((s) => s.id === activeStrategyId) ?? null,
    [strategies, activeStrategyId],
  );

  const [newOpen, setNewOpen] = useState(false);
  const [editScopeOpen, setEditScopeOpen] = useState(false);

  return (
    <div className="flex flex-col h-full bg-card">
      {/* Row 1 — Domain-style hierarchy header. Just "Strategy" at the
          root; extends to "Strategy › [name] ▾" once a Strategy is
          drilled into. Clicking "Strategy" pops back to the list. */}
      <div className="h-10 flex items-center gap-1 pl-4 pr-2 border-b border-border/60 bg-card flex-shrink-0">
        <button
          type="button"
          onClick={() => setActiveStrategyId(null)}
          className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[12px] font-semibold transition-colors ${
            activeStrategy
              ? 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
              : 'text-foreground'
          }`}
        >
          <Target size={12} />
          Strategy
        </button>
        {activeStrategy && (
          <>
            <ChevronRight size={12} className="text-muted-foreground/50 flex-shrink-0" />
            <StrategyBreadcrumbPicker
              strategies={strategies}
              activeStrategy={activeStrategy}
              loading={strategiesLoading}
              onSelect={setActiveStrategyId}
              onCreate={() => setNewOpen(true)}
            />
          </>
        )}
        <div className="flex-1" />
        {activeStrategy && (
          <button
            type="button"
            onClick={() => setEditScopeOpen(true)}
            className="px-2 py-1 rounded-md text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
          >
            {activeStrategy.objectIds.length} object{activeStrategy.objectIds.length === 1 ? '' : 's'} · Edit scope
          </button>
        )}
      </div>

      {/* Row 2 — pill TabBar with view-mode toggle on the right */}
      <div className="flex items-center gap-1.5 px-4 py-2 border-b border-border/40 bg-card flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <TabChip
            label="Strategy"
            icon={<List size={13} />}
            active={activeTab === 'strategy'}
            onClick={() => setActiveTab('strategy')}
          />
          <TabChip
            label="Timeline"
            icon={<TimelineIcon />}
            active={activeTab === 'timeline'}
            onClick={() => setActiveTab('timeline')}
          />
          <TabChip
            label="Resource"
            icon={<ResourceIcon />}
            active={activeTab === 'resource'}
            onClick={() => setActiveTab('resource')}
          />
        </div>
        <div className="flex-1" />
        {activeTab === 'strategy' && (
          <ViewModeToggle mode={viewMode} onChange={setViewMode} />
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'strategy' && (
          <StrategyTab
            strategies={strategies}
            activeStrategy={activeStrategy}
            onSelectStrategy={setActiveStrategyId}
            onCreate={() => setNewOpen(true)}
            viewMode={viewMode}
          />
        )}
        {activeTab === 'timeline' && (
          <StrategyTimelineTab strategy={activeStrategy} />
        )}
        {activeTab === 'resource' && (
          activeStrategy ? (
            <ResourceView
              scopeOverride={{ objectIds: activeStrategy.objectIds }}
              hideHeader
            />
          ) : (
            <EmptyPrompt onCreate={() => setNewOpen(true)} />
          )
        )}
      </div>

      {newOpen && (
        <StrategyEditDialog
          mode="create"
          onClose={() => setNewOpen(false)}
          onSaved={(id) => {
            setActiveStrategyId(id);
            setNewOpen(false);
            refetchStrategies();
          }}
        />
      )}
      {editScopeOpen && activeStrategy && (
        <StrategyEditDialog
          mode="edit-scope"
          strategy={activeStrategy}
          onClose={() => setEditScopeOpen(false)}
          onSaved={() => {
            setEditScopeOpen(false);
            refetchStrategies();
          }}
        />
      )}
    </div>
  );
}

// =============================================================
// Breadcrumb-style picker — lives in the top hierarchy row
// =============================================================
function StrategyBreadcrumbPicker({
  strategies,
  activeStrategy,
  loading,
  onSelect,
  onCreate,
}: {
  strategies: StrategyWithObjects[];
  activeStrategy: StrategyWithObjects | null;
  loading: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const label = loading
    ? 'Loading…'
    : activeStrategy?.name ?? (strategies.length === 0 ? 'No Strategy yet' : 'Pick a Strategy');

  return (
    <div className="relative flex items-center">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[12px] font-semibold truncate max-w-[260px] text-foreground hover:bg-muted/40 transition-colors"
      >
        <span className="truncate">{label}</span>
        <ChevronDown size={11} className="text-muted-foreground" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1 z-50 w-72 bg-popover border border-border rounded-md shadow-xl overflow-hidden">
            <div className="max-h-64 overflow-auto py-1">
              {strategies.length === 0 && (
                <div className="px-3 py-2 text-[12px] text-muted-foreground italic">
                  No strategies yet
                </div>
              )}
              {strategies.map((s) => {
                const isActive = s.id === activeStrategy?.id;
                return (
                  <button
                    type="button"
                    key={s.id}
                    onClick={() => { onSelect(s.id); setOpen(false); }}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left hover:bg-accent ${
                      isActive ? 'bg-muted/40' : ''
                    }`}
                  >
                    <Target size={11} className="text-muted-foreground" />
                    <span className="flex-1 truncate text-foreground">{s.name}</span>
                    <span className="text-[10px] text-muted-foreground tabular-nums">{s.objectIds.length}</span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => { setOpen(false); onCreate(); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-foreground hover:bg-accent border-t border-border/60"
            >
              <Plus size={12} />
              New Strategy
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// =============================================================
// Pill / chip tab — matches shell/TabBar.tsx visual style
// =============================================================
function TabChip({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-semibold border transition-colors flex-shrink-0 ${
        active
          ? 'bg-muted text-foreground border-border'
          : 'text-muted-foreground border-border/50 hover:text-foreground hover:bg-muted/40 hover:border-border'
      }`}
    >
      <span className={active ? 'text-foreground' : 'text-muted-foreground'}>{icon}</span>
      {label}
    </button>
  );
}

function TimelineIcon() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="10" height="3" rx="1" />
      <rect x="6" y="10.5" width="14" height="3" rx="1" />
      <rect x="3" y="16" width="9" height="3" rx="1" />
    </svg>
  );
}

function ResourceIcon() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 18 L8 13 L12 16 L21 6" />
      <path d="M3 21 H21" />
    </svg>
  );
}

// =============================================================
// View-mode toggle (List ↔ Grid)
// =============================================================
function ViewModeToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  return (
    <div className="flex items-center gap-0.5 bg-muted/30 rounded-md p-0.5">
      <ViewModeButton
        label="List"
        active={mode === 'list'}
        onClick={() => onChange('list')}
        icon={<List size={12} />}
      />
      <ViewModeButton
        label="Grid"
        active={mode === 'grid'}
        onClick={() => onChange('grid')}
        icon={<LayoutGrid size={12} />}
      />
    </div>
  );
}

function ViewModeButton({
  label,
  icon,
  active,
  onClick,
}: { label: string; icon: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] transition-colors ${
        active
          ? 'bg-card text-foreground'
          : 'text-muted-foreground hover:text-foreground'
      }`}
      title={label}
    >
      {icon}
      <span className="hidden md:inline">{label}</span>
    </button>
  );
}

// =============================================================
// Strategy tab — list or grid of the active Strategy's Objects
// (or a picker grid of all Strategies when none is selected)
// =============================================================
function StrategyTab({
  strategies,
  activeStrategy,
  onSelectStrategy,
  onCreate,
  viewMode,
}: {
  strategies: StrategyWithObjects[];
  activeStrategy: StrategyWithObjects | null;
  onSelectStrategy: (id: string) => void;
  onCreate: () => void;
  viewMode: ViewMode;
}) {
  // Root view (no Strategy drilled into) → list / grid of Strategies.
  if (!activeStrategy) {
    if (strategies.length === 0) {
      return (
        <div className="h-full overflow-auto">
          <EmptyPrompt onCreate={onCreate} />
        </div>
      );
    }
    return viewMode === 'list' ? (
      <StrategyListTable strategies={strategies} onSelect={onSelectStrategy} />
    ) : (
      <div className="h-full overflow-auto p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {strategies.map((s) => (
            <StrategyCard
              key={s.id}
              strategy={s}
              onClick={() => onSelectStrategy(s.id)}
            />
          ))}
        </div>
      </div>
    );
  }

  // Drilled-in: show that Strategy's Objects.
  return <StrategyObjectsView strategy={activeStrategy} viewMode={viewMode} />;
}

// Linear Initiative-style list of all Strategies. One row per Strategy.
function StrategyListTable({
  strategies,
  onSelect,
}: {
  strategies: StrategyWithObjects[];
  onSelect: (id: string) => void;
}) {
  return (
    <div className="h-full overflow-auto">
      <div className="grid grid-cols-[1fr_120px_120px_140px] gap-3 px-6 py-2 border-b border-border/60 text-[11px] uppercase tracking-wide text-muted-foreground/70 font-medium sticky top-0 bg-card z-10">
        <span>Name</span>
        <span>Status</span>
        <span className="text-right">Objects</span>
        <span className="text-right">Updated</span>
      </div>
      {strategies.map((s) => (
        <button
          type="button"
          key={s.id}
          onClick={() => onSelect(s.id)}
          className="w-full grid grid-cols-[1fr_120px_120px_140px] gap-3 px-6 py-3 border-b border-border/30 hover:bg-muted/10 transition-colors items-center text-left"
        >
          <div className="flex items-start gap-2 min-w-0">
            <Target size={13} className="mt-0.5 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium text-foreground truncate">{s.name}</div>
              {s.description && (
                <div className="text-[11px] text-muted-foreground line-clamp-1">{s.description}</div>
              )}
            </div>
          </div>
          <div className="text-[12px]">
            <StatusDot status={s.status} />
          </div>
          <div className="text-[12px] text-muted-foreground tabular-nums text-right">
            {s.objectIds.length}
          </div>
          <div className="text-[11px] text-muted-foreground tabular-nums text-right">
            {formatRelative(s.updated_at)}
          </div>
        </button>
      ))}
    </div>
  );
}

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diffMs = Date.now() - then;
  const day = 24 * 60 * 60 * 1000;
  if (diffMs < day) return 'Today';
  if (diffMs < 2 * day) return 'Yesterday';
  if (diffMs < 7 * day) return `${Math.floor(diffMs / day)}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function StrategyCard({ strategy, onClick }: { strategy: StrategyWithObjects; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left rounded-lg border border-border/60 bg-card hover:border-border p-4 transition-colors group"
    >
      <div className="flex items-start gap-2 mb-2">
        <Target size={14} className="mt-0.5 text-muted-foreground group-hover:text-foreground" />
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-semibold text-foreground truncate">{strategy.name}</div>
          {strategy.description && (
            <div className="text-[12px] text-muted-foreground mt-0.5 line-clamp-2">
              {strategy.description}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-3">
        <span className="tabular-nums">{strategy.objectIds.length} object{strategy.objectIds.length === 1 ? '' : 's'}</span>
        <StatusDot status={strategy.status} />
      </div>
    </button>
  );
}

function StatusDot({ status }: { status: string }) {
  const map: Record<string, { color: string; label: string }> = {
    active: { color: 'bg-[var(--status-success)]', label: 'Active' },
    paused: { color: 'bg-[var(--status-warning)]', label: 'Paused' },
    completed: { color: 'bg-[var(--text-tertiary)]', label: 'Completed' },
    archived: { color: 'bg-[var(--text-disabled)]', label: 'Archived' },
  };
  const m = map[status] ?? map.active;
  return (
    <span className="flex items-center gap-1.5">
      <span className={`w-1.5 h-1.5 rounded-full ${m.color}`} />
      <span>{m.label}</span>
    </span>
  );
}

// =============================================================
// Per-Strategy Objects view: List (Linear-style) or Grid (cards)
// =============================================================
function StrategyObjectsView({
  strategy,
  viewMode,
}: {
  strategy: StrategyWithObjects;
  viewMode: ViewMode;
}) {
  const { data: explorer } = useObjects(null);
  const objectsById = useMemo(() => {
    const map = new Map<string, AlconObject>();
    const walk = (nodes: typeof explorer.objects) => {
      for (const n of nodes) {
        map.set(n.id, n);
        if (n.children) walk(n.children);
      }
    };
    walk(explorer.objects);
    return map;
  }, [explorer.objects]);

  const { data: domains } = useDomains();
  const domainNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of domains) m.set(d.id, d.name);
    return m;
  }, [domains]);

  const [elements, setElements] = useState<ElementWithDetails[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (strategy.objectIds.length === 0) { setElements([]); return; }
    setLoading(true);
    fetchStrategyElements({ domainIds: [], objectIds: strategy.objectIds })
      .then(({ elements }) => { if (!cancelled) setElements(elements); })
      .catch((e) => console.error('fetchStrategyElements failed:', e))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [strategy.objectIds]);

  const rows = useMemo(() => {
    return strategy.objectIds.map((oid) => {
      const obj = objectsById.get(oid) ?? null;
      const els = elements.filter((e) => {
        const ids = e.objectIds ?? (e.object_id ? [e.object_id] : []);
        return ids.includes(oid);
      });
      const total = els.length;
      const done = els.filter((e) => e.status === 'done').length;
      const overdue = els.filter((e) => e.due_date && e.status !== 'done' && new Date(e.due_date) < new Date()).length;
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      const nextDue = els
        .filter((e) => e.due_date && e.status !== 'done')
        .map((e) => new Date(e.due_date!))
        .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
      const statusCounts: Record<string, number> = {};
      for (const e of els) {
        const k = e.status ?? 'todo';
        statusCounts[k] = (statusCounts[k] ?? 0) + 1;
      }
      return { obj, oid, els, total, done, overdue, pct, nextDue, statusCounts };
    });
  }, [strategy.objectIds, objectsById, elements]);

  if (strategy.objectIds.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-6 gap-3">
        <Target size={28} className="text-muted-foreground/50" />
        <p className="text-[13px] text-muted-foreground max-w-md">
          This Strategy has no Objects yet. Click <span className="text-foreground font-medium">Edit scope</span> in
          the top-right to pick Objects across Domains.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      {strategy.description && (
        <div className="px-6 pt-4">
          <p className="text-[13px] text-muted-foreground max-w-3xl">{strategy.description}</p>
        </div>
      )}

      {viewMode === 'list' ? (
        <ListTable rows={rows} domainNameById={domainNameById} loading={loading} />
      ) : (
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {rows.map((r) =>
              r.obj ? (
                <ObjectInitiativeCard
                  key={r.oid}
                  object={r.obj}
                  domainName={r.obj.domain_id ? domainNameById.get(r.obj.domain_id) ?? null : null}
                  total={r.total}
                  done={r.done}
                  overdue={r.overdue}
                  pct={r.pct}
                  nextDue={r.nextDue}
                  statusCounts={r.statusCounts}
                  loading={loading}
                />
              ) : (
                <div
                  key={r.oid}
                  className="rounded-lg border border-border/40 bg-muted/10 p-4 text-[12px] text-muted-foreground"
                >
                  Object unavailable
                </div>
              ),
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================
// List view — Linear Initiative-style table
// =============================================================
function ListTable({
  rows,
  domainNameById,
  loading,
}: {
  rows: Array<{
    obj: AlconObject | null;
    oid: string;
    total: number;
    done: number;
    overdue: number;
    pct: number;
    nextDue: Date | null;
    statusCounts: Record<string, number>;
  }>;
  domainNameById: Map<string, string>;
  loading: boolean;
}) {
  return (
    <div className="w-full">
      <div className="grid grid-cols-[1fr_140px_140px_90px_110px] gap-3 px-6 py-2 border-b border-border/60 text-[11px] uppercase tracking-wide text-muted-foreground/70 font-medium sticky top-0 bg-card z-10">
        <span>Name</span>
        <span>Domain</span>
        <span>Status</span>
        <span className="text-right">Next due</span>
        <span className="text-right">Progress</span>
      </div>
      {rows.map((r) => (
        <div
          key={r.oid}
          className="grid grid-cols-[1fr_140px_140px_90px_110px] gap-3 px-6 py-3 border-b border-border/30 hover:bg-muted/10 transition-colors items-center"
        >
          <div className="flex items-start gap-2 min-w-0">
            <ObjectIcon size={13} />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium text-foreground truncate">
                {r.obj?.name ?? 'Object unavailable'}
              </div>
              {r.obj?.description && (
                <div className="text-[11px] text-muted-foreground line-clamp-1">{r.obj.description}</div>
              )}
            </div>
          </div>

          <div className="text-[12px] text-muted-foreground truncate">
            {r.obj?.domain_id ? domainNameById.get(r.obj.domain_id) ?? '—' : '—'}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {Object.entries(r.statusCounts)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 3)
              .map(([k, n]) => {
                const meta = STATUS[k as keyof typeof STATUS];
                return (
                  <span
                    key={k}
                    className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"
                    title={meta?.label ?? k}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${meta?.dot ?? 'bg-muted'}`} />
                    <span className="tabular-nums">{n}</span>
                  </span>
                );
              })}
            {Object.keys(r.statusCounts).length === 0 && (
              <span className="text-[11px] text-muted-foreground/50">—</span>
            )}
          </div>

          <div className="text-[12px] text-muted-foreground tabular-nums text-right">
            {r.nextDue
              ? r.nextDue.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
              : '—'}
          </div>

          <div className="flex items-center gap-2 justify-end">
            <div className="w-16 h-1 rounded-full bg-muted/40 overflow-hidden">
              <div
                className="h-full bg-[var(--status-success)] transition-all"
                style={{ width: `${r.pct}%` }}
              />
            </div>
            <span className="text-[11px] text-muted-foreground tabular-nums w-10 text-right">
              {loading ? '…' : `${r.done}/${r.total}`}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// =============================================================
// Grid view card
// =============================================================
function ObjectInitiativeCard({
  object,
  domainName,
  total,
  done,
  overdue,
  pct,
  nextDue,
  statusCounts,
  loading,
}: {
  object: AlconObject;
  domainName: string | null;
  total: number;
  done: number;
  overdue: number;
  pct: number;
  nextDue: Date | null;
  statusCounts: Record<string, number>;
  loading: boolean;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card p-4 hover:border-border transition-colors">
      <div className="flex items-start gap-2 mb-3">
        <ObjectIcon size={14} />
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-semibold text-foreground truncate">{object.name}</div>
          {domainName && (
            <div className="text-[11px] text-muted-foreground truncate">{domainName}</div>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground tabular-nums">{pct}%</span>
      </div>

      <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden mb-3">
        <div
          className="h-full bg-[var(--status-success)] transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        <span className="tabular-nums">
          {loading ? '…' : `${done} / ${total}`}
        </span>
        {overdue > 0 && (
          <span className="text-[var(--status-danger)] tabular-nums">{overdue} overdue</span>
        )}
        {nextDue && (
          <span className="ml-auto tabular-nums">
            Next: {nextDue.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        )}
      </div>

      {Object.keys(statusCounts).length > 0 && (
        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
          {Object.entries(statusCounts).map(([k, n]) => {
            const meta = STATUS[k as keyof typeof STATUS];
            return (
              <span
                key={k}
                className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"
              >
                <span className={`w-1.5 h-1.5 rounded-full ${meta?.dot ?? 'bg-muted'}`} />
                {meta?.label ?? k} {n}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

// =============================================================
// Timeline tab — Gantt scoped to the Strategy's Objects
// =============================================================
function StrategyTimelineTab({ strategy }: { strategy: StrategyWithObjects | null }) {
  const [elements, setElements] = useState<ElementWithDetails[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!strategy || strategy.objectIds.length === 0) { setElements([]); return; }
    setLoading(true);
    fetchStrategyElements({ domainIds: [], objectIds: strategy.objectIds })
      .then(({ elements }) => { if (!cancelled) setElements(elements); })
      .catch((e) => console.error('fetchStrategyElements failed:', e))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [strategy]);

  if (!strategy) return <EmptyPrompt />;
  if (strategy.objectIds.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-center text-[13px] text-muted-foreground px-6">
        Add Objects to this Strategy to see them on the timeline.
      </div>
    );
  }
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-[13px] text-muted-foreground">
        Loading timeline…
      </div>
    );
  }
  if (elements.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-center text-[13px] text-muted-foreground px-6 max-w-md mx-auto">
        No Elements with start / due dates in this Strategy's Objects yet. Add dates to Elements to populate the timeline.
      </div>
    );
  }
  return <GanttView elements={elements} />;
}

// =============================================================
// Empty / create prompt
// =============================================================
function EmptyPrompt({ onCreate }: { onCreate?: () => void }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-6 gap-3">
      <Target size={28} className="text-muted-foreground/50" />
      <p className="text-[13px] text-muted-foreground max-w-md">
        Create a Strategy to group Objects across Domains. Each Strategy gets its own timeline and resource view.
      </p>
      {onCreate && (
        <button
          type="button"
          onClick={onCreate}
          className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-foreground text-background text-[12px] font-medium hover:opacity-90"
        >
          <Plus size={12} />
          New Strategy
        </button>
      )}
    </div>
  );
}

// =============================================================
// Create / edit-scope dialog
// =============================================================
function StrategyEditDialog({
  mode,
  strategy,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit-scope';
  strategy?: StrategyWithObjects;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const { data: domains } = useDomains();
  const { data: explorer } = useObjects(null);
  const allObjects = useMemo(() => {
    const flat: AlconObject[] = [];
    const walk = (nodes: typeof explorer.objects) => {
      for (const n of nodes) {
        flat.push(n);
        if (n.children) walk(n.children);
      }
    };
    walk(explorer.objects);
    return flat;
  }, [explorer.objects]);

  const [name, setName] = useState(strategy?.name ?? '');
  const [description, setDescription] = useState(strategy?.description ?? '');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set(strategy?.objectIds ?? []),
  );
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);

  const toggleObject = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allObjects;
    return allObjects.filter((o) => o.name.toLowerCase().includes(q));
  }, [allObjects, query]);

  const grouped = useMemo(() => {
    const m = new Map<string, { domainName: string; objects: AlconObject[] }>();
    for (const o of filtered) {
      const did = o.domain_id ?? '__none__';
      const dname = domains.find((d) => d.id === did)?.name ?? 'No domain';
      if (!m.has(did)) m.set(did, { domainName: dname, objects: [] });
      m.get(did)!.objects.push(o);
    }
    return Array.from(m.entries());
  }, [filtered, domains]);

  const canSave = mode === 'create' ? name.trim().length > 0 : true;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    try {
      const ids = Array.from(selectedIds);
      if (mode === 'create') {
        const created = await createStrategy(
          { name: name.trim(), description: description.trim() || null },
          ids,
        );
        onSaved(created.id);
      } else if (strategy) {
        await setStrategyObjects(strategy.id, ids);
        onSaved(strategy.id);
      }
    } catch (e) {
      console.error('save Strategy failed:', e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-6" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-lg shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-10 flex items-center px-4 border-b border-border/60 flex-shrink-0">
          <span className="text-[13px] font-semibold text-foreground">
            {mode === 'create' ? 'New Strategy' : `Edit scope · ${strategy?.name ?? ''}`}
          </span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        <div className="p-4 space-y-3 overflow-auto flex-1">
          {mode === 'create' && (
            <>
              <div>
                <label className="block text-[11px] text-muted-foreground mb-1">Name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Alcon GTM 2026"
                  className="w-full bg-muted/30 rounded-md px-3 py-1.5 text-[13px] text-foreground outline-none"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-[11px] text-muted-foreground mb-1">
                  Description <span className="text-muted-foreground/60">(optional)</span>
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className="w-full bg-muted/30 rounded-md px-3 py-1.5 text-[13px] text-foreground outline-none resize-none"
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-[11px] text-muted-foreground mb-1">
              Objects <span className="text-muted-foreground/60">({selectedIds.size} selected)</span>
            </label>
            <div className="flex items-center gap-2 bg-muted/30 rounded-md px-2 py-1.5 mb-1">
              <Search size={12} className="text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search Objects across Domains…"
                className="flex-1 bg-transparent text-[13px] outline-none"
              />
            </div>
            <div className="border border-border/40 rounded-md max-h-72 overflow-auto">
              {grouped.length === 0 && (
                <div className="px-3 py-3 text-[12px] text-muted-foreground italic">
                  No Objects match
                </div>
              )}
              {grouped.map(([did, { domainName, objects }]) => (
                <div key={did}>
                  <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-muted-foreground bg-muted/20 sticky top-0">
                    {domainName}
                  </div>
                  {objects.map((o) => {
                    const checked = selectedIds.has(o.id);
                    return (
                      <button
                        type="button"
                        key={o.id}
                        onClick={() => toggleObject(o.id)}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] hover:bg-accent text-left"
                      >
                        <span
                          className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center ${
                            checked ? 'bg-primary border-primary' : 'border-border'
                          }`}
                        >
                          {checked && <span className="text-[9px] text-primary-foreground leading-none">✓</span>}
                        </span>
                        <ObjectIcon size={11} />
                        <span className="flex-1 truncate text-foreground">{o.name}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="h-12 flex items-center justify-end gap-2 px-4 border-t border-border/60 flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-md text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted/30"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave || saving}
            className="px-3 py-1.5 rounded-md text-[12px] font-medium bg-foreground text-background hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : mode === 'create' ? 'Create' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
