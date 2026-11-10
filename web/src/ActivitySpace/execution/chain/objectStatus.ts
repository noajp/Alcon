import type { ChainStatus } from './ExecutionChain';

// Where an Object stands on a Board. An Object keeps no Status of its own:
// its column is read from its Elements, so it can never disagree with
// the work inside it. Nothing yet is Backlog; all of it closed is Done
// (or Cancelled when none of it was done); anything moving puts it In
// Progress, ahead of review, a block, or work merely planned.

const CLOSED = new Set(['done', 'cancelled']);

/** Pure. The column an Object stands in, from its Elements' Statuses. */
export function objectStatusOf(statuses: readonly (string | null | undefined)[]): ChainStatus {
  const s = statuses.map((x) => x ?? 'todo');
  if (s.length === 0) return 'backlog';
  if (s.every((x) => CLOSED.has(x))) return s.includes('done') ? 'done' : 'cancelled';
  if (s.includes('in_progress')) return 'in_progress';
  if (s.includes('review')) return 'review';
  if (s.includes('blocked')) return 'blocked';
  if (s.includes('done')) return 'in_progress';
  if (s.includes('todo')) return 'todo';
  return 'backlog';
}
