'use client';

import { formatError } from '@/Function/shared/formatError';
import { useMemo, useState } from 'react';
import { Plug } from '@/ui/icons';
import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { missingConnectors, type ConnectorNeed } from '@/AIP/harness/installFlow';
import { ConnectDialogHost, openedForIntegration, openedForPreset, type OpenedConnection } from './ConnectDialogHost';
import { useIntegrations, useIsSpaceOwner } from './data';
import { createDraft, useIntegrationDrafts } from './draftData';
import { openDraftForName } from './draftModel';
import { IntegrationDraftDialog } from './IntegrationDraftDialog';

// The ask to connect, shown where work was delegated: it names what is
// not connected and the work waiting on it, and its button opens the
// connection dialog — connecting itself stays the person's act in that
// dialog (sign-in, credentials), never the AI's. One shared card for the
// surfaces that hand work to the AI (the Strategy conversation's cards;
// the Copilot renders the same card under its turns), so the ask reads
// the same everywhere it appears.
//
// A need has two kinds, and the card says which: missing (never
// connected) and reauth (connected once, but the latest connection
// test failed — its remedy is the same dialog, opened on the existing
// connection: reconnect, not a new one).
//
// The needs it is handed are a snapshot from when the ask was made; what
// it shows and offers is re-read from the Space's live connections, so a
// card in an old transcript stays honest: connected since, it says so
// and offers nothing beyond (where the surface asks for it) continuing
// the work that waited.
const foldName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, '');

export function ConnectRequestCard({ spaceId, needs, waitingFor, onContinue }: {
  spaceId: string | null;
  /** The connectors asked for, with the preset each name resolves to (installFlow's ConnectorNeed). */
  needs: readonly ConnectorNeed[];
  /** The work waiting on the connection, in words a person recognises. */
  waitingFor?: string | null;
  /** Continue the waiting work — offered once everything asked for is
   *  connected, on the surfaces that can resume it (the Copilot chat).
   *  It is the person's act: the card never resumes by itself, because
   *  connecting also happens for other reasons and a silent resume
   *  could act on a stale ask. */
  onContinue?: () => void;
}) {
  const { t } = useI18n();
  const integrations = useIntegrations(spaceId);
  const drafts = useIntegrationDrafts(spaceId);
  const isOwner = useIsSpaceOwner(spaceId);
  const [opened, setOpened] = useState<OpenedConnection | null>(null);
  const [openedDraftId, setOpenedDraftId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
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
        <p className="flex-1 text-[13px] text-muted-foreground">{t('{names} is connected', { names: names.join('、') })}</p>
        {onContinue && (
          <Button size="sm" variant="primary" onClick={onContinue}>
            {t('Continue')}
          </Button>
        )}
      </div>
    );
  }
  const next = missing[0];
  const reauthNames = missing.filter((m) => m.kind === 'reauth').map((m) => m.name);
  const unconnectedNames = missing.filter((m) => m.kind === 'missing').map((m) => m.name);
  // A reauth need's connection exists: its dialog opens on the existing
  // row, so the person re-signs-in or replaces the key — never drafts a
  // second connection of the same name.
  const existingForNext = next.kind === 'reauth'
    ? integrations.data.find((i) => i.enabled && (foldName(i.name) === foldName(next.name) || (!!next.preset && i.preset === next.preset.id))) ?? null
    : null;
  // A name with no preset can be drafted by the AI instead (G4): the
  // card shows the draft's live state for that name, and offers to start
  // one. Drafting checks the Registry and the presets again on the
  // server before it writes anything, and activation stays an owner's
  // act in the review dialog — starting a draft connects nothing.
  const draft = next.kind === 'missing' ? openDraftForName(drafts.data, next.name) : null;
  const openedDraft = openedDraftId ? drafts.data.find((d) => d.id === openedDraftId) ?? null : null;
  const startDraft = async () => {
    setStarting(true); setStartError(null);
    try {
      const created = await createDraft(spaceId, {
        name: next.name, purpose: waitingFor ?? '', entry: 'connect_card', waitingFor: waitingFor ?? null,
      }, drafts.data);
      void drafts.refetch();
      setOpenedDraftId(created.id);
    } catch (e) {
      setStartError(formatError(e));
    } finally {
      setStarting(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 px-3 py-2.5">
      <Plug size={15} className="shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        {unconnectedNames.length > 0 && <p className="text-[13px] text-foreground">{t('Not connected: {names}', { names: unconnectedNames.join('、') })}</p>}
        {reauthNames.length > 0 && <p className="text-[13px] text-foreground">{t('Sign-in expired: {names}', { names: reauthNames.join('、') })}</p>}
        {waitingFor && <p className="mt-0.5 line-clamp-2 text-[12px] text-muted-foreground">{t('{work} is waiting on this connection', { work: waitingFor })}</p>}
        {isOwner === false && !draft && <p className="mt-0.5 text-[12px] text-muted-foreground">{t('Only a Space owner can connect it.')}</p>}
        {draft && (
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {draft.status === 'awaiting_review'
              ? t('The drafted connection is waiting for review.')
              : t('The AI is drafting this connection.')}
          </p>
        )}
        {startError && <p className="mt-0.5 text-[12px] text-[var(--status-danger)]">{startError}</p>}
      </div>
      {isOwner === true && next.kind === 'reauth' && (existingForNext || next.preset) && (
        <Button size="sm" variant="primary" onClick={() => setOpened(existingForNext ? openedForIntegration(existingForNext) : openedForPreset(next.preset!, integrations.data))}>
          {t('Reconnect {name}', { name: next.name })}
        </Button>
      )}
      {isOwner === true && next.kind === 'missing' && next.preset && (
        <Button size="sm" variant="primary" onClick={() => setOpened(openedForPreset(next.preset!, integrations.data))}>
          {t('Connect {name}', { name: next.name })}
        </Button>
      )}
      {draft ? (
        <Button size="sm" variant="secondary" onClick={() => setOpenedDraftId(draft.id)}>
          {t('Open the draft')}
        </Button>
      ) : next.kind === 'missing' && !next.preset && isOwner !== null && (
        <Button size="sm" variant="secondary" onClick={() => void startDraft()} disabled={starting}>
          {starting ? t('Starting…') : t('Have the AI draft it')}
        </Button>
      )}
      {opened && (
        <ConnectDialogHost spaceId={spaceId} opened={opened} integrations={integrations.data} canEdit={isOwner === true}
          onClose={() => { setOpened(null); void integrations.refetch(); }}
          onCreated={(created) => setOpened((o) => (o ? { preset: o.preset, integration: created } : o))} />
      )}
      {openedDraft && (
        <IntegrationDraftDialog spaceId={spaceId} draft={openedDraft} integrations={integrations.data}
          canReview={isOwner === true}
          onClose={() => setOpenedDraftId(null)}
          onChanged={() => { void drafts.refetch(); void integrations.refetch(); }} />
      )}
    </div>
  );
}
