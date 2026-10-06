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
  return <div className="space-y-3">
    <p className="text-xs text-muted-foreground">Initiatives supported by Objects in this Domain.</p>
    {relations.map(({ initiative, objectIds }) => <div key={initiative.id} className="space-y-0.5">
      <button type="button" onClick={() => host.onNavigate?.({ strategyId: initiative.id })}
        className="-mx-2 max-w-full rounded-md px-2 py-1 text-left text-[13px] font-medium text-foreground outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/40">{initiative.name}</button>
      <div className="flex flex-wrap items-center gap-x-0.5 text-xs text-muted-foreground">
        <span>Through</span>{objectIds.map(id => <button key={id} type="button" onClick={() => host.onNavigate?.({ objectId: id, domainId: host.subject.id })}
          className="max-w-full rounded px-1.5 py-0.5 text-left outline-none transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:bg-muted/40 focus-visible:text-foreground">{query.data?.explorer.objects.find(object => object.id === id)?.name}</button>)}
      </div>
    </div>)}
  </div>;
}
