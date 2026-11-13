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

/**
 * Which ends a dependency ties, the waiting one's to the other's:
 *   fs  finish → start   it starts once the other is done (the usual one)
 *   ss  start  → start   it starts once the other has started
 *   ff  finish → finish  it finishes once the other is done
 *   sf  start  → finish  it finishes once the other has started
 * The same four for Objects and for Elements.
 */
export type DependencyKind = 'fs' | 'ss' | 'ff' | 'sf';
export const DEPENDENCY_KINDS: readonly DependencyKind[] = ['fs', 'ss', 'ff', 'sf'];
export type BarEnd = 'start' | 'finish';

/** Pure. A stored kind, read safely: anything unknown is the usual 'fs'. */
export function asDependencyKind(value: unknown): DependencyKind {
  return typeof value === 'string' && (DEPENDENCY_KINDS as readonly string[]).includes(value) ? value as DependencyKind : 'fs';
}

/** Pure. The kind a line drawn from one end of a bar to one end of another makes. */
export function kindOfEnds(from: BarEnd, to: BarEnd): DependencyKind {
  return `${from === 'start' ? 's' : 'f'}${to === 'start' ? 's' : 'f'}` as DependencyKind;
}

/** Pure. The ends a kind ties: where its line leaves the first bar and where it meets the second. */
export function endsOfKind(kind: DependencyKind): { from: BarEnd; to: BarEnd } {
  return { from: kind[0] === 's' ? 'start' : 'finish', to: kind[1] === 's' ? 'start' : 'finish' };
}

interface Span { start?: string | null; due?: string | null }

/** Pure. Whether the dates break a dependency of `kind`: the waiting one's tied
 *  end comes before the other's. For finish → start the same day breaks it too
 *  (the work cannot begin on the day the other is still being finished). Days
 *  are 'yyyy-MM-dd'; an end missing its date cannot be judged and reads as no
 *  conflict. */
export function dependencyConflicts(kind: DependencyKind, blocker: Span, blocked: Span): boolean {
  const { from, to } = endsOfKind(kind);
  const a = (from === 'start' ? blocker.start : blocker.due)?.slice(0, 10);
  const b = (to === 'start' ? blocked.start : blocked.due)?.slice(0, 10);
  if (!a || !b) return false;
  return kind === 'fs' ? b <= a : b < a;
}
