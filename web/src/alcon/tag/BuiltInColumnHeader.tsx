'use client';

import { useState } from 'react';
import type { BuiltInColumn } from './builtInColumns';
import { EditBuiltInPropertyModal } from './EditBuiltInPropertyModal';

interface BuiltInColumnHeaderProps {
  column: BuiltInColumn;
  onUpdate: (updates: Partial<BuiltInColumn>) => void;
  onDelete: () => void;
}

export function BuiltInColumnHeader({
  column,
  onUpdate,
  onDelete,
}: BuiltInColumnHeaderProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);

  return (
    <div className="relative group">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setShowMenu(!showMenu);
        }}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap"
      >
        {column.name}
        <svg className="opacity-0 group-hover:opacity-100 transition-opacity" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {showMenu && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setShowMenu(false)} />
          <div className="absolute left-0 top-full mt-1 w-48 bg-background border border-border rounded-lg shadow-lg py-1 z-40">
            <button
              onClick={() => {
                setShowMenu(false);
                setShowEditModal(true);
              }}
              className="w-full px-3 py-2 text-left text-sm text-foreground hover:bg-card flex items-center gap-2"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              Edit property
            </button>
            <button
              onClick={() => {
                setShowMenu(false);
                onUpdate({ isVisible: false });
              }}
              className="w-full px-3 py-2 text-left text-sm text-foreground hover:bg-card flex items-center gap-2"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
              Hide in view
            </button>
            <div className="border-t border-border my-1" />
            <button
              onClick={() => {
                setShowMenu(false);
                onDelete();
              }}
              className="w-full px-3 py-2 text-left text-sm text-[#dc2626] hover:bg-red-900/20 flex items-center gap-2"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              Delete property
            </button>
          </div>
        </>
      )}

      {showEditModal && (
        <EditBuiltInPropertyModal
          column={column}
          onClose={() => setShowEditModal(false)}
          onUpdate={onUpdate}
        />
      )}
    </div>
  );
}
