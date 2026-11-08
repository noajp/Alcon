'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { Lock } from '@/ui/icons';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { formatError } from '@/Function/shared/formatError';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { CredentialRequest } from '@/types/database';
import { useIntegrations } from './data';
import { captureDialogModel } from './credentialRequestModel';
import {
  declineCredentialRequest, saveSiteCredential, saveTokenCredential, stashCredentialOnce, testCapturedIntegration,
  useCredentialRequest,
} from './credentialRequestData';

// The capture dialog (secure-login PR2): the conversation's front
// door for a credential, in the shape of the owner's reference — a
// locked destination, a prefilled username, ONE masked field, a
// save-or-use-once choice, Enter. It is rendered only from a
// credential_requests row (a server-written need); no model-authored
// surface can mint one, and the value field exists only in here.
//
// The value's whole journey in the browser: this component's state →
// one storage RPC (by request id for a site login; the connection's
// existing set_integration_secret for a token). It is never read
// back, never logged, and the state is wiped on submit and on close.
// What the conversation learns is the request's terminal status —
// the card re-reads the row.
//
// Cancel is the decline: a recorded answer, not a timeout (§3.2).
// Merely dismissing the dialog (the ×, the backdrop) decides
// nothing — the ask stands and its card can reopen this dialog.

export function CredentialCaptureDialog({ spaceId, request, label, canEdit, onClose, onResolved }: {
  spaceId: string;
  /** The request snapshot the card was showing; the dialog re-reads the row live. */
  request: CredentialRequest;
  /** The display label the surface snapshotted (a name / an origin), until the live row lands. */
  label?: string;
  /** The saver is an owner (D1); members never get an editable form. */
  canEdit: boolean;
  onClose: () => void;
  /** The ask reached a terminal state (saved / used once / declined). */
  onResolved?: () => void;
}) {
  const { t } = useI18n();
  const live = useCredentialRequest(request.id);
  const integrations = useIntegrations(spaceId);
  const row = live.data ?? request;
  const integration = useMemo(
    () => (row.integration_id ? integrations.data.find((i) => i.id === row.integration_id) ?? null : null),
    [integrations.data, row.integration_id],
  );
  const model = captureDialogModel(row, integration);
  const subject = model.subject || label || '';

  // The dialog opens on one request — the card mounts it keyed by
  // request id, so this state is born from that ask's own defaults.
  const [username, setUsername] = useState(row.username_hint ?? '');
  const [secret, setSecret] = useState('');
  const [save, setSave] = useState(model.saveByDefault);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [covered, setCovered] = useState(false);

  const wipe = () => setSecret('');

  const submit = async () => {
    setError(null);
    setCovered(false);
    if (!secret) { setError(t('Enter a password.')); return; }
    if (model.hasUsername && !username.trim()) { setError(t('Enter the username for this site login.')); return; }
    setBusy(true);
    try {
      if (!save) {
        await stashCredentialOnce(row, model.hasUsername ? username.trim() : null, secret);
      } else if (row.kind === 'site_login') {
        const result = await saveSiteCredential(row, username.trim(), secret);
        if (result === 'covered_by_connection') {
          // D5: a connection already covers this host. The dialog
          // explains; forcing a second route is a Settings act.
          setCovered(true);
          return;
        }
      } else {
        const sealed = await saveTokenCredential(row, secret);
        if (sealed !== 'saved') { setError(t('The credential could not be confirmed as saved.')); return; }
        // §3.6: a fresh capture is proven before the waiting work
        // resumes — the connection test's verdict lands on last_test.
        if (row.integration_id) await testCapturedIntegration(row.integration_id);
      }
      wipe();
      onResolved?.();
      onClose();
    } catch (e) {
      // The RPC's own fixed messages only — a value is never in one.
      setError(t(formatError(e)));
    } finally {
      setBusy(false);
    }
  };

  const decline = async () => {
    setBusy(true);
    try {
      await declineCredentialRequest(row);
      wipe();
      onResolved?.();
      onClose();
    } catch (e) {
      setError(t(formatError(e)));
    } finally {
      setBusy(false);
    }
  };

  const header = row.kind === 'site_login'
    ? t('Sign in to {origin}', { origin: subject })
    : t('Credentials for {name}', { name: subject });

  return (
    <Dialog open onOpenChange={(next) => { if (!next) { wipe(); onClose(); } }}>
      <DialogContent className="max-h-[calc(100dvh-48px)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-strong)] text-[var(--text-secondary)]">
              <Lock size={16} />
            </span>
            <DialogTitle className="truncate">{header}</DialogTitle>
          </div>
        </DialogHeader>

        {model.waitingFor && (
          <p className="text-[12px] text-muted-foreground">{t('{work} is waiting on this credential', { work: model.waitingFor })}</p>
        )}
        {!canEdit && (
          <p className="text-[12px] text-muted-foreground">{t('Only Space owners can enter credentials.')}</p>
        )}

        <form
          onSubmit={(e) => { e.preventDefault(); if (canEdit && !busy) void submit(); }}
          className="space-y-4"
        >
          <Field label={row.kind === 'site_login' ? t('Website') : t('Destination')}>
            <div className="truncate font-mono text-[13px] text-foreground">{model.destination || subject}</div>
          </Field>

          {model.hasUsername && (
            <Field label={t('Username')}>
              <Input value={username} onChange={(e) => setUsername(e.target.value)} disabled={!canEdit || busy}
                autoComplete="off" aria-label={t('Username')} className="h-8 text-[13px] md:text-[13px]" />
            </Field>
          )}

          <Field label={t(model.secretLabel)}>
            <Input type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)}
              disabled={!canEdit || busy} aria-label={t(model.secretLabel)} className="h-8 text-[13px] md:text-[13px]" />
          </Field>

          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-foreground">
            <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)}
              disabled={!canEdit || busy} className="h-4 w-4 shrink-0 accent-[var(--accent)]" />
            {t('Save to the secure credentials store')}
          </label>
          {!save && (
            <p className="text-[12px] text-muted-foreground">{t('Used once for the waiting work, then gone — nothing is stored.')}</p>
          )}

          {covered && (
            <p className="rounded-md bg-[var(--status-warning-subtle)] px-3 py-2 text-[12px] text-foreground">
              {t('This site is already connected. Saving a password here would add a second route to the same place; the connection is the safer route.')}
            </p>
          )}
          {error && <p role="alert" className="text-[12px] text-[var(--status-danger)]">{error}</p>}

          <DialogFooter className="items-center sm:justify-between">
            <span />
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => void decline()} disabled={busy || !canEdit}>
                {t('Cancel')}
              </Button>
              {canEdit && (
                <Button type="submit" variant="primary" size="sm" disabled={busy}>
                  {busy ? t('Saving…') : t('Enter')}
                </Button>
              )}
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[12px] font-medium text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}
