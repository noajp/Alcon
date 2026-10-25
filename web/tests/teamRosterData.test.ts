import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Worker } from '@/types/database';

const fixture = vi.hoisted(() => ({
  rows: {} as Record<string, Record<string, unknown>[]>,
  failures: new Set<string>(),
  calls: [] as { resource: string; count?: string; start: number; signal?: AbortSignal; args?: Record<string, unknown> }[],
  onRpc: null as (() => void) | null,
}));

vi.mock('@/lib/supabase', () => {
  const read = (resource: string, args?: Record<string, unknown>, options?: { count?: string }) => {
    const filters: ((row: Record<string, unknown>) => boolean)[] = [];
    const order: string[] = [];
    const call = { resource, args, count: options?.count, start: 0, signal: undefined as AbortSignal | undefined };
    let end = 499;
    const query = {
      select(_columns: string, selectOptions?: { count?: string }) { call.count = selectOptions?.count; return query; },
      eq(column: string, value: unknown) { filters.push((row) => row[column] === value); return query; },
      in(column: string, values: unknown[]) { filters.push((row) => values.includes(row[column])); return query; },
      is(column: string, value: unknown) { filters.push((row) => (row[column] ?? null) === value); return query; },
      order(column: string) { order.push(column); return query; },
      range(from: number, to: number) { call.start = from; end = to; return query; },
      abortSignal(signal: AbortSignal) { call.signal = signal; return query; },
      then(resolve: (value: unknown) => unknown) {
        fixture.calls.push(call);
        if (args) fixture.onRpc?.();
        if (call.signal?.aborted || fixture.failures.has(resource)) return Promise.resolve(resolve({
          data: null, count: null, error: { message: call.signal?.aborted ? 'request aborted' : 'read failed' },
        }));
        const rows = (fixture.rows[resource] ?? [])
          .filter((row) => filters.every((filter) => filter(row)))
          .sort((a, b) => order.reduce((comparison, column) => comparison || String(a[column]).localeCompare(String(b[column])), 0));
        // Exercise exact counts when the server cap is lower than the page request.
        return Promise.resolve(resolve({
          data: rows.slice(call.start, Math.min(end + 1, call.start + 1)),
          count: call.count === 'exact' ? rows.length : null, error: null,
        }));
      },
    };
    return query;
  };
  return { supabase: { from: read, rpc: read } };
});

import { fetchTeamRoster } from '@/hooks/useTeamRoster';
import { buildTeamRoster } from '@/Function/team/teamRoster';

const RPC = 'get_space_guest_domain_members';
const worker = (id: string, userId: string) => ({
  id, name: id, user_id: userId, object_id: null, activity_space_id: null, type: 'human', display_id: null,
  seq_number: null, role: null, email: null, avatar_url: null, ai_model: null,
  ai_config: null, status: 'active', capacity_hours_per_day: null, created_at: null, updated_at: null,
} satisfies Worker);
const guest = (userId: string, domainId = 'domain', role = 'member') => ({
  user_id: userId, domain_id: domainId, domain_name: 'Operations', domain_role: role,
});

describe('Team guest membership reads', () => {
  beforeEach(() => {
    fixture.calls = [];
    fixture.failures.clear();
    fixture.onRpc = null;
    fixture.rows = {
      domains: [{ id: 'domain', name: 'Operations', activity_space_id: 'space' }],
      activity_space_members: [{ user_id: 'viewer', role: 'member', activity_space_id: 'space' }],
      domain_members: [],
      [RPC]: [guest('guest')],
      workers: [worker('idle-guest', 'guest')],
    };
  });

  it('hydrates an idle Domain guest when direct membership RLS returns no rows', async () => {
    const signal = new AbortController().signal;
    const source = await fetchTeamRoster('space', signal);
    expect(source.domainMembers).toEqual([{ user_id: 'guest', domain_id: 'domain', role: 'member' }]);
    expect(buildTeamRoster(source, 'viewer')).toMatchObject([{
      worker: { id: 'idle-guest' }, isMember: true, membership: 'Domain member',
      domainNames: ['Operations'], activeElements: [], canManage: false,
    }]);
    expect(fixture.calls.find((call) => call.resource === RPC)).toMatchObject({
      args: { p_space_id: 'space' }, signal, count: 'exact',
    });
  });

  it('deduplicates direct and RPC membership while preserving owner roles and permission checks', async () => {
    fixture.rows.domain_members = [{ user_id: 'guest', domain_id: 'domain', role: 'owner' }];
    fixture.rows[RPC] = [guest('guest', 'domain', 'owner'), guest('second')];
    fixture.rows.workers.push(worker('second-worker', 'second'));
    const source = await fetchTeamRoster('space', new AbortController().signal);
    expect(source.domainMembers).toHaveLength(2);
    expect(source.domainMembers.find((row) => row.user_id === 'guest')?.role).toBe('owner');
    expect(buildTeamRoster(source, 'guest').every((entry) => entry.canManage)).toBe(true);
    expect(buildTeamRoster(source, 'viewer').every((entry) => !entry.canManage)).toBe(true);
    source.spaceMembers[0].role = 'owner';
    expect(buildTeamRoster(source, 'viewer').every((entry) => entry.canManage)).toBe(true);
    expect(fixture.calls.filter((call) => call.resource === RPC).map((call) => call.start)).toEqual([0, 1]);
  });

  it('excludes hidden and other-Space Domains before hydrating their Workers', async () => {
    fixture.rows.domains.push({ id: 'outside-domain', name: 'Other Space', activity_space_id: 'outside' });
    fixture.rows[RPC].push(guest('hidden', 'hidden-domain'), guest('outside', 'outside-domain'));
    fixture.rows.domain_members.push({ user_id: 'outside', domain_id: 'outside-domain', role: 'owner' });
    fixture.rows.workers.push(worker('hidden-worker', 'hidden'), worker('outside-worker', 'outside'));
    const source = await fetchTeamRoster('space', new AbortController().signal);
    expect(source.domainMembers.map((row) => row.user_id)).toEqual(['guest']);
    expect(source.workers.map((row) => row.id)).toEqual(['idle-guest']);
  });

  it('preserves directly visible membership when the guest RPC returns no rows', async () => {
    fixture.rows[RPC] = [];
    fixture.rows.domain_members = [{ user_id: 'guest', domain_id: 'domain', role: 'member' }];
    const source = await fetchTeamRoster('space', new AbortController().signal);
    expect(buildTeamRoster(source, 'viewer')[0].membership).toBe('Domain member');
  });

  it('fails rather than return an incomplete roster when the guest read fails', async () => {
    fixture.failures.add(RPC);
    await expect(fetchTeamRoster('space', new AbortController().signal)).rejects.toThrow('Unable to read Domain guests: read failed');
  });

  it('passes cancellation to the guest read', async () => {
    const controller = new AbortController();
    fixture.onRpc = () => controller.abort();
    await expect(fetchTeamRoster('space', controller.signal)).rejects.toThrow('request aborted');
    expect(fixture.calls.find((call) => call.resource === RPC)?.signal).toBe(controller.signal);
  });
});
