'use client';

import { useI18n } from '@/Function/i18n/I18nProvider';
import type { InvitationStatus } from '@/types/database';
import { InvitationCard } from './InvitationCard';
import { useMyInvitations } from './invitations';

/** The viewer's pending invitations as Accept / Decline rows. Renders nothing
 *  when there are none and `emptyText` is omitted. */
export function MyInvitations({
  emptyText,
  onAccepted,
  className = 'divide-y divide-border/40',
}: {
  emptyText?: string;
  onAccepted?: () => void;
  className?: string;
}) {
  const { t } = useI18n();
  const { invitations, loading, error } = useMyInvitations();

  if (loading) return emptyText ? <div className="px-4 py-6 text-[12px] text-muted-foreground">{t('Loading…')}</div> : null;
  if (error) return <div className="px-4 py-6 text-[12px] text-[var(--status-danger)]">{t('Invitations could not be loaded.')}</div>;
  if (invitations.length === 0) return emptyText ? <div className="px-4 py-6 text-[12px] text-muted-foreground">{emptyText}</div> : null;

  const handleResolved = (status: InvitationStatus) => {
    if (status === 'accepted') onAccepted?.();
  };
  return (
    <div className={className}>
      {invitations.map((invitation) => (
        <InvitationCard key={invitation.id} invitation={invitation} compact onResolved={handleResolved} />
      ))}
    </div>
  );
}
