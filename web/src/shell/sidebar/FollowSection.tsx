'use client';

import { useI18n } from '@/Function/i18n/I18nProvider';
import { SidebarRow } from '@/Function/shared/SidebarRow';
import { ElementProgressMark } from '@/Function/shared/ElementProgressMark';
import { ObjectIcon } from '@/shell/icons';
import { useFollows, type Followed } from '@/hooks/followData';
import type { ElementWithDetails } from '@/hooks/useSupabase';

/** The Objects and Elements this person follows (the star beside an
 *  Object's or an Element's "…"); each opens where it lives. */
export function FollowList({ activeObjectId, onOpen }: { activeObjectId: string | null; onOpen: (item: Followed) => void }) {
  const { t } = useI18n();
  const { follows, loading } = useFollows();
  if (loading) return null;
  if (!follows.length) return <p className="px-2.5 py-1 text-[12px] text-muted-foreground/70">{t('Follow an Object or Element with the star beside its "…".')}</p>;
  return (
    <div className="space-y-px">
      {follows.map((f) => (
        <SidebarRow key={`${f.kind}:${f.id}`} label={f.label} title={f.label}
          active={f.kind === 'object' && f.objectId === activeObjectId}
          icon={f.kind === 'object' ? <ObjectIcon size={16} /> : <ElementProgressMark status={f.status as ElementWithDetails['status']} size={14} />}
          onClick={() => onOpen(f)} />
      ))}
    </div>
  );
}
