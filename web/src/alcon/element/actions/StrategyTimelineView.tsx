'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, X } from 'lucide-react';
import { isCommitEnter, useEscapeLayer } from '@/alcon/shared/keyboard';
import {
  createObjectMilestone,
  deleteObjectMilestone,
  fetchObjectMilestones,
  fetchStrategyElements,
  useObjects,
  type AlconObject,
  type ElementWithDetails,
  type ObjectMilestone,
  type StrategyWithObjects,
} from '@/hooks/useSupabase';
import { ObjectIcon } from '@/shell/icons';
import { NavStrategyIcon } from '@/shell/sidebar/NavIcons';
import { SEMANTIC_COLORS, STATUS } from '@/shared/designTokens';
import { DateField } from '@/alcon/shared/date';

// =============================================================
// StrategyTimelineView — Object-band timeline scoped to a single
// Strategy. Each Object renders as a glossy gradient bar (its
// start_date → due_date span, falling back to the union of its
// Elements' dates) with a row of red ◇ milestone markers above.
// A ›/▾ chevron expands the row to show each Element's bar below,
// keeping the same date axis throughout.
// =============================================================

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_W = 22;
const VISIBLE_DAYS = 31;
const PAST_DAYS = 6;
const LEFT_COL_W = 240;
const MONTH_HEADER_H = 22;
const DAY_HEADER_H = 22;

const OBJECT_ROW_H = 64;
const ELEMENT_ROW_H = 32;
const OBJECT_BAR_H = 24;
const OBJECT_BAR_TOP = 26;
const MILESTONE_BAND_TOP = 6;
const ELEMENT_BAR_H = 12;

export function StrategyTimelineView({ strategy }: { strategy: StrategyWithObjects | null }) {
  const { data: explorer } = useObjects(null);
  const objectsById = useMemo(() => {
    const m = new Map<string, AlconObject>();
    const walk = (nodes: typeof explorer.objects) => {
      for (const n of nodes) {
        m.set(n.id, n);
        if (n.children) walk(n.children);
      }
    };
    walk(explorer.objects);
    return m;
  }, [explorer.objects]);

  const [elements, setElements] = useState<ElementWithDetails[]>([]);
  const [milestones, setMilestones] = useState<ObjectMilestone[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!strategy || strategy.objectIds.length === 0) {
      setElements([]); setMilestones([]); return;
    }
    setLoading(true);
    Promise.all([
      fetchStrategyElements({ domainIds: [], objectIds: strategy.objectIds }),
      fetchObjectMilestones(strategy.objectIds),
    ])
      .then(([elRes, ms]) => {
        if (cancelled) return;
        setElements(elRes.elements);
        setMilestones(ms);
      })
      .catch((e) => console.error('StrategyTimelineView fetch failed:', e))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [strategy]);

  const reloadMilestones = async () => {
    if (!strategy) return;
    try {
      const ms = await fetchObjectMilestones(strategy.objectIds);
      setMilestones(ms);
    } catch (e) {
      console.error('reload milestones failed:', e);
    }
  };

  const [anchorOffset, setAnchorOffset] = useState(0);
  const anchorDate = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    t.setDate(t.getDate() - PAST_DAYS + anchorOffset);
    return t;
  }, [anchorOffset]);

  const days = useMemo(() => {
    const arr: Date[] = [];
    for (let i = 0; i < VISIBLE_DAYS; i++) {
      const d = new Date(anchorDate);
      d.setDate(d.getDate() + i);
      arr.push(d);
    }
    return arr;
  }, [anchorDate]);

  const todayIdx = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return days.findIndex((d) => sameDay(d, t));
  }, [days]);

  // Group elements + milestones per Object
  const rows = useMemo(() => {
    if (!strategy) return [];
    const elsByObject = new Map<string, ElementWithDetails[]>();
    for (const el of elements) {
      const ids = el.objectIds ?? (el.object_id ? [el.object_id] : []);
      for (const oid of ids) {
        if (!elsByObject.has(oid)) elsByObject.set(oid, []);
        elsByObject.get(oid)!.push(el);
      }
    }
    const msByObject = new Map<string, ObjectMilestone[]>();
    for (const m of milestones) {
      if (!msByObject.has(m.object_id)) msByObject.set(m.object_id, []);
      msByObject.get(m.object_id)!.push(m);
    }
    return strategy.objectIds.map((oid) => {
      const obj = objectsById.get(oid) ?? null;
      const els = elsByObject.get(oid) ?? [];
      const ms = msByObject.get(oid) ?? [];
      const range = objectDateRange(els);
      return { oid, obj, els, ms, range };
    });
  }, [strategy, elements, milestones, objectsById]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (oid: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(oid)) next.delete(oid);
      else next.add(oid);
      return next;
    });
  };

  const [addingForObject, setAddingForObject] = useState<string | null>(null);

  const totalW = DAY_W * VISIBLE_DAYS;

  if (!strategy) {
    return (
      <div className="h-full flex items-center justify-center text-[13px] text-muted-foreground">
        Select a Strategy to see its timeline.
      </div>
    );
  }
  if (strategy.objectIds.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-center text-[13px] text-muted-foreground px-6">
        Add Objects to this Strategy to see them on the timeline.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Mini header — week nav + today */}
      <div className="h-8 flex items-center gap-1 px-4 border-b border-border/40 bg-card flex-shrink-0">
        <button
          type="button"
          onClick={() => setAnchorOffset((o) => o - 7)}
          className="w-[24px] h-[24px] rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 flex items-center justify-center"
          aria-label="Back one week"
        >
          <ChevronRight size={12} className="-rotate-180" />
        </button>
        <button
          type="button"
          onClick={() => setAnchorOffset(() => 0)}
          className={`px-2 h-[22px] rounded-md text-[11px] transition-colors ${
            anchorOffset === 0
              ? 'bg-muted/60 text-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
          }`}
        >
          Today
        </button>
        <button
          type="button"
          onClick={() => setAnchorOffset((o) => o + 7)}
          className="w-[24px] h-[24px] rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 flex items-center justify-center"
          aria-label="Forward one week"
        >
          <ChevronRight size={12} />
        </button>
        <span className="text-[11px] text-muted-foreground ml-2">
          {loading ? 'Loading…' : `${rows.length} object${rows.length === 1 ? '' : 's'}`}
        </span>
      </div>

      {/* Scrolling grid */}
      <div className="flex-1 overflow-auto">
        <div className="min-w-fit">
          <DateHeader days={days} todayIdx={todayIdx} totalW={totalW} />
          {rows.map((r) => (
            <Fragment key={r.oid}>
              <ObjectRow
                obj={r.obj}
                oid={r.oid}
                elements={r.els}
                milestones={r.ms}
                range={r.range}
                days={days}
                todayIdx={todayIdx}
                totalW={totalW}
                isOpen={expanded.has(r.oid)}
                onToggle={() => toggle(r.oid)}
                onAddMilestone={() => setAddingForObject(r.oid)}
                onMilestoneDelete={async (id) => {
                  try {
                    await deleteObjectMilestone(id);
                    await reloadMilestones();
                  } catch (e) {
                    console.error('delete milestone failed:', e);
                  }
                }}
              />
              {expanded.has(r.oid) && r.els.map((el) => (
                <ElementRow
                  key={el.id}
                  element={el}
                  days={days}
                  todayIdx={todayIdx}
                  totalW={totalW}
                />
              ))}
              {expanded.has(r.oid) && r.els.length === 0 && (
                <EmptyElementRow totalW={totalW} />
              )}
            </Fragment>
          ))}
        </div>
      </div>

      {addingForObject && (
        <AddMilestoneDialog
          objectName={objectsById.get(addingForObject)?.name ?? ''}
          onClose={() => setAddingForObject(null)}
          onSubmit={async (date, label) => {
            try {
              await createObjectMilestone({ object_id: addingForObject, date, label });
              setAddingForObject(null);
              await reloadMilestones();
            } catch (e) {
              console.error('create milestone failed:', e);
            }
          }}
        />
      )}
    </div>
  );
}

// =============================================================
// Date header
// =============================================================
function DateHeader({
  days,
  todayIdx,
  totalW,
}: { days: Date[]; todayIdx: number; totalW: number }) {
  const spans = useMemo(() => {
    const arr: { label: string; start: number; len: number }[] = [];
    for (let i = 0; i < days.length; i++) {
      const monthLabel = days[i].toLocaleDateString('en-US', { month: 'short' });
      const last = arr[arr.length - 1];
      if (last && last.label === monthLabel) last.len += 1;
      else arr.push({ label: monthLabel, start: i, len: 1 });
    }
    return arr;
  }, [days]);

  return (
    <div
      className="sticky top-0 z-20 bg-card border-b border-border/60"
      style={{ paddingLeft: LEFT_COL_W }}
    >
      <div className="flex" style={{ width: totalW, height: MONTH_HEADER_H }}>
        {spans.map((s, i) => (
          <div
            key={i}
            className="flex-shrink-0 text-[11px] text-muted-foreground font-medium px-2 flex items-center"
            style={{ width: s.len * DAY_W }}
          >
            {s.label}
          </div>
        ))}
      </div>
      <div className="flex relative" style={{ width: totalW, height: DAY_HEADER_H }}>
        {days.map((d, i) => {
          const isWeekend = d.getDay() === 0 || d.getDay() === 6;
          const isToday = i === todayIdx;
          return (
            <div
              key={i}
              className={`flex-shrink-0 text-[10px] flex items-center justify-center tabular-nums ${
                isToday
                  ? 'text-foreground font-semibold'
                  : isWeekend
                    ? 'text-muted-foreground/40'
                    : 'text-muted-foreground'
              }`}
              style={{ width: DAY_W }}
            >
              {d.getDate()}
            </div>
          );
        })}
        {todayIdx >= 0 && (
          <div
            className="absolute top-1 w-1.5 h-1.5 rounded-full bg-[var(--accent-default)]"
            style={{ left: todayIdx * DAY_W + DAY_W / 2 - 3 }}
          />
        )}
      </div>
    </div>
  );
}

// =============================================================
// Object row — gradient band + milestones above
// =============================================================
function ObjectRow({
  obj,
  oid,
  elements,
  milestones,
  range,
  days,
  todayIdx,
  totalW,
  isOpen,
  onToggle,
  onAddMilestone,
  onMilestoneDelete,
}: {
  obj: AlconObject | null;
  oid: string;
  elements: ElementWithDetails[];
  milestones: ObjectMilestone[];
  range: { start: Date; end: Date } | null;
  days: Date[];
  todayIdx: number;
  totalW: number;
  isOpen: boolean;
  onToggle: () => void;
  onAddMilestone: () => void;
  onMilestoneDelete: (id: string) => void | Promise<void>;
}) {
  const bar = useMemo(() => (range ? rangeToBar(range, days) : null), [range, days]);

  return (
    <div
      className="flex items-stretch border-b border-border/30 group/row"
      style={{ height: OBJECT_ROW_H }}
    >
      {/* Sticky left meta */}
      <div
        className="sticky left-0 z-[1] bg-card flex items-center gap-1.5 pl-2 pr-3 border-r border-border/40 flex-shrink-0"
        style={{ width: LEFT_COL_W }}
      >
        <button
          type="button"
          onClick={onToggle}
          className="w-4 h-4 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
          aria-expanded={isOpen}
        >
          {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <ObjectIcon size={13} />
        <span className="text-[13px] font-medium text-foreground truncate flex-1">
          {obj?.name ?? `(${oid.slice(0, 6)})`}
        </span>
        <button
          type="button"
          onClick={onAddMilestone}
          className="opacity-0 group-hover/row:opacity-100 w-5 h-5 rounded text-muted-foreground hover:text-[var(--status-danger)] hover:bg-muted/40 flex items-center justify-center transition-all"
          title="Add milestone"
          aria-label="Add milestone"
        >
          <Plus size={11} />
        </button>
      </div>

      {/* Bar area */}
      <div className="relative flex-shrink-0" style={{ width: totalW, height: OBJECT_ROW_H }}>
        {/* Day grid */}
        {days.map((d, i) => {
          const isWeekend = d.getDay() === 0 || d.getDay() === 6;
          const isToday = i === todayIdx;
          return (
            <div
              key={i}
              className={`absolute top-0 bottom-0 border-r border-border/20 ${
                isToday ? 'bg-[var(--accent-subtle)]' : isWeekend ? 'bg-muted/10' : ''
              }`}
              style={{ left: i * DAY_W, width: DAY_W }}
            />
          );
        })}
        {todayIdx >= 0 && (
          <div
            className="absolute top-0 bottom-0 border-l border-[var(--accent-default)]/40"
            style={{ left: todayIdx * DAY_W + DAY_W / 2 }}
          />
        )}

        {/* Object band */}
        {bar && (
          <div
            className="absolute"
            style={{
              left: bar.left,
              width: Math.max(bar.width, 14),
              top: OBJECT_BAR_TOP,
              height: OBJECT_BAR_H,
              borderRadius: 7,
              background: 'linear-gradient(90deg, #0a0a0a 0%, #163964 100%)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              boxShadow:
                'inset 0 1px 0 rgba(255, 255, 255, 0.08), inset 0 -1px 0 rgba(0, 0, 0, 0.4)',
              overflow: 'hidden',
            }}
          >
            {/* Glossy top sheen */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  'linear-gradient(180deg, rgba(255, 255, 255, 0.07) 0%, rgba(255, 255, 255, 0.01) 45%, transparent 60%)',
              }}
            />
            <span
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-white/90 truncate pr-2"
              style={{ maxWidth: Math.max(bar.width - 16, 0) }}
            >
              {elements.length > 0 ? `${elements.length} elements` : 'No elements yet'}
            </span>
          </div>
        )}

        {/* Milestones above the band */}
        {milestones.map((m) => {
          const x = dateToX(m.date, days);
          if (x === null) return null;
          return (
            <MilestoneDiamond
              key={m.id}
              left={x}
              label={m.label}
              date={m.date}
              onDelete={() => onMilestoneDelete(m.id)}
            />
          );
        })}
      </div>
    </div>
  );
}

// =============================================================
// Diamond milestone marker
// =============================================================
function MilestoneDiamond({
  left,
  label,
  date,
  onDelete,
}: { left: number; label: string | null; date: string; onDelete: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      className="absolute"
      style={{ left, top: MILESTONE_BAND_TOP, transform: 'translateX(-50%)' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        onClick={onDelete}
        title={`${label ?? 'Milestone'} · ${date} (click to delete)`}
        aria-label="Milestone"
        className="block cursor-pointer"
      >
        <div
          style={{
            width: 11,
            height: 11,
            transform: 'rotate(45deg)',
            border: '2px solid var(--status-danger)',
            background: 'var(--card)',
          }}
        />
      </button>
      {hovered && label && (
        <div
          className="absolute left-1/2 -translate-x-1/2 -top-5 px-1.5 py-0.5 text-[10px] text-foreground bg-popover border border-border rounded shadow whitespace-nowrap z-30"
        >
          {label}
        </div>
      )}
    </div>
  );
}

// =============================================================
// Element sub-row (when an Object is expanded)
// =============================================================
function ElementRow({
  element,
  days,
  todayIdx,
  totalW,
}: {
  element: ElementWithDetails;
  days: Date[];
  todayIdx: number;
  totalW: number;
}) {
  const bar = useMemo(() => elementToBar(element, days), [element, days]);
  const color =
    SEMANTIC_COLORS.status[element.status as keyof typeof SEMANTIC_COLORS.status] ??
    SEMANTIC_COLORS.status.todo;
  const statusLabel = STATUS[element.status as keyof typeof STATUS]?.label ?? element.status ?? 'Todo';

  return (
    <div
      className="flex items-stretch border-b border-border/20 bg-muted/5 hover:bg-muted/10"
      style={{ height: ELEMENT_ROW_H }}
    >
      <div
        className="sticky left-0 z-[1] bg-card flex items-center gap-1.5 pr-3 border-r border-border/30 flex-shrink-0"
        style={{ width: LEFT_COL_W, paddingLeft: 36 }}
      >
        <span
          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{ background: color }}
          aria-hidden
        />
        <span className="text-[12px] text-foreground truncate flex-1">{element.title}</span>
      </div>
      <div className="relative flex-shrink-0" style={{ width: totalW, height: ELEMENT_ROW_H }}>
        {todayIdx >= 0 && (
          <div
            className="absolute top-0 bottom-0 border-l border-[var(--accent-default)]/25"
            style={{ left: todayIdx * DAY_W + DAY_W / 2 }}
          />
        )}
        {bar && (
          <div
            className="absolute rounded-[3px] text-[10px] text-white px-1.5 truncate"
            style={{
              left: bar.left,
              width: Math.max(bar.width, 12),
              top: (ELEMENT_ROW_H - ELEMENT_BAR_H) / 2,
              height: ELEMENT_BAR_H,
              background: color,
              lineHeight: `${ELEMENT_BAR_H}px`,
            }}
            title={`${element.title} · ${statusLabel}`}
          >
            {element.title}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyElementRow({ totalW }: { totalW: number }) {
  return (
    <div
      className="flex items-stretch border-b border-border/20 bg-muted/5"
      style={{ height: ELEMENT_ROW_H }}
    >
      <div
        className="sticky left-0 z-[1] bg-card flex items-center text-[11px] text-muted-foreground italic"
        style={{ width: LEFT_COL_W, paddingLeft: 36 }}
      >
        No Elements in this Object yet
      </div>
      <div className="flex-shrink-0" style={{ width: totalW, height: ELEMENT_ROW_H }} />
    </div>
  );
}

// =============================================================
// Add-milestone dialog
// =============================================================
function AddMilestoneDialog({
  objectName,
  onClose,
  onSubmit,
}: {
  objectName: string;
  onClose: () => void;
  onSubmit: (date: string, label: string | null) => Promise<void> | void;
}) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);

  useEscapeLayer(true, onClose);

  const submit = async () => {
    if (saving || !date) return;
    setSaving(true);
    try { await onSubmit(date, label.trim() || null); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-6" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-lg shadow-xl w-full max-w-sm flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-10 flex items-center px-4 border-b border-border/60">
          <span className="text-[13px] font-semibold text-foreground">
            Milestone · {objectName}
          </span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="block text-[11px] text-muted-foreground mb-1">Date</label>
            <DateField
              value={date || null}
              onChange={(v) => setDate(v ?? '')}
              placeholder="Pick a date"
              variant="secondary"
              size="md"
              block
              aria-label="Date"
            />
          </div>
          <div>
            <label className="block text-[11px] text-muted-foreground mb-1">
              Label <span className="text-muted-foreground/60">(optional)</span>
            </label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => {
                if (isCommitEnter(e)) {
                  e.preventDefault();
                  void submit();
                }
              }}
              placeholder="e.g. Beta launch"
              className="w-full bg-muted/30 rounded-md px-3 py-1.5 text-[13px] text-foreground border-none outline-none"
              autoFocus
            />
          </div>
        </div>
        <div className="h-12 flex items-center justify-end gap-2 px-4 border-t border-border/60">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-md text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted/30"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!date || saving}
            className="px-3 py-1.5 rounded-md text-[12px] font-medium bg-foreground text-background hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}

// =============================================================
// Helpers
// =============================================================

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function stripTime(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

/** X coord (center) of a YYYY-MM-DD date within the visible day grid,
 *  or null if the date is outside the window. */
function dateToX(iso: string, days: Date[]): number | null {
  if (days.length === 0) return null;
  const d = stripTime(new Date(iso));
  const start = days[0];
  const end = days[days.length - 1];
  if (d < start || d > end) return null;
  const dayIdx = Math.round((d.getTime() - start.getTime()) / DAY_MS);
  return dayIdx * DAY_W + DAY_W / 2;
}

function rangeToBar(
  range: { start: Date; end: Date },
  days: Date[],
): { left: number; width: number } | null {
  if (days.length === 0) return null;
  const windowStart = days[0];
  const windowEnd = days[days.length - 1];
  const start = stripTime(range.start);
  const end = stripTime(range.end);
  if (end < windowStart || start > windowEnd) return null;
  const clampedStart = start < windowStart ? windowStart : start;
  const clampedEnd = end > windowEnd ? windowEnd : end;
  const offsetDays = Math.max(
    0,
    Math.floor((clampedStart.getTime() - windowStart.getTime()) / DAY_MS),
  );
  const spanDays = Math.max(
    1,
    Math.floor((clampedEnd.getTime() - clampedStart.getTime()) / DAY_MS) + 1,
  );
  return { left: offsetDays * DAY_W, width: spanDays * DAY_W };
}

function elementToBar(
  el: ElementWithDetails,
  days: Date[],
): { left: number; width: number } | null {
  const s = el.start_date ? new Date(el.start_date) : null;
  const d = el.due_date ? new Date(el.due_date) : null;
  if (!s && !d) return null;
  return rangeToBar({ start: s ?? d!, end: d ?? s! }, days);
}

/** Derive an Object's overall span: union of all its Elements' dates. */
function objectDateRange(
  elements: ElementWithDetails[],
): { start: Date; end: Date } | null {
  let min: Date | null = null;
  let max: Date | null = null;
  for (const el of elements) {
    const s = el.start_date ? new Date(el.start_date) : null;
    const d = el.due_date ? new Date(el.due_date) : null;
    if (s && (!min || s < min)) min = s;
    if (d && (!max || d > max)) max = d;
    if (!min && d) min = d;
    if (!max && s) max = s;
  }
  if (!min || !max) return null;
  return { start: stripTime(min), end: stripTime(max) };
}

// =============================================================
// StrategyOverviewTimelineView — Portfolio-level timeline. Shows ONE
// row per Strategy (not per Object), with the bar spanning the union
// of every Element under that Strategy's Objects. Click the Strategy
// name to drill into its Object-level timeline.
// =============================================================
export function StrategyOverviewTimelineView({
  strategies,
  onSelectStrategy,
}: {
  strategies: StrategyWithObjects[];
  onSelectStrategy: (id: string) => void;
}) {
  const [elementsByStrategy, setElementsByStrategy] = useState<Map<string, ElementWithDetails[]>>(new Map());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (strategies.length === 0) { setElementsByStrategy(new Map()); return; }
    setLoading(true);
    Promise.all(
      strategies.map(async (s) => {
        if (s.objectIds.length === 0) return [s.id, [] as ElementWithDetails[]] as const;
        const res = await fetchStrategyElements({ domainIds: [], objectIds: s.objectIds });
        return [s.id, res.elements] as const;
      }),
    )
      .then((pairs) => {
        if (cancelled) return;
        setElementsByStrategy(new Map(pairs));
      })
      .catch((e) => console.error('StrategyOverviewTimelineView fetch failed:', e))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [strategies]);

  const [anchorOffset, setAnchorOffset] = useState(0);
  const anchorDate = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    t.setDate(t.getDate() - PAST_DAYS + anchorOffset);
    return t;
  }, [anchorOffset]);

  const days = useMemo(() => {
    const arr: Date[] = [];
    for (let i = 0; i < VISIBLE_DAYS; i++) {
      const d = new Date(anchorDate);
      d.setDate(d.getDate() + i);
      arr.push(d);
    }
    return arr;
  }, [anchorDate]);

  const todayIdx = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return days.findIndex((d) => sameDay(d, t));
  }, [days]);

  const rows = useMemo(() => {
    return strategies.map((s) => {
      const els = elementsByStrategy.get(s.id) ?? [];
      const range = objectDateRange(els);
      return { strategy: s, els, range };
    });
  }, [strategies, elementsByStrategy]);

  const totalW = DAY_W * VISIBLE_DAYS;

  return (
    <div className="flex flex-col h-full">
      {/* Mini header — week nav + today */}
      <div className="h-8 flex items-center gap-1 px-4 border-b border-border/40 bg-card flex-shrink-0">
        <button
          type="button"
          onClick={() => setAnchorOffset((o) => o - 7)}
          className="w-[24px] h-[24px] rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 flex items-center justify-center"
          aria-label="Back one week"
        >
          <ChevronRight size={12} className="-rotate-180" />
        </button>
        <button
          type="button"
          onClick={() => setAnchorOffset(() => 0)}
          className={`px-2 h-[22px] rounded-md text-[11px] transition-colors ${
            anchorOffset === 0
              ? 'bg-muted/60 text-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
          }`}
        >
          Today
        </button>
        <button
          type="button"
          onClick={() => setAnchorOffset((o) => o + 7)}
          className="w-[24px] h-[24px] rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 flex items-center justify-center"
          aria-label="Forward one week"
        >
          <ChevronRight size={12} />
        </button>
        <span className="text-[11px] text-muted-foreground ml-2">
          {loading ? 'Loading…' : `${rows.length} strateg${rows.length === 1 ? 'y' : 'ies'}`}
        </span>
      </div>

      {/* Scrolling grid */}
      <div className="flex-1 overflow-auto">
        <div className="min-w-fit">
          <DateHeader days={days} todayIdx={todayIdx} totalW={totalW} />
          {rows.map((r) => (
            <StrategyRow
              key={r.strategy.id}
              strategy={r.strategy}
              elements={r.els}
              range={r.range}
              days={days}
              todayIdx={todayIdx}
              totalW={totalW}
              onSelect={() => onSelectStrategy(r.strategy.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// One row per Strategy — same visual idiom as ObjectRow but the bar
// represents the Strategy's whole span and the label says "N objects".
function StrategyRow({
  strategy,
  elements,
  range,
  days,
  todayIdx,
  totalW,
  onSelect,
}: {
  strategy: StrategyWithObjects;
  elements: ElementWithDetails[];
  range: { start: Date; end: Date } | null;
  days: Date[];
  todayIdx: number;
  totalW: number;
  onSelect: () => void;
}) {
  const bar = useMemo(() => (range ? rangeToBar(range, days) : null), [range, days]);

  return (
    <div
      className="flex items-stretch border-b border-border/30 group/row cursor-pointer hover:bg-muted/10 transition-colors"
      style={{ height: OBJECT_ROW_H }}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onSelect(); }}
    >
      <div
        className="sticky left-0 z-[1] bg-card flex items-center gap-1.5 pl-2 pr-3 border-r border-border/40 flex-shrink-0 group-hover/row:bg-muted/10"
        style={{ width: LEFT_COL_W }}
      >
        <span className="w-4 h-4 inline-flex items-center justify-center text-muted-foreground">
          <NavStrategyIcon size={12} />
        </span>
        <span className="text-[13px] font-medium text-foreground truncate flex-1">
          {strategy.name}
        </span>
        <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
          {strategy.objectIds.length}
        </span>
      </div>

      <div className="relative flex-shrink-0" style={{ width: totalW, height: OBJECT_ROW_H }}>
        {days.map((d, i) => {
          const isWeekend = d.getDay() === 0 || d.getDay() === 6;
          const isToday = i === todayIdx;
          return (
            <div
              key={i}
              className={`absolute top-0 bottom-0 border-r border-border/20 ${
                isToday ? 'bg-[var(--accent-subtle)]' : isWeekend ? 'bg-muted/10' : ''
              }`}
              style={{ left: i * DAY_W, width: DAY_W }}
            />
          );
        })}
        {todayIdx >= 0 && (
          <div
            className="absolute top-0 bottom-0 border-l border-[var(--accent-default)]/40"
            style={{ left: todayIdx * DAY_W + DAY_W / 2 }}
          />
        )}

        {bar && (
          <div
            className="absolute"
            style={{
              left: bar.left,
              width: Math.max(bar.width, 14),
              top: OBJECT_BAR_TOP,
              height: OBJECT_BAR_H,
              borderRadius: 7,
              background: 'linear-gradient(90deg, #0a0a0a 0%, #163964 100%)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              boxShadow:
                'inset 0 1px 0 rgba(255, 255, 255, 0.08), inset 0 -1px 0 rgba(0, 0, 0, 0.4)',
              overflow: 'hidden',
            }}
          >
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  'linear-gradient(180deg, rgba(255, 255, 255, 0.07) 0%, rgba(255, 255, 255, 0.01) 45%, transparent 60%)',
              }}
            />
            <span
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-white/90 truncate pr-2"
              style={{ maxWidth: Math.max(bar.width - 16, 0) }}
            >
              {strategy.objectIds.length} object{strategy.objectIds.length === 1 ? '' : 's'} · {elements.length} elements
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
