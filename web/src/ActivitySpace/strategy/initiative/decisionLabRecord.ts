import type { DecisionLabComparison, DecisionLabInput, DecisionLabScenario } from './decisionLabModel';
import { displayIdOf } from '@/ActivitySpace/execution/element/displayId';

/** A readable decision, stored with the existing Intent record, not widget configuration. */
export function decisionLabRecord(input: DecisionLabInput, comparison: DecisionLabComparison, scenario: DecisionLabScenario, label: string, reason: string) {
  const targetId = scenario.focusElementId ?? scenario.deferElementId ?? scenario.reassignElementId;
  const target = input.elements.find((element) => element.id === targetId);
  const names = new Map(input.elements.map((element) => [element.id, `${displayIdOf(element) ?? element.id} · ${element.title}`]));
  const changed = comparison.changes.filter((change) => change.change !== 'unchanged');
  const sacrificed = changed.filter((change) => change.change === 'worsened');
  const row = (change: (typeof changed)[number]) => `${names.get(change.elementId) ?? change.elementId}: ${change.before.finish ?? 'Unestimated'} → ${change.after.finish ?? 'Unestimated'}${change.after.reason ? ` (${change.after.reason})` : ''}${change.after.inScope ? '' : ' [outside Initiative]'}`;
  return {
    title: `${label}: ${target?.title ?? 'Initiative plan'}`,
    subtitle: [
      `Decision Lab · conditional schedule · calculated ${input.today}`,
      `Why: ${reason.trim()}`,
      `Plan: ${label}${scenario.workerId ? ` · ${input.workers.find((worker) => worker.id === scenario.workerId)?.name ?? 'Worker unavailable'}` : ''}`,
      'Execution: proposal recorded. Open the linked Elements to put the decision into action; dates and assignees have not been changed.',
      `Initiative late Elements: ${comparison.baseline.scope.late} → ${comparison.scenario.scope.late}`,
      `Initiative unestimated Elements: ${comparison.baseline.scope.unknown} → ${comparison.scenario.scope.unknown}`,
      `Other work late Elements: ${comparison.baseline.outside.late} → ${comparison.scenario.outside.late}`,
      `Other work unestimated Elements: ${comparison.baseline.outside.unknown} → ${comparison.scenario.outside.unknown}`,
      'Changes:',
      ...(changed.length ? changed.map(row) : ['No calculated finish dates changed.']),
      'Assumptions:',
      ...comparison.scenario.assumptions,
      'Only work visible in this Activity Space is included. Hidden work, skill suitability and outcome attainment are not measured.',
    ].join('\n'),
    abandoned: sacrificed.length ? sacrificed.map(row).join('\n') : 'No later finish identified among the calculated Elements. Unestimated and invisible work may still be affected.',
    targetId: targetId ?? null,
  };
}
