// The audit drill-down's chain tree (B10): a run's children, shaped
// for display from the runs the audit read already holds. Pure —
// the panel renders what this returns and nothing else. A child is
// a run whose scope names this run as its parent; the tree is one
// level (each child's own panel lists ITS children), ordered by
// depth, then by birth — the order the chain grew in.

import { agentRunOutcome, type AgentOutcome, type AgentRunRecord } from './auditModel';

export interface ChainChildRow {
  runId: string;
  elementTitle: string;
  outcome: AgentOutcome;
  /** The child's depth in the chain (its scope's own number). */
  depth: number;
  maxDepth: number;
  /** The child's fenced integrations, by name (scope order). */
  integrationNames: string[];
  /** How many (integration, action) pairs the child's fence allows. */
  actionCount: number;
  /** How many calls the fence refused in the child's final slice
   *  (its verdict's chain block); null when nothing was refused or
   *  the run carries no verdict yet. */
  denied: number | null;
}

/** Pure. The children of one run among the loaded audit runs, in
 *  chain order. Runs without a scope are nobody's children; a run
 *  is never its own child (a root's parentRunId is itself, and it
 *  is excluded by the parent test naming a DIFFERENT run). */
export function chainChildrenOf(runs: readonly AgentRunRecord[], runId: string): ChainChildRow[] {
  return runs
    .filter(r => r.id !== runId && r.chainScope !== null && r.chainScope.parentRunId === runId)
    .sort((a, b) => (a.chainScope!.depth - b.chainScope!.depth) || a.created_at.localeCompare(b.created_at))
    .map(r => ({
      runId: r.id,
      elementTitle: r.elementTitle,
      outcome: agentRunOutcome(r),
      depth: r.chainScope!.depth,
      maxDepth: r.chainScope!.maxDepth,
      integrationNames: r.chainIntegrationNames,
      actionCount: r.chainScope!.actions.length,
      denied: r.verdict?.chain?.denied ?? null,
    }));
}
