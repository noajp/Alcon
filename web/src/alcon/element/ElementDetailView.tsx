'use client';

import { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft, Calendar, User, Link2, Plus, Clock, CheckCircle2, XCircle,
  Ban, Send, Circle, Flag, Paperclip, MessageSquare, History, Timer,
  X, ChevronDown, ChevronRight, ExternalLink,
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
  createSubelement,
  updateSubelement,
  fetchAllWorkers,
  addElementAssignee,
  removeElementAssignee,
  getElementEdges,
  fetchCustomColumnsWithValues,
} from '@/hooks/useSupabase';
import type { CustomColumnWithValues } from '@/hooks/useSupabase';
import { SubelementRow } from './SubelementRow';
import dynamic from 'next/dynamic';

const BlockEditor = dynamic(
  () => import('@/alcon/brief/editor/BlockEditor').then(mod => mod.BlockEditor),
  { ssr: false, loading: () => <div className="p-4 text-muted-foreground text-sm">Loading editor...</div> }
);

interface ElementDetailViewProps {
  element: ElementWithDetails;
  objectName?: string;
  objectPath?: { id: string; name: string }[];
  onBack: () => void;
  onRefresh?: () => void;
}

const AtomIcon = ({ className = '' }: { className?: string }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
    <ellipse cx="12" cy="12" rx="9.5" ry="3.5" />
    <ellipse cx="12" cy="12" rx="9.5" ry="3.5" transform="rotate(60 12 12)" />
    <ellipse cx="12" cy="12" rx="9.5" ry="3.5" transform="rotate(120 12 12)" />
  </svg>
);

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
interface Comment {
  id: string;
  author: string;
  text: string;
  createdAt: Date;
}

interface ActivityEntry {
  id: string;
  action: string;
  detail: string;
  author: string;
  createdAt: Date;
}

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
export function ElementDetailView({ element, objectName: _objectName, objectPath, onBack, onRefresh }: ElementDetailViewProps) {
  const [title, setTitle] = useState(element.title);
  const [description, setDescription] = useState(element.description || '');
  const [newSubelementTitle, setNewSubelementTitle] = useState('');
  const [isAddingSubelement, setIsAddingSubelement] = useState(false);

  // Edges
  const [edges, setEdges] = useState<{ incoming: ElementEdgeWithElement[]; outgoing: ElementEdgeWithElement[] }>({ incoming: [], outgoing: [] });

  // Workers for assignee management
  const [allWorkers, setAllWorkers] = useState<Worker[]>([]);
  const [showAssigneeDropdown, setShowAssigneeDropdown] = useState(false);

  // Custom columns
  const [customColumns, setCustomColumns] = useState<CustomColumnWithValues[]>([]);

  // Comments (local state - will be persisted to DB later)
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');

  // Activity log (generated from element data)
  const [activityLog] = useState<ActivityEntry[]>(() => {
    const entries: ActivityEntry[] = [];
    if (element.created_at) {
      entries.push({
        id: 'created',
        action: 'created',
        detail: `Created element "${element.title}"`,
        author: 'System',
        createdAt: new Date(element.created_at),
      });
    }
    if (element.updated_at && element.updated_at !== element.created_at) {
      entries.push({
        id: 'updated',
        action: 'updated',
        detail: `Last updated`,
        author: 'System',
        createdAt: new Date(element.updated_at),
      });
    }
    if (element.status === 'done') {
      entries.push({
        id: 'done',
        action: 'completed',
        detail: 'Marked as Done',
        author: 'System',
        createdAt: new Date(element.updated_at || element.created_at || new Date()),
      });
    }
    return entries.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  });

  // Attachments (local state)
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [showAddLink, setShowAddLink] = useState(false);
  const [newLinkName, setNewLinkName] = useState('');
  const [newLinkUrl, setNewLinkUrl] = useState('');

  // Time tracking
  const [estimatedHours, setEstimatedHours] = useState<string>(element.estimated_hours?.toString() || '');
  const [actualHours, setActualHours] = useState<string>(element.actual_hours?.toString() || '');

  // Active left tab
  const [activeSection, setActiveSection] = useState<'notes' | 'comments' | 'activity'>('notes');

  const currentStatus = statusOptions.find(s => s.status === element.status) || statusOptions[1];
  const currentPriority = priorityOptions.find(p => p.priority === element.priority) || priorityOptions[2];

  // Sync with prop changes
  useEffect(() => {
    setTitle(element.title);
    setDescription(element.description || '');
    setEstimatedHours(element.estimated_hours?.toString() || '');
    setActualHours(element.actual_hours?.toString() || '');
  }, [element.id, element.title, element.description, element.estimated_hours, element.actual_hours]);

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
      try { await updateElement(element.id, { title: title.trim() }); onRefresh?.(); } catch (e) { console.error(e); }
    }
  };

  const handleDescriptionSave = async () => {
    if (description !== (element.description || '')) {
      try { await updateElement(element.id, { description: description || null }); onRefresh?.(); } catch (e) { console.error(e); }
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    try { await updateElement(element.id, { status: newStatus as 'todo' }); onRefresh?.(); } catch (e) { console.error(e); }
  };

  const handlePriorityChange = async (newPriority: string) => {
    try { await updateElement(element.id, { priority: newPriority as 'medium' }); onRefresh?.(); } catch (e) { console.error(e); }
  };

  const handleDateChange = async (field: 'start_date' | 'due_date', value: string) => {
    try { await updateElement(element.id, { [field]: value || null }); onRefresh?.(); } catch (e) { console.error(e); }
  };

  const handleHoursSave = async (field: 'estimated_hours' | 'actual_hours', value: string) => {
    const numVal = value ? parseFloat(value) : null;
    try { await updateElement(element.id, { [field]: numVal }); onRefresh?.(); } catch (e) { console.error(e); }
  };

  const handleAddSubelement = async () => {
    if (!newSubelementTitle.trim()) return;
    try {
      await createSubelement({ element_id: element.id, title: newSubelementTitle.trim() });
      setNewSubelementTitle('');
      setIsAddingSubelement(false);
      onRefresh?.();
    } catch (e) { console.error(e); }
  };

  const handleAddComment = () => {
    if (!newComment.trim()) return;
    setComments(prev => [{
      id: `comment-${Date.now()}`,
      author: 'You',
      text: newComment.trim(),
      createdAt: new Date(),
    }, ...prev]);
    setNewComment('');
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
      setShowAssigneeDropdown(false);
      onRefresh?.();
    } catch (e) { console.error(e); }
  };

  const handleRemoveAssignee = async (assigneeId: string) => {
    try { await removeElementAssignee(assigneeId); onRefresh?.(); } catch (e) { console.error(e); }
  };

  const assignedWorkerIds = element.assignees?.map(a => a.worker_id) || [];
  const availableWorkers = allWorkers.filter(w => !assignedWorkerIds.includes(w.id));
  const completedSubs = element.subelements?.filter(s => s.is_completed).length || 0;
  const totalSubs = element.subelements?.length || 0;
  const progress = totalSubs > 0 ? Math.round((completedSubs / totalSubs) * 100) : 0;

  // Get custom column values for this element
  const elementCustomValues = customColumns.map(col => {
    const val = col.values?.[element.id];
    return { name: col.name, type: col.column_type, value: val?.value ?? null };
  }).filter(v => v.value !== null);

  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return null;
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-card">
      {/* Header bar with breadcrumb */}
      <div className="flex items-center gap-2 px-5 py-3 border-b border-border flex-shrink-0">
        <button onClick={onBack} className="p-1.5 hover:bg-muted rounded-md transition-colors flex-shrink-0" title="Back to list">
          <ArrowLeft size={16} className="text-foreground" />
        </button>
        {objectPath && objectPath.length > 0 && (
          <div className="flex items-center gap-1 min-w-0 text-[13px]">
            {objectPath.map((seg, i) => (
              <span key={seg.id} className="flex items-center gap-1 min-w-0">
                {i > 0 && <ChevronRight size={12} className="text-muted-foreground/40 flex-shrink-0" />}
                <span className="text-muted-foreground truncate max-w-[160px]">{seg.name}</span>
              </span>
            ))}
            <ChevronRight size={12} className="text-muted-foreground/40 flex-shrink-0" />
            <span className="text-foreground font-medium truncate max-w-[200px]">{element.title}</span>
          </div>
        )}
      </div>

      {/* Scrollable body — Linear-style two-column layout */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-5xl mx-auto px-8 py-8 flex gap-8">
          <div className="flex-1 min-w-0 space-y-5">

          {/* Title & description */}
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <AtomIcon className="text-muted-foreground flex-shrink-0" />
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

          {/* Notes / Comments / Activity */}
          <div>
            <div className="flex items-center gap-1 mb-3">
              {([
                { id: 'notes' as const, label: 'Notes', icon: History },
                { id: 'comments' as const, label: 'Comments', icon: MessageSquare, count: comments.length },
                { id: 'activity' as const, label: 'Activity', icon: History },
              ] as const).map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveSection(tab.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] transition-colors ${
                    activeSection === tab.id
                      ? 'bg-card border border-border shadow-sm text-foreground font-medium'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <tab.icon size={13} />
                  {tab.label}
                  {'count' in tab && tab.count > 0 && (
                    <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded-full">{tab.count}</span>
                  )}
                </button>
              ))}
            </div>

            {activeSection === 'notes' && (
              <div className="rounded-xl border border-border overflow-hidden">
                <div className="min-h-[240px]">
                  <div id="element-detail-toolbar" />
                  <BlockEditor
                    initialContent=""
                    onChange={() => {}}
                    toolbarContainerId="element-detail-toolbar"
                  />
                </div>
              </div>
            )}

            {activeSection === 'comments' && (
              <div className="rounded-xl border border-border p-4">
                <div className="flex gap-3 mb-4">
                  <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary flex-shrink-0">
                    Y
                  </div>
                  <div className="flex-1">
                    <textarea
                      value={newComment}
                      onChange={(e) => setNewComment(e.target.value)}
                      placeholder="Write a comment..."
                      className="w-full text-[13px] bg-muted/30 border border-border rounded-lg px-3 py-2 focus:outline-none resize-none min-h-[56px]"
                      onKeyDown={(e) => { if (e.key === 'Enter' && e.metaKey) handleAddComment(); }}
                    />
                    <div className="flex justify-end mt-2">
                      <button
                        onClick={handleAddComment}
                        disabled={!newComment.trim()}
                        className="px-3 py-1.5 text-[13px] bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
                      >
                        Comment
                      </button>
                    </div>
                  </div>
                </div>
                {comments.length > 0 ? (
                  <div className="space-y-4 border-t border-border pt-4">
                    {comments.map(comment => (
                      <div key={comment.id} className="flex gap-3">
                        <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground flex-shrink-0">
                          {comment.author.charAt(0)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[13px] font-medium text-foreground">{comment.author}</span>
                            <span className="text-[11px] text-muted-foreground">{timeAgo(comment.createdAt)}</span>
                          </div>
                          <p className="text-[13px] text-foreground/80">{comment.text}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-6 text-muted-foreground text-[13px]">No comments yet.</div>
                )}
              </div>
            )}

            {activeSection === 'activity' && (
              <div className="rounded-xl border border-border p-4">
                {activityLog.length > 0 ? (
                  <div className="space-y-3">
                    {activityLog.map(entry => (
                      <div key={entry.id} className="flex items-start gap-3">
                        <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center flex-shrink-0 mt-0.5">
                          <History size={12} className="text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] text-foreground/80">{entry.detail}</p>
                          <span className="text-[11px] text-muted-foreground">{timeAgo(entry.createdAt)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-6 text-muted-foreground text-[13px]">No activity yet</div>
                )}
              </div>
            )}
          </div>

          {/* Subelements */}
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/20">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={14} className="text-muted-foreground" />
                <span className="text-[13px] font-medium text-foreground">Subelements</span>
              </div>
              <div className="flex items-center gap-2">
                {totalSubs > 0 && (
                  <>
                    <div className="w-14 h-1 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${progress}%` }} />
                    </div>
                    <span className="text-[11px] text-muted-foreground">{completedSubs}/{totalSubs}</span>
                  </>
                )}
                <button onClick={() => setIsAddingSubelement(true)} className="text-muted-foreground hover:text-foreground">
                  <Plus size={15} />
                </button>
              </div>
            </div>
            <div className="p-3 space-y-0.5">
              {element.subelements?.map(sub => (
                <SubelementRow key={sub.id} subelement={sub} onRefresh={onRefresh} />
              ))}
              {isAddingSubelement && (
                <input
                  type="text"
                  value={newSubelementTitle}
                  onChange={(e) => setNewSubelementTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddSubelement();
                    if (e.key === 'Escape') { setNewSubelementTitle(''); setIsAddingSubelement(false); }
                  }}
                  placeholder="Subelement title..."
                  className="w-full px-2 py-1.5 text-sm border border-border rounded focus:outline-none bg-background mt-1"
                  autoFocus
                />
              )}
              {totalSubs === 0 && !isAddingSubelement && (
                <button onClick={() => setIsAddingSubelement(true)} className="text-[13px] text-muted-foreground hover:text-foreground px-1 py-1">
                  + Add subelement
                </button>
              )}
            </div>
          </div>

          {/* Attachments & Links */}
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/20">
              <div className="flex items-center gap-2">
                <Paperclip size={14} className="text-muted-foreground" />
                <span className="text-[13px] font-medium text-foreground">Attachments</span>
              </div>
              <button onClick={() => setShowAddLink(true)} className="text-muted-foreground hover:text-foreground">
                <Plus size={15} />
              </button>
            </div>
            <div className="p-3">
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
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-muted/20">
                <Link2 size={14} className="text-muted-foreground" />
                <span className="text-[13px] font-medium text-foreground">Linked Elements</span>
              </div>
              <div className="p-3 space-y-1">
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

          {/* Properties widget — right sidebar */}
          <aside className="w-60 shrink-0 hidden lg:block">
            <div className="sticky top-0 rounded-xl border border-border overflow-hidden bg-card">
              <div className="px-3 py-2 border-b border-border bg-muted/20">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Properties</span>
              </div>
              <div className="p-2 space-y-0.5">
                {/* Status */}
                <div className="flex items-center gap-2 px-1">
                  <span className="w-16 text-[12px] text-muted-foreground shrink-0">Status</span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="flex-1 flex items-center gap-1.5 px-1.5 py-1 rounded text-[13px] hover:bg-muted transition-colors min-w-0">
                        <currentStatus.icon className={`size-3.5 ${currentStatus.color} shrink-0`} />
                        <span className="truncate">{currentStatus.label}</span>
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
                </div>

                {/* Priority */}
                <div className="flex items-center gap-2 px-1">
                  <span className="w-16 text-[12px] text-muted-foreground shrink-0">Priority</span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="flex-1 flex items-center gap-1.5 px-1.5 py-1 rounded text-[13px] hover:bg-muted transition-colors min-w-0">
                        <Flag className={`size-3.5 ${currentPriority.color} shrink-0`} />
                        <span className={`${currentPriority.color} truncate`}>{currentPriority.label}</span>
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
                </div>

                {/* Assignees */}
                <div className="flex items-center gap-2 px-1">
                  <span className="w-16 text-[12px] text-muted-foreground shrink-0">Assignee</span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="flex-1 flex items-center gap-1.5 px-1.5 py-1 rounded text-[13px] hover:bg-muted transition-colors min-w-0">
                        <User className="size-3.5 text-muted-foreground shrink-0" />
                        <span className={`${element.assignees?.length ? 'text-foreground' : 'text-muted-foreground'} truncate`}>
                          {element.assignees?.length
                            ? element.assignees.map(a => a.worker?.name || '?').join(', ')
                            : 'Unassigned'}
                        </span>
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
                </div>

                {/* Due date */}
                <div className="flex items-center gap-2 px-1">
                  <span className="w-16 text-[12px] text-muted-foreground shrink-0">Due date</span>
                  <label className="flex-1 flex items-center gap-1.5 px-1.5 py-1 rounded text-[13px] hover:bg-muted transition-colors cursor-pointer min-w-0">
                    <Calendar className="size-3.5 text-muted-foreground shrink-0" />
                    <span className={`${element.due_date ? 'text-foreground' : 'text-muted-foreground'} truncate`}>
                      {formatDate(element.due_date) ?? 'No date'}
                    </span>
                    <input
                      type="date"
                      value={element.due_date?.split('T')[0] || ''}
                      onChange={(e) => handleDateChange('due_date', e.target.value)}
                      className="sr-only"
                    />
                  </label>
                </div>

                {/* Estimate */}
                <div className="flex items-center gap-2 px-1">
                  <span className="w-16 text-[12px] text-muted-foreground shrink-0">Estimate</span>
                  <label className="flex-1 flex items-center gap-1.5 px-1.5 py-1 rounded text-[13px] hover:bg-muted transition-colors cursor-pointer min-w-0">
                    <Timer className="size-3.5 text-muted-foreground shrink-0" />
                    <span className={`${estimatedHours ? 'text-foreground' : 'text-muted-foreground'} truncate`}>
                      {estimatedHours ? `${estimatedHours}h` : '—'}
                    </span>
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
                </div>

                {/* Custom fields */}
                {elementCustomValues.length > 0 && (
                  <div className="pt-1 mt-1 border-t border-border space-y-0.5">
                    {elementCustomValues.map((field, i) => (
                      <div key={i} className="flex items-center gap-2 px-1">
                        <span className="w-16 text-[12px] text-muted-foreground shrink-0 truncate">{field.name}</span>
                        <span className="flex-1 px-1.5 py-1 text-[13px] text-foreground truncate">{String(field.value)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
