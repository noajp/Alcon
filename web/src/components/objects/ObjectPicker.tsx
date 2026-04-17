'use client';

import { useState, useMemo } from 'react';
import { Search, ChevronRight, ChevronDown } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ObjectIcon } from '@/components/icons';
import type { ExplorerData, AlconObjectWithChildren } from '@/hooks/useSupabase';

interface ObjectPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (objectId: string) => void;
  title: string;
  description?: string;
  excludeIds?: string[];
  explorerData: ExplorerData;
}

interface PickerNodeProps {
  object: AlconObjectWithChildren;
  depth: number;
  excludeIds: Set<string>;
  searchTerm: string;
  onSelect: (id: string) => void;
}

function matches(obj: AlconObjectWithChildren, term: string): boolean {
  if (!term) return true;
  if (obj.name.toLowerCase().includes(term.toLowerCase())) return true;
  return (obj.children || []).some(c => matches(c, term));
}

function PickerNode({ object, depth, excludeIds, searchTerm, onSelect }: PickerNodeProps) {
  const [expanded, setExpanded] = useState(true);
  const isExcluded = excludeIds.has(object.id);
  const hasChildren = (object.children?.length ?? 0) > 0;
  const visible = matches(object, searchTerm);
  if (!visible) return null;

  return (
    <div>
      <div
        className={`flex items-center gap-1.5 py-1.5 pr-2 rounded-md transition-colors ${
          isExcluded ? 'opacity-40 cursor-not-allowed' : 'hover:bg-muted cursor-pointer'
        }`}
        style={{ paddingLeft: 8 + depth * 16 }}
        onClick={() => !isExcluded && onSelect(object.id)}
      >
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          className={`w-4 h-4 flex items-center justify-center text-muted-foreground/60 hover:text-foreground ${!hasChildren ? 'invisible' : ''}`}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <ObjectIcon size={14} />
        <span className="text-[13px] truncate flex-1">{object.name}</span>
      </div>
      {expanded && hasChildren && object.children!.map(child => (
        <PickerNode
          key={child.id}
          object={child}
          depth={depth + 1}
          excludeIds={excludeIds}
          searchTerm={searchTerm}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

export function ObjectPicker({ open, onClose, onSelect, title, description, excludeIds = [], explorerData }: ObjectPickerProps) {
  const [search, setSearch] = useState('');
  const excludeSet = useMemo(() => new Set(excludeIds), [excludeIds]);

  const handleSelect = (id: string) => {
    onSelect(id);
    onClose();
    setSearch('');
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { onClose(); setSearch(''); } }}>
      <DialogContent className="sm:max-w-md p-0 gap-0">
        <DialogHeader className="px-4 pt-4 pb-3">
          <DialogTitle className="text-[14px] font-semibold">{title}</DialogTitle>
          {description && <p className="text-[12px] text-muted-foreground">{description}</p>}
        </DialogHeader>
        <div className="px-4 pb-2 border-b border-border/60">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Find object..."
              autoFocus
              className="w-full pl-8 pr-3 py-1.5 text-[13px] bg-muted/40 border-0 rounded-md focus:outline-none focus:ring-1 focus:ring-foreground/20"
            />
          </div>
        </div>
        <div className="max-h-[400px] overflow-y-auto p-2">
          {explorerData.objects.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">No objects yet</div>
          ) : (
            explorerData.objects.map(obj => (
              <PickerNode
                key={obj.id}
                object={obj}
                depth={0}
                excludeIds={excludeSet}
                searchTerm={search}
                onSelect={handleSelect}
              />
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
