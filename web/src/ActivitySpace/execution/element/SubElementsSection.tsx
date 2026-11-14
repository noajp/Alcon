'use client';

import { Calendar as CalendarIcon, UserRound } from '@/ui/icons';
import { FoldSection, FoldSectionAddRow } from '@/Function/shared/FoldSection';
import { ElementProgressMark } from '@/Function/shared/ElementProgressMark';
import { DatePopover } from '@/Function/shared/date';
import { WorkerAvatar } from '@/Function/shared/WorkerAvatar';
import { formatDateShort } from '@/Function/shared/listTable/shared';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, MenuCheck } from '@/ui/dropdown-menu';
import { STATUS, STATUS_ORDER } from '@/shared/designTokens';
import {
  addElementAssignee, createSubElement, noticeElementSaveFailed, removeElementAssignee, updateElement,
  useAssignableWorkers, useSubElements, type SubElement, type Worker,
} from '@/hooks/useSupabase';
import type { Element } from '@/types/database';

// An Element's Sub-elements — Elements with it as their parent, each with a
// page of its own (the row opens it). A row reads like an Elements list row:
// its status mark (a menu of the statuses), the title, then its due date and
// assignee, each set in place. The grey line under them takes a title and
// Enter.
export function SubElementsSection({ element, onOpen, onAdded }: {
  element: Pick<Element, 'id' | 'object_id' | 'owner_id'>;
  /** Open a Sub-element's page. */
  onOpen: (id: string) => void;
  /** After a Sub-element is made (its title, for the activity line). */
  onAdded?: (title: string) => void;
}) {
  const { t } = useI18n();
  const { data: subs = [], refetch } = useSubElements(element.id);
  const { data: workers } = useAssignableWorkers({ elementId: element.id });
  const done = subs.filter((s) => s.status === 'done').length;
  return (
    <FoldSection title={t('Sub-elements')} count={subs.length ? `${done}/${subs.length}` : undefined}>
      {subs.map((sub) => (
        <SubElementRow key={sub.id} sub={sub} workers={workers} onOpen={() => onOpen(sub.id)} onChanged={() => void refetch()} />
      ))}
      <FoldSectionAddRow icon={<ElementProgressMark status="todo" size={16} />} placeholder={t('Add sub-element')}
        onAdd={async (title) => {
          try {
            await createSubElement(element, title);
            await refetch();
            onAdded?.(title);
          } catch (e) { noticeElementSaveFailed(e); }
        }} />
    </FoldSection>
  );
}

function SubElementRow({ sub, workers, onOpen, onChanged }: {
  sub: SubElement;
  workers: Worker[];
  onOpen: () => void;
  onChanged: () => void;
}) {
  const { t, locale } = useI18n();
  const status = sub.status ?? 'todo';
  const lead = sub.assignees.find((a) => a.role === 'assignee') ?? null;
  const assignee = lead ? workers.find((w) => w.id === lead.worker_id) ?? null : null;
  const save = async (updates: Partial<Pick<Element, 'status' | 'due_date'>>) => {
    try {
      await updateElement(sub.id, updates);
      onChanged();
    } catch (e) { noticeElementSaveFailed(e); }
  };
  const assign = async (worker: Worker | null) => {
    try {
      for (const a of sub.assignees) if (a.role === 'assignee') await removeElementAssignee(a.id);
      if (worker) await addElementAssignee({ element_id: sub.id, worker_id: worker.id, role: 'assignee', worker });
      onChanged();
    } catch (e) { noticeElementSaveFailed(e); }
  };
  // A field is its own control: clicking it must not open the row.
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div onClick={onOpen}
      className="group flex min-h-[2.125rem] cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-muted/40">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" onClick={stop} onMouseDown={(e) => e.preventDefault()}
            title={t('Status: {value}', { value: t(STATUS[status].label) })}
            aria-label={t('Status: {value}', { value: t(STATUS[status].label) })}
            className="flex shrink-0 items-center rounded-full transition-opacity hover:opacity-80">
            <ElementProgressMark status={status} size={16} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[180px]" onClick={stop}>
          {STATUS_ORDER.map((s) => (
            <DropdownMenuItem key={s} onSelect={() => { if (s !== status) void save({ status: s }); }} className="gap-2.5 py-1.5 text-[13px]">
              <ElementProgressMark status={s} size={15} />
              <span className="flex-1">{t(STATUS[s].label)}</span>
              {s === status && <MenuCheck />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(); }}
        className={`min-w-0 flex-1 truncate text-left text-[14px] font-medium ${status === 'done' ? 'text-muted-foreground' : 'text-foreground'}`}>
        {sub.title}
      </button>

      <span onClick={stop} className="shrink-0">
        <DatePopover value={sub.due_date ?? null} onChange={(d) => void save({ due_date: d })} align="end">
          <button type="button" aria-label={t('Due date')}
            className={`flex h-6 items-center gap-1 rounded-md px-1.5 text-[12px] tabular-nums transition-colors hover:bg-muted/50 ${
              sub.due_date ? 'text-muted-foreground' : 'text-transparent group-hover:text-muted-foreground/60'}`}>
            <CalendarIcon size={12} />
            {sub.due_date ? formatDateShort(sub.due_date, locale) : null}
          </button>
        </DatePopover>
      </span>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" onClick={stop} aria-label={t('Assignee')}
            className={`flex size-6 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-muted/50 ${
              assignee ? '' : 'text-transparent group-hover:text-muted-foreground/60'}`}>
            {assignee ? <WorkerAvatar worker={assignee} size={18} /> : <UserRound size={13} />}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-[320px] min-w-[200px] overflow-auto" onClick={stop}>
          {workers.map((w) => (
            <DropdownMenuItem key={w.id} onSelect={() => { if (w.id !== assignee?.id) void assign(w); }} className="gap-2.5 py-1.5 text-[13px]">
              <WorkerAvatar worker={w} size={18} />
              <span className="flex-1 truncate">{w.name}</span>
              {w.id === assignee?.id && <MenuCheck />}
            </DropdownMenuItem>
          ))}
          {lead && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void assign(null)} className="py-1.5 text-[13px] text-muted-foreground">
                {t('Unassign')}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
