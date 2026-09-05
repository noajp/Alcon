'use client';

import { STATUS, PRIORITY } from '@/shared/designTokens';
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Calendar, User, Link2, Plus, Clock, CheckCircle2, XCircle, Tag,
  Ban, Send, Circle, Flag, History, Timer,
  ChevronRight, ChevronLeft, Pencil,
  Check, Compass,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';
import { Calendar as DateCalendar } from '@/ui/calendar';
import { getCachedWeekStartsOn, usePreference } from '@/alcon/settings/preferencesStore';
import type { DateRange } from 'react-day-picker';
import type { ElementWithDetails, Worker } from '@/hooks/useSupabase';
import {
  updateElement,
  updateSubelement,
  deleteSubelement,
  fetchAllWorkers,
  addElementAssignee,
  removeElementAssignee,
  setCustomColumnValue,
  notifyMany,
  useAgentRun,
  useDomains,
  addDomainElementType,
  fetchObjectLabels,
  setDomainLabelColor,
  toggleReaction,
} from '@/hooks/useSupabase';
import {
  useElementReactions,
  useElementEdges,
  useElementMemberObjects,
  useElementCustomColumns,
} from '@/alcon/element/elementDetailQueries';
import { CustomColumnCell } from '@/alcon/property';
import type { Subelement, Json } from '@/types/database';
import { ElementProgressMark, getElementProgress } from '@/alcon/shared/ElementProgressMark';
import { WorkerAvatarStack } from '@/alcon/shared/WorkerAvatar';
import { workerTriggerLabel } from '@/alcon/shared/workerReach';
import { AssigneeMenuContent } from '@/alcon/shared/AssigneeMenu';
import { labelColor, labelColorKey, domainLabelNames, useLabelColors, setLabelColorLocal, hydrateLabelColors } from '@/alcon/shared/labelColor';
import { LabelPaletteRows } from '@/alcon/shared/LabelPaletteRows';
import { MenuShell } from '@/alcon/shared/menu';
import { RailCard } from '@/alcon/shared/RailCard';
import {
  useBoard,
  WidgetSurface,
  WidgetZone,
  ELEMENT_DETAIL_BOARD,
  type WidgetHost,
  type Zone,
} from '@/alcon/widget';

/** The Element rail is the only zone its board renders. */
const ELEMENT_ZONES: Zone[] = ['rail'];
import { RailRow } from '@/alcon/shared/RailRow';
import { PriorityMark } from '@/alcon/shared/PriorityMark';
import { ElementTypeIcon, ObjectIcon } from '@/shell/icons';
import { StatusPicker } from './StatusPicker';
import { ElementDirectionSection } from './ElementDirectionSection';
import { SubelementRow } from './SubelementRow';
import { SubelementBulkBar } from './SubelementBulkBar';
import { useElementSelection } from './useElementSelection';
import { SubelementDetailModal } from './SubelementDetailModal';
import { ElementCommentsPanel } from './ElementCommentsPanel';
import { ElementApprovalMenu } from './ElementApprovalMenu';
import { ElementActionsMenu } from './ElementActionsMenu';
import { Smile, FileText } from 'lucide-react';
import { isCancelKey, isCommitEnter, isSubmitChord, useCancelOnEscape, useEscapeLayer } from '@/alcon/shared/keyboard';
import { NotePicker } from '@/alcon/brief/NotePicker';
import { LinkedNoteEmbed } from '@/alcon/brief/LinkedNoteEmbed';
import { logActivity, loadActivity, type ActivityEntry as LoggedActivity, type ActivityKind } from './elementActivity';
import { useAuthContext } from '@/providers/AuthProvider';
import { getActiveDomainId } from '@/alcon/domain/domainsStore';
import { formatElementDate } from '@/alcon/shared/dateUtils';
import { MessageIcon } from '@/alcon/shared/conceptIcons';

// Date <-> 'YYYY-MM-DD' helpers for the range picker. Built from local
// Y/M/D parts (not Date.parse of a bare ISO date, which would shift across
// timezones and select the wrong day).
const toYMD = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseYMD = (s?: string | null): Date | undefined => {
  if (!s) return undefined;
  const [y, m, d] = s.split('T')[0].split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d) : undefined;
};

interface ElementDetailViewProps {
  element: ElementWithDetails;
  objectName?: string;
  objectPath?: { id: string; name: string }[];
  /** Active Domain name — top segment in the breadcrumb. */
  domainName?: string | null;
  onBack: () => void;
  onRefresh?: () => void;
  /** Where the breadcrumb's root segment goes — required even when
   *  `domainName` is null, because that's exactly when the root segment
   *  becomes this Element's only way back to where it was opened from
   *  (see the breadcrumb render below). */
  onNavigateRoot: () => void;
  onNavigateObject?: (objectId: string) => void;
  /** Open a Campaign on the Strategy surface — the return leg of the round
   *  trip, taken from the Decisions & assumptions widget. Optional because
   *  some hosts (Inbox, My Elements) have no Strategy surface to hand off to;
   *  the widget then names the Campaign without a link. */
  onOpenStrategy?: (strategyId: string) => void;
  /** Opened from a notification about one comment — see ElementCommentsPanel. */
  focusCommentId?: string | null;
}


// ============================================
// Status & Priority options
// ============================================
const statusOptions = [
  { status: 'backlog', label: STATUS.backlog.label, icon: Circle, color: 'text-muted-foreground' },
  { status: 'todo', label: STATUS.todo.label, icon: Circle, color: 'text-muted-foreground' },
  { status: 'in_progress', label: STATUS.in_progress.label, icon: Clock, color: 'text-amber-400' },
  { status: 'review', label: STATUS.review.label, icon: Send, color: 'text-blue-400' },
  { status: 'done', label: STATUS.done.label, icon: CheckCircle2, color: 'text-indigo-400' },
  { status: 'blocked', label: STATUS.blocked.label, icon: XCircle, color: 'text-red-400' },
  { status: 'cancelled', label: STATUS.cancelled.label, icon: Ban, color: 'text-muted-foreground' },
];

const priorityOptions = [
  { priority: 'urgent', label: PRIORITY.urgent.label, color: 'text-orange-400' },
  { priority: 'high', label: PRIORITY.high.label, color: 'text-amber-400' },
  { priority: 'medium', label: PRIORITY.medium.label, color: 'text-muted-foreground' },
  { priority: 'low', label: PRIORITY.low.label, color: 'text-muted-foreground/70' },
];

// ============================================
// Types for local-only features (until DB tables exist)
// ============================================
// Activity entries live in elementActivity.ts (localStorage-backed). The
// detail screen renders both the persisted log + a derived "created"
// entry pulled from element.created_at.

// ============================================
// Relative time formatter
// ============================================
function timeAgo(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ============================================
// Main Component
// ============================================
export function ElementDetailView({
  element,
  objectName: _objectName,
  objectPath,
  domainName,
  onBack,
  onRefresh,
  onNavigateRoot,
  onNavigateObject,
  onOpenStrategy,
  focusCommentId,
}: ElementDetailViewProps) {
  const weekStartsOn = usePreference(getCachedWeekStartsOn);

  // The rail's board. Only the return leg lives on it for now — Properties,
  // Labels and Activity below are still hand-placed islands.
  const board = useBoard('element-detail', ELEMENT_DETAIL_BOARD);
  const host = useMemo<WidgetHost>(
    () => ({
      subject: { kind: 'element', id: element.id },
      elements: [element],
      onRefresh,
      onNavigate: onOpenStrategy
        ? (nav) => { if (nav.strategyId) onOpenStrategy(nav.strategyId); }
        : undefined,
    }),
    [element, onRefresh, onOpenStrategy],
  );
  const [title, setTitle] = useState(element.title);
  const [description, setDescription] = useState(element.description || '');
  // Auto-grow the title textarea so long titles wrap into multiple
  // visible rows. We re-measure on value change.
  const titleRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [title]);
  // Same auto-grow for the description — otherwise a long description
  // clips at min-h and scrolls inside its own tiny box instead of letting
  // the page grow, which reads as a broken nested-scroll region.
  const descriptionRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = descriptionRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [description]);

  // Esc goes back to the list this Element was opened from — one level.
  // Anything open above the page (a picker, the Subelement modal, a field
  // cancelling its own edit) takes the key first; the page gets the next one.
  // The root ref keeps an Escape typed into a field elsewhere (the sidebar's
  // rename, say) from counting as this page's.
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEscapeLayer(true, onBack, rootRef);

  // Escape in the title / description is a cancel: put the saved value back
  // and make the blur that follows skip its save — see useCancelOnEscape.
  const titleCancel = useCancelOnEscape();
  const descriptionCancel = useCancelOnEscape();

  // Reactions on this Element — cached per Element, refreshed on toggle.
  const { reactions, refresh: refreshReactions } = useElementReactions(element.id);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  useEscapeLayer(emojiPickerOpen, () => setEmojiPickerOpen(false));
  // Subelement create / detail modal — null when closed; { mode: 'create' }
  // for the new-sub-element popup; { mode: 'detail', subelement } for editing.
  const [subModal, setSubModal] = useState<
    | { mode: 'create' }
    | { mode: 'detail'; subelement: Subelement }
    | null
  >(null);

  // Edges — cached per Element.
  const edges = useElementEdges(element.id);

  // Workers for assignee management
  const [allWorkers, setAllWorkers] = useState<Worker[]>([]);
  const [, setShowAssigneeDropdown] = useState(false);

  // Custom columns — element-centric: the union of Properties placed on every
  // list this Element is homed in (primary Object + element_objects junction
  // homes), Asana's "task detail shows the fields of every project it's in".
  // Which list the panel was opened from doesn't matter. Cached per Element.
  const { customColumns, reload: reloadCustomColumns } = useElementCustomColumns(element.id, element.object_id);

  // Domain-shared Element types — the option list for the required `type`.
  const { data: domains, refetch: refetchDomains } = useDomains();
  const [domainId] = useState<string | null>(() => getActiveDomainId());
  const elementTypes = useMemo(
    () => domains.find((d) => d.id === domainId)?.element_types ?? [],
    [domains, domainId],
  );
  // Feed the Domain's Label colour catalogue into the shared store so chips +
  // pickers render the picked colours.
  useEffect(() => {
    const d = domains.find((x) => x.id === domainId);
    if (d) hydrateLabelColors(d.id, d.label_colors);
  }, [domains, domainId]);

  const handleTypeChange = async (newType: string | null) => {
    try {
      await updateElement(element.id, { type: newType });
      onRefresh?.();
    } catch (e) { console.error('Failed to update type:', e); }
  };

  const handleCreateType = async (name: string) => {
    if (!domainId) return;
    try {
      await addDomainElementType(domainId, name);
      await refetchDomains();
    } catch (e) { console.error('Failed to add element type:', e); }
  };

  const handleLabelsChange = async (labels: string[]) => {
    try {
      await updateElement(element.id, { labels });
      onRefresh?.();
    } catch (e) { console.error('Failed to update labels:', e); }
  };

  // Auth context for notifications + comment authorship
  const { user, profile } = useAuthContext();

  // Emoji picker → element_reactions toggle. Quick set mirrors the
  // comments panel so users see a familiar palette.
  const QUICK_EMOJI = useMemo(() => ['👍', '🎉', '❤️', '👀', '🚀', '✅'], []);
  const handleEmojiPick = async (emoji: string) => {
    setEmojiPickerOpen(false);
    if (!user?.id) return;
    try {
      const action = await toggleReaction({ userId: user.id, emoji, elementId: element.id });
      log('note', action === 'added' ? `Reacted ${emoji}` : `Removed reaction ${emoji}`);
      await refreshReactions();
    } catch (e) {
      console.error('Toggle reaction failed', e);
    }
  };

  // Comments are now DB-backed via ElementCommentsPanel.

  // AI agent execution — Symphony-style autonomous run for this Element.
  // (The quick-start button was removed; the run still surfaces in comments.)
  const agent = useAgentRun(element.id);
  // When a run finishes it moves the Element to "review" and posts its
  // deliverable as a comment — refresh the parent so the status updates.
  // (The comments panel is remounted via a finished_at-based key below.)
  const agentWasActive = useRef(false);
  // Multi-select for the sub-element checklist — same hook the Elements list
  // uses. `hasSubSelectionRef` lets a plain row click replace the selection
  // without re-rendering every row when the "anything selected" flag flips.
  const subSelection = useElementSelection();
  const hasSubSelectionRef = useRef(false);
  useEffect(() => {
    if (agent.isActive) {
      agentWasActive.current = true;
    } else if (agentWasActive.current) {
      agentWasActive.current = false;
      onRefresh?.();
    }
  }, [agent.isActive, onRefresh]);

  // Activity log — persisted entries from localStorage + a synthetic
  // "created" entry derived from element.created_at. We bump
  // `activityTick` on each log() call to force a re-read.
  const [activityTick, setActivityTick] = useState(0);
  const loggedActivity = useMemo<LoggedActivity[]>(
    () => loadActivity(element.id),
    // activityTick is the cache-busting key here, not the element.id alone
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [element.id, activityTick]
  );
  const activityLog = useMemo(() => {
    const entries: { id: string; kind: ActivityKind | 'created'; detail: string; author: string; createdAt: Date }[] =
      loggedActivity.map((e) => ({
        id: e.id,
        kind: e.kind,
        detail: e.detail,
        author: e.author,
        createdAt: new Date(e.created_at),
      }));
    if (element.created_at) {
      entries.push({
        id: 'created',
        kind: 'created',
        detail: `Created “${element.title}”`,
        author: 'System',
        createdAt: new Date(element.created_at),
      });
    }
    return entries.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }, [loggedActivity, element.created_at, element.title]);

  // Convenience wrapper around logActivity that bumps the tick.
  const author = (profile?.display_name || user?.email?.split('@')[0] || 'You');
  const log = (kind: ActivityKind, detail: string) => {
    logActivity(element.id, kind, detail, author);
    setActivityTick((t) => t + 1);
  };

  // Member Objects — every Object this Element is homed under (primary FK +
  // element_objects multi-homing). Rows click through to the Object.
  const memberObjects = useElementMemberObjects(element.id, element.object_id);

  // Estimated hours — a standalone planning field in Properties (time
  // tracking was removed, so there's no actual-vs-estimate comparison).
  const [estimatedHours, setEstimatedHours] = useState<string>(element.estimated_hours?.toString() || '');

  // Active left tab

  const currentStatus = statusOptions.find(s => s.status === element.status) || statusOptions[1];
  const currentPriority = priorityOptions.find(p => p.priority === element.priority) || priorityOptions[2];

  // Sync with prop changes
  useEffect(() => {
    setTitle(element.title);
    setDescription(element.description || '');
    setEstimatedHours(element.estimated_hours?.toString() || '');
  }, [element.id, element.title, element.description, element.estimated_hours]);

  useEffect(() => { fetchAllWorkers(domainId).then(setAllWorkers).catch(console.error); }, [domainId]);
  const handleCustomChange = useCallback(async (columnId: string, value: Json) => {
    try {
      await setCustomColumnValue(columnId, element.id, value);
      reloadCustomColumns();
    } catch (e) {
      console.error('Failed to save property', e);
    }
  }, [element.id, reloadCustomColumns]);

  // Handlers
  const handleTitleSave = async () => {
    if (titleCancel.consumeCancel()) return;
    if (title.trim() && title !== element.title) {
      try {
        await updateElement(element.id, { title: title.trim() });
        log('renamed', `Renamed to “${title.trim()}”`);
        onRefresh?.();
      } catch (e) { console.error(e); }
    }
  };

  const handleDescriptionSave = async () => {
    if (descriptionCancel.consumeCancel()) return;
    if (description !== (element.description || '')) {
      try {
        await updateElement(element.id, { description: description || null });
        log('description', description ? 'Updated description' : 'Cleared description');
        onRefresh?.();
      } catch (e) { console.error(e); }
    }
  };

  const handleDirectionSave = (detail: string) => {
    // ElementDirectionSection has already persisted the merged direction;
    // this just records the activity-log entry and refreshes the parent.
    log('direction', detail);
    onRefresh?.();
  };

  const handleStatusChange = async (newStatus: string) => {
    // StatusPicker has already persisted the status change; this just
    // records the activity-log entry and notifies assignees.
    try {
      const newLabel = statusOptions.find((s) => s.status === newStatus)?.label ?? newStatus;
      log('status', `Status → ${newLabel}`);
      const assigneeUserIds = (element.assignees || [])
        .map(a => a.worker?.user_id)
        .filter((u): u is string => !!u && u !== user?.id);
      if (assigneeUserIds.length > 0) {
        const actorName = profile?.display_name || user?.email?.split('@')[0] || 'Someone';
        await notifyMany(assigneeUserIds, {
          actor_id: user?.id ?? null,
          actor_name: actorName,
          kind: 'status_change',
          element_id: element.id,
          title: `${actorName} changed status to ${newStatus.replace('_', ' ')}`,
          body: element.title,
        });
      }
      onRefresh?.();
    } catch (e) { console.error(e); }
  };

  const handlePriorityChange = async (newPriority: string) => {
    try {
      await updateElement(element.id, { priority: newPriority as 'medium' });
      const newLabel = priorityOptions.find((p) => p.priority === newPriority)?.label ?? newPriority;
      log('priority', `Priority → ${newLabel}`);
      onRefresh?.();
    } catch (e) { console.error(e); }
  };

  const handleDateChange = async (field: 'start_date' | 'due_date', value: string) => {
    try {
      await updateElement(element.id, { [field]: value || null });
      const fieldName = field === 'start_date' ? 'Start date' : 'Due date';
      log('due', value ? `${fieldName} → ${value}` : `Cleared ${fieldName.toLowerCase()}`);
      onRefresh?.();
    } catch (e) { console.error(e); }
  };

  const handleHoursSave = async (field: 'estimated_hours', value: string) => {
    const numVal = value ? parseFloat(value) : null;
    try {
      await updateElement(element.id, { [field]: numVal });
      log('estimate', numVal != null ? `Estimate → ${numVal}h` : 'Cleared estimate');
      onRefresh?.();
    } catch (e) { console.error(e); }
  };

  // Sub-element create / save now lives inside SubelementDetailModal. The
  // detail view only needs to refresh + log when the modal reports back.
  const handleSubelementSaved = (mode: 'create' | 'detail', titleHint?: string) => {
    if (mode === 'create' && titleHint) {
      log('subelement', `Added sub-element “${titleHint}”`);
    }
    onRefresh?.();
  };
  const handleSubelementDeleted = (titleHint?: string) => {
    if (titleHint) log('subelement', `Deleted sub-element “${titleHint}”`);
    onRefresh?.();
  };

  const handleAddAssignee = async (workerId: string) => {
    try {
      const worker = allWorkers.find(w => w.id === workerId);
      await addElementAssignee({ element_id: element.id, worker_id: workerId, role: 'assignee', worker });
      if (worker) log('assigned', `Assigned ${worker.name}`);
      if (worker?.user_id && worker.user_id !== user?.id) {
        const actorName = profile?.display_name || user?.email?.split('@')[0] || 'Someone';
        await notifyMany([worker.user_id], {
          actor_id: user?.id ?? null,
          actor_name: actorName,
          kind: 'assigned',
          element_id: element.id,
          title: `${actorName} assigned you to "${element.title}"`,
          body: null,
        });
      }
      setShowAssigneeDropdown(false);
      onRefresh?.();
    } catch (e) { console.error(e); }
  };

  const handleRemoveAssignee = async (assigneeId: string) => {
    try {
      const removed = element.assignees?.find((a) => a.id === assigneeId);
      await removeElementAssignee(assigneeId);
      if (removed?.worker?.name) log('unassigned', `Unassigned ${removed.worker.name}`);
      onRefresh?.();
    } catch (e) { console.error(e); }
  };

  // Note linking — pin one Note to this Element. The picker offers
  // existing files or spins up a fresh one. Embed renders below the
  // description; × in the embed header clears element.note_id.
  const [notePickerOpen, setNotePickerOpen] = useState(false);
  const handlePickNote = async (
    noteId: string,
    opts: { isNew: boolean; name: string },
  ) => {
    setNotePickerOpen(false);
    try {
      await updateElement(element.id, { note_id: noteId });
      log('note', opts.isNew ? `Linked new Note “${opts.name}”` : `Linked Note “${opts.name}”`);
      onRefresh?.();
    } catch (e) {
      console.error('Failed to link note to element', e);
    }
  };
  const handleUnlinkNote = async () => {
    try {
      await updateElement(element.id, { note_id: null });
      log('note', 'Unlinked Note');
      onRefresh?.();
    } catch (e) {
      console.error('Failed to unlink note from element', e);
    }
  };

  const completedSubs = element.subelements?.filter(s => s.is_completed).length || 0;
  const totalSubs = element.subelements?.length || 0;
  hasSubSelectionRef.current = subSelection.selectedRowIds.size > 0;
  const subIds = element.subelements?.map((s) => s.id) ?? [];
  // Bulk actions over the selected sub-elements. Complete / un-complete go
  // through the optimistic updateSubelement (instant); delete isn't cached,
  // so we refresh afterwards. Either way the selection is cleared.
  const bulkMarkSubs = async (done: boolean) => {
    const ids = Array.from(subSelection.selectedRowIds);
    await Promise.all(ids.map((id) => updateSubelement(id, { is_completed: done }).catch(() => {})));
    subSelection.clearSelection();
    onRefresh?.();
  };
  const bulkDeleteSubs = async () => {
    const ids = Array.from(subSelection.selectedRowIds);
    await Promise.all(ids.map((id) => deleteSubelement(id).catch(() => {})));
    subSelection.clearSelection();
    onRefresh?.();
  };

  // The breadcrumb's root segment: the Domain name when there is one, or —
  // for a Domain-less Home surface (Inbox, My Elements) — a plain
  // back-chevron, so there is always a way back to wherever this Element
  // was opened from. `onNavigateRoot` is required for exactly this reason:
  // a Domain-less caller has no name to show, only somewhere to go back to.
  const rootSegment = domainName ? (
    <button
      type="button"
      onClick={onNavigateRoot}
      className="px-1.5 py-0.5 rounded text-muted-foreground truncate max-w-[160px] transition-colors hover:text-foreground hover:bg-muted/40"
    >
      {domainName}
    </button>
  ) : (
    <button
      type="button"
      onClick={onNavigateRoot}
      aria-label="Back"
      title="Back"
      className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-md text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors"
    >
      <ChevronLeft size={13} />
    </button>
  );

  return (
    <div ref={rootRef} className="flex-1 flex flex-col overflow-hidden bg-card">
      {/* Breadcrumb — data hierarchy only: Domain > Object > Element. */}
      <div className="h-[50px] flex items-center gap-1 px-4 border-b border-border/60 bg-card flex-shrink-0">
        <div className="flex items-center gap-1 min-w-0 text-[12px] font-semibold">
          {rootSegment}
          <ChevronRight size={12} className="text-muted-foreground/40 flex-shrink-0" />
          {objectPath?.map((seg) => (
            <span key={seg.id} className="flex items-center gap-1 min-w-0">
              <button
                type="button"
                onClick={() => onNavigateObject?.(seg.id)}
                disabled={!onNavigateObject}
                className="px-1.5 py-0.5 rounded text-muted-foreground truncate max-w-[160px] transition-colors enabled:hover:text-foreground enabled:hover:bg-muted/40 disabled:cursor-default"
              >
                {seg.name}
              </button>
              <ChevronRight size={12} className="text-muted-foreground/40 flex-shrink-0" />
            </span>
          ))}
          <span className="text-foreground truncate max-w-[240px]">{element.title}</span>
          {/* ⋯ actions for the lowest breadcrumb item (this Element):
              duplicate / move / multi-home / delete. */}
          <ElementActionsMenu element={element} onRefresh={onRefresh} onDeleted={onBack} />
        </div>
        <div className="flex-1" />
        {/* Start/Run lives in the right-rail AgentRunPanel only — no
            duplicate header CTA. */}
      </div>

      {/* Scrollable body — Linear-style two-column layout */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto px-8 py-8 flex gap-8">
          <div className="flex-1 min-w-0 space-y-5">

          {/* Title & description */}
          <div>
            <div className="flex items-start gap-2 mb-6">
              {/* Auto-grow textarea so long titles wrap to multiple
                  lines instead of being clipped. Enter saves (via blur);
                  Shift+Enter inserts a newline within the title; Escape
                  restores the saved title and is consumed here, so the
                  page's own Escape (back to the list) is the next press.
                  NOTE: the global base resets typed content (input /
                  textarea / contenteditable) to font-weight 400, which
                  beats a `font-semibold` utility — so the heading's
                  semibold weight is forced inline. */}
              <textarea
                ref={titleRef}
                value={title}
                rows={1}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={handleTitleSave}
                onKeyDown={(e) => {
                  if (isCommitEnter(e) || isSubmitChord(e)) {
                    e.preventDefault();
                    e.currentTarget.blur();
                  } else if (isCancelKey(e)) {
                    e.preventDefault();
                    titleCancel.cancel();
                    setTitle(element.title);
                    e.currentTarget.blur();
                  }
                }}
                className="text-2xl text-foreground bg-transparent border-none focus:outline-none flex-1 min-w-0 resize-none leading-tight overflow-hidden"
                style={{ fontWeight: 600 }}
                placeholder="Element title"
              />
            </div>
            <textarea
              ref={descriptionRef}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={handleDescriptionSave}
              onKeyDown={(e) => {
                // Multi-line: Enter is a newline, Cmd/Ctrl+Enter saves.
                if (isSubmitChord(e)) {
                  e.preventDefault();
                  e.currentTarget.blur();
                } else if (isCancelKey(e)) {
                  e.preventDefault();
                  descriptionCancel.cancel();
                  setDescription(element.description || '');
                  e.currentTarget.blur();
                }
              }}
              placeholder="Add description..."
              rows={1}
              className="w-full text-[14px] text-foreground bg-transparent border-none focus:outline-none min-h-[36px] resize-none overflow-hidden"
            />
          </div>

          {/* Action row — reactions / Note link (icon-only). Sits flush
              with the title/description block (no extra horizontal
              padding) and wraps so reaction chips line up next to the
              affordances. */}
          <div className="flex items-center gap-1 flex-wrap">
            {/* Smile button → quick-emoji popover that toggles a
                reaction on this Element. */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setEmojiPickerOpen((o) => !o)}
                className="inline-flex items-center justify-center w-7 h-7 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
                title="Add reaction"
              >
                <Smile size={15} />
              </button>
              {emojiPickerOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setEmojiPickerOpen(false)}
                  />
                  <div className="absolute top-full left-0 mt-1 z-50 bg-popover border border-border rounded-md shadow-lg flex p-1 gap-0.5">
                    {QUICK_EMOJI.map((e) => (
                      <button
                        key={e}
                        type="button"
                        onClick={() => handleEmojiPick(e)}
                        className="w-7 h-7 hover:bg-accent rounded text-base"
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Note linker — opens NotePicker; hidden once a Note is
                linked (the embed below has an unlink button instead). */}
            {!element.note_id && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setNotePickerOpen(true)}
                  className="inline-flex items-center justify-center w-7 h-7 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
                  title="Link a Note"
                >
                  <FileText size={15} />
                </button>
                <NotePicker
                  open={notePickerOpen}
                  onClose={() => setNotePickerOpen(false)}
                  onPick={handlePickNote}
                  anchorClassName="absolute top-full left-0 mt-1"
                />
              </div>
            )}

            {/* (Agent quick-start button removed — the run still surfaces in
                the comments thread; start it from elsewhere.) */}

            {/* Approval — one button that opens a menu to enable the workflow
                and record a decision (Approve / Request changes / Reject).
                Moved here from the right rail's "Approval" island. */}
            <ElementApprovalMenu element={element} onRefresh={onRefresh} />

            {/* Existing reactions as toggleable chips, aggregated by
                emoji so two thumbs-ups read as 👍 ×2 with my own
                participation highlighted. */}
            {(() => {
              const counts: Record<string, number> = {};
              for (const r of reactions) counts[r.emoji] = (counts[r.emoji] || 0) + 1;
              const mine = new Set(
                reactions.filter((r) => r.user_id === user?.id).map((r) => r.emoji),
              );
              return Object.entries(counts).map(([emoji, n]) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => handleEmojiPick(emoji)}
                  className={
                    'text-[11px] px-1.5 h-7 inline-flex items-center gap-1 rounded-full border transition-colors ' +
                    (mine.has(emoji)
                      ? 'bg-primary/15 border-primary/30 text-foreground'
                      : 'bg-muted/40 border-border hover:bg-muted text-foreground/80')
                  }
                >
                  <span>{emoji}</span>
                  <span className="tabular-nums">{n}</span>
                </button>
              ));
            })()}
          </div>

          {/* Linked Note — embedded inline once chosen. */}
          {element.note_id && (
            <LinkedNoteEmbed
              noteId={element.note_id}
              onUnlink={handleUnlinkNote}
            />
          )}

          {/* Direction — approach / acceptance criteria / next step. Sits
              between the linked Note and the Sub-elements so the read order
              is intent → its breakdown → discussion. Keyed by element.id so
              switching Elements resets the editing state. */}
          <ElementDirectionSection
            key={`direction-${element.id}`}
            element={element}
            onSaved={handleDirectionSave}
          />

          {/* Sub-elements — list-style (no card bg). Each row mirrors the
              Elements list (checkbox + atom icon + title) and clicking a
              row opens the SubelementDetailModal. New sub-elements are
              created through the same modal — once at least one exists,
              the only entry point is a small "+" at the right end of the
              header. Empty state still shows a labelled "Add sub-element"
              link so the affordance is obvious. */}
          <div className="space-y-1.5 px-1">
            {totalSubs > 0 && (
              <div className="flex items-center gap-2 text-[12px] font-semibold text-muted-foreground">
                <span>Sub-elements</span>
                <span className="tabular-nums">{completedSubs}/{totalSubs}</span>
                <div className="flex-1" />
                <button
                  onClick={() => setSubModal({ mode: 'create' })}
                  className="p-1 -m-1 text-muted-foreground hover:text-foreground transition-colors"
                  title="New sub-element"
                >
                  <Plus size={13} />
                </button>
              </div>
            )}
            <div
              className="space-y-0 group/sublist"
              data-has-selection={subSelection.selectedRowIds.size > 0 ? '' : undefined}
            >
              {element.subelements?.map((sub) => (
                <SubelementRow
                  key={sub.id}
                  subelement={sub}
                  onRefresh={onRefresh}
                  onOpen={() => setSubModal({ mode: 'detail', subelement: sub })}
                  canRowSelect
                  isSelected={subSelection.selectedRowIds.has(sub.id)}
                  hasSelectionRef={hasSubSelectionRef}
                  onRowSelect={(id, mode) => subSelection.handleRowSelect(id, mode, subIds)}
                />
              ))}
              {totalSubs === 0 && (
                <button
                  onClick={() => setSubModal({ mode: 'create' })}
                  className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground py-1 transition-colors"
                >
                  <Plus size={13} /> Add sub-element
                </button>
              )}
            </div>
          </div>

          <SubelementBulkBar
            count={subSelection.selectedRowIds.size}
            onMarkDone={() => bulkMarkSubs(true)}
            onMarkTodo={() => bulkMarkSubs(false)}
            onDelete={bulkDeleteSubs}
            onClear={subSelection.clearSelection}
          />

          {/* Comments — single section now. Activity moved to the right
              rail as its own island card. */}
          <div>
            <div className="h-px bg-border mb-3" />
            <div className="mb-3 text-[13px] font-semibold text-foreground/95">
              Comments
            </div>
            <ElementCommentsPanel
              key={`comments-${element.id}-${agent.run?.finished_at ?? 'live'}`}
              elementId={element.id}
              elementTitle={element.title}
              workers={allWorkers}
              focusCommentId={focusCommentId}
            />
          </div>

          {/* Linked Elements */}
          {(edges.incoming.length > 0 || edges.outgoing.length > 0) && (
            <div className="rounded-xl bg-muted/30 p-3">
              <div className="flex items-center gap-1.5 px-1 pb-2">
                <Link2 size={11} className="text-muted-foreground" />
                <span className="text-[12px] font-semibold text-muted-foreground">Linked elements</span>
              </div>
              <div className="space-y-1">
                {edges.outgoing.map(edge => (
                  <div key={edge.id} className="flex items-center gap-2 text-[13px] py-1.5 px-2 bg-muted/30 rounded-md">
                    <span className="text-[11px] text-muted-foreground px-1.5 py-0.5 bg-muted rounded">{edge.edge_type.replace('_', ' ')}</span>
                    <span className="font-semibold">{edge.related_element?.title || 'Unknown'}</span>
                  </div>
                ))}
                {edges.incoming.map(edge => (
                  <div key={edge.id} className="flex items-center gap-2 text-[13px] py-1.5 px-2 bg-muted/30 rounded-md">
                    <span className="font-semibold">{edge.related_element?.title || 'Unknown'}</span>
                    <span className="text-[11px] text-muted-foreground px-1.5 py-0.5 bg-muted rounded">{edge.edge_type.replace('_', ' ')} this</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Bottom spacer */}
          <div className="h-8" />
          </div>

          {/* Right rail — Linear-style floating cards. Each section is its
              own card with a small chevron header; rows hover-highlight
              and open inline pickers. The bg is intentionally grey-ish
              (zinc-100 / zinc-900/40) so the cards lift off the page. */}
          <aside className="w-80 shrink-0 hidden lg:block space-y-3">
            {/* What this Element is standing on — the decisions and
                assumptions the Campaign bound to it. Above Properties for the
                same reason Campaign intent sits above them on an Object: why
                it exists comes before who owns it. */}
            <WidgetSurface board={board} host={host} zones={ELEMENT_ZONES}>
              <WidgetZone zone="rail" />
            </WidgetSurface>

            {/* Properties — required type + built-in structured fields. The
                "+ add property" affordance lives in the header (top-right),
                matching the Label island. */}
            <RailCard title="Properties">
              {/* Object membership — which Object(s) this Element belongs to
                  (object_id primary + element_objects multi-homing). Lives at
                  the very top of Properties (was its own island); each row is
                  clickable to open that Object. */}
              {memberObjects.length === 0 ? (
                <RailRow
                  icon={<span className="text-muted-foreground"><ObjectIcon size={14} /></span>}
                  name="Object"
                  label="Not in any Object"
                  placeholder
                  dense
                />
              ) : (
                memberObjects.map((o, i) => {
                  const rowName = i === 0 ? (memberObjects.length > 1 ? 'Objects' : 'Object') : '';
                  const row = (
                    <RailRow
                      icon={<span className="text-muted-foreground"><ObjectIcon size={14} /></span>}
                      name={rowName}
                      label={o.name}
                      dense
                    />
                  );
                  return onNavigateObject ? (
                    <button key={o.id} type="button" className="w-full" onClick={() => onNavigateObject(o.id)}>
                      {row}
                    </button>
                  ) : (
                    <div key={o.id}>{row}</div>
                  );
                })
              )}

              {/* Type — required, user-defined Element kind (Task / Human ...). */}
              <TypePicker
                value={element.type}
                options={elementTypes}
                onSelect={handleTypeChange}
                onCreate={handleCreateType}
              />

              {/* Status */}
              <StatusPicker
                element={element}
                onChanged={handleStatusChange}
                trigger={
                  <button className="w-full">
                    <RailRow
                      icon={<ElementProgressMark status={element.status} progress={getElementProgress(element, customColumns)} size={14} />}
                      name="Status"
                      label={currentStatus.label}
                      dense
                    />
                  </button>
                }
              />

              {/* Priority */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="w-full">
                    <RailRow
                      icon={<PriorityMark priority={element.priority} />}
                      name="Priority"
                      label={element.priority ? currentPriority.label : 'Set priority'}
                      placeholder={!element.priority}
                      dense
                    />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-36">
                  {priorityOptions.map(opt => (
                    <DropdownMenuItem key={opt.priority} onClick={() => handlePriorityChange(opt.priority)} className="gap-2">
                      <span className="flex w-5 items-center justify-center">
                        <PriorityMark priority={opt.priority} />
                      </span>
                      {opt.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Due date */}
              <Popover>
                <PopoverTrigger asChild>
                  <button className="w-full">
                    <RailRow
                      icon={<Calendar className="size-3.5 text-muted-foreground" />}
                      name="Date"
                      label={
                        element.start_date || element.due_date
                          ? `${formatElementDate(element.start_date) ?? '—'} → ${formatElementDate(element.due_date) ?? '—'}`
                          : 'Start date → Target date'
                      }
                      placeholder={!element.start_date && !element.due_date}
                      dense
                    />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto p-0">
                  <DateCalendar
                    mode="range"
                    numberOfMonths={1}
                    captionLayout="dropdown"
                    startMonth={new Date(2020, 0)}
                    endMonth={new Date(2035, 11)}
                    defaultMonth={parseYMD(element.start_date) ?? parseYMD(element.due_date)}
                    selected={{
                      from: parseYMD(element.start_date),
                      to: parseYMD(element.due_date),
                    }}
                    onSelect={(range: DateRange | undefined) => {
                      handleDateChange('start_date', range?.from ? toYMD(range.from) : '');
                      handleDateChange('due_date', range?.to ? toYMD(range.to) : '');
                    }}
                    weekStartsOn={weekStartsOn}
                  />
                  <div className="flex items-center justify-between border-t border-border px-3 py-2">
                    <button
                      type="button"
                      onClick={() => {
                        handleDateChange('start_date', '');
                        handleDateChange('due_date', '');
                      }}
                      className="text-[12px] text-muted-foreground hover:text-foreground"
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDateChange('start_date', toYMD(new Date()))}
                      className="text-[12px] text-primary hover:underline"
                    >
                      Today
                    </button>
                  </div>
                </PopoverContent>
              </Popover>

              {/* Inset hairline under Date — soft section break before the
                  Custom Property block. mx-2 keeps it off the card edges so it
                  reads as a divider, not a full rule. */}
              <div className="mx-2 mt-4 mb-2 h-px bg-border/50" />

              {/* Custom Property section — the add-property "+" relocated here
                  from the card header, with a label so the affordance is
                  explicit rather than a bare "+" in the corner. */}
              <div className="flex items-center justify-between px-2 py-1">
                <span className="text-[12px] font-semibold text-muted-foreground">Custom fields</span>

              </div>

              {/* Assignees */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="w-full"
                    aria-label={workerTriggerLabel('Assignee', element.assignees?.map((a) => a.worker ?? null).filter((w): w is NonNullable<typeof w> => !!w) ?? [])}
                  >
                    <RailRow
                      icon={
                        element.assignees?.length
                          ? <WorkerAvatarStack workers={element.assignees.map(a => a.worker)} size={16} />
                          : <User className="size-3.5 text-muted-foreground" />
                      }
                      name="Assignee"
                      label={element.assignees?.length
                        ? element.assignees.map(a => a.worker?.name || '?').join(', ')
                        : 'Assign'}
                      placeholder={!element.assignees?.length}
                    />
                  </button>
                </DropdownMenuTrigger>
                <AssigneeMenuContent
                  align="start"
                  className="w-48"
                  assignees={element.assignees}
                  workers={allWorkers}
                  element={element}
                  onAdd={handleAddAssignee}
                  onRemove={handleRemoveAssignee}
                />
              </DropdownMenu>

              {/* Estimate */}
              <label className="block w-full cursor-pointer">
                <RailRow
                  icon={<Timer className="size-3.5 text-muted-foreground" />}
                  name="Estimate"
                  label={estimatedHours ? `${estimatedHours}h` : 'Set estimate'}
                  placeholder={!estimatedHours}
                />
                <input
                  type="number"
                  value={estimatedHours}
                  onChange={(e) => setEstimatedHours(e.target.value)}
                  onBlur={() => handleHoursSave('estimated_hours', estimatedHours)}
                  step="0.5"
                  min="0"
                  className="sr-only"
                />
              </label>

              {/* Custom Properties (object-scoped) — editable value + inline add. */}
              {customColumns.map((col) => (
                <div key={col.id} className="flex items-center gap-2 px-2 py-2">
                  <span className="shrink-0 w-24 text-left text-[11px] font-semibold text-muted-foreground">{col.name}</span>
                  <div className="flex-1 min-w-0">
                    <CustomColumnCell
                      column={col}
                      elementId={element.id}
                      value={col.values?.[element.id]?.value ?? null}
                      onChange={(v) => handleCustomChange(col.id, v)}
                    />
                  </div>
                </div>
              ))}
            </RailCard>

            {/* Label — its own island below Properties (labels are free-form
                tags, not a structured property). The "+" add control lives in
                the card header (top-right); an empty state reads "No label
                yet…" instead of a blank body. */}
            <RailCard
              title="Label"
              action={
                <LabelAddButton labels={element.labels ?? []} onChange={handleLabelsChange} objectId={element.object_id} />
              }
            >
              {(element.labels?.length ?? 0) === 0 ? (
                <div className="px-2 py-1.5 text-[11px] text-muted-foreground/60">No label yet…</div>
              ) : (
                <div className="px-2 py-1.5">
                  <LabelEditor labels={element.labels ?? []} />
                </div>
              )}
            </RailCard>

            {/* AI Agent moved out of the right rail — it now lives as a
                quick-toggle button next to the reaction / note actions on
                the header. The deliverable summary still lands in the
                comments thread below. */}

            {/* Approval moved to the header action row (ElementApprovalMenu) —
                a button-triggered menu instead of a rail island. */}

            {/* Activity — moved off the main column. Lives in the rail
                as its own island so the body stays focused on title /
                description / sub-elements / comments. */}
            <RailCard title={`Activity${activityLog.length ? ` · ${activityLog.length}` : ''}`} padded>
              <ActivityFeed entries={activityLog} compact />
            </RailCard>
            {/* The standalone "Objects" island was folded into the top of the
                Properties island (membership reads as the first property). */}
          </aside>
        </div>
      </div>

      {subModal && (
        <SubelementDetailModal
          subelement={subModal.mode === 'detail' ? subModal.subelement : null}
          parentElement={{ id: element.id, title: element.title }}
          onClose={() => setSubModal(null)}
          onSaved={() => {
            const titleHint = subModal.mode === 'create' ? undefined : subModal.subelement.title;
            handleSubelementSaved(subModal.mode, titleHint);
          }}
          onDeleted={() => {
            handleSubelementDeleted(
              subModal.mode === 'detail' ? subModal.subelement.title : undefined
            );
          }}
        />
      )}
    </div>
  );
}

// ============================================
// Right-rail card — Linear-style floating block.
// ============================================
// RailCard moved to @/alcon/shared/RailCard (shared with the Object overview).

// RailRow moved to @/alcon/shared/RailRow (shared with the Object overview).

// ============================================
// Type picker — the Element's required `type`.
// Lists the Domain-shared types; lets the user add a new one inline.
// ============================================
function TypePicker({
  value, options, onSelect, onCreate,
}: {
  value: string | null;
  options: string[];
  onSelect: (type: string | null) => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const query = draft.trim();
  // Element types display with an uppercase first letter.
  const normalized = query ? query.charAt(0).toUpperCase() + query.slice(1) : '';
  const filtered = options.filter((o) => o.toLowerCase().includes(query.toLowerCase()));
  const canCreate = query.length > 0 && !options.some((o) => o.toLowerCase() === query.toLowerCase());

  const pick = (type: string | null) => {
    onSelect(type);
    setOpen(false);
    setDraft('');
  };
  const create = async () => {
    if (!normalized || busy) return;
    setBusy(true);
    try {
      await onCreate(normalized);
      onSelect(normalized);
      setOpen(false);
      setDraft('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setDraft(''); }}>
      <PopoverTrigger asChild>
        <button className="w-full">
          <RailRow
            name="Elements Type"
            icon={<ElementTypeIcon className="size-3.5 text-muted-foreground shrink-0" />}
            label={value ?? 'Set type'}
            placeholder={!value}
            dense
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && canCreate) create(); }}
          placeholder="Search or add type…"
          className="w-full px-2 py-1.5 mb-1 text-[13px] bg-muted/50 rounded-md placeholder:text-muted-foreground/60 border-none"
          autoFocus
        />
        <div className="max-h-52 overflow-y-auto">
          {filtered.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => pick(opt)}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-[13px] text-foreground/90 rounded-md hover:bg-muted/60 text-left transition-colors"
            >
              <ElementTypeIcon className="size-3.5 text-muted-foreground shrink-0" />
              <span className="flex-1 truncate">{opt}</span>
              {value === opt && <Check size={12} className="text-muted-foreground shrink-0" />}
            </button>
          ))}
          {canCreate && (
            <button
              type="button"
              onClick={create}
              disabled={busy}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-[13px] text-foreground/90 rounded-md hover:bg-muted/60 text-left transition-colors disabled:opacity-50"
            >
              <Plus className="size-3.5 text-muted-foreground shrink-0" />
              <span className="truncate">Add &ldquo;{normalized}&rdquo;</span>
            </button>
          )}
          {filtered.length === 0 && !canCreate && (
            <div className="px-2 py-2 text-[12px] text-muted-foreground text-center">
              {options.length === 0 ? 'Type a name to add the first one' : 'No match'}
            </div>
          )}
        </div>
        {value && (
          <>
            <div className="h-px bg-border my-1" />
            <button
              type="button"
              onClick={() => pick(null)}
              className="w-full px-2 py-1.5 text-[12px] text-muted-foreground rounded-md hover:bg-muted/60 text-left transition-colors"
            >
              Clear type
            </button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ============================================
// Label editor — free-form string labels on an Element.
// Chips with remove + a free-text input to add.
// ============================================
function LabelEditor({
  labels,
}: {
  labels: string[];
}) {
  useLabelColors(); // re-render when a colour is picked
  if (labels.length === 0) return null;
  return (
    // -ml-[5px] aligns the chip's Tag mark centre with the Properties
    // icon column above (the chip's own px-2 pushes the icon right by
    // 5px otherwise).
    <div className="flex flex-wrap gap-1 -ml-[5px]">
      {labels.map((label) => (
        <EditableLabelChip key={label} label={label} />
      ))}
    </div>
  );
}

// A label chip whose coloured Tag mark opens a colour picker
// ("Pick a color for label"). Colours are Domain-wide.
function EditableLabelChip({ label }: { label: string }) {
  const [open, setOpen] = useState(false);
  const pick = async (colorKey: string) => {
    setOpen(false);
    const domainId = getActiveDomainId();
    if (!domainId) return;
    setLabelColorLocal(domainId, label, colorKey); // optimistic
    try {
      await setDomainLabelColor(domainId, label, colorKey);
    } catch (e) {
      console.error('Failed to set label colour', e);
    }
  };
  return (
    <span
      className="inline-flex items-center gap-1 shrink-0 max-w-[140px] px-2 py-0.5 rounded-full text-[11px] font-medium text-foreground/90 bg-muted/60 ring-1 ring-border/60"
      title={label}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" aria-label="Label color" className="shrink-0 inline-flex items-center justify-center rounded hover:bg-muted/60 transition-colors">
            <Tag size={10} style={{ color: labelColor(label) }} />
          </button>
        </PopoverTrigger>
        <MenuShell align="start">
          <LabelPaletteRows selected={labelColorKey(label) ?? null} onPick={pick} />
        </MenuShell>
      </Popover>
      <span className="truncate">{label}</span>
    </span>
  );
}

// "+" button at the right of the Label row — opens a Linear-style picker. It
// suggests every label the Object's Elements already carry plus every label
// the Domain holds a colour for (toggle to assign / unassign), and lets you
// create a new one. A label belongs to the Domain: its colour is stored in
// domains.label_colors, and Settings › Labels manages it there.
function LabelAddButton({
  labels, onChange, objectId,
}: {
  labels: string[];
  onChange: (labels: string[]) => void;
  objectId?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [pool, setPool] = useState<string[]>([]);
  // Two-step create: name → colour. `pending` holds the new label's name
  // between the two steps; when null the popover shows the filter/assign list.
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !objectId) return;
    fetchObjectLabels(objectId).then(setPool).catch(console.error);
  }, [open, objectId]);

  // Settings › Labels can create a label before any Element carries it; it has
  // to be pickable from here or that creation is moot. Re-renders when the
  // Domain's catalogue changes.
  useLabelColors();
  const candidates = [...pool];
  for (const name of domainLabelNames()) {
    if (!candidates.some((l) => l.toLowerCase() === name.toLowerCase())) candidates.push(name);
  }
  candidates.sort((a, b) => a.localeCompare(b));

  const q = draft.trim().toLowerCase();
  const isAssigned = (l: string) => labels.some((x) => x.toLowerCase() === l.toLowerCase());
  const suggestions = candidates.filter((l) => !q || l.toLowerCase().includes(q));
  const exactExists =
    candidates.some((l) => l.toLowerCase() === q) || labels.some((l) => l.toLowerCase() === q);

  const reset = () => { setDraft(''); setPending(null); };

  const toggle = (label: string) => {
    if (isAssigned(label)) onChange(labels.filter((l) => l.toLowerCase() !== label.toLowerCase()));
    else onChange([...labels, label]);
  };

  // Step 2 — colour chosen: assign the label + persist its colour on the
  // Domain, then return to the list.
  const commitColor = (colorKey: string) => {
    if (!pending) return;
    const name = pending;
    if (!isAssigned(name)) onChange([...labels, name]);
    setPool((p) => (p.some((l) => l.toLowerCase() === name.toLowerCase()) ? p : [...p, name]));
    const domainId = getActiveDomainId();
    if (domainId) {
      setLabelColorLocal(domainId, name, colorKey); // optimistic
      setDomainLabelColor(domainId, name, colorKey).catch(console.error);
    }
    reset();
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Add label"
          className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-md text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors"
        >
          <Plus size={13} strokeWidth={2.5} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-1.5">
        {pending ? (
          // ── Step 2: pick a colour ──────────────────────────────
          <>
            <div className="flex items-center gap-1.5 px-1 pb-1.5 mb-1 border-b border-border/60">
              <button
                type="button"
                onClick={() => setPending(null)}
                className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-md text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                aria-label="Back"
              >
                <ChevronLeft size={13} />
              </button>
              <span className="text-[12px] text-muted-foreground truncate">
                Pick a colour · <span className="text-foreground/80">{pending}</span>
              </span>
            </div>
            <div className="max-h-56 overflow-auto">
              <LabelPaletteRows onPick={commitColor} />
            </div>
          </>
        ) : (
          // ── Step 1: filter / assign existing, or create ──────────
          <>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Add labels…"
              className="w-full px-2 py-1 text-[13px] bg-muted/40 rounded-md placeholder:text-muted-foreground/60 border-none"
              autoFocus
            />
            <div className="mt-1 max-h-56 overflow-auto">
              {suggestions.map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => toggle(l)}
                  className="w-full flex items-center gap-2 px-2 py-1 rounded-md hover:bg-muted/40 text-[13px] text-left"
                >
                  <Tag size={12} className="shrink-0" style={{ color: labelColor(l) }} />
                  <span className="truncate flex-1">{l}</span>
                  {isAssigned(l) && <Check size={12} className="text-foreground/70 shrink-0" />}
                </button>
              ))}
              {q && !exactExists && (
                <button
                  type="button"
                  onClick={() => setPending(draft.trim())}
                  className="w-full flex items-center gap-2 px-2 py-1 rounded-md hover:bg-muted/40 text-[13px] text-left text-muted-foreground"
                >
                  <Plus size={12} className="shrink-0" />
                  <span className="truncate flex-1">Create new label</span>
                  <span className="text-foreground/70 truncate">“{draft.trim()}”</span>
                </button>
              )}
              {suggestions.length === 0 && !q && (
                <div className="px-2 py-1.5 text-[12px] text-muted-foreground/60">No labels yet</div>
              )}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ============================================
// Activity feed — tiny vertical timeline.
// ============================================
const ACTIVITY_ICON: Record<ActivityKind | 'created', React.ComponentType<{ size?: number; className?: string }>> = {
  created:    Plus,
  renamed:    Pencil,
  description: Pencil,
  direction:  Compass,
  status:     Circle,
  priority:   Flag,
  assigned:   User,
  unassigned: User,
  due:        Calendar,
  estimate:   Timer,
  subelement: CheckCircle2,
  note:       FileText,
  comment:    MessageIcon,
};

function ActivityFeed({
  entries, compact = false,
}: {
  entries: { id: string; kind: ActivityKind | 'created'; detail: string; author: string; createdAt: Date }[];
  compact?: boolean;
}) {
  if (entries.length === 0) {
    return (
      <div className={`text-center text-muted-foreground ${compact ? 'text-[12px] py-3' : 'rounded-xl bg-muted/30 p-6 text-[13px]'}`}>
        No activity yet
      </div>
    );
  }
  return (
    <div className="relative pl-4">
      <div className="absolute left-[10px] top-2 bottom-2 w-px bg-border" />
      <div className={compact ? 'space-y-2' : 'space-y-3'}>
        {entries.map((entry) => {
          const Icon = ACTIVITY_ICON[entry.kind] ?? History;
          return (
            <div key={entry.id} className="relative flex items-start gap-2">
              <span className={`absolute -left-4 ${compact ? 'top-0' : 'top-0.5'} w-5 h-5 rounded-full bg-card border border-border flex items-center justify-center`}>
                <Icon size={10} className="text-muted-foreground" />
              </span>
              <div className="flex-1 min-w-0 pl-4">
                <p className={compact ? 'text-[11.5px] leading-tight text-foreground/90' : 'text-[12.5px] text-foreground/90'}>
                  <span className="text-foreground/80">{entry.detail}</span>
                </p>
                <span className={compact ? 'text-[10px] text-muted-foreground' : 'text-[10.5px] text-muted-foreground'}>
                  {entry.author} · {timeAgo(entry.createdAt)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
