import type { AgentRunStatus, Element } from '@/types/database';
import { isElementAction, isHumanAction } from '@/Function/shared/elementActionKinds';

// Where an Element stands on a Domain's Flow board, left to right. A card is
// in exactly one column, or in none (cancelled). What waits on a person wins
// over everything still open: a person's verb, a blocked Element, or an AI run
// that stopped to ask. A run's state is newer than the Status a person last
// set, so a working run reads as In progress and a run finished for review as
// To review, whatever the Status says.

export const FLOW_COLUMNS = ['todo', 'waiting', 'in_progress', 'review', 'done'] as const;
export type FlowColumn = (typeof FLOW_COLUMNS)[number];

export const FLOW_COLUMN_LABEL: Record<FlowColumn, string> = {
  todo: 'To do',
  waiting: 'Waiting on you',
  in_progress: 'In progress',
  review: 'To review',
  done: 'Done',
};

const RUN_ASKS_A_PERSON: AgentRunStatus[] = ['awaiting_approval', 'awaiting_input'];
const RUN_WORKING: AgentRunStatus[] = ['running', 'queued'];

/** The column for an Element given the status of its latest AI run (null
 *  when it has none); null for an Element the board leaves out. */
export function flowColumnOf(
  element: Pick<Element, 'status' | 'action'>,
  latestRun: AgentRunStatus | null | undefined,
): FlowColumn | null {
  const status = element.status;
  if (status === 'cancelled') return null;
  if (status === 'done') return 'done';

  const humanVerb = isElementAction(element.action) && isHumanAction(element.action);
  if (humanVerb || status === 'blocked' || (latestRun && RUN_ASKS_A_PERSON.includes(latestRun))) return 'waiting';

  if (latestRun && RUN_WORKING.includes(latestRun)) return 'in_progress';
  if (latestRun === 'awaiting_review') return 'review';

  switch (status) {
    case 'in_progress': return 'in_progress';
    case 'review': return 'review';
    case 'todo':
    case 'backlog':
    case null:
    default:
      return 'todo';
  }
}

/** The Elements grouped by column, each column in the order given. */
export function groupByFlowColumn<E extends Pick<Element, 'id' | 'status' | 'action'>>(
  elements: readonly E[],
  latestRunOf: (id: string) => AgentRunStatus | null | undefined,
): Record<FlowColumn, E[]> {
  const out: Record<FlowColumn, E[]> = { todo: [], waiting: [], in_progress: [], review: [], done: [] };
  for (const element of elements) {
    const column = flowColumnOf(element, latestRunOf(element.id));
    if (column) out[column].push(element);
  }
  return out;
}
