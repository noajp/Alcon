'use client';
import { useApproachReferences } from '@/hooks/useApproachReferences';
import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { WidgetProps } from '../types';
export function ApproachReferencesWidget({ host }: WidgetProps) {
  const { t } = useI18n();
  const query = useApproachReferences(host.subject.kind === 'object' ? 'object' : 'initiative', host.subject.id);
  if (query.isPending) return <p role="status" className="text-xs text-muted-foreground">{t('Loading approaches…')}</p>;
  if (query.isError) return <div role="alert"><p className="text-xs text-muted-foreground">{t('Unable to load approaches.')}</p><Button variant="ghost" onClick={() => void query.refetch()}>{t('Retry')}</Button></div>;
  return <div className="space-y-3">{!query.data?.length && <p className="text-xs text-muted-foreground">{t('No approaches connected in this Space or shared with you. Describe how the work contributes from its Domain.')}</p>}{query.data?.map(r => <div key={r.id} className="space-y-1"><Button variant="ghost" align="start" className="h-auto max-w-full whitespace-normal py-1 text-left" onClick={() => host.onNavigate?.({ domainId: r.domain_id })}>{r.title}</Button><p className="text-xs text-muted-foreground">{r.domainName} · {r.expected_change}</p></div>)}</div>;
}
