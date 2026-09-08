'use client';

import { supabase } from '@/lib/supabase';
import { getQueryClient } from '@/lib/queryClient';
import { invalidateElementDetail } from '@/Function/sync/explorerCache';
import { normalizeDirection } from '@/types/database';
import type { Element, ElementComment, ElementEdge, ElementStatus, ElementWithDetails, Worker } from '@/types/database';

export interface NowWorkData {
  elements: ElementWithDetails[];
  workers: Worker[];
  objects: { id: string; name: string; domain_id: string | null }[];
  edges: ElementEdge[];
  readAt: string;
}

export const CHECK_IN_NOTE_MAX = 4000;
export const CHECK_IN_NEXT_MAX = 2000;
export interface CheckInPatch { status?: ElementStatus; next?: string | null }
export interface CheckInInput {
  elementId: string;
  expectedUpdatedAt: string | null;
  requestId: string;
  patch: CheckInPatch;
  note?: string;
}
export interface CheckInResult { element: Element; comment: ElementComment; replayed: boolean }
export class CoordinationError extends Error {
  constructor(message: string, public readonly code: string) { super(message); this.name = 'CoordinationError'; }
}

function normalizeNowWorkData(value: unknown): NowWorkData {
  if (!value || typeof value !== 'object') throw new CoordinationError('Now data is unavailable. Refresh and try again.', 'INVALID_RESPONSE');
  const row = value as Partial<NowWorkData>;
  if (!Array.isArray(row.elements) || !Array.isArray(row.workers) || !Array.isArray(row.objects)
    || !Array.isArray(row.edges) || typeof row.readAt !== 'string' || !Number.isFinite(Date.parse(row.readAt))) {
    throw new CoordinationError('The Now response was incomplete. Refresh and try again.', 'INVALID_RESPONSE');
  }
  if (row.elements.some((element) => !element || typeof element.id !== 'string'
      || !Object.hasOwn(element, 'status') || !Array.isArray(element.assignees)
      || element.assignees.some((assignee) => !assignee || typeof assignee.worker_id !== 'string'))
    || new Set(row.elements.map((element) => element.id)).size !== row.elements.length
    || row.workers.some((worker) => !worker || typeof worker.id !== 'string')
    || row.objects.some((object) => !object || typeof object.id !== 'string' || typeof object.name !== 'string')
    || row.edges.some((edge) => !edge || typeof edge.from_element !== 'string' || typeof edge.to_element !== 'string' || edge.edge_type !== 'depends_on')) {
    throw new CoordinationError('The Now response was inconsistent. Refresh and try again.', 'INVALID_RESPONSE');
  }
  return { ...row, elements: row.elements.map((element) => ({ ...element, direction: normalizeDirection(element.direction) })) } as NowWorkData;
}

export async function fetchNowWork(spaceId: string, signal?: AbortSignal): Promise<NowWorkData> {
  const request = supabase.rpc('get_now_work', { p_space_id: spaceId });
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error) throw new CoordinationError(error.message, error.code);
  return normalizeNowWorkData(data);
}

function invalidateCoordination(elementIds: string[]) {
  const qc = getQueryClient();
  for (const id of elementIds) invalidateElementDetail(id);
  for (const key of ['nowWork', 'explorer', 'my-elements', 'element-blockers', 'element-activity', 'decisionLab']) {
    void qc.invalidateQueries({ queryKey: [key] });
  }
}

export async function checkInElement(input: CheckInInput): Promise<CheckInResult> {
  const { data, error } = await supabase.rpc('check_in_element', {
    p_element_id: input.elementId, p_expected_updated_at: input.expectedUpdatedAt,
    p_request_id: input.requestId, p_patch: input.patch, p_note: input.note ?? '',
  });
  if (error) throw new CoordinationError(error.message, error.code);
  if (!data?.element?.id || !data?.comment?.id || typeof data.replayed !== 'boolean') {
    throw new CoordinationError('The check-in response was incomplete. Retry the same check-in.', 'INVALID_RESPONSE');
  }
  invalidateCoordination([input.elementId]);
  return data as CheckInResult;
}

export interface SetElementDependencyInput { spaceId: string; upstreamId: string; downstreamId: string; remove?: boolean }
export async function setElementDependency(input: SetElementDependencyInput): Promise<ElementEdge | null> {
  const { data, error } = await supabase.rpc('set_element_dependency', {
    p_space_id: input.spaceId, p_upstream_id: input.upstreamId,
    p_downstream_id: input.downstreamId, p_remove: input.remove ?? false,
  });
  if (error) throw new CoordinationError(error.message, error.code);
  invalidateCoordination([input.upstreamId, input.downstreamId]);
  return data as ElementEdge | null;
}
