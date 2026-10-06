'use client';

import { Button } from '@/ui/button';
import { appDialog } from '@/Function/shared/appDialogStore';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Plus, Search, X, MoreHorizontal, Trash2 } from 'lucide-react';
import { NavStrategyIcon } from '@/shell/sidebar/NavIcons';
import { PageIcon } from '@/Function/shared/PageHead';
import { IndexList, IndexRow } from '@/Function/shared/IndexList';
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
import { ObjectIcon } from '@/shell/icons';
import { InitiativeIntentProvider } from '@/ActivitySpace/strategy/initiative/InitiativeIntent';
import { StrategyCommentsPanel } from '@/ActivitySpace/strategy/initiative/StrategyCommentsPanel';
import { SegmentedProgress } from '@/Function/shared/SegmentedProgress';
import { useAuthContext } from '@/providers/AuthProvider';
import { canEditInitiative } from './initiativeAccess';
import { canEditObject, canManageDomainTypes } from '@/ActivitySpace/execution/object/objectAccess';
import { useMyDomainRoles, useMyObjectMemberships } from '@/ActivitySpace/execution/object/useMyMemberships';
import { useInitiativeHealth } from './useInitiativeHealth';
import type { InitiativeHealth } from './initiativeHealthModel';
import { useNow } from '@/Function/shared/useNow';
import { formatRelative } from '@/Function/shared/dateUtils';
import {
  useBoard,
  WidgetSurface,
  WidgetZone,
  INITIATIVE_BOARD,
  type WidgetHost,
  type Zone,
} from '@/Function/widget';
import { DueDateCell, LeadCell, TypeCell } from '@/ActivitySpace/execution/object/ListTable';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import { completionOf } from '@/Function/shared/completion';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { resolveVision, useVisions } from '@/ActivitySpace/strategy/vision/data';
import { initiativesOfVision } from '@/ActivitySpace/strategy/portfolio/portfolioGroups';
import { useActiveObjectCount } from '@/hooks/useObjectArchive';

/** A Initiative page has a band and one column of readings; no side rail. */
const INITIATIVE_ZONES: Zone[] = ['band', 'main'];

// =============================================================
// StrategyShell — the Strategy layer's "Initiative" app (code keeps the
// `strategy`/`strategies` naming — table, hooks, view id — display text says
// "Initiative" throughout): a list-and-detail surface. The root is the
// Initiative list — only TOP-LEVEL Initiatives (no parent in strategy_children)
// show there; a Initiative nested inside another only appears in its parent's
// "Initiatives" section. Selecting a row pushes into that Initiative's detail
// page (title, description, nested Initiatives, Object scope — no Properties
// rail, mirrors ElementDetailView minus the side rail).
// =============================================================

export function StrategyShell({
  visionId,
  activeStrategyId,
  onSelectStrategy,
  onOpenObject,
  onOpenDomain,
  createRequested,
  onCreateHandled,
}: {
  /** The Vision whose Initiatives the root list shows (null = the Space's
   *  first). With no Vision in the Space the list shows every Initiative. */
  visionId?: string | null;
  /** Which Initiative the detail page shows; null = the root Initiative list.
   *  Controlled by the caller (navigation.strategyId) so other surfaces can
   *  deep-link straight into a Initiative. */
  activeStrategyId?: string | null;
  onSelectStrategy?: (id: string | null) => void;
  /** Jump to an Object's detail (the Execution "objects" view). Objects can
   *  span Domains, so the caller also gets the Object's domain_id to switch
   *  the active Domain context before navigating. */
  onOpenObject?: (objectId: string, domainId: string | null) => void;
  onOpenDomain?: (domainId: string) => void;
  /** The sidebar's "+" asked for a new Initiative (navigation.strategyCreate).
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
  // The root list only shows top-level Initiatives — nested ones surface
  // inside their parent's "Initiatives" section instead.
  const rootStrategies = useMemo(() => strategies.filter((s) => s.parentIds.length === 0), [strategies]);
  // Initiatives hang under a Vision, like Elements under a Domain: the list
  // is the active Vision's, followed by the ones no Vision holds yet.
  const { t } = useI18n();
  const spaceId = useActiveSpaceId();
  const { data: visions } = useVisions(spaceId);
  const vision = resolveVision(visions, visionId);
  const { inVision, unplaced } = useMemo(
    () => (vision ? initiativesOfVision(strategies, vision.id) : { inVision: rootStrategies, unplaced: [] }),
    [strategies, rootStrategies, vision]);

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
      <div className="h-[50px] flex items-center gap-1.5 pl-4 pr-2 border-b border-border/60 bg-card flex-shrink-0">
        <NavStrategyIcon size={12} />
        <span className="text-[12px] font-semibold text-foreground">Initiatives</span>
        <div className="flex-1" />
        <Button variant="ghost" size="icon-xs" className="text-muted-foreground"
          type="button"
          onClick={() => setNewOpen(true)}
          title="Add Initiative"
          aria-label="Add Initiative"
        >
          <Plus size={14} />
        </Button>
      </div>

      <div className="flex-1 overflow-hidden">
        {loading ? null : inVision.length === 0 && unplaced.length === 0 ? (
          <EmptyPrompt onCreate={() => setNewOpen(true)} />
        ) : (
          <div className="h-full overflow-auto">
            {inVision.length > 0 && (
              <StrategyListView strategies={inVision} onSelectStrategy={(s) => setOpenStrategyId(s.id)} />
            )}
            {unplaced.length > 0 && (
              <>
                <div className="px-6 pt-4 text-[11px] font-semibold tracking-wide text-muted-foreground/60">{t('Not in a Vision')}</div>
                <StrategyListView strategies={unplaced} onSelectStrategy={(s) => setOpenStrategyId(s.id)} showHeader={inVision.length === 0} />
              </>
            )}
          </div>
        )}
      </div>

      {newOpen && (
        <StrategyCreateDialog
          visionId={vision?.id ?? null}
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
function EmptyPrompt({ onCreate }: { onCreate: () => void }) {
  return (
    <EmptyState
      icon={NavStrategyIcon}
      title="Add Initiatives"
      description="An Initiative groups Objects across Domains around one outcome — what to achieve and how to win."
      hint="Each Initiative gets its own timeline and resource view."
      cta="Create Initiative"
      onCta={onCreate}
    />
  );
}

// =============================================================
// Root Initiative list — the entire root view. Selecting a row pushes
// into that Initiative's detail page.
// =============================================================
// What a person scans the list for, and nothing more: how far along, how
// recently anything moved, and whether something is on fire. Counts come from
// the same predicates the Initiative page uses (initiativeRiskModel), so the
// row never disagrees with the page it opens. Quiet register throughout — a
// row is not the place to shout; the number is the signal.
function InitiativeHealthCell({ health }: { health: InitiativeHealth | undefined }) {
  if (!health) {
    return <span className="text-[11px] text-muted-foreground/50">…</span>;
  }
  const { risk } = health;
  const alerts: string[] = [];
  if (risk.overdue > 0) alerts.push(`${risk.overdue} overdue`);
  if (risk.stalled > 0) alerts.push(`${risk.stalled} stalled`);
  if (risk.blocked > 0) alerts.push(`${risk.blocked} blocked`);
  const moved = health.lastActivityAt !== null
    ? formatRelative(new Date(health.lastActivityAt).toISOString())
    : null;
  const unmeasured = health.risk.openTotal > 0 && !health.scheduleMeasured;
  return (
    <div className="flex items-center gap-3 min-w-0 text-[11px] text-muted-foreground tabular-nums">
      {health.progressPct === null ? (
        <span className="shrink-0 text-muted-foreground/60">No Elements</span>
      ) : (
        <span className="flex items-center gap-1.5 shrink-0 w-24">
          <SegmentedProgress value={health.progressPct} className="flex-1" />
          <span className="w-7 text-right">{health.progressPct}%</span>
        </span>
      )}
      {/* An empty Initiative already said "No Elements"; "No activity" would
          be the same fact twice. */}
      {!(health.total === 0 && moved === null) && (
        <span className="shrink-0 min-w-0 truncate text-muted-foreground/70" title={moved ? `Last movement ${moved}` : 'Nothing has reported yet'}>
          {moved ?? 'No activity'}
        </span>
      )}
      {alerts.length > 0 ? (
        <span
          className="min-w-0 truncate text-foreground/80"
          // The alerts take the slot, but an unmeasured schedule is still a
          // fact — it rides in the title rather than costing width.
          title={unmeasured ? `${alerts.join(' · ')} — open Elements carry no due dates, so the schedule is unmeasured` : alerts.join(' · ')}
        >
          {alerts.join(' · ')}
        </span>
      ) : unmeasured ? (
        // 0 overdue with no dated work is not "on time" — it is unmeasured.
        <span className="min-w-0 truncate text-muted-foreground/60" title="Open Elements carry no due dates, so the schedule is unmeasured">No dates</span>
      ) : null}
    </div>
  );
}

function StrategyListView({
  strategies,
  onSelectStrategy,
  showHeader = true,
}: {
  strategies: StrategyWithObjects[];
  onSelectStrategy: (strategy: StrategyWithObjects) => void;
  /** The column headings; a second list under the first leaves them out. */
  showHeader?: boolean;
}) {
  const { t } = useI18n();
  // Health for every row from one read (progress / last movement / risk).
  const { byId: health } = useInitiativeHealth(strategies);
  // Archived Objects stay linked but are not counted.
  const countObjects = useActiveObjectCount();
  // Subscribe to the shared tick so "Today" / "3m ago" in the cells ages
  // honestly while the list stays open; the cells re-render with this view.
  useNow();
  return (
    <IndexList headers={[t('Name'), t('Health'), t('Objects')]} showHeader={showHeader}>
      {strategies.map((s) => (
        <IndexRow key={s.id} icon={<NavStrategyIcon size={13} />} name={s.name}
          health={<InitiativeHealthCell health={health.get(s.id)} />}
          count={countObjects(s.objectIds)}
          onOpen={() => onSelectStrategy(s)} />
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
  const [description, setDescription] = useState(strategy.description ?? '');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(strategy.objectIds));
  const [query, setQuery] = useState('');
  // Objects section starts collapsed to the selected chips — "+" reveals
  // either the cross-Domain search picker or a quick inline create form.
  const [pickerMode, setPickerMode] = useState<'closed' | 'search' | 'create'>('closed');
  const [newObjectName, setNewObjectName] = useState('');
  const [newObjectDomainId, setNewObjectDomainId] = useState<string | null>(null);
  const [creatingObject, setCreatingObject] = useState(false);
  // Nested Initiatives — "+" offers picking an
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
  const canEdit = canEditInitiative(userId, strategy.created_by);
  // The Object rows write to objects / domains, which answer to Object
  // membership and Domain role — not to who owns the Initiative.
  const { data: myObjects } = useMyObjectMemberships(userId);
  const { data: myDomainRoles } = useMyDomainRoles(userId);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setName(strategy.name);
    setSaveError(null);
    setDescription(strategy.description ?? '');
    setSelectedIds(new Set(strategy.objectIds));
  }, [strategy.id, strategy.name, strategy.description, strategy.objectIds]);

  // Only collapse the Objects picker on an actual Strategy switch — not on
  // every objectIds refetch triggered by toggling a selection.
  useEffect(() => {
    setPickerMode('closed');
  }, [strategy.id]);

  const nameRef = useRef<HTMLTextAreaElement | null>(null);
  const descriptionRef = useRef<HTMLTextAreaElement | null>(null);
  useAutoGrowTextarea(nameRef, name);
  useAutoGrowTextarea(descriptionRef, description);

  const { data: domains, refetch: refetchDomains } = useDomains();
  const { objects: allObjects, refetch: refetchObjects } = useAllObjects();
  // Nested Initiatives' counts leave archived Objects out, like the list.
  const countObjects = useActiveObjectCount();

  // A Initiative's Elements are the union of its Objects' Elements. That one
  // line is all it takes for every Element-counting widget already in the
  // registry — Milestones, Overdue, Upcoming, Team, the charts — to answer
  // for a Initiative as well as for an Object.
  const initiativeElements = useMemo(() => {
    const scope = new Set(strategy.objectIds);
    return allObjects.filter((o) => scope.has(o.id)).flatMap((o) => o.elements ?? []);
  }, [allObjects, strategy.objectIds]);

  // Surface key stays 'campaign' — it's the first half of the persisted
  // widget_boards.board_key ('campaign:<id>'), not a display string. Renaming
  // it would orphan every board a user already saved under the old key.
  const board = useBoard('campaign', INITIATIVE_BOARD, strategy.id);
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
    // strategy_children's INSERT policy needs the caller to own the child as
    // well as the parent, so a colleague's Initiative — visible since the
    // Space-wide SELECT — is not something this picker may offer.
    return allStrategies.filter((s) =>
      !ancestorIds.has(s.id) &&
      !existingChildIds.has(s.id) &&
      canEditInitiative(userId, s.created_by) &&
      (q === '' || s.name.toLowerCase().includes(q)));
  }, [allStrategies, ancestorIds, childStrategies, childQuery, userId]);

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
      console.error('Failed to nest Initiative:', e);
      setSaveError('Could not nest that Initiative');
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
      console.error('Failed to un-nest Initiative:', e);
      setSaveError('Could not remove that Initiative');
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
      setSaveError('Could not change the Object — only its members can');
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
      setSaveError('Could not add the Type — only the Domain\'s owner or admin can');
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
      console.error('Failed to delete Initiative:', e);
      setDeleteError(e instanceof Error ? e.message : 'Could not delete the Initiative');
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
      console.error('Failed to rename Initiative:', e);
      setName(strategy.name);
      setSaveError('Could not save the name');
    }
  };

  const saveDescription = async () => {
    const trimmed = description.trim() || null;
    if (trimmed === (strategy.description ?? null)) return;
    if (!canEdit) { setDescription(strategy.description ?? ''); return; }
    try {
      await updateStrategy(strategy.id, { description: trimmed });
      setSaveError(null);
      onSaved();
    } catch (e) {
      console.error('Failed to save Initiative description:', e);
      setDescription(strategy.description ?? '');
      setSaveError('Could not save the description');
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
      console.error('Failed to update Initiative Objects:', e);
      setSelectedIds(previous);
      setSaveError('Could not change the Objects');
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

  return (
    <>
    <ConfirmDialog
      open={confirmingDelete}
      title={`Delete "${strategy.name}"?`}
      description="Its Intents, comments, and nesting links are deleted. Linked Objects stay. This can't be undone."
      busy={deleting}
      onConfirm={() => { void handleDelete(); }}
      onCancel={() => setConfirmingDelete(false)}
    />
    <div ref={rootRef} className="flex-1 flex flex-col overflow-hidden bg-card h-full">
      <div className="h-[50px] flex items-center gap-1 px-4 border-b border-border/60 bg-card flex-shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="px-1.5 py-0.5 rounded text-[12px] font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
        >
          Initiative
        </button>
        <ChevronRight size={12} className="text-muted-foreground/40 flex-shrink-0" />
        <span className="px-1.5 py-0.5 text-[12px] font-semibold text-foreground truncate max-w-[240px]">
          {strategy.name}
        </span>
        {!canEdit && (
          // Said once, where the eye lands first. The Initiative's own
          // structure — name, description, Objects, nested Initiatives —
          // is locked to match. The board's intent sections keep their own
          // policy and report their own failures (ELE_STR-025).
          <span
            className="ml-1 px-1.5 py-0.5 rounded-full bg-muted/60 ring-1 ring-border/60 text-[11px] text-foreground/90"
            title="Only the Initiative's owner can edit it"
          >
            Read-only
          </span>
        )}
        <div className="ml-auto flex min-w-0 items-center gap-2">
          {(deleteError || saveError) && (
            <span role="status" className="text-[11px] text-muted-foreground truncate">
              {deleteError ?? `${saveError} — change reverted`}
            </span>
          )}
          {canEdit && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Initiative actions"
                  className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors"
                >
                  <MoreHorizontal size={14} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setConfirmingDelete(true)} disabled={deleting} className="text-destructive">
                  <Trash2 size={13} /> Delete Initiative
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto px-8 py-8">
        {/* The Intent read is mounted here, above the board, because the
            three sections that use it must share one — see InitiativeIntent. */}
        <InitiativeIntentProvider key={strategy.id} initiativeId={strategy.id} initiativeName={strategy.name} createdBy={strategy.created_by}>
        <WidgetSurface board={board} host={host} zones={INITIATIVE_ZONES} className="space-y-5">
          <WidgetZone zone="band" className="mb-4" />
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
              placeholder="Initiative name"
              readOnly={!canEdit}
              aria-readonly={!canEdit}
              tabIndex={canEdit ? undefined : -1}
              className="w-full text-2xl font-semibold text-foreground bg-transparent border-none resize-none leading-tight overflow-hidden tracking-normal"
            />
          </div>
          <textarea
            ref={descriptionRef}
            value={description}
            rows={1}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={saveDescription}
            onKeyDown={(e) => {
              // Multi-line: Enter is a newline; Cmd/Ctrl+Enter and Escape
              // end the edit and save.
              if (isSubmitChord(e) || isCancelKey(e)) {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            placeholder={canEdit ? 'Add description...' : ''}
            readOnly={!canEdit}
            aria-readonly={!canEdit}
            tabIndex={canEdit ? undefined : -1}
            className="w-full text-[14px] text-foreground leading-relaxed bg-transparent border-none min-h-[36px] resize-none overflow-hidden"
          />

          {/* The board. Everything a Initiative says about itself that is not
              its own structure lives here: the readings taken off the
              execution (Situation, Risk) and the sections someone writes by
              hand (Measures, Assumptions, Decisions). The sections below this
              — nested Initiatives, Objects, Activity — are how the Initiative is
              composed rather than how it is going, so they stay the page's
              spine and are not placeable. Frameworks used to sit among them;
              it is two widgets now (OKR, Gap analysis), because a framework is
              a reading of the board rather than a part of it. */}
          <WidgetZone zone="main" columns={1} />

          <section>
            <div className="h-px bg-border mb-3" />
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-[13px] font-medium text-foreground/90">Initiatives</h2>
              {canEdit && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Add nested Initiative"
                    className="flex items-center justify-center size-5 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                  >
                    <Plus size={13} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setChildPickerOpen(true)}>
                    <Search size={13} className="mr-1.5" /> Add existing Initiative
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setNewChildOpen(true)}>
                    <Plus size={13} className="mr-1.5" /> Create Initiative
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              )}
            </div>

            {childStrategies.length === 0 && childPickerOpen === false && (
              <div className="text-[12px] text-muted-foreground/50 py-1">
                {t('No nested Initiatives yet — group related Initiatives here.')}
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
                      {countObjects(child.objectIds)} object{countObjects(child.objectIds) === 1 ? '' : 's'}
                    </span>
                    {canEdit && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); void unlinkChild(child.id); }}
                      aria-label={`Remove ${child.name} from this Initiative`}
                      className="shrink-0 flex items-center justify-center size-5 rounded text-muted-foreground opacity-0 group-hover/row:opacity-100 hover:text-foreground hover:bg-muted/40 transition-opacity"
                    >
                      <X size={12} />
                    </button>
                    )}
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
                    placeholder="Search Initiatives…"
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
                      No Initiatives match
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
              {canEdit && (
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
              )}
            </div>

            {selectedIds.size > 0 && (
              <div className="mb-2">
                {Array.from(selectedIds).map((id) => {
                  const obj = allObjects.find((o) => o.id === id);
                  if (!obj) return null;
                  const domain = obj.domain_id ? domains.find((d) => d.id === obj.domain_id) : undefined;
                  const progress = completionOf(obj.elements ?? []).pct;
                  const editable = canEditObject(myObjects, obj.id);
                  const canTypes = editable && canManageDomainTypes(myDomainRoles, obj.domain_id);
                  const why = editable ? undefined : 'Only members of this Object can change it';
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
                      {/* The cells already draw read-only when handed no handler;
                          membership decides whether they get one. */}
                      <div className="w-20 shrink-0" title={why} onClick={(e) => e.stopPropagation()}>
                        <TypeCell
                          value={obj.type ?? null}
                          types={domain?.object_types ?? []}
                          onChange={editable ? (t) => handleObjectUpdate(obj.id, { type: t }) : undefined}
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
                    if (isCommitEnter(e)) {
                      e.preventDefault();
                      handleCreateObject();
                    } else if (isCancelKey(e)) {
                      e.preventDefault();
                      closePicker();
                    }
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
              the Initiative's current state and stay a fixed height, while this
              one grows downward as the Initiative is discussed. */}
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
        </InitiativeIntentProvider>
        </div>
      </div>
    </div>
    {newChildOpen && (
      <StrategyCreateDialog
        // A nested Initiative sits in its parent's Vision.
        visionId={strategy.vision_id}
        onClose={() => setNewChildOpen(false)}
        onCreated={async (id) => {
          setNewChildOpen(false);
          try {
            await addStrategyChild(strategy.id, id);
          } catch (e) {
            console.error('Failed to nest new Initiative:', e);
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
  visionId,
  onClose,
  onCreated,
}: {
  /** The Vision the new Initiative is placed under. */
  visionId: string | null;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
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
  // and one pill for the Objects the Initiative bundles. Objects can be
  // chosen or left for later — the detail page has the same picker.
  return (
    <QuickCreatePopup
      open
      icon={<NavStrategyIcon size={12} />}
      contextLabel="New Initiative"
      ariaLabel="Quick add Initiative"
      namePlaceholder="Initiative name…"
      onClose={onClose}
      onSubmit={async ({ name, description }) => {
        const created = await createStrategy({ name, description, vision_id: visionId }, Array.from(selectedIds));
        onCreated(created.id);
      }}
    >
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className={quickCreatePillClass(selectedCount > 0)} aria-label="Objects">
            <ObjectIcon size={12} />
            <span>{selectedCount > 0 ? `${selectedCount} Object${selectedCount === 1 ? '' : 's'}` : 'Objects'}</span>
            <ChevronDown size={10} className="opacity-60" />
          </button>
        </PopoverTrigger>
        <MenuShell width="wide" align="start">
          <Command shouldFilter={false}>
            <CommandInput value={query} onValueChange={setQuery} placeholder="Search Objects across Domains…" />
            <CommandList>
              <CommandEmpty>No Objects match.</CommandEmpty>
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
