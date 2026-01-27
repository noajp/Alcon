'use client';

import { useState } from 'react';
import { ChevronRight, ChevronDown, Folder, FolderOpen, FileText, Plus, MoreHorizontal, Trash2, Edit2 } from 'lucide-react';
import type { NoteWithChildren } from '@/hooks/useSupabase';

interface NoteExplorerProps {
  notes: NoteWithChildren[];
  selectedNoteId: string | null;
  onSelectNote: (noteId: string) => void;
  onCreateNote: (parentId: string | null, type: 'folder' | 'note') => void;
  onDeleteNote: (noteId: string) => void;
  onRenameNote: (noteId: string, newTitle: string) => void;
}

interface NoteItemProps {
  note: NoteWithChildren;
  level: number;
  selectedNoteId: string | null;
  onSelectNote: (noteId: string) => void;
  onCreateNote: (parentId: string | null, type: 'folder' | 'note') => void;
  onDeleteNote: (noteId: string) => void;
  onRenameNote: (noteId: string, newTitle: string) => void;
}

function NoteItem({ note, level, selectedNoteId, onSelectNote, onCreateNote, onDeleteNote, onRenameNote }: NoteItemProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [showMenu, setShowMenu] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(note.title);

  const isSelected = note.id === selectedNoteId;
  const isFolder = note.type === 'folder';
  const hasChildren = note.children && note.children.length > 0;

  const handleClick = () => {
    if (isFolder) {
      setIsExpanded(!isExpanded);
    }
    onSelectNote(note.id);
  };

  const handleRename = () => {
    if (renameValue.trim() && renameValue !== note.title) {
      onRenameNote(note.id, renameValue.trim());
    }
    setIsRenaming(false);
  };

  return (
    <div>
      <div
        className={`
          group flex items-center gap-1 px-2 py-1 rounded cursor-pointer
          ${isSelected ? 'bg-[#2d4a6d] text-white' : 'hover:bg-[#333] text-[#c0c0c0]'}
        `}
        style={{ paddingLeft: `${8 + level * 16}px` }}
        onClick={handleClick}
      >
        {/* Expand/collapse arrow for folders */}
        {isFolder ? (
          <span className="w-4 h-4 flex items-center justify-center text-[#888]">
            {hasChildren && (isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
          </span>
        ) : (
          <span className="w-4" />
        )}

        {/* Icon */}
        <span className={isSelected ? 'text-white' : 'text-[#888]'}>
          {isFolder ? (
            isExpanded ? <FolderOpen size={14} /> : <Folder size={14} />
          ) : (
            <FileText size={14} />
          )}
        </span>

        {/* Title */}
        {isRenaming ? (
          <input
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRename();
              if (e.key === 'Escape') {
                setRenameValue(note.title);
                setIsRenaming(false);
              }
            }}
            className="flex-1 bg-[#1e1e1e] border border-[#444] rounded px-1 py-0.5 text-xs text-white focus:outline-none focus:border-[#1e3a5f]"
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="flex-1 text-xs truncate">{note.title}</span>
        )}

        {/* Actions menu */}
        <div className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowMenu(!showMenu);
            }}
            className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-white/10 rounded"
          >
            <MoreHorizontal size={12} />
          </button>

          {showMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
              <div className="absolute right-0 top-full mt-1 py-1 bg-[#2a2a2a] border border-[#444] rounded shadow-xl z-50 min-w-[120px]">
                {isFolder && (
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onCreateNote(note.id, 'note');
                        setShowMenu(false);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[#e0e0e0] hover:bg-[#333]"
                    >
                      <FileText size={12} />
                      New Note
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onCreateNote(note.id, 'folder');
                        setShowMenu(false);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[#e0e0e0] hover:bg-[#333]"
                    >
                      <Folder size={12} />
                      New Folder
                    </button>
                    <div className="border-t border-[#444] my-1" />
                  </>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsRenaming(true);
                    setShowMenu(false);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[#e0e0e0] hover:bg-[#333]"
                >
                  <Edit2 size={12} />
                  Rename
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteNote(note.id);
                    setShowMenu(false);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-[#333]"
                >
                  <Trash2 size={12} />
                  Delete
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Children */}
      {isFolder && isExpanded && note.children && note.children.length > 0 && (
        <div>
          {note.children.map((child) => (
            <NoteItem
              key={child.id}
              note={child}
              level={level + 1}
              selectedNoteId={selectedNoteId}
              onSelectNote={onSelectNote}
              onCreateNote={onCreateNote}
              onDeleteNote={onDeleteNote}
              onRenameNote={onRenameNote}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function NoteExplorer({
  notes,
  selectedNoteId,
  onSelectNote,
  onCreateNote,
  onDeleteNote,
  onRenameNote,
}: NoteExplorerProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#333]">
        <span className="text-xs font-medium text-[#888] uppercase tracking-wide">Notes</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onCreateNote(null, 'note')}
            className="p-1 hover:bg-[#333] rounded text-[#888] hover:text-[#e0e0e0]"
            title="New Note"
          >
            <FileText size={14} />
          </button>
          <button
            onClick={() => onCreateNote(null, 'folder')}
            className="p-1 hover:bg-[#333] rounded text-[#888] hover:text-[#e0e0e0]"
            title="New Folder"
          >
            <Folder size={14} />
          </button>
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {notes.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-[#888]">
            <p>No notes yet</p>
            <p className="mt-1">Click + to create one</p>
          </div>
        ) : (
          notes.map((note) => (
            <NoteItem
              key={note.id}
              note={note}
              level={0}
              selectedNoteId={selectedNoteId}
              onSelectNote={onSelectNote}
              onCreateNote={onCreateNote}
              onDeleteNote={onDeleteNote}
              onRenameNote={onRenameNote}
            />
          ))
        )}
      </div>
    </div>
  );
}
