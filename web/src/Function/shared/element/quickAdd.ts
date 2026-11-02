// What the Element quick-add popup hands back, turned into rows.
//
// Five surfaces raise the same popup (C anywhere / ⌘K, an Object's Elements,
// the Domain's Elements, My Elements). Each used to carry its own copy of the
// create loop, and the copies drifted: the global C launcher dropped the
// labels and estimate the person had picked, My Elements dropped the estimate,
// and only two of them offered templates. One loop here, so a field the popup
// collects lands the same way whichever surface opened it.

import { assignWorkersToElement, createElement, noticeSkippedAssignees } from '@/hooks/useSupabase';
import type { ElementPriority, ElementStatus, ElementTemplate } from '@/types/database';
import { appDialog } from '@/Function/shared/appDialogStore';
import { translate } from '@/Function/i18n/I18nProvider';
import { partitionAssignable } from '@/Function/shared/assignableWorkers';

/** One title line from the popup, with the pill row's shared fields. */
export interface QuickAddInput {
  title: string;
  description?: string | null;
  type?: string | null;
  status?: ElementStatus | null;
  priority?: ElementPriority | null;
  assigneeWorkerIds?: string[];
  /** undefined = the surface's own target; null = no Object. */
  objectId?: string | null;
  labels?: string[];
  personal?: boolean;
  estimatedHours?: number | null;
}

export interface QuickAddContext {
  /** Object a line lands in when the popup did not name one. */
  fallbackObjectId: string | null;
  /** Owner for a line that ends up with no Object (personal scope). */
  userId: string | null;
  /** Due date the opener preset (the Calendar's "+"). */
  dueDate?: string | null;
  /** Assignees for a line the person left unassigned (My Elements uses the
   *  person's own Worker so the row stays in view). */
  fallbackAssigneeIds?: string[];
}

/** Where a line lands: personal wins, then the popup's pick, then the surface. */
function resolveQuickAddObjectId(input: QuickAddInput, fallbackObjectId: string | null): string | null {
  if (input.personal) return null;
  return input.objectId !== undefined ? input.objectId : fallbackObjectId;
}

/**
 * Create one Element per line. A bad line does not discard the rest; a batch
 * where some lines failed says how many, and a batch where none landed
 * rejects so the popup keeps the text instead of reporting success.
 */
export async function createQuickAddElements(inputs: readonly QuickAddInput[], ctx: QuickAddContext): Promise<number> {
  let created = 0;
  let lastError: unknown = null;
  let skippedAssignees = 0;
  for (const input of inputs) {
    try {
      const objectId = resolveQuickAddObjectId(input, ctx.fallbackObjectId);
      const row = await createElement({
        title: input.title,
        object_id: objectId,
        owner_id: objectId ? null : ctx.userId,
        description: input.description ?? null,
        type: input.type ?? null,
        labels: input.labels ?? [],
        status: input.status ?? undefined,
        priority: input.priority ?? undefined,
        estimated_hours: input.estimatedHours ?? null,
        due_date: ctx.dueDate ?? undefined,
      });
      created += 1;
      const assignees = input.assigneeWorkerIds?.length ? input.assigneeWorkerIds : ctx.fallbackAssigneeIds ?? [];
      skippedAssignees += (await assignWorkersToElement(row.id, assignees)).skipped.length;
    } catch (e) {
      lastError = e;
      console.error('Failed to create Element', e);
    }
  }
  noticeSkippedAssignees(skippedAssignees);
  const failed = inputs.length - created;
  if (failed > 0) {
    void appDialog.alert(translate('{failed} of {total} Elements could not be created.', { failed, total: inputs.length }));
  }
  if (created === 0 && inputs.length > 0) {
    throw lastError ?? new Error('No Elements were created');
  }
  return created;
}

/** The Domain's saved templates as the popup's Template pill reads them. A
 *  template keeps only the assignees the surface can actually assign. */
export function toQuickAddTemplates(templates: readonly ElementTemplate[], assignable: readonly { id: string }[]) {
  return templates.map((t) => ({
    id: t.id,
    name: t.name,
    type: t.type,
    status: t.status,
    priority: t.priority,
    labels: t.labels,
    assigneeWorkerIds: partitionAssignable(t.assignee_worker_ids, assignable).assignable,
    description: t.description,
    estimatedHours: t.estimated_hours,
  }));
}
