// el_QLT-008. Six Op Kestrel Relief Workers (Col. Vega, Maj. Okafor, …) were
// assigned, counted and planned around for weeks while nothing sent to them
// could arrive: `workers.user_id` was null and notifications land on
// `auth.users` (ADR 0010). The predicate here is what every assignee surface
// reads to say so. These tests pin its two edges — an unknown column must not
// raise a false alarm, and an AI agent without an account is not "unreachable".

import { describe, expect, it } from 'vitest';
import {
  isUnreachableWorker,
  unreachableWorkerTitle,
} from '@/alcon/shared/workerReach';

describe('isUnreachableWorker', () => {
  it('marks a human Worker whose user_id is null', () => {
    expect(isUnreachableWorker({ type: 'human', user_id: null })).toBe(true);
  });

  it('does not mark a human Worker who has an account', () => {
    expect(isUnreachableWorker({ type: 'human', user_id: 'c0ffee' })).toBe(false);
  });

  it('leaves AI agents and robots alone — they are driven by other means', () => {
    expect(isUnreachableWorker({ type: 'ai_agent', user_id: null })).toBe(false);
    expect(isUnreachableWorker({ type: 'robot', user_id: null })).toBe(false);
  });

  it('reads an unloaded column as reachable rather than guessing', () => {
    // An avatar built from a `{ name, avatar_url }` stub knows nothing about
    // accounts. `undefined` is "not loaded", `null` is "there is none".
    expect(isUnreachableWorker({ type: 'human' })).toBe(false);
    expect(isUnreachableWorker({ user_id: null })).toBe(false);
    expect(isUnreachableWorker({})).toBe(false);
    expect(isUnreachableWorker(null)).toBe(false);
    expect(isUnreachableWorker(undefined)).toBe(false);
  });
});

describe('unreachableWorkerTitle', () => {
  it('names the Worker, the consequence and the fix', () => {
    const title = unreachableWorkerTitle('Col. Vega');
    expect(title).toContain('Col. Vega');
    expect(title).toMatch(/don't reach/);
    expect(title).toMatch(/Connect the Worker to an account/);
  });

  it('falls back to a generic subject when the name is blank', () => {
    expect(unreachableWorkerTitle('  ')).toMatch(/^This Worker /);
    expect(unreachableWorkerTitle(null)).toMatch(/^This Worker /);
  });
});
