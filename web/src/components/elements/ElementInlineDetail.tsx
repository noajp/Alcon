'use client';

import { useState, useEffect } from 'react';
import type {
  ElementWithDetails,
  CustomColumnWithValues,
  Worker,
  ElementEdgeWithElement,
  EdgeType,
} from '@/hooks/useSupabase';
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
import type { Json } from '@/types/database';
import type { BuiltInColumn } from '@/components/columns';
import { CustomColumnCell } from '@/components/columns';
import { SubelementRow } from './SubelementRow';

interface ElementInlineDetailProps {
  element: ElementWithDetails;
  onClose: () => void;
  onRefresh?: () => void;
  allElements?: ElementWithDetails[];
  customColumns?: CustomColumnWithValues[];
  onColumnValueChange?: (columnId: string, elementId: string, value: Json) => void;
  builtInColumns?: BuiltInColumn[];
}

export function ElementInlineDetail({
  element,
  onClose,
  onRefresh,
  allElements,
  customColumns,
  onColumnValueChange,
  builtInColumns,
}: ElementInlineDetailProps) {
  const [title, setTitle] = useState(element.title);
  const [description, setDescription] = useState(element.description || '');
  const [showActionsMenu, setShowActionsMenu] = useState(false);
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
      await updateElement(element.id, { status: newStatus as 'todo' | 'in_progress' | 'review' | 'done' | 'blocked' });
      onRefresh?.();
    } catch (e) {
      console.error('Failed to update status:', e);
    }
  };

  const handlePriorityChange = async (newPriority: string) => {
    try {
      await updateElement(element.id, { priority: newPriority as 'low' | 'medium' | 'high' | 'urgent' });
      onRefresh?.();
    } catch (e) {
      console.error('Failed to update priority:', e);
    }
  };

  const handleDueDateChange = async (newDate: string) => {
    try {
      await updateElement(element.id, { due_date: newDate || null });
      onRefresh?.();
    } catch (e) {
      console.error('Failed to update due date:', e);
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
      setShowActionsMenu(false);
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

  const statusOptions = [
    { value: 'todo', label: 'To Do' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'review', label: 'Review' },
    { value: 'done', label: 'Done' },
    { value: 'blocked', label: 'Blocked' },
  ];

  const priorityOptions = [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Normal' },
    { value: 'high', label: 'High' },
    { value: 'urgent', label: 'Urgent' },
  ];

  return (
    <div className="bg-[#252525] border-b border-border animate-in slide-in-from-top-2 duration-200">
      <div className="p-5">
        {/* Header Row */}
        <div className="flex items-start justify-between mb-4">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={handleTitleSave}
            onKeyDown={(e) => { if (e.key === 'Enter') handleTitleSave(); }}
            className="text-lg font-semibold text-foreground bg-transparent border-none focus:outline-none focus:ring-0 w-full"
            placeholder="Element title"
          />
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-muted rounded transition-colors ml-2"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6b6b6b" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Description */}
        <div className="mb-4">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={handleDescriptionSave}
            placeholder="Brief describe the goal of this element..."
            className="w-full px-3 py-3 text-sm text-muted-foreground bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20 focus:border-[#1e3a5f] min-h-[80px] resize-none"
          />
        </div>

        {/* Property Pills */}
        <div className="flex flex-wrap gap-2 mb-4">
          {/* Assignees Pill */}
          <div className="relative">
            <button
              onClick={() => setShowAssigneeDropdown(!showAssigneeDropdown)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-background border border-border rounded-full text-sm hover:bg-card transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6b6b6b" strokeWidth="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              <span className="text-[#333]">
                {element.assignees && element.assignees.length > 0
                  ? element.assignees.map(a => a.worker?.name).filter(Boolean).join(', ')
                  : 'Assignee'}
              </span>
            </button>
            {showAssigneeDropdown && (
              <div className="absolute left-0 top-full mt-1 w-56 bg-background border border-border rounded-lg shadow-lg py-1 z-20 max-h-48 overflow-y-auto">
                {element.assignees?.map(assignee => (
                  <div key={assignee.id} className="px-3 py-2 flex items-center justify-between hover:bg-card">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                        {assignee.worker && getWorkerIcon(assignee.worker.type)}
                      </span>
                      <span className="text-sm">{assignee.worker?.name}</span>
                    </div>
                    <button onClick={() => handleRemoveAssignee(assignee.id)} className="text-muted-foreground hover:text-[#dc2626]">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
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
                        className="w-full px-3 py-2 text-left text-sm hover:bg-card flex items-center gap-2"
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

          {/* Due Date Pill */}
          <label className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-background border border-border rounded-full text-sm hover:bg-card transition-colors cursor-pointer">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6b6b6b" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <span className="text-[#333]">
              {element.due_date ? new Date(element.due_date).toLocaleDateString() : 'Due Date'}
            </span>
            <input
              type="date"
              value={element.due_date?.split('T')[0] || ''}
              onChange={(e) => handleDueDateChange(e.target.value)}
              className="sr-only"
            />
          </label>

          {/* Status Pill */}
          <select
            value={element.status || 'todo'}
            onChange={(e) => handleStatusChange(e.target.value)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-background border border-border rounded-full text-sm hover:bg-card transition-colors cursor-pointer appearance-none pr-8"
            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%236b6b6b'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center', backgroundSize: '14px' }}
          >
            {statusOptions.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>

          {/* Priority Pill */}
          <select
            value={element.priority || 'medium'}
            onChange={(e) => handlePriorityChange(e.target.value)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-background border border-border rounded-full text-sm hover:bg-card transition-colors cursor-pointer appearance-none pr-8"
            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%236b6b6b'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center', backgroundSize: '14px' }}
          >
            {priorityOptions.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>

          {/* Dependencies Pill */}
          <button
            onClick={() => setShowEdgeModal(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-background border border-border rounded-full text-sm hover:bg-card transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6b6b6b" strokeWidth="2">
              <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
            </svg>
            <span className="text-[#333]">
              {edges.incoming.length + edges.outgoing.length > 0
                ? `${edges.incoming.length + edges.outgoing.length} linked`
                : 'Dependencies'}
            </span>
          </button>

          {/* Custom Columns Pills */}
          {customColumns?.filter(col => col.is_visible !== false).map(col => (
            <div key={col.id} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-background border border-border rounded-full text-sm">
              <CustomColumnCell
                column={col}
                elementId={element.id}
                value={col.values?.[element.id]?.value ?? null}
                onChange={(value) => onColumnValueChange?.(col.id, element.id, value)}
                displayMode="pill"
              />
            </div>
          ))}
        </div>

        {/* Subelements Section */}
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs text-muted-foreground">Subelements</span>
            <button
              onClick={() => setIsAddingSubelement(true)}
              className="text-xs text-[#1e3a5f] hover:underline"
            >
              + Add
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
                  className="flex-1 px-2 py-1 text-sm border border-border rounded focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20"
                  autoFocus
                />
                <button onClick={handleAddSubelement} className="px-2 py-1 text-xs bg-[#1e3a5f] text-white rounded hover:bg-[#152a45]">Add</button>
              </div>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-between pt-3 border-t border-border">
          <div className="flex items-center gap-2">
            <button className="p-2 hover:bg-muted rounded transition-colors text-muted-foreground" title="Attach file">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            <div className="relative">
              <button
                onClick={() => setShowActionsMenu(!showActionsMenu)}
                className="p-2 hover:bg-muted rounded transition-colors text-muted-foreground"
                title="More actions"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" />
                </svg>
              </button>
              {showActionsMenu && (
                <div className="absolute left-0 bottom-full mb-1 w-40 bg-background border border-border rounded-lg shadow-lg py-1 z-20">
                  <button onClick={handleDuplicate} className="w-full px-3 py-2 text-left text-sm hover:bg-card">Duplicate</button>
                  <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}?element=${element.id}`); setShowActionsMenu(false); }} className="w-full px-3 py-2 text-left text-sm hover:bg-card">Copy link</button>
                  <div className="border-t border-border my-1" />
                  <button onClick={() => { setShowActionsMenu(false); setShowDeleteConfirm(true); }} className="w-full px-3 py-2 text-left text-sm text-[#dc2626] hover:bg-red-900/20">Delete</button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background rounded-lg p-6 w-[340px] shadow-xl">
            <h3 className="text-[15px] font-semibold text-center mb-1">Delete &apos;{element.title}&apos;?</h3>
            <p className="text-[13px] text-muted-foreground text-center mb-5">This action cannot be undone.</p>
            <div className="flex flex-col gap-2">
              <button onClick={handleDelete} className="w-full py-2 bg-[#ff3b30] text-white rounded-md hover:bg-[#ff3b30]/90 font-medium">Delete</button>
              <button onClick={() => setShowDeleteConfirm(false)} className="w-full py-2 border border-border rounded-md hover:bg-card">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Edge Modal */}
      {showEdgeModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background rounded-lg p-5 w-[400px] shadow-xl">
            <h3 className="text-[15px] font-semibold mb-4">Add Dependency</h3>
            <div className="mb-4">
              <label className="text-xs text-muted-foreground mb-1 block">Type</label>
              <select value={newEdgeType} onChange={(e) => setNewEdgeType(e.target.value as EdgeType)} className="w-full px-3 py-2 text-sm border border-border rounded-md">
                <option value="depends_on">Depends On</option>
                <option value="spawns">Spawns</option>
                <option value="references">References</option>
                <option value="merges_into">Merges Into</option>
                <option value="splits_to">Splits To</option>
                <option value="cancels">Cancels</option>
              </select>
            </div>
            <div className="mb-4">
              <label className="text-xs text-muted-foreground mb-1 block">Target Element</label>
              <input type="text" value={edgeSearchQuery} onChange={(e) => { setEdgeSearchQuery(e.target.value); setNewEdgeTargetId(''); }} placeholder="Search elements..." className="w-full px-3 py-2 text-sm border border-border rounded-md" />
              {edgeSearchQuery && (
                <div className="mt-2 max-h-40 overflow-y-auto border border-border rounded-md">
                  {filteredElements.map(el => (
                    <button key={el.id} onClick={() => { setNewEdgeTargetId(el.id); setEdgeSearchQuery(el.title); }} className={`w-full px-3 py-2 text-left text-sm hover:bg-card ${newEdgeTargetId === el.id ? 'bg-[#f0fdf4]' : ''}`}>{el.title}</button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setShowEdgeModal(false); setNewEdgeTargetId(''); setEdgeSearchQuery(''); }} className="px-4 py-2 text-sm border border-border rounded-md hover:bg-card">Cancel</button>
              <button onClick={handleAddEdge} disabled={!newEdgeTargetId} className="px-4 py-2 text-sm bg-[#1e3a5f] text-white rounded-md hover:bg-[#152a45] disabled:opacity-50">Add</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
