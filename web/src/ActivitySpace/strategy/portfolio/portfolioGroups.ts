import type { Portfolio } from '@/types/database';

// The Portfolio page's rows: each Portfolio with the root Initiatives it
// bundles, plus the root Initiatives in no Portfolio. Pure, so the grouping
// is testable. Nested Initiatives (with a parent) belong to their parent, not
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

export function groupByPortfolio<T extends PortfolioMember>(portfolios: Portfolio[], initiatives: T[]): {
  groups: { portfolio: Portfolio; initiatives: T[] }[];
  unassigned: T[];
} {
  const roots = initiatives.filter((s) => s.parentIds.length === 0);
  const known = new Set(portfolios.map((p) => p.id));
  const groups = portfolios.map((portfolio) => ({
    portfolio,
    initiatives: roots.filter((s) => s.portfolio_id === portfolio.id),
  }));
  const unassigned = roots.filter((s) => !s.portfolio_id || !known.has(s.portfolio_id));
  return { groups, unassigned };
}
