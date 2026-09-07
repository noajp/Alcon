import type { NavigationState } from '@/types/navigation';
import type { OperationsAnalysis, OperationsKind } from './operationsModel';

export type OperationsQueue = 'overview' | 'attention' | 'records' | 'incomplete';

export const OPERATIONS_QUEUES: readonly OperationsQueue[] = ['overview', 'attention', 'records', 'incomplete'];

export function operationsQueue(navigation: NavigationState, kind: OperationsKind): OperationsQueue {
  const value = kind === 'crm' ? navigation.crmQueue : navigation.scmQueue;
  return OPERATIONS_QUEUES.includes(value as OperationsQueue) ? value as OperationsQueue : 'overview';
}

export function operationsQueueRoute(kind: OperationsKind, queue: OperationsQueue): Partial<NavigationState> {
  return kind === 'crm' ? { crmQueue: queue } : { scmQueue: queue };
}

export function operationsQueueLabel(kind: OperationsKind, queue: OperationsQueue): string {
  switch (queue) {
    case 'overview': return 'Overview';
    case 'attention': return kind === 'crm' ? 'Follow-ups' : 'Supply risks';
    case 'records': return kind === 'crm' ? 'Opportunities' : 'Inventory';
    case 'incomplete': return 'Missing details';
  }
}

/** Invalid inputs must never be treated as a clear plan or an actionable estimate. */
export function operationsQueues(analysis: OperationsAnalysis) {
  return {
    attention: analysis.rows.filter(row => row.valid && row.signals.some(signal => signal.severity !== 'low')),
    incomplete: analysis.rows.filter(row => !row.valid),
  };
}
