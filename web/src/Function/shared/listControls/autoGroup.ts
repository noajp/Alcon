// Infer an effective groupBy from the filter state.
//
// When the user hasn't picked a Group explicitly (groupBy === 'none') and
// they've narrowed the filter to one specific facet (e.g. Status=Todo),
// the band should reflect that focus — "Todo (4)" — rather than the
// parent partition. Priority of inference:
//   status → priority → type → label → assignee
//
// Explicit grouping (anything other than 'none') always wins.

import type { ListFilter, ListGroupBy } from './types';

export function effectiveGroupBy(filter: ListFilter, explicit: ListGroupBy): ListGroupBy {
  if (explicit !== 'none') return explicit;
  if (filter.status?.length)            return 'status';
  if (filter.priority?.length)          return 'priority';
  if (filter.types?.length)             return 'type';
  if (filter.labels?.length)            return 'label';
  if (filter.assigneeWorkerIds?.length) return 'assignee';
  return 'none';
}
