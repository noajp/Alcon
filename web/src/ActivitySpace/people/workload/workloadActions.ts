'use client';

import { removeElementAssignee, updateElement } from '@/hooks/elementData';
import { assignWorkersToElement } from '@/hooks/teamData';
import { translate } from '@/Function/i18n/I18nProvider';
import type { Proposal } from './workloadRebalance';

/**
 * Writes one proposal through the same paths a person's own edit takes, so
 * the explorer cache moves at once and every other surface sees the change.
 *
 * A hand-over adds the new holder first and removes the old one only once the
 * new one is in. The reverse order leaves the Element with nobody when the
 * database refuses the new Worker (inactive, or unable to see it) — the very
 * work the plan was trying to keep moving would drop out of everyone's view.
 */
export async function applyWorkloadProposal(p: Proposal): Promise<void> {
  if (p.kind === 'reschedule') {
    await updateElement(p.elementId, { start_date: p.to.start, due_date: p.to.due });
    return;
  }
  const { assigned } = await assignWorkersToElement(p.elementId, [p.toWorkerId]);
  if (!assigned.includes(p.toWorkerId)) {
    throw new Error(translate('This Worker cannot be assigned to this Element: they are inactive, outside its Space, or cannot see it.'));
  }
  if (p.kind !== 'reassign') return;
  try {
    await removeElementAssignee(p.assigneeId);
  } catch {
    // The new holder is in; only the old one could not be taken off (already
    // removed elsewhere, or no longer visible). Nothing is lost — say exactly
    // what is left so the person can finish it by hand.
    throw new Error(translate('Handed over, but the previous assignee is still on this Element. Remove them from the Element.'));
  }
}
