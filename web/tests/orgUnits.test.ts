import { describe, expect, it } from 'vitest';
import { childUnits, membersBelow, unitPath, unitsOf } from '@/Function/team/orgUnits';

const u = (id: string, parent_id: string | null, position = 0) => ({ id, parent_id, name: id, position });
// sales › east › east-1, sales › west; coe on its own.
const units = [u('sales', null, 1), u('coe', null, 0), u('east', 'sales', 1), u('west', 'sales', 0), u('east-1', 'east')];
const members = [
  { unit_id: 'east-1', worker_id: 'ann' }, { unit_id: 'west', worker_id: 'bo' },
  { unit_id: 'coe', worker_id: 'cy' }, { unit_id: 'east', worker_id: 'cy' }, // cy: CoE, seconded to east
];

describe('org units', () => {
  it('lists a unit’s children in their order', () => {
    expect(childUnits(units, null).map((x) => x.id)).toEqual(['coe', 'sales']);
    expect(childUnits(units, 'sales').map((x) => x.id)).toEqual(['west', 'east']);
  });

  it('reads the path from the top down to a unit', () => {
    expect(unitPath(units, 'east-1').map((x) => x.id)).toEqual(['sales', 'east', 'east-1']);
    expect(unitPath(units, 'missing')).toEqual([]);
  });

  it('stops on a loop instead of spinning', () => {
    const looped = [u('a', 'b'), u('b', 'a')];
    expect(unitPath(looped, 'a').map((x) => x.id)).toEqual(['b', 'a']);
    expect(membersBelow(looped, [{ unit_id: 'b', worker_id: 'x' }], 'a')).toEqual(['x']);
  });

  it('counts members of the units inside, each once', () => {
    expect(membersBelow(units, members, 'sales').sort()).toEqual(['ann', 'bo', 'cy']);
    expect(membersBelow(units, members, 'coe')).toEqual(['cy']);
  });

  it('lists every unit a Worker is in', () => {
    expect(unitsOf(units, members, 'cy').map((x) => x.id).sort()).toEqual(['coe', 'east']);
  });
});
