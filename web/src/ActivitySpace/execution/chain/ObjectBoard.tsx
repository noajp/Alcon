'use client';

import { useMemo } from 'react';
import { Calendar, Plus } from '@/ui/icons';
import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { BoardOrientation } from '@/Function/shared/boardOrientation';
import { ItemIcon } from '@/Function/shared/itemIcon/ItemIcon';
import { ElementIcon, ObjectIcon } from '@/Function/shared/conceptIcons';
import { NavStrategyIcon } from '@/Frame/sidebar/NavIcons';
import { BOARD_CARD, CardDescription, CardMeta, Chip } from '../element/board/BoardColumn';
import { WorkerAvatar } from '@/Function/shared/WorkerAvatar';
import { formatElementDate, parseDateOnly } from '@/Function/shared/dateUtils';
import { useWorkersByIds } from '@/hooks/teamData';
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
  description?: string | null;
  type?: string | null;
  due_date?: string | null;
  lead_id?: string | null;
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
  const leadIds = useMemo(() => Array.from(new Set(objects.map((o) => o.lead_id).filter((id): id is string => !!id))), [objects]);
  const leads = useWorkersByIds(leadIds);
  const columns = useMemo(() => {
    const leadById = new Map(leads.map((w) => [w.id, w]));
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
      const lead = o.lead_id ? leadById.get(o.lead_id) : undefined;
      const due = o.due_date ? parseDateOnly(o.due_date) : null;
      out[objectStatusOf(statuses)].push({
        key: o.id,
        node: (
          <button type="button" onClick={() => onOpenObject?.(o.id)} className={`block w-full p-3 text-left ${BOARD_CARD}`}>
            <span className="flex min-w-0 items-center gap-2">
              <ItemIcon icon={o.icon ?? null} color={o.color ?? null} size={14} fallback={<ObjectIcon size={14} />} />
              <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium leading-5 text-foreground">{o.name}</span>
            </span>
            <CardDescription html={o.description} />
            {o.type && <span className="mt-2 flex min-w-0"><Chip className="max-w-full"><span className="truncate">{o.type}</span></Chip></span>}
            {/* Who leads it stands at the foot's left, then when it is due;
                how far its Elements have come stands at the right. */}
            <span className="mt-3 flex min-w-0 items-center gap-3 border-t border-[var(--border-subtle)] pt-2.5">
              {lead && <WorkerAvatar worker={lead} size={20} />}
              {due && <CardMeta icon={<Calendar size={12} />}>{formatElementDate(due)}</CardMeta>}
              {from && <CardMeta icon={<NavStrategyIcon size={12} />} title={from}>{from}</CardMeta>}
              <span className="ml-auto flex shrink-0">
                <CardMeta icon={<ElementIcon size={12} />}>
                  {statuses.length === 0 ? t('No Elements') : t('{done}/{total} done', { done, total: statuses.length })}
                </CardMeta>
              </span>
            </span>
          </button>
        ),
      });
    }
    return out;
  }, [objects, elements, via, leads, onOpenObject, t]);

  return <ExecutionChain orientation={orientation} className={className} columns={columns}
    columnAction={onAdd ? (status) => (status === 'backlog' ? (
      <Button variant="ghost" size="icon-xs" type="button" title={t('Add Object')} aria-label={t('Add Object')} onClick={onAdd}>
        <Plus className="h-3.5 w-3.5" />
      </Button>
    ) : null) : undefined} />;
}
