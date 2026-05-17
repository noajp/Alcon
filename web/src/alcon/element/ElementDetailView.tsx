'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Calendar, User, Link2, Plus, Clock, CheckCircle2, XCircle,
  Ban, Send, Circle, Flag, Paperclip, MessageSquare, History, Timer,
  X, ChevronDown, ChevronRight, ExternalLink, Tag as TagIcon, Pencil,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import type { ElementWithDetails, Worker, ElementEdgeWithElement } from '@/hooks/useSupabase';
import {
  updateElement,
  fetchAllWorkers,
  addElementAssignee,
  removeElementAssignee,
  getElementEdges,
  fetchCustomColumnsWithValues,
  setCustomColumnValue,
  createCustomColumn,
  notifyMany,
} from '@/hooks/useSupabase';
import type { CustomColumnWithValues } from '@/hooks/useSupabase';
import type { CustomColumnType, Json, Subelement } from '@/types/database';
import { AddColumnModal } from '@/alcon/tag';
import { CustomColumnCell } from '@/alcon/tag/CustomColumnCell';
import { AtomIcon } from '@/alcon/shared/AtomIcon';
import { SubelementRow } from './SubelementRow';
import { SubelementDetailModal } from './SubelementDetailModal';
import { ElementCommentsPanel } from './ElementCommentsPanel';
import { ElementApprovalPanel } from './ElementApprovalPanel';
import { ElementTimeTrackingPanel } from './ElementTimeTrackingPanel';
import { CraftButton } from './craft';
import { Smile } from 'lucide-react';
import type { Craft } from './craft';
import { logActivity, loadActivity, type ActivityEntry as LoggedActivity, type ActivityKind } from './elementActivity';
import { useAuthContext } from '@/providers/AuthProvider';

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
  { status: 'backlog', label: 'Backlog', icon: Circle, color: 'text-neutral-400' },
  { status: 'todo', label: 'Todo', icon: Circle, color: 'text-neutral-500' },
  { status: 'in_progress', label: 'In Progress', icon: Clock, color: 'text-amber-600' },
  { status: 'review', label: 'In Review', icon: Send, color: 'text-blue-600' },
  { status: 'done', label: 'Done', icon: CheckCircle2, color: 'text-emerald-600' },
  { status: 'blocked', label: 'Blocked', icon: XCircle, color: 'text-red-600' },
  { status: 'cancelled', label: 'Cancelled', icon: Ban, color: 'text-neutral-400' },
];

const priorityOptions = [
  { priority: 'urgent', label: 'Urgent', color: 'text-red-700' },
  { priority: 'high', label: 'High', color: 'text-amber-700' },
  { priority: 'medium', label: 'Medium', color: 'text-neutral-600' },
  { priority: 'low', label: 'Low', color: 'text-neutral-400' },
];

// ============================================
// Types for local-only features (until DB tables exist)
// ============================================
// Activity entries live in elementActivity.ts (localStorage-backed). The
// detail screen renders both the persisted log + a derived "created"
// entry pulled from element.created_at.

interface Attachment {
  id: string;
  name: string;
  url: string;
  type: 'file' | 'link';
  createdAt: Date;
}

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

  // Custom columns (Tags)
  const [customColumns, setCustomColumns] = useState<CustomColumnWithValues[]>([]);
  const [showAddTagModal, setShowAddTagModal] = useState(false);

  const refetchCustomColumns = async () => {
    if (!element.object_id) return;
    try {
      const updated = await fetchCustomColumnsWithValues(element.object_id);
      setCustomColumns(updated);
    } catch (e) { console.error(e); }
  };

  const handleTagValueChange = async (columnId: string, value: Json) => {
    try {
      await setCustomColumnValue(columnId, element.id, value);
      await refetchCustomColumns();
    } catch (e) { console.error('Failed to update tag value:', e); }
  };

  const handleAddTag = async (name: string, type: CustomColumnType) => {
    if (!element.object_id) return;
    try {
      let options: Record<string, unknown> = {};
      if (type === 'select' || type === 'multi_select' || type === 'status') {
        options = { options: [{ value: 'Option 1' }, { value: 'Option 2' }] };
      }
      await createCustomColumn({ object_id: element.object_id, name, column_type: type, options });
      await refetchCustomColumns();
      setShowAddTagModal(false);
    } catch (e) { console.error('Failed to create tag:', e); }
  };

  // Auth context for notifications + comment authorship
  const { user, profile } = useAuthContext();

  // Comments are now DB-backed via ElementCommentsPanel; tab badge counter only.
  const [commentCount, setCommentCount] = useState(0);

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

  // Attachments (local state)
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [showAddLink, setShowAddLink] = useState(false);
  const [newLinkName, setNewLinkName] = useState('');
  const [newLinkUrl, setNewLinkUrl] = useState('');

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
  useEffect(() => { fetchAllWorkers().then(setAllWorkers).catch(console.error); }, []);
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
    try {
      await updateElement(element.id, { status: newStatus as 'todo' });
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

  const handleAddLink = () => {
    if (!newLinkName.trim() || !newLinkUrl.trim()) return;
    setAttachments(prev => [...prev, {
      id: `att-${Date.now()}`,
      name: newLinkName.trim(),
      url: newLinkUrl.trim(),
      type: 'link',
      createdAt: new Date(),
    }]);
    setNewLinkName('');
    setNewLinkUrl('');
    setShowAddLink(false);
  };

  const handleAddAssignee = async (workerId: string) => {
    try {
      await addElementAssignee({ element_id: element.id, worker_id: workerId, role: 'assignee' });
      const worker = allWorkers.find(w => w.id === workerId);
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

  // Craft check-out: persist a link-style attachment locally + push the
  // element into review so an approver can sign off on the deliverable.
  const handleCraftCheckedOut = async (craft: Craft) => {
    setAttachments((prev) => [
      {
        id: `craft-${craft.id}`,
        name: `${craft.title} (HTML)`,
        url: `data:text/html;charset=utf-8,${encodeURIComponent(craft.html)}`,
        type: 'link',
        createdAt: new Date(craft.created_at),
      },
      ...prev,
    ]);
    log('craft', `Checked out craft “${craft.title}” (${craft.format})`);
    if (element.status !== 'review' && element.status !== 'done') {
      try {
        await updateElement(element.id, { status: 'review' });
        onRefresh?.();
      } catch (e) { console.error('Failed to bump element to review on craft checkout', e); }
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
      </div>

      {/* Scrollable body — Linear-style two-column layout */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-5xl mx-auto px-8 py-8 flex gap-8">
          <div className="flex-1 min-w-0 space-y-5">

          {/* Title & description */}
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <AtomIcon size={20} className="text-muted-foreground flex-shrink-0" />
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={handleTitleSave}
                onKeyDown={(e) => { if (e.key === 'Enter') handleTitleSave(); }}
                className="text-2xl font-bold text-foreground bg-transparent border-none focus:outline-none focus:ring-0 flex-1 min-w-0"
                placeholder="Element title"
              />
            </div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={handleDescriptionSave}
              placeholder="Add description..."
              className="w-full text-[14px] text-muted-foreground bg-transparent border-none focus:outline-none focus:ring-0 min-h-[36px] resize-none pl-7"
            />
          </div>

          {/* Action row — emoji / paperclip / Craft (icon-only).
              Sits above the subelements list, mirroring GitHub-issue style. */}
          <div className="flex items-center gap-1 px-1">
            <button
              className="inline-flex items-center justify-center w-7 h-7 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
              title="Add reaction"
            >
              <Smile size={15} />
            </button>
            <button
              className="inline-flex items-center justify-center w-7 h-7 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
              title="Attach a link"
            >
              <Paperclip size={15} />
            </button>
            <CraftButton
              element={{ id: element.id, title: element.title, description: element.description }}
              onCheckedOut={handleCraftCheckedOut}
            />
          </div>

          {/* Sub-elements — list-style (no card bg). Each row mirrors the
              Elements list (checkbox + atom icon + title) and clicking a
              row opens the SubelementDetailModal. New sub-elements are
              created through the same modal — once at least one exists,
              the only entry point is a small "+" at the right end of the
              header. Empty state still shows a labelled "Add sub-element"
              link so the affordance is obvious. */}
          <div className="space-y-1.5 px-1">
            {totalSubs > 0 && (
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
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
            <div className="flex items-center gap-2 mb-3 text-[12px] font-semibold text-muted-foreground">
              <MessageSquare size={13} />
              <span>Comments</span>
              {commentCount > 0 && (
                <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded-full">{commentCount}</span>
              )}
              <div className="flex-1 h-px bg-border" />
            </div>
            <ElementCommentsPanel
              elementId={element.id}
              elementTitle={element.title}
              workers={allWorkers}
              onCountChange={setCommentCount}
            />
          </div>

          {/* Attachments & Links */}
          <div className="rounded-xl bg-muted/30 p-3">
            <div className="flex items-center justify-between px-1 pb-2">
              <div className="flex items-center gap-1.5">
                <Paperclip size={11} className="text-muted-foreground" />
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Attachments</span>
              </div>
              <button onClick={() => setShowAddLink(true)} className="text-muted-foreground hover:text-foreground">
                <Plus size={14} />
              </button>
            </div>
            <div>
              {showAddLink && (
                <div className="mb-3 p-3 bg-muted/30 rounded-lg space-y-2">
                  <input
                    type="text"
                    value={newLinkName}
                    onChange={(e) => setNewLinkName(e.target.value)}
                    placeholder="Link name (e.g. Figma design)"
                    className="w-full px-2 py-1.5 text-[13px] border border-border rounded bg-background focus:outline-none"
                    autoFocus
                  />
                  <input
                    type="url"
                    value={newLinkUrl}
                    onChange={(e) => setNewLinkUrl(e.target.value)}
                    placeholder="https://..."
                    className="w-full px-2 py-1.5 text-[13px] border border-border rounded bg-background focus:outline-none"
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAddLink(); }}
                  />
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => { setShowAddLink(false); setNewLinkName(''); setNewLinkUrl(''); }} className="px-3 py-1 text-[13px] text-muted-foreground hover:bg-muted rounded">Cancel</button>
                    <button onClick={handleAddLink} disabled={!newLinkName.trim() || !newLinkUrl.trim()} className="px-3 py-1 text-[13px] bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50">Add</button>
                  </div>
                </div>
              )}
              {attachments.length > 0 ? (
                <div className="space-y-1">
                  {attachments.map(att => (
                    <div key={att.id} className="flex items-center gap-2 py-1.5 px-2 bg-muted/30 rounded-md group">
                      <ExternalLink size={13} className="text-muted-foreground flex-shrink-0" />
                      <a href={att.url} target="_blank" rel="noopener noreferrer" className="text-[13px] text-foreground hover:underline truncate flex-1">
                        {att.name}
                      </a>
                      <button onClick={() => setAttachments(prev => prev.filter(a => a.id !== att.id))} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity">
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : !showAddLink && (
                <button onClick={() => setShowAddLink(true)} className="text-[13px] text-muted-foreground hover:text-foreground px-1 py-1">
                  + Add link or attachment
                </button>
              )}
            </div>
          </div>

          {/* Linked Elements */}
          {(edges.incoming.length > 0 || edges.outgoing.length > 0) && (
            <div className="rounded-xl bg-muted/30 p-3">
              <div className="flex items-center gap-1.5 px-1 pb-2">
                <Link2 size={11} className="text-muted-foreground" />
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Linked Elements</span>
              </div>
              <div className="space-y-1">
                {edges.outgoing.map(edge => (
                  <div key={edge.id} className="flex items-center gap-2 text-[13px] py-1.5 px-2 bg-muted/30 rounded-md">
                    <span className="text-[11px] text-muted-foreground px-1.5 py-0.5 bg-muted rounded">{edge.edge_type.replace('_', ' ')}</span>
                    <span className="font-medium">{edge.related_element?.title || 'Unknown'}</span>
                  </div>
                ))}
                {edges.incoming.map(edge => (
                  <div key={edge.id} className="flex items-center gap-2 text-[13px] py-1.5 px-2 bg-muted/30 rounded-md">
                    <span className="font-medium">{edge.related_element?.title || 'Unknown'}</span>
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
          <aside className="w-64 shrink-0 hidden lg:block space-y-3">
            <RailCard title="Properties">
              {/* Status */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="w-full">
                    <RailRow
                      icon={<currentStatus.icon className={`size-3.5 ${currentStatus.color}`} />}
                      label={currentStatus.label}
                    />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-40">
                  {statusOptions.map(opt => (
                    <DropdownMenuItem key={opt.status} onClick={() => handleStatusChange(opt.status)} className="gap-2">
                      <opt.icon className={`size-4 ${opt.color}`} />
                      {opt.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Priority */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="w-full">
                    <RailRow
                      icon={<Flag className={`size-3.5 ${currentPriority.color}`} />}
                      label={element.priority ? currentPriority.label : 'Set priority'}
                      placeholder={!element.priority}
                    />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-36">
                  {priorityOptions.map(opt => (
                    <DropdownMenuItem key={opt.priority} onClick={() => handlePriorityChange(opt.priority)} className="gap-2">
                      <Flag className={`size-4 ${opt.color}`} />
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
                      icon={<User className="size-3.5 text-muted-foreground" />}
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
                      <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-medium text-primary flex-shrink-0">
                        {a.worker?.name?.charAt(0) || '?'}
                      </div>
                      <span className="flex-1">{a.worker?.name}</span>
                      <X size={12} className="text-muted-foreground" />
                    </DropdownMenuItem>
                  ))}
                  {availableWorkers.length > 0 && (
                    <>
                      {(element.assignees?.length ?? 0) > 0 && <DropdownMenuSeparator />}
                      {availableWorkers.map(w => (
                        <DropdownMenuItem key={w.id} onClick={() => handleAddAssignee(w.id)} className="gap-2">
                          <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-[10px]">{w.name.charAt(0)}</div>
                          {w.name}
                        </DropdownMenuItem>
                      ))}
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Due date */}
              <label className="block w-full cursor-pointer">
                <RailRow
                  icon={<Calendar className="size-3.5 text-muted-foreground" />}
                  label={formatDate(element.due_date) ?? 'Set due date'}
                  placeholder={!element.due_date}
                />
                <input
                  type="date"
                  value={element.due_date?.split('T')[0] || ''}
                  onChange={(e) => handleDateChange('due_date', e.target.value)}
                  className="sr-only"
                />
              </label>

              {/* Estimate */}
              <label className="block w-full cursor-pointer">
                <RailRow
                  icon={<Timer className="size-3.5 text-muted-foreground" />}
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
            </RailCard>

            {/* Labels (custom tags) */}
            {(customColumns.length > 0 || element.object_id) && (
              <RailCard title="Labels">
                {customColumns.map((col) => {
                  const cellValue = col.values?.[element.id]?.value ?? null;
                  return (
                    <div key={col.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/40 transition-colors">
                      <TagIcon className="size-3.5 text-muted-foreground shrink-0" />
                      <span className="text-[12px] text-muted-foreground shrink-0 truncate w-16">{col.name}</span>
                      <div className="flex-1 min-w-0">
                        <CustomColumnCell
                          column={col}
                          elementId={element.id}
                          value={cellValue}
                          onChange={(v) => handleTagValueChange(col.id, v)}
                        />
                      </div>
                    </div>
                  );
                })}
                {element.object_id && (
                  <button
                    type="button"
                    onClick={() => setShowAddTagModal(true)}
                    className="w-full"
                  >
                    <RailRow
                      icon={<Plus className="size-3.5 text-muted-foreground" />}
                      label="Add label"
                      placeholder
                    />
                  </button>
                )}
              </RailCard>
            )}

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

      {showAddTagModal && (
        <AddColumnModal
          onClose={() => setShowAddTagModal(false)}
          onAdd={handleAddTag}
        />
      )}
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
  title, children, padded = false,
}: { title: string; children: React.ReactNode; padded?: boolean }) {
  return (
    <div className="rounded-lg bg-zinc-200/60 dark:bg-zinc-800/50 border border-zinc-300/60 dark:border-zinc-700/60 overflow-hidden">
      <div className="flex items-center gap-1 px-3 pt-2.5 pb-1 text-[11.5px] font-medium text-foreground">
        <span>{title}</span>
        <ChevronDown size={11} className="text-muted-foreground" />
      </div>
      <div className={padded ? 'p-2' : 'p-1.5'}>
        {children}
      </div>
    </div>
  );
}

// ============================================
// Right-rail row — icon + label, hover bg.
// ============================================
function RailRow({
  icon, label, placeholder = false,
}: { icon: React.ReactNode; label: string; placeholder?: boolean }) {
  return (
    <div className={`flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/50 transition-colors text-[13px] ${
      placeholder ? 'text-muted-foreground' : 'text-foreground'
    }`}>
      <span className="shrink-0 flex items-center justify-center w-4">{icon}</span>
      <span className="truncate text-left">{label}</span>
    </div>
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
