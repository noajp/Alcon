import { describe, expect, it } from 'vitest';
import { mergeNavigation, navigationAfterDomainChange, objectDomainRoute } from '@/shell/navigationState';

describe('Object navigation across Domains', () => {
  it('preserves an explicit Object target when its Domain change is processed', () => {
    const navigation = mergeNavigation({ objectId: null, workerId: 'worker' }, { objectId: 'destination', objectDomainId: 'new-domain' }, 'old-domain');
    expect(navigationAfterDomainChange(navigation, 'new-domain')).toEqual({ objectId: 'destination', objectDomainId: 'new-domain', workerId: 'worker' });
  });
  it('clears old Object selections on an ordinary Domain switch', () => {
    const navigation = mergeNavigation({ objectId: null }, { objectId: 'old-object' }, 'old-domain');
    expect(navigationAfterDomainChange(navigation, 'new-domain')).toEqual({ objectId: null, objectDomainId: null });
  });
  it('does not carry a previous Object route onto a new ordinary selection', () => {
    const navigation = mergeNavigation({ objectId: 'first', objectDomainId: 'first-domain' }, { objectId: 'second' }, 'current-domain');
    expect(navigation).toEqual({ objectId: 'second', objectDomainId: 'current-domain' });
    expect(mergeNavigation(navigation, { objectId: null }, 'current-domain')).toEqual({ objectId: null, objectDomainId: null });
  });
  it('keeps explicit Object routing intact through unrelated tool navigation updates', () => {
    const navigation = mergeNavigation({ objectId: 'target', objectDomainId: 'target-domain' }, { noteId: 'note' }, 'other-domain');
    expect(navigation).toEqual({ objectId: 'target', objectDomainId: 'target-domain', noteId: 'note' });
  });
  it('routes a multi-homed Object through its current or another authorized Domain', () => {
    expect(objectDomainRoute(['hidden', 'public', 'current'], ['public', 'current'], 'current')).toBe('current');
    expect(objectDomainRoute(['hidden', 'public'], ['public', 'current'], 'current')).toBe('public');
    expect(objectDomainRoute(['hidden'], ['public', 'current'], 'current')).toBeNull();
    expect(objectDomainRoute([], ['public'], 'public')).toBeNull();
  });
});
