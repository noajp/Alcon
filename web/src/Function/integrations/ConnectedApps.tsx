'use client';

import { useState } from 'react';
import { Button } from '@/ui/button';
import { appDialog } from '@/Function/shared/appDialogStore';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { FONT } from '@/shared/designTokens';
import type { ConnectedApp, OAuthAccess } from '@/Function/oauth/connectedApps';
import { useConnectedAppActions, useConnectedApps } from '@/Function/oauth/oauthData';

// Settings › Customize › Connect to Alcon: the apps connected over OAuth
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
        <h3 className={`${FONT.lg} text-foreground`}>{t('Connected apps')}</h3>
        <p className="mt-1 text-[12px] text-muted-foreground">
          {t('Apps you approved by signing in, such as claude.ai or ChatGPT. Add the endpoint above as a custom connector, sign in, and choose what it may do.')}
        </p>
      </div>

      {error ? (
        <p className="text-[12px] text-muted-foreground">{t('Connecting with sign-in is not available yet.')}</p>
      ) : loading ? (
        <p className="text-[12px] text-muted-foreground">{t('Loading…')}</p>
      ) : apps.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">{t('No apps connected.')}</p>
      ) : (
        <div>
          {apps.map((app) => (
            <div key={app.clientId} className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted/40">
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
      )}
      {actionError && <p role="alert" className="text-[12px] text-[var(--status-danger)]">{actionError}</p>}
    </section>
  );
}
