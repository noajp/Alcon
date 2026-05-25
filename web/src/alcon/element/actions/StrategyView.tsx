'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Layers, Box, Filter, X } from 'lucide-react';
import {
  fetchStrategyElements,
  useDomains,
  useObjects,
  type ElementWithDetails,
  type AlconObject,
  type Domain,
} from '@/hooks/useSupabase';
import { GanttView } from '@/alcon/element/gantt/GanttView';
import { ObjectIcon } from '@/shell/icons';

export function StrategyView() {
  const { data: domains, loading: domainsLoading } = useDomains();
  // Fetch every Object across all domains (we filter client-side per selection).
  const { data: explorer } = useObjects(null);

  // Selection state — defaults to all domains so first paint shows something.
  const [selectedDomainIds, setSelectedDomainIds] = useState<string[]>([]);
  const [selectedObjectIds, setSelectedObjectIds] = useState<string[]>([]);

  // Seed selection once domains arrive.
  useEffect(() => {
    if (selectedDomainIds.length === 0 && domains.length > 0) {
      setSelectedDomainIds(domains.map(d => d.id));
    }
  }, [domains, selectedDomainIds.length]);

  // Loaded data
  const [elements, setElements] = useState<ElementWithDetails[]>([]);
  const [scopedObjects, setScopedObjects] = useState<AlconObject[]>([]);
  const [loading, setLoading] = useState(false);

  // Pull elements every time selection changes
  useEffect(() => {
    let cancelled = false;
    if (selectedDomainIds.length === 0 && selectedObjectIds.length === 0) {
      setElements([]); setScopedObjects([]); return;
    }
    setLoading(true);
    fetchStrategyElements({
      domainIds: selectedDomainIds,
      objectIds: selectedObjectIds,
    })
      .then(({ elements, objects }) => {
        if (cancelled) return;
        setElements(elements);
        setScopedObjects(objects);
      })
      .catch((e) => { console.error('fetchStrategyElements failed:', e); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedDomainIds, selectedObjectIds]);

  // Stats: progress + on-time signal
  const stats = useMemo(() => {
    const total = elements.length;
    const done = elements.filter(e => e.status === 'done').length;
    const overdue = elements.filter(e => {
      if (!e.due_date || e.status === 'done') return false;
      return new Date(e.due_date) < new Date();
    }).length;
    const blocked = elements.filter(e => e.status === 'blocked').length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    return { total, done, overdue, blocked, pct };
  }, [elements]);

  // Flat list of all objects under the selected domains, for the Object picker
  const objectsInScope = useMemo(() => {
    const flat: AlconObject[] = [];
    const walk = (nodes: typeof explorer.objects) => {
      for (const n of nodes) {
        flat.push(n);
        if (n.children) walk(n.children);
      }
    };
    walk(explorer.objects);
    if (selectedDomainIds.length === 0) return flat;
    return flat.filter(o =>
      o.domain_id && selectedDomainIds.includes(o.domain_id)
    );
  }, [explorer.objects, selectedDomainIds]);

  // Auto-trim selectedObjectIds when domain selection narrows the available set
  useEffect(() => {
    const allowed = new Set(objectsInScope.map(o => o.id));
    setSelectedObjectIds(prev => prev.filter(id => allowed.has(id)));
  }, [objectsInScope]);

  // Filter is active when the user has narrowed the default "everything" scope.
  const filterActive =
    (domains.length > 0 && selectedDomainIds.length < domains.length) ||
    selectedObjectIds.length > 0;
  const [filterOpen, setFilterOpen] = useState(false);

  return (
    <div className="flex flex-col h-full">
      {/* Header — matches the List view: thin h-10 row, 12px title,
          stats + KPI pills inline, filter behind a small icon button. */}
      <div className="h-10 flex items-center gap-2 px-4 border-b border-border/60 bg-card flex-shrink-0">
        <span className="text-[12px] font-semibold text-foreground">Strategy</span>
        <span className="text-[11px] text-muted-foreground">
          {loading
            ? 'Loading…'
            : `${stats.total} · ${stats.done} done · ${stats.pct}%`}
        </span>
        <div className="flex-1" />
        <KpiPill label="Done" value={stats.done} tone="emerald" />
        <KpiPill label="Overdue" value={stats.overdue} tone={stats.overdue > 0 ? 'red' : 'neutral'} />
        <KpiPill label="Blocked" value={stats.blocked} tone={stats.blocked > 0 ? 'amber' : 'neutral'} />
        <div className="relative">
          <button
            type="button"
            onClick={() => setFilterOpen((o) => !o)}
            className={`relative inline-flex items-center justify-center w-[26px] h-[26px] rounded-md transition-colors ${
              filterActive
                ? 'text-foreground bg-muted/60'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
            }`}
            title="Filter scope"
            aria-label="Filter"
          >
            <Filter size={13} />
            {filterActive && (
              <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-orange-500" />
            )}
          </button>
          {filterOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setFilterOpen(false)}
              />
              <div className="absolute right-0 top-full mt-1 z-50 w-72 bg-popover border border-border rounded-md shadow-xl overflow-hidden">
                <div className="px-3 py-2 border-b border-border/60 flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Scope</span>
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    {selectedDomainIds.length} dom · {selectedObjectIds.length > 0
                      ? `${selectedObjectIds.length} obj`
                      : `${scopedObjects.length} in scope`}
                  </span>
                </div>
                <div className="px-2 py-2 space-y-1.5">
                  <DomainPicker
                    domains={domains}
                    loading={domainsLoading}
                    selected={selectedDomainIds}
                    onChange={setSelectedDomainIds}
                  />
                  <ObjectPicker
                    objects={objectsInScope}
                    selected={selectedObjectIds}
                    onChange={setSelectedObjectIds}
                  />
                  {selectedObjectIds.length > 0 && (
                    <button
                      onClick={() => setSelectedObjectIds([])}
                      className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground px-1 py-0.5"
                    >
                      <X size={11} /> Clear objects
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-hidden">
        {loading ? (
          <div className="h-full flex items-center justify-center text-muted-foreground text-[13px]">
            Loading strategy timeline…
          </div>
        ) : elements.length === 0 ? (
          <EmptyHint hasSelection={selectedDomainIds.length + selectedObjectIds.length > 0} />
        ) : (
          <GanttView elements={elements} />
        )}
      </div>
    </div>
  );
}

// =============================================================
// Pickers
// =============================================================
function DomainPicker({
  domains,
  loading,
  selected,
  onChange,
}: {
  domains: Domain[];
  loading: boolean;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);
  };

  const selectAll = () => onChange(domains.map(d => d.id));
  const clear = () => onChange([]);

  const label = selected.length === domains.length && domains.length > 0
    ? 'All domains'
    : selected.length === 0
      ? 'Pick domains'
      : `${selected.length} domain${selected.length === 1 ? '' : 's'}`;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-2.5 py-1 text-[12px] bg-background border border-border rounded-md hover:bg-muted/50"
      >
        <Layers size={11} className="text-muted-foreground" />
        <span className="text-foreground">{label}</span>
        <ChevronDown size={11} className="text-muted-foreground" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1 z-20 w-56 bg-popover border border-border rounded-md shadow-lg overflow-hidden">
            <div className="flex items-center justify-between px-2 py-1.5 border-b border-border">
              <button onClick={selectAll} className="text-[11px] text-muted-foreground hover:text-foreground">All</button>
              <button onClick={clear} className="text-[11px] text-muted-foreground hover:text-foreground">None</button>
            </div>
            <div className="max-h-64 overflow-auto py-1">
              {loading && <div className="px-3 py-2 text-[12px] text-muted-foreground">Loading…</div>}
              {!loading && domains.length === 0 && (
                <div className="px-3 py-2 text-[12px] text-muted-foreground">No domains</div>
              )}
              {domains.map(d => {
                const checked = selected.includes(d.id);
                return (
                  <button
                    key={d.id}
                    onClick={() => toggle(d.id)}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[12px] hover:bg-accent text-left"
                  >
                    <span className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center ${checked ? 'bg-primary border-primary' : 'border-border'}`}>
                      {checked && <span className="text-[9px] text-primary-foreground leading-none">✓</span>}
                    </span>
                    <span className="flex-1 text-foreground truncate">{d.name}</span>
                    {d.identifier && <span className="text-[10px] text-muted-foreground">{d.identifier}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ObjectPicker({
  objects,
  selected,
  onChange,
}: {
  objects: AlconObject[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return objects;
    return objects.filter(o => o.name.toLowerCase().includes(q));
  }, [objects, query]);

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);
  };

  const label = selected.length === 0
    ? 'All objects'
    : `${selected.length} object${selected.length === 1 ? '' : 's'}`;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-2.5 py-1 text-[12px] bg-background border border-border rounded-md hover:bg-muted/50"
      >
        <Box size={11} className="text-muted-foreground" />
        <span className="text-foreground">{label}</span>
        <ChevronDown size={11} className="text-muted-foreground" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => { setOpen(false); setQuery(''); }} />
          <div className="absolute left-0 top-full mt-1 z-20 w-72 bg-popover border border-border rounded-md shadow-lg overflow-hidden">
            <div className="px-2 py-1.5 border-b border-border">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search objects…"
                className="w-full px-2 py-1 text-[12px] bg-muted/30 rounded outline-none"
                autoFocus
              />
            </div>
            <div className="max-h-72 overflow-auto py-1">
              {filtered.length === 0 && (
                <div className="px-3 py-2 text-[12px] text-muted-foreground">No matches</div>
              )}
              {filtered.map(o => {
                const checked = selected.includes(o.id);
                return (
                  <button
                    key={o.id}
                    onClick={() => toggle(o.id)}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[12px] hover:bg-accent text-left"
                  >
                    <span className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center ${checked ? 'bg-primary border-primary' : 'border-border'}`}>
                      {checked && <span className="text-[9px] text-primary-foreground leading-none">✓</span>}
                    </span>
                    <ObjectIcon size={12} />
                    <span className="flex-1 text-foreground truncate">{o.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// =============================================================
// Small bits
// =============================================================
function DeltaBadge() {
  return (
    <div className="w-7 h-7 rounded-md bg-foreground/5 flex items-center justify-center">
      <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-foreground">
        <path d="M12 4 L21 20 L3 20 Z" />
      </svg>
    </div>
  );
}

function KpiPill({
  label,
  value,
  tone,
}: { label: string; value: number; tone: 'emerald' | 'red' | 'amber' | 'neutral' }) {
  const toneClass = tone === 'emerald'
    ? 'bg-emerald-500/15 text-emerald-300'
    : tone === 'red'
      ? 'bg-red-500/15 text-red-300'
      : tone === 'amber'
        ? 'bg-amber-500/15 text-amber-300'
        : 'bg-muted text-muted-foreground';
  return (
    <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] ${toneClass}`}>
      <span className="opacity-80">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </span>
  );
}

function EmptyHint({ hasSelection }: { hasSelection: boolean }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-[13px] gap-2 px-6 text-center">
      <DeltaBadge />
      <p className="max-w-md">
        {hasSelection
          ? 'No elements with dates in the selected scope. Add start/due dates on elements to see them on the timeline.'
          : 'Pick one or more domains (or objects) above to start watching strategic progress.'}
      </p>
    </div>
  );
}
