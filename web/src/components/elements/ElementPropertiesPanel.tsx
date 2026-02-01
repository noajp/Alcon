'use client';

import { useState, useEffect } from 'react';
import { X, ChevronDown, Plus, Calendar, User, Flag, Target, Link2, Trash2, Copy, MoreHorizontal, Maximize2 } from 'lucide-react';
import type { ElementWithDetails, Worker, ElementEdgeWithElement, EdgeType } from '@/hooks/useSupabase';
import {
  updateElement,
  deleteElement,
  createElement,
  createSubelement,
  fetchAllWorkers,
  addElementAssignee,
  removeElementAssignee,
  createElementEdge,
  deleteElementEdge,
  getElementEdges,
} from '@/hooks/useSupabase';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Circle, Clock, CheckCircle2, XCircle, Ban, Send } from 'lucide-react';
import { SubelementRow } from './SubelementRow';

interface ElementPropertiesPanelProps {
  element: ElementWithDetails;
  onClose: () => void;
  onExpand?: () => void;
  onRefresh?: () => void;
  allElements?: ElementWithDetails[];
}

const statusOptions = [
  { status: 'backlog', label: 'Backlog', icon: Circle, color: 'text-muted-foreground' },
  { status: 'todo', label: 'Todo', icon: Circle, color: 'text-muted-foreground' },
  { status: 'in_progress', label: 'In Progress', icon: Clock, color: 'text-yellow-500' },
  { status: 'review', label: 'In Review', icon: Send, color: 'text-cyan-400' },
  { status: 'done', label: 'Done', icon: CheckCircle2, color: 'text-green-500' },
  { status: 'blocked', label: 'Blocked', icon: XCircle, color: 'text-red-500' },
  { status: 'cancelled', label: 'Cancelled', icon: Ban, color: 'text-muted-foreground' },
];

const priorityOptions = [
  { priority: 'urgent', label: 'Urgent', color: 'text-red-500', bars: 4 },
  { priority: 'high', label: 'High', color: 'text-orange-500', bars: 3 },
  { priority: 'medium', label: 'Medium', color: 'text-yellow-500', bars: 2 },
  { priority: 'low', label: 'Low', color: 'text-muted-foreground', bars: 1 },
];

function PriorityBars({ bars, color }: { bars: number; color: string }) {
  return (
    <div className="flex items-end gap-0.5 h-3">
      {[1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className={`w-1 rounded-sm ${i <= bars ? color.replace('text-', 'bg-') : 'bg-muted'}`}
          style={{ height: `${i * 3}px` }}
        />
      ))}
    </div>
  );
}

function PropertyRow({
  label,
  icon: Icon,
  children
}: {
  label: string;
  icon: React.ComponentType<{ className?: string; size?: number }>;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center py-1.5 hover:bg-muted/30 rounded px-2 -mx-2 transition-colors">
      <div className="flex items-center gap-2 w-24 flex-shrink-0">
        <Icon className="text-muted-foreground" size={14} />
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      <div className="flex-1 min-w-0">
        {children}
      </div>
    </div>
  );
}

export function ElementPropertiesPanel({ element, onClose, onExpand, onRefresh, allElements }: ElementPropertiesPanelProps) {
  const [isPropertiesCollapsed, setIsPropertiesCollapsed] = useState(false);
  const [title, setTitle] = useState(element.title);
  const [description, setDescription] = useState(element.description || '');
  const [newSubelementTitle, setNewSubelementTitle] = useState('');
  const [isAddingSubelement, setIsAddingSubelement] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Assignees state
  const [allWorkers, setAllWorkers] = useState<Worker[]>([]);
  const [showAssigneeDropdown, setShowAssigneeDropdown] = useState(false);

  // Edges state
  const [edges, setEdges] = useState<{ incoming: ElementEdgeWithElement[]; outgoing: ElementEdgeWithElement[] }>({ incoming: [], outgoing: [] });
  const [showEdgeModal, setShowEdgeModal] = useState(false);
  const [newEdgeType, setNewEdgeType] = useState<EdgeType>('depends_on');
  const [newEdgeTargetId, setNewEdgeTargetId] = useState('');
  const [edgeSearchQuery, setEdgeSearchQuery] = useState('');

  const currentStatus = statusOptions.find(s => s.status === element.status) || statusOptions[1];
  const currentPriority = priorityOptions.find(p => p.priority === element.priority) || priorityOptions[2];

  // Sync with prop changes
  useEffect(() => {
    setTitle(element.title);
    setDescription(element.description || '');
  }, [element.id, element.title, element.description]);

  // Fetch workers on mount
  useEffect(() => {
    fetchAllWorkers().then(setAllWorkers).catch(console.error);
  }, []);

  // Fetch edges
  useEffect(() => {
    getElementEdges(element.id).then(setEdges).catch(console.error);
  }, [element.id]);

  const handleTitleSave = async () => {
    if (title.trim() && title !== element.title) {
      try {
        await updateElement(element.id, { title: title.trim() });
        onRefresh?.();
      } catch (e) {
        console.error('Failed to update title:', e);
      }
    }
  };

  const handleDescriptionSave = async () => {
    if (description !== element.description) {
      try {
        await updateElement(element.id, { description: description || null });
        onRefresh?.();
      } catch (e) {
        console.error('Failed to update description:', e);
      }
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    try {
      await updateElement(element.id, { status: newStatus as any });
      onRefresh?.();
    } catch (e) {
      console.error('Failed to update status:', e);
    }
  };

  const handlePriorityChange = async (newPriority: string) => {
    try {
      await updateElement(element.id, { priority: newPriority as any });
      onRefresh?.();
    } catch (e) {
      console.error('Failed to update priority:', e);
    }
  };

  const handleDateChange = async (field: 'start_date' | 'due_date', value: string) => {
    try {
      await updateElement(element.id, { [field]: value || null });
      onRefresh?.();
    } catch (e) {
      console.error('Failed to update date:', e);
    }
  };

  const handleAddSubelement = async () => {
    if (!newSubelementTitle.trim()) return;
    try {
      await createSubelement({
        element_id: element.id,
        title: newSubelementTitle.trim(),
      });
      setNewSubelementTitle('');
      setIsAddingSubelement(false);
      onRefresh?.();
    } catch (e) {
      console.error('Failed to add subelement:', e);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteElement(element.id);
      onClose();
      onRefresh?.();
    } catch (e) {
      console.error('Failed to delete element:', e);
    }
  };

  const handleDuplicate = async () => {
    try {
      await createElement({
        title: `${element.title} (copy)`,
        object_id: element.object_id,
        description: element.description,
        section: element.section,
        status: element.status || 'todo',
        priority: element.priority || 'medium',
        due_date: element.due_date,
      });
      onRefresh?.();
    } catch (e) {
      console.error('Failed to duplicate element:', e);
    }
  };

  // Assignee handlers
  const handleAddAssignee = async (workerId: string) => {
    try {
      await addElementAssignee({
        element_id: element.id,
        worker_id: workerId,
        role: 'assignee',
      });
      setShowAssigneeDropdown(false);
      onRefresh?.();
    } catch (e) {
      console.error('Failed to add assignee:', e);
    }
  };

  const handleRemoveAssignee = async (assigneeId: string) => {
    try {
      await removeElementAssignee(assigneeId);
      onRefresh?.();
    } catch (e) {
      console.error('Failed to remove assignee:', e);
    }
  };

  // Edge handlers
  const handleAddEdge = async () => {
    if (!newEdgeTargetId) return;
    try {
      await createElementEdge({
        from_element: element.id,
        to_element: newEdgeTargetId,
        edge_type: newEdgeType,
      });
      setShowEdgeModal(false);
      setNewEdgeTargetId('');
      setEdgeSearchQuery('');
      const updatedEdges = await getElementEdges(element.id);
      setEdges(updatedEdges);
      onRefresh?.();
    } catch (e) {
      console.error('Failed to add edge:', e);
    }
  };

  const handleRemoveEdge = async (edgeId: string) => {
    try {
      await deleteElementEdge(edgeId);
      const updatedEdges = await getElementEdges(element.id);
      setEdges(updatedEdges);
      onRefresh?.();
    } catch (e) {
      console.error('Failed to remove edge:', e);
    }
  };

  // Get worker icon
  const getWorkerIcon = (type: string) => {
    switch (type) {
      case 'human':
        return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>;
      case 'ai_agent':
        return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="10" rx="2" /><circle cx="12" cy="5" r="2" /><path d="M12 7v4" /></svg>;
      case 'robot':
        return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="8" width="20" height="14" rx="2" /><path d="M12 2v6" /></svg>;
      default:
        return null;
    }
  };

  const assignedWorkerIds = element.assignees?.map(a => a.worker_id) || [];
  const availableWorkers = allWorkers.filter(w => !assignedWorkerIds.includes(w.id));

  const filteredElements = (allElements || []).filter(e =>
    e.id !== element.id &&
    e.title.toLowerCase().includes(edgeSearchQuery.toLowerCase())
  ).slice(0, 10);

  const hasSubelements = element.subelements && element.subelements.length > 0;

  return (
    <div className="w-96 border-l border-border bg-background flex flex-col h-full">
      {/* Header - Linear style */}
      <div className="px-5 py-4 border-b border-border">
        {/* Top row with status icon and actions */}
        <div className="flex items-center justify-between mb-3">
          <currentStatus.icon className={`size-5 ${currentStatus.color}`} />
          <div className="flex items-center gap-0.5">
            {/* Expand button */}
            {onExpand && (
              <button
                onClick={onExpand}
                className="p-1.5 hover:bg-muted rounded transition-colors"
                title="Open full view"
              >
                <Maximize2 className="size-4 text-muted-foreground" />
              </button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="p-1.5 hover:bg-muted rounded transition-colors">
                  <MoreHorizontal className="size-4 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleDuplicate}>
                  <Copy className="size-4 mr-2" />
                  Duplicate
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigator.clipboard.writeText(`${window.location.origin}?element=${element.id}`)}>
                  <Link2 className="size-4 mr-2" />
                  Copy link
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setShowDeleteConfirm(true)} className="text-red-500">
                  <Trash2 className="size-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-muted rounded transition-colors"
            >
              <X className="size-4 text-muted-foreground" />
            </button>
          </div>
        </div>

        {/* Large Title */}
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={handleTitleSave}
          onKeyDown={(e) => { if (e.key === 'Enter') handleTitleSave(); }}
          className="text-xl font-semibold text-foreground bg-transparent border-none focus:outline-none focus:ring-0 w-full mb-2"
          placeholder="Element title"
        />

        {/* Description */}
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={handleDescriptionSave}
          placeholder="Add description..."
          className="w-full text-sm text-muted-foreground bg-transparent border-none focus:outline-none focus:ring-0 min-h-[40px] resize-none"
        />
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-auto">
        {/* Properties Pills Row - Linear style */}
        <div className="px-5 py-3 border-b border-border">
          <div className="flex flex-wrap gap-2">
            {/* Status Pill */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-muted/50 hover:bg-muted rounded-md text-sm transition-colors">
                  <currentStatus.icon className={`size-4 ${currentStatus.color}`} />
                  <span className="font-medium">{currentStatus.label}</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-44">
                {statusOptions.map((option) => (
                  <DropdownMenuItem
                    key={option.status}
                    onClick={() => handleStatusChange(option.status)}
                    className="flex items-center gap-2"
                  >
                    <option.icon className={`size-4 ${option.color}`} />
                    <span>{option.label}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Priority Pill */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-muted/50 hover:bg-muted rounded-md text-sm transition-colors">
                  <PriorityBars bars={currentPriority.bars} color={currentPriority.color} />
                  <span className="font-medium">{currentPriority.label}</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-44">
                {priorityOptions.map((option) => (
                  <DropdownMenuItem
                    key={option.priority}
                    onClick={() => handlePriorityChange(option.priority)}
                    className="flex items-center gap-2"
                  >
                    <PriorityBars bars={option.bars} color={option.color} />
                    <span>{option.label}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Due Date Pill */}
            <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-muted/50 hover:bg-muted rounded-md text-sm transition-colors cursor-pointer">
              <Calendar className="size-4 text-muted-foreground" />
              <span className="font-medium">
                {element.due_date ? new Date(element.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Due date'}
              </span>
              <input
                type="date"
                value={element.due_date?.split('T')[0] || ''}
                onChange={(e) => handleDateChange('due_date', e.target.value)}
                className="sr-only"
              />
            </label>
          </div>
        </div>

        {/* Properties Section */}
        <div className="px-5 py-3 border-b border-border">
          <button
            onClick={() => setIsPropertiesCollapsed(!isPropertiesCollapsed)}
            className="flex items-center gap-1 text-sm font-semibold text-foreground hover:text-muted-foreground transition-colors mb-3"
          >
            Properties
            <ChevronDown className={`size-4 transition-transform ${isPropertiesCollapsed ? '-rotate-90' : ''}`} />
          </button>

          {!isPropertiesCollapsed && (
            <div className="space-y-1">
              {/* Assignees */}
              <PropertyRow label="Assignee" icon={User}>
                <div className="relative">
                  <button
                    onClick={() => setShowAssigneeDropdown(!showAssigneeDropdown)}
                    className="flex items-center gap-2 text-sm hover:bg-muted px-2 py-1 rounded transition-colors w-full"
                  >
                    {element.assignees && element.assignees.length > 0 ? (
                      <div className="flex items-center gap-1">
                        {element.assignees.slice(0, 2).map(a => (
                          <span key={a.id} className="font-medium">{a.worker?.name}</span>
                        ))}
                        {element.assignees.length > 2 && (
                          <span className="text-muted-foreground">+{element.assignees.length - 2}</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">Add assignee</span>
                    )}
                  </button>
                  {showAssigneeDropdown && (
                    <div className="absolute left-0 top-full mt-1 w-48 bg-popover border border-border rounded-lg shadow-lg py-1 z-20 max-h-48 overflow-y-auto">
                      {element.assignees?.map(assignee => (
                        <div key={assignee.id} className="px-3 py-1.5 flex items-center justify-between hover:bg-muted text-sm">
                          <div className="flex items-center gap-2">
                            <span className="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                              {assignee.worker && getWorkerIcon(assignee.worker.type)}
                            </span>
                            <span>{assignee.worker?.name}</span>
                          </div>
                          <button onClick={() => handleRemoveAssignee(assignee.id)} className="text-muted-foreground hover:text-red-500">
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                      {availableWorkers.length > 0 && (
                        <>
                          {element.assignees && element.assignees.length > 0 && <div className="border-t border-border my-1" />}
                          {availableWorkers.map(worker => (
                            <button
                              key={worker.id}
                              onClick={() => handleAddAssignee(worker.id)}
                              className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2"
                            >
                              <span className="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                                {getWorkerIcon(worker.type)}
                              </span>
                              {worker.name}
                            </button>
                          ))}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </PropertyRow>

              {/* Start date */}
              <PropertyRow label="Start date" icon={Calendar}>
                <input
                  type="date"
                  value={element.start_date?.split('T')[0] || ''}
                  onChange={(e) => handleDateChange('start_date', e.target.value)}
                  className="text-sm bg-transparent hover:bg-muted px-2 py-1 rounded transition-colors w-full cursor-pointer"
                />
              </PropertyRow>

              {/* Target date / Due date */}
              <PropertyRow label="Due date" icon={Target}>
                <input
                  type="date"
                  value={element.due_date?.split('T')[0] || ''}
                  onChange={(e) => handleDateChange('due_date', e.target.value)}
                  className="text-sm bg-transparent hover:bg-muted px-2 py-1 rounded transition-colors w-full cursor-pointer"
                />
              </PropertyRow>

              {/* Dependencies */}
              <PropertyRow label="Links" icon={Link2}>
                <button
                  onClick={() => setShowEdgeModal(true)}
                  className="flex items-center gap-2 text-sm hover:bg-muted px-2 py-1 rounded transition-colors w-full"
                >
                  {edges.incoming.length + edges.outgoing.length > 0 ? (
                    <span className="font-medium">{edges.incoming.length + edges.outgoing.length} linked</span>
                  ) : (
                    <span className="text-muted-foreground">Add link</span>
                  )}
                </button>
              </PropertyRow>
            </div>
          )}
        </div>

        {/* Subelements Section */}
        <div className="px-5 py-3 border-b border-border">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-foreground">Subelements</span>
            <button
              onClick={() => setIsAddingSubelement(true)}
              className="text-muted-foreground hover:text-foreground"
            >
              <Plus size={16} />
            </button>
          </div>
          <div className="space-y-1">
            {element.subelements?.map(sub => (
              <SubelementRow key={sub.id} subelement={sub} onRefresh={onRefresh} />
            ))}
            {isAddingSubelement && (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newSubelementTitle}
                  onChange={(e) => setNewSubelementTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddSubelement();
                    if (e.key === 'Escape') { setNewSubelementTitle(''); setIsAddingSubelement(false); }
                  }}
                  placeholder="Subelement title..."
                  className="flex-1 px-2 py-1.5 text-sm border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary/20 bg-background"
                  autoFocus
                />
              </div>
            )}
            {!hasSubelements && !isAddingSubelement && (
              <button
                onClick={() => setIsAddingSubelement(true)}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                + Add subelement
              </button>
            )}
          </div>
        </div>

        {/* Linked Elements */}
        {(edges.incoming.length > 0 || edges.outgoing.length > 0) && (
          <div className="px-5 py-3">
            <span className="text-sm font-semibold text-foreground mb-2 block">Linked Elements</span>
            <div className="space-y-1">
              {edges.outgoing.map(edge => (
                <div key={edge.id} className="flex items-center justify-between text-sm py-1.5 px-2 bg-muted/30 rounded">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">{edge.edge_type.replace('_', ' ')}</span>
                    <span className="font-medium">{edge.related_element?.title || 'Unknown'}</span>
                  </div>
                  <button onClick={() => handleRemoveEdge(edge.id)} className="text-muted-foreground hover:text-red-500">
                    <X size={14} />
                  </button>
                </div>
              ))}
              {edges.incoming.map(edge => (
                <div key={edge.id} className="flex items-center justify-between text-sm py-1.5 px-2 bg-muted/30 rounded">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{edge.related_element?.title || 'Unknown'}</span>
                    <span className="text-muted-foreground">{edge.edge_type.replace('_', ' ')} this</span>
                  </div>
                  <button onClick={() => handleRemoveEdge(edge.id)} className="text-muted-foreground hover:text-red-500">
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background rounded-lg p-6 w-[340px] shadow-xl border border-border">
            <h3 className="text-base font-semibold text-center mb-1">Delete &apos;{element.title}&apos;?</h3>
            <p className="text-sm text-muted-foreground text-center mb-5">This action cannot be undone.</p>
            <div className="flex flex-col gap-2">
              <button onClick={handleDelete} className="w-full py-2 bg-red-500 text-white rounded-md hover:bg-red-600 font-medium">Delete</button>
              <button onClick={() => setShowDeleteConfirm(false)} className="w-full py-2 border border-border rounded-md hover:bg-muted">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Edge Modal */}
      {showEdgeModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background rounded-lg p-5 w-[360px] shadow-xl border border-border">
            <h3 className="text-base font-semibold mb-4">Add Link</h3>
            <div className="mb-4">
              <label className="text-sm text-muted-foreground mb-1 block">Type</label>
              <select value={newEdgeType} onChange={(e) => setNewEdgeType(e.target.value as EdgeType)} className="w-full px-3 py-2 text-sm border border-border rounded-md bg-background">
                <option value="depends_on">Depends On</option>
                <option value="spawns">Spawns</option>
                <option value="references">References</option>
                <option value="merges_into">Merges Into</option>
                <option value="splits_to">Splits To</option>
                <option value="cancels">Cancels</option>
              </select>
            </div>
            <div className="mb-4">
              <label className="text-sm text-muted-foreground mb-1 block">Target Element</label>
              <input type="text" value={edgeSearchQuery} onChange={(e) => { setEdgeSearchQuery(e.target.value); setNewEdgeTargetId(''); }} placeholder="Search elements..." className="w-full px-3 py-2 text-sm border border-border rounded-md bg-background" />
              {edgeSearchQuery && (
                <div className="mt-2 max-h-40 overflow-y-auto border border-border rounded-md">
                  {filteredElements.map(el => (
                    <button key={el.id} onClick={() => { setNewEdgeTargetId(el.id); setEdgeSearchQuery(el.title); }} className={`w-full px-3 py-2 text-left text-sm hover:bg-muted ${newEdgeTargetId === el.id ? 'bg-primary/10' : ''}`}>{el.title}</button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setShowEdgeModal(false); setNewEdgeTargetId(''); setEdgeSearchQuery(''); }} className="px-4 py-2 text-sm border border-border rounded-md hover:bg-muted">Cancel</button>
              <button onClick={handleAddEdge} disabled={!newEdgeTargetId} className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50">Add</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
