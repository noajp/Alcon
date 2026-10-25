'use client';

import { createContext, useCallback, useContext, useMemo, useState, useEffect, useRef } from 'react';
import { useEscapeLayer } from '@/Function/shared/keyboard';
import { createPortal } from 'react-dom';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { Button } from '@/ui/button';
import { WidgetPicker } from './WidgetPicker';
import { BoardPresence } from './BoardPresence';
import { useWidgetActionSlot } from './WidgetActionSlot';
import type { Board } from './useBoard';
import { ZONES, type WidgetHost, type Zone } from './types';

/** The droppable id a zone registers, so an empty zone is still a target. */
export function zoneDroppableId(zone: Zone): string {
  return `widget-zone:${zone}`;
}

// =============================================================
// Arrange mode — the board-wide state a long press turns on — and the drag
// context every zone shares.
//
// Both live above the zones rather than inside one, for the same reason: a
// surface has three zones and they are one board. The mode has to cover all
// of them, or it reads as "this one widget is loose" instead of "the board is
// editable"; and the DndContext has to cover all of them, or a widget could
// only ever be reordered inside the column it started in.
// =============================================================

interface BoardContextValue {
  board: Board;
  host: WidgetHost;
  arranging: boolean;
  setArranging: (next: boolean) => void;
}

const BoardContext = createContext<BoardContextValue | null>(null);

export function useBoardContext(): BoardContextValue {
  const ctx = useContext(BoardContext);
  if (!ctx) throw new Error('Widget zones must be rendered inside a <WidgetSurface>');
  return ctx;
}

export function WidgetSurface({
  board,
  host,
  zones,
  children,
  className = '',
}: {
  board: Board;
  host: WidgetHost;
  /** The zones this surface renders. The picker offers only widgets that fit
   *  one of them, so a rail widget cannot be added to a surface with no rail. */
  zones: Zone[];
  children: React.ReactNode;
  className?: string;
}) {
  const [arranging, setArrangingState] = useState(false);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const setArranging = useCallback((next: boolean) => setArrangingState(next), []);
  const actionSlot = useWidgetActionSlot();

  // Esc leaves arrange mode — and only that. DESIGN.md §8: Esc closes one
  // layer, so this yields to any layer above it: an open popover (the widget
  // picker is reachable from the chrome while arranging) owns the key, and
  // arrange mode is what the next Esc closes.
  useEscapeLayer(arranging, () => setArrangingState(false));

  useEffect(() => {
    if (!arranging) return;
    const dismiss = (event: PointerEvent) => {
      const widget = event.target instanceof Element ? event.target.closest('[data-widget]') : null;
      if (widget && surfaceRef.current?.contains(widget)) return;
      setArrangingState(false);
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, [arranging]);

  const value = useMemo(
    () => ({ board, host, arranging, setArranging }),
    [board, host, arranging, setArranging],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // One handler for every drag, because there is one operation: put this
  // widget in this zone at this index. Dropping on another widget means "take
  // its place"; dropping on a zone's own droppable (which is all an empty
  // zone has) means "go to the end of it".
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || board.loading || board.error) return;
    const id = String(active.id);
    const overId = String(over.id);
    if (id === overId) return;

    const zoneFromDroppable = ZONES.find((z) => zoneDroppableId(z) === overId);
    if (zoneFromDroppable) {
      board.moveWidget(id, zoneFromDroppable, board.layout[zoneFromDroppable].length);
      return;
    }

    const toZone = board.zoneOf(overId);
    if (!toZone) return;
    const items = board.layout[toZone];
    const overIndex = items.findIndex((w) => w.id === overId);
    if (overIndex === -1) return;
    // Within one zone the moved item is removed before it is re-inserted, so
    // the index it is dropped on is already the index it should land at.
    // Coming from another zone nothing is removed first, so dropping on the
    // item below means taking that item's slot.
    board.moveWidget(id, toZone, overIndex);
  }, [board]);

  const picker = (
    <WidgetPicker
      disabled={board.loading || !!board.error}
      subjectKind={host.subject.kind}
      availableZones={zones}
      placedTypes={board.placedTypes}
      arranging={arranging}
      onAdd={(zone, type) => board.addWidget(zone, type)}
      onArrange={() => setArrangingState(true)}
    />
  );

  // Who else is here sits beside the one +: the board is shared, and this is
  // where that shows.
  const chrome = (
    <div className="flex items-center gap-2">
      <BoardPresence subject={host.subject} />
      {picker}
    </div>
  );

  return (
    <BoardContext.Provider value={value}>
      {(board.loading || board.saving || board.error) && (
        <div role={board.error ? 'alert' : 'status'} className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
          {board.error ?? (board.loading ? 'Loading widgets…' : 'Saving layout…')}
          {board.error && <Button variant="ghost" size="sm" onClick={board.retry}>Reload</Button>}
        </div>
      )}
      {/* One + for the whole surface. A widget knows its own zone, so there
          is nothing to choose before choosing the widget. It renders in the
          chrome when a target is mounted, and in place when not. */}
      {actionSlot
        ? createPortal(chrome, actionSlot)
        : <div className="flex justify-end">{chrome}</div>}

      {/* Text selection is suppressed while arranging: a press-and-drag that
          started as a long press would otherwise paint a selection across the
          widget it is dragging. */}
      <div ref={surfaceRef} className={`${className} ${arranging ? 'select-none' : ''}`}>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          {children}
        </DndContext>
      </div>

    </BoardContext.Provider>
  );
}
