// Graduated autonomy (B7) on the connection surface: what a person
// sees of one command's standing, in the minimum they need to judge
// it — its level, and the one number or event that explains it
// ("auto because 15 clean runs"; "asks first — stopped by a
// rejection"). The lane derivation mirrors the engine's
// (laneOfCommand in supabase/functions/_shared/autonomy.ts, over
// reversibilityOf in connectorManifest.ts): Web code cannot import
// Edge modules, so it is copied here in the same spirit as
// catalog.ts's critical-class mirror — the grant rows themselves
// come from the server, and this file only names what they mean.

import type { AutonomyGrant, AutonomyIncidentKind, CommandTrackRecord } from '@/types/database';
import { criticalClassOfManifestCommand } from './catalog';

export type AutonomyLane = 1 | 2 | 3;

/**
 * The lane a stored manifest command stands in: the declaration wins
 * (a contained declaration is lane 1 even on a weighty command — the
 * lane is bookkeeping for thresholds; the approval gate's critical
 * floor is derived separately and never reads it); undeclared, a
 * critical command is lane 3; any other write is lane 2; a read has
 * no lane (autonomy is about writes that would otherwise ask).
 */
export function laneOfManifestCommand(command: {
  name?: unknown; action?: unknown; effect?: unknown; http?: unknown; mcp?: unknown;
  reversibility?: unknown;
}): AutonomyLane | null {
  if (command.effect === 'read') return null;
  if (command.effect !== 'write') return null;
  if (command.reversibility === 'contained') return 1;
  if (command.reversibility === 'wide') return 2;
  if (command.reversibility === 'none') return 3;
  if (criticalClassOfManifestCommand(command) !== null) return 3;
  return 2;
}

/** The one-line standing of a command, as a person reads it. */
export type AutonomyLine =
  | { kind: 'pinned-auto' }
  | { kind: 'pinned-ask' }
  | { kind: 'earned'; clean: number }
  | { kind: 'stopped'; cause: AutonomyIncidentKind }
  | { kind: 'building'; clean: number };

/**
 * Pure. The line a command's row carries, or null when there is
 * nothing to say (no grant, no incident, no record yet — the
 * permission select already tells that story). A pin speaks first:
 * it is the owner's word, and it outranks whatever the record says.
 * An earned auto names its count. A stopped grant names what stopped
 * it. Otherwise a record in progress shows its streak, so a person
 * can see autonomy being earned before it lands.
 */
export function autonomyLineFor(
  grant: AutonomyGrant | null,
  record: CommandTrackRecord | null,
): AutonomyLine | null {
  if (grant?.pinned) return grant.level === 'auto' ? { kind: 'pinned-auto' } : { kind: 'pinned-ask' };
  if (grant?.level === 'auto') return { kind: 'earned', clean: grant.basis.cleanStreak ?? 0 };
  if (grant?.last_incident_kind) return { kind: 'stopped', cause: grant.last_incident_kind };
  if (record && record.clean_streak > 0) return { kind: 'building', clean: record.clean_streak };
  return null;
}

/** The plain words for what stopped a grant, as t() source strings. */
export const AUTONOMY_INCIDENT_WORDS: Record<AutonomyIncidentKind, string> = {
  rejection: 'a rejection',
  verify_mismatch: 'a read-back mismatch',
  reopen: 'work being sent back',
  rollback: 'a rollback',
  verdict_fail: 'a failed check',
  record_lapsed: 'its record going stale',
  lane_closed: 'the command changing',
};

/**
 * Pure. The pin controls a row offers an owner: unpin a pinned
 * grant; otherwise pin either level — except pinning auto where it
 * cannot stand: a lane-3 command, and any critical command whatever
 * its lane (critical always asks; the surface never offers what the
 * gate would refuse). Reads carry no autonomy and get no controls.
 */
export function pinChoicesFor(
  grant: AutonomyGrant | null,
  lane: AutonomyLane | null,
  critical = false,
): ('ask' | 'auto' | 'unpin')[] {
  if (lane === null) return [];
  if (grant?.pinned) return ['unpin'];
  return lane === 3 || critical ? ['ask'] : ['ask', 'auto'];
}
