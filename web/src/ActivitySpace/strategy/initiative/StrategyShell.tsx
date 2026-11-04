'use client';

import { DescriptionEditor } from '@/Function/shared/DescriptionEditor';
import { IslandHeader } from '@/Function/shared/MainIsland';
import { appDialog } from '@/Function/shared/appDialogStore';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Plus, Search, X } from '@/ui/icons';
import { NavStrategyIcon } from '@/shell/sidebar/NavIcons';
import { PageIcon, PageSection, PAGE_TITLE, PAGE_TITLE_WEIGHT } from '@/Function/shared/PageHead';
import { IndexList, IndexRow } from '@/Function/shared/IndexList';
import { DisclosureTriangle } from '@/Function/shared/DisclosureTriangle';
import { InitiativeActionsButton, InitiativeMenu } from './InitiativeMenu';
import { ContentRow, ContentRowAction } from '@/Function/shared/ContentRow';
import { Button, ButtonAppearanceProvider } from '@/ui/button';
import { EmptyState } from '@/Function/shared/EmptyState';
import { QuickCreatePopup, quickCreatePillClass } from '@/Function/shared/QuickCreatePopup';
import { Popover, PopoverTrigger } from '@/ui/popover';
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/ui/command';
import { MenuShell } from '@/Function/shared/menu';
import { isCancelKey, isCommitEnter, isSubmitChord, useEscapeLayer } from '@/Function/shared/keyboard';
import { ConfirmDialog } from '@/Function/shared/ConfirmDialog';
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
  deleteStrategy,
  useDomains,
  useObjects,
  useStrategies,
  type AlconObject,
  type AlconObjectWithChildren,
  type StrategyWithObjects,
  type Worker,
} from '@/hooks/useSupabase';
import type { StrategyDelegation } from '@/types/database';
import { setStrategyDefinition } from '@/hooks/definitionData';
import { ObjectIcon } from '@/shell/icons';
import { InitiativeIntentProvider } from '@/ActivitySpace/strategy/initiative/InitiativeIntent';
import { StrategyCommentsPanel } from '@/ActivitySpace/strategy/initiative/StrategyCommentsPanel';
import { InitiativeCodeChanges } from '@/ActivitySpace/execution/code/InitiativeCodeChanges';
import { InitiativeMission } from './mission/InitiativeMission';
import { SegmentedProgress } from '@/Function/shared/SegmentedProgress';
import { useAuthContext } from '@/providers/AuthProvider';
import { canEditInitiative } from '@/Function/strategy/initiativeAccess';
import { useSpaceRole } from '@/Function/space/data';
import { canEditObject, canManageDomainTypes } from '@/ActivitySpace/execution/object/objectAccess';
import { useMyDomainRoles, useMyObjectMemberships } from '@/hooks/useMyMemberships';
import { useInitiativeHealth } from './useInitiativeHealth';
import type { InitiativeHealth } from './initiativeHealthModel';
import { useInitiativeMeasureTallies } from './useInitiativeMeasureTallies';
import { MeasureStatus } from './MeasureStatus';
import type { MeasureTally } from './initiativeMeasureModel';
import { useNow } from '@/Function/shared/useNow';
import { formatRelative } from '@/Function/shared/dateUtils';
import {
  useBoard,
  WidgetSurface,
  WidgetZone,
  WidgetActionSlotProvider,
  WidgetActionSlotTarget,
  INITIATIVE_BOARD,
  INITIATIVE_PLAN_BOARD,
  INITIATIVE_AUDIT_BOARD,
  type BoardLayout,
  type WidgetHost,
  type Zone,
} from '@/Function/widget';
import { DueDateCell, LeadCell, TypeCell } from '@/Function/shared/listTable/cells';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import { completionOf } from '@/Function/shared/completion';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { buildInitiativeTree, flattenInitiativeTree, inSpace, type InitiativeNode } from './initiativeTree';
import { useActiveObjectCount } from '@/hooks/useObjectArchive';

/** The Overview tab has a band and one column of readings; the other boards
 *  one column; none has a side rail. */
const OVERVIEW_ZONES: Zone[] = ['band', 'main'];
const MAIN_ZONES: Zone[] = ['main'];

type InitiativeTab = 'overview' | 'execution' | 'audit';
const INITIATIVE_TABS: { id: InitiativeTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'execution', label: 'Execution' },
  { id: 'audit', label: 'Evaluate' },
];

/** One tab's widget board. Each tab keeps its own board, so a widget placed
 *  on Execution stays on Execution. The surface keys are the persisted
 *  boards.surface, not display strings: the Overview's stays 'campaign' and
 *  Execution's 'initiative-plan'. */
function InitiativeBoard({ surface, defaults, subjectId, host, zones, children }: {
  surface: string;
  defaults: BoardLayout;
  subjectId: string;
  host: WidgetHost;
  zones: Zone[];
  children: React.ReactNode;
}) {
  const board = useBoard(surface, defaults, subjectId);
  return <WidgetSurface board={board} host={host} zones={zones} className="space-y-5">{children}</WidgetSurface>;
}

// =============================================================
// StrategyShell — the Strategy layer's "Strategy" app (code keeps the
// `strategy`/`strategies` naming — table, hooks, view id — display text says
// "Strategy" throughout): a list-and-detail surface. The root is the
// Strategy list — only TOP-LEVEL Strategies (no parent in strategy_children)
// show there; a Strategy nested inside another only appears in its parent's
// "Strategies" section. Selecting a row pushes into that Strategy's detail
// page (title, description, nested Strategies, Object scope — no Properties
// rail, mirrors ElementDetailView minus the side rail).
// =============================================================

export function StrategyShell({
  activeStrategyId,
  onSelectStrategy,
  onOpenObject,
  onOpenDomain,
  createRequested,
  onCreateHandled,
}: {
  /** Which Strategy the detail page shows; null = the root Strategy list.
   *  Controlled by the caller (navigation.strategyId) so other surfaces can
   *  deep-link straight into a Strategy. */
  activeStrategyId?: string | null;
  onSelectStrategy?: (id: string | null) => void;
  /** Jump to an Object's detail (the Execution "objects" view). Objects can
   *  span Domains, so the caller also gets the Object's domain_id to switch
   *  the active Domain context before navigating. */
  onOpenObject?: (objectId: string, domainId: string | null) => void;
  onOpenDomain?: (domainId: string) => void;
  /** The sidebar's "+" asked for a new Strategy (navigation.strategyCreate).
   *  The dialog opens on the root list and `onCreateHandled` clears it. */
  createRequested?: boolean;
  onCreateHandled?: () => void;
} = {}) {
  const { data: strategies, loading, refetch: refetchStrategies } = useStrategies();

  const [localNewOpen, setLocalNewOpen] = useState(false);
  const newOpen = localNewOpen || !!createRequested;
  const setNewOpen = (open: boolean) => {
    setLocalNewOpen(open);
    if (!open && createRequested) onCreateHandled?.();
  };
  // Falls back to local state when unmounted from navigation (e.g. a bare
  // <StrategyShell /> with no controlling caller) so the surface still works.
  const [localOpenId, setLocalOpenId] = useState<string | null>(null);
  const openStrategyId = activeStrategyId !== undefined ? activeStrategyId : localOpenId;
  const setOpenStrategyId = onSelectStrategy ?? setLocalOpenId;
  const openStrategy = useMemo(
    () => strategies.find((s) => s.id === openStrategyId) ?? null,
    [strategies, openStrategyId],
  );
  // The list is the Space's Strategies as one tree, nested ones under their
  // parent, as deep as they go.
  const { t } = useI18n();
  const spaceId = useActiveSpaceId();
  const tree = useMemo(() => buildInitiativeTree(strategies.filter((s) => inSpace(s, spaceId, () => true))), [strategies, spaceId]);

  if (openStrategy) {
    return (
      <StrategyDetailView
        strategy={openStrategy}
        allStrategies={strategies}
        onBack={() => setOpenStrategyId(null)}
        onOpenStrategy={setOpenStrategyId}
        onSaved={() => refetchStrategies()}
        onOpenObject={onOpenObject}
        onOpenDomain={onOpenDomain}
      />
    );
  }

  return (
    <div className="flex flex-col h-full bg-card">
      <IslandHeader crumbs={[{ id: 'initiatives', label: t('Strategies') }]} actions={
        <ButtonAppearanceProvider appearance="navigation">
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setNewOpen(true)}>
            <Plus size={14} />{t('Add Strategy')}</Button>
        </ButtonAppearanceProvider>
      } />

      <div className="flex-1 overflow-hidden">
        {loading ? null : tree.length === 0 ? (
          <EmptyState art="initiative" title="Create your first Strategy"
            description="A Strategy groups Objects across Domains around one outcome."
            cta="Create Strategy" onCta={() => setNewOpen(true)} />
        ) : (
          <div className="h-full overflow-auto">
            <StrategyListView nodes={tree} onSelectStrategy={(s) => setOpenStrategyId(s.id)} />
          </div>
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
// Root Strategy list — the entire root view. Selecting a row pushes
// into that Strategy's detail page.
// =============================================================
// What a person scans the list for, and nothing more: how far along, how
// recently anything moved, and whether something is on fire. Counts come from
// the same predicates the Strategy page uses (initiativeRiskModel), so the
// row never disagrees with the page it opens. Quiet register throughout — a
// row is not the place to shout; the number is the signal.
function InitiativeHealthCell({ health, measures }: { health: InitiativeHealth | undefined; measures: MeasureTally | undefined }) {
  const { t } = useI18n();
  if (!health) {
    return <span className="text-[11px] text-muted-foreground/50">…</span>;
  }
  const { risk } = health;
  const alerts: string[] = [];
  if (risk.overdue > 0) alerts.push(t('{n} overdue', { n: risk.overdue }));
  if (risk.stalled > 0) alerts.push(t('{n} stalled', { n: risk.stalled }));
  if (risk.blocked > 0) alerts.push(t('{n} blocked', { n: risk.blocked }));
  const moved = health.lastActivityAt !== null
    ? formatRelative(new Date(health.lastActivityAt).toISOString())
    : null;
  const unmeasured = health.risk.openTotal > 0 && !health.scheduleMeasured;
  return (
    <div className="flex items-center gap-3 min-w-0 text-[11px] text-muted-foreground tabular-nums">
      {/* Outcome before effort: the success conditions lead, the Element
          completion that follows is only how much work has been done. */}
      <MeasureStatus tally={measures} />
      {health.progressPct === null ? (
        <span className="shrink-0 text-muted-foreground/60">{t('No Elements')}</span>
      ) : (
        <span className="flex items-center gap-1.5 shrink-0 w-24">
          <SegmentedProgress value={health.progressPct} className="flex-1" />
          <span className="w-7 text-right">{health.progressPct}%</span>
        </span>
      )}
      {/* An empty Strategy already said "No Elements"; "No activity" would
          be the same fact twice. */}
      {!(health.total === 0 && moved === null) && (
        <span className="shrink-0 min-w-0 truncate text-muted-foreground/70" title={moved ? t('Last movement {when}', { when: moved }) : t('Nothing has reported yet')}>
          {moved ?? t('No activity')}
        </span>
      )}
      {alerts.length > 0 ? (
        <span
          className="min-w-0 truncate text-foreground/80"
          // The alerts take the slot, but an unmeasured schedule is still a
          // fact — it rides in the title rather than costing width.
          title={unmeasured ? t('{alerts} — open Elements carry no due dates, so the schedule is unmeasured', { alerts: alerts.join(' · ') }) : alerts.join(' · ')}
        >
          {alerts.join(' · ')}
        </span>
      ) : unmeasured ? (
        // 0 overdue with no dated work is not "on time" — it is unmeasured.
        <span className="min-w-0 truncate text-muted-foreground/60" title={t('Open Elements carry no due dates, so the schedule is unmeasured')}>{t('No dates')}</span>
      ) : null}
    </div>
  );
}

function StrategyListView({
  nodes,
  onSelectStrategy,
}: {
  /** The tree's roots; a parent folds its children away with its arrow. */
  nodes: InitiativeNode<StrategyWithObjects>[];
  onSelectStrategy: (strategy: StrategyWithObjects) => void;
}) {
  const { t } = useI18n();
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const rows = useMemo(() => flattenInitiativeTree(nodes, (key) => !folded.has(key)), [nodes, folded]);
  const strategies = useMemo(() => rows.map((n) => n.initiative), [rows]);
  // Health for every row from one read (progress / last movement / risk).
  const { byId: health } = useInitiativeHealth(strategies);
  // Success-condition tallies for every row from one read of their measures.
  const tallies = useInitiativeMeasureTallies(strategies.map((s) => s.id));
  // Archived Objects stay linked but are not counted.
  const countObjects = useActiveObjectCount();
  // Subscribe to the shared tick so "Today" / "3m ago" in the cells ages
  // honestly while the list stays open; the cells re-render with this view.
  useNow();
  return (
    <IndexList headers={[t('Name'), t('Health'), t('Objects')]} withActions>
      {rows.map(({ initiative: s, key, depth, children }) => (
        <InitiativeMenu key={key} initiative={s}>
          <div>
            <IndexRow indent={depth * 20} icon={<NavStrategyIcon size={16} />} name={s.name}
              lead={children.length > 0 ? (
                <button type="button"
                  onClick={() => setFolded((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; })}
                  className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground outline-none transition-colors hover:text-foreground"
                  aria-label={folded.has(key) ? t('Expand {name}', { name: s.name }) : t('Collapse {name}', { name: s.name })} aria-expanded={!folded.has(key)}>
                  <DisclosureTriangle open={!folded.has(key)} />
                </button>
              ) : undefined}
              health={<InitiativeHealthCell health={health.get(s.id)} measures={tallies.get(s.id)} />}
              count={countObjects(s.objectIds)}
              onOpen={() => onSelectStrategy(s)}
              actions={<InitiativeActionsButton initiative={s} />} />
          </div>
        </InitiativeMenu>
      ))}
    </IndexList>
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

function useAllObjects(): { objects: AlconObjectWithChildren[]; refetch: () => Promise<void> } {
  const { data: explorer, refetch } = useObjects(null);

  const objects = explorer.objects;

  return { objects, refetch };
}

// Group the flat Object list by Domain — shared between the create dialog
// and the detail view's Object-scope picker.
function useObjectPicker(query: string) {
  const { t } = useI18n();
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
      const dname = domains.find((d) => d.id === did)?.name ?? t('No Domain');
      if (!m.has(did)) m.set(did, { domainName: dname, objects: [] });
      m.get(did)!.objects.push(o);
    }
    return Array.from(m.entries());
  }, [filtered, domains, t]);

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
  const { t } = useI18n();
  return (
    <>
      {grouped.length === 0 && (
        <div className="px-3 py-3 text-[12px] text-muted-foreground">
          {t('No Objects match.')}
        </div>
      )}
      {grouped.map(([did, { domainName, objects }]) => (
        <div key={did}>
          <div className="px-3 py-1 text-[11px] text-muted-foreground bg-muted/20 sticky top-0">
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
  onOpenDomain,
}: {
  strategy: StrategyWithObjects;
  /** Every Strategy, so this page can list/pick its nested children. */
  allStrategies: StrategyWithObjects[];
  onBack: () => void;
  /** Drill into a nested child Strategy (stays inside StrategyShell). */
  onOpenStrategy: (id: string) => void;
  onSaved: () => void;
  onOpenObject?: (objectId: string, domainId: string | null) => void;
  onOpenDomain?: (domainId: string) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(strategy.name);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(strategy.objectIds));
  const [query, setQuery] = useState('');
  // Objects section starts collapsed to the selected chips — "+" reveals
  // either the cross-Domain search picker or a quick inline create form.
  const [pickerMode, setPickerMode] = useState<'closed' | 'search' | 'create'>('closed');
  const [newObjectName, setNewObjectName] = useState('');
  const [newObjectDomainId, setNewObjectDomainId] = useState<string | null>(null);
  const [creatingObject, setCreatingObject] = useState(false);
  // Nested Strategies — "+" offers picking an
  // existing top-level-or-unrelated Strategy or creating a fresh one, both
  // immediately nested via strategy_children.
  const [childPickerOpen, setChildPickerOpen] = useState(false);
  const [childQuery, setChildQuery] = useState('');
  const [newChildOpen, setNewChildOpen] = useState(false);
  const [linkingChildId, setLinkingChildId] = useState<string | null>(null);

  // Esc leaves the page for the root list — one level back. Anything
  // opened on top of the page (a picker's field, the create dialog) takes the
  // key first and the page gets the next one.
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEscapeLayer(true, onBack, rootRef);

  // Re-sync local edit state when switching to a different Strategy.
  // The database answers "may this user write?" with owner-only RLS; the UI
  // has to give the same answer before the write, or a non-owner sees an
  // edit take and vanish on reload (ELE_STR-021).
  const { user } = useAuthContext();
  const userId = user?.id ?? null;
  const ownsItsSpace = useSpaceRole(strategy.activity_space_id) === 'owner';
  const canEdit = canEditInitiative(userId, strategy.created_by, ownsItsSpace);
  // The Object rows write to objects / domains, which answer to Object
  // membership and Domain role — not to who owns the Strategy.
  const { data: myObjects } = useMyObjectMemberships(userId);
  const { data: myDomainRoles } = useMyDomainRoles(userId);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setName(strategy.name);
    setSaveError(null);
    setSelectedIds(new Set(strategy.objectIds));
  }, [strategy.id, strategy.name, strategy.description, strategy.objectIds]);

  // Only collapse the Objects picker on an actual Strategy switch — not on
  // every objectIds refetch triggered by toggling a selection.
  useEffect(() => {
    setPickerMode('closed');
  }, [strategy.id]);

  const nameRef = useRef<HTMLTextAreaElement | null>(null);
  useAutoGrowTextarea(nameRef, name);

  const { data: domains, refetch: refetchDomains } = useDomains();
  const { objects: allObjects, refetch: refetchObjects } = useAllObjects();
  // Nested Strategies' counts leave archived Objects out, like the list.
  const countObjects = useActiveObjectCount();

  // A Strategy's Elements are the union of its Objects' Elements. That one
  // line is all it takes for every Element-counting widget already in the
  // registry — Milestones, Overdue, Upcoming, Team, the charts — to answer
  // for a Strategy as well as for an Object.
  const initiativeElements = useMemo(() => {
    const scope = new Set(strategy.objectIds);
    return allObjects.filter((o) => scope.has(o.id)).flatMap((o) => o.elements ?? []);
  }, [allObjects, strategy.objectIds]);

  // Another Strategy opens on its Overview.
  const [tab, setTab] = useState<InitiativeTab>('overview');
  const [tabFor, setTabFor] = useState(strategy.id);
  if (tabFor !== strategy.id) { setTabFor(strategy.id); setTab('overview'); }
  const host = useMemo<WidgetHost>(
    () => ({
      subject: { kind: 'initiative', id: strategy.id },
      elements: initiativeElements,
      onRefresh: onSaved,
      onNavigate: (nav) => {
        if (nav.objectId) onOpenObject?.(nav.objectId, nav.domainId ?? null);
        else if (nav.domainId) onOpenDomain?.(nav.domainId);
      },
    }),
    [strategy.id, initiativeElements, onSaved, onOpenObject, onOpenDomain],
  );
  const grouped = useObjectPicker(query);
  const missionProps = {
    initiativeId: strategy.id,
    initiativeName: strategy.name,
    spaceId: strategy.activity_space_id ?? null,
    objects: allObjects.filter((o) => selectedIds.has(o.id)),
    delegation: strategy.delegation ?? 'manual',
    onDelegationChange: async (delegation: StrategyDelegation) => { await updateStrategy(strategy.id, { delegation }); onSaved(); },
    definitionId: strategy.definition_id ?? null,
    onDefinitionChange: async (id: string | null) => { await setStrategyDefinition(strategy.id, id); onSaved(); },
    onChanged: () => { void refetchObjects(); onSaved(); },
    onOpenObject,
  };

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
    // strategy_children's INSERT policy needs the caller to be able to edit
    // the child as well as the parent, so a colleague's Strategy — readable
    // Space-wide — is offered only to an owner of its Space.
    return allStrategies.filter((s) =>
      !ancestorIds.has(s.id) &&
      !existingChildIds.has(s.id) &&
      canEditInitiative(userId, s.created_by, ownsItsSpace && s.activity_space_id === strategy.activity_space_id) &&
      (q === '' || s.name.toLowerCase().includes(q)));
  }, [allStrategies, ancestorIds, childStrategies, childQuery, userId, ownsItsSpace, strategy.activity_space_id]);

  const linkChild = async (childId: string) => {
    if (!canEdit) return;
    setLinkingChildId(childId);
    try {
      await addStrategyChild(strategy.id, childId);
      setSaveError(null);
      onSaved();
      setChildPickerOpen(false);
      setChildQuery('');
    } catch (e) {
      console.error('Failed to nest Strategy:', e);
      setSaveError(t('Could not nest that Strategy'));
    } finally {
      setLinkingChildId(null);
    }
  };

  const unlinkChild = async (childId: string) => {
    if (!canEdit) return;
    try {
      await removeStrategyChild(strategy.id, childId);
      setSaveError(null);
      onSaved();
    } catch (e) {
      console.error('Failed to un-nest Strategy:', e);
      setSaveError(t('Could not remove that Strategy'));
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
      setSaveError(null);
      await refetchObjects();
    } catch (e) {
      console.error('Failed to update Object:', e);
      // Nothing was written; put the row back to what the server holds and
      // say so where the eye lands, instead of a console nobody watches.
      await refetchObjects();
      setSaveError(t('Could not change the Object — only its members can'));
    }
  };

  const handleAddType = async (domainId: string, typeName: string) => {
    try {
      await addDomainObjectType(domainId, typeName);
      setSaveError(null);
      await refetchDomains();
    } catch (e) {
      console.error('Failed to add Object type:', e);
      await refetchDomains();
      setSaveError(t("Could not add the Type — only the Domain's owner or admin can"));
    }
  };

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const handleDelete = async () => {
    if (!canEdit || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteStrategy(strategy.id);
      onSaved();
      onBack();
    } catch (e) {
      console.error('Failed to delete Strategy:', e);
      setDeleteError(e instanceof Error ? e.message : t('Could not delete the Strategy'));
      setDeleting(false);
      setConfirmingDelete(false);
    }
  };

  const saveName = async () => {
    // An emptied name is not saved; show the saved one again.
    if (!name.trim()) { setName(strategy.name); return; }
    const trimmed = name.trim();
    if (trimmed === strategy.name) return;
    if (!canEdit) { setName(strategy.name); return; }
    try {
      await updateStrategy(strategy.id, { name: trimmed });
      setSaveError(null);
      onSaved();
    } catch (e) {
      console.error('Failed to rename Strategy:', e);
      setName(strategy.name);
      setSaveError(t('Could not save the name'));
    }
  };

  const saveDescription = async (description: string) => {
    const trimmed = description.trim() || null;
    if (trimmed === (strategy.description ?? null) || !canEdit) return;
    try {
      await updateStrategy(strategy.id, { description: trimmed });
      setSaveError(null);
      onSaved();
    } catch (e) {
      console.error('Failed to save Strategy description:', e);
      setSaveError(t('Could not save the description'));
    }
  };

  const toggleObject = async (id: string) => {
    if (!canEdit) return;
    const previous = selectedIds;
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
    try {
      await setStrategyObjects(strategy.id, Array.from(next));
      setSaveError(null);
      onSaved();
    } catch (e) {
      console.error('Failed to update Strategy Objects:', e);
      setSelectedIds(previous);
      setSaveError(t('Could not change the Objects'));
    }
  };

  const closePicker = () => {
    setPickerMode('closed');
    setQuery('');
    setNewObjectName('');
    setNewObjectDomainId(null);
  };

  // Both pickers are row-lists: clicking a candidate keeps the picker open
  // (multi-select) and moves focus onto that row's button, off the search
  // input the review-day handler was — the input's own onKeyDown never sees
  // the next Escape. A layer keyed to the open state catches it either way.
  useEscapeLayer(pickerMode !== 'closed', closePicker);
  useEscapeLayer(childPickerOpen, () => { setChildPickerOpen(false); setChildQuery(''); });

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
      void appDialog.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setCreatingObject(false);
    }
  };

  // The two "+" menus — each opens from the section heading once the section
  // has content, and from its inline "+ verb" while it has none.
  const nestedMenu = (trigger: React.ReactNode) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onClick={() => setChildPickerOpen(true)}>
          <Search size={13} className="mr-1.5" /> {t('Add existing Strategy')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setNewChildOpen(true)}>
          <Plus size={13} className="mr-1.5" /> {t('Create Strategy')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const objectsMenu = (trigger: React.ReactNode) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onClick={() => setPickerMode('search')}>
          <Search size={13} className="mr-1.5" /> {t('Search Objects')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setPickerMode('create')}>
          <Plus size={13} className="mr-1.5" /> {t('Create Object')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <>
    <ConfirmDialog
      open={confirmingDelete}
      title={t('Delete "{name}"?', { name: strategy.name })}
      description={t("Its Intents, comments, and nesting links are deleted. Linked Objects stay. This can't be undone.")}
      busy={deleting}
      onConfirm={() => { void handleDelete(); }}
      onCancel={() => setConfirmingDelete(false)}
    />
    <WidgetActionSlotProvider>
    <div ref={rootRef} className="flex-1 flex flex-col overflow-hidden bg-card h-full">
      {/* Drawn as the shared IslandHeader is (Function/shared/MainIsland). */}
      <div className="h-[50px] flex flex-shrink-0 items-center gap-1 border-b border-border/60 bg-card pl-6 pr-2">
        <button
          type="button"
          onClick={onBack}
          className="px-1.5 py-0.5 rounded text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
        >
          {t('Strategy')}
        </button>
        <ChevronRight size={12} className="text-muted-foreground/40 flex-shrink-0" />
        <span className="px-1.5 py-0.5 text-[13px] font-semibold text-foreground truncate max-w-[240px]">
          {strategy.name}
        </span>
        {/* Beside the name, as on an Object: move it, or delete it. */}
        <InitiativeActionsButton initiative={strategy} onDelete={() => { if (!deleting) setConfirmingDelete(true); }} />
        {!canEdit && (
          // Said once, where the eye lands first. The Strategy's own
          // structure — name, description, Objects, nested Strategies —
          // is locked to match. The board's intent sections keep their own
          // policy and report their own failures (ELE_STR-025).
          <span
            className="ml-1 px-1.5 py-0.5 text-[11px] text-muted-foreground"
            title={t("Only the Strategy's owner can edit it")}
          >
            {t('Read-only')}
          </span>
        )}
        <div className="ml-auto flex min-w-0 items-center gap-2">
          {/* "Add widget" is page chrome: it sits in the header, as on a Domain. */}
          <WidgetActionSlotTarget className="flex items-center gap-1" />
          {(deleteError || saveError) && (
            <span role="status" className="text-[11px] text-muted-foreground truncate">
              {deleteError ?? t('{error} — change reverted', { error: saveError ?? '' })}
            </span>
          )}
        </div>
      </div>

      {/* One Strategy, three readings — under the header, as the views of a
          Domain or Object sit: how it is going (Overview), how it breaks
          down into Objects and Elements and the work carrying it out
          (Execution), and the evidence it is judged on (Evaluate). */}
      <div role="tablist" aria-label={t('Strategy views')} className="flex flex-shrink-0 items-center gap-0.5 py-2 pl-[19px] pr-4">
        {INITIATIVE_TABS.map((v) => (
          <Button key={v.id} type="button" shape="tab" role="tab" aria-selected={tab === v.id}
            variant={tab === v.id ? 'secondary' : 'ghost'} onClick={() => setTab(v.id)}>
            {t(v.label)}
          </Button>
        ))}
      </div>

      <div className="flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto px-8 py-8">
        {/* The Intent read is mounted here, above the board, because the
            three sections that use it must share one — see InitiativeIntent. */}
        <InitiativeIntentProvider key={strategy.id} initiativeId={strategy.id} initiativeName={strategy.name} createdBy={strategy.created_by}>
        <div className="space-y-5">
          <div>
            <PageIcon><NavStrategyIcon size={18} /></PageIcon>
            <textarea
              ref={nameRef}
              value={name}
              rows={1}
              onChange={(e) => setName(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => {
                // A name is one line: Enter commits (via blur), Shift+Enter
                // is the only way to a newline. The name autosaves, so
                // Escape ends the edit and saves too; it is consumed here,
                // so the page's own Escape (back to the list) waits for the
                // next press.
                if (isCommitEnter(e) || isSubmitChord(e) || isCancelKey(e)) {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
              placeholder={t('Strategy name')}
              readOnly={!canEdit}
              aria-readonly={!canEdit}
              tabIndex={canEdit ? undefined : -1}
              className={`w-full bg-transparent border-none resize-none overflow-hidden ${PAGE_TITLE}`}
              style={PAGE_TITLE_WEIGHT}
            />
          </div>
          <DescriptionEditor key={strategy.id} value={strategy.description ?? ''} readOnly={!canEdit}
            placeholder={t('Add description…')} onSave={saveDescription} />


          {tab === 'overview' && (
            <InitiativeBoard surface="campaign" defaults={INITIATIVE_BOARD} subjectId={strategy.id} host={host} zones={OVERVIEW_ZONES}>
              {/* Band — how it is going (a progress line by default), before
                  the readings below. */}
              <WidgetZone zone="band" />
              {/* Whether it lands, where it hurts, the conditions it is held
                  to and the frameworks that read them back. */}
              <WidgetZone zone="main" columns={1} />
            </InitiativeBoard>
          )}

          {tab === 'execution' && (
            <InitiativeBoard surface="initiative-plan" defaults={INITIATIVE_PLAN_BOARD} subjectId={strategy.id} host={host} zones={MAIN_ZONES}>
              {/* How the Strategy breaks down into Objects and Elements — or
                  the Planner's draft of it — and the work as it runs. */}
              <InitiativeMission tab="execution" {...missionProps} />
            {selectedIds.size > 0 || pickerMode !== 'closed' ? (
              <PageSection title={t('Objects')} action={canEdit ? (
                <ButtonAppearanceProvider appearance="navigation">
                  {objectsMenu(
                    <Button variant="ghost" size="icon-xs" aria-label={t('Add Objects')} className="text-muted-foreground">
                      <Plus size={13} />
                    </Button>,
                  )}
                </ButtonAppearanceProvider>
              ) : undefined}>
              {selectedIds.size > 0 && (
                <div className="mb-2">
                  {Array.from(selectedIds).map((id) => {
                    const obj = allObjects.find((o) => o.id === id);
                    if (!obj) return null;
                    const domain = obj.domain_id ? domains.find((d) => d.id === obj.domain_id) : undefined;
                    const progress = completionOf(obj.elements ?? []).pct;
                    const editable = canEditObject(myObjects, obj.id);
                    const canTypes = editable && canManageDomainTypes(myDomainRoles, obj.domain_id);
                    const why = editable ? undefined : t('Only members of this Object can change it');
                    return (
                      <div
                        key={id}
                        onClick={() => onOpenObject?.(obj.id, obj.domain_id ?? null)}
                        // min-h locks the row against the Lead avatar's async
                        // image swap (Fallback initial -> loaded photo mounts a
                        // fraction of a px taller and visibly nudged the row).
                        className={`flex items-center gap-2 px-2 py-1 min-h-[2.375rem] rounded-md hover:bg-muted/40 transition-colors ${onOpenObject ? 'cursor-pointer' : ''}`}
                      >
                        <ObjectIcon size={13} className="text-muted-foreground shrink-0" />
                        <span className="text-[13px] font-medium text-foreground truncate flex-1 min-w-0">{obj.name}</span>
                        {/* The cells already draw read-only when handed no handler;
                            membership decides whether they get one. */}
                        <div className="w-20 shrink-0" title={why} onClick={(e) => e.stopPropagation()}>
                          <TypeCell
                            value={obj.type ?? null}
                            types={domain?.object_types ?? []}
                            onChange={editable ? (type) => handleObjectUpdate(obj.id, { type }) : undefined}
                            onAddType={canTypes && obj.domain_id ? (name) => handleAddType(obj.domain_id as string, name) : undefined}
                          />
                        </div>
                        <div className="w-24 shrink-0" title={why} onClick={(e) => e.stopPropagation()}>
                          <DueDateCell obj={obj} onObjectUpdate={editable ? handleObjectUpdate : undefined} />
                        </div>
                        <div className="w-28 shrink-0" title={why} onClick={(e) => e.stopPropagation()}>
                          <LeadCell obj={obj} workers={workers} onObjectUpdate={editable ? handleObjectUpdate : undefined} />
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
                  <div className="flex items-center gap-2 bg-muted/30 rounded-md px-2 py-1.5 mb-1">
                    <Search size={12} className="text-muted-foreground" />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder={t('Search Objects across Domains…')}
                      className="flex-1 bg-transparent text-[13px] outline-none"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={closePicker}
                      aria-label={t('Close')}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X size={12} />
                    </button>
                  </div>
                  <div className="max-h-[420px] overflow-auto">
                    <ObjectPickerList grouped={grouped} selectedIds={selectedIds} onToggle={toggleObject} />
                  </div>
                </>
              )}

              {pickerMode === 'create' && (
                <div className="space-y-2 py-1">
                  <input
                    value={newObjectName}
                    onChange={(e) => setNewObjectName(e.target.value)}
                    placeholder={t('Object name')}
                    autoFocus
                    onKeyDown={(e) => {
                      if (isCommitEnter(e)) {
                        e.preventDefault();
                        handleCreateObject();
                      } else if (isCancelKey(e)) {
                        e.preventDefault();
                        closePicker();
                      }
                    }}
                    className="w-full rounded-md bg-transparent px-2 py-1.5 text-[13px] outline-none transition-colors focus:bg-muted/30"
                  />
                  {domains.length > 1 && (
                    <select
                      value={newObjectDomainId ?? domains[0]?.id ?? ''}
                      onChange={(e) => setNewObjectDomainId(e.target.value || null)}
                      aria-label={t('Domain')}
                      className="w-full bg-muted/30 rounded-md px-2 py-1.5 text-[12px] outline-none border-none"
                    >
                      {domains.map((d) => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                  )}
                  <div className="flex items-center justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={closePicker}>
                      {t('Cancel')}
                    </Button>
                    <Button variant="primary" size="sm" disabled={!newObjectName.trim() || creatingObject} onClick={handleCreateObject}>
                      {t('Create')}
                    </Button>
                  </div>
                </div>
              )}
              </PageSection>
            ) : canEdit ? (
              <ButtonAppearanceProvider appearance="inline">
                {objectsMenu(
                  <Button variant="ghost" size="sm" align="start" className="-ml-2 self-start">
                    <Plus size={13} strokeWidth={2.5} />{t('Add Objects')}
                  </Button>,
                )}
              </ButtonAppearanceProvider>
            ) : null}

            {/* Nested Strategies. With none, the section keeps no heading — only
                its "+ verb", like every concept page. */}
            {childStrategies.length > 0 || childPickerOpen ? (
              <PageSection title={t('Strategies')} action={canEdit ? (
                <ButtonAppearanceProvider appearance="navigation">
                  {nestedMenu(
                    <Button variant="ghost" size="icon-xs" aria-label={t('Add nested Strategy')} className="text-muted-foreground">
                      <Plus size={13} />
                    </Button>,
                  )}
                </ButtonAppearanceProvider>
              ) : undefined}>
                {childStrategies.map((child) => {
                  const n = countObjects(child.objectIds);
                  return (
                    <ContentRow key={child.id} icon={<NavStrategyIcon size={13} />} name={child.name}
                      onOpen={() => onOpenStrategy(child.id)}
                      meta={<span>{n === 1 ? t('1 Object') : t('{n} Objects', { n })}</span>}
                      actions={canEdit ? (
                        <ContentRowAction label={t('Remove {name} from this Strategy', { name: child.name })} onClick={() => void unlinkChild(child.id)}>
                          <X size={12} />
                        </ContentRowAction>
                      ) : undefined} />
                  );
                })}

                {childPickerOpen && (
                  <div className="mt-1">
                    <div className="flex items-center gap-2 bg-muted/30 rounded-md px-2 py-1.5 mb-1">
                      <Search size={12} className="text-muted-foreground" />
                      <input
                        value={childQuery}
                        onChange={(e) => setChildQuery(e.target.value)}
                        placeholder={t('Search Strategies…')}
                        className="flex-1 bg-transparent text-[13px] outline-none"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => { setChildPickerOpen(false); setChildQuery(''); }}
                        aria-label={t('Close')}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <X size={12} />
                      </button>
                    </div>
                    <div className="max-h-72 overflow-auto">
                      {childCandidates.length === 0 && (
                        <div className="px-3 py-3 text-[12px] text-muted-foreground">
                          {t('No Strategies match.')}
                        </div>
                      )}
                      {childCandidates.map((s) => (
                        <button
                          type="button"
                          key={s.id}
                          disabled={linkingChildId === s.id}
                          onClick={() => linkChild(s.id)}
                          className="w-full flex items-center gap-2 rounded-md px-3 py-1.5 text-[12px] hover:bg-muted/40 text-left disabled:opacity-50"
                        >
                          <NavStrategyIcon size={11} />
                          <span className="flex-1 truncate text-foreground">{s.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </PageSection>
            ) : canEdit ? (
              <ButtonAppearanceProvider appearance="inline">
                {nestedMenu(
                  <Button variant="ghost" size="sm" align="start" className="-ml-2 self-start">
                    <Plus size={13} strokeWidth={2.5} />{t('Add nested Strategy')}
                  </Button>,
                )}
              </ButtonAppearanceProvider>
            ) : null}
              {/* What the work under these Objects has shipped as code, read
                  against this Strategy's intent. */}
              <InitiativeCodeChanges objects={allObjects.filter((o) => selectedIds.has(o.id))} />
              {/* What the plan rests on and what was chosen on top of it. */}
              <WidgetZone zone="main" columns={1} />
            </InitiativeBoard>
          )}

          {tab === 'audit' && (
            <InitiativeBoard surface="initiative-audit" defaults={INITIATIVE_AUDIT_BOARD} subjectId={strategy.id} host={host} zones={MAIN_ZONES}>
              {/* What was achieved, what stands in the way, what was produced
                  and approved. */}
              <InitiativeMission tab="audit" {...missionProps} />
              {/* The evidence, then the discussion — last, because it grows. */}
              <WidgetZone zone="main" columns={1} />
              <PageSection title={t('Activity')}>
                <StrategyCommentsPanel
                  strategyId={strategy.id}
                  strategyName={strategy.name}
                  strategyOwnerId={strategy.created_by}
                  workers={workers}
                />
              </PageSection>
            </InitiativeBoard>
          )}
        </div>
        </InitiativeIntentProvider>
        </div>
      </div>
    </div>
    </WidgetActionSlotProvider>
    {newChildOpen && (
      <StrategyCreateDialog
        onClose={() => setNewChildOpen(false)}
        onCreated={async (id) => {
          setNewChildOpen(false);
          try {
            await addStrategyChild(strategy.id, id);
          } catch (e) {
            console.error('Failed to nest new Strategy:', e);
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
  const { t } = useI18n();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const grouped = useObjectPicker(query);
  const selectedCount = selectedIds.size;
  const toggleObject = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // The same quick-create card Objects and Elements use: name, description
  // and one pill for the Objects the Strategy bundles. Objects can be
  // chosen or left for later — the detail page has the same picker.
  return (
    <QuickCreatePopup
      open
      icon={<NavStrategyIcon size={12} />}
      contextLabel={t('New Strategy')}
      ariaLabel={t('Quick add Strategy')}
      namePlaceholder={t('Strategy name…')}
      onClose={onClose}
      onSubmit={async ({ name, description }) => {
        const created = await createStrategy({ name, description }, Array.from(selectedIds));
        onCreated(created.id);
      }}
    >
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className={quickCreatePillClass(selectedCount > 0)} aria-label={t('Objects')}>
            <ObjectIcon size={12} />
            <span>{selectedCount === 0 ? t('Objects') : selectedCount === 1 ? t('1 Object') : t('{n} Objects', { n: selectedCount })}</span>
            <ChevronDown size={10} className="opacity-60" />
          </button>
        </PopoverTrigger>
        <MenuShell width="wide" align="start">
          <Command shouldFilter={false}>
            <CommandInput value={query} onValueChange={setQuery} placeholder={t('Search Objects across Domains…')} />
            <CommandList>
              <CommandEmpty>{t('No Objects match.')}</CommandEmpty>
              {grouped.map(([did, { domainName, objects }]) => (
                <CommandGroup key={did} heading={domainName}>
                  {objects.map((o) => (
                    <CommandItem key={o.id} value={`${o.name} ${o.id}`} onSelect={() => toggleObject(o.id)}>
                      <ObjectIcon size={12} /><span className="flex-1 truncate">{o.name}</span>{selectedIds.has(o.id) && <Check size={12} />}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </MenuShell>
      </Popover>
    </QuickCreatePopup>
  );
}
