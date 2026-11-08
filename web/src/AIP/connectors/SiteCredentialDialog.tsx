'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { Lock } from '@/ui/icons';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { appDialog } from '@/Function/shared/appDialogStore';
import { formatError } from '@/Function/shared/formatError';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { Integration, SiteCredential } from '@/types/database';
import { useSiteCredentialActions } from './siteCredentialData';
import { coveringIntegration, normalizeSiteOrigin } from './siteCredentialModel';

// One site login (secure-login PR1), in its settings-hosted form: add a
// login for a website that has no connection, or replace / delete the
// stored password of an existing one. The password is write-only — it
// goes from this form straight to set_site_credential_by_origin
// (Vault) and is never read back; the dialog only ever knows whether
// one is stored (`secret_id`).
//
// The origin is the credential's identity: on an existing login it is
// locked text, not an input (a password filed under one origin must
// never be re-aimed at another). The username and password are stored
// as one pair, so saving always submits both — what the person types
// is what gets stored.
//
// D5: when a connection in this Space already covers the origin's
// host, the form says so and names the fix (use the connection);
// saving anyway is the owner's explicit second step, which the RPC
// honours only with its force flag.

export function SiteCredentialDialog({ spaceId, credential, integrations, canEdit, onClose, onChanged }: {
  spaceId: string;
  credential: SiteCredential | null;
  integrations: Integration[];
  canEdit: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const actions = useSiteCredentialActions(spaceId);
  const isNew = !credential;
  const hasSecret = !!credential?.secret_id;

  const [origin, setOrigin] = useState(credential?.origin ?? '');
  const [label, setLabel] = useState(credential?.label ?? '');
  const [username, setUsername] = useState(credential?.username ?? '');
  const [password, setPassword] = useState('');
  const [editingPassword, setEditingPassword] = useState(false);
  const [forceArmed, setForceArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalized = useMemo(() => normalizeSiteOrigin(origin), [origin]);
  const coveredBy = useMemo(
    () => (normalized ? coveringIntegration(integrations, normalized) : null),
    [integrations, normalized],
  );
  const busy = actions.save.isPending || actions.clear.isPending;
  const passwordFieldOpen = isNew || !hasSecret || editingPassword;

  const save = async () => {
    setError(null);
    if (!normalized) { setError(t('Enter a site address like https://example.com.')); return; }
    if (!username.trim()) { setError(t('Enter the username for this site login.')); return; }
    if (!password) { setError(t('Enter a password.')); return; }
    if (coveredBy && !forceArmed) { setForceArmed(true); return; }
    try {
      const result = await actions.save.mutateAsync({
        origin: normalized,
        username: username.trim(),
        password,
        label: label.trim() || null,
        force: forceArmed,
      });
      if (result === 'covered_by_connection') {
        // The server saw a cover the client did not (an endpoint this
        // mirror could not parse): show the same warning, save nothing.
        setForceArmed(true);
        return;
      }
      setPassword('');
      onChanged();
      onClose();
    } catch (e) {
      setError(t(formatError(e)));
    }
  };

  const clear = async () => {
    if (!credential) return;
    if (!await appDialog.confirm(t('Delete the stored password for {origin}? Agents can no longer sign in there until a new one is set.', { origin: credential.origin }))) return;
    setError(null);
    try {
      await actions.clear.mutateAsync(credential);
      onChanged();
      onClose();
    } catch (e) {
      setError(t(formatError(e)));
    }
  };

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-h-[calc(100dvh-48px)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-strong)] text-[var(--text-secondary)]">
              <Lock size={16} />
            </span>
            <DialogTitle className="truncate">{isNew ? t('Add site login') : (credential.label || credential.origin)}</DialogTitle>
          </div>
        </DialogHeader>

        {!canEdit && (
          <p className="text-[12px] text-muted-foreground">{t('Only Space owners can save or change site logins. You can see which sites have one.')}</p>
        )}

        <div className="space-y-4">
          <Field label={t('Website')}>
            {isNew ? (
              <Input value={origin} onChange={(e) => { setOrigin(e.target.value); setForceArmed(false); }} disabled={!canEdit}
                inputMode="url" placeholder="https://example.com" aria-label={t('Website')}
                className="h-8 font-mono text-[12px] md:text-[12px]" />
            ) : (
              <div className="truncate font-mono text-[13px] text-foreground">{credential.origin}</div>
            )}
          </Field>

          <Field label={t('Label (optional)')}>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} disabled={!canEdit || !passwordFieldOpen}
              aria-label={t('Label (optional)')} className="h-8 text-[13px] md:text-[13px]" />
          </Field>

          <Field label={t('Username')}>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} disabled={!canEdit || !passwordFieldOpen}
              autoComplete="off" aria-label={t('Username')} className="h-8 text-[13px] md:text-[13px]" />
          </Field>

          <Field label={t('Password')}>
            {!passwordFieldOpen ? (
              <div className="flex items-center gap-2">
                <span className="text-[13px] text-foreground">{t('Set')}</span>
                {canEdit && (
                  <>
                    <Button variant="ghost" size="xs" onClick={() => setEditingPassword(true)} disabled={busy}>{t('Update')}</Button>
                    <Button variant="danger" size="xs" onClick={clear} disabled={busy}>{t('Delete')}</Button>
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-1.5">
                <Input type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)}
                  disabled={!canEdit} aria-label={t('Password')} className="h-8 text-[13px] md:text-[13px]" />
                {!isNew && hasSecret && (
                  <p className="text-[12px] text-muted-foreground">{t('The username and password are stored as one pair — saving replaces both.')}</p>
                )}
              </div>
            )}
          </Field>

          {coveredBy && (
            <p className="rounded-md bg-[var(--status-warning-subtle)] px-3 py-2 text-[12px] text-foreground">
              {t('This site is already connected as {name}. Saving a password here adds a second route to the same place; the connection is the safer route.', { name: coveredBy.name })}
            </p>
          )}
        </div>

        {error && <p role="alert" className="text-[12px] text-[var(--status-danger)]">{error}</p>}

        <DialogFooter className="items-center sm:justify-between">
          <span />
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>{isNew ? t('Cancel') : t('Close')}</Button>
            {canEdit && passwordFieldOpen && (
              <Button variant="primary" size="sm" onClick={save} disabled={busy}>
                {busy ? t('Saving…') : coveredBy && forceArmed ? t('Save anyway') : t('Save')}
              </Button>
            )}
          </div>
        </DialogFooter>
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
