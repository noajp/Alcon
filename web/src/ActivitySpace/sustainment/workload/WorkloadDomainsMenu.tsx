'use client';

import { Check, Layers } from '@/ui/icons';
import { Button } from '@/ui/button';
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { MenuShell, MENU_SEPARATOR } from '@/Function/shared/menu';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { useSustainmentDomains } from '@/hooks/useSustainmentDomains';
import { useCurrentUserId } from '@/providers/authContext';
import { setWorkloadDomainChoice, useWorkloadDomainChoice } from '@/Function/workload/workloadStore';

/** Which Domains People's load counts, as a menu in its header. Every Domain
 *  is the default; unticking one narrows the chart, the people and the plan
 *  together. */
export function WorkloadDomainsMenu() {
  const { t } = useI18n();
  const userId = useCurrentUserId();
  const spaceId = useActiveSpaceId();
  const contextKey = JSON.stringify([userId, spaceId]);
  const { data: domains } = useSustainmentDomains();
  const choice = useWorkloadDomainChoice(contextKey);
  if (domains.length < 2) return null;
  const accessible = domains.map((d) => d.id);
  const selected = choice === null ? accessible : choice.filter((id) => accessible.includes(id));
  const all = choice === null;
  const toggle = (id: string) => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    setWorkloadDomainChoice(contextKey, next.length === accessible.length ? null : next);
  };
  const sorted = [...domains].sort((a, b) => a.name.localeCompare(b.name));
  const label = all ? t('All Domains') : selected.length === 1 ? sorted.find((d) => d.id === selected[0])?.name ?? '' : t('{n} Domains', { n: selected.length });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant={all ? 'ghost' : 'secondary'} size="xs"><Layers size={13} />{label}</Button>
      </DropdownMenuTrigger>
      <MenuShell as="dropdown" align="end">
        <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setWorkloadDomainChoice(contextKey, null); }}>
          <span className="flex-1">{t('All Domains')}</span>{all && <Check size={13} />}
        </DropdownMenuItem>
        <div className={MENU_SEPARATOR} />
        {sorted.map((d) => (
          <DropdownMenuItem key={d.id} onSelect={(e) => { e.preventDefault(); toggle(d.id); }}>
            <span className="flex-1 truncate">{d.name}</span>{selected.includes(d.id) && <Check size={13} />}
          </DropdownMenuItem>
        ))}
      </MenuShell>
    </DropdownMenu>
  );
}
