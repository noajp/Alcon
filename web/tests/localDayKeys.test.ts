import { describe, expect, it } from 'vitest';
import { toDateOnlyString } from '@/Function/shared/dateUtils';
import { dateKey } from '@/Function/strategy/initiativeRiskModel';
import { todayYMD } from '@/Function/strategy/phaseClose';

// Each surface names "today on the viewer's calendar" its own way; all of them
// delegate to dateUtils, so they cannot drift apart.
describe('local day keys agree with toDateOnlyString', () => {
  it.each([
    new Date(2026, 8, 1, 23, 59),
    new Date(2026, 2, 8, 0, 0),
    new Date(2026, 10, 1, 12, 0),
    new Date(2024, 1, 29, 6, 30),
  ])('%s', (date) => {
    const expected = toDateOnlyString(date);
    expect(dateKey(date.getTime())).toBe(expected);
    expect(todayYMD(date)).toBe(expected);
  });
});
