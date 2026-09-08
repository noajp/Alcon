import { describe, expect, it } from 'vitest';
import { operationsQueue, operationsQueueRoute } from '@/ActivitySpace/sustainment/operations/operationsQueues';
import { mergeNavigation, navigationAfterDomainChange } from '@/shell/navigationState';
import type { NavigationState } from '@/types/navigation';

describe('operations navigation', () => {
  it('keeps CRM and SCM independent without changing another window tab or its Object route', () => {
    const original: NavigationState = { objectId: 'object', objectDomainId: 'domain', scmQueue: 'incomplete' };
    const changed = mergeNavigation(original, operationsQueueRoute('crm', 'attention'), 'other');
    expect(operationsQueue(changed, 'crm')).toBe('attention');
    expect(operationsQueue(changed, 'scm')).toBe('incomplete');
    expect(operationsQueue(original, 'crm')).toBe('overview');
    expect(changed.objectId).toBe('object');
    expect(changed.objectDomainId).toBe('domain');
    expect(operationsQueue(navigationAfterDomainChange(changed, 'new-domain'), 'crm')).toBe('attention');
  });
  it('defaults absent or malformed values to overview', () => {
    for (const crmQueue of [undefined, null, 'unknown', 1, {}, []]) {
      expect(operationsQueue({ objectId: null, crmQueue } as NavigationState, 'crm')).toBe('overview');
    }
  });
});
