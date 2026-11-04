'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { selectIn } from '@/hooks/chunkedIn';
import { fetchStrategyElements, fetchWorkerAvailability } from '@/hooks/useSupabase';
import {
  computeInitiativeRisk,
  parseRiskThresholds,
  type InitiativeRiskOptions,
  type InitiativeRiskReport,
  type RiskElement,
  type RiskObject,
} from '@/Function/strategy/initiativeRiskModel';
import {
  computeBusFactor,
  type BusElement,
  type BusWorkerInput,
  type InitiativeBusFactor,
} from '@/Function/strategy/initiativeBusFactorModel';
import type { AlconObject, ElementWithDetails } from '@/types/database';
import type { CapacitySpan } from '@/Function/shared/workerCapacity';

// =============================================================
// The read side of <InitiativeRisk>. Everything a Strategy's cross-section
// needs, in one place, so no other surface has to grow a column for it.
//
// Deliberately not a new query in `hooks/useSupabase.ts`: the Object scope
// resolution and the Element fetch already exist there (`fetchStrategyElements`
// is what the Workload surface uses), and the only genuinely new read is the
// progress-comment heartbeat.
// =============================================================

export interface InitiativeRiskState {
  elements: ElementWithDetails[];
  objects: AlconObject[];
  report: InitiativeRiskReport | null;
  /** Who the Strategy's open work rests on alone. Null on the same terms as
   *  `report` — the two are read from one fetch and arrive together. */
  busFactor: InitiativeBusFactor | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

interface InitiativeRiskData {
  elements: ElementWithDetails[];
  objects: AlconObject[];
  report: InitiativeRiskReport;
  busFactor: InitiativeBusFactor;
}

/** Newest progress comment per Element — the heartbeat `isStalled` reads.
 *  Shared with useInitiativeHealth so the list and the page read one pulse. */
export async function fetchLastProgressAt(elementIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (elementIds.length === 0) return out;
  // Chunked: a Space-wide list hands this every Element on the board, and
  // one `.in()` over 249 ids measured a 9.8KB request line — past the budget
  // chunkedIn.ts exists to respect. The max-per-Element reduce below does not
  // care which chunk a row arrived in.
  const data = await selectIn(elementIds, (chunk) =>
    supabase.from('element_comments').select('element_id, created_at').in('element_id', chunk),
  );
  for (const row of (data ?? []) as { element_id: string; created_at: string }[]) {
    const t = Date.parse(row.created_at);
    if (Number.isNaN(t)) continue;
    const seen = out.get(row.element_id);
    if (seen === undefined || t > seen) out.set(row.element_id, t);
  }
  return out;
}

/** The model's view of a row. One mapping, so the list and the page cannot
 *  drift into two definitions of what an Element's Objects or people are. */
export function toRiskElements(
  elements: ElementWithDetails[],
  heartbeats: Map<string, number>,
): RiskElement[] {
  return elements.map((el) => ({
    id: el.id,
    display_id: el.display_id,
    title: el.title,
    status: el.status,
    due_date: el.due_date,
    updated_at: el.updated_at,
    objectIds: el.objectIds ?? (el.object_id ? [el.object_id] : []),
    assignees: (el.assignees ?? [])
      .map((a) => a.worker)
      .filter((w): w is NonNullable<typeof w> => !!w)
      .map((w) => ({ id: w.id, name: w.name })),
    lastProgressAt: heartbeats.get(el.id) ?? null,
  }));
}

/**
 * Each Object is judged by its own Domain's thresholds (Settings > Elements >
 * SLAs). One read for the distinct Domains in scope; a Domain with nothing set
 * (or one RLS hides) simply gets the model's defaults. Shared with
 * useInitiativeHealth so a list row and the page it opens judge "stalled" by
 * the same number — a row that alarms while its page says nothing is worse
 * than no row at all.
 */
export async function fetchDomainThresholds(
  objects: Pick<AlconObject, 'domain_id'>[],
): Promise<Map<string, InitiativeRiskOptions>> {
  const domainIds = Array.from(
    new Set(objects.map((o) => o.domain_id).filter((d): d is string => typeof d === 'string' && d.length > 0)),
  );
  const out = new Map<string, InitiativeRiskOptions>();
  if (domainIds.length === 0) return out;
  const rows = await selectIn(domainIds, (chunk) =>
    supabase.from('domains').select('id, risk_thresholds').in('id', chunk),
  );
  for (const row of (rows ?? []) as { id: string; risk_thresholds: unknown }[]) {
    out.set(row.id, parseRiskThresholds(row.risk_thresholds));
  }
  return out;
}

/** The Objects the model judges, in the caller's order, with their Domain's thresholds attached. */
export function toRiskObjects(
  objectIds: string[],
  byId: Map<string, AlconObject>,
  thresholdsByDomain: Map<string, InitiativeRiskOptions>,
): RiskObject[] {
  return objectIds
    .map((id) => byId.get(id))
    .filter((o): o is AlconObject => o !== undefined)
    .map((o) => ({
      id: o.id,
      name: o.name,
      domainId: o.domain_id,
      thresholds: o.domain_id ? thresholdsByDomain.get(o.domain_id) : undefined,
    }));
}

async function loadInitiativeRisk(
  initiativeId: string,
  options: InitiativeRiskOptions,
): Promise<InitiativeRiskData> {
  const now = new Date();
  const { data: links, error: linkErr } = await supabase
    .from('strategy_objects')
    .select('object_id')
    .eq('strategy_id', initiativeId);
  if (linkErr) throw linkErr;

  const objectIds = ((links ?? []) as { object_id: string }[]).map((l) => l.object_id);
  if (objectIds.length === 0) {
    return {
      elements: [],
      objects: [],
      report: computeInitiativeRisk([], [], now.getTime(), options),
      busFactor: computeBusFactor([], [], now),
    };
  }

  const { elements, objects } = await fetchStrategyElements({ domainIds: [], objectIds });

  // The Strategy's Object scope, in the order the Strategy links them —
  // `fetchStrategyElements` returns Objects in whatever order Postgres hands
  // them back, and a findings list that reshuffles between refreshes is
  // unreadable.
  const byId = new Map(objects.map((o) => [o.id, o]));

  const thresholdsByDomain = await fetchDomainThresholds(objects);
  const scope = toRiskObjects(objectIds, byId, thresholdsByDomain);

  // Bus factor reads the same Elements through a different lens, so it takes
  // the seats rather than the resolved Workers: a name on the Element whose
  // Worker row did not come back is still a second person on it.
  const inScope = new Set(scope.map((o) => o.id));
  const seats: BusElement[] = elements
    .filter((el) =>
      (el.objectIds ?? (el.object_id ? [el.object_id] : [])).some((id) => inScope.has(id)),
    )
    .map((el) => ({
      id: el.id,
      status: el.status,
      dueDate: el.due_date,
      workerIds: (el.assignees ?? []).map((a) => a.worker_id),
    }));

  // Only the Workers who could turn out to be alone on something need a
  // calendar read; everyone else has cover and their absences change nothing
  // here. Closed Elements are left in — the model decides what is open, and
  // repeating that list here would give "open" a second definition.
  const soleCandidates = Array.from(
    new Set(seats.filter((el) => new Set(el.workerIds).size === 1).map((el) => el.workerIds[0])),
  );

  const [heartbeats, spans] = await Promise.all([
    fetchLastProgressAt(elements.map((el) => el.id)),
    fetchWorkerAvailability(soleCandidates),
  ]);

  const rows = toRiskElements(elements, heartbeats);

  const spansByWorker = new Map<string, CapacitySpan[]>();
  for (const span of spans) {
    const held = spansByWorker.get(span.worker_id);
    if (held) held.push(span);
    else spansByWorker.set(span.worker_id, [span]);
  }

  const workerById = new Map(
    elements
      .flatMap((el) => el.assignees ?? [])
      .map((a) => a.worker)
      .filter((w): w is NonNullable<typeof w> => !!w)
      .map((w) => [w.id, w]),
  );
  const busWorkers: BusWorkerInput[] = soleCandidates.map((id) => {
    const worker = workerById.get(id);
    return {
      id,
      name: worker?.name ?? 'Unknown Worker',
      worker: worker
        ? { type: worker.type, capacity_hours_per_day: worker.capacity_hours_per_day }
        : null,
      spans: spansByWorker.get(id) ?? [],
    };
  });

  return {
    elements,
    objects,
    report: computeInitiativeRisk(scope, rows, now.getTime(), options),
    busFactor: computeBusFactor(seats, busWorkers, now),
  };
}

export function useInitiativeRisk(
  initiativeId: string | null,
  options: InitiativeRiskOptions = {},
): InitiativeRiskState {
  const { stallMinutes, idleHours, concentrationThreshold } = options;

  const query = useQuery({
    queryKey: ['initiativeRisk', initiativeId, stallMinutes, idleHours, concentrationThreshold],
    queryFn: () =>
      loadInitiativeRisk(initiativeId as string, { stallMinutes, idleHours, concentrationThreshold }),
    enabled: initiativeId !== null,
    // Every number in the report is measured against the clock at the moment
    // it was computed, so a cached one ages into a lie — "quiet for 3h" served
    // from yesterday's cache reads as fresh. Refetch on every mount, and keep
    // it out of the 24h persisted cache the other queries live in.
    staleTime: 0,
    gcTime: 60_000,
  });

  return {
    elements: query.data?.elements ?? [],
    objects: query.data?.objects ?? [],
    report: query.data?.report ?? null,
    busFactor: query.data?.busFactor ?? null,
    loading: query.isLoading,
    error: (query.error as Error | null) ?? null,
    refetch: query.refetch,
  };
}
