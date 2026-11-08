'use client';

import { useMemo, useState } from 'react';
import { Plug } from '@/ui/icons';
import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { missingConnectors, type ConnectorNeed } from '@/AIP/harness/installFlow';
import { ConnectDialogHost, openedForPreset, type OpenedConnection } from './ConnectDialogHost';
import { useIntegrations, useIsSpaceOwner } from './data';

// The ask to connect, shown where work was delegated: it names what is
// not connected and the work waiting on it, and its button opens the
// connection dialog — connecting itself stays the person's act in that
// dialog (sign-in, credentials), never the AI's. One shared card for the
// surfaces that hand work to the AI (the Strategy conversation's cards;
// the Copilot can render the same card), so the ask reads the same
// everywhere it appears.
//
// The needs it is handed are a snapshot from when the ask was made; what
// it shows and offers is re-read from the Space's live connections, so a
// card in an old transcript stays honest: connected since, it says so
// and offers nothing.
export function ConnectRequestCard({ spaceId, needs, waitingFor }: {
  spaceId: string | null;
  /** The connectors asked for, with the preset each name resolves to (installFlow's ConnectorNeed). */
  needs: readonly ConnectorNeed[];
  /** The work waiting on the connection, in words a person recognises. */
  waitingFor?: string | null;
}) {
  const { t } = useI18n();
  const integrations = useIntegrations(spaceId);
  const isOwner = useIsSpaceOwner(spaceId);
  const [opened, setOpened] = useState<OpenedConnection | null>(null);
  const names = useMemo(() => needs.map((n) => n.name), [needs]);
  // Until the live rows land, the snapshot stands; after, only what is
  // still missing is offered.
  const missing = useMemo(
    () => (integrations.loading ? [...needs] : missingConnectors(names, integrations.data)),
    [integrations.loading, integrations.data, names, needs],
  );
  if (!spaceId || needs.length === 0) return null;
  if (missing.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border/60 px-3 py-2.5">
        <Plug size={15} className="shrink-0 text-muted-foreground" />
        <p className="text-[13px] text-muted-foreground">{t('{names} is connected', { names: names.join('、') })}</p>
      </div>
    );
  }
  const next = missing[0];
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 px-3 py-2.5">
      <Plug size={15} className="shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-foreground">{t('Not connected: {names}', { names: missing.map((m) => m.name).join('、') })}</p>
        {waitingFor && <p className="mt-0.5 line-clamp-2 text-[12px] text-muted-foreground">{t('{work} is waiting on this connection', { work: waitingFor })}</p>}
        {isOwner === false && <p className="mt-0.5 text-[12px] text-muted-foreground">{t('Only a Space owner can connect it.')}</p>}
        {isOwner === true && !next.preset && (
          <p className="mt-0.5 text-[12px] text-muted-foreground">{t('Find and connect it from the MCP Registry in Settings › Customize')}</p>
        )}
      </div>
      {isOwner === true && next.preset && (
        <Button size="sm" variant="primary" onClick={() => setOpened(openedForPreset(next.preset!, integrations.data))}>
          {t('Connect {name}', { name: next.name })}
        </Button>
      )}
      {opened && (
        <ConnectDialogHost spaceId={spaceId} opened={opened} integrations={integrations.data} canEdit={isOwner === true}
          onClose={() => { setOpened(null); void integrations.refetch(); }}
          onCreated={(created) => setOpened((o) => (o ? { preset: o.preset, integration: created } : o))} />
      )}
    </div>
  );
}
