import type { WorkerSkill, WorkerSkillEvidence, WorkerSkillLevel } from '@/types/database';
import type { TeamElement, TeamRosterEntry } from '@/Function/team/teamRoster';

export const SKILL_LEVELS: readonly { level: WorkerSkillLevel; label: string }[] = [
  { level: 1, label: 'Learning' },
  { level: 2, label: 'Capable' },
  { level: 3, label: 'Proficient' },
  { level: 4, label: 'Expert' },
];

export const skillLevelLabel = (level: number) => SKILL_LEVELS.find((row) => row.level === level)?.label ?? 'Capable';

/** The key two spellings of one skill share ("React", " react "). */
export const skillKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLocaleLowerCase();

/** Collapses inner whitespace and enforces the table's 1–60 character rule. */
export function parseSkillName(draft: string): string {
  const name = draft.trim().replace(/\s+/g, ' ');
  if (!name) throw new Error('Enter a skill name.');
  if (name.length > 60) throw new Error('Keep the skill name to 60 characters.');
  return name;
}

export interface ObjectAssignment {
  objectId: string;
  /** Null when the Object itself is outside this Space's view. */
  objectName: string | null;
  total: number;
  done: number;
  open: number;
  /** 'YYYY-MM-DD' — the earliest start (or creation) among these Elements. */
  first: string;
  /** 'YYYY-MM-DD' — the latest due date (or last update) among these Elements. */
  last: string;
}

const day = (value: string | null | undefined) => value ? value.slice(0, 10) : null;
const isClosed = (element: TeamElement) => element.status === 'done' || element.status === 'cancelled';

/**
 * Where a Worker has worked, derived from their assigned Elements — nobody
 * enters it. One row per Object, most recent first.
 */
export function assignmentHistory(elements: readonly TeamElement[], objectNames: ReadonlyMap<string, string>): ObjectAssignment[] {
  const rows = new Map<string, ObjectAssignment>();
  for (const element of elements) {
    if (!element.object_id) continue;
    const first = day(element.start_date) ?? day(element.created_at) ?? day(element.due_date);
    const last = day(element.due_date) ?? day(element.updated_at) ?? first;
    const row = rows.get(element.object_id) ?? {
      objectId: element.object_id,
      objectName: objectNames.get(element.object_id) ?? null,
      total: 0, done: 0, open: 0, first: '', last: '',
    };
    row.total += 1;
    if (element.status === 'done') row.done += 1;
    else if (!isClosed(element)) row.open += 1;
    if (first && (!row.first || first < row.first)) row.first = first;
    if (last && (!row.last || last > row.last)) row.last = last;
    rows.set(element.object_id, row);
  }
  return [...rows.values()].sort((a, b) => b.last.localeCompare(a.last) || b.total - a.total || (a.objectName ?? '').localeCompare(b.objectName ?? ''));
}

/** Done Elements of this Worker that are not yet evidence for the skill. */
export function evidenceCandidates(entry: Pick<TeamRosterEntry, 'elements'>, attached: ReadonlySet<string>): TeamElement[] {
  return entry.elements
    .filter((element) => element.status === 'done' && !attached.has(element.id))
    .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? '') || a.title.localeCompare(b.title));
}

export interface SkillHolder {
  workerId: string;
  level: WorkerSkillLevel;
  evidence: number;
}

export interface SkillSummary {
  key: string;
  /** The most common spelling across the roster. */
  name: string;
  holders: SkillHolder[];
}

/**
 * "Who knows what": every skill in the roster with its holders, strongest
 * first — level, then the amount of finished work behind the claim. Skills
 * held by more people come first.
 */
export function skillIndex(skills: readonly WorkerSkill[], evidence: readonly WorkerSkillEvidence[], workerIds?: ReadonlySet<string>): SkillSummary[] {
  const evidenceBySkill = new Map<string, number>();
  for (const row of evidence) evidenceBySkill.set(row.skill_id, (evidenceBySkill.get(row.skill_id) ?? 0) + 1);
  const byKey = new Map<string, { spellings: Map<string, number>; holders: Map<string, SkillHolder> }>();
  for (const skill of skills) {
    if (workerIds && !workerIds.has(skill.worker_id)) continue;
    const key = skillKey(skill.name);
    const bucket = byKey.get(key) ?? { spellings: new Map(), holders: new Map() };
    bucket.spellings.set(skill.name, (bucket.spellings.get(skill.name) ?? 0) + 1);
    const holder: SkillHolder = { workerId: skill.worker_id, level: skill.level, evidence: evidenceBySkill.get(skill.id) ?? 0 };
    const existing = bucket.holders.get(skill.worker_id);
    if (!existing || holder.level > existing.level) bucket.holders.set(skill.worker_id, holder);
    byKey.set(key, bucket);
  }
  return [...byKey.entries()].map(([key, bucket]) => ({
    key,
    name: [...bucket.spellings.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0],
    holders: [...bucket.holders.values()].sort((a, b) => b.level - a.level || b.evidence - a.evidence || a.workerId.localeCompare(b.workerId)),
  })).sort((a, b) => b.holders.length - a.holders.length || a.name.localeCompare(b.name));
}
