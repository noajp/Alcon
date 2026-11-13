'use client';
import { Button } from '@/ui/button';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Calendar, User as UserIcon, X } from '@/ui/icons';
import type { CustomColumnWithValues } from '@/hooks/useSupabase';
import {
  fetchDomainCustomColumnsWithValues,
  noticePropertyValueFailed,
  setCustomColumnObjectValue,
  updateObject,
  useDomains,
  useStrategies,
  useWorkerById,
  useWorkers,
} from '@/hooks/useSupabase';
import type { Domain, Json, Worker } from '@/types/database';
import { ElementTypeIcon } from '@/Frame/icons';
import { NavStrategyIcon } from '@/Frame/sidebar/NavIcons';
import { CustomColumnCell } from '@/Function/property/CustomColumnCell';
import { RailRow } from '@/Function/shared/RailRow';
import { ElementIcon } from '@/Function/shared/conceptIcons';
import { SegmentedProgress } from '@/Function/shared/SegmentedProgress';
import { ReachHint, WorkerAvatar } from '@/Function/shared/WorkerAvatar';
import { workerTriggerLabel } from '@/Function/shared/workerReach';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  MenuCheck,
} from '@/ui/dropdown-menu';
import { Popover, PopoverTrigger, PopoverContent } from '@/ui/popover';
import { Calendar as DateCalendar } from '@/ui/calendar';
import { getCachedWeekStartsOn, usePreference } from '@/Function/settings/preferencesStore';
import type { WidgetHost } from '../types';
import { completionOf, isOpenStatus } from '@/Function/shared/completion';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { parseDateOnly, toDateOnlyString, isOverdue } from '@/Function/shared/dateUtils';

// =============================================================
// Properties — the Object's typed metadata, as a rail island.
//
// This was the Overview's hand-placed RailCard. Nothing about how it looks
// changed when it became a widget: the frame it used to draw for itself is
// the frame every widget now wears. What it gained is the ability to be
// moved, removed, and re-added — and the ability to appear on a surface that
// did not hard-code it.
//
// It fetches its own Domains / Workers / Strategies / custom columns. The host
// hands it the Object and the Object's Elements; everything else is this
// widget's business, which is what stops the host contract from growing a
// field per widget.
// =============================================================

export function ObjectPropertiesWidget({ host }: { host: WidgetHost }) {
  const { t } = useI18n();
  const object = host.object;
  const elements = host.elements;

  const stats = useMemo(() => {
    const { done, total, pct } = completionOf(elements);
    const inProgress = elements.filter((e) => e.status === 'in_progress').length;
    const overdue = elements.filter((e) => isOpenStatus(e.status) && isOverdue(e.due_date)).length;
    return { total, done, inProgress, overdue, progress: pct };
  }, [elements]);

  const { data: domains } = useDomains();
  const { data: allStrategies } = useStrategies();
  const { data: allWorkers } = useWorkers();

  // Plain derivations — small arrays over data the hooks already cache, and
  // the React Compiler memoises them. A hand-written useMemo here only gave
  // the compiler a dependency list to disagree with.
  const owningStrategies = object
    ? allStrategies.filter((s) => s.objectIds.includes(object.id))
    : [];

  // Object-type catalogue lives on the Domain (domains.object_types). Pull it
  // off the primary Domain so the Type picker offers the same vocabulary the
  // Object list uses for its Type column.
  const primaryDomain: Domain | null =
    domains.find((d) => d.id === object?.domain_id) ?? null;
  const objectTypes: string[] = primaryDomain?.object_types ?? [];

  // Resolved by id: a lead from outside the picker's list still shows by name.
  const leadWorker: Worker | null = useWorkerById(object?.lead_id ?? null, allWorkers);

  // Custom Properties (domain-scoped) for this Object — the same columns the
  // Object list shows, surfaced here as editable property rows. Fetched in an
  // effect with a cancellation flag; the "no Domain" case is derived at render
  // rather than written into state, so nothing sets state synchronously.
  const [fetched, setFetched] = useState<CustomColumnWithValues[]>([]);
  const [reloadToken, setReloadToken] = useState(0);
  const domainId = object?.domain_id ?? null;

  useEffect(() => {
    if (!domainId) return;
    let cancelled = false;
    void (async () => {
      try {
        const cols = await fetchDomainCustomColumnsWithValues(domainId);
        if (!cancelled) setFetched(cols);
      } catch (e) {
        console.error('Failed to load Object properties', e);
      }
    })();
    return () => { cancelled = true; };
  }, [domainId, reloadToken]);

  const customCols = domainId ? fetched : [];

  const objectId = object?.id;
  const onRefresh = host.onRefresh;

  const handleCustomChange = useCallback(async (columnId: string, value: Json) => {
    if (!objectId) return;
    try {
      await setCustomColumnObjectValue(columnId, objectId, value);
      setReloadToken((n) => n + 1);
    } catch (e) {
      noticePropertyValueFailed(e);
    }
  }, [objectId]);

  // Inline field saver for the interactive rows (Type / Start date / Due date
  // / Lead). Each picker fires the same shape so the call sites stay one-line.
  const handleFieldSave = useCallback(async (updates: {
    type?: string | null;
    start_date?: string | null;
    due_date?: string | null;
    lead_id?: string | null;
  }) => {
    if (!objectId) return;
    try {
      await updateObject(objectId, updates);
      onRefresh?.();
    } catch (err) {
      console.error('Failed to save Object field', updates, err);
    }
  }, [objectId, onRefresh]);

  if (!object) return null;

  return (
    <>
      {/* Strategy — which Strategy(s) this Object is grouped under (a
          Strategy can span Domains, so an Object can belong to more than
          one). A gap, not a line, separates it from the Object's own fields
          below, since it reads more like provenance than an editable
          property. */}
      {owningStrategies.length > 0 && (
        <>
          {owningStrategies.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => { host.onNavigate?.({ strategyId: s.id }); host.onViewChange?.('strategy'); }}
              className="w-full text-left"
            >
              <RailRow
                icon={<NavStrategyIcon size={12} className="text-muted-foreground" />}
                name={t('Strategy')}
                label={s.name}
              />
            </button>
          ))}
          <div aria-hidden className="h-2" />
        </>
      )}

      <TypePickerRow
        currentType={object.type}
        options={objectTypes}
        onChange={(type) => handleFieldSave({ type })}
      />

      {/* Start and Due are separate single pickers, not a range: each end can
          be set or cleared independently, and teams often know one and not
          the other. */}
      <SingleDatePickerRow
        name={t('Start date')}
        unsetLabel={t('Set start date')}
        value={object.start_date}
        onChange={(start_date) => handleFieldSave({ start_date })}
      />
      <SingleDatePickerRow
        name={t('Due date')}
        unsetLabel={t('Set due date')}
        value={object.due_date}
        onChange={(due_date) => handleFieldSave({ due_date })}
      />

      <LeadPickerRow
        lead={leadWorker}
        workers={allWorkers}
        onChange={(lead_id) => handleFieldSave({ lead_id })}
      />

      <RailRow
        name={t('Progress')}
        label={
          <span className="flex items-center gap-2 w-full">
            <SegmentedProgress value={stats.progress} className="flex-1" />
            <span className="text-[12px] tabular-nums text-muted-foreground shrink-0">
              {stats.progress}%
            </span>
          </span>
        }
      />

      <RailRow
        icon={<ElementIcon size={12} className="text-muted-foreground" />}
        name={t('Elements')}
        label={
          <span className="tabular-nums">
            {t('{done}/{total} done', { done: stats.done, total: stats.total })}
            {stats.inProgress > 0 && (
              <span className="ml-1.5 text-muted-foreground">· {t('{n} in progress', { n: stats.inProgress })}</span>
            )}
            {stats.overdue > 0 && (
              <span className="ml-1.5 text-[var(--status-danger)]">· {t('{n} overdue', { n: stats.overdue })}</span>
            )}
          </span>
        }
      />

      {customCols.map((col) => (
        <div key={col.id} className="flex items-center gap-2 px-2 min-h-8">
          <span className="shrink-0 w-24 text-left text-[12px] text-muted-foreground">{col.name}</span>
          <div className="flex-1 min-w-0">
            <CustomColumnCell
              column={col}
              elementId={object.id}
              value={col.values?.[object.id]?.value ?? null}
              onChange={(v) => handleCustomChange(col.id, v)}
            />
          </div>
        </div>
      ))}
    </>
  );
}

// ============================================
// Interactive Properties rows for an Object
// ============================================
// Each wraps a RailRow in a picker (DropdownMenu / Popover) so the user can
// edit the underlying Object field inline. Object-specific by design —
// ElementDetailView has its own equivalents over Element fields.

function TypePickerRow({
  currentType,
  options,
  onChange,
}: {
  currentType: string | null;
  options: string[];
  onChange: (type: string | null) => void;
}) {
  const { t } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="w-full text-left">
          <RailRow
            icon={<ElementTypeIcon size={12} />}
            name={t('Type')}
            label={currentType ?? t('Set type')}
            placeholder={!currentType}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[180px]">
        {options.length === 0 && (
          <div className="px-2 py-1.5 text-[12px] text-muted-foreground italic">
            {t('No types defined for this Domain')}
          </div>
        )}
        {options.map((option) => (
          <DropdownMenuItem key={option} onClick={() => onChange(option)} className="gap-2">
            <ElementTypeIcon size={12} />
            <span className="flex-1 truncate">{option}</span>
            {currentType === option && <MenuCheck />}
          </DropdownMenuItem>
        ))}
        {currentType && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onChange(null)} className="text-muted-foreground gap-2">
              <X size={12} />
              {t('Clear')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SingleDatePickerRow({
  name,
  unsetLabel,
  value,
  onChange,
}: {
  name: string;
  unsetLabel: string;
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  const { t, locale } = useI18n();
  const display = value
    ? (parseDateOnly(value) ?? new Date(value)).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })
    : unsetLabel;
  const weekStartsOn = usePreference(getCachedWeekStartsOn);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="w-full text-left">
          <RailRow
            icon={<Calendar size={12} className="text-muted-foreground" />}
            name={name}
            label={display}
            placeholder={!value}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <DateCalendar
          mode="single"
          numberOfMonths={1}
          captionLayout="dropdown"
          startMonth={new Date(2020, 0)}
          endMonth={new Date(2035, 11)}
          defaultMonth={parseDateOnly(value) ?? new Date()}
          selected={parseDateOnly(value)}
          onSelect={(d?: Date) => onChange(d ? toDateOnlyString(d) : null)}
          weekStartsOn={weekStartsOn}
        />
        <div className="flex items-center justify-between border-t border-border px-3 py-2">
          <Button
            type="button"
            size="xs"
            onClick={() => onChange(null)}
          >
            {t('Clear')}
          </Button>
          <Button
            type="button"
            size="xs"
            onClick={() => onChange(toDateOnlyString(new Date()))}
          >
            {t('Today')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function LeadPickerRow({
  lead,
  workers,
  onChange,
}: {
  lead: Worker | null;
  workers: Worker[];
  onChange: (leadId: string | null) => void;
}) {
  const { t } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={workerTriggerLabel('Lead', lead)}
          className="w-full text-left"
        >
          <RailRow
            icon={
              lead
                ? <WorkerAvatar worker={lead} size={14} />
                : <UserIcon size={12} className="text-muted-foreground" />
            }
            name="Lead"
            label={lead?.name ?? t('Assign lead')}
            placeholder={!lead}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[200px]">
        {workers.length === 0 && (
          <div className="px-2 py-1.5 text-[12px] text-muted-foreground italic">{t('No Workers')}</div>
        )}
        {workers.map((w) => (
          <DropdownMenuItem key={w.id} onClick={() => onChange(w.id)} className="gap-2">
            <WorkerAvatar worker={w} size={16} />
            <span className="flex-1 truncate">{w.name}</span>
            <ReachHint worker={w} />
            {lead?.id === w.id && <MenuCheck />}
          </DropdownMenuItem>
        ))}
        {lead && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onChange(null)} className="text-muted-foreground gap-2">
              <X size={12} />
              {t('Clear')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
