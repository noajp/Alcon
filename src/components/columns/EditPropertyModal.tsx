'use client';

import { useState } from 'react';
import type { CustomColumnWithValues } from '@/hooks/useSupabase';
import { COLUMN_TYPES } from './columnTypes';

interface EditPropertyModalProps {
  column: CustomColumnWithValues;
  onClose: () => void;
  onUpdate: (updates: { name?: string; options?: { options?: { value: string; color?: string }[] } }) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}

export function EditPropertyModal({
  column,
  onClose,
  onUpdate,
  onDelete,
  onDuplicate,
}: EditPropertyModalProps) {
  const [name, setName] = useState(column.name);
  const [options, setOptions] = useState<{ value: string; color?: string }[]>(
    column.options?.options || []
  );
  const [editingOptionIndex, setEditingOptionIndex] = useState<number | null>(null);
  const [newOptionValue, setNewOptionValue] = useState('');

  const isSelectType = column.column_type === 'select' || column.column_type === 'multi_select' || column.column_type === 'status';

  // Status type has predefined groups
  const statusGroups = column.column_type === 'status' ? [
    { label: 'To-do', options: options.filter(o => ['Not started', 'Todo', 'To Do', 'Backlog'].some(s => o.value.toLowerCase().includes(s.toLowerCase()))) },
    { label: 'In progress', options: options.filter(o => ['In progress', 'In Progress', 'Working', 'Active'].some(s => o.value.toLowerCase().includes(s.toLowerCase()))) },
    { label: 'Complete', options: options.filter(o => ['Done', 'Complete', 'Completed', 'Finished'].some(s => o.value.toLowerCase().includes(s.toLowerCase()))) },
  ] : null;

  const handleNameSave = () => {
    if (name.trim() && name !== column.name) {
      onUpdate({ name: name.trim() });
    }
  };

  const handleAddOption = () => {
    if (!newOptionValue.trim()) return;
    const newOption = { value: newOptionValue.trim(), color: getRandomColor() };
    const newOptions = [...options, newOption];
    setOptions(newOptions);
    onUpdate({ options: { options: newOptions } });
    setNewOptionValue('');
  };

  const handleUpdateOption = (index: number, newValue: string) => {
    const newOptions = [...options];
    newOptions[index] = { ...newOptions[index], value: newValue };
    setOptions(newOptions);
    onUpdate({ options: { options: newOptions } });
    setEditingOptionIndex(null);
  };

  const handleDeleteOption = (index: number) => {
    const newOptions = options.filter((_, i) => i !== index);
    setOptions(newOptions);
    onUpdate({ options: { options: newOptions } });
  };

  const getRandomColor = () => {
    const colors = ['#e3f2fd', '#f3e5f5', '#e8f5e9', '#fff3e0', '#fce4ec', '#e0f2f1', '#f5f5f5'];
    return colors[Math.floor(Math.random() * colors.length)];
  };

  const getStatusColor = (value: string) => {
    const lowerValue = value.toLowerCase();
    if (['done', 'complete', 'completed', 'finished'].some(s => lowerValue.includes(s))) return '#22c55e';
    if (['in progress', 'working', 'active'].some(s => lowerValue.includes(s))) return '#3b82f6';
    return '#888';
  };

  const typeInfo = COLUMN_TYPES.find(t => t.type === column.column_type);

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
            <span className="text-muted-foreground">{typeInfo?.icon}</span>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              onBlur={handleNameSave}
              onKeyDown={e => { if (e.key === 'Enter') handleNameSave(); }}
              className="flex-1 bg-transparent text-sm font-medium focus:outline-none"
            />
            <button className="p-1 hover:bg-muted rounded">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
              </svg>
            </button>
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
            <button className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              {typeInfo?.label}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Options for Select/Status types */}
        {isSelectType && (
          <div className="overflow-y-auto max-h-[300px]">
            {column.column_type === 'status' && statusGroups ? (
              // Status type with groups
              statusGroups.map((group, groupIdx) => (
                <div key={groupIdx} className="border-b border-border last:border-b-0">
                  <div className="flex items-center justify-between px-3 py-2 bg-[#252525]">
                    <span className="text-xs text-muted-foreground">{group.label}</span>
                    <button
                      onClick={() => {
                        const defaultValue = group.label === 'To-do' ? 'New status' : group.label === 'In progress' ? 'In progress' : 'Done';
                        const newOption = { value: defaultValue, color: getStatusColor(defaultValue) };
                        const newOptions = [...options, newOption];
                        setOptions(newOptions);
                        onUpdate({ options: { options: newOptions } });
                      }}
                      className="p-0.5 hover:bg-muted rounded"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                      </svg>
                    </button>
                  </div>
                  {options.filter((_, i) => {
                    const opt = options[i];
                    if (group.label === 'To-do') return ['Not started', 'Todo', 'To Do', 'Backlog'].some(s => opt.value.toLowerCase().includes(s.toLowerCase())) || (!['In progress', 'Working', 'Active', 'Done', 'Complete', 'Completed', 'Finished'].some(s => opt.value.toLowerCase().includes(s.toLowerCase())) && groupIdx === 0);
                    if (group.label === 'In progress') return ['In progress', 'Working', 'Active'].some(s => opt.value.toLowerCase().includes(s.toLowerCase()));
                    return ['Done', 'Complete', 'Completed', 'Finished'].some(s => opt.value.toLowerCase().includes(s.toLowerCase()));
                  }).map((option, idx) => {
                    const realIndex = options.findIndex(o => o.value === option.value);
                    return (
                      <div key={idx} className="flex items-center gap-2 px-3 py-1.5 hover:bg-card group">
                        <button className="cursor-grab text-muted-foreground opacity-0 group-hover:opacity-100">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                            <circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/>
                            <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
                            <circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/>
                          </svg>
                        </button>
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: getStatusColor(option.value) }}
                        />
                        {editingOptionIndex === realIndex ? (
                          <input
                            type="text"
                            defaultValue={option.value}
                            autoFocus
                            onBlur={e => handleUpdateOption(realIndex, e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') handleUpdateOption(realIndex, (e.target as HTMLInputElement).value);
                              if (e.key === 'Escape') setEditingOptionIndex(null);
                            }}
                            className="flex-1 text-sm bg-transparent border border-[#1e3a5f] rounded px-1 focus:outline-none"
                          />
                        ) : (
                          <span
                            className="flex-1 text-sm cursor-pointer"
                            onClick={() => setEditingOptionIndex(realIndex)}
                          >
                            {option.value}
                          </span>
                        )}
                        {realIndex === 0 && group.label === 'To-do' && (
                          <span className="text-[10px] text-muted-foreground">DEFAULT</span>
                        )}
                        <button
                          onClick={() => handleDeleteOption(realIndex)}
                          className="p-1 hover:bg-red-900/20 rounded opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                          </svg>
                        </button>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted-foreground">
                          <polyline points="9 18 15 12 9 6"/>
                        </svg>
                      </div>
                    );
                  })}
                </div>
              ))
            ) : (
              // Regular select/multi-select
              <div className="p-2">
                <div className="text-xs text-muted-foreground px-2 py-1 mb-1">Options</div>
                {options.map((option, idx) => (
                  <div key={idx} className="flex items-center gap-2 px-2 py-1.5 hover:bg-card rounded group">
                    <button className="cursor-grab text-muted-foreground opacity-0 group-hover:opacity-100">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                        <circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/>
                        <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
                        <circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/>
                      </svg>
                    </button>
                    <span
                      className="px-2 py-0.5 rounded text-xs"
                      style={{ backgroundColor: option.color || '#f5f5f5' }}
                    >
                      {editingOptionIndex === idx ? (
                        <input
                          type="text"
                          defaultValue={option.value}
                          autoFocus
                          onBlur={e => handleUpdateOption(idx, e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleUpdateOption(idx, (e.target as HTMLInputElement).value);
                            if (e.key === 'Escape') setEditingOptionIndex(null);
                          }}
                          className="bg-transparent border-none focus:outline-none w-20"
                        />
                      ) : (
                        <span onClick={() => setEditingOptionIndex(idx)} className="cursor-pointer">
                          {option.value}
                        </span>
                      )}
                    </span>
                    <div className="flex-1" />
                    <button
                      onClick={() => handleDeleteOption(idx)}
                      className="p-1 hover:bg-red-900/20 rounded opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                      </svg>
                    </button>
                  </div>
                ))}
                {/* Add new option */}
                <div className="flex items-center gap-2 px-2 py-1.5 mt-1">
                  <input
                    type="text"
                    value={newOptionValue}
                    onChange={e => setNewOptionValue(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleAddOption(); }}
                    placeholder="Add option..."
                    className="flex-1 text-sm bg-transparent border-b border-border focus:border-[#1e3a5f] focus:outline-none py-1"
                  />
                  <button
                    onClick={() => handleAddOption()}
                    disabled={!newOptionValue.trim()}
                    className="p-1 hover:bg-card rounded disabled:opacity-50"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer Actions */}
        <div className="border-t border-border p-2">
          <button
            onClick={onDuplicate}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-card rounded"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
            Duplicate property
          </button>
          <button
            onClick={() => {
              onDelete();
              onClose();
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-900/20 rounded"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
            Delete property
          </button>
        </div>
      </div>
    </div>
  );
}
