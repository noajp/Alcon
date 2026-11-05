'use client';

import { ObjectMark } from '@/Function/shared/ObjectMark';
import { completionOf } from '@/Function/shared/completion';
import { ContentRow } from '@/Function/shared/ContentRow';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { WidgetProps } from '../types';

export function DomainObjectsWidget({ host }: WidgetProps) {
  const { t } = useI18n();
  const objects = host.explorerData?.objects ?? [];
  if (!objects.length) return <p className="py-1 text-sm text-muted-foreground">{t('No Objects in this Domain yet.')}</p>;
  return <div className="-mx-2">
    {objects.map(object => {
      const { done, total } = completionOf(object.elements ?? []);
      return <ContentRow key={object.id} icon={<ObjectMark object={object} size={14} />} name={object.name}
        meta={total ? `${done} / ${total}` : '—'}
        onOpen={() => host.onNavigate?.({ objectId: object.id, domainId: host.subject.id })} />;
    })}
  </div>;
}
