'use client';

import { useMemo } from 'react';
import { Plus } from '@/ui/icons';
import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { BoardOrientation } from '@/Function/shared/boardOrientation';
import { ItemIcon } from '@/Function/shared/itemIcon/ItemIcon';
import { ObjectIcon } from '@/Function/shared/conceptIcons';
import { NavStrategyIcon } from '@/Frame/sidebar/NavIcons';
import { Chip } from '../element/board/BoardColumn';
import { ExecutionChain, emptyChain } from './ExecutionChain';
import { objectStatusOf } from './objectStatus';

// A Board of Objects: each Object a card, in the Status column its
// Elements put it in (objectStatusOf). The Domain's Board and a
// Strategy's draw it — one level above an Object's own Board, whose
// cards are its Elements. An Object's column is read, not set, so the
// cards do not drag: moving an Object is moving its work. A new Object
// has no work yet, so the "+" stands on Backlog, where it lands; it opens
// the same new-Object popup as everywhere else.

export interface BoardObject {
  id: string;
  name: string;
  icon?: string | null;
  color?: string | null;
}

export function ObjectBoard({ objects, elements, via, orientation, onOpenObject, onAdd, className }: {
  objects: BoardObject[];
  /** The Elements under these Objects; each counts toward its Object. */
  elements: readonly { object_id?: string | null; status?: string | null }[];
  /** Objects that came from a Strategy under the one shown, by id. */
  via?: ReadonlyMap<string, { name: string }>;
  orientation: BoardOrientation;
  onOpenObject?: (objectId: string) => void;
  /** Opens the new-Object popup. Absent: no "+". */
  onAdd?: () => void;
  className?: string;
}) {
  const { t } = useI18n();
  const columns = useMemo(() => {
    const byObject = new Map<string, (string | null | undefined)[]>();
    for (const e of elements) {
      if (!e.object_id) continue;
      byObject.set(e.object_id, [...(byObject.get(e.object_id) ?? []), e.status]);
    }
    const out = emptyChain<{ key: string; node: React.ReactNode }>();
    for (const o of objects) {
      const statuses = byObject.get(o.id) ?? [];
      const done = statuses.filter((s) => s === 'done').length;
      const from = via?.get(o.id)?.name;
      out[objectStatusOf(statuses)].push({
        key: o.id,
        node: (
          <button type="button" onClick={() => onOpenObject?.(o.id)}
            className="block w-full rounded-lg border border-border bg-card px-3.5 py-3.5 text-left shadow-[var(--shadow-card)] transition-colors hover:bg-[linear-gradient(color-mix(in_oklab,var(--foreground)_6%,transparent),color-mix(in_oklab,var(--foreground)_6%,transparent))] dark:bg-[var(--surface-rail)]">
            <span className="flex min-w-0 items-center gap-2">
              <ItemIcon icon={o.icon ?? null} color={o.color ?? null} size={14} fallback={<ObjectIcon size={14} />} />
              <span className="min-w-0 flex-1 truncate text-[14px] leading-[22px] text-foreground">{o.name}</span>
            </span>
            <span className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1">
              {from && (
                <Chip title={from} className="max-w-full">
                  <NavStrategyIcon size={11} className="shrink-0" />
                  <span className="truncate">{from}</span>
                </Chip>
              )}
              <Chip>{statuses.length === 0 ? t('No Elements') : t('{done}/{total} done', { done, total: statuses.length })}</Chip>
            </span>
          </button>
        ),
      });
    }
    return out;
  }, [objects, elements, via, onOpenObject, t]);

  return <ExecutionChain orientation={orientation} className={className} columns={columns}
    columnAction={onAdd ? (status) => (status === 'backlog' ? (
      <Button variant="ghost" size="icon-xs" type="button" title={t('Add Object')} aria-label={t('Add Object')} onClick={onAdd}>
        <Plus className="h-3.5 w-3.5" />
      </Button>
    ) : null) : undefined} />;
}
