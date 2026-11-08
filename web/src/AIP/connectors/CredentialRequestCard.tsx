'use client';

import { useMemo, useState } from 'react';
import { KeyRound } from '@/ui/icons';
import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useIntegrations, useIsSpaceOwner } from './data';
import { captureDialogModel, credentialRequestStateLabel } from './credentialRequestModel';
import { useCredentialRequest } from './credentialRequestData';
import { CredentialCaptureDialog } from './CredentialCaptureDialog';

// The capture ask, shown where the need arose (a chat turn, a run's
// panel): it names what needs a credential and the work waiting on
// it, and its button opens the capture dialog — entering the
// credential itself stays the person's act in that dialog, never
// the AI's. One shared card for every surface, like ConnectRequestCard.
//
// The card re-reads its request row live, so an ask in an old
// transcript shows its true state and never offers a dead form.
// Saving is an owner's act (D1): a member sees whose hands the ask
// is in — the owners were told through their Inbox when it arose.
//
// When the ask resolves as saved / used-once, surfaces that can
// resume the waiting work offer Continue — the person's press, never
// automatic (§3.6): a capture also happens for other reasons, and a
// silent resume could act on a stale ask.
export function CredentialRequestCard({ spaceId, requestId, label, onContinue }: {
  spaceId: string | null;
  requestId: string;
  /** The label the surface snapshotted (a connection's name, a site's
   *  origin), shown until the live row lands. */
  label?: string;
  /** Continue the waiting work — offered once the ask is answered,
   *  on the surfaces that can resume it. */
  onContinue?: () => void;
}) {
  const { t } = useI18n();
  const live = useCredentialRequest(spaceId ? requestId : null);
  const integrations = useIntegrations(spaceId);
  const isOwner = useIsSpaceOwner(spaceId);
  const [opened, setOpened] = useState(false);
  const request = live.data;
  const integrationId = request?.integration_id ?? null;
  const integration = useMemo(
    () => (integrationId ? integrations.data.find((i) => i.id === integrationId) ?? null : null),
    [integrations.data, integrationId],
  );
  if (!spaceId) return null;
  const subject = (request ? captureDialogModel(request, integration).subject : '') || label || '';
  const waitingFor = request?.need?.waiting_for ?? null;

  if (!request) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border/60 px-3 py-2.5">
        <KeyRound size={15} className="shrink-0 text-muted-foreground" />
        <p className="flex-1 text-[13px] text-muted-foreground">{t('A credential is needed for {name}', { name: subject })}</p>
      </div>
    );
  }

  const stateLabel = credentialRequestStateLabel(request.status);
  if (stateLabel) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border/60 px-3 py-2.5">
        <KeyRound size={15} className="shrink-0 text-muted-foreground" />
        <p className="flex-1 text-[13px] text-muted-foreground">
          {t('{name}: {state}', { name: subject, state: t(stateLabel) })}
        </p>
        {onContinue && (request.status === 'saved' || request.status === 'used_once') && (
          <Button size="sm" variant="primary" onClick={onContinue}>
            {t('Continue')}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 px-3 py-2.5">
      <KeyRound size={15} className="shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-foreground">{t('A credential is needed for {name}', { name: subject })}</p>
        {waitingFor && (
          <p className="mt-0.5 line-clamp-2 text-[12px] text-muted-foreground">
            {t('{work} is waiting on this credential', { work: waitingFor })}
          </p>
        )}
        {isOwner === false && (
          <p className="mt-0.5 text-[12px] text-muted-foreground">{t('Waiting for a Space owner to enter it.')}</p>
        )}
      </div>
      {isOwner === true && (
        <Button size="sm" variant="primary" onClick={() => setOpened(true)}>
          {t('Enter credential')}
        </Button>
      )}
      {opened && (
        <CredentialCaptureDialog key={request.id} spaceId={spaceId} request={request} label={subject} canEdit={isOwner === true}
          onClose={() => { setOpened(false); void live.refetch(); }}
          onResolved={() => void live.refetch()} />
      )}
    </div>
  );
}
