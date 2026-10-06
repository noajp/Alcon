import type { ScmDemandPoint, ScmItem, ScmLocation, ScmStock, ScmSupplier } from './scmEngine';

// Which supply records a view covers. Locations, suppliers and items may
// belong to a Domain; a Domain's item is only ever stocked and ordered at that
// Domain's locations, and its supplier only delivers there (the database
// enforces this). So a Domain's supply is its locations, plus the Space-wide
// items and suppliers that serve them.

/** null = everything the viewer can see; 'space' = records shared by the Space; otherwise a Domain id. */
export type ScmScope = string | null;
export const SPACE_SCOPE = 'space';

/** The Domain a scope stands for: null for the Space-wide records, undefined for all. */
export function scopeDomain(scope: ScmScope): string | null | undefined {
  if (scope === null) return undefined;
  return scope === SPACE_SCOPE ? null : scope;
}

interface Scoped {
  locations: ScmLocation[];
  suppliers: ScmSupplier[];
  items: ScmItem[];
  stock: ScmStock[];
  demand: ScmDemandPoint[];
  orders: { locationId: string }[];
  runs: { domainId?: string | null }[];
}

const cache = new WeakMap<object, Map<string, unknown>>();

/** The snapshot narrowed to a scope. The same input and scope return the same object. */
export function scopeScmData<T extends Scoped>(data: T, scope: ScmScope): T {
  const domain = scopeDomain(scope);
  if (domain === undefined) return data;
  let byScope = cache.get(data);
  if (!byScope) { byScope = new Map(); cache.set(data, byScope); }
  const hit = byScope.get(scope!);
  if (hit) return hit as T;
  const own = (domainId: string | null | undefined) => (domainId ?? null) === domain;
  const serves = (domainId: string | null | undefined) => !domainId || domainId === domain;
  const locations = data.locations.filter(location => own(location.domainId));
  const at = new Set(locations.map(location => location.id));
  const scoped: T = {
    ...data,
    locations,
    suppliers: data.suppliers.filter(supplier => serves(supplier.domainId)),
    items: data.items.filter(item => serves(item.domainId)),
    stock: data.stock.filter(entry => at.has(entry.locationId)),
    demand: data.demand.filter(point => at.has(point.locationId)),
    orders: data.orders.filter(order => at.has(order.locationId)),
    runs: data.runs.filter(run => own(run.domainId)),
  };
  byScope.set(scope!, scoped);
  return scoped;
}

/** The scopes the snapshot has locations in: the Space-wide one, then each Domain's. */
export function scmScopes(locations: ScmLocation[]): (string | null)[] {
  const domains = new Set<string | null>();
  for (const location of locations) domains.add(location.domainId ?? null);
  return [...domains].sort((a, b) => a === null ? -1 : b === null ? 1 : a.localeCompare(b));
}

/** Whether a record of `domainId` may be used at a location of `locationDomainId`. */
export function servesLocation(domainId: string | null | undefined, locationDomainId: string | null | undefined): boolean {
  return !domainId || domainId === (locationDomainId ?? null);
}

/** The Domains worth offering as "whose supply": the ones that hold supply
 *  records, plus the one shown. Empty when no record belongs to a Domain —
 *  then there is nothing to choose between. */
export function supplyDomainIds(data: { locations: { domainId?: string | null }[]; suppliers: { domainId?: string | null }[]; items: { domainId?: string | null }[] }, scope: ScmScope): string[] {
  const used = new Set<string>();
  for (const record of [...data.locations, ...data.suppliers, ...data.items]) if (record.domainId) used.add(record.domainId);
  if (scope && scope !== SPACE_SCOPE) used.add(scope);
  return [...used];
}
