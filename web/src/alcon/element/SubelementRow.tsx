'use client';

import { toggleSubelementComplete } from '@/hooks/useSupabase';
import { Check } from 'lucide-react';
import { AtomIcon } from '@/alcon/shared/AtomIcon';

interface SubelementRowProps {
  subelement: {
    id: string;
    title: string;
    is_completed: boolean | null;
  };
  onRefresh?: () => void;
  /** Click anywhere except the checkbox/icon → opens detail modal. */
  onOpen?: () => void;
}

// Subelement row — same visual rhythm as the Elements list row
// (checkbox + Atom icon + name). The checkbox toggles is_completed; the
// rest of the row is a click target that opens the detail modal.
export function SubelementRow({ subelement, onRefresh, onOpen }: SubelementRowProps) {
  const handleToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await toggleSubelementComplete(subelement.id, !subelement.is_completed);
      onRefresh?.();
    } catch (err) {
      console.error('Failed to toggle subelement:', err);
    }
  };

  return (
    <div
      onClick={onOpen}
      className="group flex items-center gap-2 py-1 px-1 rounded-md hover:bg-muted/30 transition-colors cursor-pointer"
    >
      {/* Checkbox — matches ElementTableRow's done checkbox */}
      <button
        type="button"
        onClick={handleToggle}
        aria-label={subelement.is_completed ? 'Mark as todo' : 'Mark as done'}
        className={`w-4 h-4 rounded-[2px] flex items-center justify-center shrink-0 transition-colors ${
          subelement.is_completed
            ? 'bg-emerald-500 hover:bg-emerald-600'
            : 'border border-muted-foreground/40 hover:border-foreground/60'
        }`}
      >
        {subelement.is_completed && <Check size={11} strokeWidth={3} className="text-white" />}
      </button>

      {/* Atom icon — static marker mirroring the Elements list */}
      <AtomIcon className="size-3.5 text-muted-foreground/70 shrink-0" />

      {/* Title */}
      <span
        className={`text-[13px] truncate flex-1 ${
          subelement.is_completed
            ? 'text-muted-foreground line-through'
            : 'text-foreground group-hover:underline decoration-foreground/30 underline-offset-2'
        }`}
      >
        {subelement.title}
      </span>
    </div>
  );
}
