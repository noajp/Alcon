import type { AgentRunStatus, Element } from '@/types/database';
import { isElementAction, isHumanAction } from '@/Function/shared/elementActionKinds';

// Whether an Element waits on a person: shown on its card as a "Waiting on
// you" chip, in whatever Status column it sits. It waits when its verb is one
// only a person carries (judge, decide, approve, answer), when it is blocked,
// or when its latest AI run stopped to ask someone. A closed Element waits on
// nobody.

const RUN_ASKS_A_PERSON: AgentRunStatus[] = ['awaiting_approval', 'awaiting_input'];

/** Pure. True when the Element waits on a person. */
export function waitsOnPerson(
  element: Pick<Element, 'status' | 'action'>,
  latestRun: AgentRunStatus | null | undefined,
): boolean {
  if (element.status === 'done' || element.status === 'cancelled') return false;
  const humanVerb = isElementAction(element.action) && isHumanAction(element.action);
  return humanVerb || element.status === 'blocked' || (!!latestRun && RUN_ASKS_A_PERSON.includes(latestRun));
}
