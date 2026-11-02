import { describe, expect, it } from 'vitest';
import { mergeNavigation, navigationAfterDomainChange, navigationForView, objectDomainRoute } from '@/shell/navigationState';

describe('An Element opened from ⌘K', () => {
  const back = { view: 'note', objectId: 'prev-obj', objectDomainId: 'current-domain', domainId: 'current-domain' };
  const opened = mergeNavigation({ objectId: null }, { elementId: 'el', elementReturn: back, objectId: 'obj', objectDomainId: 'other-domain' }, 'current-domain');

  it("carries its Object's Domain, so the shell switches there before opening it", () => {
    expect(opened).toMatchObject({ elementId: 'el', objectId: 'obj', objectDomainId: 'other-domain' });
    expect(navigationAfterDomainChange(opened, 'other-domain')).toBe(opened);
  });
  it('stays open on the Domain Elements view and is forgotten on any other', () => {
    expect(navigationForView(opened, 'domain-elements')).toBe(opened);
    expect(navigationForView(opened, 'note')).toMatchObject({ elementId: null, elementReturn: null, objectId: 'obj' });
    const plain = { objectId: null };
    expect(navigationForView(plain, 'note')).toBe(plain);
  });
  it('keeps where Back returns to while it is open', () => {
    expect(opened.elementReturn).toEqual(back);
  });
  it('closes when another Domain is chosen while it is open', () => {
    expect(navigationAfterDomainChange(opened, 'third-domain')).toMatchObject({ elementId: null, elementReturn: null, objectId: null, objectDomainId: null });
    // A personal Element has no Object, and still closes on a Domain switch.
    const personal = mergeNavigation({ objectId: null }, { elementId: 'mine', elementReturn: back, objectId: null }, 'current-domain');
    expect(navigationAfterDomainChange(personal, 'third-domain')).toMatchObject({ elementId: null, elementReturn: null });
  });
});

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
