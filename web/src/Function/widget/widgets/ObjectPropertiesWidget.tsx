'use client';
import { Button } from '@/ui/button';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Calendar, Check, User as UserIcon, X } from 'lucide-react';
import type { CustomColumnWithValues } from '@/hooks/useSupabase';
import {
  fetchDomainCustomColumnsWithValues,
  setCustomColumnObjectValue,
  updateObject,
  useDomains,
  useStrategies,
  useWorkers,
} from '@/hooks/useSupabase';
import type { Domain, Json, Worker } from '@/types/database';
import { ElementTypeIcon } from '@/shell/icons';
import { NavStrategyIcon } from '@/shell/sidebar/NavIcons';
import { CustomColumnCell } from '@/Function/property';
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
} from '@/ui/dropdown-menu';
import { Popover, PopoverTrigger, PopoverContent } from '@/ui/popover';
import { Calendar as DateCalendar } from '@/ui/calendar';
import { getCachedWeekStartsOn, usePreference } from '@/Function/settings/preferencesStore';
import type { WidgetHost } from '../types';
import { completionOf, isOpenStatus } from '@/Function/shared/completion';

// =============================================================
// Properties — the Object's typed metadata, as a rail island.
//
// This was the Overview's hand-placed RailCard. Nothing about how it looks
// changed when it became a widget: the frame it used to draw for itself is
// the frame every widget now wears. What it gained is the ability to be
// moved, removed, and re-added — and the ability to appear on a surface that
// did not hard-code it.
//
// It fetches its own Domains / Workers / Initiatives / custom columns. The host
// hands it the Object and the Object's Elements; everything else is this
// widget's business, which is what stops the host contract from growing a
// field per widget.
// =============================================================

// Date <-> 'YYYY-MM-DD'. Built from local Y/M/D parts, not Date.parse on a
// bare ISO date, which would shift across timezones and select the wrong day.
const toYMD = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseYMD = (s?: string | null): Date | undefined => {
  if (!s) return undefined;
  const [y, m, d] = s.split('T')[0].split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d) : undefined;
};

export function ObjectPropertiesWidget({ host }: { host: WidgetHost }) {
  const object = host.object;
  const elements = host.elements;

  const stats = useMemo(() => {
    const { done, total, pct } = completionOf(elements);
    const inProgress = elements.filter((e) => e.status === 'in_progress').length;
    const overdue = elements.filter((e) => {
      if (!e.due_date || !isOpenStatus(e.status)) return false;
      return new Date(e.due_date) < new Date();
    }).length;
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

  const leadWorker: Worker | null =
    (object?.lead_id ? allWorkers.find((w) => w.id === object.lead_id) : null) ?? null;

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
      console.error('Failed to save property', e);
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
      {/* Initiative — which portfolio(s) this Object is grouped under (a
          Initiative can span Domains, so an Object can belong to more than
          one). A faint divider separates it from the Object's own fields
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
                name="Initiative"
                label={s.name}
              />
            </button>
          ))}
          <div className="h-px bg-border/50 mx-2 my-1" />
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
        name="Start date"
        value={object.start_date}
        onChange={(start_date) => handleFieldSave({ start_date })}
      />
      <SingleDatePickerRow
        name="Due date"
        value={object.due_date}
        onChange={(due_date) => handleFieldSave({ due_date })}
      />

      <LeadPickerRow
        lead={leadWorker}
        workers={allWorkers}
        onChange={(lead_id) => handleFieldSave({ lead_id })}
      />

      <RailRow
        name="Progress"
        label={
          <span className="flex items-center gap-2 w-full">
            <SegmentedProgress value={stats.progress} className="flex-1" />
            <span className="text-[11px] tabular-nums text-foreground/80 shrink-0">
              {stats.progress}%
            </span>
          </span>
        }
      />

      <RailRow
        icon={<ElementIcon size={12} className="text-muted-foreground" />}
        name="Elements"
        label={
          <span className="tabular-nums">
            {stats.done}/{stats.total} done
            {stats.inProgress > 0 && (
              <span className="ml-1.5 text-[var(--status-warning)]">· {stats.inProgress} in progress</span>
            )}
            {stats.overdue > 0 && (
              <span className="ml-1.5 text-[var(--status-danger)]">· {stats.overdue} overdue</span>
            )}
          </span>
        }
      />

      {customCols.map((col) => (
        <div key={col.id} className="flex items-center gap-2 px-2 py-2">
          <span className="shrink-0 w-24 text-left text-[11px] font-semibold text-muted-foreground">{col.name}</span>
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
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="w-full text-left">
          <RailRow
            icon={<ElementTypeIcon size={12} />}
            name="Type"
            label={currentType ?? 'Set type'}
            placeholder={!currentType}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[180px]">
        {options.length === 0 && (
          <div className="px-2 py-1.5 text-[12px] text-muted-foreground italic">
            No types defined for this Domain
          </div>
        )}
        {options.map((t) => (
          <DropdownMenuItem key={t} onClick={() => onChange(t)} className="gap-2">
            <ElementTypeIcon size={12} />
            <span className="flex-1 truncate">{t}</span>
            {currentType === t && <Check size={13} className="shrink-0" />}
          </DropdownMenuItem>
        ))}
        {currentType && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onChange(null)} className="text-muted-foreground gap-2">
              <X size={12} />
              Clear
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SingleDatePickerRow({
  name,
  value,
  onChange,
}: {
  name: string;
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  const display = value
    ? new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    : `Set ${name.toLowerCase()}`;
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
          defaultMonth={parseYMD(value) ?? new Date()}
          selected={parseYMD(value)}
          onSelect={(d?: Date) => onChange(d ? toYMD(d) : null)}
          weekStartsOn={weekStartsOn}
        />
        <div className="flex items-center justify-between border-t border-border px-3 py-2">
          <Button
            type="button"
            size="xs"
            onClick={() => onChange(null)}
          >
            Clear
          </Button>
          <Button
            type="button"
            size="xs"
            onClick={() => onChange(toYMD(new Date()))}
          >
            Today
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
            label={lead?.name ?? 'Assign lead'}
            placeholder={!lead}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[200px]">
        {workers.length === 0 && (
          <div className="px-2 py-1.5 text-[12px] text-muted-foreground italic">No workers</div>
        )}
        {workers.map((w) => (
          <DropdownMenuItem key={w.id} onClick={() => onChange(w.id)} className="gap-2">
            <WorkerAvatar worker={w} size={16} />
            <span className="flex-1 truncate">{w.name}</span>
            <ReachHint worker={w} />
            {lead?.id === w.id && <Check size={13} className="shrink-0" />}
          </DropdownMenuItem>
        ))}
        {lead && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onChange(null)} className="text-muted-foreground gap-2">
              <X size={12} />
              Clear
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
