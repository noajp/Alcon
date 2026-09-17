import type { Portfolio } from '@/types/database';

// The Portfolio page's rows: each Portfolio with the root Initiatives it
// bundles, plus the root Initiatives in no Portfolio. Pure, so the grouping
// is testable. Nested Initiatives (with a parent) belong to their parent, not
// to a Portfolio, and are left out here.

export interface PortfolioMember { id: string; name: string; portfolio_id: string | null; parentIds: string[] }

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
