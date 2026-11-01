'use client';

import { useQuery } from '@tanstack/react-query';
import { useCurrentUserId } from '@/providers/authContext';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { Button, ButtonAppearanceProvider } from '@/ui/button';
import { ElementDependencies } from './ElementDependencies';
import { CheckInDialog } from '../../home/now/CheckInDialog';
import { STATUS, PRIORITY, FONT } from '@/shared/designTokens';
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Calendar, User, Link2, Plus, CheckCircle2, Tag, Circle, Flag, History, Timer, ChevronRight, ChevronLeft, Pencil, Check, Compass } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';
import { Calendar as DateCalendar } from '@/ui/calendar';
import { getCachedWeekStartsOn, usePreference } from '@/Function/settings/preferencesStore';
import type { DateRange } from 'react-day-picker';
import type { ElementWithDetails, Worker } from '@/hooks/useSupabase';
import { isAgentRunOpen } from '@/Function/copilot/agentData';
import { AgentRunPanel } from './agent';
import { OpenInMenu } from '@/ActivitySpace/execution/openIn/OpenInMenu';
import { createNoteFile } from '@/hooks/useNotesDb';
import {
  updateElement,
  fetchElementWithDetails,
  updateSubelement,
  deleteSubelement,
  createSubelement,
  useAssignableWorkers,
  fetchAssignableWorkers,
  addElementAssignee,
  removeElementAssignee,
  noticeAssignmentFailed,
  setCustomColumnValue,
  noticePropertyValueFailed,
  notifyAboutElement,
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
} from '@/hooks/elementDetailQueries';
import { CustomColumnCell } from '@/Function/property/CustomColumnCell';
import type { Subelement, Json } from '@/types/database';
import { ElementProgressMark, getElementProgress } from '@/Function/shared/ElementProgressMark';
import { WorkerAvatarStack } from '@/Function/shared/WorkerAvatar';
import { workerTriggerLabel } from '@/Function/shared/workerReach';
import { AssigneeMenuContent } from '@/Function/shared/AssigneeMenu';
import { liveLease, holderLabel, formatRemaining } from '@/Function/shared/element/lease';
import { useNow } from '@/Function/shared/useNow';
import { Fingerprint, Copy } from 'lucide-react';
import { labelColor, labelColorKey, domainLabelNames, useLabelColors, setLabelColorLocal, hydrateLabelColors } from '@/Function/shared/labelColor';
import { LabelPaletteRows } from '@/Function/shared/LabelPaletteRows';
import { MenuShell } from '@/Function/shared/menu';
import { RailCard } from '@/Function/shared/RailCard';
import { DisclosureTriangle } from '@/Function/shared/DisclosureTriangle';
import {
  useBoard,
  WidgetSurface,
  WidgetZone,
  ELEMENT_DETAIL_BOARD,
  type WidgetHost,
  type Zone,
} from '@/Function/widget';

/** The Element rail is the only zone its board renders. */
const ELEMENT_ZONES: Zone[] = ['rail'];
import { RailRow } from '@/Function/shared/RailRow';
import { PriorityMark } from '@/Function/shared/PriorityMark';
import { ElementTypeIcon, ObjectIcon } from '@/shell/icons';
import { PageIcon, PageSection, PAGE_TITLE, PAGE_TITLE_WEIGHT } from '@/Function/shared/PageHead';
import { MarkdownLite } from '@/Function/shared/MarkdownLite';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { StatusPicker } from '@/Function/shared/StatusPicker';
import { ElementDirectionSection } from './ElementDirectionSection';
import { CodeChangesSection } from '../code/CodeChangesSection';
import { SubelementRow } from './SubelementRow';
import { SubelementBulkBar } from './SubelementBulkBar';
import { useElementSelection } from './useElementSelection';
import { SubelementDetailModal } from './SubelementDetailModal';
import { ElementCommentsPanel } from './ElementCommentsPanel';
import { ElementApprovalMenu } from './ElementApprovalMenu';
import { ElementActionsMenu } from './ElementActionsMenu';
import { Smile, FileText, FolderInput, Trash2, RotateCcw, MoreHorizontal, Paperclip, X } from 'lucide-react';
import { useElementFiles, useElementFileActions, type ElementFile } from '@/hooks/elementFileData';
import { ElementFilePreview } from './ElementFilePreview';
import { requestNewDeck } from '@/ActivitySpace/sustainment/slides/newDeckRequest';
import { openInApp } from '@/Function/shared/appNavigation';
import { NavSlidesIcon } from '@/shell/sidebar/NavIcons';
import { appDialog } from '@/Function/shared/appDialogStore';
import { CodeChangeIcon } from '@/ActivitySpace/execution/code/codeChangeLabels';
import { isCancelKey, isCommitEnter, isSubmitChord, useEscapeLayer } from '@/Function/shared/keyboard';
import { NotePicker } from '@/ActivitySpace/sustainment/notebook/NotePicker';
import { LinkedNoteEmbed } from '@/ActivitySpace/sustainment/notebook/LinkedNoteEmbed';
import { logActivity, useElementActivityLog, invalidateElementActivity, mergeActivity, type ActivityKind } from '@/hooks/elementActivity';
import { useAuthContext } from '@/providers/AuthProvider';
import { getActiveDomainId } from '@/Function/space/domainsStore';
import { formatElementDate, parseDateOnly, toDateOnlyString, formatAge } from '@/Function/shared/dateUtils';
import { ElementIcon, MessageIcon } from '@/Function/shared/conceptIcons';

interface ElementDetailViewProps {
  /** A notification reader stacks supplementary properties below the activity. */
  layout?: 'full' | 'reader';
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
  /** Open a Initiative on the Strategy surface — the return leg of the round
   *  trip, taken from the Decisions & assumptions widget. Optional because
   *  some hosts (Inbox, My Elements) have no Strategy surface to hand off to;
   *  the widget then names the Initiative without a link. */
  onOpenStrategy?: (strategyId: string) => void;
  /** Opened from a notification about one comment — see ElementCommentsPanel. */
  focusCommentId?: string | null;
  coordinationSpaceId?: string | null;
  onOpenElement?: (elementId: string) => void;
}

/** Dependencies can be followed from every detail host, including Inbox and Calendar. */
export function ElementDetailView(props: ElementDetailViewProps) {
  const userId = useCurrentUserId();
  const activeSpace = useActiveSpaceId();
  const spaceId = props.coordinationSpaceId === undefined ? activeSpace : props.coordinationSpaceId;
  return <ElementDetailRoute key={`${userId}:${spaceId}:${props.element.id}`} {...props} coordinationSpaceId={spaceId} />;
}

function ElementDetailRoute(props: ElementDetailViewProps) {
  const userId = useCurrentUserId();
  const [trail, setTrail] = useState<string[]>([]);
  const relatedId = trail.at(-1);
  const related = useQuery({
    queryKey: ['coordination-element', userId, props.coordinationSpaceId, relatedId],
    queryFn: () => fetchElementWithDetails(relatedId!), enabled: !!relatedId,
  });
  const { t } = useI18n();
  const back = () => setTrail(current => current.slice(0, -1));
  if (relatedId && (related.isPending || !related.data || related.error)) return <div className="p-6">
    <p role="status" className="text-[13px] text-muted-foreground">{related.isPending ? t('Loading Element…') : t('This Element is unavailable.')}</p>
    <Button className="mt-3" onClick={back}>{t('Back')}</Button>
  </div>;
  const element = relatedId ? related.data! : props.element;
  return <ElementDetailBody {...props} key={element.id} element={element}
    objectPath={relatedId ? undefined : props.objectPath} domainName={relatedId ? undefined : props.domainName}
    focusCommentId={relatedId ? undefined : props.focusCommentId}
    onBack={relatedId ? back : props.onBack}
    onOpenElement={props.onOpenElement ?? (id => setTrail(current => [...current, id]))}
    onRefresh={() => { if (relatedId) void related.refetch(); props.onRefresh?.(); }} />;
}

// ============================================
// Status & Priority options
// ============================================
const priorityOptions = [
  { priority: 'urgent', label: PRIORITY.urgent.label, color: 'text-orange-400' },
  { priority: 'high', label: PRIORITY.high.label, color: 'text-amber-400' },
  { priority: 'medium', label: PRIORITY.medium.label, color: 'text-muted-foreground' },
  { priority: 'low', label: PRIORITY.low.label, color: 'text-muted-foreground/70' },
];

// ============================================
// Types for local-only features (until DB tables exist)
// ============================================
// Activity entries live in elementActivity.ts (element_activity, live over the delta stream). The
// detail screen renders both the persisted log + a derived "created"
// entry pulled from element.created_at.

// ============================================
// Relative time formatter
// ============================================

// ============================================
// Main Component
// ============================================
function ElementDetailBody({
  element,
  objectName: _objectName,
  layout = 'full',
  objectPath,
  domainName,
  onBack,
  onRefresh,
  onNavigateRoot,
  onNavigateObject,
  onOpenStrategy,
  focusCommentId,
  coordinationSpaceId,
  onOpenElement,
}: ElementDetailViewProps) {
  const [checkInOpen, setCheckInOpen] = useState(false);
  const weekStartsOn = usePreference(getCachedWeekStartsOn);

  // The rail's board. Only the return leg lives on it for now — Properties,
  // Labels and Activity below are still hand-placed islands.
  const board = useBoard('element-detail', ELEMENT_DETAIL_BOARD, element.id);
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
  // A written description is read as formatted text (headings, lists, bold)
  // and turns into its source when clicked — the way a document reads until
  // you put the cursor in it. An empty one is the field straight away.
  const { t } = useI18n();
  // Keyed by Element, so opening another one starts it formatted again.
  const [editingDescriptionFor, setEditingDescriptionFor] = useState<string | null>(null);
  const editingDescription = editingDescriptionFor === element.id;
  const setEditingDescription = (on: boolean) => setEditingDescriptionFor(on ? element.id : null);
  const showDescriptionSource = editingDescription || !description.trim();
  useEffect(() => {
    const el = descriptionRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [description, showDescriptionSource]);
  useEffect(() => {
    if (!editingDescription) return;
    const el = descriptionRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editingDescription]);

  // Readers can resize independently of the viewport (sidebar or split pane).
  useEffect(() => {
    const fields = [titleRef.current, descriptionRef.current].filter((el): el is HTMLTextAreaElement => !!el);
    const widths = new WeakMap<Element, number>();
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        if (widths.get(entry.target) === entry.contentRect.width) continue;
        widths.set(entry.target, entry.contentRect.width);
        const field = entry.target as HTMLTextAreaElement;
        field.style.height = 'auto';
        field.style.height = `${field.scrollHeight}px`;
      }
    });
    fields.forEach(field => observer.observe(field));
    return () => observer.disconnect();
  }, []);

  // Esc goes back to the list this Element was opened from — one level.
  // Anything open above the page (a picker, the Subelement modal, a field
  // ending its own edit) takes the key first; the page gets the next one.
  // The root ref keeps an Escape typed into a field elsewhere (the sidebar's
  // rename, say) from counting as this page's.
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEscapeLayer(true, onBack, rootRef);

  // Reactions on this Element — cached per Element, refreshed on toggle.
  const { reactions, refresh: refreshReactions } = useElementReactions(element.id);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  useEscapeLayer(emojiPickerOpen, () => setEmojiPickerOpen(false));
  // Subelement create / detail modal — null when closed; { mode: 'create' }
  // for the new-sub-element popup; { mode: 'detail', subelement } for editing.
  // The Sub-elements section's fold: open when there are some, folded (▶)
  // when there are none — unfolding it offers the "Add sub-element" line.
  const [subsOpen, setSubsOpen] = useState(() => (element.subelements?.length ?? 0) > 0);
  const [newSubTitle, setNewSubTitle] = useState('');
  const [addingSub, setAddingSub] = useState(false);
  // Who a sub-element can be put on: the parent Element's assignable people.
  const { data: subWorkers } = useAssignableWorkers({ elementId: element.id }, subsOpen);
  const addSubelement = async () => {
    const title = newSubTitle.trim();
    if (!title || addingSub) return;
    setAddingSub(true);
    try {
      await createSubelement({ title, element_id: element.id });
      setNewSubTitle('');
      onRefresh?.();
    } catch (e) {
      console.error('Failed to add sub-element', e);
    } finally {
      setAddingSub(false);
    }
  };
  const [subModal, setSubModal] = useState<
    | { mode: 'create' }
    | { mode: 'detail'; subelement: Subelement }
    | null
  >(null);

  // Edges — cached per Element.
  const allEdges = useElementEdges(element.id);
  const edges = { incoming: allEdges.incoming.filter(edge => edge.edge_type !== 'depends_on'),
    outgoing: allEdges.outgoing.filter(edge => edge.edge_type !== 'depends_on') };

  // Workers assignable to this Element (its Space's people and AI). Already
  // assigned Workers keep their names through element.assignees.
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
  const aiWorkers = useMemo(() => allWorkers.filter((w) => w.type === 'ai_agent'), [allWorkers]);
  // Preselect the assigned AI only when it is one this Element can be handed to.
  const assignedAiWorkerId = useMemo(
    () => (element.assignees || [])
      .map((a) => a.worker)
      .find((w) => w?.type === 'ai_agent' && aiWorkers.some((ai) => ai.id === w.id))?.id ?? null,
    [element.assignees, aiWorkers],
  );
  // Run again keeps the previous run's AI only while this Element can still be
  // handed to it (agent_runs refuses any other); otherwise the assigned AI.
  const rerunWorkerId = (previous: string | null | undefined) =>
    previous && aiWorkers.some((ai) => ai.id === previous) ? previous : assignedAiWorkerId;
  // When a run finishes it moves the Element to "review" and posts its
  // deliverable as a comment — refresh the parent so the status updates.
  // (The comments panel re-reads its thread as the run moves on: refreshKey.)
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

  // Activity log — element_activity rows plus a synthetic "created" line.
  // Changes to the Element itself (status, title, description, priority,
  // dates, estimate, people, moves) are written by database triggers; log()
  // below records only what the database cannot see (direction, sub-elements,
  // reactions, Notes).
  const { data: activityEntries } = useElementActivityLog(element.id);
  const activityLog = useMemo(
    () => mergeActivity(activityEntries ?? [], element),
    [activityEntries, element],
  );

  const author = (profile?.display_name || user?.email?.split('@')[0] || 'You');
  const log = (kind: ActivityKind, detail: string) => {
    void logActivity(element.id, kind, detail, author).catch((e) => console.error('Failed to record activity:', e));
  };

  // Member Objects — every Object this Element is homed under (primary FK +
  // element_objects multi-homing). Rows click through to the Object.
  const memberObjects = useElementMemberObjects(element.id, element.object_id);

  // Estimated hours — a standalone planning field in Properties (time
  // tracking was removed, so there's no actual-vs-estimate comparison).
  const [estimatedHours, setEstimatedHours] = useState<string>(element.estimated_hours?.toString() || '');

  // Lease — who holds this Element right now (el_TRJ-012). Read-only here:
  // the lease is taken and returned through .claude/ops/lease.mjs, never from the UI.
  // The branch is the quotable half, so it copies on click.
  const lease = liveLease(element, useNow());
  const [branchCopied, setBranchCopied] = useState(false);
  const copyBranch = async (branch: string) => {
    try {
      await navigator.clipboard.writeText(branch);
      setBranchCopied(true);
      setTimeout(() => setBranchCopied(false), 1200);
    } catch (e) {
      console.error('Failed to copy branch', e);
    }
  };

  // Active left tab

  const currentStatus = STATUS[(element.status ?? 'todo') as keyof typeof STATUS] ?? STATUS.todo;
  const currentPriority = priorityOptions.find(p => p.priority === element.priority) || priorityOptions[2];

  // Sync with prop changes
  useEffect(() => {
    setTitle(element.title);
    setDescription(element.description || '');
    setEstimatedHours(element.estimated_hours?.toString() || '');
  }, [element.id, element.title, element.description, element.estimated_hours]);

  useEffect(() => { fetchAssignableWorkers({ elementId: element.id }).then(setAllWorkers).catch(console.error); }, [element.id]);
  const handleCustomChange = useCallback(async (columnId: string, value: Json) => {
    try {
      await setCustomColumnValue(columnId, element.id, value);
      reloadCustomColumns();
    } catch (e) {
      noticePropertyValueFailed(e);
    }
  }, [element.id, reloadCustomColumns]);

  // What the title / description fields hold versus what was last sent, so
  // an edit still pending when the view goes away is saved rather than lost.
  // A detail opened inside a dialog closes on Escape at the document's
  // capture phase, before the field's own Escape runs, and a field removed
  // while focused gets no blur — so blur alone cannot be the only save.
  const sentRef = useRef({ id: element.id, title: element.title, description: element.description || '' });
  const draftRef = useRef({ title, description });
  useEffect(() => { draftRef.current = { title, description }; }, [title, description]);
  // What a close-time save needs after the view is gone: who to credit on
  // the Activity rail and whom to tell the list changed (a dialog's owner
  // reads its own query, not the explorer cache updateElement patches).
  const closeRef = useRef({ author, onRefresh });
  useEffect(() => { closeRef.current = { author, onRefresh }; }, [author, onRefresh]);
  useEffect(() => {
    sentRef.current = { id: element.id, title: element.title, description: element.description || '' };
  }, [element.id, element.title, element.description]);
  useEffect(() => () => {
    const sent = sentRef.current;
    const draft = draftRef.current;
    const patch: { title?: string; description?: string | null } = {};
    if (draft.title.trim() && draft.title.trim() !== sent.title) patch.title = draft.title.trim();
    if (draft.description !== sent.description) patch.description = draft.description || null;
    if (!Object.keys(patch).length) return;
    const { onRefresh: refresh } = closeRef.current;
    void updateElement(sent.id, patch)
      .then(() => {
        // The list first: the save landed, whatever happens to the rail.
        refresh?.();
        // The database records the rename and the description change itself.
        void invalidateElementActivity(sent.id);
      })
      .catch((e) => console.error('Failed to save on close', e));
  }, []);

  // Handlers
  const handleTitleSave = async () => {
    // An emptied title is not saved; show the saved one again rather than
    // leaving the field blank until the next navigation.
    if (!title.trim()) { setTitle(element.title); return; }
    if (title !== element.title) {
      sentRef.current = { ...sentRef.current, title: title.trim() };
      try {
        await updateElement(element.id, { title: title.trim() });
        void invalidateElementActivity(element.id);
        onRefresh?.();
      } catch (e) { console.error(e); }
    }
  };

  const handleDescriptionSave = async () => {
    if (description !== (element.description || '')) {
      sentRef.current = { ...sentRef.current, description };
      try {
        await updateElement(element.id, { description: description || null });
        void invalidateElementActivity(element.id);
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
      // The status row is written by the element_activity trigger — from here,
      // from an agent, or from SQL alike — so ask the rail to look again.
      void invalidateElementActivity(element.id);
      // StatusPicker also reports progress-only edits; only a real change is
      // news. The RPC tells the assignees, bound to the status row just
      // written (done / blocked come from the notify_element_status trigger).
      if (newStatus !== element.status) await notifyAboutElement(element.id, 'status_change');
      onRefresh?.();
    } catch (e) { console.error(e); }
  };

  const handlePriorityChange = async (newPriority: string) => {
    try {
      await updateElement(element.id, { priority: newPriority as 'medium' });
      void invalidateElementActivity(element.id);
      onRefresh?.();
    } catch (e) { console.error(e); }
  };

  const handleDateChange = async (field: 'start_date' | 'due_date', value: string) => {
    try {
      await updateElement(element.id, { [field]: value || null });
      void invalidateElementActivity(element.id);
      onRefresh?.();
    } catch (e) { console.error(e); }
  };

  const handleHoursSave = async (field: 'estimated_hours', value: string) => {
    const numVal = value ? parseFloat(value) : null;
    try {
      await updateElement(element.id, { [field]: numVal });
      void invalidateElementActivity(element.id);
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
      void invalidateElementActivity(element.id);
      if (worker?.user_id && worker.user_id !== user?.id) {
        await notifyAboutElement(element.id, 'assigned', workerId);
      }
      setShowAssigneeDropdown(false);
      onRefresh?.();
    } catch (e) { noticeAssignmentFailed(e); }
  };

  const handleRemoveAssignee = async (assigneeId: string) => {
    try {
      await removeElementAssignee(assigneeId);
      void invalidateElementActivity(element.id);
      onRefresh?.();
    } catch (e) { noticeAssignmentFailed(e); }
  };

  // Note linking — pin one Note to this Element. The picker offers
  // existing files or spins up a fresh one. Embed renders below the
  // description; × in the embed header clears element.note_id.
  const [notePickerOpen, setNotePickerOpen] = useState(false);
  // The "…" menu opens these on the page: each bump opens its editor/picker.
  const [directionSignal, setDirectionSignal] = useState(0);
  const [dependencySignal, setDependencySignal] = useState(0);
  const [approvalSignal, setApprovalSignal] = useState(0);
  const [linkPrSignal, setLinkPrSignal] = useState(0);
  // Files attached from this computer.
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { data: files } = useElementFiles(element.id);
  const fileActions = useElementFileActions(element.id);
  const [previewFile, setPreviewFile] = useState<ElementFile | null>(null);
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
      aria-label={t('Back')}
      title={t('Back')}
      className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-md text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors"
    >
      <ChevronLeft size={13} />
    </button>
  );

  return (
    <div ref={rootRef} className="flex-1 flex flex-col overflow-hidden bg-card">
      {/* Breadcrumb — data hierarchy only: Domain > Object > Element. */}
      <div className="h-[50px] flex items-center gap-1 px-4 border-b border-border/60 bg-card flex-shrink-0">
        <div className="flex items-center gap-1 min-w-0 text-[13px] font-medium">
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
          <ElementActionsMenu element={element} onRefresh={onRefresh} onDeleted={onBack}
            onSetDirection={() => setDirectionSignal((n) => n + 1)}
            onAddDependency={() => setDependencySignal((n) => n + 1)}
            onOpenApproval={() => setApprovalSignal((n) => n + 1)} />
        </div>
        <div className="flex-1" />
        {/* Take the Element to a tool: Claude Code, the in-app agent (it
            works with your permissions and stops for approval before
            external writes, ADR 0027), its Note, a deck. */}
        <OpenInMenu
          subject={{
            kind: 'Element', identifier: element.display_id, title: element.title,
            description: element.description, path: [domainName, ...(objectPath ?? []).map((seg) => seg.name)].filter((x): x is string => !!x),
          }}
          noteId={element.note_id ?? null}
          onCreateNote={async () => {
            const note = await createNoteFile(element.title);
            await updateElement(element.id, { note_id: note.id });
            log('note', `Linked new Note “${note.name}”`);
            onRefresh?.();
            return note.id;
          }}
          agent={{
            aiWorkers, defaultWorkerId: assignedAiWorkerId, busy: isAgentRunOpen(agent.run),
            starting: agent.starting, error: agent.error ?? null,
            onStart: ({ workerId, prompt }) => agent.start({ workerId, prompt, triggeredFrom: 'detail', domainId }),
          }}
        />
      </div>

      {/* Scrollable body — Linear-style two-column layout */}
      <div className="flex-1 overflow-auto">
        <div className={layout === 'reader' ? "mx-auto w-full max-w-4xl px-5 py-7 flex flex-col gap-8" : "max-w-7xl mx-auto px-8 py-8 flex gap-8"}>
          <div className="flex-1 min-w-0 flex flex-col gap-8">

          {/* Title & description — under the concept's icon, like every concept page */}
          <div>
            <PageIcon><ElementIcon size={18} /></PageIcon>
            <div className="flex items-start gap-2 mb-3">
              {/* Auto-grow textarea so long titles wrap to multiple
                  lines instead of being clipped. Enter and Escape both
                  save (via blur) — the title autosaves, so Escape ends the
                  edit rather than discarding it (Cmd+Z undoes while
                  typing); Shift+Enter inserts a newline. Escape is
                  consumed here, so the page's own Escape (back to the
                  list) is the next press.
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
                  if (isCommitEnter(e) || isSubmitChord(e) || isCancelKey(e)) {
                    e.preventDefault();
                    e.currentTarget.blur();
                  }
                }}
                className={`bg-transparent border-none focus:outline-none flex-1 min-w-0 resize-none overflow-hidden ${PAGE_TITLE}`}
                style={PAGE_TITLE_WEIGHT}
                placeholder={t('Element title')}
              />
            </div>
            {layout === 'reader' && <div className="mb-5 flex flex-wrap items-center gap-2">
              <StatusPicker element={element} onChanged={handleStatusChange} trigger={
                <Button variant="secondary"><ElementProgressMark status={element.status} progress={getElementProgress(element, customColumns)} size={14} />{t(currentStatus.label)}</Button>
              } />
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="secondary"><PriorityMark priority={element.priority} />{t(currentPriority.label)}</Button></DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {priorityOptions.map(opt => <DropdownMenuItem key={opt.priority} onClick={() => handlePriorityChange(opt.priority)} className="gap-2"><PriorityMark priority={opt.priority} />{t(opt.label)}</DropdownMenuItem>)}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>}
            {!showDescriptionSource && (
              <div
                role="button"
                tabIndex={0}
                aria-label={t('Edit description')}
                onClick={(e) => { if (!(e.target as HTMLElement).closest('a')) setEditingDescription(true); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setEditingDescription(true); } }}
                className="min-h-[36px] cursor-text outline-none"
              >
                <MarkdownLite text={description} className="space-y-3 text-[14px] leading-[1.65]" />
              </div>
            )}
            {showDescriptionSource && <textarea
              ref={descriptionRef}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() => { setEditingDescription(false); void handleDescriptionSave(); }}
              onKeyDown={(e) => {
                // Multi-line: Enter is a newline; Cmd/Ctrl+Enter and
                // Escape end the edit and save.
                if (isSubmitChord(e) || isCancelKey(e)) {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
              placeholder={t('Add description…')}
              rows={1}
              className="block w-full p-0 text-[14px] leading-[1.65] text-foreground bg-transparent border-none focus:outline-none min-h-[36px] resize-none overflow-hidden"
            />}
          </div>

          {/* One row under the description, as Linear keeps a single line
              under an issue: reactions, the Note link and (once on) the
              approval state as quiet icons. Direction, dependencies and
              turning approval on are in the "…" menu. Below, each section
              takes the full width with its own heading — Direction (once
              set), Sub-elements (always, with its "+"), then Dependencies —
              so the read order is intent → its breakdown → what it waits on.
              Sharing an update belongs to the discussion, so it sits in the
              Comments heading. */}
          <div className="relative -ml-2.5 flex flex-wrap items-start gap-x-0.5 gap-y-5 [&>*.w-full]:pl-2.5">
          <ButtonAppearanceProvider appearance="inline">
          <div className="flex items-center gap-0.5">
            {/* Smile button → quick-emoji popover that toggles a
                reaction on this Element. */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setEmojiPickerOpen((o) => !o)}
                className="inline-flex items-center justify-center w-7 h-7 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
                title={t('Add reaction')}
                aria-label={t('Add reaction')}
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

            {/* Attach a file from this computer — it lists under the row and
                opens through a short-lived link (element_files). */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={fileActions.upload.isPending}
              className="inline-flex items-center justify-center w-7 h-7 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors disabled:opacity-50"
              title={t('Attach a file')}
              aria-label={t('Attach a file')}
            >
              <Paperclip size={15} />
            </button>
            <input ref={fileInputRef} type="file" multiple hidden
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? []);
                e.target.value = '';
                for (const f of picked) fileActions.upload.mutate(f, { onError: (err) => void appDialog.alert(err instanceof Error ? err.message : String(err)) });
              }} />

            {/* More to attach, kept off the page until chosen: a Note
                (Document), a new deck (Slide), a pull request. */}
            <div className="relative">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center w-7 h-7 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors data-[state=open]:bg-muted data-[state=open]:text-foreground"
                    title={t('More')}
                    aria-label={t('More')}
                  >
                    <MoreHorizontal size={15} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-[200px]">
                  {!element.note_id && (
                    <DropdownMenuItem onSelect={() => setTimeout(() => setNotePickerOpen(true), 0)} className="gap-2.5 py-1.5 text-[13px]">
                      <FileText size={15} className="text-muted-foreground" />{t('Document')}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onSelect={() => { requestNewDeck(element.title); openInApp('slides'); }} className="gap-2.5 py-1.5 text-[13px]">
                    <NavSlidesIcon size={15} />{t('Slide')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setTimeout(() => setLinkPrSignal((n) => n + 1), 0)} className="gap-2.5 py-1.5 text-[13px]">
                    <CodeChangeIcon size={15} className="text-muted-foreground" />{t('Link pull request')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <NotePicker
                open={notePickerOpen}
                onClose={() => setNotePickerOpen(false)}
                onPick={handlePickNote}
                anchorClassName="absolute top-full left-0 mt-1"
              />
            </div>

            {/* Approval — turned on from the "…" menu; once on, its state
                icon here opens the panel to record a decision (Approve /
                Request changes / Reject). */}
            <ElementApprovalMenu element={element} onRefresh={onRefresh} openSignal={approvalSignal} />

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
                    'text-[11px] px-1.5 h-7 inline-flex items-center gap-1 rounded-full transition-colors ' +
                    (mine.has(emoji)
                      ? 'bg-primary/15 text-foreground'
                      : 'hover:bg-muted text-foreground/80')
                  }
                >
                  <span>{emoji}</span>
                  <span className="tabular-nums">{n}</span>
                </button>
              ));
            })()}
          </div>
          </ButtonAppearanceProvider>
          {previewFile && <ElementFilePreview file={previewFile} onClose={() => setPreviewFile(null)} />}
          {files.length > 0 && (
            <section className="w-full" aria-label={t('Files')}>
              <div className="flex flex-wrap gap-1.5">
                {files.map((f) => (
                  <span key={f.id} className="group/file inline-flex max-w-[260px] items-center gap-1.5 rounded-md border border-border/60 bg-[var(--surface-rail)] py-1 pl-2 pr-1 text-[12.5px]">
                    <Paperclip size={12} className="shrink-0 text-muted-foreground" />
                    <button type="button" className="truncate text-foreground hover:underline" title={f.name}
                      onClick={() => setPreviewFile(f)}>
                      {f.name}
                    </button>
                    {f.uploaded_by === user?.id && (
                      <button type="button" aria-label={t('Remove {name}', { name: f.name })}
                        onClick={() => fileActions.remove.mutate(f, { onError: (err) => void appDialog.alert(err instanceof Error ? err.message : String(err)) })}
                        className="flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/file:opacity-100">
                        <X size={11} />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            </section>
          )}

          <ElementDirectionSection
            key={`direction-${element.id}`}
            element={element}
            onSaved={handleDirectionSave}
            openSignal={directionSignal}
          />

          {/* Sub-elements — a section like Comments: its heading folds the
              list (▶). Unfolded, the rows read like the Elements list
              (status, title, date, assignee, each set in place; the row opens
              the SubelementDetailModal), and a grey "Add sub-element" line
              under them takes a title and Enter. */}
          <section className="w-full">
            {/* Baseline-aligned, so the small done/total count sits on the
                heading's line rather than floating at its middle. */}
            <div className="mb-1 flex h-8 items-baseline gap-1 pt-1.5">
              <button type="button" onClick={() => setSubsOpen((o) => !o)} aria-expanded={subsOpen}
                className="flex items-center gap-2 rounded-md text-foreground">
                <h2 className={`${FONT.lg} text-foreground`}>{t('Sub-elements')}</h2>
                <DisclosureTriangle open={subsOpen} className="text-muted-foreground" />
              </button>
              {totalSubs > 0 && <span className="ml-1 text-[12px] tabular-nums text-muted-foreground">{completedSubs}/{totalSubs}</span>}
            </div>
            {subsOpen && (
              <div
                className="-mx-2 space-y-0 group/sublist"
                data-has-selection={subSelection.selectedRowIds.size > 0 ? '' : undefined}
              >
                {element.subelements?.map((sub) => (
                  <SubelementRow
                    key={sub.id}
                    subelement={sub}
                    workers={subWorkers}
                    onRefresh={onRefresh}
                    onOpen={() => setSubModal({ mode: 'detail', subelement: sub })}
                    canRowSelect
                    isSelected={subSelection.selectedRowIds.has(sub.id)}
                    hasSelectionRef={hasSubSelectionRef}
                    onRowSelect={(id, mode) => subSelection.handleRowSelect(id, mode, subIds)}
                  />
                ))}
                <div className="flex min-h-[2.125rem] items-center gap-2 px-2">
                  <span className="flex opacity-40"><ElementProgressMark status="todo" size={16} /></span>
                  <input
                    value={newSubTitle}
                    onChange={(e) => setNewSubTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void addSubelement(); }
                      else if (e.key === 'Escape') { e.preventDefault(); setNewSubTitle(''); e.currentTarget.blur(); }
                    }}
                    disabled={addingSub}
                    placeholder={t('Add sub-element')}
                    aria-label={t('Add sub-element')}
                    className="min-w-0 flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-muted-foreground/60"
                  />
                </div>
              </div>
            )}
          </section>

          <SubelementBulkBar
            count={subSelection.selectedRowIds.size}
            onMarkDone={() => bulkMarkSubs(true)}
            onMarkTodo={() => bulkMarkSubs(false)}
            onDelete={bulkDeleteSubs}
            onClear={subSelection.clearSelection}
          />

          <ElementDependencies elementId={element.id} spaceId={coordinationSpaceId ?? null}
            onOpenElement={onOpenElement} onChanged={onRefresh} openSignal={dependencySignal} />
          </div>

          <CodeChangesSection elementId={element.id} openSignal={linkPrSignal} />

          <AgentRunPanel
            agent={agent}
            onRunAgain={() => void agent.start({ workerId: rerunWorkerId(agent.run?.worker_id), triggeredFrom: 'detail', domainId })}
          />
          {checkInOpen && <CheckInDialog element={element} onClose={() => setCheckInOpen(false)}
            onSaved={() => { setCheckInOpen(false); onRefresh?.(); }} />}

          {/* Linked Note — embedded inline once chosen. */}
          {element.note_id && (
            <LinkedNoteEmbed
              noteId={element.note_id}
              onUnlink={handleUnlinkNote}
            />
          )}

          {/* Linked Elements */}
          {(edges.incoming.length > 0 || edges.outgoing.length > 0) && (
            <PageSection title={t('Linked Elements')}>
              <div>
                {edges.outgoing.map(edge => (
                  <div key={edge.id} className="flex h-8 items-center gap-2.5 px-2 text-[13px]">
                    <Link2 size={13} className="shrink-0 text-muted-foreground" />
                    <span className="truncate font-medium text-foreground">{edge.related_element?.title || t('Unknown')}</span>
                    <span className="shrink-0 text-[12px] text-muted-foreground">{edge.edge_type.replace('_', ' ')}</span>
                  </div>
                ))}
                {edges.incoming.map(edge => (
                  <div key={edge.id} className="flex h-8 items-center gap-2.5 px-2 text-[13px]">
                    <Link2 size={13} className="shrink-0 text-muted-foreground" />
                    <span className="truncate font-medium text-foreground">{edge.related_element?.title || t('Unknown')}</span>
                    <span className="shrink-0 text-[12px] text-muted-foreground">{t('{relation} this', { relation: edge.edge_type.replace('_', ' ') })}</span>
                  </div>
                ))}
              </div>
            </PageSection>
          )}

          {layout === 'reader' && <section className="space-y-3" aria-label={t('Activity')}>
            <h2 className={`${FONT.lg} text-foreground`}>{t('Activity')}</h2>
            <ActivityFeed entries={activityLog} compact />
          </section>}

          {/* The reader keeps changes next to their discussion. */}
          <div>
            {/* Comments and shared updates are one thread: a plain comment
                sends with the button, an update from its ▾. */}
            <div className="mb-4 flex items-center gap-2">
              <h2 className={`${FONT.lg} text-foreground`}>{t('Updates')}</h2>
            </div>
            <ElementCommentsPanel
              key={`comments-${element.id}`}
              sendOptions={[{ label: t('Share an update'), onSelect: () => setCheckInOpen(true) }]}
              refreshKey={agent.run ? `${agent.run.id}:${agent.run.status}:${agent.run.step_count}` : null}
              elementId={element.id}
              workers={allWorkers}
              focusCommentId={focusCommentId}
              onAskAgent={({ prompt, commentId, workerId }) =>
                agent.start({ mode: 'reply', prompt, replyTo: commentId, workerId: workerId ?? assignedAiWorkerId, triggeredFrom: 'comment', domainId })}
            />
          </div>

          {/* Bottom spacer */}
          <div className="h-8" />
          </div>

          {/* Right rail — islands (RailCard): each group a raised card with a
              quiet heading. Rows hover-highlight and open inline pickers. */}
          <aside className={layout === 'reader' ? "w-full space-y-4" : "w-72 shrink-0 hidden lg:block space-y-4"}>
            {/* What this Element is standing on — the decisions and
                assumptions the Initiative bound to it. Above Properties for the
                same reason Initiative intent sits above them on an Object: why
                it exists comes before who owns it. */}
            <WidgetSurface board={board} host={host} zones={ELEMENT_ZONES} addable={false}>
              <WidgetZone zone="rail" />
            </WidgetSurface>

            {/* Properties — required type + built-in structured fields. The
                "+ add property" affordance lives in the header (top-right),
                matching the Label island. */}
            <RailCard title={t('Properties')}>
              {/* Object membership — which Object(s) this Element belongs to
                  (object_id primary + element_objects multi-homing). Lives at
                  the very top of Properties (was its own island); each row is
                  clickable to open that Object. */}
              {memberObjects.length === 0 ? (
                <RailRow
                  icon={<span className="text-muted-foreground"><ObjectIcon size={14} /></span>}
                  name={t('Object')}
                  label={t('Not in any Object')}
                  placeholder
                  dense
                />
              ) : (
                memberObjects.map((o, i) => {
                  const rowName = i === 0 ? (memberObjects.length > 1 ? t('Objects') : t('Object')) : '';
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
                      name={t('Status')}
                      label={t(currentStatus.label)}
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
                      name={t('Priority')}
                      label={element.priority ? t(currentPriority.label) : t('Set priority')}
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
                      {t(opt.label)}
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
                      name={t('Date')}
                      label={
                        element.start_date || element.due_date
                          ? `${formatElementDate(element.start_date) ?? '—'} → ${formatElementDate(element.due_date) ?? '—'}`
                          : t('Start date → Target date')
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
                    defaultMonth={parseDateOnly(element.start_date) ?? parseDateOnly(element.due_date)}
                    selected={{
                      from: parseDateOnly(element.start_date),
                      to: parseDateOnly(element.due_date),
                    }}
                    onSelect={(range: DateRange | undefined) => {
                      handleDateChange('start_date', range?.from ? toDateOnlyString(range.from) : '');
                      handleDateChange('due_date', range?.to ? toDateOnlyString(range.to) : '');
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
                      {t('Clear')}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDateChange('start_date', toDateOnlyString(new Date()))}
                      className="text-[12px] text-primary hover:underline"
                    >
                      {t('Today')}
                    </button>
                  </div>
                </PopoverContent>
              </Popover>

              {/* Assignees */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="w-full"
                    aria-label={workerTriggerLabel(t('Assignee'), element.assignees?.map((a) => a.worker ?? null).filter((w): w is NonNullable<typeof w> => !!w) ?? [])}
                  >
                    <RailRow
                      icon={
                        element.assignees?.length
                          ? <WorkerAvatarStack workers={element.assignees.map(a => a.worker)} size={16} />
                          : <User className="size-3.5 text-muted-foreground" />
                      }
                      name={t('Assignee')}
                      label={element.assignees?.length
                        ? element.assignees.map(a => a.worker?.name || '?').join(', ')
                        : t('Assign')}
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

              {/* Lease — shown only while live; a lapsed lease is nobody. */}
              {lease && (
                <RailRow
                  icon={<Fingerprint className="size-3.5 text-muted-foreground" />}
                  name={t('Lease')}
                  label={
                    // The rail is the long form the row chip defers to, so it
                    // must read without hover: holder and time on one line,
                    // the branch on its own so neither truncates the other.
                    <span className="flex flex-col gap-0.5 min-w-0">
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="truncate" title={lease.holder}>{holderLabel(lease.holder)}</span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">{t('{time} left', { time: formatRemaining(lease.remainingMs) })}</span>
                      </span>
                      {lease.branch && (
                        <button
                          type="button"
                          onClick={() => copyBranch(lease.branch!)}
                          title={branchCopied ? t('Copied') : t('Copy {value}', { value: lease.branch })}
                          aria-label={branchCopied ? t('Branch copied') : t('Copy branch {branch}', { branch: lease.branch })}
                          className="flex items-center gap-1 min-w-0 self-start rounded px-1 -mx-1 text-muted-foreground hover:text-foreground hover:bg-muted/60 focus-visible:bg-muted/60 transition-colors"
                        >
                          <span className="truncate tabular-nums">{lease.branch}</span>
                          {branchCopied ? <Check className="size-3 shrink-0" /> : <Copy className="size-3 shrink-0" />}
                        </button>
                      )}
                    </span>
                  }
                />
              )}

              {/* Estimate */}
              <label className="block w-full cursor-pointer">
                <RailRow
                  icon={<Timer className="size-3.5 text-muted-foreground" />}
                  name={t('Estimate')}
                  label={estimatedHours ? t('{n}h', { n: estimatedHours }) : t('Set estimate')}
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

              {/* Custom Properties (object-scoped). Assignee, Lease and Estimate
                  are built-in fields and sit with the others above; this
                  heading only appears when the Object defines fields of its own. */}
              {customColumns.length > 0 && (
                <div className="px-2 pt-4 pb-1 text-[12px] font-medium text-muted-foreground">{t('Custom fields')}</div>
              )}
              {customColumns.map((col) => (
                <div key={col.id} className="flex items-center gap-2 px-2 min-h-8">
                  <span className="shrink-0 w-24 text-left text-[12px] text-muted-foreground">{col.name}</span>
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
              title={t('Label')}
              action={
                <LabelAddButton labels={element.labels ?? []} onChange={handleLabelsChange} objectId={element.object_id} />
              }
            >
              {(element.labels?.length ?? 0) === 0 ? (
                <div className="px-2 h-8 flex items-center text-[13px] text-muted-foreground">{t('No labels')}</div>
              ) : (
                <div className="px-2 py-1.5">
                  <LabelEditor labels={element.labels ?? []} />
                </div>
              )}
            </RailCard>

            {/* Activity — moved off the main column. Lives in the rail
                as its own island so the body stays focused on title /
                description / sub-elements / comments. */}
            {layout !== 'reader' && <RailCard title={activityLog.length ? t('Activity · {n}', { n: activityLog.length }) : t('Activity')} padded>
              <ActivityFeed entries={activityLog} compact />
            </RailCard>}
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
  const { t } = useI18n();
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
            name={t('Type')}
            icon={<ElementTypeIcon className="size-3.5 text-muted-foreground shrink-0" />}
            label={value ?? t('Set type')}
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
          placeholder={t('Search or add type…')}
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
              <span className="truncate">{t('Add “{name}”', { name: normalized })}</span>
            </button>
          )}
          {filtered.length === 0 && !canCreate && (
            <div className="px-2 py-2 text-[12px] text-muted-foreground text-center">
              {options.length === 0 ? t('Type a name to add the first one') : t('No match')}
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
              {t('Clear type')}
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
  const { t } = useI18n();
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
          <button type="button" aria-label={t('Label color')} className="shrink-0 inline-flex items-center justify-center rounded hover:bg-muted/60 transition-colors">
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
  const { t } = useI18n();
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
          aria-label={t('Add label')}
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
                aria-label={t('Back')}
              >
                <ChevronLeft size={13} />
              </button>
              <span className="text-[12px] text-muted-foreground truncate">
                {t('Pick a colour')} · <span className="text-foreground/80">{pending}</span>
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
              placeholder={t('Add labels…')}
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
                  <span className="truncate flex-1">{t('Create new label')}</span>
                  <span className="text-foreground/70 truncate">“{draft.trim()}”</span>
                </button>
              )}
              {suggestions.length === 0 && !q && (
                <div className="px-2 py-1.5 text-[12px] text-muted-foreground/60">{t('No labels yet')}</div>
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
  moved:      FolderInput,
  deleted:    Trash2,
  restored:   RotateCcw,
};

function ActivityFeed({
  entries, compact = false,
}: {
  entries: { id: string; kind: ActivityKind | 'created'; detail: string; author: string; createdAt: Date }[];
  compact?: boolean;
}) {
  const { t } = useI18n();
  if (entries.length === 0) {
    return (
      <p className={`text-muted-foreground ${compact ? 'text-center text-[12px] py-3' : 'text-[13px]'}`}>
        {t('No activity yet')}
      </p>
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
                  {entry.author} · {formatAge(entry.createdAt, true)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
