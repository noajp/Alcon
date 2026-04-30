'use client';

import { X } from 'lucide-react';

interface FilterChipProps {
  label: string;
  onRemove: () => void;
}

export function FilterChip({ label, onRemove }: FilterChipProps) {
  return (
    <div className="flex h-7 items-center gap-1.5 rounded-md border border-border/60 bg-muted px-2.5 text-xs min-w-0 max-w-[200px]">
      <span className="truncate text-foreground/80">{label}</span>
      <button
        onClick={onRemove}
        className="ml-0.5 rounded p-0.5 hover:bg-accent flex-shrink-0 text-muted-foreground hover:text-foreground"
      >
        <X className="h-3 w-3" strokeWidth={2.5} />
      </button>
    </div>
  );
}
