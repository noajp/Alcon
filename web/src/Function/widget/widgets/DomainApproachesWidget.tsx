'use client';

import { useDomainApproaches } from '@/hooks/useDomainApproaches';
import { DomainApproachesPanel } from '@/ActivitySpace/execution/domain/DomainApproachesPanel';
import { Button } from '@/ui/button';
import type { WidgetProps } from '../types';

export function DomainApproachesWidget({ host }: WidgetProps) {
  const query = useDomainApproaches(host.subject.id);
  if (query.isPending) return <p role="status" className="text-sm text-muted-foreground">Loading approaches…</p>;
  if (!query.data) return <div role="alert" className="space-y-2 text-sm"><p>Unable to load approaches. {query.error?.message}</p><Button variant="ghost" onClick={() => void query.refetch()}>Retry</Button></div>;
  return <>{query.isError && <div role="alert" className="mb-3 space-y-2 text-sm"><p>Unable to refresh approaches. Showing the last loaded data; drafts are retained.</p><Button variant="ghost" onClick={() => void query.refetch()}>Retry</Button></div>}<DomainApproachesPanel key={host.subject.id} data={{ ...query.data, canEdit: query.data.canEdit && !query.isError && !host.readOnly }} objects={host.explorerData?.objects ?? []} host={host} onSave={query.save} /></>;
}
