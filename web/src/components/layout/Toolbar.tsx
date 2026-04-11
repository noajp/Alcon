'use client';

import { useState } from 'react';
import { ArrowUpDown, Filter, Layers, ChevronDown } from 'lucide-react';

interface ToolbarProps {
  groupBy?: string;
  onGroupByChange?: (groupBy: string) => void;
  sortBy?: string;
  onSortByChange?: (sortBy: string) => void;
}

export function Toolbar({ groupBy = 'section', onGroupByChange, sortBy, onSortByChange }: ToolbarProps) {
  const [showGroupMenu, setShowGroupMenu] = useState(false);
  const [showSortMenu, setShowSortMenu] = useState(false);

  const groupOptions = [
    { value: 'section', label: 'Section' },
    { value: 'status', label: 'Status' },
    { value: 'priority', label: 'Priority' },
    { value: 'none', label: 'None' },
  ];

  const sortOptions = [
    { value: 'order', label: 'Manual' },
    { value: 'title', label: 'Title' },
    { value: 'status', label: 'Status' },
    { value: 'priority', label: 'Priority' },
    { value: 'due_date', label: 'Due Date' },
  ];

  return (
    <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border bg-card">
      {/* Group by */}
      <div className="relative">
        <button
          onClick={() => { setShowGroupMenu(!showGroupMenu); setShowSortMenu(false); }}
          className="flex items-center gap-1.5 px-2 py-1 text-[12px] text-muted-foreground hover:text-foreground hover:bg-accent/50 rounded transition-colors"
        >
          <Layers size={13} />
          <span>Group by {groupOptions.find(o => o.value === groupBy)?.label}</span>
          <ChevronDown size={12} />
        </button>
        {showGroupMenu && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowGroupMenu(false)} />
            <div className="absolute top-full left-0 mt-1 py-1 bg-popover border border-border rounded-lg shadow-xl z-50 min-w-[140px]">
              {groupOptions.map(option => (
                <button
                  key={option.value}
                  onClick={() => { onGroupByChange?.(option.value); setShowGroupMenu(false); }}
                  className={`w-full px-3 py-1.5 text-[13px] text-left transition-colors ${
                    groupBy === option.value ? 'bg-accent text-foreground' : 'text-foreground hover:bg-accent'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Sort */}
      <div className="relative">
        <button
          onClick={() => { setShowSortMenu(!showSortMenu); setShowGroupMenu(false); }}
          className="flex items-center gap-1.5 px-2 py-1 text-[12px] text-muted-foreground hover:text-foreground hover:bg-accent/50 rounded transition-colors"
        >
          <ArrowUpDown size={13} />
          <span>Sort</span>
          <ChevronDown size={12} />
        </button>
        {showSortMenu && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowSortMenu(false)} />
            <div className="absolute top-full left-0 mt-1 py-1 bg-popover border border-border rounded-lg shadow-xl z-50 min-w-[140px]">
              {sortOptions.map(option => (
                <button
                  key={option.value}
                  onClick={() => { onSortByChange?.(option.value); setShowSortMenu(false); }}
                  className={`w-full px-3 py-1.5 text-[13px] text-left transition-colors ${
                    sortBy === option.value ? 'bg-accent text-foreground' : 'text-foreground hover:bg-accent'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Filter */}
      <button className="flex items-center gap-1.5 px-2 py-1 text-[12px] text-muted-foreground hover:text-foreground hover:bg-accent/50 rounded transition-colors">
        <Filter size={13} />
        <span>Filter</span>
      </button>
    </div>
  );
}
