'use client';

import { Calendar as CalendarIcon, Check, UserRound } from 'lucide-react';
import { updateSubelement, type Worker } from '@/hooks/useSupabase';
import type { Subelement } from '@/types/database';
import { ElementProgressMark } from '@/Function/shared/ElementProgressMark';
import { DatePopover } from '@/Function/shared/date';
import { WorkerAvatar } from '@/Function/shared/WorkerAvatar';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { STATUS, STATUS_ORDER } from '@/shared/designTokens';
import { formatDateShort } from '@/Function/shared/listTable/shared';
import { useI18n } from '@/Function/i18n/I18nProvider';

interface SubelementRowProps {
  subelement: Pick<Subelement, 'id' | 'title' | 'is_completed' | 'status' | 'due_date' | 'assignee_id'>;
  /** Workers who can be put on it (the parent Element's assignable people). */
  workers: Worker[];
  onRefresh?: () => void;
  /** Click on the row (not on a field) → opens the detail modal. */
  onOpen?: () => void;
  // ── Multi-select, as in the Elements list: Shift / ⌘ / Ctrl click. ──
  canRowSelect?: boolean;
  isSelected?: boolean;
  /** Stable ref to "is anything selected" — lets a plain click replace the
   *  selection without re-rendering every row when the flag flips. */
  hasSelectionRef?: React.MutableRefObject<boolean>;
  onRowSelect?: (id: string, mode: 'single' | 'range' | 'replace') => void;
}

type SubStatus = NonNullable<Subelement['status']>;

// A SubElement row reads like an Elements list row: its status mark (a menu
// of the same statuses), the title, then its due date and assignee, each set
// in place. Done here is completion — the parent's progress follows it.
export function SubelementRow({
  subelement, workers, onRefresh, onOpen,
  canRowSelect = false, isSelected = false, hasSelectionRef, onRowSelect,
}: SubelementRowProps) {
  const { t, locale } = useI18n();
  const status: SubStatus = subelement.status ?? (subelement.is_completed ? 'done' : 'todo');
  const assignee = workers.find((w) => w.id === subelement.assignee_id) ?? null;

  const save = async (updates: Partial<Pick<Subelement, 'status' | 'due_date' | 'assignee_id'>>) => {
    try {
      await updateSubelement(subelement.id, updates);
      onRefresh?.();
    } catch (err) {
      console.error('Failed to update sub-element:', err);
    }
  };
  // A field is its own control: clicking it must not open the row.
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div
      onClick={(e) => {
        if (canRowSelect && (e.shiftKey || e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          onRowSelect?.(subelement.id, e.shiftKey ? 'range' : 'single');
          return;
        }
        if (canRowSelect && hasSelectionRef?.current) {
          onRowSelect?.(subelement.id, 'replace');
          return;
        }
        onOpen?.();
      }}
      className={`group flex items-center gap-2 min-h-[2.125rem] px-2 py-1 rounded-lg cursor-pointer select-none leading-[1.4] transition-colors ${
        isSelected
          ? 'bg-[var(--accent-default)]/15 dark:bg-[var(--accent-default)]/20 hover:bg-[var(--accent-default)]/20 dark:hover:bg-[var(--accent-default)]/25'
          : 'hover:bg-foreground/[0.06]'
      }`}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" onClick={stop} onMouseDown={(e) => e.preventDefault()}
            title={t('Status: {value}', { value: t(STATUS[status].label) })}
            className="shrink-0 flex items-center rounded-full transition-opacity hover:opacity-80">
            <ElementProgressMark status={status} size={16} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[180px]" onClick={stop}>
          {STATUS_ORDER.map((s) => (
            <DropdownMenuItem key={s} onSelect={() => { if (s !== status) void save({ status: s }); }} className="gap-2.5 py-1.5 text-[13px]">
              <ElementProgressMark status={s} size={15} />
              <span className="flex-1">{t(STATUS[s].label)}</span>
              {s === status && <Check size={13} />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <span className={`text-[14px] font-medium truncate flex-1 min-w-0 ${status === 'done' ? 'text-muted-foreground' : 'text-foreground'}`}>
        {subelement.title}
      </span>

      <span onClick={stop} className="shrink-0">
        <DatePopover value={subelement.due_date ?? null} onChange={(d) => void save({ due_date: d })} align="end">
          <button type="button"
            className={`flex h-6 items-center gap-1 rounded-md px-1.5 text-[12px] tabular-nums transition-colors hover:bg-muted/50 ${
              subelement.due_date ? 'text-muted-foreground' : 'text-transparent group-hover:text-muted-foreground/60'}`}
            aria-label={t('Due date')}>
            <CalendarIcon size={12} />
            {subelement.due_date ? formatDateShort(subelement.due_date, locale) : null}
          </button>
        </DatePopover>
      </span>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" onClick={stop} aria-label={t('Assignee')}
            className={`shrink-0 flex size-6 items-center justify-center rounded-full transition-colors hover:bg-muted/50 ${
              assignee ? '' : 'text-transparent group-hover:text-muted-foreground/60'}`}>
            {assignee ? <WorkerAvatar worker={assignee} size={18} /> : <UserRound size={13} />}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[200px] max-h-[320px] overflow-auto" onClick={stop}>
          {workers.map((w) => (
            <DropdownMenuItem key={w.id} onSelect={() => { if (w.id !== subelement.assignee_id) void save({ assignee_id: w.id }); }} className="gap-2.5 py-1.5 text-[13px]">
              <WorkerAvatar worker={w} size={18} />
              <span className="flex-1 truncate">{w.name}</span>
              {w.id === subelement.assignee_id && <Check size={13} />}
            </DropdownMenuItem>
          ))}
          {subelement.assignee_id && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void save({ assignee_id: null })} className="py-1.5 text-[13px] text-muted-foreground">
                {t('Unassign')}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
