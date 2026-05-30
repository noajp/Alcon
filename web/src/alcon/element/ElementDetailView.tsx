'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Calendar, User, Link2, Plus, Clock, CheckCircle2, XCircle,
  Ban, Send, Circle, Flag, MessageSquare, History, Timer,
  X, ChevronDown, ChevronRight, ExternalLink, Tag as TagIcon, Pencil,
  Check,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';
import type { ElementWithDetails, Worker, ElementEdgeWithElement } from '@/hooks/useSupabase';
import {
  updateElement,
  fetchAllWorkers,
  addElementAssignee,
  removeElementAssignee,
  getElementEdges,
  fetchCustomColumnsWithValues,
  notifyMany,
  useAgentRun,
  useDomains,
  addDomainElementType,
  toggleReaction,
} from '@/hooks/useSupabase';
import type { CustomColumnWithValues } from '@/hooks/useSupabase';
import type { Subelement, ElementReaction } from '@/types/database';
import { supabase } from '@/lib/supabase';
import { ElementProgressMark, getElementProgress } from '@/alcon/shared/ElementProgressMark';
import { WorkerAvatar, WorkerAvatarStack } from '@/alcon/shared/WorkerAvatar';
import { PriorityMark } from '@/alcon/shared/PriorityMark';
import { ElementTypeIcon } from '@/shell/icons';
import { StatusPicker } from './StatusPicker';
import { SubelementRow } from './SubelementRow';
import { SubelementDetailModal } from './SubelementDetailModal';
import { ElementCommentsPanel } from './ElementCommentsPanel';
import { ElementApprovalPanel } from './ElementApprovalPanel';
import { ElementTimeTrackingPanel } from './ElementTimeTrackingPanel';
import { Smile, FileText } from 'lucide-react';
import { NotePicker } from '@/alcon/brief/NotePicker';
import { LinkedNoteEmbed } from '@/alcon/brief/LinkedNoteEmbed';
import { logActivity, loadActivity, type ActivityEntry as LoggedActivity, type ActivityKind } from './elementActivity';
import { useAuthContext } from '@/providers/AuthProvider';
import { AgentRunPanel } from './agent';
import { getActiveDomainId } from '@/alcon/domain/domainsStore';

interface ElementDetailViewProps {
  element: ElementWithDetails;
  objectName?: string;
  objectPath?: { id: string; name: string }[];
  /** Active Domain name — top segment in the breadcrumb. */
  domainName?: string | null;
  onBack: () => void;
  onRefresh?: () => void;
  onNavigateRoot?: () => void;
  onNavigateObject?: (objectId: string) => void;
}


// ============================================
// Status & Priority options
// ============================================
const statusOptions = [
  { status: 'backlog', label: 'Backlog', icon: Circle, color: 'text-muted-foreground' },
  { status: 'todo', label: 'Todo', icon: Circle, color: 'text-muted-foreground' },
  { status: 'in_progress', label: 'In Progress', icon: Clock, color: 'text-amber-400' },
  { status: 'review', label: 'In Review', icon: Send, color: 'text-blue-400' },
  { status: 'done', label: 'Done', icon: CheckCircle2, color: 'text-indigo-400' },
  { status: 'blocked', label: 'Blocked', icon: XCircle, color: 'text-red-400' },
  { status: 'cancelled', label: 'Cancelled', icon: Ban, color: 'text-muted-foreground' },
];

const priorityOptions = [
  { priority: 'urgent', label: 'Urgent', color: 'text-orange-400' },
  { priority: 'high', label: 'High', color: 'text-amber-400' },
  { priority: 'medium', label: 'Medium', color: 'text-muted-foreground' },
  { priority: 'low', label: 'Low', color: 'text-muted-foreground/70' },
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
// Section Card wrapper
// ============================================
function SectionCard({ title, icon: Icon, action, children, className = '' }: {
  title: string;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-[#2A2A2A] dark:bg-[#2A2A2A] rounded-2xl border border-border/60 dark:border-white/[0.06]  overflow-hidden ${className}`}>
      <div className="flex items-center justify-between px-5 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          {Icon && <Icon size={14} className="text-muted-foreground" />}
          <span className="text-sm font-semibold text-foreground">{title}</span>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

// ============================================
// Main Component
// ============================================
export function ElementDetailView({
  element,
  objectName: _objectName,
  objectPath,
  domainName,
  onRefresh,
  onNavigateRoot,
  onNavigateObject,
}: ElementDetailViewProps) {
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

  // Reactions on this Element. Fetched once + on every toggle.
  const [reactions, setReactions] = useState<ElementReaction[]>([]);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const refreshReactions = useCallback(async () => {
    const { data, error: rxErr } = await supabase
      .from('element_reactions')
      .select('*')
      .eq('element_id', element.id);
    if (!rxErr && data) setReactions(data as ElementReaction[]);
  }, [element.id]);
  useEffect(() => { void refreshReactions(); }, [refreshReactions]);
  // Subelement create / detail modal — null when closed; { mode: 'create' }
  // for the new-sub-element popup; { mode: 'detail', subelement } for editing.
  const [subModal, setSubModal] = useState<
    | { mode: 'create' }
    | { mode: 'detail'; subelement: Subelement }
    | null
  >(null);

  // Edges
  const [edges, setEdges] = useState<{ incoming: ElementEdgeWithElement[]; outgoing: ElementEdgeWithElement[] }>({ incoming: [], outgoing: [] });

  // Workers for assignee management
  const [allWorkers, setAllWorkers] = useState<Worker[]>([]);
  const [showAssigneeDropdown, setShowAssigneeDropdown] = useState(false);

  // Custom columns — fetched only to feed getElementProgress (progress rollup).
  const [customColumns, setCustomColumns] = useState<CustomColumnWithValues[]>([]);

  // Domain-shared Element types — the option list for the required `type`.
  const { data: domains, refetch: refetchDomains } = useDomains();
  const [domainId] = useState<string | null>(() => getActiveDomainId());
  const elementTypes = useMemo(
    () => domains.find((d) => d.id === domainId)?.element_types ?? [],
    [domains, domainId],
  );

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
  const agent = useAgentRun(element.id);
  const handleAgentStart = () =>
    agent.start({ domainId: getActiveDomainId(), triggeredFrom: 'detail' });
  // When a run finishes it moves the Element to "review" and posts its
  // deliverable as a comment — refresh the parent so the status updates.
  // (The comments panel is remounted via a finished_at-based key below.)
  const agentWasActive = useRef(false);
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

  // Estimated hours only — actual_hours is rolled up from time_entries via DB trigger
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

  useEffect(() => { getElementEdges(element.id).then(setEdges).catch(console.error); }, [element.id]);
  useEffect(() => { fetchAllWorkers(domainId).then(setAllWorkers).catch(console.error); }, [domainId]);
  useEffect(() => {
    if (element.object_id) {
      fetchCustomColumnsWithValues(element.object_id).then(setCustomColumns).catch(console.error);
    }
  }, [element.object_id]);

  // Handlers
  const handleTitleSave = async () => {
    if (title.trim() && title !== element.title) {
      try {
        await updateElement(element.id, { title: title.trim() });
        log('renamed', `Renamed to “${title.trim()}”`);
        onRefresh?.();
      } catch (e) { console.error(e); }
    }
  };

  const handleDescriptionSave = async () => {
    if (description !== (element.description || '')) {
      try {
        await updateElement(element.id, { description: description || null });
        log('description', description ? 'Updated description' : 'Cleared description');
        onRefresh?.();
      } catch (e) { console.error(e); }
    }
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

  const assignedWorkerIds = element.assignees?.map(a => a.worker_id) || [];
  const availableWorkers = allWorkers.filter(w => !assignedWorkerIds.includes(w.id));
  const completedSubs = element.subelements?.filter(s => s.is_completed).length || 0;
  const totalSubs = element.subelements?.length || 0;
  const progress = totalSubs > 0 ? Math.round((completedSubs / totalSubs) * 100) : 0;


  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return null;
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-card">
      {/* Breadcrumb — data hierarchy only: Domain > Object > Element. */}
      <div className="h-10 flex items-center gap-1 px-4 border-b border-border/60 bg-card flex-shrink-0">
        <div className="flex items-center gap-1 min-w-0 text-[12px] font-semibold">
          {domainName && (
            <>
              <button
                type="button"
                onClick={onNavigateRoot}
                disabled={!onNavigateRoot}
                className="px-1.5 py-0.5 rounded text-muted-foreground truncate max-w-[160px] transition-colors enabled:hover:text-foreground enabled:hover:bg-muted/40 disabled:cursor-default"
              >
                {domainName}
              </button>
              <ChevronRight size={12} className="text-muted-foreground/40 flex-shrink-0" />
            </>
          )}
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
            <div className="flex items-start gap-2 mb-1.5">
              {/* Auto-grow textarea so long titles wrap to multiple
                  lines instead of being clipped. Enter still saves
                  (matches the old input behaviour); Shift+Enter
                  inserts a newline within the title. */}
              <textarea
                ref={titleRef}
                value={title}
                rows={1}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={handleTitleSave}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    (e.currentTarget as HTMLTextAreaElement).blur();
                  }
                }}
                className="text-2xl font-bold text-foreground bg-transparent border-none focus:outline-none focus:ring-0 flex-1 min-w-0 resize-none leading-tight overflow-hidden"
                placeholder="Element title"
              />
            </div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={handleDescriptionSave}
              placeholder="Add description..."
              className="w-full text-[14px] text-muted-foreground bg-transparent border-none focus:outline-none focus:ring-0 min-h-[36px] resize-none"
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
                <div className="flex-1 h-px bg-border" />
                <button
                  onClick={() => setSubModal({ mode: 'create' })}
                  className="p-1 -m-1 text-muted-foreground hover:text-foreground transition-colors"
                  title="New sub-element"
                >
                  <Plus size={13} />
                </button>
              </div>
            )}
            <div className="space-y-0">
              {element.subelements?.map((sub) => (
                <SubelementRow
                  key={sub.id}
                  subelement={sub}
                  onRefresh={onRefresh}
                  onOpen={() => setSubModal({ mode: 'detail', subelement: sub })}
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
            {/* Properties — required type + built-in structured fields. */}
            <RailCard title="Properties">
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

              {/* Assignees */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="w-full">
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
                <DropdownMenuContent align="start" className="w-48">
                  {element.assignees?.map(a => (
                    <DropdownMenuItem key={a.id} onClick={() => handleRemoveAssignee(a.id)} className="gap-2">
                      <WorkerAvatar worker={a.worker} size={20} />
                      <span className="flex-1">{a.worker?.name}</span>
                      <X size={12} className="text-muted-foreground" />
                    </DropdownMenuItem>
                  ))}
                  {availableWorkers.length > 0 && (
                    <>
                      {(element.assignees?.length ?? 0) > 0 && <DropdownMenuSeparator />}
                      {availableWorkers.map(w => (
                        <DropdownMenuItem key={w.id} onClick={() => handleAddAssignee(w.id)} className="gap-2">
                          <WorkerAvatar worker={w} size={20} />
                          {w.name}
                        </DropdownMenuItem>
                      ))}
                    </>
                  )}
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
                          ? `${formatDate(element.start_date) ?? '—'} → ${formatDate(element.due_date) ?? '—'}`
                          : 'Start date → Target date'
                      }
                      placeholder={!element.start_date && !element.due_date}
                    />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="p-2 w-auto">
                  <div className="flex items-center gap-2 text-[12px]">
                    <input
                      type="date"
                      value={element.start_date?.split('T')[0] || ''}
                      onChange={(e) => handleDateChange('start_date', e.target.value)}
                      className="bg-muted/40 rounded px-1.5 py-0.5"
                    />
                    <span className="text-muted-foreground">→</span>
                    <input
                      type="date"
                      value={element.due_date?.split('T')[0] || ''}
                      onChange={(e) => handleDateChange('due_date', e.target.value)}
                      className="bg-muted/40 rounded px-1.5 py-0.5"
                    />
                  </div>
                </PopoverContent>
              </Popover>

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

              {/* Label — free-form string tags as the last row inside Properties. */}
              <div className="flex items-start gap-2 px-2 py-1.5">
                <span className="shrink-0 w-24 text-left text-[11px] font-semibold text-muted-foreground pt-1">Label</span>
                <div className="flex-1 min-w-0">
                  <LabelEditor labels={element.labels ?? []} />
                </div>
                <LabelAddButton labels={element.labels ?? []} onChange={handleLabelsChange} />
              </div>
            </RailCard>

            {/* AI Agent — start an autonomous run + live "Workpad" */}
            <RailCard title="AI Agent" padded>
              <AgentRunPanel
                run={agent.run}
                steps={agent.steps}
                starting={agent.starting}
                isActive={agent.isActive}
                loading={agent.loading}
                onStart={handleAgentStart}
                onCancel={agent.cancel}
              />
            </RailCard>

            {/* Time tracking — DB-backed timer + entries */}
            <RailCard title="Time tracking" padded>
              <ElementTimeTrackingPanel
                elementId={element.id}
                estimatedHours={element.estimated_hours}
                onRefresh={onRefresh}
              />
            </RailCard>

            {/* Approval workflow */}
            <RailCard title="Approval" padded>
              <ElementApprovalPanel element={element} onRefresh={onRefresh} />
            </RailCard>

            {/* Activity — moved off the main column. Lives in the rail
                as its own island so the body stays focused on title /
                description / sub-elements / comments. */}
            <RailCard title={`Activity${activityLog.length ? ` · ${activityLog.length}` : ''}`} padded>
              <ActivityFeed entries={activityLog} compact />
            </RailCard>
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
function RailCard({
  title, children, padded = false, icon,
}: { title: string; children: React.ReactNode; padded?: boolean; icon?: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="rounded-lg bg-card/90 dark:bg-[#2a2b32] border border-border/80 shadow-md overflow-hidden">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className="w-full flex items-center gap-1 px-3 pt-2.5 pb-1 text-[12px] font-semibold text-muted-foreground text-left hover:bg-muted/30 transition-colors"
      >
        {icon}
        <span>{title}</span>
        <ChevronDown
          size={11}
          className={`text-muted-foreground/70 transition-transform ${collapsed ? '-rotate-90' : ''}`}
        />
      </button>
      {!collapsed && (
        <div className={padded ? 'p-2' : 'p-1.5'}>
          {children}
        </div>
      )}
    </div>
  );
}

// ============================================
// Right-rail row — icon + label, hover bg.
// ============================================
function RailRow({
  icon, name, label, placeholder = false,
}: { icon?: React.ReactNode; name?: string; label: string; placeholder?: boolean }) {
  return (
    <div className={`flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/40 transition-colors text-[11px] font-normal leading-5 ${
      placeholder ? 'text-muted-foreground' : 'text-foreground/90'
    }`}>
      {name && (
        <span className="shrink-0 w-24 text-left text-[11px] font-semibold text-muted-foreground">{name}</span>
      )}
      {icon && (
        <span className="shrink-0 flex items-center justify-center min-w-4 opacity-90">{icon}</span>
      )}
      <span className="truncate text-left flex-1 min-w-0">{label}</span>
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
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && canCreate) create(); }}
          placeholder="Search or add type…"
          className="w-full px-2 py-1.5 mb-1 text-[13px] bg-muted/50 rounded-md placeholder:text-muted-foreground/60"
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
  if (labels.length === 0) return null;
  return (
    // -ml-[5px] aligns the chip's Tag icon centre with the Properties
    // icon column above (the chip's own px-2 pushes the icon right by
    // 5px otherwise).
    <div className="flex flex-wrap gap-1 -ml-[5px]">
      {labels.map((label) => (
        <span
          key={label}
          className="inline-flex items-center gap-1 shrink-0 max-w-[140px] px-2 py-0.5 rounded-full text-[11px] font-semibold text-foreground/90 bg-muted/60 ring-1 ring-border/60"
          title={label}
        >
          <TagIcon size={10} className="shrink-0 text-muted-foreground/80" />
          <span className="truncate">{label}</span>
        </span>
      ))}
    </div>
  );
}

// "+" button at the right of the Label row — opens a popover with an
// input to add a new label. Dedup is case-insensitive.
function LabelAddButton({
  labels, onChange,
}: {
  labels: string[];
  onChange: (labels: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const add = () => {
    const v = draft.trim();
    if (!v) { setDraft(''); setOpen(false); return; }
    if (!labels.some((l) => l.toLowerCase() === v.toLowerCase())) {
      onChange([...labels, v]);
    }
    setDraft('');
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setDraft(''); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Add label"
          className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-md text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors"
        >
          <Plus size={13} strokeWidth={2.5} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52 p-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder="Add a label…"
          className="w-full px-2 py-1 text-[13px] bg-muted/40 rounded-md placeholder:text-muted-foreground/60"
          autoFocus
        />
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
  status:     Circle,
  priority:   Flag,
  assigned:   User,
  unassigned: User,
  due:        Calendar,
  estimate:   Timer,
  subelement: CheckCircle2,
  craft:      ExternalLink,
  note:       FileText,
  comment:    MessageSquare,
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
