'use client';

import { completionOf } from '@/Function/shared/completion';
import { Button } from '@/ui/button';
import type { WidgetProps } from '../types';

export function DomainObjectsWidget({ host }: WidgetProps) {
  const objects = host.explorerData?.objects ?? [];
  if (!objects.length) return <p className="py-3 text-sm text-muted-foreground">No Objects in this Domain yet.</p>;
  return <div className="divide-y divide-[var(--border-subtle)]">
    {objects.map(object => {
      const { done, total } = completionOf(object.elements ?? []);
      return <div key={object.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
        <Button variant="ghost" align="start" className="h-auto min-w-0 max-w-full whitespace-normal py-1 text-left" onClick={() => host.onNavigate?.({ objectId: object.id, domainId: host.subject.id })}>{object.name}</Button>
        <span className="pl-2 text-xs tabular-nums text-muted-foreground">{total ? `${done} / ${total} Elements completed` : 'No active Elements'}</span>
      </div>;
    })}
  </div>;
}
