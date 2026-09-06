'use client';

import { InitiativeMeasureEditor } from './InitiativeMeasureEditor';
import { useMemo } from 'react';
import { useStrategies } from '@/hooks/useSupabase';
import { useInitiativeMeasures } from '@/hooks/useInitiativeMeasures';
import { useInitiativeIntentContext } from '@/alcon/element/actions/InitiativeIntent';
import { isMeasure } from '@/alcon/element/actions/initiativeMeasureModel';
import { NavStrategyIcon } from '@/shell/sidebar/NavIcons';
import {
  measureStateLabel,
  targetLabel,
  formatMeasureValue,
  type Measure,
} from '@/alcon/element/actions/initiativeMeasureModel';
import { useWidgetEmpty, useWidgetMeta } from '../WidgetFrame';
import { objectiveTree, toMeasureInput, type Objective } from './strategyFrameworkModel';
import type { WidgetHost } from '../types';

// =============================================================
// OKR — the Initiative cascade, with its measures read as key results.
//
// Nothing here is stored. An Objective is a Initiative, its sub-Objectives are
// the Initiatives nested under it, and its key results are that Initiative's
// measures — rows that already carry a target, a reading, a unit and a
// direction. The lens adds one claim the Measures section cannot make: an
// Objective that states no key result at all, which is the classic OKR failure
// and is invisible when you are looking at a list of the measures that exist.
//
// No blended score. `initiativeMeasureModel` refuses to rank misses by magnitude
// because the units belong to the operator, and averaging key results into an
// attainment percentage is that same invented comparison with a % after it.
// =============================================================

export function FrameworkOkrWidget({ host }: { host: WidgetHost }) {
  const rootId = host.subject.id ?? '';
  const { data: strategies } = useStrategies();

  const initiatives = useMemo(
    () => strategies.map((s) => ({ id: s.id, name: s.name, parentIds: s.parentIds })),
    [strategies],
  );

  // The root plus everything nested under it — the ids whose measures the
  // cascade needs, resolved before the measures are asked for.
  const treeIds = useMemo(() => {
    const childrenOf = new Map<string, string[]>();
    for (const c of initiatives) {
      for (const p of c.parentIds) childrenOf.set(p, [...(childrenOf.get(p) ?? []), c.id]);
    }
    const ids: string[] = [];
    const seen = new Set<string>();
    const walk = (id: string) => {
      if (seen.has(id)) return;
      seen.add(id);
      ids.push(id);
      for (const child of childrenOf.get(id) ?? []) walk(child);
    };
    if (rootId) walk(rootId);
    return ids;
  }, [initiatives, rootId]);

  // The root's own measures come from the surface's shared Intent bundle,
  // which the Measures section refetches after every write — a private fetch
  // would leave this lens disagreeing with the section directly above it
  // until the page remounted. Only the nested Initiatives need asking for, and
  // those cannot be edited from this page.
  const initiative = useInitiativeIntentContext();
  const descendantIds = useMemo(() => treeIds.filter((id) => id !== rootId), [treeIds, rootId]);
  const { measures: descendantMeasures, loading, error } = useInitiativeMeasures(descendantIds);

  const objectives = useMemo(() => {
    const rootMeasures = (initiative?.data?.subs ?? []).filter((i) => isMeasure(i.kind));
    const byInitiative = new Map<string, ReturnType<typeof toMeasureInput>[]>();
    for (const row of [...rootMeasures, ...descendantMeasures]) {
      byInitiative.set(row.strategy_id, [
        ...(byInitiative.get(row.strategy_id) ?? []),
        toMeasureInput(row),
      ]);
    }
    return objectiveTree(rootId, initiatives, byInitiative);
  }, [initiative?.data?.subs, descendantMeasures, initiatives, rootId]);

  const unstated = objectives.filter((o) => !o.stated).length;
  useWidgetMeta(
    objectives.length === 0 ? null
    : unstated > 0 ? `${unstated} without key results`
    : `${objectives.length} objective${objectives.length === 1 ? '' : 's'}`,
  );
  useWidgetEmpty(!error && (loading || objectives.length === 0));

  if (error) {
    return (
      <p className="px-3 py-2 text-[12px] text-[var(--status-danger)]">
        Could not read this Initiative&apos;s key results.
      </p>
    );
  }
  if (objectives.length === 0) return null;

  return (
    <div className="py-1">
      {objectives.map((objective) => (
        <ObjectiveRow
          key={objective.id}
          objective={objective}
          isRoot={objective.id === rootId}
          onOpen={
            objective.id === rootId
              ? undefined
              : () => host.onNavigate?.({ strategyId: objective.id })
          }
        />
      ))}
    </div>
  );
}

function ObjectiveRow({
  objective,
  isRoot,
  onOpen,
}: {
  objective: Objective;
  isRoot: boolean;
  onOpen?: () => void;
}) {
  const { tally } = objective;
  return (
    // The cascade is drawn with an indent and a rule down the left rather than
    // connector strokes: depth here is at most a handful of levels, and a rule
    // reads as "these hang off that" without a second geometry to maintain.
    <div
      className={objective.depth > 0 ? 'pl-4 ml-3 border-l border-[var(--border-subtle)]' : ''}
    >
      <div className="flex items-baseline gap-2 px-3 py-1.5">
        <NavStrategyIcon size={12} className="shrink-0 translate-y-px text-muted-foreground" />
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            className="min-w-0 flex-1 truncate text-left text-[13px] font-medium text-foreground/90 hover:underline"
          >
            {objective.name}
          </button>
        ) : (
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground/90">
            {objective.name}
          </span>
        )}
        {/* The tally, never an average. Each band is named because "2 failing"
            and "2 unread" call for different things. */}
        {objective.stated ? (
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {tally.met}/{tally.total} met
            {tally.missed > 0 && (
              <span className="ml-1.5 text-[var(--status-danger)]">· {tally.missed} missed</span>
            )}
            {tally.unmeasured > 0 && (
              <span className="ml-1.5 text-[var(--status-warning)]">
                · {tally.unmeasured} unread
              </span>
            )}
          </span>
        ) : (
          <span className="shrink-0 text-[11px] text-[var(--status-warning)]">
            No key results
          </span>
        )}
      </div>

      {!objective.stated && isRoot && (
        <p className="px-3 pb-1.5 text-[11px] leading-5 text-muted-foreground">
          Nothing here says how this Initiative would be judged. Record a condition in Measures and
          it becomes a key result.
        </p>
      )}

      <InitiativeMeasureEditor initiativeId={objective.id} initiativeName={objective.name}>
        {objective.keyResults.map((kr) => (
          <KeyResultRow key={kr.id} measure={kr} />
        ))}
      </InitiativeMeasureEditor>
    </div>
  );
}

const STATE_TONE: Record<Measure['state'], string> = {
  met: 'text-[var(--status-success)]',
  missed: 'text-[var(--status-danger)]',
  unmeasured: 'text-[var(--status-warning)]',
  unstated: 'text-muted-foreground',
};

function KeyResultRow({ measure }: { measure: Measure }) {
  const target = targetLabel(measure);
  const reading = formatMeasureValue(measure.actual, measure.unit);
  return (
    <div className="flex items-baseline gap-2 px-3 py-1 pl-8">
      <span className="min-w-0 flex-1 truncate text-[12px] text-foreground/80">
        {measure.title}
      </span>
      {target && (
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{target}</span>
      )}
      <span className={`shrink-0 text-[11px] tabular-nums ${STATE_TONE[measure.state]}`}>
        {reading ?? measureStateLabel(measure.state)}
      </span>
    </div>
  );
}
