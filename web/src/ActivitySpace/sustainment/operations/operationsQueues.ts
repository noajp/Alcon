import { translate } from '@/Function/i18n/I18nProvider';
import type { OperationsAnalysis } from '@/Function/operations/operationsModel';

export type OperationsQueue = 'overview' | 'attention' | 'records' | 'incomplete';

export const OPERATIONS_QUEUES: readonly OperationsQueue[] = ['overview', 'attention', 'records', 'incomplete'];

/** The queue's name in the reader's language (callers outside React read it too). */
export function operationsQueueLabel(queue: OperationsQueue): string {
  switch (queue) {
    case 'overview': return translate('Overview');
    case 'attention': return translate('Follow-ups');
    case 'records': return translate('Opportunities');
    case 'incomplete': return translate('Missing details');
  }
}

/** Invalid inputs must never be treated as a clear plan or an actionable estimate. */
export function operationsQueues(analysis: OperationsAnalysis) {
  return {
    attention: analysis.rows.filter(row => row.valid && row.signals.some(signal => signal.severity !== 'low')),
    incomplete: analysis.rows.filter(row => !row.valid),
  };
}
