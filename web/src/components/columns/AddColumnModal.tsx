'use client';

import { useState } from 'react';
import type { CustomColumnType } from '@/types/database';
import { COLUMN_TYPES, BUILTIN_COLUMN_ICONS } from './columnTypes';

interface AddColumnModalProps {
  onClose: () => void;
  onAdd: (name: string, type: CustomColumnType) => void;
  deletedBuiltInColumns?: { id: string; name: string; builtinType: 'assignees' | 'priority' | 'status' | 'due_date' }[];
  onRestoreBuiltIn?: (builtinType: 'assignees' | 'priority' | 'status' | 'due_date') => void;
}

export function AddColumnModal({
  onClose,
  onAdd,
  deletedBuiltInColumns,
  onRestoreBuiltIn,
}: AddColumnModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<CustomColumnType | null>(null);
  const [columnName, setColumnName] = useState('');

  const filteredTypes = COLUMN_TYPES.filter(t =>
    t.label.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredDeletedBuiltIn = (deletedBuiltInColumns || []).filter(c =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const suggestedTypes = filteredTypes.filter(t => t.category === 'suggested');
  const basicTypes = filteredTypes.filter(t => t.category === 'basic');
  const advancedTypes = filteredTypes.filter(t => t.category === 'advanced');

  const handleSelectType = (type: CustomColumnType) => {
    setSelectedType(type);
    const typeInfo = COLUMN_TYPES.find(t => t.type === type);
    setColumnName(typeInfo?.label || '');
  };

  const handleAdd = () => {
    if (selectedType && columnName.trim()) {
      onAdd(columnName.trim(), selectedType);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-background rounded-lg shadow-xl w-[320px] max-h-[500px] overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {!selectedType ? (
          <>
            {/* Search */}
            <div className="p-3 border-b border-border">
              <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <input
                  type="text"
                  placeholder="Search for a property type"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-card rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20"
                  autoFocus
                />
              </div>
            </div>

            {/* Type List */}
            <div className="overflow-y-auto max-h-[400px]">
              {/* Deleted Built-in Columns - Restore section */}
              {filteredDeletedBuiltIn.length > 0 && (
                <div className="p-2">
                  <div className="text-xs text-muted-foreground px-2 py-1">Restore default columns</div>
                  {filteredDeletedBuiltIn.map((col) => (
                    <button
                      key={col.id}
                      onClick={() => {
                        onRestoreBuiltIn?.(col.builtinType);
                        onClose();
                      }}
                      className="w-full flex items-center gap-3 px-2 py-2 rounded hover:bg-card transition-colors text-left"
                    >
                      <span className="text-muted-foreground">{BUILTIN_COLUMN_ICONS[col.builtinType]}</span>
                      <span className="text-sm text-foreground">{col.name}</span>
                      <span className="text-xs text-muted-foreground ml-auto">Built-in</span>
                    </button>
                  ))}
                </div>
              )}

              {suggestedTypes.length > 0 && (
                <div className={`p-2 ${filteredDeletedBuiltIn.length > 0 ? 'border-t border-border' : ''}`}>
                  <div className="text-xs text-muted-foreground px-2 py-1">Suggested</div>
                  {suggestedTypes.map(({ type, label, icon }) => (
                    <button
                      key={type}
                      onClick={() => handleSelectType(type)}
                      className="w-full flex items-center gap-3 px-2 py-2 rounded hover:bg-card transition-colors text-left"
                    >
                      <span className="text-muted-foreground">{icon}</span>
                      <span className="text-sm text-foreground">{label}</span>
                    </button>
                  ))}
                </div>
              )}

              {basicTypes.length > 0 && (
                <div className="p-2 border-t border-border">
                  <div className="text-xs text-muted-foreground px-2 py-1">Select type</div>
                  <div className="grid grid-cols-2 gap-1">
                    {basicTypes.map(({ type, label, icon }) => (
                      <button
                        key={type}
                        onClick={() => handleSelectType(type)}
                        className="flex items-center gap-2 px-2 py-2 rounded hover:bg-card transition-colors text-left"
                      >
                        <span className="text-muted-foreground">{icon}</span>
                        <span className="text-sm text-foreground">{label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {advancedTypes.length > 0 && (
                <div className="p-2 border-t border-border">
                  {advancedTypes.map(({ type, label, icon }) => (
                    <button
                      key={type}
                      onClick={() => handleSelectType(type)}
                      className="w-full flex items-center gap-3 px-2 py-2 rounded hover:bg-card transition-colors text-left"
                    >
                      <span className="text-muted-foreground">{icon}</span>
                      <span className="text-sm text-foreground">{label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="p-4">
            <div className="flex items-center gap-2 mb-4">
              <button
                onClick={() => setSelectedType(null)}
                className="p-1 hover:bg-card rounded"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="15 18 9 12 15 6"/>
                </svg>
              </button>
              <span className="text-sm font-medium">New {COLUMN_TYPES.find(t => t.type === selectedType)?.label} column</span>
            </div>

            <input
              type="text"
              value={columnName}
              onChange={e => setColumnName(e.target.value)}
              placeholder="Column name"
              className="w-full px-3 py-2 border border-border rounded-md text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20 focus:border-[#1e3a5f]"
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter') handleAdd();
                if (e.key === 'Escape') onClose();
              }}
            />

            <div className="flex justify-end gap-2">
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-sm text-muted-foreground hover:bg-card rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAdd}
                disabled={!columnName.trim()}
                className="px-3 py-1.5 text-sm bg-[#1e3a5f] text-white rounded hover:bg-[#152a45] transition-colors disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
