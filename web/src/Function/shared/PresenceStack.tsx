'use client';

import { WorkerAvatarStack } from '@/Function/shared/WorkerAvatar';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { Viewer } from '@/hooks/usePresence';

/** The other people here right now, as a stack of avatars. Nothing when you are alone. */
export function PresenceStack({ viewers, size = 20 }: { viewers: Viewer[]; size?: number }) {
  const { t } = useI18n();
  if (!viewers.length) return null;
  const names = viewers.map((viewer) => viewer.name).join(', ');
  return (
    <span role="group" className="flex items-center" title={t('Also here: {names}', { names })} aria-label={t('Also here: {names}', { names })}>
      <WorkerAvatarStack workers={viewers.map((viewer) => ({ name: viewer.name }))} max={4} size={size} />
    </span>
  );
}
