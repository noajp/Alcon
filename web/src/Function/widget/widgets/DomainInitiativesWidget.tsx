'use client';

import { useDomainOverview } from '@/hooks/useDomainOverview';
import { Button } from '@/ui/button';
import type { WidgetProps } from '../types';

export function DomainInitiativesWidget({ host }: WidgetProps) {
  const query = useDomainOverview(host.subject.id);
  if (query.isPending) return <p role="status" className="text-sm text-muted-foreground">Loading Initiatives…</p>;
  if (query.isError) return <div role="alert"><p className="text-sm text-muted-foreground">Unable to load related Initiatives.</p><Button variant="ghost" onClick={() => void query.refetch()}>Retry</Button></div>;
  const relations = query.data?.initiatives ?? [];
  if (!relations.length) return <p className="py-3 text-sm text-muted-foreground">No Initiatives linked yet. Add this Domain’s Objects to an Initiative to connect intent and execution.</p>;
  return <div className="space-y-4">
    <p className="text-xs text-muted-foreground">Initiatives supported by Objects in this Domain.</p>
    {relations.map(({ initiative, objectIds }) => <div key={initiative.id} className="space-y-1">
      <Button variant="ghost" align="start" className="h-auto max-w-full whitespace-normal py-1 text-left text-sm font-semibold" onClick={() => host.onNavigate?.({ strategyId: initiative.id })}>{initiative.name}</Button>
      <div className="flex flex-wrap items-center gap-1 pl-2 text-xs text-muted-foreground">
        <span>Through</span>{objectIds.map(id => <Button key={id} variant="ghost" size="xs" className="h-auto max-w-full whitespace-normal py-1 text-left" onClick={() => host.onNavigate?.({ objectId: id, domainId: host.subject.id })}>{query.data?.explorer.objects.find(object => object.id === id)?.name}</Button>)}
      </div>
    </div>)}
  </div>;
}
