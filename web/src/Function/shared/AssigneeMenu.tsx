'use client';

import * as React from 'react';
import { Check, X } from 'lucide-react';
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/ui/dropdown-menu';
import { useWorkerAvailability, useWorkerCommitments } from '@/hooks/useSupabase';
import { formatElementDate, fromDateOnlyString, toDateOnlyString } from '@/Function/shared/dateUtils';
import {
  elementSpan,
  readAssignment,
  type AssignmentReading,
  type DaySpan,
  type LoadElement,
} from '@/Function/shared/assignmentLoad';
import { ReachHint, WorkerAvatar, type WorkerAvatarSubject } from './WorkerAvatar';

// Single source of truth for the assignee picker dropdown CONTENT. Triggers
// legitimately differ per view (avatar stack in table rows, RailRow in the
// detail panel, a lone avatar on board cards) — so this wraps only the
// DropdownMenuContent. Usage:
//
//   <DropdownMenu>
//     <DropdownMenuTrigger>…view-specific trigger…</DropdownMenuTrigger>
//     <AssigneeMenuContent assignees={…} workers={…} onAdd={…} onRemove={…} />
//   </DropdownMenu>
//
// Pass `element` and each name carries what taking this Element does to that
// Worker's days. The warning never gates the click: overloading somebody is a
// decision a company makes on purpose when there is nobody else, and the board
// exists to say so out loud, not to veto it.

/** Structural subset of ElementAssigneeWithWorker — keeps this component
 *  decoupled from the data layer. */
export interface AssigneeEntry {
  id: string;
  worker_id?: string | null;
  worker?: (WorkerAvatarSubject & { id?: string }) | null;
}

export interface AssignableWorker extends WorkerAvatarSubject {
  id: string;
  /** Set when the caller passes whole Workers — they decide the standing day.
   *  A picker built from avatar-shaped stubs still renders, without load. */
  type?: 'human' | 'ai_agent' | 'robot';
  capacity_hours_per_day?: number | null;
}

interface AssigneeMenuContentProps
  extends Omit<React.ComponentProps<typeof DropdownMenuContent>, 'children'> {
  assignees?: AssigneeEntry[] | null;
  /** Full worker list — the available (not yet assigned) set is derived here. */
  workers: AssignableWorker[];
  /** The Element being staffed. Its start / due dates are the window every
   *  load reading is taken over; without them there is no period to measure,
   *  so the menu stays as it was. */
  element?: LoadElement | null;
  onAdd: (workerId: string) => void;
  onRemove: (assigneeId: string) => void;
  /** 'add-remove' (default): current assignees (X to remove) above the
   *  available workers. 'toggle': one list of all workers, a check marks
   *  assigned, clicking toggles — the board-card interaction. */
  variant?: 'add-remove' | 'toggle';
}

export function AssigneeMenuContent({
  assignees,
  workers,
  element,
  onAdd,
  onRemove,
  variant = 'add-remove',
  ...contentProps
}: AssigneeMenuContentProps) {
  const current = assignees ?? [];
  const assigneeWorkerId = (a: AssigneeEntry) => a.worker_id ?? a.worker?.id;
  const readings = useAssignmentReadings(element, workers);

  if (variant === 'toggle') {
    return (
      <DropdownMenuContent {...contentProps}>
        {workers.length === 0 && (
          <div className="px-2 py-1.5 text-[12px] text-muted-foreground">No workers</div>
        )}
        {workers.map((w) => {
          const existing = current.find((a) => assigneeWorkerId(a) === w.id);
          return (
            <DropdownMenuItem
              key={w.id}
              onClick={() => (existing ? onRemove(existing.id) : onAdd(w.id))}
              className="gap-2 text-[13px]"
            >
              <WorkerAvatar worker={w} size={20} />
              <span className="flex-1 truncate">{w.name}</span>
              <ReachHint worker={w} />
              <LoadHint reading={readings[w.id]} name={w.name} />
              {existing && <Check size={12} className="text-muted-foreground" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    );
  }

  const assignedIds = new Set(current.map(assigneeWorkerId).filter(Boolean));
  const available = workers.filter((w) => !assignedIds.has(w.id));

  return (
    <DropdownMenuContent {...contentProps}>
      {current.length > 0 && (
        <>
          {current.map((a) => {
            const workerId = assigneeWorkerId(a);
            return (
              <DropdownMenuItem
                key={a.id}
                onClick={() => onRemove(a.id)}
                className="flex items-center gap-2 text-[12px]"
              >
                <WorkerAvatar worker={a.worker} size={20} />
                <span className="flex-1 truncate">{a.worker?.name}</span>
                <ReachHint worker={a.worker} />
                <LoadHint
                  reading={workerId ? readings[workerId] : undefined}
                  name={a.worker?.name}
                />
                <X size={12} className="text-muted-foreground shrink-0" />
              </DropdownMenuItem>
            );
          })}
          {available.length > 0 && <DropdownMenuSeparator />}
        </>
      )}
      {available.length > 0 ? (
        available.map((w) => (
          <DropdownMenuItem
            key={w.id}
            onClick={() => onAdd(w.id)}
            className="flex items-center gap-2 text-[12px]"
          >
            <WorkerAvatar worker={w} size={20} />
            <span className="flex-1 truncate">{w.name}</span>
            <ReachHint worker={w} />
            <LoadHint reading={readings[w.id]} name={w.name} />
          </DropdownMenuItem>
        ))
      ) : workers.length === 0 ? (
        <div className="px-3 py-2 text-[12px] text-muted-foreground">Loading...</div>
      ) : (
        <div className="px-3 py-2 text-[12px] text-muted-foreground">All assigned</div>
      )}
    </DropdownMenuContent>
  );
}

/** Nothing to report reads as nothing at all — a row that says "fine" on every
 *  Worker teaches the eye to skip the column the one time it fires.
 *
 *  Left on a bare `title` deliberately (ELE_QLT-036 considered and excluded
 *  it): unlike the unreachable ring on an icon-only avatar, this hint's own
 *  short text ("Away 2d") is already visible and already reachable by a
 *  screen reader — the `title` only adds the longer explanation a sighted
 *  hover gets. That is a smaller gap than an avatar whose only signal is a
 *  dashed line nothing announces, and the same pattern recurs in enough
 *  other detail-on-hover spots that closing it everywhere is its own,
 *  larger piece of work. */
function LoadHint({
  reading,
  name,
}: {
  reading: AssignmentReading | undefined;
  name?: string | null;
}) {
  if (!reading) return null;
  const label = hintLabel(reading);
  if (!label) return null;
  return (
    <span
      className="shrink-0 text-[11px] tabular-nums"
      style={{ color: reading.awayDays > 0 ? 'var(--status-danger)' : 'var(--status-warning)' }}
      title={hintDetail(reading, name)}
    >
      {label}
    </span>
  );
}

/** Days with no hours lead: work booked onto an absence is the harder fact,
 *  and it is the one nothing on the board could state before. The overload
 *  joins it only when it reaches past the absence. */
function hintLabel(reading: AssignmentReading): string | null {
  const { awayDays, overDays } = reading;
  if (awayDays > 0 && overDays > awayDays) return `Away ${awayDays}d · over ${overDays}d`;
  if (awayDays > 0) return `Away ${awayDays}d`;
  if (overDays > 0) return `Over ${overDays}d`;
  return null;
}

function hintDetail(reading: AssignmentReading, name?: string | null): string {
  const who = name ?? 'This Worker';
  const parts = [`${who} · ${rangeLabel(reading.span)} · adds ${hours(reading.perDay)}h a day`];
  for (const run of reading.awayRuns) parts.push(`no hours ${rangeLabel(run)}`);
  if (reading.overDays > 0) {
    const already = reading.overDaysBefore > 0
      ? `, ${reading.overDaysBefore} of them already over`
      : '';
    parts.push(
      `over capacity on ${reading.overDays} ${dayWord(reading.overDays)}${already}`
      + ` · worst day ${hours(reading.worstOver)}h past`,
    );
  }
  return parts.join(' · ');
}

function rangeLabel(span: DaySpan): string {
  const from = formatElementDate(fromDateOnlyString(span.start), 'short') ?? span.start;
  if (span.start === span.end) return from;
  const to = formatElementDate(fromDateOnlyString(span.end), 'short') ?? span.end;
  return `${from} – ${to}`;
}

function dayWord(n: number): string {
  return n === 1 ? 'day' : 'days';
}

/** One decimal, and none when the number is whole — `4h` rather than `4.0h`. */
function hours(value: number): string {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}

const NO_WORKER_IDS: string[] = [];

/**
 * The load reading for every Worker in the picker, keyed by Worker id.
 *
 * Both fetches run off the same id list and only while the menu is mounted —
 * Radix unmounts the content when the dropdown closes, so nothing is read until
 * somebody is actually looking at the picker. An Element with no dates asks for
 * nothing: the map stays empty and no request goes out.
 */
function useAssignmentReadings(
  element: LoadElement | null | undefined,
  workers: readonly AssignableWorker[],
): Record<string, AssignmentReading> {
  const dated = element && elementSpan(element) ? element : null;
  const workerIds = React.useMemo(
    () => (dated ? workers.map((w) => w.id) : NO_WORKER_IDS),
    [dated, workers],
  );
  const { byWorker: availability } = useWorkerAvailability(workerIds);
  const commitments = useWorkerCommitments(workerIds);

  return React.useMemo(() => {
    const out: Record<string, AssignmentReading> = {};
    if (!dated) return out;
    const today = toDateOnlyString(new Date());
    for (const w of workers) {
      const reading = readAssignment({
        worker: {
          type: w.type ?? 'human',
          capacity_hours_per_day: w.capacity_hours_per_day ?? null,
        },
        spans: availability[w.id] ?? [],
        committed: commitments[w.id] ?? [],
        element: dated,
        today,
      });
      if (reading) out[w.id] = reading;
    }
    return out;
  }, [dated, workers, availability, commitments]);
}
