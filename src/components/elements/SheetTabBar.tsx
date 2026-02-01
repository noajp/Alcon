'use client';

import { useState, useRef, useEffect } from 'react';
import { Plus, X, MoreHorizontal } from 'lucide-react';
import type { ElementSheet } from '@/types/database';

interface SheetTabBarProps {
  sheets: ElementSheet[];
  activeSheetId: string | null;
  onSheetSelect: (sheetId: string) => void;
  onSheetCreate: () => void;
  onSheetRename: (sheetId: string, name: string) => void;
  onSheetDelete: (sheetId: string) => void;
}

export function SheetTabBar({
  sheets,
  activeSheetId,
  onSheetSelect,
  onSheetCreate,
  onSheetRename,
  onSheetDelete,
}: SheetTabBarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [contextMenu, setContextMenu] = useState<{ sheetId: string; x: number; y: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  const handleDoubleClick = (sheet: ElementSheet) => {
    setEditingId(sheet.id);
    setEditName(sheet.name);
  };

  const handleRename = () => {
    if (editingId && editName.trim()) {
      onSheetRename(editingId, editName.trim());
    }
    setEditingId(null);
    setEditName('');
  };

  const handleContextMenu = (e: React.MouseEvent, sheetId: string) => {
    e.preventDefault();
    setContextMenu({ sheetId, x: e.clientX, y: e.clientY });
  };

  return (
    <div className="flex items-center gap-0.5 px-2 py-1 bg-muted/30 border-t border-border overflow-x-auto">
      {sheets.map((sheet) => {
        const isActive = sheet.id === activeSheetId;
        const isEditing = sheet.id === editingId;

        return (
          <div
            key={sheet.id}
            className={`
              group flex items-center gap-1 px-3 py-1.5 text-xs rounded-t-md cursor-pointer
              transition-colors min-w-[80px] max-w-[150px]
              ${isActive
                ? 'bg-background text-foreground border-t border-l border-r border-border -mb-px'
                : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
              }
            `}
            onClick={() => !isEditing && onSheetSelect(sheet.id)}
            onDoubleClick={() => handleDoubleClick(sheet)}
            onContextMenu={(e) => handleContextMenu(e, sheet.id)}
          >
            {isEditing ? (
              <input
                ref={inputRef}
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={handleRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRename();
                  if (e.key === 'Escape') {
                    setEditingId(null);
                    setEditName('');
                  }
                }}
                className="w-full bg-transparent border-none outline-none text-xs"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <>
                <span className="truncate flex-1">{sheet.name}</span>
                {sheets.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSheetDelete(sheet.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-accent rounded transition-opacity"
                  >
                    <X size={10} />
                  </button>
                )}
              </>
            )}
          </div>
        );
      })}

      {/* Add Sheet Button */}
      <button
        onClick={onSheetCreate}
        className="flex items-center justify-center w-6 h-6 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
        title="Add sheet"
      >
        <Plus size={14} />
      </button>

      {/* Context Menu */}
      {contextMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setContextMenu(null)}
          />
          <div
            className="fixed z-50 bg-popover border border-border rounded-lg shadow-xl py-1 min-w-[120px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              onClick={() => {
                const sheet = sheets.find(s => s.id === contextMenu.sheetId);
                if (sheet) {
                  setEditingId(sheet.id);
                  setEditName(sheet.name);
                }
                setContextMenu(null);
              }}
              className="w-full px-3 py-1.5 text-sm text-left hover:bg-accent transition-colors"
            >
              Rename
            </button>
            {sheets.length > 1 && (
              <button
                onClick={() => {
                  onSheetDelete(contextMenu.sheetId);
                  setContextMenu(null);
                }}
                className="w-full px-3 py-1.5 text-sm text-left text-destructive hover:bg-accent transition-colors"
              >
                Delete
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
