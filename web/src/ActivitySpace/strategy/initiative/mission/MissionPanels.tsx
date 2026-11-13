'use client';

import type { MissionData } from '@/hooks/initiativeMissionData';
import type { StrategyDelegation } from '@/types/database';
import {
  type ActionState, type MissionBindingRow, type MissionElementRow, type MissionMeasureRow,
} from './missionModel';

// What the Strategy page's work and its record share, and the record's own
// parts — what was produced and what was approved, each shown once there is
// any. The Execution tab's Objects and Elements are in
// MissionExecution. The tabs place them above their widget boards
// (StrategyShell).

export interface MissionContext {
  initiativeId: string;
  initiativeName: string;
  spaceId: string | null;
  canEdit: boolean;
  measures: MissionMeasureRow[];
  bindings: MissionBindingRow[];
  elements: MissionElementRow[];
  mission: MissionData;
  /** False until the runs and dependencies are read; until then nothing counts as ready. */
  missionLoaded: boolean;
  /** How far the Strategy's AI work goes on its own. */
  delegation: StrategyDelegation;
  setDelegation: (d: StrategyDelegation) => Promise<void>;
  /** The definition the Strategy's Elements follow. */
  definitionId: string | null;
  setDefinition: (id: string | null) => Promise<void>;
  refetch: () => void;
  /** Elements open their Object, as everywhere on this page. */
  onOpenElement: (elementId: string) => void;
}

export const STATE_LABEL: Record<ActionState, string> = {
  done: 'Done', running: 'Running', waiting: 'Waiting', blocked: 'Blocked', failed: 'Failed', todo: 'To do', cancelled: 'Cancelled',
};

export function stateColor(state: ActionState): string {
  switch (state) {
    case 'done': return 'var(--status-success)';
    case 'running': return 'var(--status-info)';
    case 'waiting': return 'var(--status-warning)';
    case 'blocked': case 'failed': return 'var(--status-danger)';
    default: return 'var(--text-tertiary)';
  }
}

export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col rounded-md border border-[var(--border-subtle)] px-3 py-2.5">
      <div className="truncate text-[11px] leading-4 text-muted-foreground" title={label}>{label}</div>
      <div className="mt-1.5 text-[22px] font-semibold leading-7 tracking-tight tabular-nums text-foreground">{value}</div>
      <div className="truncate text-[11px] leading-4 text-muted-foreground">{sub ?? '\u00a0'}</div>
    </div>
  );
}
