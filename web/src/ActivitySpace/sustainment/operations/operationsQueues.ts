import type { OperationsAnalysis } from './operationsModel';

export type OperationsQueue = 'overview' | 'attention' | 'records' | 'incomplete';

export const OPERATIONS_QUEUES: readonly OperationsQueue[] = ['overview', 'attention', 'records', 'incomplete'];

export function operationsQueueLabel(queue: OperationsQueue): string {
  switch (queue) {
    case 'overview': return 'Overview';
    case 'attention': return 'Follow-ups';
    case 'records': return 'Opportunities';
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
