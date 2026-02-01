'use client';

import { useState } from 'react';
import type { BuiltInColumn } from './builtInColumns';

interface EditBuiltInPropertyModalProps {
  column: BuiltInColumn;
  onClose: () => void;
  onUpdate: (updates: Partial<BuiltInColumn>) => void;
}

export function EditBuiltInPropertyModal({
  column,
  onClose,
  onUpdate,
}: EditBuiltInPropertyModalProps) {
  const [name, setName] = useState(column.name);
  const [options, setOptions] = useState<{ value: string; color?: string }[]>(column.options || []);
  const [editingOptionIndex, setEditingOptionIndex] = useState<number | null>(null);

  const handleNameSave = () => {
    if (name.trim() && name !== column.name) {
      onUpdate({ name: name.trim() });
    }
  };

  const handleUpdateOption = (index: number, newValue: string) => {
    const newOptions = [...options];
    newOptions[index] = { ...newOptions[index], value: newValue };
    setOptions(newOptions);
    onUpdate({ options: newOptions });
    setEditingOptionIndex(null);
  };

  const getTypeLabel = () => {
    switch (column.builtinType) {
      case 'assignees': return 'Person';
      case 'priority': return 'Select';
      case 'status': return 'Status';
      case 'due_date': return 'Date';
      default: return 'Unknown';
    }
  };

  const getTypeIcon = () => {
    switch (column.builtinType) {
      case 'assignees':
        return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
      case 'priority':
        return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="8 12 12 16 16 8"/></svg>;
      case 'status':
        return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8" strokeDasharray="4 2"/></svg>;
      case 'due_date':
        return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>;
      default:
        return null;
    }
  };

  const getPriorityLabel = (value: string) => {
    switch (value) {
      case 'low': return 'Low';
      case 'medium': return 'Normal';
      case 'high': return 'High';
      case 'urgent': return 'Urgent';
      default: return value;
    }
  };

  const getStatusLabel = (value: string) => {
    switch (value) {
      case 'todo': return 'To Do';
      case 'in_progress': return 'In Progress';
      case 'review': return 'Review';
      case 'done': return 'Done';
      case 'blocked': return 'Blocked';
      default: return value;
    }
  };

  const getStatusColor = (value: string) => {
    switch (value) {
      case 'done': return '#22c55e';
      case 'in_progress': return '#f59e0b';
      case 'review': return '#6366f1';
      case 'blocked': return '#ef4444';
      default: return '#888';
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-background rounded-lg shadow-xl w-[340px] max-h-[600px] overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b border-border">
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="p-1 hover:bg-card rounded">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
            </button>
            <span className="text-sm font-medium">Edit property</span>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-card rounded">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Property Name */}
        <div className="p-3 border-b border-border">
          <div className="flex items-center gap-2 bg-card rounded-lg p-2">
            <span className="text-muted-foreground">{getTypeIcon()}</span>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              onBlur={handleNameSave}
              onKeyDown={e => { if (e.key === 'Enter') handleNameSave(); }}
              className="flex-1 bg-transparent text-sm font-medium focus:outline-none"
            />
          </div>
        </div>

        {/* Type */}
        <div className="px-3 py-2 border-b border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
              </svg>
              Type
            </div>
            <span className="text-sm text-muted-foreground">{getTypeLabel()}</span>
          </div>
        </div>

        {/* Options for Priority/Status */}
        {(column.builtinType === 'priority' || column.builtinType === 'status') && options.length > 0 && (
          <div className="overflow-y-auto max-h-[300px]">
            {column.builtinType === 'status' ? (
              // Status with groups
              <>
                <div className="border-b border-border">
                  <div className="flex items-center justify-between px-3 py-2 bg-[#252525]">
                    <span className="text-xs text-muted-foreground">To-do</span>
                  </div>
                  {options.filter(o => o.value === 'todo').map((option, idx) => {
                    const realIndex = options.findIndex(o => o.value === option.value);
                    return (
                      <div key={idx} className="flex items-center gap-2 px-3 py-1.5 hover:bg-card group">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: getStatusColor(option.value) }} />
                        {editingOptionIndex === realIndex ? (
                          <input
                            type="text"
                            defaultValue={getStatusLabel(option.value)}
                            autoFocus
                            onBlur={e => handleUpdateOption(realIndex, e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') handleUpdateOption(realIndex, (e.target as HTMLInputElement).value);
                              if (e.key === 'Escape') setEditingOptionIndex(null);
                            }}
                            className="flex-1 text-sm bg-transparent border border-[#1e3a5f] rounded px-1 focus:outline-none"
                          />
                        ) : (
                          <span className="flex-1 text-sm cursor-pointer" onClick={() => setEditingOptionIndex(realIndex)}>
                            {getStatusLabel(option.value)}
                          </span>
                        )}
                        <span className="text-[10px] text-muted-foreground">DEFAULT</span>
                      </div>
                    );
                  })}
                </div>
                <div className="border-b border-border">
                  <div className="flex items-center justify-between px-3 py-2 bg-[#252525]">
                    <span className="text-xs text-muted-foreground">In progress</span>
                  </div>
                  {options.filter(o => ['in_progress', 'review'].includes(o.value)).map((option, idx) => (
                    <div key={idx} className="flex items-center gap-2 px-3 py-1.5 hover:bg-card group">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: getStatusColor(option.value) }} />
                      <span className="flex-1 text-sm">{getStatusLabel(option.value)}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <div className="flex items-center justify-between px-3 py-2 bg-[#252525]">
                    <span className="text-xs text-muted-foreground">Complete</span>
                  </div>
                  {options.filter(o => ['done', 'blocked'].includes(o.value)).map((option, idx) => (
                    <div key={idx} className="flex items-center gap-2 px-3 py-1.5 hover:bg-card group">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: getStatusColor(option.value) }} />
                      <span className="flex-1 text-sm">{getStatusLabel(option.value)}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              // Priority options
              <div className="p-2">
                <div className="text-xs text-muted-foreground px-2 py-1 mb-1">Options</div>
                {options.map((option, idx) => (
                  <div key={idx} className="flex items-center gap-2 px-2 py-1.5 hover:bg-card rounded group">
                    <span
                      className="px-2 py-0.5 rounded text-xs"
                      style={{ backgroundColor: option.color || '#f5f5f5' }}
                    >
                      {getPriorityLabel(option.value)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Info for Assignees/Date */}
        {(column.builtinType === 'assignees' || column.builtinType === 'due_date') && (
          <div className="p-4 text-sm text-muted-foreground">
            {column.builtinType === 'assignees'
              ? 'Assign team members to elements. Click on the cell to add or remove assignees.'
              : 'Set due dates for elements. Click on the cell to pick a date.'}
          </div>
        )}
      </div>
    </div>
  );
}
