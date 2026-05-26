'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Layers,
  Box,
  Plus,
  Trash2,
  X,
  Link2,
  Sparkles,
} from 'lucide-react';
import {
  fetchStrategyElements,
  useDomains,
  useObjects,
  type ElementWithDetails,
  type AlconObject,
  type Domain,
} from '@/hooks/useSupabase';
import { useStrategies } from '@/hooks/useStrategies';
import type { Strategy } from '@/types/database';
import { GanttView } from '@/alcon/element/gantt/GanttView';
import { ObjectIcon } from '@/shell/icons';

// ============================================
// StrategyView — DAG-aware aggregation view.
//
// Left rail: tree of Strategies. Roots at top; each Strategy expands
// to its children (DAG: the same child can appear under multiple
// parents, which is intentional and rendered as-is).
//
// Main: current Strategy's name + scope editor + Gantt of the
// aggregated Elements (union of all descendants' Domain/Object
// inclusions, fetched via fetchStrategyElements once per selection).
// ============================================

const CURRENT_STRATEGY_KEY = 'strategy:currentId';

export function StrategyView() {
  const {
    strategies,
    roots,
    childrenByParent,
    loading: stratLoading,
    createStrategy,
    updateStrategy,
    deleteStrategy,
    addChild,
    removeChild,
    wouldCreateCycle,
    getEffectiveScope,
  } = useStrategies();
  const { data: domains, loading: domainsLoading } = useDomains();
  const { data: explorer } = useObjects(null);

  // -------- Current strategy (localStorage-backed) --------
  const [currentId, setCurrentId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(CURRENT_STRATEGY_KEY);
  });
  useEffect(() => {
    if (currentId && typeof window !== 'undefined') {
      window.localStorage.setItem(CURRENT_STRATEGY_KEY, currentId);
    }
  }, [currentId]);
  // Auto-pick the first root when nothing is selected (or the saved id was deleted).
  useEffect(() => {
    if (currentId && strategies.some((s) => s.id === currentId)) return;
    if (roots.length > 0) setCurrentId(roots[0].id);
    else setCurrentId(null);
  }, [currentId, strategies, roots]);

  const current = useMemo(
    () => strategies.find((s) => s.id === currentId) ?? null,
    [strategies, currentId],
  );

  // -------- Effective scope + elements --------
  const effective = useMemo(
    () => (current ? getEffectiveScope(current.id) : { domain_ids: [], object_ids: [] }),
    [current, getEffectiveScope],
  );
  const [elements, setElements] = useState<ElementWithDetails[]>([]);
  const [elementsLoading, setElementsLoading] = useState(false);
  useEffect(() => {
    if (!current) {
      setElements([]);
      return;
    }
    if (effective.domain_ids.length === 0 && effective.object_ids.length === 0) {
      setElements([]);
      return;
    }
    let cancelled = false;
    setElementsLoading(true);
    fetchStrategyElements({
      domainIds: effective.domain_ids,
      objectIds: effective.object_ids,
    })
      .then(({ elements }) => {
        if (!cancelled) setElements(elements);
      })
      .catch((e) => console.error('fetchStrategyElements failed', e))
      .finally(() => {
        if (!cancelled) setElementsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [current?.id, effective.domain_ids.join(','), effective.object_ids.join(','), current]);

  const stats = useMemo(() => {
    const total = elements.length;
    const done = elements.filter((e) => e.status === 'done').length;
    const overdue = elements.filter((e) => {
      if (!e.due_date || e.status === 'done') return false;
      return new Date(e.due_date) < new Date();
    }).length;
    const blocked = elements.filter((e) => e.status === 'blocked').length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    return { total, done, overdue, blocked, pct };
  }, [elements]);

  // -------- Mutations driven from the header --------
  const handleCreateRoot = async () => {
    const name = window.prompt('新しい Strategy 名', 'New Strategy');
    if (!name?.trim()) return;
    const s = await createStrategy({ name: name.trim() });
    if (s) setCurrentId(s.id);
  };
  const handleCreateChild = async () => {
    if (!current) return;
    const name = window.prompt('子 Strategy 名', 'Sub Strategy');
    if (!name?.trim()) return;
    const s = await createStrategy(
      { name: name.trim() },
      { parentStrategyId: current.id },
    );
    if (s) setCurrentId(s.id);
  };
  const handleLinkChild = async (childId: string) => {
    if (!current) return;
    const res = await addChild(current.id, childId);
    if (!res.ok && res.reason === 'cycle') {
      window.alert('それは循環するので link できません。');
    }
  };
  const handleRemove = async () => {
    if (!current) return;
    if (!window.confirm(`"${current.name}" を削除しますか? (子の link は外れます)`)) return;
    await deleteStrategy(current.id);
    setCurrentId(null);
  };
  const handleRename = async () => {
    if (!current) return;
    const next = window.prompt('Strategy 名を変更', current.name);
    if (next === null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === current.name) return;
    await updateStrategy(current.id, { name: trimmed });
  };

  const setScope = async (patch: { domain_ids?: string[]; object_ids?: string[] }) => {
    if (!current) return;
    await updateStrategy(current.id, {
      scope: { ...current.scope, ...patch },
    });
  };

  // Flat object list for the Object picker (only Objects in selected domains).
  const objectsInScope = useMemo<AlconObject[]>(() => {
    const directDomains = current?.scope.domain_ids ?? [];
    const flat: AlconObject[] = [];
    for (const o of explorer.objects) flat.push(o);
    if (directDomains.length === 0) return flat;
    return flat.filter((o) => o.domain_id && directDomains.includes(o.domain_id));
  }, [explorer.objects, current?.scope.domain_ids]);

  return (
    <div className="flex h-full">
      {/* ===== Left rail: Strategy tree ===== */}
      <aside className="w-[260px] shrink-0 flex flex-col border-r border-border/60 bg-card min-h-0">
        <div className="h-10 flex items-center gap-2 px-3 border-b border-border/60 flex-shrink-0">
          <Sparkles size={13} className="text-muted-foreground" />
          <span className="text-[12px] font-semibold text-foreground">Strategy</span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={handleCreateRoot}
            className="inline-flex items-center justify-center w-6 h-6 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md"
            title="新しい Strategy"
            aria-label="新しい Strategy"
          >
            <Plus size={14} />
          </button>
        </div>
        <div className="flex-1 overflow-auto py-1">
          {stratLoading && (
            <div className="px-3 py-2 text-[11px] text-muted-foreground">Loading…</div>
          )}
          {!stratLoading && roots.length === 0 && (
            <div className="px-3 py-4 text-[11px] text-muted-foreground/70 text-center">
              まだ Strategy がありません。<br />「+」で作成。
            </div>
          )}
          {roots.map((s) => (
            <StrategyNode
              key={s.id}
              strategy={s}
              depth={0}
              strategies={strategies}
              childrenByParent={childrenByParent}
              currentId={currentId}
              onSelect={setCurrentId}
            />
          ))}
        </div>
      </aside>

      {/* ===== Main pane ===== */}
      {!current ? (
        <div className="flex-1 flex items-center justify-center text-center text-[12px] text-muted-foreground">
          <p>
            左から Strategy を選ぶか、<br />
            「+」で新しい Strategy を作成してください。
          </p>
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0">
          {/* Header */}
          <div className="h-10 flex items-center gap-2 px-4 border-b border-border/60 bg-card flex-shrink-0">
            <button
              type="button"
              onClick={handleRename}
              className="text-[12px] font-semibold text-foreground hover:underline truncate max-w-[280px]"
              title="名前を変更"
            >
              {current.name}
            </button>
            <span className="text-[11px] text-muted-foreground">
              {elementsLoading
                ? 'Loading…'
                : `${stats.total} · ${stats.done} done · ${stats.pct}%`}
            </span>
            <div className="flex-1" />
            <KpiPill label="Done" value={stats.done} tone="emerald" />
            <KpiPill label="Overdue" value={stats.overdue} tone={stats.overdue > 0 ? 'red' : 'neutral'} />
            <KpiPill label="Blocked" value={stats.blocked} tone={stats.blocked > 0 ? 'amber' : 'neutral'} />
            <button
              type="button"
              onClick={handleRemove}
              className="inline-flex items-center justify-center w-[26px] h-[26px] rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              title="Strategy を削除"
              aria-label="Delete"
            >
              <Trash2 size={13} />
            </button>
          </div>

          {/* Scope + child management bar */}
          <div className="flex items-center gap-2 px-4 py-2 border-b border-border/60 bg-card/30 flex-shrink-0">
            <DomainPicker
              domains={domains}
              loading={domainsLoading}
              selected={current.scope.domain_ids ?? []}
              onChange={(ids) => setScope({ domain_ids: ids })}
            />
            <ObjectPicker
              objects={objectsInScope}
              selected={current.scope.object_ids ?? []}
              onChange={(ids) => setScope({ object_ids: ids })}
            />
            <ChildStrategyPicker
              strategies={strategies}
              currentId={current.id}
              currentChildren={childrenByParent.get(current.id) ?? []}
              wouldCreateCycle={wouldCreateCycle}
              onLink={handleLinkChild}
              onCreate={handleCreateChild}
              onUnlink={(childId) => removeChild(current.id, childId)}
            />
            <div className="ml-auto text-[11px] text-muted-foreground tabular-nums">
              {effective.domain_ids.length} dom · {effective.object_ids.length} obj
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-hidden">
            {elementsLoading ? (
              <div className="h-full flex items-center justify-center text-[12px] text-muted-foreground">
                Loading timeline…
              </div>
            ) : elements.length === 0 ? (
              <div className="h-full flex items-center justify-center text-center text-[12px] text-muted-foreground px-6">
                <p>
                  この Strategy には Element がまだありません。<br />
                  Scope に Domain / Object を追加するか、子 Strategy を link してください。
                </p>
              </div>
            ) : (
              <GanttView elements={elements} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================
// Strategy tree node (recursive)
// =============================================================
function StrategyNode({
  strategy,
  depth,
  strategies,
  childrenByParent,
  currentId,
  onSelect,
}: {
  strategy: Strategy;
  depth: number;
  strategies: Strategy[];
  childrenByParent: Map<string, string[]>;
  currentId: string | null;
  onSelect: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const childIds = childrenByParent.get(strategy.id) ?? [];
  const isActive = strategy.id === currentId;
  const childStrategies = childIds
    .map((id) => strategies.find((s) => s.id === id))
    .filter((s): s is Strategy => !!s);

  return (
    <div>
      <div
        className={`group flex items-center h-7 ${
          isActive ? 'bg-accent' : 'hover:bg-muted/40'
        }`}
        style={{ paddingLeft: `${4 + depth * 12}px` }}
      >
        <button
          type="button"
          onClick={() => childIds.length > 0 && setExpanded((v) => !v)}
          className={`w-4 h-4 flex items-center justify-center shrink-0 text-muted-foreground ${
            childIds.length === 0 ? 'invisible' : ''
          }`}
        >
          {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </button>
        <button
          type="button"
          onClick={() => onSelect(strategy.id)}
          className="flex-1 min-w-0 text-left text-[12px] truncate text-foreground/85 py-0.5"
        >
          {strategy.name}
        </button>
      </div>
      {expanded &&
        childStrategies.map((child) => (
          <StrategyNode
            key={`${strategy.id}>${child.id}`}
            strategy={child}
            depth={depth + 1}
            strategies={strategies}
            childrenByParent={childrenByParent}
            currentId={currentId}
            onSelect={onSelect}
          />
        ))}
    </div>
  );
}

// =============================================================
// Pickers — Domain / Object multi-select + Child Strategy picker.
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
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const label =
    selected.length === 0
      ? 'Domains'
      : selected.length === domains.length
        ? 'All domains'
        : `${selected.length} domain${selected.length === 1 ? '' : 's'}`;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
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
              <button
                onClick={() => onChange(domains.map((d) => d.id))}
                className="text-[11px] text-muted-foreground hover:text-foreground"
              >
                All
              </button>
              <button
                onClick={() => onChange([])}
                className="text-[11px] text-muted-foreground hover:text-foreground"
              >
                None
              </button>
            </div>
            <div className="max-h-64 overflow-auto py-1">
              {loading && <div className="px-3 py-2 text-[12px] text-muted-foreground">Loading…</div>}
              {!loading && domains.length === 0 && (
                <div className="px-3 py-2 text-[12px] text-muted-foreground">No domains</div>
              )}
              {domains.map((d) => {
                const checked = selected.includes(d.id);
                return (
                  <button
                    key={d.id}
                    onClick={() => toggle(d.id)}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[12px] hover:bg-accent text-left"
                  >
                    <span
                      className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center ${
                        checked ? 'bg-primary border-primary' : 'border-border'
                      }`}
                    >
                      {checked && <span className="text-[9px] text-primary-foreground leading-none">✓</span>}
                    </span>
                    <span className="flex-1 text-foreground truncate">{d.name}</span>
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
    return objects.filter((o) => o.name.toLowerCase().includes(q));
  }, [objects, query]);
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const label =
    selected.length === 0
      ? 'Objects'
      : `${selected.length} object${selected.length === 1 ? '' : 's'}`;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
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
                placeholder="Object 検索…"
                className="w-full px-2 py-1 text-[12px] bg-muted/30 rounded outline-none"
                autoFocus
              />
            </div>
            <div className="max-h-72 overflow-auto py-1">
              {filtered.length === 0 && (
                <div className="px-3 py-2 text-[12px] text-muted-foreground">No matches</div>
              )}
              {filtered.map((o) => {
                const checked = selected.includes(o.id);
                return (
                  <button
                    key={o.id}
                    onClick={() => toggle(o.id)}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[12px] hover:bg-accent text-left"
                  >
                    <span
                      className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center ${
                        checked ? 'bg-primary border-primary' : 'border-border'
                      }`}
                    >
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

function ChildStrategyPicker({
  strategies,
  currentId,
  currentChildren,
  wouldCreateCycle,
  onLink,
  onCreate,
  onUnlink,
}: {
  strategies: Strategy[];
  currentId: string;
  currentChildren: string[];
  wouldCreateCycle: (parent: string, child: string) => boolean;
  onLink: (childId: string) => void;
  onCreate: () => void;
  onUnlink: (childId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const childSet = new Set(currentChildren);
  const linkable = strategies.filter(
    (s) =>
      s.id !== currentId &&
      !childSet.has(s.id) &&
      !wouldCreateCycle(currentId, s.id),
  );
  const linked = strategies.filter((s) => childSet.has(s.id));

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-2.5 py-1 text-[12px] bg-background border border-border rounded-md hover:bg-muted/50"
      >
        <Link2 size={11} className="text-muted-foreground" />
        <span className="text-foreground">
          {linked.length === 0 ? 'Children' : `${linked.length} child${linked.length === 1 ? '' : 'ren'}`}
        </span>
        <ChevronDown size={11} className="text-muted-foreground" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1 z-20 w-72 bg-popover border border-border rounded-md shadow-lg overflow-hidden">
            <div className="px-2 py-1.5 border-b border-border flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Children</span>
              <button
                onClick={() => { onCreate(); setOpen(false); }}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <Plus size={11} /> 新規
              </button>
            </div>
            {linked.length > 0 && (
              <div className="py-1 border-b border-border/60">
                {linked.map((s) => (
                  <div
                    key={s.id}
                    className="group flex items-center gap-2 px-2.5 py-1.5 text-[12px] hover:bg-accent"
                  >
                    <Sparkles size={11} className="text-muted-foreground" />
                    <span className="flex-1 text-foreground truncate">{s.name}</span>
                    <button
                      onClick={() => onUnlink(s.id)}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                      title="link を解除"
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="max-h-56 overflow-auto py-1">
              {linkable.length === 0 ? (
                <div className="px-3 py-2 text-[11px] text-muted-foreground/70">
                  link できる Strategy がありません
                </div>
              ) : (
                linkable.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => { onLink(s.id); setOpen(false); }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[12px] hover:bg-accent text-left"
                  >
                    <Plus size={11} className="text-muted-foreground" />
                    <span className="flex-1 text-foreground truncate">{s.name}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// =============================================================
// Tiny bits
// =============================================================
function KpiPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'emerald' | 'red' | 'amber' | 'neutral';
}) {
  const toneClass =
    tone === 'emerald'
      ? 'bg-emerald-500/15 text-emerald-300'
      : tone === 'red'
        ? 'bg-red-500/15 text-red-300'
        : tone === 'amber'
          ? 'bg-amber-500/15 text-amber-300'
          : 'bg-muted text-muted-foreground';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] ${toneClass}`}>
      <span className="opacity-80">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </span>
  );
}
