'use client';

import { useState } from 'react';
import type { CustomColumnWithValues } from '@/hooks/useSupabase';
import { EditPropertyModal } from './EditPropertyModal';

interface ColumnHeaderProps {
  column: CustomColumnWithValues;
  onRename: (name: string) => void;
  onDelete: () => void;
  onUpdate: (updates: { name?: string; options?: { options?: { value: string; color?: string }[] } }) => void;
  onDuplicate: () => void;
}

export function ColumnHeader({
  column,
  onRename,
  onDelete,
  onUpdate,
  onDuplicate,
}: ColumnHeaderProps) {
  const [showEditModal, setShowEditModal] = useState(false);

  return (
    <div className="relative group">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setShowEditModal(true);
        }}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {column.name}
        <svg className="opacity-0 group-hover:opacity-100 transition-opacity" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {showEditModal && (
        <EditPropertyModal
          column={column}
          onClose={() => setShowEditModal(false)}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onDuplicate={onDuplicate}
        />
      )}
    </div>
  );
}
