import type { NavigationState } from '@/types/navigation';

/** An Object selection carries the Domain in which it should open. Unrelated
 * navigation changes preserve that association; leaving the Object clears it. */
export function mergeNavigation(
  current: NavigationState,
  partial: Partial<NavigationState>,
  activeDomainId: string,
): NavigationState {
  const next = { ...current, ...partial };
  if (partial.objectId !== undefined) {
    next.objectDomainId = partial.objectId ? partial.objectDomainId ?? activeDomainId : null;
  }
  return next;
}

/** A normal Domain switch returns to the Object list. An explicit route into
 * this Domain already chose its Object, so that selection must survive. */
export function navigationAfterDomainChange(navigation: NavigationState, domainId: string): NavigationState {
  if (navigation.objectId && navigation.objectDomainId === domainId) return navigation;
  if (!navigation.objectId && !navigation.objectDomainId) return navigation;
  return { ...navigation, objectId: null, objectDomainId: null };
}

/** Prefer an Object's home in the Domain already open, then another visible
 * home. A hidden/unrelated Domain is not an implicit navigation destination. */
export function objectDomainRoute(
  objectDomainIds: readonly string[],
  viewableDomainIds: readonly string[],
  activeDomainId: string | null,
): string | null {
  const viewable = new Set(viewableDomainIds);
  if (activeDomainId && viewable.has(activeDomainId) && objectDomainIds.includes(activeDomainId)) return activeDomainId;
  return objectDomainIds.find(id => viewable.has(id)) ?? null;
}
