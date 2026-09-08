// Readiness = "every `depends_on` upstream of this Element is done".
//
// The rule lives here, apart from the fetch, because three surfaces ask the
// same question and must never answer it differently: the row marker, the
// Ready filter, and the single-Element `canElementStart`. Everything below is
// pure — it takes edge rows and upstream statuses and returns which Elements
// are still waiting.

import type { EdgeType } from '@/types/database';
import { displayIdOf } from './displayId';

/** One unresolved upstream — what a waiting Element is waiting on. */
export interface DependencyBlocker {
  id: string;
  title: string;
  /** The Element's human-facing id (`ELE_PH1-001`), derived from its owning
   *  Object's prefix. Null until the Element has one. */
  display_id: string | null;
  status: string | null;
}

/** The edge shape the rule needs; a full `ElementEdge` row satisfies it. */
export interface DependencyEdgeRow {
  from_element: string;
  to_element: string;
  edge_type: EdgeType | string;
}

/** The upstream shape the rule needs; a full `Element` row satisfies it. */
export interface DependencyUpstreamRow {
  id: string;
  title: string;
  display_id?: string | null;
  status?: string | null;
}

/**
 * Blockers per Element, keyed by the *downstream* id. Elements that are ready
 * get no entry at all (same shape as the comment-activity rollup), so a row
 * looking itself up and finding nothing is the ready case.
 *
 * Ignored on purpose:
 *   - edges that aren't `depends_on` (spawns / references / intersection … say
 *     nothing about whether work can start)
 *   - self-references — an Element cannot gate itself, and treating one as a
 *     blocker would make the row permanently unstartable
 *   - upstreams missing from `upstreams` — either deleted or hidden by RLS.
 *     "Waiting on something you cannot see" is not actionable, so it does not
 *     hold the row back
 *   - duplicate edges onto the same upstream, which collapse to one blocker
 */
export function computeBlockers(
  elementIds: string[],
  edges: DependencyEdgeRow[],
  upstreams: DependencyUpstreamRow[],
): Record<string, DependencyBlocker[]> {
  const wanted = new Set(elementIds);
  const byId = new Map(upstreams.map((u) => [u.id, u]));
  const out: Record<string, DependencyBlocker[]> = {};
  const seen = new Map<string, Set<string>>();

  for (const edge of edges) {
    if (edge.edge_type !== 'depends_on') continue;
    if (!wanted.has(edge.to_element)) continue;
    if (edge.from_element === edge.to_element) continue;

    const upstream = byId.get(edge.from_element);
    if (!upstream) continue;
    if (upstream.status === 'done') continue;

    const already = seen.get(edge.to_element) ?? new Set<string>();
    if (already.has(upstream.id)) continue;
    already.add(upstream.id);
    seen.set(edge.to_element, already);

    (out[edge.to_element] ??= []).push({
      id: upstream.id,
      title: upstream.title,
      display_id: upstream.display_id ?? null,
      status: upstream.status ?? null,
    });
  }

  return out;
}

/** The upstream ids `computeBlockers` will need to look up statuses for. */
export function upstreamIdsOf(elementIds: string[], edges: DependencyEdgeRow[]): string[] {
  const wanted = new Set(elementIds);
  const ids = new Set<string>();
  for (const edge of edges) {
    if (edge.edge_type !== 'depends_on') continue;
    if (!wanted.has(edge.to_element)) continue;
    if (edge.from_element === edge.to_element) continue;
    ids.add(edge.from_element);
  }
  return Array.from(ids);
}

/** `ELE_PH1-001 Ship the API` — how a blocker names itself in a tooltip. An
 *  Element without a display_id names itself by title alone, the same way its
 *  row does. */
export function describeBlocker(b: DependencyBlocker): string {
  const id = displayIdOf(b);
  return id ? `${id} ${b.title}` : b.title;
}
