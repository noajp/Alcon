'use client';

import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { Button } from '@/ui/button';
import type { InvitationStatus, MembershipInvitation } from '@/types/database';
import { invitationScope, respondToInvite, SCOPE_LABEL } from './invitations';

/** An invitation the viewer received: who invited them to what, and Accept /
 *  Decline while it is pending. Once answered (here or elsewhere) it says how
 *  it was resolved instead. */
export function InvitationCard({
  invitation,
  onResolved,
  compact = false,
}: {
  invitation: MembershipInvitation;
  onResolved?: (status: InvitationStatus) => void;
  /** A row in a list (Profile, onboarding) rather than the Inbox reader. */
  compact?: boolean;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answered, setAnswered] = useState<InvitationStatus | null>(null);
  const status = answered ?? invitation.status;
  const scope = SCOPE_LABEL[invitationScope(invitation).scope];
  const values = { inviter: invitation.inviter_name || t('Someone'), scope, name: invitation.scope_name };

  const respond = async (accept: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const next = await respondToInvite(invitation.id, accept);
      setAnswered(next);
      onResolved?.(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('The invitation could not be answered. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const resolved = status === 'accepted'
    ? t('You joined {scope} {name}.', values)
    : status === 'declined'
      ? t('You declined this invitation.')
      : status === 'canceled'
        ? t('This invitation was canceled.')
        : null;

  return (
    <div className={compact ? 'flex items-center gap-3 px-4 py-2.5' : 'flex flex-col gap-4'}>
      {compact && <UserPlus size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />}
      <div className="min-w-0 flex-1">
        <p className={compact ? 'text-[13px] text-foreground truncate' : 'text-2xl font-semibold'}>
          {t('{inviter} invited you to {scope} {name}', values)}
        </p>
        {!compact && status === 'pending' && (
          <p className="mt-3 text-[15px] leading-7 text-foreground/90">
            {t('You join when you accept. Until then you are not a member and nothing in it is shared with you.')}
          </p>
        )}
        {resolved && <p className={compact ? 'text-[11px] text-muted-foreground' : 'mt-3 text-[13px] text-muted-foreground'} role="status">{resolved}</p>}
        {error && <p className="mt-1 text-[12px] text-[var(--status-danger)]">{error}</p>}
      </div>
      {status === 'pending' && (
        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" variant="primary" disabled={busy} onClick={() => void respond(true)}>{t('Accept')}</Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => void respond(false)}>{t('Decline')}</Button>
        </div>
      )}
    </div>
  );
}
