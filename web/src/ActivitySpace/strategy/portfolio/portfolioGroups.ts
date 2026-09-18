import type { Portfolio } from '@/types/database';

// The Portfolio page's shapes, kept pure so the rules are testable:
// - which Initiatives belong on this Space's page,
// - the Portfolio tree (Portfolios nest through parent_id),
// - what a Portfolio adds up to (its Initiatives and its descendants').
// Nested Initiatives (with a parent Initiative) belong to their parent, not
// to a Portfolio, and are left out here.

export interface PortfolioMember { id: string; name: string; portfolio_id: string | null; parentIds: string[]; objectIds: string[] }

/** Initiatives that belong on this Space's Portfolio page. An Initiative has
 *  no Space of its own — it reaches a Space through its Objects' Domains — so
 *  those with an Object in one of the Space's Domains count, and so do
 *  Initiatives with no Object yet (nothing places them elsewhere). */
export function initiativesInSpace<T extends PortfolioMember>(
  initiatives: T[],
  objectDomain: Map<string, string | null>,
  spaceDomainIds: Set<string>,
): T[] {
  return initiatives.filter((s) =>
    s.objectIds.length === 0 || s.objectIds.some((oid) => {
      const d = objectDomain.get(oid);
      return !!d && spaceDomainIds.has(d);
    }));
}

/** Root Initiatives keyed by the Portfolio they sit in; `unassigned` holds
 *  the ones in no Portfolio (or in one that no longer exists). */
export function groupByPortfolio<T extends PortfolioMember>(portfolios: Portfolio[], initiatives: T[]): {
  byPortfolio: Map<string, T[]>;
  unassigned: T[];
} {
  const roots = initiatives.filter((s) => s.parentIds.length === 0);
  const known = new Set(portfolios.map((p) => p.id));
  const byPortfolio = new Map<string, T[]>(portfolios.map((p) => [p.id, []]));
  const unassigned: T[] = [];
  for (const s of roots) {
    if (s.portfolio_id && known.has(s.portfolio_id)) byPortfolio.get(s.portfolio_id)!.push(s);
    else unassigned.push(s);
  }
  return { byPortfolio, unassigned };
}

export interface PortfolioNode { portfolio: Portfolio; depth: number; children: PortfolioNode[] }

/** The Portfolio tree in display order: siblings by order_index then
 *  creation; a Portfolio whose parent is missing is shown at the top level. */
export function buildPortfolioTree(portfolios: Portfolio[]): PortfolioNode[] {
  const ids = new Set(portfolios.map((p) => p.id));
  const sorted = [...portfolios].sort((a, b) => a.order_index - b.order_index || a.created_at.localeCompare(b.created_at));
  const build = (parentId: string | null, depth: number): PortfolioNode[] =>
    sorted
      .filter((p) => (parentId === null ? !p.parent_id || !ids.has(p.parent_id) : p.parent_id === parentId))
      .map((p) => ({ portfolio: p, depth, children: build(p.id, depth + 1) }));
  return build(null, 0);
}

/** Every node of the tree, depth first — what a folded list renders. */
export function flattenTree(nodes: PortfolioNode[], isOpen: (id: string) => boolean): PortfolioNode[] {
  const out: PortfolioNode[] = [];
  const walk = (list: PortfolioNode[]) => {
    for (const n of list) {
      out.push(n);
      if (isOpen(n.portfolio.id)) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

export function findNode(nodes: PortfolioNode[], id: string): PortfolioNode | null {
  for (const n of nodes) {
    if (n.portfolio.id === id) return n;
    const hit = findNode(n.children, id);
    if (hit) return hit;
  }
  return null;
}

/** The ids under a node, the node itself included — what may not become
 *  its own ancestor when a Portfolio is moved. */
export function subtreeIds(node: PortfolioNode): Set<string> {
  const out = new Set<string>();
  const walk = (n: PortfolioNode) => { out.add(n.portfolio.id); n.children.forEach(walk); };
  walk(node);
  return out;
}

/** Ancestors first, the Portfolio itself last. */
export function portfolioPath(portfolios: Portfolio[], id: string): Portfolio[] {
  const byId = new Map(portfolios.map((p) => [p.id, p]));
  const path: Portfolio[] = [];
  const seen = new Set<string>();
  let cur = byId.get(id) ?? null;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    path.unshift(cur);
    cur = cur.parent_id ? byId.get(cur.parent_id) ?? null : null;
  }
  return path;
}

export interface HealthLike { progressPct: number | null; risk: { overdue: number; stalled: number; blocked: number } }

export interface PortfolioRollup {
  /** Initiatives in the Portfolio and everything nested under it. */
  initiatives: number;
  /** Mean progress of the measured Initiatives, or null when none is measured. */
  progressPct: number | null;
  /** Overdue + stalled + blocked across those Initiatives. */
  alerts: number;
  /** Initiatives whose health is not loaded yet. */
  pending: number;
}

export function rollupPortfolio<T extends { id: string }>(
  node: PortfolioNode,
  byPortfolio: Map<string, T[]>,
  healthById: Map<string, HealthLike>,
): PortfolioRollup {
  let initiatives = 0, alerts = 0, pending = 0, measuredSum = 0, measured = 0;
  const walk = (n: PortfolioNode) => {
    for (const s of byPortfolio.get(n.portfolio.id) ?? []) {
      initiatives += 1;
      const h = healthById.get(s.id);
      if (!h) { pending += 1; continue; }
      if (h.progressPct !== null) { measuredSum += h.progressPct; measured += 1; }
      alerts += h.risk.overdue + h.risk.stalled + h.risk.blocked;
    }
    n.children.forEach(walk);
  };
  walk(node);
  return { initiatives, progressPct: measured > 0 ? Math.round(measuredSum / measured) : null, alerts, pending };
}
