import { describe, expect, it } from 'vitest';
import { buildTeamRoster, mergeTeamDomainMembers, parseCapacityDraft, type TeamRosterSource } from '@/ActivitySpace/sustainment/team/teamRoster';
import type { Worker } from '@/types/database';

function worker(id: string, overrides: Partial<Worker> = {}): Worker {
  return {
    id, name: id, object_id: null, user_id: null, activity_space_id: null, type: 'human', display_id: null,
    seq_number: null, role: null, email: null, avatar_url: null, ai_model: null,
    ai_config: null, status: 'active', capacity_hours_per_day: null, created_at: null,
    updated_at: null, ...overrides,
  };
}

function source(overrides: Partial<TeamRosterSource> = {}): TeamRosterSource {
  return {
    workers: [], spaceMembers: [], domainMembers: [], domains: [{ id: 'domain', name: 'Operations' }],
    objects: [{ id: 'object', domain_id: 'domain' }], objectDomains: [], elements: [], assignees: [],
    ...overrides,
  };
}

describe('Team Domain membership merge', () => {
  it('drops out-of-scope membership from either reader', () => {
    expect(mergeTeamDomainMembers(['domain'], [
      { user_id: 'hidden', domain_id: 'hidden-domain', role: 'owner' },
    ], [
      { user_id: 'guest', domain_id: 'domain', domain_role: 'member' },
      { user_id: 'foreign', domain_id: 'other-space-domain', domain_role: 'owner' },
    ])).toEqual([{ user_id: 'guest', domain_id: 'domain', role: 'member' }]);
  });

  it('refuses conflicting role snapshots before they can grant management authority', () => {
    expect(() => mergeTeamDomainMembers(['domain'], [
      { user_id: 'guest', domain_id: 'domain', role: 'owner' },
    ], [{ user_id: 'guest', domain_id: 'domain', domain_role: 'member' }])).toThrow('changed while reading');
  });

  it('rejects an unknown role instead of inferring membership authority', () => {
    expect(() => mergeTeamDomainMembers(['domain'], [], [
      { user_id: 'guest', domain_id: 'domain', domain_role: 'unknown' },
    ])).toThrow('membership role');
  });
});

describe('Team roster identity and permissions', () => {
  it('includes idle Space members and Domain guests without borrowing globally visible Workers', () => {
    const entries = buildTeamRoster(source({
      workers: [worker('idle', { user_id: 'member' }), worker('guest', { user_id: 'guest' }),
        worker('foreign'), worker('global-ai', { type: 'ai_agent' })],
      spaceMembers: [{ user_id: 'member', role: 'member' }],
      domainMembers: [{ user_id: 'guest', domain_id: 'domain', role: 'member' }],
    }), 'viewer');
    expect(entries.map((entry) => entry.worker.id)).toEqual(['guest', 'idle']);
    expect(entries.every((entry) => entry.isMember)).toBe(true);
    expect(entries.find((entry) => entry.worker.id === 'idle')?.activeElements).toEqual([]);
    expect(entries.find((entry) => entry.worker.id === 'guest')?.domainNames).toEqual(['Operations']);
    expect(entries.every((entry) => !entry.canManage)).toBe(true);
  });

  it('keeps an account’s Object-specific identity in its own scope', () => {
    const entries = buildTeamRoster(source({
      workers: [worker('other-object', { user_id: 'member', object_id: 'outside' }), worker('local-object', { user_id: 'member', object_id: 'object' })],
      spaceMembers: [{ user_id: 'member', role: 'member' }],
    }), 'viewer');
    expect(entries.map((entry) => entry.worker.id)).toEqual(['local-object']);
  });

  it('uses Object multi-homing to authorize the owner of the local Domain', () => {
    const entries = buildTeamRoster(source({
      workers: [worker('object-agent', { type: 'ai_agent', object_id: 'linked' })],
      objects: [{ id: 'linked', domain_id: 'elsewhere' }],
      objectDomains: [{ object_id: 'linked', domain_id: 'domain' }],
      domainMembers: [{ user_id: 'owner', domain_id: 'domain', role: 'owner' }],
    }), 'owner');
    expect(entries[0]).toMatchObject({ canManage: true, isMember: false, domainNames: ['Operations'], membership: 'Object Worker' });
  });

  it('does not turn an assignment into authority over a Worker from elsewhere', () => {
    const entries = buildTeamRoster(source({
      workers: [worker('outside-agent', { type: 'ai_agent', object_id: 'outside' })],
      spaceMembers: [{ user_id: 'owner', role: 'owner' }],
      domainMembers: [{ user_id: 'owner', domain_id: 'domain', role: 'owner' }],
      elements: [{ id: 'element', title: 'Assigned work', display_id: null, status: 'todo', due_date: null, object_id: 'object', start_date: null, created_at: null, updated_at: null }],
      assignees: [{ element_id: 'element', worker_id: 'outside-agent' }],
    }), 'owner');
    expect(entries[0]).toMatchObject({ canManage: false, isMember: false, membership: 'Assigned Worker' });
  });

  it('allows self, Space owner, and owner of a matching Domain, with no unrelated owner privilege', () => {
    const rows = source({
      workers: [worker('member-worker', { user_id: 'member' })],
      spaceMembers: [{ user_id: 'space-owner', role: 'owner' }, { user_id: 'member', role: 'member' }],
      domainMembers: [{ user_id: 'member', domain_id: 'domain', role: 'member' },
        { user_id: 'domain-owner', domain_id: 'domain', role: 'owner' },
        { user_id: 'other-owner', domain_id: 'outside', role: 'owner' }],
    });
    for (const userId of ['member', 'space-owner', 'domain-owner']) expect(buildTeamRoster(rows, userId)[0].canManage).toBe(true);
    expect(buildTeamRoster(rows, 'other-owner')[0].canManage).toBe(false);
  });

  it('deduplicates Workers and assignments, excludes closed work, and orders dated work first', () => {
    const duplicate = worker('assigned');
    const entries = buildTeamRoster(source({
      workers: [duplicate, duplicate],
      elements: [
        { id: 'later', title: 'Later', status: 'todo', due_date: '2026-09-10', display_id: null, object_id: 'object', start_date: null, created_at: null, updated_at: null },
        { id: 'none', title: 'Undated', status: 'backlog', due_date: null, display_id: null, object_id: 'object', start_date: null, created_at: null, updated_at: null },
        { id: 'early', title: 'Early', status: 'blocked', due_date: '2026-09-01', display_id: null, object_id: 'object', start_date: null, created_at: null, updated_at: null },
        { id: 'done', title: 'Done', status: 'done', due_date: '2026-08-01', display_id: null, object_id: 'object', start_date: null, created_at: null, updated_at: null },
        { id: 'cancelled', title: 'Cancelled', status: 'cancelled', due_date: null, display_id: null, object_id: 'object', start_date: null, created_at: null, updated_at: null },
      ],
      assignees: ['later', 'none', 'early', 'early', 'done', 'cancelled', 'invisible'].map((element_id) => ({ element_id, worker_id: 'assigned' })),
    }), 'viewer');
    expect(entries).toHaveLength(1);
    expect(entries[0].activeElements.map((element) => element.id)).toEqual(['early', 'later', 'none']);
    // The full record keeps closed work: it is the assignment history and skill evidence.
    expect(entries[0].elements.map((element) => element.id).sort()).toEqual(['cancelled', 'done', 'early', 'later', 'none']);
  });
});

describe('standing capacity input', () => {
  it('preserves zero and decimals, and restores defaults only for empty input', () => {
    expect(parseCapacityDraft('')).toBeNull();
    expect(parseCapacityDraft('  ')).toBeNull();
    expect(parseCapacityDraft('0')).toBe(0);
    expect(parseCapacityDraft(' 7.5 ')).toBe(7.5);
    expect(parseCapacityDraft('.5')).toBe(0.5);
    expect(parseCapacityDraft('24')).toBe(24);
  });

  it.each(['-1', '24.01', 'Infinity', 'NaN', '1e3', '0x10', 'eight', '8 hours', '1,5'])('rejects invalid capacity %s', (value) => {
    expect(() => parseCapacityDraft(value)).toThrow('0 to 24');
  });
});
