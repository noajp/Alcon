'use client';

import React, { useState } from 'react';
import type { CustomColumnWithValues } from '@/hooks/useSupabase';
import type { Json } from '@/types/database';

interface CustomColumnCellProps {
  column: CustomColumnWithValues;
  elementId: string;
  value: Json;
  onChange: (value: Json) => void;
  displayMode?: 'table' | 'pill';
}

export function CustomColumnCell({
  column,
  elementId,
  value,
  onChange,
  displayMode = 'table',
}: CustomColumnCellProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(String(value || ''));

  // Show column name in pill mode
  const renderWithLabel = (content: React.ReactNode) => {
    if (displayMode === 'pill') {
      return (
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs">{column.name}:</span>
          {content}
        </div>
      );
    }
    return content;
  };

  const handleSave = () => {
    if (column.column_type === 'number') {
      onChange(editValue ? Number(editValue) : null);
    } else if (column.column_type === 'checkbox') {
      // Checkbox is handled differently
    } else {
      onChange(editValue || null);
    }
    setIsEditing(false);
  };

  // Checkbox type
  if (column.column_type === 'checkbox') {
    return renderWithLabel(
      <button
        onClick={() => onChange(!value)}
        className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
          value ? 'bg-[#1e3a5f] border-[#1e3a5f] text-white' : 'border-border hover:border-[#1e3a5f]'
        }`}
      >
        {value && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        )}
      </button>
    );
  }

  // Date type
  if (column.column_type === 'date') {
    return renderWithLabel(
      <input
        type="date"
        value={String(value || '')}
        onChange={e => onChange(e.target.value || null)}
        className={`${displayMode === 'pill' ? 'w-auto' : 'w-full'} px-1 py-0.5 text-xs text-foreground bg-transparent border-none focus:outline-none focus:ring-1 focus:ring-[#1e3a5f]/20 rounded`}
      />
    );
  }

  // Select type
  if (column.column_type === 'select' || column.column_type === 'status') {
    const options = column.options?.options || [];
    return renderWithLabel(
      <select
        value={String(value || '')}
        onChange={e => onChange(e.target.value || null)}
        className={`${displayMode === 'pill' ? 'w-auto' : 'w-full'} px-1 py-0.5 text-xs text-foreground bg-transparent border-none focus:outline-none focus:ring-1 focus:ring-[#1e3a5f]/20 rounded appearance-none cursor-pointer`}
      >
        <option value="">-</option>
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.value}</option>
        ))}
      </select>
    );
  }

  // Number type
  if (column.column_type === 'number' || column.column_type === 'progress' || column.column_type === 'budget') {
    if (isEditing) {
      return renderWithLabel(
        <input
          type="number"
          value={editValue}
          onChange={e => setEditValue(e.target.value)}
          onBlur={handleSave}
          onKeyDown={e => {
            if (e.key === 'Enter') handleSave();
            if (e.key === 'Escape') {
              setEditValue(String(value || ''));
              setIsEditing(false);
            }
          }}
          className={`${displayMode === 'pill' ? 'w-16' : 'w-full'} px-1 py-0.5 text-xs text-foreground bg-background border border-[#1e3a5f] rounded focus:outline-none`}
          autoFocus
        />
      );
    }
    return renderWithLabel(
      <span
        onClick={() => {
          setEditValue(String(value || ''));
          setIsEditing(true);
        }}
        className="text-xs text-foreground cursor-text hover:bg-card px-1 py-0.5 rounded min-w-[30px] inline-block"
      >
        {value !== null && value !== undefined ? String(value) : '-'}
      </span>
    );
  }

  // Text type (default)
  if (isEditing) {
    return renderWithLabel(
      <input
        type="text"
        value={editValue}
        onChange={e => setEditValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={e => {
          if (e.key === 'Enter') handleSave();
          if (e.key === 'Escape') {
            setEditValue(String(value || ''));
            setIsEditing(false);
          }
        }}
        className={`${displayMode === 'pill' ? 'w-24' : 'w-full'} px-1 py-0.5 text-xs text-foreground bg-background border border-[#1e3a5f] rounded focus:outline-none`}
        autoFocus
      />
    );
  }

  return renderWithLabel(
    <span
      onClick={() => {
        setEditValue(String(value || ''));
        setIsEditing(true);
      }}
      className="text-xs text-foreground cursor-text hover:bg-card px-1 py-0.5 rounded min-w-[30px] inline-block truncate"
    >
      {value ? String(value) : <span className="text-muted-foreground">-</span>}
    </span>
  );
}
