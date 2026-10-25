'use client';

import { completionOf } from '@/Function/shared/completion';
import { ContentRow } from '@/Function/shared/ContentRow';
import { ObjectIcon } from '@/Function/shared/conceptIcons';
import type { WidgetProps } from '../types';

export function DomainObjectsWidget({ host }: WidgetProps) {
  const objects = host.explorerData?.objects ?? [];
  if (!objects.length) return <p className="py-3 text-sm text-muted-foreground">No Objects in this Domain yet.</p>;
  return <div className="-mx-2">
    {objects.map(object => {
      const { done, total } = completionOf(object.elements ?? []);
      return <ContentRow key={object.id} icon={<ObjectIcon size={14} />} name={object.name}
        meta={total ? `${done} / ${total}` : '—'}
        onOpen={() => host.onNavigate?.({ objectId: object.id, domainId: host.subject.id })} />;
    })}
  </div>;
}
