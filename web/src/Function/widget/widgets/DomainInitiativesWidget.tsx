'use client';

import { useDomainOverview } from '@/hooks/useDomainOverview';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { Button } from '@/ui/button';
import type { WidgetProps } from '../types';
import { RelationRow } from './RelationRow';

export function DomainInitiativesWidget({ host }: WidgetProps) {
  const { t } = useI18n();
  const query = useDomainOverview(host.subject.id);
  if (query.isPending) return <p role="status" className="text-sm text-muted-foreground">{t('Loading Initiatives…')}</p>;
  if (query.isError) return <div role="alert"><p className="text-sm text-muted-foreground">{t('Unable to load related Initiatives.')}</p><Button variant="ghost" onClick={() => void query.refetch()}>{t('Retry')}</Button></div>;
  const relations = query.data?.initiatives ?? [];
  if (!relations.length) return <p className="py-1 text-sm text-muted-foreground">{t('No Initiatives linked yet. Add this Domain’s Objects to an Initiative to connect intent and execution.')}</p>;
  return <div className="space-y-3">
    <p className="text-xs text-muted-foreground">{t('Initiatives supported by Objects in this Domain.')}</p>
    {relations.map(({ initiative, objectIds }) => <RelationRow key={initiative.id}
      name={initiative.name} onOpen={() => host.onNavigate?.({ strategyId: initiative.id })}
      through={objectIds.map(id => ({ id, name: query.data?.explorer.objects.find(object => object.id === id)?.name ?? '', onOpen: () => host.onNavigate?.({ objectId: id, domainId: host.subject.id }) }))} />)}
  </div>;
}
