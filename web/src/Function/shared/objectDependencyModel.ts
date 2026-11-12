// Object dependencies, as pure rules: "blocked waits for blocker".

export interface ObjectLink {
  /** The Object that has to be done first. */
  blocker: string;
  /** The Object that waits for it. */
  blocked: string;
}

/** Pure. Whether adding `blocker → blocked` would make a loop: true when
 *  `blocker` already (directly or through others) waits for `blocked`, or
 *  the two are the same Object. */
export function linkWouldLoop(links: readonly ObjectLink[], blocker: string, blocked: string): boolean {
  if (blocker === blocked) return true;
  const waitsFor = new Map<string, string[]>();
  for (const l of links) waitsFor.set(l.blocked, [...(waitsFor.get(l.blocked) ?? []), l.blocker]);
  const seen = new Set<string>();
  const stack = [blocker];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur === blocked) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...(waitsFor.get(cur) ?? []));
  }
  return false;
}

/** Pure. Whether the dates break the link: the waiting Object starts on or
 *  before the day its blocker is due. Days are 'yyyy-MM-dd'; an end missing
 *  its date cannot be judged and reads as no conflict. */
export function linkConflicts(blockerDue: string | null | undefined, blockedStart: string | null | undefined): boolean {
  if (!blockerDue || !blockedStart) return false;
  return blockedStart.slice(0, 10) <= blockerDue.slice(0, 10);
}
