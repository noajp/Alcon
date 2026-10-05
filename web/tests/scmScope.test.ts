import { describe, expect, it } from 'vitest';
import { scmScopes, scopeScmData, servesLocation, SPACE_SCOPE } from '../src/ActivitySpace/sustainment/scm/scmScope';

const item = (id: string, domainId: string | null) => ({
  id, sku: id, name: id, unit: 'pcs', category: null, supplierId: null, unitCost: 1, unitPrice: null, currency: 'JPY',
  leadTimeDays: null, moq: 0, orderMultiple: 1, serviceLevel: null, baselineDailyDemand: null, active: true, domainId,
});
const data = {
  locations: [{ id: 'hq', name: 'HQ', code: null, domainId: null }, { id: 'cache', name: 'Cache', code: null, domainId: 'orca' }, { id: 'dc', name: 'DC', code: null, domainId: 'logi' }],
  suppliers: [{ id: 'paper', name: 'Paper', leadTimeDays: 7, currency: 'JPY', domainId: null }, { id: 'broker', name: 'Broker', leadTimeDays: 30, currency: 'USD', domainId: 'orca' }],
  items: [item('box', null), item('rifle', 'orca'), item('pallet', 'logi')],
  stock: [{ itemId: 'box', locationId: 'hq', onHand: 5 }, { itemId: 'box', locationId: 'cache', onHand: 1 }, { itemId: 'rifle', locationId: 'cache', onHand: 3 }, { itemId: 'pallet', locationId: 'dc', onHand: 9 }],
  demand: [{ itemId: 'rifle', locationId: 'cache', day: '2026-10-01', quantity: 1 }],
  orders: [{ id: 'po1', locationId: 'cache' }, { id: 'po2', locationId: 'hq' }],
  runs: [{ id: 'r1', domainId: null }, { id: 'r2', domainId: 'orca' }],
};

describe('scopeScmData', () => {
  it('returns everything for the null scope', () => {
    expect(scopeScmData(data, null)).toBe(data);
  });

  it("narrows to a Domain's locations and the Space-wide records that serve them", () => {
    const orca = scopeScmData(data, 'orca');
    expect(orca.locations.map(entry => entry.id)).toEqual(['cache']);
    expect(orca.items.map(entry => entry.id)).toEqual(['box', 'rifle']);
    expect(orca.suppliers.map(entry => entry.id)).toEqual(['paper', 'broker']);
    expect(orca.stock.map(entry => `${entry.itemId}@${entry.locationId}`)).toEqual(['box@cache', 'rifle@cache']);
    expect(orca.orders.map(entry => entry.id)).toEqual(['po1']);
    expect(orca.runs.map(entry => entry.id)).toEqual(['r2']);
  });

  it('keeps every Domain out of the Space-wide scope', () => {
    const shared = scopeScmData(data, SPACE_SCOPE);
    expect(shared.locations.map(entry => entry.id)).toEqual(['hq']);
    expect(shared.items.map(entry => entry.id)).toEqual(['box']);
    expect(shared.suppliers.map(entry => entry.id)).toEqual(['paper']);
    expect(shared.runs.map(entry => entry.id)).toEqual(['r1']);
  });

  it('returns the same object for the same snapshot and scope, so plans are cached', () => {
    expect(scopeScmData(data, 'orca')).toBe(scopeScmData(data, 'orca'));
  });
});

describe('scmScopes and servesLocation', () => {
  it('lists the Space-wide scope first, then each Domain with a location', () => {
    expect(scmScopes(data.locations)).toEqual([null, 'logi', 'orca']);
  });

  it("lets a Space-wide record serve any location and a Domain's only its own", () => {
    expect(servesLocation(null, 'orca')).toBe(true);
    expect(servesLocation('orca', 'orca')).toBe(true);
    expect(servesLocation('orca', null)).toBe(false);
    expect(servesLocation('orca', 'logi')).toBe(false);
  });
});
