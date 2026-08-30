import { addElementAssignee, createElement, type Worker } from '@/hooks/useSupabase';
import { sectionGroupValues, type SectionGroup } from '@/alcon/shared/listControls/sectionGroup';

/**
 * Create Elements from an in-list add row, each one carrying the classifying
 * value of the group the row sits in — the cursor position already answered
 * "which status / which assignee / which label", so the create path applies
 * it instead of asking again and dropping the new row into another band.
 *
 * Inserts run one at a time so `order_index` comes out in the order the
 * titles were typed or pasted. A failing title is logged and skipped rather
 * than aborting the rest of a paste.
 */
export async function createElementsInGroup({
  titles,
  objectId,
  group,
  workers,
}: {
  titles: string[];
  /** Where the Elements live. `null` = Domain-direct. */
  objectId: string | null;
  /** The section's bucket. Undefined for Object bands and un-grouped lists,
   *  which classify by nothing and so inherit nothing. */
  group: SectionGroup | undefined;
  /** Known Workers, used to render the assignee chip immediately. Without a
   *  match the chip falls back to initials until the next refetch. */
  workers?: Worker[];
}): Promise<void> {
  const { assigneeWorkerIds, ...fields } = sectionGroupValues(group);
  for (const title of titles) {
    try {
      const created = await createElement({ title, object_id: objectId, ...fields });
      // Assignee buckets are a junction row, not a column, so they land a
      // beat after the insert — the row shows under "Unassigned" for that one
      // round-trip, same as the quick-add popup's assignee path.
      for (const workerId of assigneeWorkerIds) {
        try {
          await addElementAssignee({
            element_id: created.id,
            worker_id: workerId,
            role: 'assignee',
            worker: workers?.find((w) => w.id === workerId),
          });
        } catch (e) { console.warn('Could not assign Element:', e); }
      }
    } catch (e) { console.error('Failed to create Element', e); }
  }
}
