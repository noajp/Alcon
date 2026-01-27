'use client';

import { useState } from 'react';
import { ChevronRight, ChevronDown, FileText, Folder, Plus, MoreHorizontal, Trash2, Edit2, Star, StarOff, FolderPlus, FilePlus } from 'lucide-react';
import type { DocumentWithChildren } from '@/hooks/useSupabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface DocumentExplorerProps {
  documents: DocumentWithChildren[];
  selectedDocId: string | null;
  onSelectDoc: (docId: string) => void;
  onCreateDoc: (parentId: string | null, type: 'folder' | 'page') => void;
  onDeleteDoc: (docId: string) => void;
  onRenameDoc: (docId: string, newTitle: string) => void;
  onToggleFavorite: (docId: string, isFavorite: boolean) => void;
}

interface DocumentItemProps {
  doc: DocumentWithChildren;
  level: number;
  selectedDocId: string | null;
  onSelectDoc: (docId: string) => void;
  onCreateDoc: (parentId: string | null, type: 'folder' | 'page') => void;
  onDeleteDoc: (docId: string) => void;
  onRenameDoc: (docId: string, newTitle: string) => void;
  onToggleFavorite: (docId: string, isFavorite: boolean) => void;
}

function DocumentItem({
  doc,
  level,
  selectedDocId,
  onSelectDoc,
  onCreateDoc,
  onDeleteDoc,
  onRenameDoc,
  onToggleFavorite
}: DocumentItemProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(doc.title);
  const [isHovered, setIsHovered] = useState(false);

  const isSelected = doc.id === selectedDocId;
  const isFolder = doc.type === 'folder';
  const hasChildren = doc.children && doc.children.length > 0;

  const handleClick = () => {
    onSelectDoc(doc.id);
  };

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExpanded(!isExpanded);
  };

  const handleRename = () => {
    if (renameValue.trim() && renameValue !== doc.title) {
      onRenameDoc(doc.id, renameValue.trim());
    }
    setIsRenaming(false);
  };

  return (
    <TooltipProvider delayDuration={500}>
      <div>
        <div
          className={`
            group flex items-center gap-1 py-1 px-2 rounded-sm cursor-pointer transition-colors
            ${isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'}
          `}
          style={{ paddingLeft: `${12 + level * 12}px` }}
          onClick={handleClick}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          {/* Expand/collapse arrow */}
          <Button
            variant="ghost"
            size="icon"
            className={`h-5 w-5 p-0 ${hasChildren ? 'opacity-100' : 'opacity-0'}`}
            onClick={handleToggle}
          >
            {isExpanded ? (
              <ChevronDown size={14} className="text-muted-foreground" />
            ) : (
              <ChevronRight size={14} className="text-muted-foreground" />
            )}
          </Button>

          {/* Icon */}
          <span className="flex-shrink-0">
            {doc.icon ? (
              <span className="text-sm">{doc.icon}</span>
            ) : isFolder ? (
              <Folder size={16} className="text-muted-foreground" />
            ) : (
              <FileText size={16} className="text-muted-foreground" />
            )}
          </span>

          {/* Title */}
          {isRenaming ? (
            <Input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={handleRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRename();
                if (e.key === 'Escape') {
                  setRenameValue(doc.title);
                  setIsRenaming(false);
                }
              }}
              className="h-6 flex-1 px-1 py-0 text-sm"
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="flex-1 text-sm truncate">
              {doc.title || 'Untitled'}
            </span>
          )}

          {/* Hover actions - always rendered, visibility controlled by opacity */}
          {!isRenaming && (
            <div className={`flex items-center gap-0.5 transition-opacity ${isHovered ? 'opacity-100' : 'opacity-0'}`}>
              {/* Add page inside - only for folders */}
              {isFolder && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={(e) => {
                        e.stopPropagation();
                        onCreateDoc(doc.id, 'page');
                        if (!isExpanded) setIsExpanded(true);
                      }}
                    >
                      <Plus size={14} className="text-muted-foreground" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p>Add page inside</p>
                  </TooltipContent>
                </Tooltip>
              )}

              {/* More options */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreHorizontal size={14} className="text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  {/* Only show create options for folders */}
                  {isFolder && (
                    <>
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          onCreateDoc(doc.id, 'page');
                          if (!isExpanded) setIsExpanded(true);
                        }}
                      >
                        <FilePlus size={14} className="mr-2" />
                        New Page Inside
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          onCreateDoc(doc.id, 'folder');
                          if (!isExpanded) setIsExpanded(true);
                        }}
                      >
                        <FolderPlus size={14} className="mr-2" />
                        New Folder Inside
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  )}
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleFavorite(doc.id, !doc.is_favorite);
                    }}
                  >
                    {doc.is_favorite ? (
                      <>
                        <StarOff size={14} className="mr-2" />
                        Remove from Favorites
                      </>
                    ) : (
                      <>
                        <Star size={14} className="mr-2" />
                        Add to Favorites
                      </>
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsRenaming(true);
                    }}
                  >
                    <Edit2 size={14} className="mr-2" />
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteDoc(doc.id);
                    }}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 size={14} className="mr-2" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>

        {/* Children */}
        {isExpanded && doc.children && doc.children.length > 0 && (
          <div>
            {doc.children.map((child) => (
              <DocumentItem
                key={child.id}
                doc={child}
                level={level + 1}
                selectedDocId={selectedDocId}
                onSelectDoc={onSelectDoc}
                onCreateDoc={onCreateDoc}
                onDeleteDoc={onDeleteDoc}
                onRenameDoc={onRenameDoc}
                onToggleFavorite={onToggleFavorite}
              />
            ))}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

export function DocumentExplorer({
  documents,
  selectedDocId,
  onSelectDoc,
  onCreateDoc,
  onDeleteDoc,
  onRenameDoc,
  onToggleFavorite,
}: DocumentExplorerProps) {
  // Separate favorites
  const favorites = documents.filter(d => d.is_favorite);
  const regularDocs = documents.filter(d => !d.is_favorite || d.parent_id !== null);

  return (
    <div className="flex flex-col h-full">
      <ScrollArea className="flex-1">
        {/* Favorites section */}
        {favorites.length > 0 && (
          <div className="mb-2">
            <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Favorites
            </div>
            {favorites.map((doc) => (
              <DocumentItem
                key={doc.id}
                doc={doc}
                level={0}
                selectedDocId={selectedDocId}
                onSelectDoc={onSelectDoc}
                onCreateDoc={onCreateDoc}
                onDeleteDoc={onDeleteDoc}
                onRenameDoc={onRenameDoc}
                onToggleFavorite={onToggleFavorite}
              />
            ))}
            <Separator className="my-2" />
          </div>
        )}

        {/* Private section */}
        <div>
          <div className="flex items-center justify-between px-3 py-1.5">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Private
            </span>
            <div className="flex items-center gap-0.5">
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5"
                      onClick={() => onCreateDoc(null, 'page')}
                    >
                      <FilePlus size={12} className="text-muted-foreground" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p>New Page</p>
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5"
                      onClick={() => onCreateDoc(null, 'folder')}
                    >
                      <FolderPlus size={12} className="text-muted-foreground" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p>New Folder</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>

          {regularDocs.length === 0 && favorites.length === 0 ? (
            <div className="px-3 py-8 text-center">
              <p className="text-sm text-muted-foreground">No pages yet</p>
              <div className="flex items-center justify-center gap-2 mt-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onCreateDoc(null, 'page')}
                >
                  <FilePlus size={14} className="mr-1.5" />
                  New Page
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onCreateDoc(null, 'folder')}
                >
                  <FolderPlus size={14} className="mr-1.5" />
                  New Folder
                </Button>
              </div>
            </div>
          ) : (
            documents
              .filter(d => d.parent_id === null && !d.is_favorite)
              .map((doc) => (
                <DocumentItem
                  key={doc.id}
                  doc={doc}
                  level={0}
                  selectedDocId={selectedDocId}
                  onSelectDoc={onSelectDoc}
                  onCreateDoc={onCreateDoc}
                  onDeleteDoc={onDeleteDoc}
                  onRenameDoc={onRenameDoc}
                  onToggleFavorite={onToggleFavorite}
                />
              ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
