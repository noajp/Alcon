'use client';

import { useDomainApproaches } from '@/hooks/useDomainApproaches';
import { DomainApproachesPanel } from '@/ActivitySpace/execution/domain/DomainApproachesPanel';
import { Button } from '@/ui/button';
import type { WidgetProps } from '../types';

export function DomainApproachesWidget({ host }: WidgetProps) {
  const query = useDomainApproaches(host.subject.id);
  if (query.isPending) return <p role="status" className="text-sm text-muted-foreground">Loading approaches…</p>;
  if (query.isError || !query.data) return <div role="alert" className="space-y-2 text-sm"><p>Unable to load approaches. {query.error?.message}</p><Button variant="ghost" onClick={() => void query.refetch()}>Retry</Button></div>;
  return <DomainApproachesPanel key={host.subject.id} data={query.data} objects={host.explorerData?.objects ?? []} host={host} onSave={query.save} />;
}
