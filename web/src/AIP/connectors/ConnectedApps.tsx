'use client';

import { useState } from 'react';
import { Button } from '@/ui/button';
import { appDialog } from '@/Function/shared/appDialogStore';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { FONT, SETTINGS_ISLAND } from '@/shared/designTokens';
import type { ConnectedApp, OAuthAccess } from '@/AIP/connectors/oauth/connectedApps';
import { useConnectedAppActions, useConnectedApps } from '@/AIP/connectors/oauth/oauthData';

// Settings › API: the apps connected over OAuth
// (claude.ai, ChatGPT, …; ADR 0034). Each row says what the app may do and
// since when; access can be narrowed or widened, and Disconnect revokes the
// grant so the app's next call is refused.

export function ConnectedApps() {
  const { t, locale } = useI18n();
  const { data: apps, loading, error } = useConnectedApps();
  const { setAccess, disconnect } = useConnectedAppActions();
  const [actionError, setActionError] = useState<string | null>(null);

  const date = (iso: string) => new Date(iso).toLocaleDateString(locale);

  const changeAccess = (app: ConnectedApp, access: OAuthAccess) => {
    setActionError(null);
    setAccess.mutate({ clientId: app.clientId, access }, { onError: () => setActionError(t('The access could not be changed. Try again.')) });
  };

  const confirmDisconnect = async (app: ConnectedApp) => {
    if (!await appDialog.confirm(t('Disconnect {name}? It stops working at once; connecting again asks for your approval.', { name: app.name }))) return;
    setActionError(null);
    disconnect.mutate(app.clientId, { onError: () => setActionError(t('The app could not be disconnected. Try again.')) });
  };

  return (
    <section className="space-y-3">
      <div className="min-w-0">
        <h2 className={`${FONT.lg} text-foreground`}>{t('Connected apps')}</h2>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          {t('Apps that connect by signing in, such as claude.ai or ChatGPT: add the server address there as a custom connector, sign in, and choose what it may do.')}
        </p>
      </div>

      <div className={`${SETTINGS_ISLAND} divide-y divide-[var(--border-subtle)]`}>
        {error ? (
          <p className="px-5 py-3 text-[13px] text-muted-foreground">{t('Connecting with sign-in is not available yet.')}</p>
        ) : loading ? (
          <p className="px-5 py-3 text-[13px] text-muted-foreground">{t('Loading…')}</p>
        ) : apps.length === 0 ? (
          <p className="px-5 py-3 text-[13px] text-muted-foreground">{t('No apps connected.')}</p>
        ) : apps.map((app) => (
          <div key={app.clientId} className="flex items-center gap-3 px-5 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-foreground">{app.name}</div>
              <div className="truncate text-[12px] text-muted-foreground">
                {[app.access === 'read_write' ? t('Read & write') : t('Read only'), t('Connected {date}', { date: date(app.grantedAt) })].join(' · ')}
              </div>
            </div>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => changeAccess(app, app.access === 'read_write' ? 'read' : 'read_write')}
              disabled={setAccess.isPending}
            >
              {app.access === 'read_write' ? t('Make read only') : t('Allow writes')}
            </Button>
            <Button variant="danger" size="xs" onClick={() => confirmDisconnect(app)} disabled={disconnect.isPending}>{t('Disconnect')}</Button>
          </div>
        ))}
      </div>
      {actionError && <p role="alert" className="text-[12px] text-[var(--status-danger)]">{actionError}</p>}
    </section>
  );
}
