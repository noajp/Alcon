'use client';

import { useCallback, useMemo } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { selectIn } from '@/hooks/chunkedIn';
import { supabase } from '@/lib/supabase';
import type { WorkerSkill, WorkerSkillEvidence, WorkerSkillLevel } from '@/types/database';
import { parseSkillName } from '@/Function/team/people';

export interface WorkerSkillsData {
  skills: WorkerSkill[];
  /** Only rows whose Element the reader can see (RLS). */
  evidence: WorkerSkillEvidence[];
}

const EMPTY: WorkerSkillsData = { skills: [], evidence: [] };

async function fetchWorkerSkills(workerIds: string[]): Promise<WorkerSkillsData> {
  const skills = await selectIn<WorkerSkill>(workerIds, (chunk) => supabase
    .from('worker_skills').select('*').in('worker_id', chunk).order('name'));
  const evidence = await selectIn<WorkerSkillEvidence>(skills.map((row) => row.id), (chunk) => supabase
    .from('worker_skill_evidence').select('*').in('skill_id', chunk).order('created_at'));
  return { skills, evidence };
}

/** A write RLS refused matches no row and returns no error — say so. */
const refused = () => new Error('Only this Worker or someone who manages them can change their skills.');

function friendly(error: { code?: string; message: string }): Error {
  if (error.code === '23505') return new Error('This Worker already has that skill.');
  if (error.code === '42501') return refused();
  return new Error(error.message);
}

/**
 * Skills and their evidence for a roster. Writes go straight to the server and
 * then refresh every roster's cache, so a skill added on one person's panel
 * shows in the skill index at once.
 */
export function useWorkerSkills(workerIds: string[]) {
  const idsKey = useMemo(() => [...new Set(workerIds)].sort().join('\n'), [workerIds]);
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['worker-skills', idsKey] as const,
    queryFn: () => fetchWorkerSkills(idsKey.split('\n')),
    enabled: !!idsKey,
    placeholderData: keepPreviousData,
    gcTime: 5 * 60_000,
  });
  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: ['worker-skills'] }), [qc]);

  const addSkill = useCallback(async (workerId: string, draftName: string, level: WorkerSkillLevel) => {
    const name = parseSkillName(draftName);
    const { data, error } = await supabase.from('worker_skills').insert({ worker_id: workerId, name, level }).select().single();
    await refresh();
    if (error) throw friendly(error);
    return data as WorkerSkill;
  }, [refresh]);

  const setLevel = useCallback(async (skillId: string, level: WorkerSkillLevel) => {
    const { data, error } = await supabase.from('worker_skills')
      .update({ level, updated_at: new Date().toISOString() }).eq('id', skillId).select('id');
    await refresh();
    if (error) throw friendly(error);
    if (!data?.length) throw refused();
  }, [refresh]);

  const removeSkill = useCallback(async (skillId: string) => {
    const { data, error } = await supabase.from('worker_skills').delete().eq('id', skillId).select('id');
    await refresh();
    if (error) throw friendly(error);
    if (!data?.length) throw refused();
  }, [refresh]);

  const addEvidence = useCallback(async (skillId: string, elementId: string) => {
    const { error } = await supabase.from('worker_skill_evidence').insert({ skill_id: skillId, element_id: elementId });
    await refresh();
    if (error) throw error.code === '42501'
      ? new Error('Evidence must be a done Element assigned to this Worker, added by someone who manages them.')
      : friendly(error);
  }, [refresh]);

  const removeEvidence = useCallback(async (skillId: string, elementId: string) => {
    const { data, error } = await supabase.from('worker_skill_evidence').delete()
      .eq('skill_id', skillId).eq('element_id', elementId).select('skill_id');
    await refresh();
    if (error) throw friendly(error);
    if (!data?.length) throw refused();
  }, [refresh]);

  return {
    data: query.data ?? EMPTY,
    loading: !!idsKey && query.isPending,
    error: query.error,
    addSkill, setLevel, removeSkill, addEvidence, removeEvidence,
  };
}
