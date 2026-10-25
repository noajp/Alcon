'use client';

import { getQueryClient } from '@/lib/queryClient';
import { supabase } from '@/lib/supabase';
import { translate } from '@/Function/i18n/I18nProvider';
import type { DomainMemberRole } from '@/types/database';

// A Domain member's role changes only through set_domain_member_role: its
// owners and admins may change it, only an owner grants or removes ownership,
// and the last owner stays an owner. A viewer reads everything in the Domain
// and changes nothing.

export async function setDomainMemberRole(domainId: string, userId: string, role: DomainMemberRole): Promise<DomainMemberRole> {
  const { data, error } = await supabase.rpc('set_domain_member_role', { p_domain: domainId, p_user: userId, p_role: role });
  if (error) {
    const message = error.code === '42501' || error.code === '23514' ? error.message : translate('The role could not be changed. Try again.');
    throw new Error(message);
  }
  const qc = getQueryClient();
  for (const queryKey of [['my-domain-roles'], ['domain-role']]) void qc.invalidateQueries({ queryKey });
  return data as DomainMemberRole;
}
