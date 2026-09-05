'use client';

import { FieldVisibility } from '@/alcon/property/FieldVisibility';
import { Button } from '@/ui/button';
import { useRef } from 'react';
import { Settings2, ArrowLeft, ArrowRight, Pencil, ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, EyeOff } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuItem } from '@/ui/dropdown-menu';
import { MenuShell } from '@/alcon/shared/menu';
import { Popover, PopoverTrigger } from '@/ui/popover';
import { type ColumnId, type ColumnSort, type DataColumn } from '@/alcon/object/useListColumns';
import { HEADER_DRAG_PREFIX } from './shared';

// Header cell for a single data column. The entire `<th>` is the drag
// surface for reorder (no grab cursor — dnd-kit's distance constraint
// keeps small clicks as clicks). Inside:
//   - a sort button (label + asc/desc arrow) that cycles the column's sort
//   - an overflow menu for `Hide column` (toggleable columns only)
//   - a resize handle on the right edge
// Resize and the menu's trigger stop pointer propagation so they don't
// accidentally start a header drag.
export function ColumnHeader({
  column, width, isDragging, sort, onResize, onToggleSort, onHide, onEdit, onMoveLeft, onMoveRight,
}: {
  column: DataColumn;
  width: number;
  isDragging: boolean;
  /** 'asc' | 'desc' when this column owns the active sort, else null. */
  sort: ColumnSort['direction'] | null;
  onResize: (width: number) => void;
  onToggleSort: () => void;
  /** Pass undefined for always-on columns (Type) to omit the Hide item. */
  onHide?: () => void;
  onEdit?: () => void;
  onMoveLeft?: () => void;
  onMoveRight?: () => void;
}) {
  const dragId = HEADER_DRAG_PREFIX + column.id;
  const {
    setNodeRef, attributes, listeners, transform, transition,
    // Don't animate layout changes — otherwise an unrelated re-render (e.g.
    // toggling a column's sort) makes dnd-kit transition the header's
    // transform, which reads as a visible stutter/jank. Active drag still
    // moves via `transform`; reordered columns just snap into place.
  } = useSortable({ id: dragId, animateLayoutChanges: () => false });
  const dragStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    // Same drag-perf treatment as the row components.
    transition: isDragging ? 'none' : transition,
    willChange: isDragging ? 'transform' : undefined,
    width,
    minWidth: width,
    maxWidth: width,
    opacity: isDragging ? 0.4 : undefined,
  };
  const SortIcon = sort === 'asc' ? ArrowUp : sort === 'desc' ? ArrowDown : ArrowUpDown;
  return (
    <th
      ref={setNodeRef}
      style={dragStyle}
      {...attributes}
      {...listeners}
      className="table-cell group/col relative px-1.5 py-2.5 text-left text-[11px] font-medium text-muted-foreground bg-card whitespace-nowrap select-none border-b border-border/60"
    >
      <div className="flex items-center gap-1 min-w-0">
        {/* Sort toggle — click cycles none → asc → desc → none. We do NOT
            stop pointerdown here: the label IS the column's drag surface,
            and the PointerSensor's 3px distance constraint already tells a
            click (→ sort) apart from a drag (→ reorder). Stopping pointerdown
            (as before) made the label un-draggable, so columns couldn't be
            reordered by grabbing their name. */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleSort(); }}
          title={
            sort === 'asc' ? `Sort by ${column.label} (asc) — click for desc` :
            sort === 'desc' ? `Sort by ${column.label} (desc) — click to clear` :
            `Sort by ${column.label}`
          }
          // px-1.5 mirrors the body trigger's inner padding (CELL_TRIGGER_BASE),
          // so the header text starts at the same x as the cell text below.
          // Without it the label sits 6px left of the body content.
          className="flex-1 min-w-0 flex items-center justify-start gap-1 px-1.5 text-left text-muted-foreground/80 hover:text-foreground transition-colors focus:outline-none"
        >
          <span className="truncate">{column.label}</span>
          <SortIcon
            size={11}
            className={`shrink-0 transition-opacity ${
              sort ? 'opacity-100 text-foreground' : 'opacity-0 group-hover/col:opacity-50'
            }`}
          />
        </button>
        {/* Overflow menu — opens on hover (or focus) to expose Hide for
            toggleable columns. Kept opacity-0 so it doesn't draw chrome
            on every header at rest. */}
        {onHide && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`${column.label} options`}
                // hidden (not opacity-0) so it doesn't reserve layout space —
                // otherwise tight columns truncate their label to make room
                // for an invisible button.
                className="shrink-0 w-5 h-4 inline-flex items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <ChevronDown size={12} />
              </button>
            </DropdownMenuTrigger>
            <MenuShell as="dropdown" align="end">
              {onEdit && <DropdownMenuItem onSelect={onEdit}><Pencil size={12} />Edit field</DropdownMenuItem>}
              <DropdownMenuItem disabled={!onMoveLeft} onSelect={onMoveLeft}><ArrowLeft size={12} />Move left</DropdownMenuItem>
              <DropdownMenuItem disabled={!onMoveRight} onSelect={onMoveRight}><ArrowRight size={12} />Move right</DropdownMenuItem>
              <DropdownMenuItem onSelect={onHide} className="gap-2">
                <EyeOff size={12} className="text-muted-foreground" />
                <span>Hide column</span>
              </DropdownMenuItem>
            </MenuShell>
          </DropdownMenu>
        )}
      </div>
      {/* Short centered vertical divider (30px) on the column's right edge. */}
      <span aria-hidden className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 h-[30px] w-px bg-border/60" />
      {/* Resize handle — absolute on the right edge, visible on hover.
          PointerDown captures the pointer and updates width on move; the
          stopPropagation keeps dnd-kit's drag from kicking in. */}
      <ResizeHandle width={width} onResize={onResize} />
    </th>
  );
}

export function ResizeHandle({
  width, onResize,
}: {
  width: number;
  onResize: (w: number) => void;
}) {
  const startRef = useRef<{ x: number; w: number } | null>(null);
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize column"
      tabIndex={0}
      aria-valuenow={width}
      aria-valuemin={0}
      aria-valuemax={1200}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault(); e.stopPropagation(); onResize(width + (e.key === 'ArrowRight' ? 16 : -16));
        }
      }}
      onPointerCancel={() => { startRef.current = null; }}
      // Wide transparent grab area for an easy target; the visible feedback
      // is a thin 1px gray line on the right edge (group-hover), so it reads
      // as a slim divider rather than a fat blue bar.
      className="group/resize absolute top-0 right-0 h-full w-2 -mr-1 cursor-col-resize"
      onPointerDown={(e) => {
        startRef.current = { x: e.clientX, w: width };
        e.currentTarget.setPointerCapture(e.pointerId);
        e.preventDefault();
        e.stopPropagation();
      }}
      onPointerMove={(e) => {
        if (!startRef.current) return;
        const next = startRef.current.w + (e.clientX - startRef.current.x);
        // Raw width — setWidth applies the right per-column min/max clamp
        // (the Name column has a higher floor than the data columns).
        onResize(next);
      }}
      onPointerUp={(e) => {
        if (!startRef.current) return;
        startRef.current = null;
        try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* fine */ }
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="absolute top-0 right-1 h-full w-px bg-muted-foreground/40 opacity-0 group-hover/resize:opacity-100 transition-opacity" />
    </div>
  );
}

// Column show/hide menu — trailing header "+" for lists that can't create a
// Property (no single scope: Domain Elements, My Elements). Toggles which
// built-in/custom columns are visible. Lists that CAN add a Property use a
// direct "+" instead (see the header cell above).
export function ColumnMenu({
  allColumns, isVisible, onToggle,
}: {
  allColumns: DataColumn[];
  isVisible: (id: ColumnId) => boolean;
  onToggle: (id: ColumnId) => void;
}) {
  return <Popover>
    <PopoverTrigger asChild><Button type="button" variant="ghost" size="icon-sm" aria-label="Configure fields" title="Configure fields"><Settings2 size={14} /></Button></PopoverTrigger>
    <MenuShell align="end" width="wide"><FieldVisibility columns={allColumns} isVisible={isVisible} onToggle={onToggle} /></MenuShell>
  </Popover>;
}
