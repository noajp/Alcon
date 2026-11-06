'use client';

import { useI18n } from '@/Function/i18n/I18nProvider';
import { SidebarFold } from '@/Function/shared/SidebarFold';
import { SidebarRow } from '@/Function/shared/SidebarRow';
import { ElementProgressMark } from '@/Function/shared/ElementProgressMark';
import { ObjectIcon } from '@/Frame/icons';
import { useFollows, type Followed } from '@/hooks/followData';
import type { ElementWithDetails } from '@/hooks/useSupabase';

/** "Follow ▾": the Objects and Elements this person follows (the star beside
 *  an Object's or an Element's "…"); each opens where it lives. Absent until
 *  they follow something. */
export function FollowSection({ activeObjectId, onOpen }: { activeObjectId: string | null; onOpen: (item: Followed) => void }) {
  const { t } = useI18n();
  const { follows, loading } = useFollows();
  if (loading || !follows.length) return null;
  return (
    <SidebarFold id="execution-follow" label={t('Follow')}>
      <div className="space-y-px">
        {follows.map((f) => (
          <SidebarRow key={`${f.kind}:${f.id}`} label={f.label} title={f.label}
            active={f.kind === 'object' && f.objectId === activeObjectId}
            icon={f.kind === 'object' ? <ObjectIcon size={16} /> : <ElementProgressMark status={f.status as ElementWithDetails['status']} size={16} />}
            onClick={() => onOpen(f)} />
        ))}
      </div>
    </SidebarFold>
  );
}
