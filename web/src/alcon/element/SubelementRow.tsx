'use client';

import { toggleSubelementComplete } from '@/hooks/useSupabase';
import { ElementProgressMark } from '@/alcon/shared/ElementProgressMark';

interface SubelementRowProps {
  subelement: {
    id: string;
    title: string;
    is_completed: boolean | null;
    seq_number?: number | null;
  };
  onRefresh?: () => void;
  /** Click anywhere except the status mark → opens the detail modal. */
  onOpen?: () => void;
}

// Subelement row — mirrors the Elements list row (ObjectListView's
// ElementRow): an optional SUB-id, a circular status mark, then a 13px
// semibold title, with the same row height / hover highlight. The mark
// doubles as the completion toggle (todo ring ⇄ green done disc); clicking
// anywhere else on the row opens the detail modal.
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
      className="group flex items-center gap-2 min-h-[1.625rem] px-2 py-1 rounded-lg cursor-pointer select-none leading-[1.4] transition-colors hover:bg-foreground/[0.06]"
    >
      {/* Sequence id — mirrors the list's ELE-NNN. Hidden when unset. */}
      {subelement.seq_number != null && (
        <span className="shrink-0 text-[13px] tabular-nums text-muted-foreground/60">
          SUB-{String(subelement.seq_number).padStart(3, '0')}
        </span>
      )}

      {/* Circular status mark — same glyph the Elements list uses. Click to
          toggle completion (todo ring ⇄ green done disc) without opening
          the row. preventDefault on mousedown avoids a stray focus ring /
          text-selection on a mouse click. */}
      <button
        type="button"
        onClick={handleToggle}
        onMouseDown={(e) => e.preventDefault()}
        aria-label={subelement.is_completed ? 'Mark as todo' : 'Mark as done'}
        className="shrink-0 flex items-center rounded-full transition-opacity hover:opacity-80"
      >
        <ElementProgressMark status={subelement.is_completed ? 'done' : 'todo'} size={16} />
      </button>

      {/* Title — 13px semibold to match the list; muted + struck when done. */}
      <span
        className={`text-[13px] font-semibold truncate flex-1 min-w-0 ${
          subelement.is_completed ? 'text-muted-foreground line-through' : 'text-foreground'
        }`}
      >
        {subelement.title}
      </span>
    </div>
  );
}
