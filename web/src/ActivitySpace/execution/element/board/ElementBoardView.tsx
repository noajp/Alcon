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
import { BoardColumn, WaitingChip } from './BoardColumn';
import { useLatestRunStatuses } from '@/hooks/elementRunData';
import { waitsOnPerson } from '../../chain/waiting';

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
  /** The Objects the Elements belong to, so each card can name its own
   *  (a Domain's board spans several; an Object's needs none). */
  objects?: { id: string; name: string; icon?: string | null; color?: string | null }[];
}

export function ElementBoardView({ elements, loading = false, onRefresh, objectId, onElementClick, canAdd = true, objects }: ElementBoardViewProps) {
  const { t } = useI18n();
  const [items, setItems] = useState<ElementWithDetails[]>(elements);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // One aggregated fetch for the whole board, hung on the Elements the same
  // way the list does it, so a card and a row cannot disagree about what
  // "active" means.
  const elementIds = useMemo(() => elements.map((el) => el.id), [elements]);
  const activity = useElementCommentActivity(elementIds);
  // Each card's latest AI run, for whether it waits on a person.
  const { data: runs } = useLatestRunStatuses(elementIds);

  useEffect(() => { setItems(elements); }, [elements]);
  const objectById = useMemo(() => new Map((objects ?? []).map((o) => [o.id, o])), [objects]);

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
          <BoardColumn
            key={col.status}
            mark={<ElementProgressMark status={col.status} size={14} />}
            label={t(col.label)}
            count={colItems.length}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop(col.status)}
            action={canAdd ? (
              <Button variant="ghost" size="icon-xs"
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
              </Button>
            ) : undefined}
          >
            {colItems.map((el) => (
              <div
                key={el.id}
                className={cn('transition-opacity', draggingId === el.id ? 'opacity-40' : '')}
                onDragStart={() => setDraggingId(el.id)}
                onDragEnd={() => setDraggingId(null)}
              >
                <ElementCard element={el} onRefresh={onRefresh} onOpen={onElementClick}
                  object={el.object_id ? objectById.get(el.object_id) ?? null : null}
                  badge={waitsOnPerson(el, runs[el.id] ?? null) ? <WaitingChip /> : undefined} />
              </div>
            ))}
          </BoardColumn>
        );
      })}
    </div>
  );
}
