'use client';

import { Button } from '@/ui/button';

import React, { useEffect, useMemo, useState } from 'react';
import type { ElementWithDetails } from '@/hooks/useSupabase';
import { updateElement, createElement, useElementCommentActivity, withCommentActivity } from '@/hooks/useSupabase';
import { Skeleton } from '@/ui/skeleton';
import { Plus } from '@/ui/icons';
import { cn } from '@/lib/utils';
import { ElementProgressMark } from '@/Function/shared/ElementProgressMark';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { STATUS, STATUS_ORDER } from '@/shared/designTokens';
import { ElementCard } from './ElementCard';

type ElementStatus = (typeof STATUS_ORDER)[number];

// One column per status, in the app's status order (designTokens), so the
// board, the status menu and every grouped list read the same way.
const COLUMNS: { status: ElementStatus; label: string }[] = STATUS_ORDER.map((status) => ({ status, label: STATUS[status].label }));

interface ElementBoardViewProps {
  elements: ElementWithDetails[];
  loading?: boolean;
  onRefresh?: () => void;
  /** Open an Element's detail. Without it a card is edit-in-place only. */
  onElementClick?: (element: ElementWithDetails) => void;
  /** Object the column "+" should create the new Element under. When
   *  omitted the new Element is Domain-direct (Domain board and the
   *  sidebar Elements view). */
  objectId?: string | null;
  /** Show the column "+". Hosts turn it off while a filter is active, since
   *  an Element made there could be filtered out of sight at once. */
  canAdd?: boolean;
}

export function ElementBoardView({ elements, loading = false, onRefresh, objectId, onElementClick, canAdd = true }: ElementBoardViewProps) {
  const { t } = useI18n();
  const [items, setItems] = useState<ElementWithDetails[]>(elements);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // One aggregated fetch for the whole board, hung on the Elements the same
  // way the list does it, so a card and a row cannot disagree about what
  // "active" means.
  const elementIds = useMemo(() => elements.map((el) => el.id), [elements]);
  const activity = useElementCommentActivity(elementIds);

  useEffect(() => { setItems(elements); }, [elements]);

  const groups = useMemo(() => {
    const m = new Map<ElementStatus, ElementWithDetails[]>();
    for (const col of COLUMNS) m.set(col.status, []);
    for (const el of withCommentActivity(items, activity)) {
      const status = (el.status ?? 'todo') as ElementStatus;
      const bucket = m.get(status) ?? m.get('todo')!;
      bucket.push(el);
    }
    return m;
  }, [items, activity]);

  const handleDrop = (status: ElementStatus) => async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/id');
    if (!id) return;
    setDraggingId(null);
    setItems((prev) => prev.map((el) => el.id === id ? { ...el, status } : el));
    try {
      await updateElement(id, { status });
      onRefresh?.();
    } catch (err) {
      console.error('Failed to update element status', err);
    }
  };

  if (loading) {
    return (
      <div className="flex gap-3 p-4 h-full">
        {COLUMNS.map((col) => (
          <div key={col.status} className="w-72 flex-shrink-0 rounded-lg bg-muted/60 dark:bg-muted/30">
            <div className="px-3 py-2.5 border-b border-border/40">
              <Skeleton className="h-4 w-20" />
            </div>
            <div className="p-2 space-y-2">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-lg" />)}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex gap-3 p-4 h-full overflow-x-auto overflow-y-hidden">
      {COLUMNS.map((col) => {
        const colItems = groups.get(col.status) ?? [];
        return (
          <div
            key={col.status}
            className="w-72 flex-shrink-0 flex flex-col rounded-lg bg-muted/60 dark:bg-muted/30"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop(col.status)}
          >
            {/* Column header */}
            <div className="flex h-10 items-center justify-between px-3">
              <div className="flex items-center gap-2">
                <ElementProgressMark status={col.status} size={14} />
                <span className="text-[13px] font-medium">{t(col.label)}</span>
                <span className="text-[12px] tabular-nums text-muted-foreground">{colItems.length}</span>
              </div>
              {canAdd && <Button variant="ghost" size="icon-xs"
                type="button"
                onClick={async () => {
                  try {
                    await createElement({
                      title: t('Untitled'),
                      status: col.status,
                      object_id: objectId ?? null,
                    });
                    onRefresh?.();
                  } catch (err) {
                    console.error('Failed to create element', err);
                  }
                }}
                title={t('Add Element to {column}', { column: t(col.label) })}
                aria-label={t('Add Element to {column}', { column: t(col.label) })}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>}
            </div>

            {/* Cards */}
            <div className="flex-1 overflow-y-auto px-1.5 pb-1.5 space-y-1.5 min-h-[80px]">
              {colItems.map((el) => (
                <div
                  key={el.id}
                  className={cn(
                    'transition-opacity',
                    draggingId === el.id ? 'opacity-40' : '',
                  )}
                  onDragStart={() => setDraggingId(el.id)}
                  onDragEnd={() => setDraggingId(null)}
                >
                  <ElementCard
                    element={el}
                    onRefresh={onRefresh}
                    onOpen={onElementClick}
                  />
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
