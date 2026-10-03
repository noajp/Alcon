import { describe, expect, it } from 'vitest';
import { operationsQueue, operationsQueueRoute } from '@/ActivitySpace/sustainment/operations/operationsQueues';
import { mergeNavigation, navigationAfterDomainChange } from '@/shell/navigationState';
import type { NavigationState } from '@/types/navigation';

describe('operations navigation', () => {
  it('changes the CRM view without changing another window tab or its Object route', () => {
    const original: NavigationState = { objectId: 'object', objectDomainId: 'domain' };
    const changed = mergeNavigation(original, operationsQueueRoute('attention'), 'other');
    expect(operationsQueue(changed)).toBe('attention');
    expect(operationsQueue(original)).toBe('overview');
    expect(changed.objectId).toBe('object');
    expect(changed.objectDomainId).toBe('domain');
    expect(operationsQueue(navigationAfterDomainChange(changed, 'new-domain'))).toBe('attention');
  });
  it('defaults absent or malformed values to overview', () => {
    for (const crmQueue of [undefined, null, 'unknown', 1, {}, []]) {
      expect(operationsQueue({ objectId: null, crmQueue } as NavigationState)).toBe('overview');
    }
  });
});
