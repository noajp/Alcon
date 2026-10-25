'use client';

import { useInitiativeDomains } from '@/hooks/useDomainOverview';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { Button } from '@/ui/button';
import type { WidgetProps } from '../types';
import { RelationRow } from './RelationRow';

export function InitiativeDomainsWidget({ host }: WidgetProps) {
  const { t } = useI18n();
  const query = useInitiativeDomains(host.subject.id);
  if (query.isPending) return <p role="status" className="text-sm text-muted-foreground">{t('Loading Domains…')}</p>;
  if (query.isError) return <div role="alert"><p className="text-sm text-muted-foreground">{t('Unable to load related Domains.')}</p><Button variant="ghost" onClick={() => void query.refetch()}>{t('Retry')}</Button></div>;
  if (!query.data?.length) return <p className="py-1 text-sm text-muted-foreground">{t('No related Domains in this Space or shared with you. Link Objects to this Initiative to connect the work.')}</p>;
  return <div className="space-y-3">
    <p className="text-xs text-muted-foreground">{t('Domains in this Space or shared with you, connected through this Initiative’s Objects.')}</p>
    {query.data.map(({ domain, objects }) => <RelationRow key={domain.id}
      name={domain.name} onOpen={() => host.onNavigate?.({ domainId: domain.id })}
      through={objects.map(object => ({ id: object.id, name: object.name, onOpen: () => host.onNavigate?.({ objectId: object.id, domainId: domain.id }) }))} />)}
  </div>;
}
