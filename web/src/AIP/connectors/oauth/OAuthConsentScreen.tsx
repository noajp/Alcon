'use client';

import { useEffect, useState } from 'react';
import type { OAuthAuthorizationDetails } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { Button } from '@/ui/button';
import { ChoiceCard } from '@/ui/choice-card';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useAuthContext } from '@/providers/AuthProvider';
import { authorizationIdFrom, redirectHost, safeRedirectUrl, type OAuthAccess } from './connectedApps';
import { saveOAuthAccess } from './oauthData';

// /oauth/consent — where Supabase Auth's OAuth server sends a person whose
// MCP client (claude.ai, ChatGPT, …) asked to connect (ADR 0034). It names
// the client and where it returns, says the client acts as this person within
// their permissions, and lets them choose read & write or read only before
// approving. Approve and deny both hand the browser back to the client.

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; details: OAuthAuthorizationDetails }
  | { kind: 'leaving' };

export function OAuthConsentScreen() {
  const { t } = useI18n();
  const { user } = useAuthContext();
  // The page renders only after the session check, in the browser.
  const [authorizationId] = useState(() => (typeof window === 'undefined' ? null : authorizationIdFrom(window.location.search)));
  const [state, setState] = useState<State>(() => authorizationId
    ? { kind: 'loading' }
    : { kind: 'error', message: t('This link has no authorization request. Start connecting again from the app.') });
  const [access, setAccess] = useState<OAuthAccess>('read_write');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!authorizationId) return;
    let cancelled = false;
    void supabase.auth.oauth.getAuthorizationDetails(authorizationId).then(({ data, error }) => {
      if (cancelled) return;
      if (error || !data) {
        setState({ kind: 'error', message: t('This request has expired or is no longer valid. Start connecting again from the app.') });
        return;
      }
      if ('redirect_url' in data) {
        // Already approved for this client: go straight back.
        const target = safeRedirectUrl(data.redirect_url);
        if (target) {
          setState({ kind: 'leaving' });
          window.location.assign(target);
        } else {
          setState({ kind: 'error', message: t('The app returned an address Alcon cannot open.') });
        }
        return;
      }
      setState({ kind: 'ready', details: data });
    });
    return () => { cancelled = true; };
  }, [authorizationId, t]);

  const decide = async (approve: boolean) => {
    if (state.kind !== 'ready' || busy) return;
    setBusy(true);
    setActionError(null);
    const { details } = state;
    try {
      if (approve) await saveOAuthAccess(details.client.id, access);
      const { data, error } = approve
        ? await supabase.auth.oauth.approveAuthorization(details.authorization_id, { skipBrowserRedirect: true })
        : await supabase.auth.oauth.denyAuthorization(details.authorization_id, { skipBrowserRedirect: true });
      if (error) throw error;
      const target = safeRedirectUrl(data?.redirect_url);
      if (!target) throw new Error('no redirect');
      setState({ kind: 'leaving' });
      window.location.assign(target);
    } catch {
      setActionError(approve ? t('The connection could not be approved. Try again.') : t('The request could not be declined. Try again.'));
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh flex items-center justify-center bg-[var(--content-bg)] px-4 py-10">
      <div className="w-full max-w-md rounded-lg border border-border/60 bg-background p-6 space-y-5">
        {state.kind === 'loading' || state.kind === 'leaving' ? (
          <p className="text-[13px] text-muted-foreground">{state.kind === 'leaving' ? t('Returning to the app…') : t('Loading…')}</p>
        ) : state.kind === 'error' ? (
          <div className="space-y-2">
            <h1 className="text-[15px] font-semibold text-foreground">{t('Connect to Alcon')}</h1>
            <p role="alert" className="text-[13px] text-muted-foreground">{state.message}</p>
          </div>
        ) : (
          <>
            <div className="space-y-1">
              <h1 className="text-[15px] font-semibold text-foreground">
                {t('{client} wants to connect to Alcon', { client: state.details.client.name || t('An app') })}
              </h1>
              <p className="text-[12px] text-muted-foreground">
                {t('After you decide, you return to {host}.', { host: redirectHost(state.details.redirect_uri) })}
              </p>
            </div>

            <div className="space-y-1.5 text-[13px] text-foreground">
              <p>{t('It acts as {email}: it sees and changes only what you can, in every Space you belong to.', { email: state.details.user.email || user?.email || '' })}</p>
              <p className="text-muted-foreground">{t('It cannot delete, bulk-edit, move Elements between Objects, or edit Objects. Disconnect it any time in Settings › API.')}</p>
            </div>

            <div className="grid gap-2">
              <ChoiceCard selected={access === 'read_write'} label={t('Read & write')} onClick={() => setAccess('read_write')}>
                <span className="text-[12px] text-muted-foreground">{t('Read the board, and create and update Elements, comments, assignees and labels.')}</span>
              </ChoiceCard>
              <ChoiceCard selected={access === 'read'} label={t('Read only')} onClick={() => setAccess('read')}>
                <span className="text-[12px] text-muted-foreground">{t('Read the board. Every write to the board is refused.')}</span>
              </ChoiceCard>
            </div>

            {actionError && <p role="alert" className="text-[12px] text-[var(--status-danger)]">{actionError}</p>}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => decide(false)} disabled={busy}>{t('Decline')}</Button>
              <Button variant="primary" size="sm" onClick={() => decide(true)} disabled={busy}>{t('Approve')}</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
