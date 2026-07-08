'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Plus, Search, X } from 'lucide-react';
import { NavStrategyIcon } from '@/shell/sidebar/NavIcons';
import {
  addDomainObjectType,
  createObject,
  createStrategy,
  fetchAllWorkers,
  setStrategyObjects,
  updateObject,
  updateStrategy,
  useDomains,
  useObjects,
  useStrategies,
  type AlconObject,
  type AlconObjectWithChildren,
  type StrategyWithObjects,
  type Worker,
} from '@/hooks/useSupabase';
import { ObjectIcon } from '@/shell/icons';
import { SegmentedProgress } from '@/alcon/shared/SegmentedProgress';
import { DueDateCell, LeadCell, TypeCell } from '@/alcon/object/ListTable';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';

// =============================================================
// StrategyShell — the Materialization layer's "Strategy" app. A single
// header row (title + create button) over the portfolio Strategy list;
// selecting a row pushes into that Strategy's detail page (title,
// description, Object scope — no Properties rail, mirrors ElementDetailView
// minus the side rail).
// =============================================================

export function StrategyShell() {
  const { data: strategies, loading, refetch: refetchStrategies } = useStrategies();

  const [newOpen, setNewOpen] = useState(false);
  const [openStrategyId, setOpenStrategyId] = useState<string | null>(null);
  const openStrategy = useMemo(
    () => strategies.find((s) => s.id === openStrategyId) ?? null,
    [strategies, openStrategyId],
  );

  if (openStrategy) {
    return (
      <StrategyDetailView
        strategy={openStrategy}
        onBack={() => setOpenStrategyId(null)}
        onSaved={() => refetchStrategies()}
      />
    );
  }

  return (
    <div className="flex flex-col h-full bg-card">
      <div className="h-[50px] flex items-center gap-1.5 pl-4 pr-2 border-b border-border/60 bg-card flex-shrink-0">
        <NavStrategyIcon size={12} />
        <span className="text-[12px] font-semibold text-foreground">Strategy</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setNewOpen(true)}
          title="Add Strategy"
          aria-label="Add Strategy"
          className="inline-flex items-center justify-center w-6 h-6 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-hidden">
        {loading ? null : strategies.length === 0 ? (
          <EmptyPrompt onCreate={() => setNewOpen(true)} />
        ) : (
          <StrategyListView
            strategies={strategies}
            onSelectStrategy={(s) => setOpenStrategyId(s.id)}
          />
        )}
      </div>

      {newOpen && (
        <StrategyCreateDialog
          onClose={() => setNewOpen(false)}
          onCreated={(id) => {
            setNewOpen(false);
            refetchStrategies();
            setOpenStrategyId(id);
          }}
        />
      )}
    </div>
  );
}

// =============================================================
// Empty / create prompt
// =============================================================
function EmptyPrompt({ onCreate }: { onCreate?: () => void }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-6 gap-3">
      <NavStrategyIcon size={28} className="text-muted-foreground/50" />
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
// Portfolio Strategy list — the entire Strategy root view. Selecting a
// row pushes into that Strategy's detail page.
// =============================================================
function StrategyListView({
  strategies,
  onSelectStrategy,
}: {
  strategies: StrategyWithObjects[];
  onSelectStrategy: (strategy: StrategyWithObjects) => void;
}) {
  return (
    <div className="h-full overflow-auto px-2 pb-2 pt-2">
      <div className="grid grid-cols-[1fr_120px] gap-3 px-4 py-2 text-[11px] tracking-wide text-muted-foreground/70 font-medium sticky top-0 bg-card z-10">
        <span>Name</span>
        <span className="text-right">Objects</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {strategies.map((s) => (
          <button
            type="button"
            key={s.id}
            onClick={() => onSelectStrategy(s)}
            className="w-full grid grid-cols-[1fr_120px] gap-3 px-4 py-3.5 min-h-[3.25rem] bg-transparent hover:bg-muted/30 border border-border rounded-lg transition-colors items-center text-left"
          >
            <div className="flex items-center gap-2 min-w-0">
              <NavStrategyIcon size={13} className="text-muted-foreground" />
              <span className="text-[13px] font-semibold text-foreground/95 truncate">{s.name}</span>
            </div>
            <span className="text-[12px] text-muted-foreground tabular-nums text-right">
              {s.objectIds.length}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// Auto-grow a textarea to fit its content, mirroring the seamless
// title/description textareas on the Object Overview / Element detail tabs.
function useAutoGrowTextarea(ref: { current: HTMLTextAreaElement | null }, value: string) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [ref, value]);
}

// Strategy Framework — local-only for now (no `strategies` column yet), one
// slot per Strategy: 'none' or 'gap' (Gap Analysis, the only implemented
// framework so far) with its own free-text Goal / Gap / Current State fields.
interface StrategyFrameworkState {
  type: 'none' | 'gap';
  goal: string;
  gap: string;
  current: string;
}
const EMPTY_FRAMEWORK: StrategyFrameworkState = { type: 'none', goal: '', gap: '', current: '' };
const FRAMEWORK_LS_PREFIX = 'alcon:strategy-framework:';

function loadStrategyFramework(strategyId: string): StrategyFrameworkState {
  if (typeof window === 'undefined') return EMPTY_FRAMEWORK;
  try {
    const raw = window.localStorage.getItem(FRAMEWORK_LS_PREFIX + strategyId);
    if (!raw) return EMPTY_FRAMEWORK;
    return { ...EMPTY_FRAMEWORK, ...JSON.parse(raw) };
  } catch {
    return EMPTY_FRAMEWORK;
  }
}

function saveStrategyFramework(strategyId: string, state: StrategyFrameworkState) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(FRAMEWORK_LS_PREFIX + strategyId, JSON.stringify(state));
}

// Flatten the Object explorer tree — shared between the create dialog, the
// detail view's Object-scope picker, and the selected-Objects chip row.
function useAllObjects(): { objects: AlconObjectWithChildren[]; refetch: () => Promise<void> } {
  const { data: explorer, refetch } = useObjects(null);

  const objects = useMemo(() => {
    const flat: AlconObjectWithChildren[] = [];
    const walk = (nodes: typeof explorer.objects) => {
      for (const n of nodes) {
        flat.push(n);
        if (n.children) walk(n.children);
      }
    };
    walk(explorer.objects);
    return flat;
  }, [explorer.objects]);

  return { objects, refetch };
}

// Group the flat Object list by Domain — shared between the create dialog
// and the detail view's Object-scope picker.
function useObjectPicker(query: string) {
  const { data: domains } = useDomains();
  const { objects: allObjects } = useAllObjects();

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

  return grouped;
}

function ObjectPickerList({
  grouped,
  selectedIds,
  onToggle,
}: {
  grouped: Array<[string, { domainName: string; objects: AlconObject[] }]>;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <>
      {grouped.length === 0 && (
        <div className="px-3 py-3 text-[12px] text-muted-foreground italic">
          No Objects match
        </div>
      )}
      {grouped.map(([did, { domainName, objects }]) => (
        <div key={did}>
          <div className="px-3 py-1 text-[10px] tracking-wide text-muted-foreground bg-muted/20 sticky top-0">
            {domainName}
          </div>
          {objects.map((o) => {
            const checked = selectedIds.has(o.id);
            return (
              <button
                type="button"
                key={o.id}
                onClick={() => onToggle(o.id)}
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
    </>
  );
}

// =============================================================
// Strategy detail page — full-width title/description/Object-scope
// editor. Mirrors ElementDetailView's header + seamless title/description
// pattern, but with no Properties rail.
// =============================================================
function StrategyDetailView({
  strategy,
  onBack,
  onSaved,
}: {
  strategy: StrategyWithObjects;
  onBack: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(strategy.name);
  const [description, setDescription] = useState(strategy.description ?? '');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(strategy.objectIds));
  const [query, setQuery] = useState('');
  // Objects section starts collapsed to the selected chips — "+" reveals
  // either the cross-Domain search picker or a quick inline create form.
  const [pickerMode, setPickerMode] = useState<'closed' | 'search' | 'create'>('closed');
  const [newObjectName, setNewObjectName] = useState('');
  const [newObjectDomainId, setNewObjectDomainId] = useState<string | null>(null);
  const [creatingObject, setCreatingObject] = useState(false);
  const [framework, setFramework] = useState<StrategyFrameworkState>(() => loadStrategyFramework(strategy.id));

  // Re-sync local edit state when switching to a different Strategy.
  useEffect(() => {
    setName(strategy.name);
    setDescription(strategy.description ?? '');
    setSelectedIds(new Set(strategy.objectIds));
    setFramework(loadStrategyFramework(strategy.id));
  }, [strategy.id, strategy.name, strategy.description, strategy.objectIds]);

  // Only collapse the Objects picker on an actual Strategy switch — not on
  // every objectIds refetch triggered by toggling a selection.
  useEffect(() => {
    setPickerMode('closed');
  }, [strategy.id]);

  const nameRef = useRef<HTMLTextAreaElement | null>(null);
  const descriptionRef = useRef<HTMLTextAreaElement | null>(null);
  const gapGoalRef = useRef<HTMLTextAreaElement | null>(null);
  const gapGapRef = useRef<HTMLTextAreaElement | null>(null);
  const gapCurrentRef = useRef<HTMLTextAreaElement | null>(null);
  useAutoGrowTextarea(nameRef, name);
  useAutoGrowTextarea(descriptionRef, description);
  useAutoGrowTextarea(gapGoalRef, framework.goal);
  useAutoGrowTextarea(gapGapRef, framework.gap);
  useAutoGrowTextarea(gapCurrentRef, framework.current);

  const selectFramework = (type: StrategyFrameworkState['type']) => {
    setFramework((prev) => {
      const next = { ...prev, type };
      saveStrategyFramework(strategy.id, next);
      return next;
    });
  };

  const updateFrameworkField = (field: 'goal' | 'gap' | 'current', value: string) => {
    setFramework((prev) => ({ ...prev, [field]: value }));
  };

  const saveFrameworkField = () => {
    saveStrategyFramework(strategy.id, framework);
  };

  const { data: domains, refetch: refetchDomains } = useDomains();
  const { objects: allObjects, refetch: refetchObjects } = useAllObjects();
  const grouped = useObjectPicker(query);

  // Lead picker options — every Worker in the Space, not scoped to one
  // Domain, since a Strategy's Objects can span several.
  const [workers, setWorkers] = useState<Worker[]>([]);
  useEffect(() => {
    fetchAllWorkers().then(setWorkers).catch((e) => console.error('Failed to load workers', e));
  }, []);

  const handleObjectUpdate = async (
    objectId: string,
    updates: { type?: string | null; due_date?: string | null; lead_id?: string | null },
  ) => {
    try {
      await updateObject(objectId, updates);
      await refetchObjects();
    } catch (e) {
      console.error('Failed to update Object:', e);
    }
  };

  const handleAddType = async (domainId: string, typeName: string) => {
    try {
      await addDomainObjectType(domainId, typeName);
      await refetchDomains();
    } catch (e) {
      console.error('Failed to add Object type:', e);
    }
  };

  const saveName = async () => {
    const trimmed = name.trim() || strategy.name;
    if (trimmed === strategy.name) return;
    await updateStrategy(strategy.id, { name: trimmed });
    onSaved();
  };

  const saveDescription = async () => {
    const trimmed = description.trim() || null;
    if (trimmed === (strategy.description ?? null)) return;
    await updateStrategy(strategy.id, { description: trimmed });
    onSaved();
  };

  const toggleObject = async (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
    await setStrategyObjects(strategy.id, Array.from(next));
    onSaved();
  };

  const closePicker = () => {
    setPickerMode('closed');
    setQuery('');
    setNewObjectName('');
    setNewObjectDomainId(null);
  };

  const handleCreateObject = async () => {
    const trimmed = newObjectName.trim();
    if (!trimmed || creatingObject) return;
    setCreatingObject(true);
    try {
      const domainId = newObjectDomainId ?? domains[0]?.id ?? null;
      const created = await createObject({
        name: trimmed,
        domain_id: domainId,
        domain_ids: domainId ? [domainId] : [],
      });
      await toggleObject(created.id);
      closePicker();
    } catch (e) {
      console.error('create Object failed:', e);
    } finally {
      setCreatingObject(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-card h-full">
      <div className="h-[50px] flex items-center gap-1 px-4 border-b border-border/60 bg-card flex-shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="px-1.5 py-0.5 rounded text-[12px] font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
        >
          Strategy
        </button>
        <ChevronRight size={12} className="text-muted-foreground/40 flex-shrink-0" />
        <span className="px-1.5 py-0.5 text-[12px] font-semibold text-foreground truncate max-w-[240px]">
          {strategy.name}
        </span>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto px-8 py-8 space-y-5">
          <div>
            <span className="w-9 h-9 -ml-2 rounded-lg bg-muted/40 flex items-center justify-center text-foreground/70 mb-3">
              <NavStrategyIcon size={18} />
            </span>
            <textarea
              ref={nameRef}
              value={name}
              rows={1}
              onChange={(e) => setName(e.target.value)}
              onBlur={saveName}
              placeholder="Strategy name"
              className="w-full text-2xl font-semibold text-foreground bg-transparent border-none focus:outline-none focus:ring-0 resize-none leading-tight overflow-hidden tracking-normal"
            />
          </div>
          <textarea
            ref={descriptionRef}
            value={description}
            rows={1}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={saveDescription}
            placeholder="Add description..."
            className="w-full text-[14px] text-foreground leading-relaxed bg-transparent border-none focus:outline-none focus:ring-0 min-h-[36px] resize-none overflow-hidden"
          />

          <section>
            <div className="h-px bg-border mb-3" />
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-[13px] font-medium text-foreground/90">Frameworks</h2>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Add Framework"
                    className="flex items-center justify-center size-5 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                  >
                    <Plus size={13} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => selectFramework('gap')}>
                    Gap Analysis
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {framework.type === 'none' && (
              <div className="text-[12px] text-muted-foreground/50 py-1">No framework selected yet</div>
            )}

            {framework.type === 'gap' && (
              <div className="rounded-lg border border-border/60 overflow-hidden">
                <div className="px-3 py-2 bg-muted/30 border-b border-border/60">
                  <h3 className="text-[12px] font-semibold text-foreground/90">Gap Analysis</h3>
                </div>
                <div className="p-3 space-y-3">
                <div>
                  <label className="block text-[11px] text-muted-foreground mb-1">Goal</label>
                  <textarea
                    ref={gapGoalRef}
                    value={framework.goal}
                    rows={1}
                    onChange={(e) => updateFrameworkField('goal', e.target.value)}
                    onBlur={saveFrameworkField}
                    placeholder="Where are we trying to get to?"
                    className="w-full text-[13px] text-foreground leading-relaxed bg-transparent border-none focus:outline-none focus:ring-0 min-h-[24px] resize-none overflow-hidden"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-muted-foreground mb-1">Gap</label>
                  <textarea
                    ref={gapGapRef}
                    value={framework.gap}
                    rows={1}
                    onChange={(e) => updateFrameworkField('gap', e.target.value)}
                    onBlur={saveFrameworkField}
                    placeholder="What's the difference between there and here?"
                    className="w-full text-[13px] text-foreground leading-relaxed bg-transparent border-none focus:outline-none focus:ring-0 min-h-[24px] resize-none overflow-hidden"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-muted-foreground mb-1">Current State</label>
                  <textarea
                    ref={gapCurrentRef}
                    value={framework.current}
                    rows={1}
                    onChange={(e) => updateFrameworkField('current', e.target.value)}
                    onBlur={saveFrameworkField}
                    placeholder="Where are we today?"
                    className="w-full text-[13px] text-foreground leading-relaxed bg-transparent border-none focus:outline-none focus:ring-0 min-h-[24px] resize-none overflow-hidden"
                  />
                </div>
                </div>
              </div>
            )}
          </section>

          <section>
            <div className="h-px bg-border mb-3" />
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-[13px] font-medium text-foreground/90">Objects</h2>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Add Objects"
                    className="flex items-center justify-center size-5 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                  >
                    <Plus size={13} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setPickerMode('search')}>
                    <Search size={13} className="mr-1.5" /> Search Objects
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setPickerMode('create')}>
                    <Plus size={13} className="mr-1.5" /> Create Object
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {selectedIds.size > 0 && (
              <div className="mb-2">
                {Array.from(selectedIds).map((id) => {
                  const obj = allObjects.find((o) => o.id === id);
                  if (!obj) return null;
                  const domain = obj.domain_id ? domains.find((d) => d.id === obj.domain_id) : undefined;
                  const elementCount = obj.elements?.length ?? 0;
                  const doneCount = obj.elements?.filter((e) => e.status === 'done').length ?? 0;
                  const progress = elementCount > 0 ? Math.round((doneCount / elementCount) * 100) : 0;
                  return (
                    <div key={id} className="flex items-center gap-2 px-1 py-1.5 group/row hover:bg-muted/20 transition-colors">
                      <ObjectIcon size={13} className="text-muted-foreground shrink-0" />
                      <span className="text-[13px] font-[550] text-foreground truncate flex-1 min-w-0">{obj.name}</span>
                      <div className="w-20 shrink-0">
                        <TypeCell
                          value={obj.type ?? null}
                          types={domain?.object_types ?? []}
                          onChange={(t) => handleObjectUpdate(obj.id, { type: t })}
                          onAddType={obj.domain_id ? (name) => handleAddType(obj.domain_id as string, name) : undefined}
                        />
                      </div>
                      <div className="w-24 shrink-0">
                        <DueDateCell obj={obj} onObjectUpdate={handleObjectUpdate} />
                      </div>
                      <div className="w-28 shrink-0">
                        <LeadCell obj={obj} workers={workers} onObjectUpdate={handleObjectUpdate} />
                      </div>
                      <div className="w-24 shrink-0 flex items-center gap-1.5">
                        <SegmentedProgress value={progress} className="flex-1" />
                        <span className="text-[10px] text-muted-foreground w-7 text-right tabular-nums shrink-0">{progress}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {pickerMode === 'search' && (
              <>
                <div className="flex items-center gap-2 bg-muted/30 rounded-md px-2 py-1.5 mb-2">
                  <Search size={12} className="text-muted-foreground" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search Objects across Domains…"
                    className="flex-1 bg-transparent text-[13px] outline-none"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={closePicker}
                    aria-label="Close"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X size={12} />
                  </button>
                </div>
                <div className="rounded-lg border border-border/60 bg-card max-h-[420px] overflow-auto">
                  <ObjectPickerList grouped={grouped} selectedIds={selectedIds} onToggle={toggleObject} />
                </div>
              </>
            )}

            {pickerMode === 'create' && (
              <div className="rounded-lg border border-border/60 bg-card p-3 space-y-2">
                <input
                  value={newObjectName}
                  onChange={(e) => setNewObjectName(e.target.value)}
                  placeholder="Object name"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateObject();
                    if (e.key === 'Escape') closePicker();
                  }}
                  className="w-full bg-transparent text-[13px] outline-none border-b border-border/40 pb-1.5"
                />
                {domains.length > 1 && (
                  <select
                    value={newObjectDomainId ?? domains[0]?.id ?? ''}
                    onChange={(e) => setNewObjectDomainId(e.target.value || null)}
                    className="w-full bg-muted/30 rounded-md px-2 py-1.5 text-[12px] outline-none"
                  >
                    {domains.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                )}
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={closePicker}
                    className="px-2 py-1 rounded text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted/30"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={!newObjectName.trim() || creatingObject}
                    onClick={handleCreateObject}
                    className="px-2.5 py-1 rounded-md text-[12px] font-medium bg-primary text-primary-foreground disabled:opacity-40"
                  >
                    Create
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

// =============================================================
// Create dialog — the only remaining modal (there's no Strategy yet to
// push into a detail page for).
// =============================================================
function StrategyCreateDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);

  const nameRef = useRef<HTMLTextAreaElement | null>(null);
  const descriptionRef = useRef<HTMLTextAreaElement | null>(null);
  useAutoGrowTextarea(nameRef, name);
  useAutoGrowTextarea(descriptionRef, description);

  const grouped = useObjectPicker(query);

  const toggleObject = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const canSave = name.trim().length > 0;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    try {
      const created = await createStrategy(
        { name: name.trim(), description: description.trim() || null },
        Array.from(selectedIds),
      );
      onCreated(created.id);
    } catch (e) {
      console.error('create Strategy failed:', e);
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
          <span className="text-[13px] font-semibold text-foreground">New Strategy</span>
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
          <div>
            <span className="w-9 h-9 -ml-2 rounded-lg bg-muted/40 flex items-center justify-center text-foreground/70 mb-3">
              <NavStrategyIcon size={18} />
            </span>
            <textarea
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              rows={1}
              placeholder="Strategy name"
              className="w-full text-2xl font-semibold text-foreground bg-transparent border-none focus:outline-none focus:ring-0 resize-none leading-tight overflow-hidden tracking-normal"
              autoFocus
            />
          </div>
          <section>
            <textarea
              ref={descriptionRef}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={1}
              placeholder="Add description..."
              className="w-full text-[14px] text-foreground leading-relaxed bg-transparent border-none focus:outline-none focus:ring-0 min-h-[36px] resize-none overflow-hidden"
            />
          </section>

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
              <ObjectPickerList grouped={grouped} selectedIds={selectedIds} onToggle={toggleObject} />
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
            {saving ? 'Saving…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
