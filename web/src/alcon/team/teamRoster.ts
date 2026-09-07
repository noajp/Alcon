import type { ActivitySpaceMember, DomainMember, Element, Worker } from '@/types/database';

export type TeamElement = Pick<Element, 'id' | 'title' | 'display_id' | 'status' | 'due_date' | 'object_id'>;

export interface TeamRosterSource {
  workers: Worker[];
  spaceMembers: Pick<ActivitySpaceMember, 'user_id' | 'role'>[];
  domainMembers: Pick<DomainMember, 'user_id' | 'domain_id' | 'role'>[];
  domains: { id: string; name: string }[];
  objects: { id: string; domain_id: string | null }[];
  objectDomains: { object_id: string; domain_id: string }[];
  elements: TeamElement[];
  assignees: { element_id: string; worker_id: string }[];
}

export interface TeamRosterEntry {
  worker: Worker;
  isMember: boolean;
  membership: string;
  domainNames: string[];
  canManage: boolean;
  activeElements: TeamElement[];
}

/** Both reads enforce their own boundary. Keep only the current visible
 * Domains, and refuse a conflicting role snapshot before deriving authority. */
export function mergeTeamDomainMembers(
  domainIds: readonly string[],
  direct: TeamRosterSource['domainMembers'],
  guests: readonly { user_id: string; domain_id: string; domain_role: string }[],
): TeamRosterSource['domainMembers'] {
  const visible = new Set(domainIds);
  const members = new Map<string, TeamRosterSource['domainMembers'][number]>();
  for (const row of [...direct, ...guests.map(({ user_id, domain_id, domain_role }) => ({ user_id, domain_id, role: domain_role }))]) {
    if (!visible.has(row.domain_id)) continue;
    if (row.role !== 'owner' && row.role !== 'member') throw new Error('Unable to read the Domain membership role. Refresh and try again.');
    const key = `${row.domain_id}:${row.user_id}`;
    const existing = members.get(key);
    if (existing && existing.role !== row.role) throw new Error('Domain membership changed while reading. Refresh and try again.');
    members.set(key, { user_id: row.user_id, domain_id: row.domain_id, role: row.role });
  }
  return [...members.values()];
}

/** Membership, an Object home, or an actual assignment gives a Worker a
 * place in this roster. Visibility alone never establishes Space membership. */
export function buildTeamRoster(source: TeamRosterSource, userId: string): TeamRosterEntry[] {
  const spaceMembers = new Map(source.spaceMembers.map((row) => [row.user_id, row.role]));
  const isSpaceOwner = spaceMembers.get(userId) === 'owner';
  const domains = new Map(source.domains.map((row) => [row.id, row.name]));
  const ownedDomains = new Set(source.domainMembers.filter((row) => row.user_id === userId && row.role === 'owner').map((row) => row.domain_id));
  const domainsByUser = new Map<string, Set<string>>();
  for (const row of source.domainMembers) {
    if (!domains.has(row.domain_id)) continue;
    const ids = domainsByUser.get(row.user_id) ?? new Set<string>();
    ids.add(row.domain_id);
    domainsByUser.set(row.user_id, ids);
  }
  const objects = new Set(source.objects.map((row) => row.id));
  const domainsByObject = new Map<string, Set<string>>();
  for (const row of [...source.objectDomains, ...source.objects.map((object) => ({ object_id: object.id, domain_id: object.domain_id }))]) {
    if (!row.domain_id || !objects.has(row.object_id) || !domains.has(row.domain_id)) continue;
    const ids = domainsByObject.get(row.object_id) ?? new Set<string>();
    ids.add(row.domain_id);
    domainsByObject.set(row.object_id, ids);
  }
  const elements = new Map(source.elements.map((row) => [row.id, row]));
  const assignmentsByWorker = new Map<string, Set<string>>();
  for (const row of source.assignees) {
    if (!elements.has(row.element_id)) continue;
    const ids = assignmentsByWorker.get(row.worker_id) ?? new Set<string>();
    ids.add(row.element_id);
    assignmentsByWorker.set(row.worker_id, ids);
  }

  return [...new Map(source.workers.map((row) => [row.id, row])).values()].flatMap((worker): TeamRosterEntry[] => {
    const homeInScope = worker.object_id !== null && objects.has(worker.object_id);
    const userDomains = worker.user_id ? domainsByUser.get(worker.user_id) ?? new Set<string>() : new Set<string>();
    // An Object-scoped Worker identity belongs to its Object even when the
    // account behind it is a member of several Spaces.
    const accountInScope = worker.object_id === null || homeInScope;
    const spaceMember = accountInScope && worker.user_id !== null && spaceMembers.has(worker.user_id);
    const domainMember = accountInScope && userDomains.size > 0;
    const assignments = assignmentsByWorker.get(worker.id) ?? new Set<string>();
    if (!spaceMember && !domainMember && !homeInScope && assignments.size === 0) return [];
    const workerDomains = new Set([
      ...(accountInScope ? userDomains : []),
      ...(worker.object_id ? domainsByObject.get(worker.object_id) ?? [] : []),
    ]);
    const member = worker.type === 'human' && (spaceMember || domainMember);
    return [{
      worker,
      isMember: member,
      membership: spaceMember ? 'Space member' : domainMember ? 'Domain member' : homeInScope ? 'Object Worker' : 'Assigned Worker',
      domainNames: [...workerDomains].map((id) => domains.get(id)!).sort((a, b) => a.localeCompare(b)),
      // An assignment from elsewhere is participation, not permission to
      // change that Worker's standing capacity across all of their work.
      canManage: worker.user_id === userId
        || (isSpaceOwner && (spaceMember || domainMember || homeInScope))
        || [...workerDomains].some((id) => ownedDomains.has(id)),
      activeElements: [...assignments].map((id) => elements.get(id)!)
        .filter((element) => element.status !== 'done' && element.status !== 'cancelled')
        .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') || a.title.localeCompare(b.title)),
    }];
  }).sort((a, b) => a.worker.name.localeCompare(b.worker.name) || a.worker.id.localeCompare(b.worker.id));
}

/** Blank restores the shared Worker-type default; zero means no standing
 * capacity and must never be mistaken for an empty input. */
export function parseCapacityDraft(value: string): number | null {
  const draft = value.trim();
  if (!draft) return null;
  const hours = Number(draft);
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(draft) || !Number.isFinite(hours) || hours < 0 || hours > 24) {
    throw new Error('Enter hours from 0 to 24, or leave blank to use the default.');
  }
  return hours;
}
