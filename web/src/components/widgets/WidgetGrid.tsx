'use client';

import { useState } from 'react';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Settings2, Check } from 'lucide-react';
import { WidgetCard } from './WidgetCard';
import { WidgetAddMenu } from './WidgetAddMenu';
import { useWidgetLayout } from './useWidgetLayout';
import { WIDGET_REGISTRY, getAvailableWidgetsForScope } from './registry';
import type { WidgetConfig, WidgetSpan } from './types';

interface WidgetGridProps {
  scope: 'home' | 'object-summary' | 'overview';
  layoutKey: string;
  defaults: WidgetConfig[];
  /** Render the widget body for a given widget config */
  renderWidget: (widget: WidgetConfig) => React.ReactNode;
  /** Set which widget types render as "bare" (no card chrome) */
  bareTypes?: string[];
}

export function WidgetGrid({
  scope,
  layoutKey,
  defaults,
  renderWidget,
  bareTypes = [],
}: WidgetGridProps) {
  const { widgets, addWidget, removeWidget, reorderWidgets, setSpan, reset } =
    useWidgetLayout(layoutKey, defaults);
  const [isEditMode, setIsEditMode] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    reorderWidgets(active.id as string, over.id as string);
  };

  const usedTypes = new Set(widgets.map((w) => w.type));
  const availableToAdd = getAvailableWidgetsForScope(scope).filter(
    (def) => !usedTypes.has(def.type) || def.defaultSpan === 'half', // allow re-adding non-singleton widgets
  );

  return (
    <div className="space-y-4">
      {/* Edit toolbar */}
      <div className="flex items-center justify-end gap-2">
        {isEditMode && (
          <>
            <WidgetAddMenu
              available={availableToAdd}
              onAdd={(type) => addWidget(type)}
            />
            <button
              onClick={reset}
              className="text-[12px] text-muted-foreground hover:text-foreground transition-colors px-2 py-1"
            >
              Reset
            </button>
          </>
        )}
        <button
          onClick={() => setIsEditMode((v) => !v)}
          className={`inline-flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1 rounded-md transition-colors ${
            isEditMode
              ? 'bg-foreground text-background'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted'
          }`}
        >
          {isEditMode ? <Check size={12} /> : <Settings2 size={12} />}
          {isEditMode ? 'Done' : 'Customize'}
        </button>
      </div>

      {/* Sortable grid */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={widgets.map((w) => w.id)} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {widgets.map((widget) => {
              const def = WIDGET_REGISTRY[widget.type];
              const span: WidgetSpan = widget.span ?? def?.defaultSpan ?? 'half';
              return (
                <SortableWidget
                  key={widget.id}
                  widget={widget}
                  span={span}
                  title={def?.label}
                  isEditMode={isEditMode}
                  bare={bareTypes.includes(widget.type)}
                  onRemove={() => removeWidget(widget.id)}
                  onToggleSpan={() => setSpan(widget.id, span === 'full' ? 'half' : 'full')}
                >
                  {renderWidget(widget)}
                </SortableWidget>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>

      {widgets.length === 0 && (
        <div className="text-center py-16 text-sm text-muted-foreground">
          <p>No widgets yet.</p>
          <button
            onClick={reset}
            className="mt-2 text-foreground underline hover:no-underline"
          >
            Restore defaults
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Sortable wrapper ──────────────────────────────────────
function SortableWidget({
  widget,
  span,
  title,
  isEditMode,
  bare,
  onRemove,
  onToggleSpan,
  children,
}: {
  widget: WidgetConfig;
  span: WidgetSpan;
  title?: string;
  isEditMode: boolean;
  bare: boolean;
  onRemove: () => void;
  onToggleSpan: () => void;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: widget.id,
    disabled: !isEditMode,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const dragHandleProps = { ...attributes, ...listeners } as React.HTMLAttributes<HTMLButtonElement>;

  return (
    <div ref={setNodeRef} style={style} className={span === 'full' ? 'lg:col-span-2' : 'lg:col-span-1'}>
      <WidgetCard
        title={title}
        span={span}
        isDragging={isDragging}
        isEditMode={isEditMode}
        dragHandleProps={dragHandleProps}
        onRemove={onRemove}
        onToggleSpan={onToggleSpan}
        bare={bare}
      >
        {children}
      </WidgetCard>
    </div>
  );
}
