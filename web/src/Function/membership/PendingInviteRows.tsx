'use client';

import { useState } from 'react';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { WorkerAvatar } from '@/Function/shared/WorkerAvatar';
import { Button } from '@/ui/button';
import { cancelInvite, type PendingInvitee } from './invitations';

/** Pending invitees under a member list: a muted "Invited" label, and for the
 *  people who manage the scope a ghost "Cancel invite". They are not members
 *  yet, so they never appear in pickers or as Workers. */
export function PendingInviteRows({
  invitees,
  canCancel,
  onChanged,
  className = 'flex items-center gap-3 px-4 py-2.5',
}: {
  invitees: PendingInvitee[];
  /** The people who manage the scope may cancel any invitation; the
   *  database also lets an inviter cancel their own. */
  canCancel: boolean | ((invitee: PendingInvitee) => boolean);
  onChanged: () => void;
  className?: string;
}) {
  const { t } = useI18n();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cancel = async (invitee: PendingInvitee) => {
    setBusyId(invitee.invitationId);
    setError(null);
    try {
      await cancelInvite(invitee.invitationId);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('The invitation could not be canceled. Try again.'));
    } finally {
      setBusyId(null);
    }
  };

  if (invitees.length === 0) return null;
  return (
    <>
      {invitees.map((invitee) => (
        <div key={invitee.invitationId} className={className}>
          <WorkerAvatar
            worker={{ name: invitee.name, avatar_url: invitee.avatarUrl }}
            size={32}
            className="ring-border/70 opacity-60"
          />
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-medium text-muted-foreground truncate">{invitee.name || t('Unnamed')}</div>
            <div className="text-[11px] text-muted-foreground">{t(invitee.role === 'viewer' ? 'Invited as viewer' : 'Invited')}</div>
          </div>
          {(typeof canCancel === 'function' ? canCancel(invitee) : canCancel) && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={busyId === invitee.invitationId}
              onClick={() => void cancel(invitee)}
            >
              {t('Cancel invite')}
            </Button>
          )}
        </div>
      ))}
      {error && <div className="px-4 pb-2 text-[11px] text-[var(--status-danger)]">{error}</div>}
    </>
  );
}
