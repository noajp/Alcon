'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { translate } from '@/Function/i18n/I18nProvider';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';

// Units: who belongs where in the organisation — a division, a department, a
// team, a CoE — nested, each with a lead and its members. A unit says who
// someone answers to; a Domain says where they work, and the two differ (a
// CoE member is dispatched into Domains their unit does not own). A Worker
// may be in several units. Every member of the Space sees them; its owners
// arrange them (RLS).

export interface OrgUnit { id: string; activity_space_id: string; parent_id: string | null; name: string; lead_worker_id: string | null; position: number }
export interface OrgUnitMember { unit_id: string; worker_id: string }

const COLUMNS = 'id, activity_space_id, parent_id, name, lead_worker_id, position';
const key = (spaceId: string | null) => ['org-units', spaceId] as const;

/** The active Space's units and who is in each. */
export function useOrgUnits() {
  const spaceId = useActiveSpaceId();
  const query = useQuery({
    queryKey: key(spaceId),
    enabled: !!spaceId,
    queryFn: async (): Promise<{ units: OrgUnit[]; members: OrgUnitMember[] }> => {
      const { data: units, error } = await supabase.from('org_units').select(COLUMNS)
        .eq('activity_space_id', spaceId!).order('position').order('name');
      if (error) throw error;
      const ids = (units ?? []).map((u) => u.id as string);
      if (!ids.length) return { units: [], members: [] };
      const { data: members, error: membersError } = await supabase.from('org_unit_members').select('unit_id, worker_id').in('unit_id', ids);
      if (membersError) throw membersError;
      return { units: (units ?? []) as OrgUnit[], members: (members ?? []) as OrgUnitMember[] };
    },
  });
  return { units: query.data?.units ?? EMPTY_UNITS, members: query.data?.members ?? EMPTY_MEMBERS, loading: !!spaceId && query.isPending };
}
const EMPTY_UNITS: OrgUnit[] = [];
const EMPTY_MEMBERS: OrgUnitMember[] = [];

/** Making, renaming, leading, moving and deleting units, and who is in them. */
export function useOrgUnitActions() {
  const spaceId = useActiveSpaceId();
  const qc = useQueryClient();
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['org-units'] }); };
  const units = () => qc.getQueryData<{ units: OrgUnit[] }>(key(spaceId))?.units ?? [];
  const create = useMutation({
    mutationFn: async ({ name, parentId }: { name: string; parentId: string | null }): Promise<OrgUnit> => {
      if (!spaceId) throw new Error(translate('Choose a Space first.'));
      const last = units().filter((u) => u.parent_id === parentId).reduce((m, u) => Math.max(m, u.position), 0);
      const { data, error } = await supabase.from('org_units').insert({ activity_space_id: spaceId, parent_id: parentId, name: name.trim().slice(0, 200), position: last + 1 })
        .select(COLUMNS).single();
      if (error || !data) throw error ?? new Error(translate('Could not create the unit.'));
      return data as OrgUnit;
    },
    onSettled: refresh,
  });
  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Pick<OrgUnit, 'name' | 'lead_worker_id' | 'parent_id'>> }) => {
      const { error } = await supabase.from('org_units').update(patch.name !== undefined ? { ...patch, name: patch.name.trim().slice(0, 200) } : patch).eq('id', id);
      if (error) throw error;
    },
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (units().some((u) => u.parent_id === id)) throw new Error(translate('Move or delete the units inside it first.'));
      const { error } = await supabase.from('org_units').delete().eq('id', id);
      if (error) throw error;
    },
    onSettled: refresh,
  });
  const addMember = useMutation({
    mutationFn: async ({ unitId, workerId }: { unitId: string; workerId: string }) => {
      const { error } = await supabase.from('org_unit_members').upsert({ unit_id: unitId, worker_id: workerId }, { onConflict: 'unit_id,worker_id', ignoreDuplicates: true });
      if (error) throw error;
    },
    onSettled: refresh,
  });
  const removeMember = useMutation({
    mutationFn: async ({ unitId, workerId }: { unitId: string; workerId: string }) => {
      const { error } = await supabase.from('org_unit_members').delete().eq('unit_id', unitId).eq('worker_id', workerId);
      if (error) throw error;
    },
    onSettled: refresh,
  });
  return { create, update, remove, addMember, removeMember };
}
