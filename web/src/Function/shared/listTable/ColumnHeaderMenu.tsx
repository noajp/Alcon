'use client';

import { FieldVisibility } from '@/Function/property/FieldVisibility';
import { Button } from '@/ui/button';
import { useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Pencil, ArrowDown, ArrowUp, EyeOff, Plus, X } from '@/ui/icons';
import { useSortable } from '@dnd-kit/sortable';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuItem, MenuCheck } from '@/ui/dropdown-menu';
import { MenuShell, MENU_ROW, MENU_SEPARATOR } from '@/Function/shared/menu';
import { Popover, PopoverTrigger } from '@/ui/popover';
import { type ColumnId, type ColumnSort, type DataColumn } from '@/Function/shared/listTable/useListColumns';
import { HEADER_DRAG_PREFIX } from './shared';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { fieldDisplayLabel } from '@/Function/property/fieldModel';

// A data column's header, as in Asana: the name is a button that opens the
// column's menu (sort, move, edit, hide), and the whole cell is what you
// grab to move the column. A drag never moves the header itself — the
// table draws a floating label under the pointer and a line where the
// column will land, so the columns stay still while you aim. The right edge
// resizes.
export function ColumnHeader({
  column, width, inset = 0, isDragging, dropEdge, sort, onResize, onResizeStart, onSort, onHide, onEdit, onMoveLeft, onMoveRight,
}: {
  column: DataColumn;
  width: number;
  /** Drawn width that is not the saved width (the sort arrow's room). */
  inset?: number;
  isDragging: boolean;
  /** Where a column being dragged would land against this one. */
  dropEdge: 'before' | 'after' | null;
  /** 'asc' | 'desc' when this column owns the active sort, else null. */
  sort: ColumnSort['direction'] | null;
  onResize: (width: number) => void;
  onResizeStart?: () => void;
  onSort: (direction: ColumnSort['direction'] | null) => void;
  /** Pass undefined for always-on columns to omit the Hide item. */
  onHide?: () => void;
  onEdit?: () => void;
  onMoveLeft?: () => void;
  onMoveRight?: () => void;
}) {
  const { t } = useI18n();
  // Built-in column names are English keys; a Property's name is the user's own.
  const label = fieldDisplayLabel(t, column);
  const end = column.align === 'end';
  const { setNodeRef, attributes, listeners } = useSortable({ id: HEADER_DRAG_PREFIX + column.id, animateLayoutChanges: () => false });
  const [open, setOpen] = useState(false);
  // The menu opens on click, not on press: a press may be the start of a
  // drag, and a press that travelled is not a click.
  const downAt = useRef<{ x: number; y: number } | null>(null);
  const SortIcon = sort === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th
      ref={setNodeRef}
      style={{ width, minWidth: width, maxWidth: width }}
      {...attributes}
      {...listeners}
      className={`table-cell group/col relative ${end ? 'px-0.5' : 'px-1'} py-1.5 text-left text-[13px] font-normal text-muted-foreground bg-card whitespace-nowrap select-none transition-opacity ${isDragging ? 'opacity-40' : ''}`}
    >
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            onPointerDown={(e) => { downAt.current = { x: e.clientX, y: e.clientY }; e.preventDefault(); }}
            onClick={(e) => {
              e.stopPropagation();
              const d = downAt.current;
              downAt.current = null;
              if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 3) return;
              setOpen(true);
            }}
            title={label}
            // The name starts (or, flush right, ends) at the x of the cell
            // text below: th px-1 + px-2 = the cells' 12px; a flush-right
            // column's th px-0.5 + px-1 = its cells' 6px.
            className={`flex h-7 w-full min-w-0 items-center gap-1 rounded-md text-muted-foreground/90 transition-colors hover:bg-[var(--surface-strong)] hover:text-foreground focus:outline-none focus-visible:bg-[var(--surface-strong)] data-[state=open]:bg-[var(--surface-strong)] data-[state=open]:text-foreground ${end ? 'justify-end px-1' : 'justify-start px-2'}`}
          >
            <span className="truncate">{label}</span>
            {sort && <SortIcon size={12} className="shrink-0 text-foreground" />}
          </button>
        </DropdownMenuTrigger>
        <MenuShell as="dropdown" align={end ? 'end' : 'start'} onCloseAutoFocus={(e) => e.preventDefault()}>
          <DropdownMenuItem onSelect={() => onSort('asc')}>
            <ArrowUp size={14} />
            <span className="flex-1">{t('Sort ascending')}</span>
            {sort === 'asc' && <MenuCheck />}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onSort('desc')}>
            <ArrowDown size={14} />
            <span className="flex-1">{t('Sort descending')}</span>
            {sort === 'desc' && <MenuCheck />}
          </DropdownMenuItem>
          {sort && (
            <DropdownMenuItem onSelect={() => onSort(null)}>
              <X size={14} />{t('Clear sort')}
            </DropdownMenuItem>
          )}
          <div className={MENU_SEPARATOR} />
          <DropdownMenuItem disabled={!onMoveLeft} onSelect={onMoveLeft}><ArrowLeft size={14} />{t('Move left')}</DropdownMenuItem>
          <DropdownMenuItem disabled={!onMoveRight} onSelect={onMoveRight}><ArrowRight size={14} />{t('Move right')}</DropdownMenuItem>
          {(onEdit || onHide) && <div className={MENU_SEPARATOR} />}
          {onEdit && <DropdownMenuItem onSelect={onEdit}><Pencil size={14} />{t('Edit field')}</DropdownMenuItem>}
          {onHide && <DropdownMenuItem onSelect={onHide}><EyeOff size={14} />{t('Hide column')}</DropdownMenuItem>}
        </MenuShell>
      </DropdownMenu>
      {dropEdge && (
        <span aria-hidden className={`pointer-events-none absolute inset-y-1 z-20 w-0.5 rounded-full bg-[var(--accent-default)] ${dropEdge === 'before' ? '-left-px' : '-right-px'}`} />
      )}
      <ResizeHandle width={width - inset} inset={inset} onResize={onResize} onResizeStart={onResizeStart} />
    </th>
  );
}

/** The column's right edge. Dragging it changes this column's width and
 *  nothing else: the columns to its left stay where they are (the table
 *  freezes the Name width first — see ListTable), so the edge follows the
 *  pointer. */
export function ResizeHandle({
  width, inset = 0, startWidth, onResize, onResizeStart,
}: {
  width: number;
  /** Header width that is not this column's (the sort arrow's room). */
  inset?: number;
  /** The drawn width at the start of a drag, when the header cell is not
   *  the whole column (Name spans two tracks and two header cells). */
  startWidth?: () => number;
  onResize: (w: number) => void;
  onResizeStart?: () => void;
}) {
  const { t } = useI18n();
  const startRef = useRef<{ x: number; w: number } | null>(null);
  const [active, setActive] = useState(false);
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t('Resize column')}
      tabIndex={0}
      aria-valuenow={width}
      aria-valuemin={0}
      aria-valuemax={1200}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault(); e.stopPropagation(); onResizeStart?.(); onResize(width + (e.key === 'ArrowRight' ? 16 : -16));
        }
      }}
      onPointerCancel={() => { startRef.current = null; setActive(false); }}
      onLostPointerCapture={() => { startRef.current = null; setActive(false); }}
      // A wide transparent grab area centred on the edge; the visible
      // feedback is the hairline in the middle, accent while dragging.
      className="group/resize absolute top-0 -right-1.5 z-30 h-full w-3 touch-none cursor-col-resize"
      onPointerDown={(e) => {
        const header = e.currentTarget.closest('th');
        onResizeStart?.();
        startRef.current = { x: e.clientX, w: startWidth ? startWidth() : header ? header.getBoundingClientRect().width - inset : width };
        setActive(true);
        e.currentTarget.setPointerCapture(e.pointerId);
        e.preventDefault();
        e.stopPropagation();
      }}
      onPointerMove={(e) => {
        if (!startRef.current) return;
        // Raw width — setWidth applies the per-column min/max clamp.
        onResize(startRef.current.w + (e.clientX - startRef.current.x));
      }}
      onPointerUp={(e) => {
        if (!startRef.current) return;
        startRef.current = null;
        setActive(false);
        try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* fine */ }
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <span className={`absolute inset-y-1.5 left-1/2 w-px -translate-x-1/2 transition-colors ${active ? 'bg-[var(--accent-default)]' : 'bg-transparent group-hover/resize:bg-[var(--border-strong)]'}`} />
    </div>
  );
}

/** The trailing "+" of the header: which fields show as columns (a switch
 *  each, searchable), and — where the list has a scope to create one in —
 *  a new field. */
export function FieldsMenu({
  allColumns, isVisible, onToggle, onCreate,
}: {
  allColumns: DataColumn[];
  isVisible: (id: ColumnId) => boolean;
  onToggle: (id: ColumnId) => void;
  onCreate?: (anchor?: DOMRect) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button ref={triggerRef} type="button" variant="ghost" size="icon-sm" aria-label={t('Fields')} title={t('Fields')}><Plus size={14} /></Button>
    </PopoverTrigger>
    <MenuShell align="end" width="wide">
      <FieldVisibility columns={allColumns} isVisible={isVisible} onToggle={onToggle} />
      {onCreate && <>
        <div className={MENU_SEPARATOR} />
        <button type="button" className={`${MENU_ROW} text-muted-foreground hover:text-foreground`}
          onClick={() => { setOpen(false); onCreate(triggerRef.current?.getBoundingClientRect()); }}>
          <Plus size={14} />{t('Create field')}
        </button>
      </>}
    </MenuShell>
  </Popover>;
}
