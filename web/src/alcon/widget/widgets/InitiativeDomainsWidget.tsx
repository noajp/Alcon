'use client';

import { useInitiativeDomains } from '@/hooks/useDomainOverview';
import { Button } from '@/ui/button';
import type { WidgetProps } from '../types';

export function InitiativeDomainsWidget({ host }: WidgetProps) {
  const query = useInitiativeDomains(host.subject.id);
  if (query.isPending) return <p role="status" className="text-sm text-muted-foreground">Loading Domains…</p>;
  if (query.isError) return <div role="alert"><p className="text-sm text-muted-foreground">Unable to load related Domains.</p><Button variant="ghost" onClick={() => void query.refetch()}>Retry</Button></div>;
  if (!query.data?.length) return <p className="py-3 text-sm text-muted-foreground">No related Domains in this Space or shared with you. Link Objects to this Initiative to connect the work.</p>;
  return <div className="space-y-4">
    <p className="text-xs text-muted-foreground">Domains in this Space or shared with you, connected through this Initiative’s Objects.</p>
    {query.data.map(({ domain, objects }) => <div key={domain.id} className="space-y-1">
      <Button variant="ghost" align="start" className="h-auto max-w-full whitespace-normal py-1 text-left text-sm font-semibold" onClick={() => host.onNavigate?.({ domainId: domain.id })}>{domain.name}</Button>
      <div className="flex flex-wrap items-center gap-1 pl-2 text-xs text-muted-foreground"><span>Through</span>{objects.map(object => <Button key={object.id} variant="ghost" size="xs" className="h-auto max-w-full whitespace-normal py-1 text-left" onClick={() => host.onNavigate?.({ objectId: object.id, domainId: domain.id })}>{object.name}</Button>)}</div>
    </div>)}
  </div>;
}
