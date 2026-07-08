'use client';

import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
import { ChevronRight, Calendar, Check, User as UserIcon, X } from 'lucide-react';
import type { ExplorerData, ElementWithDetails, AlconObjectWithChildren, CustomColumnWithValues } from '@/hooks/useSupabase';
import { updateObject, useDomains, useWorkers, fetchDomainCustomColumnsWithValues, setCustomColumnObjectValue } from '@/hooks/useSupabase';
import type { Domain, Json, Worker } from '@/types/database';
import { ObjectIcon, ElementTypeIcon } from '@/shell/icons';
import { CustomColumnCell } from '@/alcon/property';
import { MilestonesWidget } from '@/alcon/widget/widgets/MilestonesWidget';
import { RailCard } from '@/alcon/shared/RailCard';
import { RailRow } from '@/alcon/shared/RailRow';
import { ElementIcon } from '@/alcon/shared/conceptIcons';
import { SegmentedProgress } from '@/alcon/shared/SegmentedProgress';
import { WorkerAvatar } from '@/alcon/shared/WorkerAvatar';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/ui/dropdown-menu';
import { Popover, PopoverTrigger, PopoverContent } from '@/ui/popover';
import { Calendar as DateCalendar } from '@/ui/calendar';

// Date <-> 'YYYY-MM-DD' helpers, copied from ElementDetailView. We build
// from local Y/M/D parts (not Date.parse on a bare ISO date, which would
// shift across timezones and select the wrong day).
const toYMD = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseYMD = (s?: string | null): Date | undefined => {
  if (!s) return undefined;
  const [y, m, d] = s.split('T')[0].split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d) : undefined;
};

/**
 * Auto-grow a textarea to fit its content. Robust against the "measured
 * while the column was 0-width → wrapped into 14 lines → stuck at 400px"
 * bug: re-measures on `value` change AND whenever the element's WIDTH
 * changes (via ResizeObserver). Width-only guard prevents the height we
 * write from feeding back into an observer loop.
 */
function useAutoGrowTextarea(
  ref: React.RefObject<HTMLTextAreaElement | null>,
  value: string,
) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    };
    measure();
    let lastWidth = el.clientWidth;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w !== lastWidth) {
        lastWidth = w;
        measure();
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, value]);
}

interface OverviewViewProps {
  elements: ElementWithDetails[];
  object: AlconObjectWithChildren;
  explorerData: ExplorerData;
  onRefresh?: () => void;
  onNavigate?: (nav: { objectId?: string }) => void;
}

// Object Overview is a fixed editorial layout (Title + Description + Milestones
// in the main column, Properties in the side rail). The old WidgetGrid + KPI
// dashboard (Completion / In Progress / Overdue / Hours) and side widgets
// (Team / Recent Activity / Customize) were dropped — those numbers already
// live in the Properties card, Team membership is managed at the Domain level,
// and the dashboard tile-grid felt corporate next to the rest of the app.

/**
 * Object Overview tab — Asana-style project overview.
 * 2-column layout: editable description + child Objects in main, properties + widgets on the side.
 */
export function OverviewView({ elements, object, explorerData, onRefresh, onNavigate }: OverviewViewProps) {
  // Object name + description as always-editable seamless textareas, mirroring
  // ElementDetailView's inline header (transparent, no border/ring, auto-grow,
  // save on blur — no Edit button or view/edit toggle).
  const [title, setTitle] = useState(object.name);
  const [description, setDescription] = useState(object.description || '');
  const titleRef = useRef<HTMLTextAreaElement | null>(null);
  const descRef = useRef<HTMLTextAreaElement | null>(null);
  // Auto-grow both textareas so long names / descriptions wrap into view.
  // Re-measure on value change AND whenever the textarea's WIDTH changes —
  // the latter is what fixes the "balloon to 400px" bug: this view's grid
  // (minmax(0,1fr)) hands the column a near-zero width during the first
  // layout pass, so a measure-once-on-mount effect captures a wildly wrapped
  // scrollHeight and never corrects it. A width-guarded ResizeObserver
  // re-measures once the real column width lands. (We key off width only, not
  // height, so writing the new height can't feed back into an observer loop.)
  useAutoGrowTextarea(titleRef, title);
  useAutoGrowTextarea(descRef, description);

  // Re-sync from props when the Object switches or is saved elsewhere.
  useEffect(() => {
    setTitle(object.name);
    setDescription(object.description || '');
  }, [object.id, object.name, object.description]);

  const stats = useMemo(() => {
    const total = elements.length;
    const done = elements.filter((e) => e.status === 'done').length;
    const inProgress = elements.filter((e) => e.status === 'in_progress').length;
    const overdue = elements.filter((e) => {
      if (!e.due_date || e.status === 'done') return false;
      return new Date(e.due_date) < new Date();
    }).length;
    const progress = total > 0 ? Math.round((done / total) * 100) : 0;
    return { total, done, inProgress, overdue, progress };
  }, [elements]);

  const { data: domains } = useDomains();

  // Lead resolution — Object.lead_id is just a uuid; we render the Worker
  // name + avatar in the Properties island, so look up the workers list and
  // pick the matching one. Fetched org-wide because the lead can be anyone,
  // not just a member of this Object.
  const { data: allWorkers } = useWorkers();
  const leadWorker = useMemo(
    () => (object.lead_id ? allWorkers.find((w) => w.id === object.lead_id) ?? null : null),
    [object.lead_id, allWorkers],
  );

  // Custom Properties (domain-scoped) for this Object — the same columns
  // the Object list shows, surfaced here as editable property rows.
  const [customCols, setCustomCols] = useState<CustomColumnWithValues[]>([]);
  const reloadCustomCols = useCallback(async () => {
    if (!object.domain_id) { setCustomCols([]); return; }
    try {
      setCustomCols(await fetchDomainCustomColumnsWithValues(object.domain_id));
    } catch (e) {
      console.error('Failed to load Object properties', e);
    }
  }, [object.domain_id]);
  useEffect(() => { void reloadCustomCols(); }, [reloadCustomCols]);
  const handleCustomChange = useCallback(async (columnId: string, value: Json) => {
    try {
      await setCustomColumnObjectValue(columnId, object.id, value);
      await reloadCustomCols();
    } catch (e) {
      console.error('Failed to save property', e);
    }
  }, [object.id, reloadCustomCols]);

  const handleTitleSave = async () => {
    const next = title.trim();
    if (next && next !== object.name) {
      try {
        await updateObject(object.id, { name: next });
        onRefresh?.();
      } catch (err) {
        console.error('Failed to save name:', err);
      }
    }
  };

  // Inline field saver for the Properties rail's interactive rows (Type /
  // Start date / Due date / Lead). Each picker fires the same shape into
  // here so the call sites stay one-line.
  const handleFieldSave = useCallback(async (updates: {
    type?: string | null;
    start_date?: string | null;
    due_date?: string | null;
    lead_id?: string | null;
  }) => {
    try {
      await updateObject(object.id, updates);
      onRefresh?.();
    } catch (err) {
      console.error('Failed to save Object field', updates, err);
    }
  }, [object.id, onRefresh]);

  // Object-type catalogue lives on the Domain (domains.object_types). Pull
  // it off the primary Domain so the Type picker offers the same vocabulary
  // the Object list uses for its Type column. (Note: ListTable's `elementTypes`
  // prop is misleadingly named — for Object rows it's wired to object_types.)
  const primaryDomain = useMemo<Domain | null>(
    () => domains.find((d) => d.id === object.domain_id) ?? null,
    [domains, object.domain_id],
  );
  const objectTypes: string[] = primaryDomain?.object_types ?? [];

  const handleDescriptionSave = async () => {
    if (description !== (object.description || '')) {
      try {
        await updateObject(object.id, { description: description || null });
        onRefresh?.();
      } catch (err) {
        console.error('Failed to save description:', err);
      }
    }
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div className="h-full overflow-y-auto bg-card">
      <div className="max-w-7xl mx-auto px-8 py-8">
        {/* items-start: don't let the (often taller) Properties rail stretch
            the main column. A stretched block column was the layout that made
            the title/description textareas mis-measure and balloon. */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-8 items-start">
          {/* ───────────── Main column ───────────── */}
          {/* pl-6: indent the editorial content (title / description /
              milestones) a little off the left rail so it reads as a document
              with breathing room rather than flush against the sidebar. */}
          <div className="space-y-6 min-w-0 pl-6">
            {/* Header — Object icon stacked above the name; the name sits flush
                with the column's left edge so it lines up with the Description
                below (the icon no longer indents the title). */}
            <div>
              <span className="w-9 h-9 -ml-2 rounded-lg bg-muted/40 flex items-center justify-center text-foreground/70 mb-3">
                <ObjectIcon size={18} />
              </span>
              <textarea
                ref={titleRef}
                value={title}
                rows={1}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={handleTitleSave}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    (e.currentTarget as HTMLTextAreaElement).blur();
                  }
                }}
                className="w-full text-2xl text-foreground bg-transparent border-none focus:outline-none focus:ring-0 resize-none leading-tight overflow-hidden tracking-normal"
                style={{ fontWeight: 600 }}
                placeholder="Object name"
              />
            </div>

            {/* Description — always-editable seamless textarea, same
                implementation as ElementDetailView (no heading, no Edit button;
                transparent field, auto-grow, saves on blur). */}
            <section>
              <textarea
                ref={descRef}
                value={description}
                rows={1}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={handleDescriptionSave}
                placeholder="Add description..."
                className="w-full text-[14px] text-foreground leading-relaxed bg-transparent border-none focus:outline-none focus:ring-0 min-h-[36px] resize-none overflow-hidden"
              />
            </section>

            {/* Child Objects */}
            {object.children && object.children.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-[13px] font-medium text-foreground/90">
                    Child Objects
                  </h2>
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {object.children.length}
                  </span>
                </div>
                <div className="rounded-lg border border-border/60 overflow-hidden">
                  <table className="w-full bg-card">
                    <tbody>
                      {object.children.map((child, idx) => {
                        const childTotal = child.elements?.length || 0;
                        const childDone = child.elements?.filter((e) => e.status === 'done').length || 0;
                        const childProgress = childTotal > 0 ? Math.round((childDone / childTotal) * 100) : 0;
                        return (
                          <tr
                            key={child.id}
                            onClick={() => onNavigate?.({ objectId: child.id })}
                            className={`group cursor-pointer transition-colors hover:bg-muted/30 ${
                              idx > 0 ? 'border-t border-border/60' : ''
                            }`}
                          >
                            <td className="pl-3 pr-2 py-2.5 w-6 text-[11px] text-muted-foreground/60 tabular-nums text-center">
                              {idx + 1}
                            </td>
                            <td className="py-2.5 pr-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-muted-foreground"><ObjectIcon size={14} /></span>
                                <span className="text-[13px] font-medium text-foreground truncate">
                                  {child.name}
                                </span>
                                {child.children && child.children.length > 0 && (
                                  <span className="text-[10px] text-muted-foreground shrink-0">
                                    {child.children.length} sub
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="hidden md:table-cell px-3 py-2.5 text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">
                              {childTotal} elements
                            </td>
                            <td className="hidden md:table-cell px-3 py-2.5 w-[160px]">
                              <div className="flex items-center gap-2">
                                <SegmentedProgress value={childProgress} className="flex-1" />
                                <span className="text-[10px] text-muted-foreground w-8 text-right tabular-nums">
                                  {childProgress}%
                                </span>
                              </div>
                            </td>
                            <td className="px-3 py-2.5 w-6">
                              <ChevronRight
                                size={13}
                                className="text-muted-foreground/40 group-hover:text-foreground transition-colors"
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Milestones — high-priority Elements with due dates, grouped by
                month. Rendered directly (not via WidgetGrid) so the old saved
                "kpi-cards + milestones" layouts in localStorage can't bring
                the dashboard tiles back, and so there's no Customize button
                cluttering the editorial flow. */}
            <section>
              <h2 className="text-[13px] font-medium text-foreground/90 mb-2">Milestones</h2>
              <div className="rounded-lg border border-border/60 bg-card px-4 py-3">
                <MilestonesWidget elements={elements} />
              </div>
            </section>
          </div>

          {/* ───────────── Side column ───────────── */}
          <aside className="space-y-3 min-w-0">
            {/* Properties — the rail mirrors the Object list's built-in columns
                (Type / Date / Lead / Progress / Elements) plus Domain (moved
                in from a separate card) and Created / Updated metadata. Uses
                the same RailRow + RailCard primitives as ElementDetailView's
                Properties island so the two rails stay visually identical and
                don't drift. */}
            <RailCard title="Properties">
              {/* Type — the user-defined Element kind catalog (Object.type).
                  Picker offers the parent Domain's `element_types`; picks save
                  through updateObject so the change is visible on the list
                  view's Type column on next refresh. */}
              <TypePickerRow
                currentType={object.type}
                options={objectTypes}
                onChange={(type) => handleFieldSave({ type })}
              />

              {/* Start date — Object.start_date, single date picker. Separate
                  from Due date so each can be set/cleared independently (a
                  combined range picker forces both ends; teams sometimes
                  know one end and not the other). */}
              <SingleDatePickerRow
                name="Start date"
                value={object.start_date}
                onChange={(start_date) => handleFieldSave({ start_date })}
              />

              {/* Due date — Object.due_date, single date picker. */}
              <SingleDatePickerRow
                name="Due date"
                value={object.due_date}
                onChange={(due_date) => handleFieldSave({ due_date })}
              />

              {/* Lead — Object.lead_id resolved to a Worker. Picker offers
                  every Worker in the org (the lead can be anyone, not just an
                  Object member); + Clear. */}
              <LeadPickerRow
                lead={leadWorker}
                workers={allWorkers}
                onChange={(lead_id) => handleFieldSave({ lead_id })}
              />

              {/* Progress — computed from child Element completion. */}
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

              {/* Elements — count of child Elements (done / total). */}
              <RailRow
                icon={<ElementIcon size={12} className="text-muted-foreground" />}
                name="Elements"
                label={
                  <span className="tabular-nums">
                    {stats.done}/{stats.total} done
                    {stats.inProgress > 0 && (
                      <span className="ml-1.5 text-amber-600">· {stats.inProgress} in progress</span>
                    )}
                    {stats.overdue > 0 && (
                      <span className="ml-1.5 text-rose-600">· {stats.overdue} overdue</span>
                    )}
                  </span>
                }
              />

              {/* Custom Properties (domain-scoped) — editable value only. */}
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
            </RailCard>

            {/* Side widgets (Team + Recent Activity) used to live here, with
                a Customize button. Removed — Team membership is managed at the
                Domain level (the right rail's job is structured Properties,
                not a per-Object membership view), and Recent Activity belonged
                to the dashboard era we just deleted upstairs. */}
          </aside>
        </div>
      </div>
    </div>
  );
}

// PropertyRow was replaced by the shared RailRow (matches ElementDetailView's
// Properties island). See @/alcon/shared/RailRow.

// ============================================
// Interactive Properties-island rows for an Object
// ============================================
// Each wraps a RailRow in a picker (DropdownMenu / Popover) so the user can
// edit the underlying Object field inline. Kept local to OverviewView because
// they hard-wire the Object's specific fields — ElementDetailView has its own
// equivalents (TypePicker / Date Popover / Assignee menu) over Element fields.

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
          <DropdownMenuItem
            key={t}
            onClick={() => onChange(t)}
            className="gap-2"
          >
            <ElementTypeIcon size={12} />
            <span className="flex-1 truncate">{t}</span>
            {currentType === t && <Check size={13} className="shrink-0" />}
          </DropdownMenuItem>
        ))}
        {currentType && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onChange(null)}
              className="text-muted-foreground gap-2"
            >
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
        />
        <div className="flex items-center justify-between border-t border-border px-3 py-2">
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-[12px] text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => onChange(toYMD(new Date()))}
            className="text-[12px] text-primary hover:underline"
          >
            Today
          </button>
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
        <button type="button" className="w-full text-left">
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
          <div className="px-2 py-1.5 text-[12px] text-muted-foreground italic">
            No workers
          </div>
        )}
        {workers.map((w) => (
          <DropdownMenuItem
            key={w.id}
            onClick={() => onChange(w.id)}
            className="gap-2"
          >
            <WorkerAvatar worker={w} size={16} />
            <span className="flex-1 truncate">{w.name}</span>
            {lead?.id === w.id && <Check size={13} className="shrink-0" />}
          </DropdownMenuItem>
        ))}
        {lead && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onChange(null)}
              className="text-muted-foreground gap-2"
            >
              <X size={12} />
              Clear
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
