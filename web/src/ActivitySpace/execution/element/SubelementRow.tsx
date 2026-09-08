'use client';

import { toggleSubelementComplete } from '@/hooks/useSupabase';
import { Check } from 'lucide-react';
import { ElementProgressMark } from '@/Function/shared/ElementProgressMark';
import { displayIdOf } from './displayId';
import { DisplayIdChip } from './DisplayIdChip';

interface SubelementRowProps {
  subelement: {
    id: string;
    title: string;
    is_completed: boolean | null;
    display_id?: string | null;
  };
  onRefresh?: () => void;
  /** Click anywhere except the mark / checkbox → opens the detail modal. */
  onOpen?: () => void;
  // ── Multi-select (optional — only the detail view wires these, mirroring
  //    the Elements list). With `canRowSelect` off the checkbox is absent
  //    and the row behaves like a plain open-on-click item. ──
  canRowSelect?: boolean;
  isSelected?: boolean;
  /** Stable ref to "is anything selected" — lets a plain click replace the
   *  selection without re-rendering every row when the flag flips. */
  hasSelectionRef?: React.MutableRefObject<boolean>;
  onRowSelect?: (id: string, mode: 'single' | 'range' | 'replace') => void;
}

// Subelement row — mirrors the Elements list row (ListTable's
// ElementRow): an optional selection checkbox, an optional display id, a
// circular status mark, then a 13px semibold title, with the same row
// height / hover highlight. The mark doubles as the completion toggle (todo
// ring ⇄ green done disc); clicking elsewhere opens the detail modal (or,
// while selecting, extends the selection).
export function SubelementRow({
  subelement, onRefresh, onOpen,
  canRowSelect = false, isSelected = false, hasSelectionRef, onRowSelect,
}: SubelementRowProps) {
  const subId = displayIdOf(subelement);

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
      onClick={(e) => {
        // Shift / Cmd / Ctrl click → selection (range / toggle).
        if (canRowSelect && (e.shiftKey || e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          onRowSelect?.(subelement.id, e.shiftKey ? 'range' : 'single');
          return;
        }
        // Plain click while a selection exists → replace it.
        if (canRowSelect && hasSelectionRef?.current) {
          onRowSelect?.(subelement.id, 'replace');
          return;
        }
        onOpen?.();
      }}
      className={`group flex items-center gap-2 min-h-[1.625rem] px-2 py-1 rounded-lg cursor-pointer select-none leading-[1.4] transition-colors ${
        isSelected
          ? 'bg-blue-500/15 dark:bg-blue-400/20 hover:bg-blue-500/20 dark:hover:bg-blue-400/25'
          : 'hover:bg-foreground/[0.06]'
      }`}
    >
      {/* Selection checkbox — hidden until row-hover, pinned visible once any
          sub-element is selected. preventDefault on mousedown stops the stray
          focus ring / text-selection on a mouse click. */}
      {canRowSelect && (
        <button
          type="button"
          aria-label={isSelected ? 'Deselect sub-element' : 'Select sub-element'}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => { e.stopPropagation(); onRowSelect?.(subelement.id, e.shiftKey ? 'range' : 'single'); }}
          className={`size-4 rounded-[5px] border flex items-center justify-center shrink-0 transition-opacity ${
            isSelected
              ? 'bg-primary border-primary text-primary-foreground opacity-100'
              : 'border-muted-foreground/40 text-transparent hover:border-muted-foreground opacity-0 group-hover:opacity-100 group-data-[has-selection]/sublist:opacity-100'
          }`}
        >
          <Check size={11} strokeWidth={3} />
        </button>
      )}

      <DisplayIdChip id={subId} />

      {/* Circular status mark — same glyph the Elements list uses. Click to
          toggle completion (todo ring ⇄ green done disc) without opening
          the row. */}
      <button
        type="button"
        onClick={handleToggle}
        onMouseDown={(e) => e.preventDefault()}
        aria-label={subelement.is_completed ? 'Mark as todo' : 'Mark as done'}
        className="shrink-0 flex items-center rounded-full transition-opacity hover:opacity-80"
      >
        <ElementProgressMark status={subelement.is_completed ? 'done' : 'todo'} size={16} />
      </button>

      {/* Title — 13px semibold to match the list; the done state is carried
          by the green mark, so the title only dims (no strikethrough). */}
      <span
        className={`text-[13px] font-semibold truncate flex-1 min-w-0 ${
          subelement.is_completed ? 'text-muted-foreground' : 'text-foreground'
        }`}
      >
        {subelement.title}
      </span>
    </div>
  );
}
