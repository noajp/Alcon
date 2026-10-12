'use client';

import { Suspense, useMemo, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useBoardContext, zoneDroppableId } from './BoardContext';
import { ConfirmDialog } from '@/Function/shared/ConfirmDialog';
import { WidgetFrame } from './WidgetFrame';
import { WIDGET_COMPONENTS, WIDGET_REGISTRY } from './registry';
import { ZONE_VARIANT, type WidgetInstance, type WidgetParams, type Zone } from './types';

/** Shared so a widget without configuration gets one stable object. */
const EMPTY_PARAMS: WidgetParams = {};

// =============================================================
// WidgetZone — one insertion area on a surface.
//
// A surface places its zones itself, inside its own fixed skeleton (title,
// description, the two-column shell). Widgets are additive: they never own
// the layout. This is the line that keeps every screen from degenerating
// into the same tile dashboard — which is exactly why Object Overview threw
// the previous widget grid out.
//
// The DndContext is NOT here; it wraps the whole surface (see BoardContext)
// so a widget can be dragged from the main column into the rail. A zone is
// one sortable list inside that, plus a droppable of its own so an empty
// zone is still a place a drag can land.
// =============================================================

export function WidgetZone({
  zone,
  columns = 1,
  className = '',
}: {
  zone: Zone;
  /** `main` is two columns on the surfaces that want a dashboard; 1 elsewhere. */
  columns?: 1 | 2;
  className?: string;
}) {
  const { board, arranging } = useBoardContext();
  const items = board.layout[zone];

  const { setNodeRef, isOver } = useDroppable({ id: zoneDroppableId(zone), data: { zone } });

  const gapClass = zone === 'rail' ? 'space-y-4' : zone === 'band' ? 'space-y-2' : 'space-y-6';

  // Empty and idle, a zone takes no space at all — the + that fills it lives
  // on the surface. While arranging it becomes a visible drop target, so a
  // widget can be carried into a zone that has nothing in it yet.
  if (items.length === 0 && !arranging) return null;

  return (
    <div ref={setNodeRef} className={className}>
      <SortableContext
        items={items.map((w) => w.id)}
        strategy={columns === 2 ? rectSortingStrategy : verticalListSortingStrategy}
      >
        <div className={columns === 2 ? 'grid grid-cols-1 lg:grid-cols-2 gap-4' : gapClass}>
          {items.map((instance) => (
            <SortableWidget
              key={instance.id}
              instance={instance}
              zone={zone}
              columns={columns}
            />
          ))}
        </div>
      </SortableContext>

      {items.length === 0 && (
        <div
          className={`rounded-lg border border-dashed px-3 py-4 text-center text-[11px] transition-colors ${
            isOver
              ? 'border-[var(--accent-default)] text-[var(--accent-default)]'
              : 'border-[var(--border-strong)] text-muted-foreground'
          }`}
        >
          Drop a widget here
        </div>
      )}
    </div>
  );
}

// ─── One placed widget ───────────────────────────────────────
function SortableWidget({
  instance,
  zone,
  columns,
}: {
  instance: WidgetInstance;
  zone: Zone;
  columns: 1 | 2;
}) {
  const { board, host, arranging, setArranging } = useBoardContext();
  const def = WIDGET_REGISTRY[instance.type];
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: instance.id,
    data: { zone },
    disabled: !arranging,
  });

  // Normalised on read rather than on write: a board saved by another build
  // can name a dimension this one has dropped, and the definition is the only
  // thing that knows what to fall back to.
  //
  // Memoised because it builds a fresh object — a figure keys its own
  // `useMemo` on the params it was handed, so a new identity every render
  // means recomputing the whole layout on every parent render. Above the
  // guard below, because a hook cannot sit after a return.
  const params = useMemo(
    () => def?.normalizeParams?.(instance.params) ?? EMPTY_PARAMS,
    [def, instance.params],
  );

  // Placed here from an origin this person cannot see. The board is theirs to
  // arrange, so the place is shown and can be moved. The widget is not theirs:
  // nothing about it is shown, and taking it off the board is left to someone
  // who can see it — its author could not find it again otherwise.
  if (instance.hidden) {
    return (
      <div
        ref={setNodeRef}
        style={{ transform: CSS.Transform.toString(transform), transition }}
        {...(arranging ? { ...attributes, ...listeners } : {})}
      >
        <WidgetFrame
          variant={ZONE_VARIANT[zone]}
          title="Private widget"
          arranging={arranging}
          isDragging={isDragging}
          onLongPress={() => setArranging(true)}
        >
          <p className="text-xs text-muted-foreground">You don’t have access to this widget.</p>
        </WidgetFrame>
      </div>
    );
  }

  // A layout can outlive the widget it names (a build that removed one, a
  // board written by another client). `layoutFromRows` drops those on read; this is
  // the belt to that braces.
  if (!def) return null;

  const Body = WIDGET_COMPONENTS[instance.type];
  const size = instance.size ?? def.defaultSize ?? 'half';
  const spanClass = columns === 2 && size === 'full' ? 'lg:col-span-2' : '';

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={spanClass}
      {...(arranging ? { ...attributes, ...listeners } : {})}
    >
      <WidgetFrame
        variant={ZONE_VARIANT[zone]}
        title={typeof params.title === 'string' && params.title.trim() ? params.title : def.label}
        padded={def.padded ?? true}
        arranging={arranging}
        isDragging={isDragging}
        onLongPress={() => setArranging(true)}
        onRemove={() => (def.holdsContents ? setConfirmingRemove(true) : board.removeWidget(instance.id))}
      >
        <Suspense fallback={<div className="h-16 rounded-md bg-muted/30 animate-pulse" />}>
          <Body
            key={`${host.subject.kind}:${host.subject.id ?? 'me'}:${String(params.tableId ?? '')}`}
            host={host}
            instanceId={instance.widgetId ?? instance.id}
            params={params}
            setParams={(next) => board.setParams(instance.id, next)}
          />
        </Suspense>
      </WidgetFrame>
      <ConfirmDialog
        open={confirmingRemove}
        title={`Remove ${def.label}?`}
        description="This deletes the widget and what it holds for everyone who can see it."
        confirmLabel="Remove"
        onConfirm={() => { setConfirmingRemove(false); board.removeWidget(instance.id); }}
        onCancel={() => setConfirmingRemove(false)}
      />
    </div>
  );
}
