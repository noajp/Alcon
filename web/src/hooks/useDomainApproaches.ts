'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useCurrentUserId } from '@/providers/authContext';
import { readAllPages, type CountedRows } from './readAllPages';
import { chunkIds } from './chunkedIn';
import type { ApproachData, DomainApproach, ApproachCondition, ApproachContribution, ApproachAssessment, ApproachReview } from '@/Function/domain/approachModel';

type InitiativeOption = { id: string; name: string };
type MeasureOption = { id: string; strategy_id: string; title: string };
export interface DomainApproachData extends ApproachData {
  canEdit: boolean; initiatives: InitiativeOption[]; measures: MeasureOption[];
  authors: { id: string; display_name: string | null }[];
}
async function relatedRows<T extends { id: string }>(table: string, column: string, ids: string[], select = '*') {
  const rows: T[] = [];
  for (const chunk of chunkIds([...new Set(ids)])) rows.push(...await readAllPages<T>(table,
    (from, to) => supabase.from(table).select(select, { count: 'exact' }).in(column, chunk).order('id').range(from, to) as unknown as PromiseLike<CountedRows<T>>, r => r.id));
  return rows;
}
export async function fetchDomainApproaches(domainId: string): Promise<DomainApproachData> {
  const readApproaches = () => readAllPages<DomainApproach>('Domain approaches', (from, to) => supabase.from('domain_approaches')
    .select('*', { count: 'exact' }).eq('domain_id', domainId).order('id').range(from, to), r => r.id);
  const [approaches, permission, initiatives] = await Promise.all([
    readApproaches(), supabase.rpc('can_edit_domain_approaches', { p_domain_id: domainId }),
    readAllPages<InitiativeOption>('Initiatives', (from, to) => supabase.from('strategies').select('id,name', { count: 'exact' }).order('id').range(from, to), r => r.id),
  ]);
  if (permission.error) throw permission.error;
  const ids = approaches.map(a => a.id);
  const [conditions, contributions, assessments, reviews, measures] = await Promise.all([
    relatedRows<ApproachCondition>('approach_conditions', 'approach_id', ids),
    relatedRows<ApproachContribution>('approach_contributions', 'approach_id', ids),
    relatedRows<ApproachAssessment>('approach_assessments', 'approach_id', ids),
    relatedRows<ApproachReview>('approach_reviews', 'approach_id', ids),
    relatedRows<MeasureOption & { kind: string }>('intents', 'strategy_id', initiatives.map(i => i.id), 'id,strategy_id,title,kind'),
  ]);
  const authors = await relatedRows<DomainApproachData['authors'][number]>('profiles','id', [...assessments, ...reviews].map(a => a.author_id), 'id,display_name');
  const after = await readApproaches();
  if (after.length !== approaches.length || after.some((a, i) => a.id !== approaches[i].id || a.revision !== approaches[i].revision)) {
    throw new Error('The approach changed while loading. Refresh to see a consistent assessment.');
  }
  return { approaches, conditions, contributions, assessments, reviews, canEdit: permission.data === true, initiatives, measures: measures.filter(m => m.kind === 'measure'), authors };
}

export type ApproachCommand =
  | { kind: 'disconnect'; id: string; revision: number }
  | { kind: 'approach'; id?: string; revision?: number; values: Pick<DomainApproach, 'title' | 'expected_change' | 'hypothesis' | 'assumptions' | 'review_trigger' | 'review_date' | 'measure_id'> & { strategy_id: string } }
  | { kind: 'condition'; id?: string; approachId: string; revision: number; values: Pick<ApproachCondition, 'title' | 'kind' | 'required' | 'success_criteria' | 'review_date'> }
  | { kind: 'contribution'; id?: string; approachId: string; revision: number; values: Pick<ApproachContribution, 'condition_id' | 'object_id' | 'role' | 'rationale' | 'sequence_note'> }
  | { kind: 'assessment'; approachId: string; values: Pick<ApproachAssessment, 'condition_id' | 'plan_revision' | 'result' | 'observation' | 'evidence_source' | 'observed_on' | 'reasoning'> }
  | { kind: 'review'; approachId: string; values: Pick<ApproachReview, 'expected_revision' | 'action' | 'reasoning' | 'changes' | 'next_review_date'> };

export async function saveDomainApproach(domainId: string, command: ApproachCommand) {
  if (command.kind === 'disconnect') {
    const { error } = await supabase.rpc('edit_approach_plan_item', { p_kind: 'disconnect', p_id: command.id, p_revision: command.revision, p_patch: {} });
    if (error) throw error;
  } else if (command.kind === 'approach') {
    const { strategy_id, ...values } = command.values;
    const result = command.id
      ? await supabase.from('domain_approaches').update(values).eq('domain_id', domainId).eq('id', command.id).eq('revision', command.revision!).select('id').single()
      : await supabase.from('domain_approaches').insert({ ...values, strategy_id, domain_id: domainId }).select('id').single();
    if (result.error) throw new Error(`Unable to save the approach. It may have changed; refresh and try again. ${result.error.message}`);
  } else if ((command.kind === 'condition' || command.kind === 'contribution') && command.id) {
    const { error } = await supabase.rpc('edit_approach_plan_item', { p_kind: command.kind, p_id: command.id, p_revision: command.revision, p_patch: command.values });
    if (error) throw error;
  } else {
    const table = { condition: 'approach_conditions', contribution: 'approach_contributions', assessment: 'approach_assessments', review: 'approach_reviews' }[command.kind];
    const { error } = await supabase.from(table).insert({ ...command.values, approach_id: command.approachId }).select('id').single();
    if (error) throw error;
  }
}
export function useDomainApproaches(domainId: string | null) {
  const userId = useCurrentUserId();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['domain-approaches', userId, domainId], queryFn: () => fetchDomainApproaches(domainId!), enabled: Boolean(userId && domainId), staleTime: 0, gcTime: 60_000 });
  const mutation = useMutation({
    mutationFn: (command: ApproachCommand) => saveDomainApproach(domainId!, command),
    onError: () => { void qc.invalidateQueries({ queryKey: ['domain-approaches', userId, domainId] }); },
    onSuccess: async () => {
      await Promise.all(['domain-approaches','domain-overview','initiative-domains','approach-references'].map(key => qc.invalidateQueries({ queryKey: [key] })));
    },
  });
  return { ...query, save: mutation.mutateAsync, saving: mutation.isPending };
}
