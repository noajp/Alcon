import { countsOnDay, elementSpan, hoursPerDay, type LoadElement } from '@/alcon/shared/assignmentLoad';
import type { ExplorerData } from '@/alcon/sync/explorerPatch';
import type { ElementWithDetails } from '@/types/database';

export interface WorkloadSelection {
  contextKey: string;
  /** null follows all accessible Domains; [] is an intentional empty filter. */
  domainIds: string[] | null;
}

/** A Space switch starts a new selection. Deleted/inaccessible Domains never
 * survive in the effective scope, including while the next read is pending. */
export function workloadDomainIds(
  selection: WorkloadSelection,
  contextKey: string,
  accessibleIds: readonly string[],
): string[] {
  if (selection.contextKey !== contextKey || selection.domainIds === null) return [...accessibleIds];
  const accessible = new Set(accessibleIds);
  return selection.domainIds.filter(id => accessible.has(id));
}

/** Only Object membership establishes a Domain/Space scope for an Element.
 * RPC rootElements have no such association and cannot be attributed to the
 * requested Domain. Explicit Object reads contribute only requested Objects. */
export function selectWorkloadElements(
  explorers: readonly { domainId: string | null; data: ExplorerData }[],
  domainIds: readonly string[],
  objectIds: readonly string[],
): ElementWithDetails[] {
  const domains = new Set(domainIds);
  const objects = new Set(objectIds);
  const elements = new Map<string, ElementWithDetails>();
  for (const { domainId, data } of explorers) {
    const wholeDomain = domainId !== null && domains.has(domainId);
    for (const object of data.objects) {
      if (!wholeDomain && !objects.has(object.id)) continue;
      for (const element of object.elements ?? []) elements.set(element.id, element);
    }
  }
  return [...elements.values()];
}

/** Same inclusive-day arithmetic as the assignment picker. Date-only values
 * remain calendar dates, so UTC offsets and daylight saving cannot move load. */
export function workloadDailyHours(
  elements: readonly LoadElement[],
  days: readonly string[],
  today: string,
): number[] {
  const daily = days.map(() => 0);
  const seen = new Set<string>();
  for (const element of elements) {
    if (seen.has(element.id)) continue;
    seen.add(element.id);
    const span = elementSpan(element);
    if (!span) continue;
    const perDay = hoursPerDay(element);
    for (let i = 0; i < days.length; i++) {
      if (span.start <= days[i] && days[i] <= span.end && countsOnDay(element, days[i], today)) daily[i] += perDay;
    }
  }
  return daily;
}

/** A bar's inclusive intersection with the displayed calendar days. */
export function workloadBar(element: LoadElement, days: readonly string[]): { offset: number; length: number } | null {
  const span = elementSpan(element);
  if (!span) return null;
  const offset = days.findIndex(day => span.start <= day && day <= span.end);
  if (offset < 0) return null;
  let last = offset;
  while (last + 1 < days.length && days[last + 1] <= span.end) last += 1;
  return { offset, length: last - offset + 1 };
}

/** Unscheduled work stays actionable beneath its Worker, after dated work.
 * It has no chart bar and contributes no invented scheduled hours. */
export function workloadElementsInWindow<T extends LoadElement>(elements: readonly T[], days: readonly string[]): T[] {
  return elements.filter(element => !elementSpan(element) || workloadBar(element, days) !== null)
    .sort((a, b) => {
      const aSpan = elementSpan(a);
      const bSpan = elementSpan(b);
      if (!aSpan) return bSpan ? 1 : a.id.localeCompare(b.id);
      if (!bSpan) return -1;
      return aSpan.start.localeCompare(bSpan.start) || a.id.localeCompare(b.id);
    });
}
