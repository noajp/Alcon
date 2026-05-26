'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Plus, Search, X, Target } from 'lucide-react';
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
// StrategyShell — top-level container for the new Strategy area.
// Owns the active-Strategy selection + 3 tabs (Strategy / Timeline
// / Resource). A Strategy is a cross-Domain grouping of Objects
// (Linear Initiative-style) — once selected, every tab below
// renders that Strategy's Objects in a different visualization.
// =============================================================

type TabKey = 'overview' | 'timeline' | 'resource';

const ACTIVE_STRATEGY_KEY = 'strategy:activeId';
const ACTIVE_TAB_KEY = 'strategy:activeTab';

export function StrategyShell() {
  const { data: strategies, loading: strategiesLoading, refetch: refetchStrategies } = useStrategies();

  const [activeStrategyId, setActiveStrategyId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(ACTIVE_STRATEGY_KEY);
  });

  // Auto-select the first Strategy when nothing is chosen and the list arrives.
  useEffect(() => {
    if (activeStrategyId) {
      // Drop a stale id pointing to a deleted Strategy.
      if (!strategiesLoading && !strategies.find((s) => s.id === activeStrategyId)) {
        setActiveStrategyId(null);
      }
      return;
    }
    if (!strategiesLoading && strategies.length > 0) {
      setActiveStrategyId(strategies[0].id);
    }
  }, [strategiesLoading, strategies, activeStrategyId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (activeStrategyId) window.localStorage.setItem(ACTIVE_STRATEGY_KEY, activeStrategyId);
    else window.localStorage.removeItem(ACTIVE_STRATEGY_KEY);
  }, [activeStrategyId]);

  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    if (typeof window === 'undefined') return 'overview';
    const saved = window.localStorage.getItem(ACTIVE_TAB_KEY);
    return saved === 'timeline' || saved === 'resource' || saved === 'overview' ? saved : 'overview';
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(ACTIVE_TAB_KEY, activeTab);
  }, [activeTab]);

  const activeStrategy = useMemo(
    () => strategies.find((s) => s.id === activeStrategyId) ?? null,
    [strategies, activeStrategyId],
  );

  const [newOpen, setNewOpen] = useState(false);
  const [editScopeOpen, setEditScopeOpen] = useState(false);

  return (
    <div className="flex flex-col h-full bg-card">
      {/* Header: Strategy picker + tabs */}
      <div className="h-10 flex items-stretch border-b border-border/60 flex-shrink-0">
        <StrategyPicker
          strategies={strategies}
          activeStrategy={activeStrategy}
          loading={strategiesLoading}
          onSelect={setActiveStrategyId}
          onCreate={() => setNewOpen(true)}
        />

        <div className="flex items-stretch">
          <TabButton label="Strategy" active={activeTab === 'overview'} onClick={() => setActiveTab('overview')} />
          <TabButton label="Timeline" active={activeTab === 'timeline'} onClick={() => setActiveTab('timeline')} />
          <TabButton label="Resource" active={activeTab === 'resource'} onClick={() => setActiveTab('resource')} />
        </div>

        <div className="flex-1" />

        {activeStrategy && (
          <button
            type="button"
            onClick={() => setEditScopeOpen(true)}
            className="px-3 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
          >
            {activeStrategy.objectIds.length} object{activeStrategy.objectIds.length === 1 ? '' : 's'} · Edit scope
          </button>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'overview' && (
          <StrategyOverviewTab
            strategies={strategies}
            activeStrategy={activeStrategy}
            onSelectStrategy={setActiveStrategyId}
            onCreate={() => setNewOpen(true)}
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
// Strategy picker — dropdown at top-left
// =============================================================
function StrategyPicker({
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

  return (
    <div className="relative flex items-center">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-4 h-full text-[13px] font-semibold text-foreground hover:bg-muted/30 transition-colors border-r border-border/60"
        style={{ minWidth: 200 }}
      >
        <Target size={13} className="text-muted-foreground" />
        <span className="truncate">
          {loading
            ? 'Loading…'
            : activeStrategy?.name ?? (strategies.length === 0 ? 'No Strategy yet' : 'Pick a Strategy')}
        </span>
        <ChevronDown size={11} className="text-muted-foreground" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-2 top-full mt-1 z-50 w-72 bg-popover border border-border rounded-md shadow-xl overflow-hidden">
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

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 h-full text-[12px] border-b-2 transition-colors ${
        active
          ? 'text-foreground border-foreground font-semibold'
          : 'text-muted-foreground border-transparent hover:text-foreground hover:border-border'
      }`}
    >
      {label}
    </button>
  );
}

// =============================================================
// Strategy tab — Linear Initiative-style list
// =============================================================
function StrategyOverviewTab({
  strategies,
  activeStrategy,
  onSelectStrategy,
  onCreate,
}: {
  strategies: StrategyWithObjects[];
  activeStrategy: StrategyWithObjects | null;
  onSelectStrategy: (id: string) => void;
  onCreate: () => void;
}) {
  // Two display modes:
  //  1. No Strategy selected → show grid of all Strategies
  //  2. Strategy selected → show its Objects as Initiative cards
  if (!activeStrategy) {
    return (
      <div className="h-full overflow-auto p-6">
        {strategies.length === 0 ? (
          <EmptyPrompt onCreate={onCreate} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {strategies.map((s) => (
              <StrategyCard
                key={s.id}
                strategy={s}
                onClick={() => onSelectStrategy(s.id)}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return <StrategyObjectGrid strategy={activeStrategy} onCreate={onCreate} />;
}

function StrategyCard({
  strategy,
  onClick,
}: {
  strategy: StrategyWithObjects;
  onClick: () => void;
}) {
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
// Object grid (when a Strategy is active)
// =============================================================
function StrategyObjectGrid({
  strategy,
  onCreate: _onCreate,
}: {
  strategy: StrategyWithObjects;
  onCreate: () => void;
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

  // Load Elements for the Strategy's Objects so we can compute per-Object
  // progress + due dates without N round-trips.
  const [elements, setElements] = useState<ElementWithDetails[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (strategy.objectIds.length === 0) {
      setElements([]);
      return;
    }
    setLoading(true);
    fetchStrategyElements({ domainIds: [], objectIds: strategy.objectIds })
      .then(({ elements }) => { if (!cancelled) setElements(elements); })
      .catch((e) => console.error('fetchStrategyElements failed:', e))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [strategy.objectIds]);

  const elementsByObject = useMemo(() => {
    const m = new Map<string, ElementWithDetails[]>();
    for (const el of elements) {
      const ids = el.objectIds ?? (el.object_id ? [el.object_id] : []);
      for (const oid of ids) {
        if (!m.has(oid)) m.set(oid, []);
        m.get(oid)!.push(el);
      }
    }
    return m;
  }, [elements]);

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
    <div className="h-full overflow-auto p-6">
      {strategy.description && (
        <p className="text-[13px] text-muted-foreground mb-5 max-w-2xl">{strategy.description}</p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {strategy.objectIds.map((oid) => {
          const obj = objectsById.get(oid);
          const els = elementsByObject.get(oid) ?? [];
          if (!obj) {
            return (
              <div
                key={oid}
                className="rounded-lg border border-border/40 bg-muted/10 p-4 text-[12px] text-muted-foreground"
              >
                Object unavailable
              </div>
            );
          }
          return (
            <ObjectInitiativeCard
              key={oid}
              object={obj}
              elements={els}
              domainName={obj.domain_id ? domainNameById.get(obj.domain_id) ?? null : null}
              loading={loading}
            />
          );
        })}
      </div>
    </div>
  );
}

function ObjectInitiativeCard({
  object,
  elements,
  domainName,
  loading,
}: {
  object: AlconObject;
  elements: ElementWithDetails[];
  domainName: string | null;
  loading: boolean;
}) {
  const stats = useMemo(() => {
    const total = elements.length;
    const done = elements.filter((e) => e.status === 'done').length;
    const overdue = elements.filter((e) => {
      if (!e.due_date || e.status === 'done') return false;
      return new Date(e.due_date) < new Date();
    }).length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const nextDue = elements
      .filter((e) => e.due_date && e.status !== 'done')
      .map((e) => new Date(e.due_date!))
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
    return { total, done, overdue, pct, nextDue };
  }, [elements]);

  const statusEntries = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of elements) {
      const k = e.status ?? 'todo';
      counts[k] = (counts[k] ?? 0) + 1;
    }
    return Object.entries(counts);
  }, [elements]);

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
        <span className="text-[10px] text-muted-foreground tabular-nums">{stats.pct}%</span>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden mb-3">
        <div
          className="h-full bg-[var(--status-success)] transition-all"
          style={{ width: `${stats.pct}%` }}
        />
      </div>

      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        <span className="tabular-nums">
          {loading ? '…' : `${stats.done} / ${stats.total}`}
        </span>
        {stats.overdue > 0 && (
          <span className="text-[var(--status-danger)] tabular-nums">{stats.overdue} overdue</span>
        )}
        {stats.nextDue && (
          <span className="ml-auto tabular-nums">
            Next: {stats.nextDue.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        )}
      </div>

      {/* Status breakdown */}
      {statusEntries.length > 0 && (
        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
          {statusEntries.map(([k, n]) => {
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
// Timeline tab — Gantt of the Strategy's Elements
// =============================================================
function StrategyTimelineTab({ strategy }: { strategy: StrategyWithObjects | null }) {
  const [elements, setElements] = useState<ElementWithDetails[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!strategy || strategy.objectIds.length === 0) {
      setElements([]);
      return;
    }
    setLoading(true);
    fetchStrategyElements({ domainIds: [], objectIds: strategy.objectIds })
      .then(({ elements }) => { if (!cancelled) setElements(elements); })
      .catch((e) => console.error('fetchStrategyElements failed:', e))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [strategy]);

  if (!strategy) {
    return <EmptyPrompt />;
  }
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
// Empty prompt
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

  // Group filtered Objects by Domain so cross-Domain selection is obvious.
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
