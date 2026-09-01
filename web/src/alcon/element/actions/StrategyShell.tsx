'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Plus, Search, X } from 'lucide-react';
import { NavStrategyIcon } from '@/shell/sidebar/NavIcons';
import {
  addDomainObjectType,
  addStrategyChild,
  createObject,
  createStrategy,
  fetchAllWorkers,
  removeStrategyChild,
  setStrategyObjects,
  updateObject,
  updateStrategy,
  useDomains,
  useObjects,
  useStrategies,
  type AlconObject,
  type AlconObjectWithChildren,
  type ElementWithDetails,
  type StrategyWithObjects,
  type Worker,
} from '@/hooks/useSupabase';
import { ObjectIcon } from '@/shell/icons';
import { StrategyCommentsPanel } from '@/alcon/element/actions/StrategyCommentsPanel';
import { SegmentedProgress } from '@/alcon/shared/SegmentedProgress';
import {
  useBoard,
  WidgetSurface,
  WidgetZone,
  CAMPAIGN_BOARD,
  type WidgetHost,
  type Zone,
} from '@/alcon/widget';
import { DueDateCell, LeadCell, TypeCell } from '@/alcon/object/ListTable';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';

/** A Campaign page has a band and one column of readings; no side rail. */
const CAMPAIGN_ZONES: Zone[] = ['band', 'main'];

// =============================================================
// StrategyShell — the Strategy layer's "Campaign" app (code keeps the
// `strategy`/`strategies` naming — table, hooks, view id — display text says
// "Campaign" throughout): an Asana-portfolio-style surface. The root is the
// portfolio list — only TOP-LEVEL Campaigns (no parent in strategy_children)
// show there; a Campaign nested inside another only appears in its parent's
// "Campaigns" section. Selecting a row pushes into that Campaign's detail
// page (title, description, nested Campaigns, Object scope — no Properties
// rail, mirrors ElementDetailView minus the side rail).
// =============================================================

export function StrategyShell({
  activeStrategyId,
  onSelectStrategy,
  onOpenObject,
}: {
  /** Which Campaign the detail page shows; null = the portfolio root list.
   *  Controlled by the caller (navigation.strategyId) so other surfaces can
   *  deep-link straight into a Campaign. */
  activeStrategyId?: string | null;
  onSelectStrategy?: (id: string | null) => void;
  /** Jump to an Object's detail (the Execution "projects" view). Objects can
   *  span Domains, so the caller also gets the Object's domain_id to switch
   *  the active Domain context before navigating. */
  onOpenObject?: (objectId: string, domainId: string | null) => void;
} = {}) {
  const { data: strategies, loading, refetch: refetchStrategies } = useStrategies();

  const [newOpen, setNewOpen] = useState(false);
  // Falls back to local state when unmounted from navigation (e.g. a bare
  // <StrategyShell /> with no controlling caller) so the surface still works.
  const [localOpenId, setLocalOpenId] = useState<string | null>(null);
  const openStrategyId = activeStrategyId !== undefined ? activeStrategyId : localOpenId;
  const setOpenStrategyId = onSelectStrategy ?? setLocalOpenId;
  const openStrategy = useMemo(
    () => strategies.find((s) => s.id === openStrategyId) ?? null,
    [strategies, openStrategyId],
  );
  // Root portfolio only lists top-level Campaigns — nested ones surface
  // inside their parent's "Campaigns" section instead.
  const rootStrategies = useMemo(() => strategies.filter((s) => s.parentIds.length === 0), [strategies]);

  if (openStrategy) {
    return (
      <StrategyDetailView
        strategy={openStrategy}
        allStrategies={strategies}
        onBack={() => setOpenStrategyId(null)}
        onOpenStrategy={setOpenStrategyId}
        onSaved={() => refetchStrategies()}
        onOpenObject={onOpenObject}
      />
    );
  }

  return (
    <div className="flex flex-col h-full bg-card">
      <div className="h-[50px] flex items-center gap-1.5 pl-4 pr-2 border-b border-border/60 bg-card flex-shrink-0">
        <NavStrategyIcon size={12} />
        <span className="text-[12px] font-semibold text-foreground">Campaign</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setNewOpen(true)}
          title="Add Campaign"
          aria-label="Add Campaign"
          className="inline-flex items-center justify-center w-6 h-6 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-hidden">
        {loading ? null : rootStrategies.length === 0 ? (
          <EmptyPrompt onCreate={() => setNewOpen(true)} />
        ) : (
          <StrategyListView
            strategies={rootStrategies}
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
        Create a Campaign to group Objects across Domains. Each Campaign gets its own timeline and resource view.
      </p>
      {onCreate && (
        <button
          type="button"
          onClick={onCreate}
          className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-foreground text-background text-[12px] font-medium hover:opacity-90"
        >
          <Plus size={12} />
          New Campaign
        </button>
      )}
    </div>
  );
}

// =============================================================
// Portfolio Campaign list — the entire root view. Selecting a row pushes
// into that Campaign's detail page.
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
  allStrategies,
  onBack,
  onOpenStrategy,
  onSaved,
  onOpenObject,
}: {
  strategy: StrategyWithObjects;
  /** Every Strategy, so this page can list/pick its nested children. */
  allStrategies: StrategyWithObjects[];
  onBack: () => void;
  /** Drill into a nested child Strategy (stays inside StrategyShell). */
  onOpenStrategy: (id: string) => void;
  onSaved: () => void;
  onOpenObject?: (objectId: string, domainId: string | null) => void;
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
  // Nested Strategies (Asana sub-portfolios) — "+" offers picking an
  // existing top-level-or-unrelated Strategy or creating a fresh one, both
  // immediately nested via strategy_children.
  const [childPickerOpen, setChildPickerOpen] = useState(false);
  const [childQuery, setChildQuery] = useState('');
  const [newChildOpen, setNewChildOpen] = useState(false);
  const [linkingChildId, setLinkingChildId] = useState<string | null>(null);

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

  // A Campaign's Elements are the union of its Objects' Elements. That one
  // line is all it takes for every Element-counting widget already in the
  // registry — Milestones, Overdue, Upcoming, Team, the charts — to answer
  // for a Campaign as well as for an Object.
  const campaignElements = useMemo(() => {
    const scope = new Set(strategy.objectIds);
    const out: ElementWithDetails[] = [];
    const walk = (nodes: AlconObjectWithChildren[], inScope: boolean) => {
      for (const n of nodes) {
        const here = inScope || scope.has(n.id);
        if (here && n.elements) out.push(...n.elements);
        if (n.children) walk(n.children, here);
      }
    };
    walk(allObjects.filter((o) => scope.has(o.id)), true);
    return out;
  }, [allObjects, strategy.objectIds]);

  const board = useBoard('campaign', CAMPAIGN_BOARD);
  const host = useMemo<WidgetHost>(
    () => ({
      subject: { kind: 'campaign', id: strategy.id },
      elements: campaignElements,
      onRefresh: onSaved,
      onNavigate: (nav) => {
        if (nav.objectId) onOpenObject?.(nav.objectId, nav.domainId ?? null);
      },
    }),
    [strategy.id, campaignElements, onSaved, onOpenObject],
  );
  const grouped = useObjectPicker(query);

  const childStrategies = useMemo(
    () => allStrategies.filter((s) => s.parentIds.includes(strategy.id)),
    [allStrategies, strategy.id],
  );
  // This Strategy + everything above it in the DAG — excluded from the
  // "existing Strategy" picker so a pick can't wire an obvious cycle back up
  // the chain. (The DB only rejects a literal self-reference.)
  const ancestorIds = useMemo(() => {
    const byId = new Map(allStrategies.map((s) => [s.id, s] as const));
    const seen = new Set<string>([strategy.id]);
    const queue = [...strategy.parentIds];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const parent = byId.get(id);
      if (parent) queue.push(...parent.parentIds);
    }
    return seen;
  }, [allStrategies, strategy.id, strategy.parentIds]);
  const childCandidates = useMemo(() => {
    const existingChildIds = new Set(childStrategies.map((c) => c.id));
    const q = childQuery.trim().toLowerCase();
    return allStrategies.filter((s) =>
      !ancestorIds.has(s.id) &&
      !existingChildIds.has(s.id) &&
      (q === '' || s.name.toLowerCase().includes(q)));
  }, [allStrategies, ancestorIds, childStrategies, childQuery]);

  const linkChild = async (childId: string) => {
    setLinkingChildId(childId);
    try {
      await addStrategyChild(strategy.id, childId);
      onSaved();
      setChildPickerOpen(false);
      setChildQuery('');
    } catch (e) {
      console.error('Failed to nest Campaign:', e);
    } finally {
      setLinkingChildId(null);
    }
  };

  const unlinkChild = async (childId: string) => {
    try {
      await removeStrategyChild(strategy.id, childId);
      onSaved();
    } catch (e) {
      console.error('Failed to un-nest Campaign:', e);
    }
  };

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
    <>
    <div className="flex-1 flex flex-col overflow-hidden bg-card h-full">
      <div className="h-[50px] flex items-center gap-1 px-4 border-b border-border/60 bg-card flex-shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="px-1.5 py-0.5 rounded text-[12px] font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
        >
          Campaign
        </button>
        <ChevronRight size={12} className="text-muted-foreground/40 flex-shrink-0" />
        <span className="px-1.5 py-0.5 text-[12px] font-semibold text-foreground truncate max-w-[240px]">
          {strategy.name}
        </span>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto px-8 py-8">
        <WidgetSurface board={board} host={host} zones={CAMPAIGN_ZONES} className="space-y-5">
          <WidgetZone zone="band" className="mb-4" />
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
              placeholder="Campaign name"
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

          {/* Readings before scope. The sections below say what this Campaign
              *is* — its frameworks, its nested Campaigns, its Objects — and
              those are edited, not viewed, so they are the page's spine. What
              goes here is how it is *going*, which is the reason someone
              opened the page, and which is a board: Situation and Risk by
              default, anything else the reader wants beside them. */}
          <WidgetZone zone="main" columns={1} />

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
              <h2 className="text-[13px] font-medium text-foreground/90">Campaigns</h2>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Add nested Campaign"
                    className="flex items-center justify-center size-5 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                  >
                    <Plus size={13} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setChildPickerOpen(true)}>
                    <Search size={13} className="mr-1.5" /> Add existing Campaign
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setNewChildOpen(true)}>
                    <Plus size={13} className="mr-1.5" /> Create Campaign
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {childStrategies.length === 0 && childPickerOpen === false && (
              <div className="text-[12px] text-muted-foreground/50 py-1">
                No nested Campaigns yet — group related Campaigns here, portfolio-style.
              </div>
            )}

            {childStrategies.length > 0 && (
              <div className="mb-2 flex flex-col">
                {childStrategies.map((child) => (
                  <div
                    key={child.id}
                    className="flex items-center gap-2 px-1 py-1.5 min-h-[2.375rem] rounded-md group/row hover:bg-muted/20 transition-colors cursor-pointer"
                    onClick={() => onOpenStrategy(child.id)}
                  >
                    <NavStrategyIcon size={13} className="text-muted-foreground shrink-0" />
                    <span className="text-[13px] font-[550] text-foreground truncate flex-1 min-w-0">{child.name}</span>
                    <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                      {child.objectIds.length} object{child.objectIds.length === 1 ? '' : 's'}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); void unlinkChild(child.id); }}
                      aria-label={`Remove ${child.name} from this Campaign`}
                      className="shrink-0 flex items-center justify-center size-5 rounded text-muted-foreground opacity-0 group-hover/row:opacity-100 hover:text-foreground hover:bg-muted/40 transition-opacity"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {childPickerOpen && (
              <>
                <div className="flex items-center gap-2 bg-muted/30 rounded-md px-2 py-1.5 mb-2">
                  <Search size={12} className="text-muted-foreground" />
                  <input
                    value={childQuery}
                    onChange={(e) => setChildQuery(e.target.value)}
                    placeholder="Search Campaigns…"
                    className="flex-1 bg-transparent text-[13px] outline-none"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => { setChildPickerOpen(false); setChildQuery(''); }}
                    aria-label="Close"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X size={12} />
                  </button>
                </div>
                <div className="rounded-lg border border-border/60 bg-card max-h-72 overflow-auto">
                  {childCandidates.length === 0 && (
                    <div className="px-3 py-3 text-[12px] text-muted-foreground italic">
                      No Campaigns match
                    </div>
                  )}
                  {childCandidates.map((s) => (
                    <button
                      type="button"
                      key={s.id}
                      disabled={linkingChildId === s.id}
                      onClick={() => linkChild(s.id)}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] hover:bg-accent text-left disabled:opacity-50"
                    >
                      <NavStrategyIcon size={11} />
                      <span className="flex-1 truncate text-foreground">{s.name}</span>
                    </button>
                  ))}
                </div>
              </>
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
                    <div
                      key={id}
                      onClick={() => onOpenObject?.(obj.id, obj.domain_id ?? null)}
                      // min-h locks the row against the Lead avatar's async
                      // image swap (Fallback initial -> loaded photo mounts a
                      // fraction of a px taller and visibly nudged the row).
                      className={`flex items-center gap-2 px-1 py-1.5 min-h-[2.375rem] rounded-md group/row hover:bg-muted/20 transition-colors ${onOpenObject ? 'cursor-pointer' : ''}`}
                    >
                      <ObjectIcon size={13} className="text-muted-foreground shrink-0" />
                      <span className="text-[13px] font-[550] text-foreground truncate flex-1 min-w-0">{obj.name}</span>
                      <div className="w-20 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <TypeCell
                          value={obj.type ?? null}
                          types={domain?.object_types ?? []}
                          onChange={(t) => handleObjectUpdate(obj.id, { type: t })}
                          onAddType={obj.domain_id ? (name) => handleAddType(obj.domain_id as string, name) : undefined}
                        />
                      </div>
                      <div className="w-24 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <DueDateCell obj={obj} onObjectUpdate={handleObjectUpdate} />
                      </div>
                      <div className="w-28 shrink-0" onClick={(e) => e.stopPropagation()}>
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
                    className="w-full bg-muted/30 rounded-md px-2 py-1.5 text-[12px] outline-none border-none"
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

          {/* Activity — last, because it accumulates: the sections above are
              the Campaign's current state and stay a fixed height, while this
              one grows downward as the Campaign is discussed. */}
          <section>
            <div className="h-px bg-border mb-3" />
            <h2 className="text-[13px] font-medium text-foreground/90 mb-2">Activity</h2>
            <StrategyCommentsPanel
              strategyId={strategy.id}
              strategyName={strategy.name}
              strategyOwnerId={strategy.created_by}
              workers={workers}
            />
          </section>
        </WidgetSurface>
        </div>
      </div>
    </div>
    {newChildOpen && (
      <StrategyCreateDialog
        onClose={() => setNewChildOpen(false)}
        onCreated={async (id) => {
          setNewChildOpen(false);
          try {
            await addStrategyChild(strategy.id, id);
          } catch (e) {
            console.error('Failed to nest new Campaign:', e);
          }
          onSaved();
          onOpenStrategy(id);
        }}
      />
    )}
    </>
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
      console.error('create Campaign failed:', e);
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
          <span className="text-[13px] font-semibold text-foreground">New Campaign</span>
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
              placeholder="Campaign name"
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
