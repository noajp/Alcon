import type { Strategy, StrategyChild, StrategyObject, StrategyWithObjects } from '@/types/database';

// The only place a Initiative's Object set is derived (ADR 0017). The set is
// read from the strategy_objects junction and from nothing else — in
// particular not from `strategies.scope`, whose jsonb may still list
// Objects on rows written before the junction became the single source.
// That key is never consulted, so a stale one cannot disagree with the
// junction.
export function assembleStrategies(
  strategies: readonly Strategy[],
  links: readonly StrategyObject[],
  nesting: readonly StrategyChild[],
): StrategyWithObjects[] {
  const byStrategy = new Map<string, string[]>();
  for (const link of links) {
    if (!byStrategy.has(link.strategy_id)) byStrategy.set(link.strategy_id, []);
    byStrategy.get(link.strategy_id)!.push(link.object_id);
  }
  // child_strategy_id -> its parent_strategy_id[] (DAG — multi-parent
  // allowed). Empty parentIds means the Initiative is top-level, at the
  // root of the Initiative list.
  const byChild = new Map<string, string[]>();
  for (const edge of nesting) {
    if (!byChild.has(edge.child_strategy_id)) byChild.set(edge.child_strategy_id, []);
    byChild.get(edge.child_strategy_id)!.push(edge.parent_strategy_id);
  }
  return strategies.map((s) => ({
    ...s,
    objectIds: byStrategy.get(s.id) ?? [],
    parentIds: byChild.get(s.id) ?? [],
  }));
}
