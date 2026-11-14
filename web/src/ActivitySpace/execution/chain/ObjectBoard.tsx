'use client';

import { useMemo, useState } from 'react';
import { Calendar, Plus, User } from '@/ui/icons';
import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { BoardOrientation } from '@/Function/shared/boardOrientation';
import { ItemIcon } from '@/Function/shared/itemIcon/ItemIcon';
import { ElementIcon, ObjectIcon } from '@/Function/shared/conceptIcons';
import { NavStrategyIcon } from '@/Frame/sidebar/NavIcons';
import { BOARD_CARD, CardDescription, CardMeta, Chip } from '../element/board/BoardColumn';
import { WorkerAvatar } from '@/Function/shared/WorkerAvatar';
import { formatElementDate, parseDateOnly, toDateOnlyString } from '@/Function/shared/dateUtils';
import { useWorkers, useWorkersByIds } from '@/hooks/teamData';
import { noticeObjectSaveFailed, setObjectFromCard } from '@/hooks/objectData';
import type { Worker } from '@/types/database';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, MenuCheck } from '@/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';
import { Calendar as CalendarPicker } from '@/ui/calendar';
import { getCachedWeekStartsOn, usePreference } from '@/Function/settings/preferencesStore';
import { workerTriggerLabel } from '@/Function/shared/workerReach';
import { ExecutionChain, emptyChain } from './ExecutionChain';
import { objectStatusOf } from './objectStatus';
import { useModelKeyCheck } from '@/Function/team/useModelKeyCheck';
import { ModelKeyRow } from '@/Function/team/ModelKeyRow';

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
  const { data: workers } = useWorkers();
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
      out[objectStatusOf(statuses)].push({
        key: o.id,
        node: <ObjectCard object={o} lead={lead} workers={workers} from={from}
          total={statuses.length} done={done} onOpen={onOpenObject} />,
      });
    }
    return out;
  }, [objects, elements, via, leads, workers, onOpenObject]);

  return <ExecutionChain orientation={orientation} className={className} columns={columns}
    columnAction={onAdd ? (status) => (status === 'backlog' ? (
      <Button variant="ghost" size="icon-xs" type="button" title={t('Add Object')} aria-label={t('Add Object')} onClick={onAdd}>
        <Plus className="h-3.5 w-3.5" />
      </Button>
    ) : null) : undefined} />;
}

/** One Object on the board. The card opens the Object; its Lead and its due
 *  date are set in place, from the foot — the same two gestures an Element
 *  card gives its assignee and date. */
function ObjectCard({ object: o, lead, workers, from, total, done, onOpen }: {
  object: BoardObject;
  lead: Worker | undefined;
  workers: readonly Worker[];
  /** The Strategy under the one shown that this Object came by. */
  from: string | undefined;
  total: number;
  done: number;
  onOpen?: (objectId: string) => void;
}) {
  const { t } = useI18n();
  const weekStartsOn = usePreference(getCachedWeekStartsOn);
  const keyMissing = useModelKeyCheck();
  // What was just set here shows at once; the board's own data catches up.
  const [set, setSet] = useState<{ lead_id?: string | null; due_date?: string | null }>({});
  const [dateOpen, setDateOpen] = useState(false);
  const leadId = 'lead_id' in set ? set.lead_id : o.lead_id;
  const dueText = 'due_date' in set ? set.due_date : o.due_date;
  const shownLead = leadId ? (workers.find((w) => w.id === leadId) ?? (lead?.id === leadId ? lead : undefined)) : undefined;
  const due = dueText ? parseDateOnly(dueText) : null;
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  const save = async (updates: { lead_id?: string | null; due_date?: string | null }) => {
    const before = set;
    setSet({ ...set, ...updates });
    try { await setObjectFromCard(o.id, updates); }
    catch (error) { setSet(before); noticeObjectSaveFailed(error); }
  };

  return (
    // The card opens from anywhere a pointer lands; the keyboard opens it
    // from its name, and its pickers stay controls of their own.
    <div onClick={() => onOpen?.(o.id)}
      className={`group/card block w-full cursor-pointer p-3 text-left ${BOARD_CARD}`}>
      <span className="flex min-w-0 items-center gap-2">
        <ItemIcon icon={o.icon ?? null} color={o.color ?? null} size={14} fallback={<ObjectIcon size={14} />} />
        <button type="button" onClick={(e) => { e.stopPropagation(); onOpen?.(o.id); }}
          className="min-w-0 flex-1 truncate text-left text-[13.5px] font-medium leading-5 text-foreground">{o.name}</button>
      </span>
      <CardDescription html={o.description} />
      {o.type && <span className="mt-2 flex min-w-0"><Chip className="max-w-full"><span className="truncate">{o.type}</span></Chip></span>}
      {/* Who leads it stands at the foot's left, then when it is due;
          how far its Elements have come stands at the right. */}
      <span className="mt-3 flex min-w-0 items-center gap-2.5 border-t border-[var(--border-subtle)] pt-2.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" onClick={stop} title={t('Object lead')} aria-label={workerTriggerLabel(t('Object lead'), shownLead)}
              className="inline-flex shrink-0 items-center justify-center rounded-full transition-shadow hover:ring-2 hover:ring-border/60">
              {shownLead ? <WorkerAvatar worker={shownLead} size={20} /> : (
                <span className="inline-flex size-5 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground">
                  <User className="size-3" />
                </span>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-[260px] min-w-[200px] overflow-y-auto" onClick={stop}>
            {workers.map((w) => leadId !== w.id && keyMissing(w) ? <ModelKeyRow key={w.id} worker={w} /> : (
              <DropdownMenuItem key={w.id} onSelect={() => { void save({ lead_id: w.id }); }} className="gap-2 text-[12px]">
                <WorkerAvatar worker={w} size={16} />
                <span className="flex-1 truncate">{w.name}</span>
                {leadId === w.id && <MenuCheck />}
              </DropdownMenuItem>
            ))}
            {leadId && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => { void save({ lead_id: null }); }} className="text-[12px] text-muted-foreground">{t('Clear')}</DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <Popover open={dateOpen} onOpenChange={setDateOpen}>
          <PopoverTrigger asChild>
            {/* Unset, the date shows only while the card is hovered or focused. */}
            <button type="button" onClick={stop}
              className={`-mx-1 items-center rounded px-1 transition-colors hover:bg-muted/40 ${due ? 'flex' : 'hidden opacity-60 group-hover/card:flex group-focus-within/card:flex data-[state=open]:flex'}`}>
              <CardMeta icon={<Calendar size={12} />}>{due ? formatElementDate(due) : t('Date')}</CardMeta>
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto rounded-lg p-0" align="start" onClick={stop}>
            <CalendarPicker mode="single" selected={due ?? undefined} autoFocus weekStartsOn={weekStartsOn}
              onSelect={(d) => { void save({ due_date: d ? toDateOnlyString(d) : null }); setDateOpen(false); }} />
          </PopoverContent>
        </Popover>
        {from && <CardMeta icon={<NavStrategyIcon size={12} />} title={from}>{from}</CardMeta>}
        <span className="ml-auto flex shrink-0">
          <CardMeta icon={<ElementIcon size={12} />}>
            {total === 0 ? t('No Elements') : t('{done}/{total} done', { done, total })}
          </CardMeta>
        </span>
      </span>
    </div>
  );
}
